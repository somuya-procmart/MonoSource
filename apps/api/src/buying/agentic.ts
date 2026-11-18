/**
 * Agentic procurement — DETERMINISTIC DEMO SIMULATION.
 * Nothing here is a real agent, a real message, a real supplier or a real SAP transaction. A requirement carries a scripted
 * lifecycle (`agentic_runs.step`); each step writes labelled `agent_events`, human tasks and notifications. Humans (via
 * human_tasks) gate the steps that need judgement or authority; SAP approval and PO creation are shown as SAP-side events.
 */
import { PoolClient } from 'pg';
import { Ctx } from '../common/security';
import { computeSources } from '../catalogue/source';

export type Agent = 'discovery' | 'outreach' | 'followup' | 'quotation' | 'comparison' | 'coordination';
export const AGENT_LABEL: Record<Agent, string> = { discovery: 'Discovery Agent', outreach: 'Supplier Outreach Agent', followup: 'Follow-up Agent', quotation: 'Quotation Processing Agent', comparison: 'Comparison Agent', coordination: 'Procurement Coordination Agent' };
export const NOTIF_PREF_KEY: Record<string, string> = { milestone: 'milestones', human: 'human', supplier: 'supplier', delay: 'delays', complete: 'completion' };
export const DEFAULT_PREFS = { milestones: true, human: true, supplier: true, delays: true, completion: true, email: true, whatsapp: false };

const DAY = 1440;
export interface Sup { id: string | null; name: string; key: string }
export interface RunCtx {
  number: string; plantId: string; plant: string; requester: string; requesterId: string;
  item: string; itemId: string; brand: string | null; qty: number; uom: string; unitRef: number;
  arc: { id: string; number: string; supplier: string; plants: string[] } | null; alt: string;
  suppliers: Sup[]; selected?: string; technical?: 'accepted' | 'rejected'; poNumber?: string; prNumber?: string;
}
type EvOpts = { channel?: 'email' | 'whatsapp' | 'magic_link' | 'phone' | 'system' | 'sap'; supplier?: string; detail?: string; payload?: any; scheduled?: boolean };

export async function ev(c: PoolClient, ctx: Ctx, reqId: string, off: number, agent: Agent | 'human' | 'supplier' | 'system', kind: string, title: string, o: EvOpts = {}) {
  await c.query(`INSERT INTO agent_events(tenant_id,requirement_id,offset_min,agent,kind,channel,supplier_name,title,detail,payload,scheduled) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [ctx.tenantId, reqId, off, agent, kind, o.channel ?? 'system', o.supplier ?? null, title, o.detail ?? null, JSON.stringify(o.payload ?? {}), o.scheduled ?? false]);
}
const unschedule = (c: PoolClient, reqId: string, supplier: string) => c.query(`DELETE FROM agent_events WHERE requirement_id=$1 AND supplier_name=$2 AND scheduled`, [reqId, supplier]);

export async function notify(c: PoolClient, ctx: Ctx, userId: string, reqId: string, category: 'milestone' | 'human' | 'supplier' | 'delay' | 'complete', title: string, body: string) {
  const p = (await c.query(`SELECT prefs FROM notification_prefs WHERE user_id=$1`, [userId])).rows[0]?.prefs ?? {};
  if (({ ...DEFAULT_PREFS, ...p } as any)[NOTIF_PREF_KEY[category]] === false) return;
  await c.query(`INSERT INTO notifications(tenant_id,user_id,category,title,body,href,requirement_id) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [ctx.tenantId, userId, category, title, body, `/requirements/${reqId}${category === 'human' ? '#needs-action' : ''}`, reqId]);
}
async function task(c: PoolClient, ctx: Ctx, reqId: string, t: { kind: string; title: string; reason: string; ownerRole: string; perm: string; priority?: 'normal' | 'high'; blocking?: boolean; consequence?: string; related: any; actions: any[]; off: number }) {
  await c.query(`INSERT INTO human_tasks(tenant_id,requirement_id,kind,title,reason,owner_role,required_perm,priority,blocking,consequence,related,actions,offset_min) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [ctx.tenantId, reqId, t.kind, t.title, t.reason, t.ownerRole, t.perm, t.priority ?? 'normal', t.blocking ?? false, t.consequence ?? null, JSON.stringify(t.related), JSON.stringify(t.actions), t.off]);
}
const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
export const quoteFor = (x: RunCtx, key: 'A' | 'C') => key === 'A'
  ? { product: `${x.item}${x.brand ? ` (${x.brand})` : ''}`, unitPrice: Math.round(x.unitRef * 1.06), qty: x.qty, uom: x.uom, gstPct: 18, validityDays: 30, deliveryDays: 12, terms: 'Net 45 days', alternative: false, flags: [] as string[] }
  : { product: x.alt, unitPrice: Math.round(x.unitRef * 0.96), qty: x.qty, uom: x.uom, gstPct: 18, validityDays: null as number | null, deliveryDays: 8, terms: 'Net 30 days', alternative: true, flags: ['Alternative product proposed', 'Quotation validity not stated'] };

const mail = (x: RunCtx, s: Sup) => ({ to: s.name, from: 'rfq@monosource.example (illustrative)', subject: `Request for quotation — ${x.qty} ${x.uom} ${x.item} (${x.number})`, body: `Dear ${s.name},\n\nPlease quote for ${x.qty} ${x.uom} of ${x.item} for delivery to ${x.plant}. Kindly state unit price, taxes, validity and delivery time.\n\nRegards,\nMonoSource on behalf of the buyer` });
const wa = (x: RunCtx, s: Sup) => ({ to: s.name, text: `Hello ${s.name}, we sent an RFQ for ${x.qty} ${x.uom} ${x.item} (${x.number}). Could you share your quotation? You can reply here or use this secure link: https://respond.monosource.example/r/${x.number.toLowerCase()}-${s.key.toLowerCase()} (illustrative)` });

export async function buildContext(c: PoolClient, reqId: string): Promise<RunCtx> {
  const r = (await c.query(`SELECT r.number, r.plant_node_id, r.requester_id, n.name AS plant, u.name AS requester FROM requirements r JOIN org_nodes n ON n.id=r.plant_node_id JOIN users u ON u.id=r.requester_id WHERE r.id=$1`, [reqId])).rows[0];
  const l = (await c.query(`SELECT rl.item_id, rl.qty, rl.uom, i.name, i.brand FROM requirement_lines rl JOIN catalogue_items i ON i.id=rl.item_id WHERE rl.requirement_id=$1 ORDER BY (rl.route='sourcing') DESC, rl.line_no LIMIT 1`, [reqId])).rows[0];
  const src = (await computeSources(c, [l.item_id], r.plant_node_id)).get(l.item_id);
  const el = src?.elsewhere?.[0] ?? src?.supplies?.[0] ?? null;
  const price = (await c.query(`SELECT min(cl.net_price)::float AS p FROM contract_lines cl JOIN contracts ct ON ct.id=cl.contract_id WHERE cl.item_id=$1 AND cl.status='published' AND ct.status='published'`, [l.item_id])).rows[0]?.p ?? null;
  const sups = (await c.query(
    `SELECT s.id, s.legal_name FROM suppliers s WHERE s.legal_name !~* 'procmart' ORDER BY
       (EXISTS (SELECT 1 FROM contract_lines cl JOIN contracts ct ON ct.id=cl.contract_id WHERE ct.supplier_id=s.id AND cl.item_id=$1)) DESC,
       (EXISTS (SELECT 1 FROM contract_lines cl JOIN contracts ct ON ct.id=cl.contract_id JOIN catalogue_items ci ON ci.id=cl.item_id WHERE ct.supplier_id=s.id AND ci.category = (SELECT category FROM catalogue_items WHERE id=$1))) DESC,
       (s.legal_name ILIKE '%' || left((SELECT category FROM catalogue_items WHERE id=$1), 5) || '%') DESC, s.legal_name LIMIT 3`, [l.item_id])).rows;
  const alt = (await c.query(`SELECT i.name FROM item_alternatives a JOIN catalogue_items i ON i.id=a.alternative_item_id WHERE a.item_id=$1 ORDER BY i.name LIMIT 1`, [l.item_id])).rows[0]?.name
    ?? (await c.query(`SELECT i.name FROM catalogue_items i WHERE i.category = (SELECT category FROM catalogue_items WHERE id=$1) AND i.id <> $1 AND i.status='active' ORDER BY (i.specs->>'bore' IS NOT DISTINCT FROM (SELECT specs->>'bore' FROM catalogue_items WHERE id=$1)) DESC, i.name LIMIT 1`, [l.item_id])).rows[0]?.name;
  return {
    number: r.number, plantId: r.plant_node_id, plant: r.plant, requester: r.requester, requesterId: r.requester_id, item: l.name, itemId: l.item_id, brand: l.brand, qty: Number(l.qty), uom: l.uom ?? 'EA', unitRef: price ?? 480,
    arc: el && src?.case === 'B' /* never: ARCs are group-level */ ? { id: el.contractId, number: el.number, supplier: el.supplier, plants: el.appliesTo ?? [] } : null,
    alt: alt ? `${alt} (supplier’s proposed equivalent)` : `Equivalent make of ${l.name} (supplier’s own part number)`,
    // ProcMart instant procurement reaches its own vendor network too: a customer with fewer than three known
    // suppliers still gets three quotes (illustrative network vendors), so every non-ARC line can be sourced.
    suppliers: [...sups, ...['ProcMart network vendor 1', 'ProcMart network vendor 2', 'ProcMart network vendor 3'].map((n) => ({ id: null, legal_name: n }))]
      .slice(0, 3).map((s: any, i: number) => ({ id: s.id, name: s.legal_name, key: 'ABCDE'[i] })),
  };
}

/** Called when a requirement is submitted. Sourcing lines (or lines needing applicability confirmation) get the full agent script; ARC/direct only get a light one. */
export async function startRun(c: PoolClient, ctx: Ctx, reqId: string) {
  const sourcing = (await c.query(`SELECT 1 FROM requirement_lines WHERE requirement_id=$1 AND route='sourcing'`, [reqId])).rowCount! > 0; // an ARC line always goes to its ARC, whatever the buyer asked
  const x = await buildContext(c, reqId);
  await c.query(`INSERT INTO agentic_runs(requirement_id,tenant_id,kind,step,stage,context) VALUES ($1,$2,$3,0,$4,$5)`, [reqId, ctx.tenantId, sourcing ? 'sourcing' : 'arc', sourcing ? 'coordination' : 'approval', JSON.stringify(x)]);
  await ev(c, ctx, reqId, 0, 'human', 'requirement_submitted', `Requirement ${x.number} submitted by ${x.requester}`, { detail: `${x.qty} ${x.uom} · ${x.item} · ${x.plant}` });
  const n = (await c.query(`SELECT count(*)::int n FROM requirement_lines WHERE requirement_id=$1`, [reqId])).rows[0].n;
  await notify(c, ctx, ctx.userId, reqId, 'milestone', `${x.number} has been submitted`, 'MonoSource is checking the available sources of supply.');
  if (!sourcing) {
    await ev(c, ctx, reqId, 1, 'discovery', 'discovery_done', `Discovery Agent matched ${n} line${n === 1 ? '' : 's'} to contract supply`, { detail: 'Prices come from the applicable ARC or ProcMart list. No supplier outreach is needed.' });
    await ev(c, ctx, reqId, 2, 'coordination', 'requisition_sent', 'Requisition sent to SAP for approval', { channel: 'sap', detail: 'Approval and release happen in SAP, not in MonoSource.' });
    return;
  }
  await ev(c, ctx, reqId, 1, 'discovery', 'discovery_done', `Discovery Agent checked the catalogue and contract coverage for ${x.plant}`,
    { detail: x.arc ? `Found the group ARC ${x.arc.number} (${x.arc.supplier}) for ${x.arc.plants.join(', ') || 'other plants'}. Applicability at ${x.plant} is not established, so a person must confirm it.` : 'No group contract covers this item, so ProcMart collects quotations.' });
  await ev(c, ctx, reqId, 5, 'coordination', 'review_skipped', 'Human review was not required for the initial supplier shortlist');
  await ev(c, ctx, reqId, 45, 'outreach', 'suppliers_identified', `Supplier Outreach Agent identified ${x.suppliers.length} relevant suppliers`, { detail: x.suppliers.map((s) => s.name).join(' · ') });
  const [A, B, C] = x.suppliers;
  await ev(c, ctx, reqId, 60, 'outreach', 'rfq_sent', `RFQ invitation prepared for ${A.name}`, { channel: 'email', supplier: A.name, payload: { preview: mail(x, A) } });
  await ev(c, ctx, reqId, 62, 'outreach', 'rfq_sent', `RFQ invitation prepared for ${B.name}`, { channel: 'email', supplier: B.name, payload: { preview: mail(x, B) } });
  await ev(c, ctx, reqId, 65, 'outreach', 'rfq_sent', `RFQ invitation with a response link prepared for ${C.name}`, { channel: 'whatsapp', supplier: C.name, payload: { preview: wa(x, C) } });
  await ev(c, ctx, reqId, DAY + 240, 'followup', 'followup_scheduled', `Reminder planned for ${B.name}`, { channel: 'whatsapp', supplier: B.name, scheduled: true, detail: 'Planned if there is still no response.' });
  await ev(c, ctx, reqId, DAY + 600, 'followup', 'followup_scheduled', `Reminder planned for ${C.name}`, { channel: 'email', supplier: C.name, scheduled: true });
  if (x.arc) await task(c, ctx, reqId, { kind: 'arc_applicability', title: `Confirm whether ${x.arc.number} can be used at ${x.plant}`, reason: `A group ARC for this item exists (${x.arc.supplier}, covering ${x.arc.plants.join(', ') || 'other plants'}), but it has not been extended to ${x.plant}.`, ownerRole: 'Central procurement (contract owner)', perm: 'contracts:write', priority: 'normal', consequence: 'Sourcing continues in parallel. If nobody confirms, quotations are compared without the contract price as a benchmark.', related: { contractId: x.arc.id, contract: x.arc.number, plant: x.plant, item: x.item }, off: 10,
    actions: [{ key: 'confirm_applicable', label: `Confirm it applies at ${x.plant}`, primary: true, perm: 'contracts:approve' }, { key: 'request_review', label: 'Request contract applicability review' }, { key: 'view_contract', label: 'View contract details', href: `/contracts/${x.arc.id}` }] });
  await notify(c, ctx, ctx.userId, reqId, 'milestone', `${x.suppliers.length} suppliers identified for ${x.number}`, 'The Supplier Outreach Agent is contacting them. You can leave — we will tell you when something needs you.');
  await c.query(`UPDATE agentic_runs SET context=$2 WHERE requirement_id=$1`, [reqId, JSON.stringify(x)]);
}

const lastOff = async (c: PoolClient, reqId: string) => (await c.query(`SELECT coalesce(max(offset_min),0)::int m FROM agent_events WHERE requirement_id=$1 AND NOT scheduled`, [reqId])).rows[0].m as number;

/** One scripted step. Returns a short label of what happened. Throws a string-message Error when a human decision is blocking. */
export async function advance(c: PoolClient, ctx: Ctx, reqId: string): Promise<string> {
  const run = (await c.query(`SELECT * FROM agentic_runs WHERE requirement_id=$1 FOR UPDATE`, [reqId])).rows[0];
  if (!run) throw new Error('This requirement has no agent run');
  const x: RunCtx = run.context; const step: number = run.step; const set = (stage: string, ns: number) => c.query(`UPDATE agentic_runs SET step=$2, stage=$3, context=$4, updated_at=now() WHERE requirement_id=$1`, [reqId, ns, stage, JSON.stringify(x)]);
  const open = (await c.query(`SELECT title FROM human_tasks WHERE requirement_id=$1 AND blocking AND status IN ('open','waiting') ORDER BY created_at LIMIT 1`, [reqId])).rows[0];
  if (open) throw new Error(`Waiting for a human decision: ${open.title}`);
  const [A, B, C] = x.suppliers; const me = ctx.userId;
  if (run.kind === 'arc') {
    if (step >= 1) throw new Error('Order progress for contract lines follows the real order flow (see the orders below).');
    await set('approval', 1); return 'noop';
  }
  if (step === 0) {
    await c.query(`UPDATE requirements SET status='in_progress' WHERE id=$1 AND status IN ('submitted','routed')`, [reqId]); // keep the list status consistent with the agent run
    await unschedule(c, reqId, B.name);
    await ev(c, ctx, reqId, DAY + 20, 'supplier', 'link_opened', `${C.name} opened the response link`, { channel: 'magic_link', supplier: C.name });
    await ev(c, ctx, reqId, DAY + 45, 'supplier', 'quote_received', `${A.name} sent a quotation by email`, { channel: 'email', supplier: A.name, payload: { preview: { from: A.name, subject: `RE: Request for quotation — ${x.number}`, body: `We offer ${x.qty} ${x.uom} ${x.item} at ${inr(quoteFor(x, 'A').unitPrice)} per ${x.uom} + 18% GST. Delivery 12 days. Valid 30 days. Payment Net 45.` } } });
    await ev(c, ctx, reqId, DAY + 50, 'quotation', 'quote_extracted', `Quotation Processing Agent extracted ${A.name}’s quotation`, { supplier: A.name, payload: { quote: quoteFor(x, 'A') }, detail: 'Price, quantity, unit, tax, validity and delivery were all stated and match the request.' });
    await ev(c, ctx, reqId, DAY + 240, 'followup', 'reminder_sent', `Follow-up Agent sent a reminder to ${B.name}`, { channel: 'whatsapp', supplier: B.name, payload: { preview: wa(x, B) } });
    await ev(c, ctx, reqId, 2 * DAY + 300, 'followup', 'followup_scheduled', `Phone follow-up planned for ${B.name}`, { channel: 'phone', supplier: B.name, scheduled: true });
    await notify(c, ctx, x.requesterId, reqId, 'supplier', `${A.name} has submitted its quotation`, 'MonoSource has processed the response. Two suppliers are still to respond.');
    await notify(c, ctx, x.requesterId, reqId, 'supplier', `${B.name} has not responded yet`, 'The Follow-up Agent sent a reminder. Nothing is needed from you.');
    await set('coordination', 1); return 'Day 2: first quotation received, reminder sent';
  }
  if (step === 1) {
    const q = quoteFor(x, 'C'); await unschedule(c, reqId, C.name); await unschedule(c, reqId, B.name);
    await ev(c, ctx, reqId, 2 * DAY + 15, 'supplier', 'quote_received', `${C.name} submitted a quotation through the response link`, { channel: 'magic_link', supplier: C.name, detail: 'Quoted a different product from the one requested.' });
    await ev(c, ctx, reqId, 2 * DAY + 20, 'quotation', 'quote_extracted', `Quotation Processing Agent extracted ${C.name}’s quotation`, { supplier: C.name, payload: { quote: q }, detail: 'Flagged: alternative product proposed; validity not stated.' });
    await ev(c, ctx, reqId, 2 * DAY + 60, 'followup', 'call_no_answer', `Follow-up Agent phoned ${B.name}: no answer`, { channel: 'phone', supplier: B.name, detail: 'Reminder sequence for this supplier is now exhausted.' });
    await task(c, ctx, reqId, { kind: 'technical_clarification', title: `Is ${C.name}’s alternative bearing acceptable?`, reason: `${C.name} quoted “${q.product}” instead of “${x.item}”. A person with technical authority must confirm it can be used.`, ownerRole: 'Technical team', perm: 'buying:source', priority: 'high', blocking: true, consequence: `Until decided, ${C.name}’s price cannot be compared with the other quotations.`, related: { supplier: C.name, requested: x.item, proposed: q.product }, off: 2 * DAY + 25,
      actions: [{ key: 'accept', label: 'Accept alternative', primary: true }, { key: 'reject', label: 'Reject alternative' }, { key: 'request_info', label: 'Request additional information' }] });
    await task(c, ctx, reqId, { kind: 'supplier_exception', title: `${B.name} has not responded after the follow-up sequence`, reason: 'An email, a WhatsApp reminder and a phone call have gone unanswered.', ownerRole: 'Procurement team', perm: 'buying:source', priority: 'normal', consequence: 'The comparison goes ahead without this supplier.', related: { supplier: B.name }, off: 2 * DAY + 65,
      actions: [{ key: 'escalate', label: 'Escalate to procurement', primary: true }, { key: 'select_another', label: 'Select another supplier' }, { key: 'keep_waiting', label: 'Continue waiting' }] });
    await notify(c, ctx, x.requesterId, reqId, 'human', `Technical review required for ${x.number}`, `${C.name} proposed an alternative product. The Technical team has been asked to decide.`);
    await notify(c, ctx, x.requesterId, reqId, 'delay', `${x.number} is taking longer than expected`, `${B.name}’s response is still pending after reminders. Procurement has been alerted.`);
    await set('evaluation', 2); return 'Day 3: alternative proposed, technical review raised';
  }
  if (step === 3) throw new Error('Waiting for the commercial decision.');
  if (step === 4) {
    const base = await lastOff(c, reqId);
    await ev(c, ctx, reqId, base + 4 * 60, 'system', 'sap_approved', 'Requisition approved in SAP (simulated)', { channel: 'sap', detail: 'Approval happens in SAP by the authorised approver. MonoSource only records the outcome.' });
    x.poNumber = `PO-SIM-${x.number.slice(-6)}`; await ev(c, ctx, reqId, base + 5 * 60, 'system', 'po_created', `Purchase order ${x.poNumber} created in SAP (simulated)`, { channel: 'sap', supplier: x.selected });
    await notify(c, ctx, x.requesterId, reqId, 'milestone', `Purchase order created for ${x.number}`, `${x.poNumber} (simulated) has been created with ${x.selected}.`);
    await set('fulfilment', 5); return 'PO created';
  }
  if (step === 5) {
    const base = await lastOff(c, reqId);
    await ev(c, ctx, reqId, base + 120, 'supplier', 'order_confirmed', `${x.selected} confirmed the order`, { channel: 'email', supplier: x.selected });
    await ev(c, ctx, reqId, base + 3 * DAY, 'supplier', 'dispatched', `${x.selected} dispatched the goods`, { channel: 'whatsapp', supplier: x.selected, detail: 'Tracking details recorded by the Follow-up Agent.' });
    await notify(c, ctx, x.requesterId, reqId, 'milestone', `Your order for ${x.number} has been dispatched`, `${x.selected} has dispatched ${x.qty} ${x.uom}.`);
    await set('fulfilment', 6); return 'Dispatched';
  }
  if (step === 6) {
    const base = await lastOff(c, reqId);
    await ev(c, ctx, reqId, base + 2 * DAY, 'system', 'grn_posted', `Goods received at ${x.plant} (SAP goods receipt, simulated)`, { channel: 'sap' });
    await ev(c, ctx, reqId, base + 2 * DAY + 5, 'coordination', 'completed', `Procurement Coordination Agent closed ${x.number}`);
    await notify(c, ctx, x.requesterId, reqId, 'complete', `${x.number} has been fulfilled`, 'Goods were received at your plant.');
    await c.query(`UPDATE requirements SET status='closed' WHERE id=$1`, [reqId]);
    await set('complete', 7); return 'Completed';
  }
  void me; throw new Error('This requirement has reached the end of the scripted scenario.');
}

export type Resolve = { action: string; note?: string; supplier?: string };
/** A person's decision on a task. Records it, writes the timeline, and moves the scenario on when the task was blocking. */
export async function resolveTask(c: PoolClient, ctx: Ctx, t: any, b: Resolve, userName: string, hasPerm: (p: string) => boolean) {
  const run = (await c.query(`SELECT * FROM agentic_runs WHERE requirement_id=$1 FOR UPDATE`, [t.requirement_id])).rows[0]; const x: RunCtx = run.context;
  const act = (t.actions as any[]).find((a) => a.key === b.action); if (!act) throw new Error('Unknown action');
  if (act.perm && !hasPerm(act.perm)) throw new Error(`This action needs ${act.perm}`);
  const off = await lastOff(c, t.requirement_id) + 5; const note = b.note ? ` — “${b.note}”` : '';
  const done = (status: 'done' | 'waiting' = 'done') => c.query(`UPDATE human_tasks SET status=$2, resolution=$3, resolved_by=$4, resolved_at=now() WHERE id=$1`, [t.id, status, JSON.stringify(b), ctx.userId]);
  const setCtx = () => c.query(`UPDATE agentic_runs SET context=$2, updated_at=now() WHERE requirement_id=$1`, [t.requirement_id, JSON.stringify(x)]);
  const [, B, C] = x.suppliers; const rid = t.requirement_id;
  switch (`${t.kind}:${b.action}`) {
    case 'arc_applicability:confirm_applicable':
      await c.query(`INSERT INTO contract_scopes(tenant_id,contract_id,node_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [ctx.tenantId, t.related.contractId, x.plantId]);
      await ev(c, ctx, rid, off, 'human', 'applicability_confirmed', `${userName} confirmed ${t.related.contract} applies at ${x.plant}${note}`, { detail: 'The contract now shows as available to this plant.' }); await done(); break;
    case 'arc_applicability:request_review':
      await ev(c, ctx, rid, off, 'human', 'applicability_review_requested', `${userName} requested a contract applicability review for ${t.related.contract}${note}`, { detail: 'Sourcing continues in parallel.' }); await done('waiting'); break;
    case 'technical_clarification:accept': x.technical = 'accepted'; await ev(c, ctx, rid, off, 'human', 'technical_accepted', `${userName} (Technical team) accepted ${C.name}’s alternative${note}`); await done(); await setCtx(); await afterTechnical(c, ctx, rid, x); break;
    case 'technical_clarification:reject': x.technical = 'rejected'; await ev(c, ctx, rid, off, 'human', 'technical_rejected', `${userName} (Technical team) rejected ${C.name}’s alternative${note}`); await done(); await setCtx(); await afterTechnical(c, ctx, rid, x); break;
    case 'technical_clarification:request_info': await ev(c, ctx, rid, off, 'human', 'info_requested', `${userName} asked ${C.name} for datasheet and equivalence details${note}`, { supplier: C.name }); await ev(c, ctx, rid, off + 2, 'followup', 'followup_scheduled', `Follow-up Agent will chase ${C.name} for the details`, { supplier: C.name, channel: 'email', scheduled: true }); await done('waiting'); break;
    case 'supplier_exception:escalate': await ev(c, ctx, rid, off, 'human', 'escalated', `${userName} escalated ${B.name} to procurement management${note}`, { supplier: B.name }); await done(); break;
    case 'supplier_exception:keep_waiting': await ev(c, ctx, rid, off, 'human', 'keep_waiting', `${userName} chose to keep waiting for ${B.name}${note}`, { supplier: B.name }); await ev(c, ctx, rid, off + 1, 'followup', 'followup_scheduled', `Follow-up Agent will try ${B.name} again`, { supplier: B.name, channel: 'email', scheduled: true }); await done(); break;
    case 'supplier_exception:select_another': {
      const d = (await c.query(`SELECT id, legal_name FROM suppliers WHERE legal_name !~* 'procmart' AND id <> ALL($1::uuid[]) ORDER BY legal_name LIMIT 1`, [x.suppliers.map((s) => s.id).filter(Boolean)])).rows[0];
      if (d) { x.suppliers.push({ id: d.id, name: d.legal_name, key: 'D' }); await setCtx(); await ev(c, ctx, rid, off, 'human', 'supplier_added', `${userName} selected ${d.legal_name} as another supplier${note}`); await ev(c, ctx, rid, off + 3, 'outreach', 'rfq_sent', `RFQ invitation prepared for ${d.legal_name}`, { channel: 'email', supplier: d.legal_name, payload: { preview: mail(x, x.suppliers.at(-1)!) } }); }
      else await ev(c, ctx, rid, off, 'human', 'no_other_supplier', 'No other supplier is available to add'); await done(); break; }
    case 'commercial_review:request_clarification': await ev(c, ctx, rid, off, 'human', 'clarification_requested', `${userName} asked the suppliers to clarify commercial terms${note}`); await done('waiting'); break;
    case 'commercial_review:proceed': {
      const pick = b.supplier ?? x.suppliers[0].name; if (!x.suppliers.some((s) => s.name === pick)) throw new Error('Choose one of the quoted suppliers'); if (pick === C.name && x.technical !== 'accepted') throw new Error('That supplier’s alternative has not been accepted technically');
      x.selected = pick; x.prNumber = `PR-SIM-${x.number.slice(-6)}`; await done(); await setCtx();
      await ev(c, ctx, rid, off, 'human', 'commercial_decision', `${userName} approved proceeding with ${pick}${note}`, { detail: 'Commercial decision by an authorised person.', supplier: pick });
      await ev(c, ctx, rid, off + 10, 'coordination', 'requisition_sent', `Requisition ${x.prNumber} sent to SAP (simulated)`, { channel: 'sap', supplier: pick, detail: 'Approval and release now happen in SAP. MonoSource does not approve requisitions or purchase orders.' });
      await notify(c, ctx, x.requesterId, rid, 'milestone', `${x.number} is awaiting approval in SAP`, `Your purchase requisition ${x.prNumber} (simulated) is with the approver.`);
      await c.query(`UPDATE agentic_runs SET step=4, stage='approval', updated_at=now() WHERE requirement_id=$1`, [rid]); break; }
    default: throw new Error('That action is not available for this task');
  }
}

async function afterTechnical(c: PoolClient, ctx: Ctx, rid: string, x: RunCtx) {
  const base = await lastOff(c, rid) + 10; const [A, , C] = x.suppliers; const accepted = x.technical === 'accepted';
  await ev(c, ctx, rid, base, 'comparison', 'comparison_ready', `Comparison Agent prepared a commercial comparison of ${accepted ? 2 : 1} quotation${accepted ? 's' : ''}`, { detail: accepted ? `${A.name} and ${C.name} compared; ${x.suppliers[1].name} has not responded.` : `${C.name} excluded after technical rejection.` });
  await task(c, ctx, rid, { kind: 'commercial_review', title: 'Review the quotation comparison and decide how to proceed', reason: `${accepted ? 'Two quotations are' : 'One quotation is'} ready. An authorised person must make the commercial decision; MonoSource does not award on its own.`, ownerRole: 'Procurement lead (authorised approver)', perm: 'buying:approve', priority: 'high', blocking: true, consequence: 'The requirement stays on hold until a decision is recorded.', related: { suppliers: accepted ? [A.name, C.name] : [A.name] }, off: base + 5,
    actions: [{ key: 'proceed', label: 'Proceed to approval', primary: true }, { key: 'request_clarification', label: 'Request clarification' }] });
  await notify(c, ctx, x.requesterId, rid, 'human', `Quotations for ${x.number} are ready for review`, 'The comparison has been prepared. An authorised person will decide.');
  await c.query(`UPDATE agentic_runs SET step=3, stage='evaluation', updated_at=now() WHERE requirement_id=$1`, [rid]);
}
