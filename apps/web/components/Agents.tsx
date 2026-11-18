'use client';
import Link from 'next/link';
import { useState } from 'react';
import { Icon, IconName } from './Icon';
import { api } from '../lib/api';
import { useApp } from '../app/shell';
import { dmy, inr, plain } from '../lib/format';
import { useConfirm } from './Confirm';

/** Everything on these components is an illustrative simulation; each simulated event is labelled. */
export const AGENT_META: Record<string, { label: string; icon: IconName; doing: string }> = {
  discovery: { label: 'MonoSource', icon: 'sparkles', doing: 'searching catalogue' },
  outreach: { label: 'MonoSource', icon: 'sparkles', doing: 'contacting suppliers' },
  followup: { label: 'Follow-up', icon: 'refresh', doing: 'monitoring supplier responses' },
  quotation: { label: 'MonoSource', icon: 'sparkles', doing: 'extracting quotation details' },
  comparison: { label: 'MonoSource', icon: 'sparkles', doing: 'preparing comparison' },
  coordination: { label: 'MonoSource', icon: 'sparkles', doing: 'coordinating next steps' },
  human: { label: 'Person', icon: 'userCheck', doing: '' }, supplier: { label: 'Supplier', icon: 'building', doing: '' }, system: { label: 'System · SAP', icon: 'shield', doing: '' },
};
export const CHANNEL: Record<string, { label: string; icon: IconName }> = { email: { label: 'Email', icon: 'mail' }, whatsapp: { label: 'WhatsApp', icon: 'chat' }, magic_link: { label: 'Response link', icon: 'link' }, phone: { label: 'Phone call', icon: 'phone' }, sap: { label: 'SAP', icon: 'shield' }, system: { label: '', icon: 'info' } };
const STATUS_LABEL: Record<string, string> = { completed: 'Done', monitoring: 'Watching', in_progress: 'Working', waiting: 'Up next', blocked: 'Paused — needs a person', skipped: 'Not needed' };

export function AgentChip({ agent, live }: { agent: string; live?: boolean }) {
  const m = AGENT_META[agent] ?? AGENT_META.system; const cls = ['human', 'supplier', 'system'].includes(agent) ? agent : '';
  return <span className={`a-chip ${cls}`}>{live ? <span className="a-dot live" /> : <Icon name={m.icon} size={13} />}{m.label}</span>;
}
export function AgentCard({ a }: { a: { agent: string; label: string; status: string; text: string } }) {
  const m = AGENT_META[a.agent]; const working = a.status === 'monitoring' || a.status === 'in_progress';
  return <div className={`a-card ${working ? 'working' : ''} ${a.status === 'skipped' ? 'skipped' : ''}`}>
    <h3><span className="a-chip" style={{ padding: '0 6px' }}><Icon name={m.icon} size={14} /></span>{a.label}</h3>
    <div><span className={`st ${a.status}`}>{working && <span className="a-dot live" />}{a.status === 'completed' && <Icon name="check" size={12} />}{STATUS_LABEL[a.status]}</span></div>
    <p>{a.text}</p></div>;
}
/** Stage names written for requesters: what is happening, not the internal phase. */
export const STAGE_COPY: Record<string, { label: string; done: string; now: string; next: string }> = {
  discovery: { label: 'Checking contracts', done: 'Source identified', now: 'Checking catalogue and contracts', next: 'Catalogue and contract check' },
  coordination: { label: 'Getting quotes', done: 'Quotes collected', now: 'Suppliers are being contacted', next: 'Suppliers contacted if needed' },
  evaluation: { label: 'Choosing supplier', done: 'Offer chosen', now: 'Offers being compared', next: 'Offers compared and chosen' },
  approval: { label: 'Approval', done: 'Approved in SAP', now: 'Waiting for SAP approval', next: 'Requisition approved in SAP' },
  fulfilment: { label: 'Delivery', done: 'Delivered', now: 'On its way to your plant', next: 'Order placed and delivered' },
};
export function StageTrack({ stages }: { stages: { key: string; label: string; state: string; skipped?: boolean }[] }) {
  return <ol className="stage-track" aria-label="Progress">{stages.map((s, i) => { const c = STAGE_COPY[s.key]; return <li key={s.key} className={`stg ${s.state} ${s.skipped ? 'skip' : ''}`} aria-current={s.state === 'current' ? 'step' : undefined}><i>{s.state === 'done' ? <Icon name="check" size={14} /> : i + 1}</i><span className="sl">{c?.label ?? s.label}</span><span className="sd">{s.skipped ? 'Not needed' : s.state === 'current' ? 'Now' : ''}</span></li>; })}</ol>;
}
export const ChannelTag = ({ ch }: { ch?: string }) => ch && ch !== 'system' ? <span className="chn"><Icon name={CHANNEL[ch].icon} size={13} />{CHANNEL[ch].label}</span> : null;
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
export const dayLabel = (off: number) => `Day ${Math.floor(off / 1440) + 1}`;
export function MessagePreview({ p, ch }: { p: any; ch?: string }) {
  if (!p) return null; const wa = ch === 'whatsapp' || ch === 'magic_link';
  return <div className={`msg-prev ${wa ? 'wa' : ''}`}><small>{wa ? 'WhatsApp' : 'Email'}</small>{p.subject && <b>{p.subject}{'\n'}</b>}{p.text ?? p.body}</div>;
}
export function Timeline({ events, showPreviews = true }: { events: any[]; showPreviews?: boolean }) {
  return <ul className="tl">{events.map((e) => <li key={e.id} className={['human', 'supplier', 'system'].includes(e.agent) ? e.agent : ''}>
    <div className="when"><b>{dayLabel(e.off)}</b>{fmtTime(e.at)}</div>
    <div className="what"><div className="row2"><AgentChip agent={e.agent} /><ChannelTag ch={e.channel} /></div>{plain(e.title)}{e.detail && <div className="sub">{plain(e.detail)}</div>}{showPreviews && <MessagePreview p={e.payload?.preview} ch={e.channel} />}</div></li>)}</ul>;
}
export function SapBoundary({ sap }: { sap: { pr: string | null; po: string | null; note: string } }) {
  return <div className="sapb"><Icon name="shield" size={20} /><div><b>SAP boundary</b> — {sap.note}{(sap.pr || sap.po) && <div className="mut" style={{ fontSize: 12, marginTop: 2 }}>{sap.pr && <>Requisition {sap.pr}</>}{sap.pr && sap.po && ' · '}{sap.po && <>Purchase order {sap.po}</>} <span className="sim-tag">simulated</span></div>}</div></div>;
}

export function SupplierThread({ t }: { t: any }) {
  const [open, setOpen] = useState(t.status === 'unresponsive' || t.status === 'opened');
  const tone = t.status === 'quoted' ? 'ok' : t.status === 'unresponsive' ? 'bad' : t.status === 'opened' ? 'pri' : 'warn';
  const q = t.quote;
  return <div className="th-card">
    <div className="th-head"><b style={{ fontSize: 15 }}>{t.supplier}</b><span className={`tag ${tone}`}>{t.label}</span><span style={{ flex: 1 }} />{t.channels.map((c: string) => <ChannelTag key={c} ch={c} />)}
      <button className="sec sm" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide' : 'Communication history'}<Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} /></button></div>
    {t.next && <div className="mut" style={{ fontSize: 13, marginTop: 6 }}><Icon name="clock" size={14} /> Next planned: {t.next.title} ({dmy(t.next.at)}, {fmtTime(t.next.at)})</div>}
    {q && <div className="kv" style={{ marginTop: 8, display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13 }}>
      <span><span className="mut">Offered</span> <b>{q.product}</b></span><span><span className="mut">Price</span> <b>{inr(q.unitPrice)}</b> / {q.uom}</span><span><span className="mut">Qty</span> <b>{q.qty}</b></span><span><span className="mut">GST</span> <b>{q.gstPct}%</b></span>
      <span><span className="mut">Valid</span> <b>{q.validityDays ? `${q.validityDays} days` : 'not stated'}</b></span><span><span className="mut">Delivery</span> <b>{q.deliveryDays} days</b></span>{q.flags?.map((f: string) => <span key={f} className="tag warn">{f}</span>)}</div>}
    {open && <div style={{ marginTop: 8 }}><Timeline events={t.history} /></div>}
  </div>;
}

export function Comparison({ c }: { c: any }) {
  return <div style={{ overflowX: 'auto' }}><table className="cmp"><thead><tr><th>Supplier</th><th>Offered product</th><th>Unit price</th><th>Total ({c.qty} {c.uom})</th><th>Incl. GST</th><th>Delivery</th><th>Validity</th><th>Terms</th><th>Notes</th></tr></thead><tbody>
    {c.rows.map((r: any) => <tr key={r.supplier} className={r.lowest ? 'best' : r.excluded ? 'excl' : ''}><td><b>{r.supplier}</b>{r.lowest && <span className="tag ok" style={{ marginLeft: 6 }}>Lowest</span>}{r.selected && <span className="tag pri" style={{ marginLeft: 6 }}>Chosen</span>}</td><td>{r.product}{r.alternative && <div><span className="tag warn">Alternative</span></div>}</td><td>{inr(r.unitPrice)}</td><td>{inr(r.total)}</td><td>{inr(r.totalWithGst)}</td><td>{r.deliveryDays} days</td><td>{r.validityDays ? `${r.validityDays} days` : <span className="err">Not stated</span>}</td><td>{r.terms}</td><td>{r.excluded ? 'Excluded: alternative rejected' : r.flags?.join('; ') || '—'}</td></tr>)}
    {c.pending.map((p: any) => <tr key={p.supplier}><td><b>{p.supplier}</b></td><td colSpan={8} className="mut">{p.label}</td></tr>)}</tbody></table><p className="mut" style={{ fontSize: 12 }}><Icon name="info" size={13} /> {c.note}</p></div>;
}

/** Clearer wording for decision buttons; the stored action keys and behaviour are unchanged. */
const ACTION_LABEL: Record<string, string> = { keep_waiting: 'Keep waiting for a reply', escalate: 'Escalate to procurement', select_another: 'Invite another supplier', request_info: 'Ask the supplier for details', request_clarification: 'Ask suppliers to clarify', request_review: 'Request an applicability review', accept: 'Accept the alternative', reject: 'Reject the alternative' };
const KIND_LABEL: Record<string, string> = { arc_applicability: 'ARC applicability', technical_clarification: 'Technical clarification', commercial_review: 'Commercial review', supplier_exception: 'Supplier response' };
/** A person must decide. Strong card: who, why, what, since when, what happens otherwise, and the actions. */
export function HumanTaskCard({ t, comparison, onDone }: { t: any; comparison?: any; onDone: () => void }) {
  const { notify } = useApp(); const confirmAsk = useConfirm(); const [busy, setBusy] = useState(''); const [note, setNote] = useState(''); const [sup, setSup] = useState(t.related?.suppliers?.[0] ?? '');
  const act = async (a: any) => {
    if (a.href) { window.location.href = a.href; return; }
    const risky: Record<string, { title: string; body: string; danger?: boolean }> = { proceed: { title: `Proceed with ${sup}?`, body: 'This records the commercial decision and sends a requisition to SAP for approval.' }, reject: { title: 'Reject the proposed alternative?', body: `${t.related?.supplier ?? 'The supplier'}’s quotation will be left out of the comparison.`, danger: true }, confirm_applicable: { title: `Extend ${t.related?.contract} to ${t.related?.plant}?`, body: 'The plant will be able to buy every item on this contract at contract prices.' }, select_another: { title: 'Invite another supplier?', body: 'MonoSource will send a request for quotation to the next eligible supplier.' } };
    const rk = risky[a.key]; if (rk && !(await confirmAsk({ ...rk, confirm: a.label }))) return; setBusy(a.key);
    try { await api(`/tasks/${t.id}/resolve`, { body: { action: a.key, note: note || undefined, supplier: a.key === 'proceed' ? sup : undefined } }); notify(a.key === 'proceed' ? 'Decision recorded — the requisition goes to SAP for approval (simulated)' : 'Decision recorded'); setNote(''); onDone(); }
    catch (e: any) { notify(e.message, { error: true }); } finally { setBusy(''); }
  };
  const done = t.status === 'done', waiting = t.status === 'waiting';
  return <div className={`htask ${t.priority === 'high' && t.canAct ? 'high' : ''} ${done ? 'done' : waiting ? 'wait' : !t.canAct ? 'passive' : ''}`} id={`task-${t.id}`}>
    <div className="row" style={{ marginBottom: 0, gap: 8 }}><span className={`tag ${done ? 'ok' : waiting ? 'warn' : t.canAct ? 'bad' : ''}`}><Icon name={done ? 'checkCircle' : 'userCheck'} size={13} />{done ? 'Decided' : waiting ? 'Waiting' : t.canAct ? 'Needs you' : 'Decision pending'}</span><span className="tag">{KIND_LABEL[t.kind]}</span>{t.priority === 'high' && !done && <span className="tag warn">High priority</span>}</div>
    <b style={{ fontSize: 15 }}>{t.title}</b>
    {t.kind === 'technical_clarification' && t.related && <div className="tc-diff"><div><small>Requested</small><b>{t.related.requested}</b></div><Icon name="arrowRight" size={16} /><div><small>Proposed</small><b>{t.related.proposed}</b></div></div>}
    <details className="more"><summary><Icon name="chevronRight" size={13} />Details</summary><div>
    <div className="why">{t.reason}</div>
    <div className="meta"><span>Responsible: <b>{t.ownerRole}</b></span><span>Raised: <b>{dayLabel(t.off)} · {fmtTime(t.raisedAt)}</b></span>{t.related?.supplier && <span>Supplier: <b>{t.related.supplier}</b></span>}{t.related?.contract && <span>Contract: <b>{t.related.contract}</b></span>}</div>
    {!done && t.consequence && <div className="cons"><Icon name="info" size={14} />If no action is taken: {t.consequence}</div>}
    {!done && t.canAct && <label className="field" style={{ marginBottom: 0 }}><span>Note for the record <span className="mut" style={{ fontWeight: 400 }}>(optional)</span></span><input placeholder="e.g. same dimensions and load rating" value={note} onChange={(e) => setNote(e.target.value)} /></label>}
    </div></details>
    {done && t.resolution && <div className="mut" style={{ fontSize: 13 }}>Decision: <b>{t.actions.find((a: any) => a.key === t.resolution.action)?.label ?? t.resolution.action}</b>{t.resolution.note ? ` — “${t.resolution.note}”` : ''}</div>}
    {!done && (t.canAct ? <>
      {t.kind === 'commercial_review' && comparison && <div style={{ display: 'grid', gap: 8 }}>
        <QuoteBoard c={comparison} threads={[]} />
        <label className="field" style={{ marginBottom: 0, maxWidth: 360 }}><span>Proceed with supplier</span><select value={sup} onChange={(e) => setSup(e.target.value)}>{t.related.suppliers.map((s: string) => <option key={s}>{s}</option>)}</select></label></div>}
      <div className="row" style={{ marginBottom: 0 }}>{t.actions.filter((a: any) => a.allowed !== false).map((a: any) => <button key={a.key} className={`btn sm ${a.primary ? 'pri' : 'ghost'} ${busy === a.key ? 'busy' : ''}`} disabled={!!busy} onClick={() => act({ ...a, label: ACTION_LABEL[a.key] ?? a.label })}>{ACTION_LABEL[a.key] ?? a.label}</button>)}</div></>
      : <div className="mut" style={{ fontSize: 13 }}><Icon name="hourglass" size={14} /> Waiting for {t.ownerRole}. We’ll notify you once it’s decided.{t.actions.find((a: any) => a.href) && <> <Link href={t.actions.find((a: any) => a.href).href}>{t.actions.find((a: any) => a.href).label}</Link></>}</div>)}
  </div>;
}

const initials = (n: string) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

/**
 * Suppliers and their quotes as one board: a card per supplier, the price first, the facts that decide underneath.
 * Lowest total and fastest delivery are marked; suppliers that haven't quoted yet sit at the end, quietly.
 */
export function QuoteBoard({ c, threads }: { c: any | null; threads: any[] }) {
  const byName = new Map(threads.map((t) => [t.supplier, t]));
  const rows: any[] = c?.rows ?? threads.filter((t) => t.quote).map((t) => ({ supplier: t.supplier, ...t.quote, total: t.quote.unitPrice * t.quote.qty }));
  const live = rows.filter((r) => !r.excluded);
  const fastest = live.length > 1 ? Math.min(...live.map((r) => r.deliveryDays ?? Infinity)) : null;
  const lowest = live.length > 1 ? Math.min(...live.map((r) => r.total ?? Infinity)) : null;
  const waiting = threads.filter((t) => !rows.some((r) => r.supplier === t.supplier));
  const sorted = [...rows].sort((a, b) => (a.excluded ? 1 : 0) - (b.excluded ? 1 : 0) || (a.total ?? 0) - (b.total ?? 0));
  return <div className="qboard">
    {sorted.map((r) => { const t = byName.get(r.supplier); const best = r.lowest || (lowest !== null && r.total === lowest && !r.excluded);
      return <article key={r.supplier} className={`qcard ${best ? 'best' : ''} ${r.selected ? 'chosen' : ''} ${r.excluded ? 'excl' : ''}`}>
        <header><span className="qav">{initials(r.supplier)}</span><b className="qname">{r.supplier}</b>
          {r.selected ? <span className="h-pill ok">Chosen</span> : best ? <span className="h-pill ok">Lowest</span> : null}</header>
        <div className="qprice">{inr(r.unitPrice)}<small> / {r.uom ?? c?.uom}</small></div>
        <div className="qtotal">{inr(r.total)} total{r.totalWithGst ? <> · {inr(r.totalWithGst)} with GST</> : null}</div>
        <dl className="qfacts">
          <div><dt>Delivery</dt><dd>{r.deliveryDays != null ? `${r.deliveryDays} days` : '—'}{fastest !== null && r.deliveryDays === fastest && !r.excluded && <i className="qfast">Fastest</i>}</dd></div>
          <div><dt>Valid for</dt><dd className={r.validityDays ? '' : 'qmiss'}>{r.validityDays ? `${r.validityDays} days` : 'Not stated'}</dd></div>
          <div><dt>Payment</dt><dd>{r.terms ?? '—'}</dd></div>
        </dl>
        {(() => { const flags = (r.flags ?? []).filter((f: string) => !/validity|alternative/i.test(f)); return (r.alternative || r.excluded || flags.length > 0) && <div className="qflags">{r.alternative && !r.excluded && <span className="h-pill warn">Alternative offered</span>}{r.excluded && <span className="h-pill">Alternative rejected</span>}{flags.map((f: string) => <span key={f} className="h-pill warn">{f}</span>)}</div>; })()}
        {r.alternative && r.product && <div className="qalt">{r.product}</div>}
        {t?.history?.length > 0 && <details className="qmsgs"><summary>Messages</summary><Timeline events={t.history} /></details>}
      </article>; })}
    {waiting.map((t) => <article key={t.supplier} className={`qcard wait ${t.status === 'unresponsive' ? 'off' : ''}`}>
      <header><span className="qav">{initials(t.supplier)}</span><b className="qname">{t.supplier}</b></header>
      <div className="qwait">{t.status === 'unresponsive' ? 'No reply' : <><span className="a-dot live" />Waiting for quote</>}</div>
      {t.next && t.status !== 'unresponsive' && <div className="qtotal">Follow-up {dmy(t.next.at)}</div>}
      {t.history?.length > 0 && <details className="qmsgs"><summary>Messages</summary><Timeline events={t.history} /></details>}
    </article>)}
  </div>;
}
