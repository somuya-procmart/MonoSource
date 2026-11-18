'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Icon } from './Icon';
import { AgentChip, HumanTaskCard } from './Agents';
import { ago, plain } from '../lib/format';

/** Four clearly separate groups so a person sees only what truly needs them. */
export function useTasks() { const [d, setD] = useState<any>(null); const load = useCallback(() => api('/tasks').then(setD).catch(() => setD({ needsMe: [], waiting: [], working: [], recent: [], resolved: [], counts: { needsMe: 0 } })), []); useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]); return { d, load }; }

export function AttentionBoard({ d, load, who }: { d: any; load: () => void; who: 'requester' | 'staff' }) {
  if (!d) return <div style={{ display: 'grid', gap: 12 }}><div className="skel" style={{ height: 120 }} /><div className="skel" style={{ height: 120 }} /></div>;
  const Req = ({ t }: { t: any }) => <div><div className="mut" style={{ fontSize: 12, margin: '0 0 4px 2px' }}><Link href={`/requirements/${t.requirementId}`}><b>{t.number}</b></Link> · {t.plant}</div><HumanTaskCard t={t} onDone={load} />{t.kind === 'commercial_review' && <div style={{ margin: '-4px 0 12px' }}><Link href={`/requirements/${t.requirementId}#needs-action`} className="btn sm ghost">Compare quotes<Icon name="arrowRight" size={14} /></Link></div>}</div>;
  return <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 22 }}>
    <section><div className="sec-head"><h2>Needs my action</h2><span className={`tag ${d.needsMe.length ? 'bad' : ''}`} aria-label={`${d.needsMe.length} items`}>{d.needsMe.length}</span></div>
      {d.needsMe.length ? d.needsMe.map((t: any) => <Req key={t.id} t={t} />) : <div className="card empty" style={{ padding: 22 }}><b>Nothing needs you right now</b></div>}</section>
    <section><div className="sec-head"><h2>Waiting for others</h2></div>
      {d.waiting.length ? d.waiting.map((t: any) => <Req key={t.id} t={t} />) : <div className="mut" style={{ fontSize: 13 }}>No one else is holding up your requirements.</div>}</section>
    <section><div className="sec-head"><h2>In progress</h2></div>
      {d.working.length ? <div className="card" style={{ padding: 0 }}>{d.working.map((w: any) => <Link key={w.requirementId} href={`/requirements/${w.requirementId}`} className="row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--bd)', margin: 0, color: 'inherit', textDecoration: 'none', gap: 12 }}><AgentChip agent="followup" live /><span style={{ flex: 1 }}><b>{w.number}</b> <span className="mut">· {w.plant}</span><div className="mut" style={{ fontSize: 13 }}>{plain(w.activity)}</div></span><Icon name="chevronRight" size={16} /></Link>)}</div> : <div className="mut" style={{ fontSize: 13 }}>Nothing in progress.</div>}</section>
    <section><div className="sec-head"><h2>Completed recently</h2></div>
      {d.recent.length || d.resolved.length ? <div className="card" style={{ padding: 0 }}>{d.recent.map((r: any) => <Link key={r.requirementId} href={`/requirements/${r.requirementId}`} className="row" style={{ padding: '10px 16px', borderBottom: '1px solid var(--bd)', margin: 0, color: 'inherit', textDecoration: 'none' }}><Icon name="checkCircle" size={16} /><b>{r.number}</b><span className="mut">fulfilled {ago(r.at)}</span></Link>)}{d.resolved.filter((t: any) => t.kind !== 'arc_applicability' && !/^Confirm whether ARC/.test(t.title)).map((t: any) => <Link key={t.id} href={`/requirements/${t.requirementId}`} className="row" style={{ padding: '10px 16px', borderBottom: '1px solid var(--bd)', margin: 0, color: 'inherit', textDecoration: 'none' }}><Icon name="check" size={16} /><span>{t.title}</span><span className="mut">· {t.number}</span></Link>)}</div> : <div className="mut" style={{ fontSize: 13 }}>Nothing completed yet.</div>}</section>
  </div>;
}
