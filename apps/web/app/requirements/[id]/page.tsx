'use client';
import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { Icon } from '../../../components/Icon';
import { HumanTaskCard, QuoteBoard, STAGE_COPY, StageTrack, Timeline } from '../../../components/Agents';
import { useApp } from '../../shell';
import { STATUS_TONE, ago, dmy, num, plain, statusLabel } from '../../../lib/format';

/**
 * One requirement, read top to bottom: where it is, what (if anything) needs you, the quotes, the orders.
 * Which model or agent does the work is decided behind the scenes and not shown; only the follow-up is visible,
 * because "we're chasing the supplier" is something a requester wants to know.
 */
export default function Requirement({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const { notify } = useApp(); const [w, setW] = useState<any>(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const load = useCallback(() => api(`/requirements/${id}/workspace`).then(setW).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); const t = setInterval(load, 7000); return () => clearInterval(t); }, [load]);
  useEffect(() => { if (w && location.hash === '#needs-action') document.getElementById('needs-action')?.scrollIntoView({ block: 'start' }); }, [w?.id]); // eslint-disable-line
  if (err) return <div className="card"><div className="empty"><b>We couldn’t open this requirement</b><div className="acts"><Link href="/activity" className="btn sec sm">Back to my activity</Link></div></div></div>;
  if (!w) return <div style={{ display: 'grid', gap: 12 }}><div className="skel" style={{ height: 90 }} /><div className="skel" style={{ height: 160 }} /><div className="skel" style={{ height: 240 }} /></div>;

  const open = w.tasks.filter((t: any) => t.status !== 'done'); const decided = w.tasks.filter((t: any) => t.status === 'done');
  const actionNow = open.find((t: any) => t.blocking) ?? (w.stage === 'complete' ? null : open[0]);
  const advance = async () => { setBusy(true); try { const r = await api(`/requirements/${id}/demo/advance`, { body: {} }); notify(`Moved to: ${r.label}`); await load(); } catch (e: any) { notify(e.message, { error: true }); } finally { setBusy(false); } };
  const followup = w.agents?.find((a: any) => a.agent === 'followup');
  const chasing = followup && (followup.status === 'monitoring' || followup.status === 'in_progress');
  const status = w.stage === 'complete' ? ['Fulfilled', 'ok'] : actionNow?.canAct ? ['Needs you', 'bad'] : [STAGE_COPY[w.stage]?.label ?? w.stage, 'pri'];
  const quotes = w.threads.length > 0 || w.comparison;

  return <>
    <div className="crumbs"><Link href="/activity">My activity</Link>›<b>{w.number}</b></div>
    <div className="pagehead"><div><div className="title-row"><h1>{w.number}</h1><span className={`tag lg ${status[1]}`}>{status[0]}</span></div>
      <div className="rq-sub">{w.lines.map((l: any) => `${num(l.qty)} ${l.uom} · ${l.item}`).join('  ·  ')} <span className="mut">— {w.plant}, {ago(w.createdAt)}</span></div></div>
      {w.demoCanAdvance && <div className="actions"><button className={`sec sm ${busy ? 'busy' : ''}`} disabled={busy} onClick={advance} title="Demo only: jump to the next simulated day"><Icon name="zap" size={15} />Next day (demo)</button></div>}</div>

    <section className="card rq-progress"><StageTrack stages={w.stages} />
      <div className="rq-now">
        {actionNow ? <><Icon name="userCheck" size={18} /><span>{actionNow.canAct ? <><b>{actionNow.title}</b> <a href="#needs-action">Decide</a></> : <>Waiting for {actionNow.ownerRole}</>}</span></>
          : w.waiting ? <><span className="a-dot live" /><span><b>{w.waiting.responded} of {w.waiting.total}</b> suppliers have quoted{chasing ? ' · follow-up running' : ''}{w.waiting.nextFollowUp ? ` · next ${dmy(w.waiting.nextFollowUp.at)}` : ''}</span></>
          : w.stage === 'complete' ? <><Icon name="checkCircle" size={18} /><span>Received at {w.plant}</span></>
          : <><Icon name="clock" size={18} /><span>{plain(w.next)}</span></>}
      </div></section>

    {open.length > 0 && <section id="needs-action" className="card" style={{ scrollMarginTop: 90 }}><div className="sec-head"><h2>Needs a decision</h2></div>
      {open.map((t: any) => <HumanTaskCard key={t.id} t={t} comparison={w.comparison} onDone={load} />)}</section>}

    {quotes && <section className="card"><div className="sec-head"><h2>Quotes</h2>{chasing && <span className="rq-chase"><span className="a-dot live" />Follow-up running</span>}</div>
      <QuoteBoard c={w.comparison} threads={w.threads} /></section>}

    {w.streams.length > 0 && <section className="card"><div className="sec-head"><h2>Orders</h2>{w.sap?.po && <span className="mut small">PO {w.sap.po}</span>}</div><div className="rq-orders">{w.streams.map((s: any) => <Link key={s.id} href={`/orders/${s.id}`} className="h-row"><span><b>{s.supplier}</b></span><span className={`h-st ${STATUS_TONE(s.status)}`}>{statusLabel(s.status)}</span></Link>)}</div></section>}

    <section className="card"><details className="rq-history"><summary><h2>History</h2><Icon name="chevronDown" size={16} /></summary>
      {decided.length > 0 && <div style={{ marginTop: 12 }}>{decided.map((t: any) => <HumanTaskCard key={t.id} t={t} onDone={load} />)}</div>}
      <Timeline events={w.timeline} showPreviews={false} /></details></section>
  </>;
}
