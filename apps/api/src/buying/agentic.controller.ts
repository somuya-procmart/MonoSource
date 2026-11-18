import { BadRequestException, Body, ConflictException, Controller, Get, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Db } from '../db/db';
import { audit, canAtNode, CurrentCtx, Ctx, hasPerm, Perm, visibleNodeIds } from '../common/security';
import { advance, AGENT_LABEL, DEFAULT_PREFS, quoteFor, resolveTask, RunCtx } from './agentic';

const isId = (s?: string) => !!s && /^[0-9a-f-]{36}$/.test(s);
class ResolveTaskDto { @IsString() @Length(1, 40) action: string; @IsOptional() @IsString() @Length(0, 400) note?: string; @IsOptional() @IsString() @Length(0, 200) supplier?: string }
class ReadDto { @IsOptional() @IsBoolean() all?: boolean; @IsOptional() @IsUUID('all', { each: true }) ids?: string[] }
class PrefsDto { @IsObject() prefs: Record<string, boolean> }

const STAGES = [['discovery', 'Discovery'], ['coordination', 'Supplier coordination'], ['evaluation', 'Evaluation'], ['approval', 'Approval'], ['fulfilment', 'Fulfilment']] as const;
type AgentState = { agent: string; label: string; status: 'completed' | 'monitoring' | 'in_progress' | 'waiting' | 'blocked' | 'skipped'; text: string };

/** Agent status cards derived from where the scripted run is. Deterministic: same step → same cards. */
function agentCards(kind: string, step: number, x: RunCtx, openBlocking: string | null, responded: number, total: number): AgentState[] {
  const L = AGENT_LABEL; const n = total;
  if (kind === 'arc') return [
    { agent: 'discovery', label: L.discovery, status: 'completed', text: 'Matched the requirement to contract supply and checked it for your plant.' },
    { agent: 'outreach', label: L.outreach, status: 'skipped', text: 'Not needed: a contract price applies, so no quotations are collected.' },
    { agent: 'followup', label: L.followup, status: 'monitoring', text: 'Following the supplier’s order confirmation and dispatch.' },
    { agent: 'quotation', label: L.quotation, status: 'skipped', text: 'Not needed for contract supply.' },
    { agent: 'comparison', label: L.comparison, status: 'skipped', text: 'Not needed for contract supply.' },
    { agent: 'coordination', label: L.coordination, status: 'monitoring', text: 'Tracking the requisition and order, and keeping you informed.' }];
  const s = step;
  return [
    { agent: 'discovery', label: L.discovery, status: 'completed', text: x.arc ? `Found group ARC ${x.arc.number}; applicability at ${x.plant} needs confirmation.` : 'Checked the catalogue and contract coverage.' },
    { agent: 'outreach', label: L.outreach, status: 'completed', text: `Identified ${n} suppliers and prepared RFQ invitations by email, WhatsApp and a response link.` },
    { agent: 'followup', label: L.followup, status: s >= 7 ? 'completed' : s >= 4 ? 'completed' : 'monitoring', text: s === 0 ? `Tracking ${n} supplier responses; reminders are scheduled.` : s === 1 ? `Reminder sent to ${x.suppliers[1]?.name}; ${n - responded} responses outstanding.` : s >= 4 ? 'Reminder sequence finished.' : `Reminder sequence for ${x.suppliers[1]?.name} exhausted; escalation raised for a person.` },
    { agent: 'quotation', label: L.quotation, status: s === 0 ? 'waiting' : s >= 2 ? 'completed' : 'in_progress', text: s === 0 ? 'Waiting for the first quotation.' : s === 1 ? 'Processed 1 quotation; 2 pending.' : `Processed ${responded} quotations; flagged an alternative product and a missing validity.` },
    { agent: 'comparison', label: L.comparison, status: s >= 3 ? 'completed' : 'waiting', text: s >= 3 ? 'Prepared the commercial comparison for human review.' : s === 2 ? 'Waiting for the technical decision before comparing.' : 'Will compare when enough responses are in.' },
    { agent: 'coordination', label: L.coordination, status: s >= 7 ? 'completed' : openBlocking ? 'blocked' : 'monitoring', text: s >= 7 ? 'Requirement closed.' : openBlocking ? `Paused: ${openBlocking}` : s >= 4 ? 'Tracking SAP approval and the order.' : 'Tracking the requirement and keeping you informed.' }];
}

@Controller()
export class AgenticController {
  constructor(private db: Db) {}

  private async visible(c: any, ctx: Ctx, rid: string) {
    const r = (await c.query(`SELECT r.*, n.name AS plant_name, u.name AS requester_name FROM requirements r JOIN org_nodes n ON n.id=r.plant_node_id JOIN users u ON u.id=r.requester_id WHERE r.id=$1`, [rid])).rows[0];
    if (!r) throw new NotFoundException();
    if (r.requester_id !== ctx.userId && !(await canAtNode(c, ctx, 'buying:read', r.plant_node_id))) throw new NotFoundException();
    return r;
  }

  /** The requirement workspace: stage, agents, supplier threads, comparison, tasks, timeline — one coherent read. */
  @Perm('catalogue:read')
  @Get('requirements/:id/workspace')
  workspace(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isId(id)) throw new NotFoundException();
    return this.db.tx(ctx, async (c) => {
      const r = await this.visible(c, ctx, id);
      const run = (await c.query(`SELECT * FROM agentic_runs WHERE requirement_id=$1`, [id])).rows[0] ?? { kind: 'arc', step: 0, stage: 'approval', context: {} };
      const x: RunCtx = run.context;
      const created = new Date(r.created_at).getTime(); const at = (off: number) => new Date(created + off * 60000).toISOString();
      const evs = (await c.query(`SELECT id, offset_min AS off, agent, kind, channel, supplier_name AS supplier, title, detail, payload, scheduled, simulated FROM agent_events WHERE requirement_id=$1 ORDER BY offset_min, id`, [id])).rows;
      const lines = (await c.query(`SELECT rl.id, rl.qty, rl.uom, rl.route, rl.intent, rl.note, i.id AS "itemId", i.name AS item FROM requirement_lines rl JOIN catalogue_items i ON i.id=rl.item_id WHERE rl.requirement_id=$1 ORDER BY rl.line_no`, [id])).rows;
      const streams = (await c.query(`SELECT st.id, st.status, s.legal_name AS supplier FROM streams st LEFT JOIN suppliers s ON s.id=st.supplier_id WHERE requirement_id=$1`, [id])).rows;
      let timeline: any[] = evs.filter((e: any) => !e.scheduled).map((e: any) => ({ ...e, at: at(e.off) }));
      if (run.kind === 'arc') {
        const oe = (await c.query(`SELECT kind, simulated, at FROM order_events WHERE requirement_id=$1 AND kind <> 'requirement_submitted' ORDER BY id`, [id])).rows;
        const T: Record<string, string> = { pr_requested: 'Requisition sent to SAP', pr_created: 'Requisition created in SAP', po_released: 'Purchase order released in SAP', acknowledged: 'Supplier confirmed the order', dispatched: 'Supplier dispatched the goods', grn_partial: 'Goods partly received', grn_posted: 'Goods received', invoiced: 'Supplier invoiced', paid: 'Payment made', follow_up: 'Follow-up Agent reminded the supplier', supplier_rejected: 'Supplier declined the order', awarded: 'Awarded after quotations' };
        if (!timeline.length) timeline.push({ id: -1, off: 0, agent: 'human', kind: 'requirement_submitted', channel: 'system', title: `Requirement ${r.number} submitted by ${r.requester_name}`, at: r.created_at, simulated: false }, { id: -2, off: 1, agent: 'discovery', kind: 'discovery_done', channel: 'system', title: 'Discovery Agent matched the requirement to contract supply', at: at(1), simulated: true });
        for (const e of oe) timeline.push({ id: `o${e.at}`, off: Math.round((new Date(e.at).getTime() - created) / 60000), agent: ['follow_up'].includes(e.kind) ? 'followup' : /^(pr_|po_)/.test(e.kind) ? 'system' : ['acknowledged', 'dispatched', 'supplier_rejected'].includes(e.kind) ? 'supplier' : 'coordination', kind: e.kind, channel: /^(pr_|po_|grn|invoiced|paid)/.test(e.kind) ? 'sap' : 'system', title: T[e.kind] ?? e.kind.replace(/_/g, ' '), at: e.at, simulated: e.simulated });
        timeline.sort((a, b) => a.off - b.off);
      }
      // suppliers: fold the events into one thread per supplier
      const threads: any[] = []; const sups: string[] = [...new Set(evs.filter((e: any) => e.supplier && ['rfq_sent', 'quote_received', 'reminder_sent', 'link_opened', 'call_no_answer', 'supplier_added'].includes(e.kind)).map((e: any) => e.supplier as string))];
      const nowOff = Math.max(0, ...timeline.map((e) => e.off));
      for (const name of sups) {
        const mine = evs.filter((e: any) => e.supplier === name); const live = mine.filter((e: any) => !e.scheduled);
        const quoted = live.some((e: any) => e.kind === 'quote_received'); const opened = live.some((e: any) => e.kind === 'link_opened');
        const reminders = live.filter((e: any) => ['reminder_sent', 'call_no_answer'].includes(e.kind));
        const ext = live.find((e: any) => e.kind === 'quote_extracted'); const next = mine.find((e: any) => e.scheduled); const lastContact = live.filter((e: any) => !['quote_received', 'link_opened'].includes(e.kind)).at(-1);
        const exh = live.some((e: any) => e.kind === 'call_no_answer');
        threads.push({ supplier: name, status: quoted ? 'quoted' : exh ? 'unresponsive' : opened ? 'opened' : reminders.length ? 'reminded' : 'invited',
          label: quoted ? 'Quotation received and processed' : exh ? 'No response after follow-ups' : opened ? 'Opened the response link — quotation not yet submitted' : reminders.length ? 'No response — reminder sent, awaiting reply' : 'Invitation sent, awaiting response',
          channels: [...new Set(live.map((e: any) => e.channel).filter((ch: string) => ch && ch !== 'system'))], quote: ext?.payload?.quote ?? null, extractedNote: ext?.detail ?? null,
          lastContactAt: lastContact ? at(lastContact.off) : null, waitingMinutes: quoted ? null : nowOff - (live[0]?.off ?? 0), next: next ? { at: at(next.off), title: next.title, channel: next.channel } : null,
          history: live.map((e: any) => ({ id: e.id, at: at(e.off), off: e.off, agent: e.agent, kind: e.kind, channel: e.channel, title: e.title, detail: e.detail, preview: e.payload?.preview ?? null, simulated: e.simulated })) });
      }
      const responded = threads.filter((t) => t.status === 'quoted').length;
      const tasks = (await c.query(`SELECT id, kind, title, reason, owner_role AS "ownerRole", required_perm AS perm, priority, status, blocking, consequence, related, actions, offset_min AS off, resolution, resolved_at AS "resolvedAt" FROM human_tasks WHERE requirement_id=$1 ORDER BY created_at, id`, [id])).rows
        .map((t: any) => ({ ...t, raisedAt: at(t.off), canAct: hasPerm(ctx, t.perm), actions: (t.actions as any[]).map((a) => ({ ...a, allowed: !a.perm || hasPerm(ctx, a.perm) })) }));
      const openBlocking = tasks.find((t: any) => t.blocking && t.status !== 'done')?.title ?? null;
      // stage track
      let stage = run.stage as string;
      if (run.kind === 'arc') { const st = streams.map((s: any) => s.status); stage = st.length && st.every((s: string) => ['paid', 'closed'].includes(s)) ? 'complete' : st.some((s: string) => ['po_released', 'acknowledged', 'partially_dispatched', 'dispatched', 'partially_received', 'grn_posted', 'invoiced', 'delivered'].includes(s)) ? 'fulfilment' : 'approval'; }
      const idx = stage === 'complete' ? 5 : STAGES.findIndex((s) => s[0] === stage);
      const stages = STAGES.map(([key, label], i) => ({ key, label, state: i < idx ? 'done' : i === idx ? 'current' : 'upcoming', skipped: run.kind === 'arc' && (key === 'coordination' || key === 'evaluation') }));
      // comparison
      let comparison: any = null;
      if (run.kind === 'sourcing' && run.step >= 3 && x.suppliers?.length) {
        const rows = threads.filter((t) => t.quote).map((t) => { const q = t.quote; const excluded = q.alternative && x.technical === 'rejected'; return { supplier: t.supplier, ...q, total: q.unitPrice * q.qty, totalWithGst: Math.round(q.unitPrice * q.qty * (1 + q.gstPct / 100)), excluded, selected: x.selected === t.supplier }; });
        const live = rows.filter((r) => !r.excluded); const low = live.length ? Math.min(...live.map((r) => r.total)) : null;
        comparison = { qty: x.qty, uom: x.uom, requested: x.item, rows: rows.map((r) => ({ ...r, lowest: r.total === low && !r.excluded })), pending: threads.filter((t) => !t.quote).map((t) => ({ supplier: t.supplier, label: t.label })), note: 'Lowest price is highlighted for information. The award is a human decision; nothing is chosen automatically.' };
      }
      // waiting panel
      const last = [...timeline].reverse().find((e) => e.agent === 'followup' || e.agent === 'supplier');
      const nextFollow = evs.filter((e: any) => e.scheduled).sort((a: any, b: any) => a.off - b.off)[0];
      const waiting = run.kind === 'sourcing' && run.step <= 2 && threads.length ? { responded, total: threads.length, pending: threads.filter((t) => t.status !== 'quoted').map((t) => t.supplier), sinceMinutes: nowOff - (evs.find((e: any) => e.kind === 'rfq_sent')?.off ?? 0), lastFollowUpAt: last ? at(last.off) : null, nextFollowUp: nextFollow ? { at: at(nextFollow.off), title: nextFollow.title, channel: nextFollow.channel } : null, monitoring: true } : null;
      const sap = ['approval', 'fulfilment', 'complete'].includes(stage) ? { pr: x.prNumber ?? null, po: x.poNumber ?? null, note: 'Approval, release and PO creation happen in SAP. MonoSource tracks the outcome and does not approve anything itself.' } : null;
      const next = run.kind === 'arc' ? (stage === 'approval' ? 'Waiting for the requisition to be approved and the order released in SAP.' : stage === 'fulfilment' ? 'The supplier is delivering. The Follow-up Agent is tracking dispatch.' : 'Complete.')
        : openBlocking ? `A person needs to act: ${openBlocking}` : run.step <= 2 ? 'Waiting for supplier responses; the Follow-up Agent is monitoring.' : run.step === 4 ? 'Waiting for approval in SAP.' : run.step < 7 ? 'Tracking the order.' : 'Complete.';
      return { id, number: r.number, plant: r.plant_name, requester: r.requester_name, createdAt: r.created_at, kind: run.kind, step: run.step, stage, stages, lines, streams, next, demoCanAdvance: run.kind === 'sourcing' && run.step < 7, simulatedNote: 'Agent activity, supplier messages and SAP events on this page are an illustrative simulation. No real messages were sent.',
        agents: agentCards(run.kind, run.step, x, openBlocking, responded, threads.length), threads, timeline, tasks, comparison, waiting, sap };
    });
  }

  /** Demo control: move the scripted scenario forward one step. Human decisions still gate it. */
  @Perm('catalogue:read')
  @Post('requirements/:id/demo/advance')
  advance(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    if (!isId(id)) throw new NotFoundException();
    return this.db.tx(ctx, async (c) => {
      const demo = (await c.query(`SELECT coalesce((config->>'demo')::boolean,false) AS d FROM tenants WHERE id=$1`, [ctx.tenantId])).rows[0]?.d;
      if (!demo && !hasPerm(ctx, 'integration:simulate')) throw new BadRequestException('The demo timeline control is only available in demo environments');
      await this.visible(c, ctx, id);
      try { const label = await advance(c, ctx, id); return { ok: true, label }; } catch (e: any) { throw new ConflictException(e.message); }
    });
  }

  @Perm('catalogue:read')
  @Post('tasks/:id/resolve')
  resolve(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body() b: ResolveTaskDto) {
    if (!isId(id)) throw new NotFoundException();
    return this.db.tx(ctx, async (c) => {
      const t = (await c.query(`SELECT * FROM human_tasks WHERE id=$1 FOR UPDATE`, [id])).rows[0]; if (!t) throw new NotFoundException();
      if (!hasPerm(ctx, t.required_perm)) throw new BadRequestException(`This decision belongs to ${t.owner_role}`);
      if (t.status === 'done') throw new ConflictException('Already decided');
      const me = (await c.query(`SELECT name FROM users WHERE id=$1`, [ctx.userId])).rows[0].name;
      try { await resolveTask(c, ctx, t, b, me, (p) => hasPerm(ctx, p)); } catch (e: any) { throw new BadRequestException(e.message); }
      await audit(c, ctx, 'task.resolved', 'human_task', id, { kind: t.kind, ...b }); return { ok: true };
    });
  }

  /** "Needs me / Waiting for others / Agents working / Completed recently" for the current user. */
  @Perm('catalogue:read')
  @Get('tasks')
  tasks(@CurrentCtx() ctx: Ctx) {
    return this.db.tx(ctx, async (c) => {
      const vis = await visibleNodeIds(c, ctx, 'buying:read'); const all = vis === null;
      const rows = (await c.query(`SELECT t.id, t.kind, t.title, t.reason, t.owner_role AS "ownerRole", t.required_perm AS perm, t.priority, t.status, t.blocking, t.consequence, t.actions, t.related, t.requirement_id AS "requirementId", r.number, r.requester_id AS "requesterId", n.name AS plant, t.offset_min AS off, r.created_at AS "reqCreated", t.resolved_at AS "resolvedAt"
          FROM human_tasks t JOIN requirements r ON r.id=t.requirement_id JOIN org_nodes n ON n.id=r.plant_node_id
         WHERE r.requester_id=$1 OR $2 OR r.plant_node_id = ANY($3::uuid[]) ORDER BY t.created_at DESC LIMIT 200`, [ctx.userId, all, vis ?? []])).rows
        .map((t: any) => ({ ...t, raisedAt: new Date(new Date(t.reqCreated).getTime() + t.off * 60000).toISOString(), canAct: hasPerm(ctx, t.perm), actions: (t.actions as any[]).map((a) => ({ ...a, allowed: !a.perm || hasPerm(ctx, a.perm) })) }));
      const needsMe = rows.filter((t: any) => t.status === 'open' && t.canAct);
      const waitingTasks = rows.filter((t: any) => t.status !== 'done' && !(t.status === 'open' && t.canAct));
      const runs = (await c.query(`SELECT a.requirement_id AS "requirementId", a.kind, a.step, a.stage, r.number, n.name AS plant, a.context FROM agentic_runs a JOIN requirements r ON r.id=a.requirement_id JOIN org_nodes n ON n.id=r.plant_node_id
         WHERE (r.requester_id=$1 OR $2 OR r.plant_node_id = ANY($3::uuid[])) AND a.stage <> 'complete' ORDER BY a.updated_at DESC LIMIT 50`, [ctx.userId, all, vis ?? []])).rows;
      const working = runs.filter((a: any) => a.kind === 'sourcing' && a.step < 7).map((a: any) => ({ requirementId: a.requirementId, number: a.number, plant: a.plant, stage: a.stage, activity: a.step === 0 || a.step === 1 ? 'Follow-up Agent is monitoring supplier responses' : a.step === 2 ? 'Quotation Processing Agent is processing responses' : a.step === 3 ? 'Comparison prepared; waiting on a person' : a.step === 4 ? 'Coordination Agent is tracking SAP approval' : 'Coordination Agent is tracking the order' }));
      const recent = (await c.query(`SELECT a.requirement_id AS "requirementId", r.number, a.updated_at AS at FROM agentic_runs a JOIN requirements r ON r.id=a.requirement_id WHERE a.stage='complete' AND (r.requester_id=$1 OR $2 OR r.plant_node_id = ANY($3::uuid[])) ORDER BY a.updated_at DESC LIMIT 10`, [ctx.userId, all, vis ?? []])).rows;
      return { needsMe, waiting: waitingTasks, working, recent, resolved: rows.filter((t: any) => t.status === 'done').slice(0, 10), counts: { needsMe: needsMe.length } };
    });
  }

  // ───────── notifications (what happened) — separate from tasks (what must be done) ─────────
  @Perm('catalogue:read')
  @Get('notifications')
  notifications(@CurrentCtx() ctx: Ctx, @Query('limit') limit?: string) {
    return this.db.tx(ctx, async (c) => {
      const rows = (await c.query(`SELECT n.id, n.category, n.title, n.body, n.href, n.requirement_id AS "requirementId", n.simulated, n.read_at IS NOT NULL AS read, n.created_at AS at, r.number FROM notifications n LEFT JOIN requirements r ON r.id=n.requirement_id WHERE n.user_id=$1 ORDER BY n.created_at DESC, n.id LIMIT $2`, [ctx.userId, Math.min(Number(limit) || 30, 100)])).rows;
      const prefs = { ...DEFAULT_PREFS, ...((await c.query(`SELECT prefs FROM notification_prefs WHERE user_id=$1`, [ctx.userId])).rows[0]?.prefs ?? {}) };
      return { unread: rows.filter((r: any) => !r.read).length, items: rows.map((r: any) => ({ ...r, email: { subject: r.title, body: `${r.body ?? ''}\n\nOpen the requirement: ${r.href ?? ''}\n\n— MonoSource (illustrative email preview, not sent)` }, whatsapp: `${r.title}${r.body ? ' — ' + r.body : ''} (illustrative preview, not sent)` })), prefs };
    });
  }

  @Perm('catalogue:read')
  @Post('notifications/read')
  read(@CurrentCtx() ctx: Ctx, @Body() b: ReadDto) {
    return this.db.tx(ctx, async (c) => { await c.query(`UPDATE notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL AND ($2 OR id = ANY($3::uuid[]))`, [ctx.userId, !!b.all, b.ids ?? []]); return { ok: true }; });
  }

  @Perm('catalogue:read')
  @Put('notification-prefs')
  setPrefs(@CurrentCtx() ctx: Ctx, @Body() b: PrefsDto) {
    const allowed = Object.keys(DEFAULT_PREFS); const clean: Record<string, boolean> = {}; for (const k of allowed) if (typeof b.prefs[k] === 'boolean') clean[k] = b.prefs[k];
    return this.db.tx(ctx, async (c) => { await c.query(`INSERT INTO notification_prefs(user_id,tenant_id,prefs) VALUES ($1,$2,$3) ON CONFLICT (user_id) DO UPDATE SET prefs=$3`, [ctx.userId, ctx.tenantId, JSON.stringify(clean)]); return { ok: true, prefs: { ...DEFAULT_PREFS, ...clean } }; });
  }
}
void quoteFor; void IsIn;
