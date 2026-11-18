'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { API, api, getToken } from '../../lib/api';
import { can, useMe } from '../shell';
import { Icon } from '../../components/Icon';
import { Empty, Toast } from '../../components/Ui';
import { STATUS_LABEL, catLabel } from '../../lib/format';
import { DataTable } from '../../components/DataTable';

const inr = (n: number | null | undefined) => n == null ? '—' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmt = (v: number | null | undefined, unit: string) => v == null ? '—' : unit === 'inr' ? inr(v) : unit === 'percent' ? `${v}%` : unit === 'hours' ? `${v} h` : Number(v).toLocaleString('en-IN');
const ROUTE: Record<string, string> = { arc: 'Customer contract', direct: 'ProcMart supply', award: 'Awarded after quotes', sourcing: 'Waiting for quotes', returned: 'Returned to buyer', exception: 'Exception' };
const KIND: Record<string, string> = { routing: 'Buying route needs a decision', pr_failed: 'Not sent to SAP', supplier_partial: 'Partial commitment', supplier_rejected: 'Order declined', quality_rejection: 'Goods rejected', supplier_unresponsive: 'Supplier not responding' };
const STATUS = STATUS_LABEL;

function Bar({ value, max, tone = 'pri' }: { value: number; max: number; tone?: string }) {
  return <div style={{ height: 8, background: 'var(--hover)', borderRadius: 4, overflow: 'hidden', minWidth: 80 }}><div style={{ width: `${max > 0 ? Math.max(2, Math.min(100, (value / max) * 100)) : 0}%`, height: '100%', background: `var(--${tone})`, borderRadius: 4 }} /></div>;
}
function Panel({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return <div className="card" style={{ marginBottom: 0 }}><h2 style={{ marginBottom: sub ? 2 : 12 }}>{title}</h2>{sub && <div className="mut" style={{ fontSize: 12, marginBottom: 12 }}>{sub}</div>}{children}</div>;
}
function BarList({ rows, fmtV, tone }: { rows: { label: string; value: number }[]; fmtV?: (n: number) => string; tone?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return rows.length ? <div style={{ display: 'grid', gap: 10 }}>{rows.map((r) => <div key={r.label}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}><span>{r.label}</span><b>{fmtV ? fmtV(r.value) : r.value}</b></div><Bar value={r.value} max={max} tone={tone} /></div>)}</div> : <div className="mut">No data in this period.</div>;
}

export default function ControlTower() {
  const me = useMe(); const [nodes, setNodes] = useState<any[]>([]); const [node, setNode] = useState(''); const [days, setDays] = useState(90);
  const [data, setData] = useState<any>(null); const [defs, setDefs] = useState<any[]>([]); const [err, setErr] = useState(''); const [info, setInfo] = useState(''); const [drill, setDrill] = useState<{ kind: string; title: string; rows: any[] } | null>(null);
  const qs = useMemo(() => { const to = new Date(Date.now() + 864e5).toISOString().slice(0, 10); const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10); return `from=${from}&to=${to}${node ? `&nodeId=${node}` : ''}`; }, [days, node]);
  useEffect(() => { api('/org/tree').then(setNodes).catch(() => {}); api('/analytics/metrics').then(setDefs).catch(() => {}); }, []);
  const load = useCallback(() => { setData(null); setDrill(null); api(`/analytics/overview?${qs}`).then(setData).catch((e) => setErr(e.message)); }, [qs]);
  useEffect(load, [load]);
  const def = (id: string) => defs.find((d) => d.id === id);
  const openDrill = async (id: string, kind?: string) => { if (!kind) return; try { const r = await api(`/analytics/drill?kind=${kind}&${qs}`); setDrill({ kind, title: def(id)?.name ?? kind, rows: r.rows }); setTimeout(() => document.getElementById('drill')?.scrollIntoView({ behavior: 'smooth' }), 50); } catch (e: any) { setErr(e.message); } };
  const exportMis = async () => { const r = await fetch(`${API}/analytics/mis.csv?${qs}`, { headers: { Authorization: `Bearer ${getToken()}` } }); if (!r.ok) { setErr('Export failed'); return; } const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = 'monosource-mis.csv'; a.click(); URL.revokeObjectURL(a.href); };
  if (!me) return null;
  if (!can(me, 'analytics:read')) return <Empty icon="shield" title="You don’t have access to the procurement overview"><p>Ask your administrator for analytics access if you need it.</p></Empty>;
  const m = data?.metrics, b = data?.breakdowns;
  const Tile = ({ id, tone, sub }: { id: string; tone?: string; sub?: string }) => { const d = def(id); const v = m?.[id];
    return <div className="card stat" role={d?.drill ? 'button' : undefined} tabIndex={d?.drill ? 0 : undefined} onKeyDown={(e) => { if (d?.drill && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDrill(id, d.drill); } }} aria-label={d?.drill ? `${d?.name ?? id}: show the records` : undefined} style={{ marginBottom: 0, padding: 16, cursor: d?.drill ? 'pointer' : 'default', borderColor: info === id ? 'var(--pri)' : undefined }} onClick={() => openDrill(id, d?.drill)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', color: 'var(--mut)', fontSize: 12, fontWeight: 600 }}><span>{d?.name ?? id}</span>
        <button className="sec" aria-label={`What ${d?.name ?? 'this number'} means`} title="What this number means" style={{ height: 24, width: 24, padding: 0, borderRadius: 999, border: 0, boxShadow: 'none' }} onClick={(e) => { e.stopPropagation(); setInfo(info === id ? '' : id); }}><Icon name="info" size={15} /></button></div>
      <div style={{ fontSize: 'var(--fs-2xl)', fontWeight: 700, letterSpacing: '-.02em', margin: '6px 0 2px', color: tone ? `var(--${tone})` : undefined }}>{data ? fmt(v, d?.unit ?? 'count') : <span className="skel" style={{ display: 'inline-block', width: 90, height: 28 }} />}</div>
      <div className="mut" style={{ fontSize: 12 }}>{sub ?? (d?.drill ? '' : ' ')}</div></div>; };
  const infoDef = def(info);
  return <>
    <div className="pagehead"><div><h1>Procurement overview</h1><p>{data ? `${data.meta.scope} · ${data.meta.from} to ${data.meta.to}` : 'Loading…'}</p></div>
      <div className="actions">
        <label className="field inline"><span>Scope</span><select value={node} onChange={(e) => setNode(e.target.value)}><option value="">All plants I can see</option>{nodes.filter((n) => ['business', 'company_code', 'plant'].includes(n.levelType)).map((n) => <option key={n.id} value={n.id}>{n.levelType === 'plant' ? '▸ ' : ''}{n.name}{n.server ? ` (${n.server})` : ''}</option>)}</select></label>
        <label className="field inline"><span>Period</span><select value={days} onChange={(e) => setDays(Number(e.target.value))}>{[[30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last 12 months']].map(([d, l]) => <option key={d} value={d}>{l}</option>)}</select></label>
        <button className="sec" onClick={exportMis}><Icon name="download" size={16} />Export report (CSV)</button></div></div>
    <Toast t={err} e />
    {data && <div className="banner"><Icon name="info" size={18} /><span>{data.meta.dataNote} Numbers cover MonoSource orders only.</span></div>}
    {infoDef && <div className="card" style={{ borderColor: 'var(--pri)', background: 'var(--pri-soft)' }}><b>{infoDef.name}</b><div style={{ margin: '4px 0' }}>{infoDef.definition}</div><div className="mut" style={{ fontSize: 13 }}>Source: {infoDef.sources.join(', ')}</div>{infoDef.caveat && <div style={{ fontSize: 13, color: 'var(--warn)', marginTop: 4 }}><b>Note:</b> {infoDef.caveat}</div>}</div>}

    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(min(210px,100%),1fr))', gap: 14, marginBottom: 16 }}>
      <Tile id="requirements" /><Tile id="committed_value" /><Tile id="contract_coverage" tone="m2" /><Tile id="open_exceptions" tone={m?.open_exceptions ? 'bad' : undefined} />
      <Tile id="pending_grn_streams" /><Tile id="late_deliveries" tone={m?.late_deliveries ? 'bad' : undefined} /><Tile id="contract_candidate_unused" tone={m?.contract_candidate_unused ? 'warn' : undefined} /><Tile id="rfq_competition_spread" sub="Not a baseline saving" /></div>

    {drill && <div className="card" id="drill"><div className="row" style={{ justifyContent: 'space-between' }}><h2 style={{ margin: 0 }}>Records behind “{drill.title}” <span className="mut" style={{ fontWeight: 500 }}>({drill.rows.length}{drill.rows.length === 300 ? '+' : ''})</span></h2><button className="sec" onClick={() => setDrill(null)}><Icon name="x" size={15} />Close</button></div>
      {!drill.rows.length ? <Empty icon="inbox" title="No records behind this number"><p>Try a longer period or a wider scope.</p></Empty> : <div className="tscroll"><table><thead><tr>{Object.keys(drill.rows[0]).filter((k) => k !== 'requirementId').map((k) => <th key={k}>{k.replace(/([A-Z])/g, ' $1')}</th>)}</tr></thead><tbody>
        {drill.rows.map((r, i) => <tr key={i}>{Object.entries(r).filter(([k]) => k !== 'requirementId').map(([k, v]: any) => <td key={k}>{k === 'requirement' && r.requirementId ? <Link href={`/requirements/${r.requirementId}`}><b>{v}</b></Link> : v === null ? '—' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v).slice(0, 120)}</td>)}</tr>)}</tbody></table></div>}</div>}

    {b && <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(300px,100%),1fr))', gap: 16, marginBottom: 16 }}>
        <Panel title="How lines were routed" sub="Per requirement line"><BarList rows={b.byRoute.map((r: any) => ({ label: ROUTE[r.route] ?? r.route, value: r.lines }))} /></Panel>
        <Panel title="Committed value by model" sub="Model decided by the allocation register"><BarList tone="m2" fmtV={inr} rows={b.byModel.map((r: any) => ({ label: `Model ${r.model}`, value: r.value }))} /></Panel>
        <Panel title="Why a contract was not used" sub="Contract existed but failed a check"><BarList tone="warn" rows={b.unusedReasons.map((r: any) => ({ label: r.reason.replace('N', '…'), value: r.lines }))} /></Panel></div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(300px,100%),1fr))', gap: 16, marginBottom: 16 }}>
        <Panel title="Order pipeline" sub="Order streams by status"><BarList rows={b.pipeline.map((r: any) => ({ label: STATUS[r.status] ?? r.status, value: r.n }))} /></Panel>
        <Panel title="Open exceptions" sub="Waiting for a person"><BarList tone="bad" rows={b.exceptionsByKind.map((r: any) => ({ label: KIND[r.kind] ?? r.kind, value: r.n }))} />{b.exceptionsByKind.length > 0 && <Link href="/work?tab=exceptions" style={{ display: 'inline-block', marginTop: 12, fontWeight: 600 }}>Open the work queue <Icon name="arrowRight" size={14} /></Link>}</Panel>
        <Panel title="Fee-base value" sub="GRN-completed value by treatment. No rates applied (not yet agreed)"><BarList tone="m3" fmtV={inr} rows={b.feeBase.map((r: any) => ({ label: r.fee_treatment === 'none' ? 'No fee (Model 1)' : r.fee_treatment === 'supplier_enablement' ? 'Supplier enablement (Model 2)' : 'Management fee (Model 3)', value: r.value }))} /></Panel></div>

      <h2 style={{ margin: 'var(--sp-2) 0 var(--sp-3)' }}>Plant comparison</h2>
      <DataTable label="Plant comparison" rows={b.plants} rowKey={(p: any) => p.id} initialSort={{ key: 'value', dir: 'desc' }}
        cols={[{ key: 'name', label: 'Plant', sort: (p: any) => p.name, render: (p: any) => <b>{p.name}</b> },
          { key: 'reqs', label: 'Requirements', num: true, sort: (p: any) => p.requirements, render: (p: any) => p.requirements },
          { key: 'lines', label: 'Lines', num: true, sort: (p: any) => p.lines, render: (p: any) => p.lines, hideBelow: 'md' },
          { key: 'value', label: 'Committed (₹)', num: true, sort: (p: any) => Number(p.value), render: (p: any) => inr(p.value).replace('₹', '') },
          { key: 'cov', label: 'On contract', num: true, width: 200, sort: (p: any) => p.coverage, render: (p: any) => <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end' }}><Bar value={p.coverage ?? 0} max={100} tone="pri" /><span style={{ minWidth: 40 }}>{p.coverage ?? '—'}%</span></div> },
          { key: 'exc', label: 'Open exceptions', num: true, sort: (p: any) => p.openExceptions, render: (p: any) => p.openExceptions ? <span className="tag bad">{p.openExceptions}</span> : <span className="mut">0</span> }]}
        empty={{ icon: 'building', title: 'No orders in this period', text: 'Choose a longer period or a different scope above.' }} />

      <div className="sec-head" style={{ margin: 'var(--sp-2) 0 var(--sp-3)' }}><h2>Supplier performance</h2><span className="hint">Blank means not enough data yet. PO release and goods receipt are simulated until a live SAP feed is connected.</span></div>
      <DataTable label="Supplier performance" rows={b.suppliers} rowKey={(s: any) => s.id} initialSort={{ key: 'orders', dir: 'desc' }}
        cols={[{ key: 'name', label: 'Supplier', sort: (s: any) => s.name, render: (s: any) => <b>{s.name}</b> },
          { key: 'orders', label: 'Orders', num: true, sort: (s: any) => s.orders, render: (s: any) => s.orders },
          { key: 'fill', label: 'Fill rate', num: true, title: def('supplier_fill_rate')?.definition, sort: (s: any) => s.fillRate, render: (s: any) => s.fillRate == null ? '—' : `${s.fillRate}%` },
          { key: 'rej', label: 'Rejected', num: true, title: def('supplier_rejection_rate')?.definition, sort: (s: any) => s.rejectionRate, render: (s: any) => s.rejectionRate == null ? '—' : <span className={`tag ${s.rejectionRate > 0 ? 'bad' : 'ok'}`}>{s.rejectionRate}%</span> },
          { key: 'ack', label: 'Avg. confirmation time', num: true, title: def('supplier_ack_hours')?.definition, sort: (s: any) => s.ackHours, render: (s: any) => s.ackHours == null ? '—' : `${s.ackHours} h`, hideBelow: 'md' },
          { key: 'otd', label: 'On-time dispatch', num: true, title: def('supplier_ontime_dispatch')?.definition, sort: (s: any) => s.onTimeDispatch, render: (s: any) => s.onTimeDispatch == null ? '—' : `${s.onTimeDispatch}%`, hideBelow: 'md' },
          { key: 'unr', label: 'Unresponsive', num: true, sort: (s: any) => s.unresponsive, render: (s: any) => s.unresponsive || <span className="mut">0</span> }]}
        empty={{ icon: 'truck', title: 'No supplier orders in this period', text: 'Supplier performance appears once orders are placed.' }} />

      {b.utilisation && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(340px,100%),1fr))', gap: 16, marginBottom: 16 }}>
        <Panel title="Contract utilisation" sub="MonoSource orders ÷ quantity cap"><div style={{ display: 'grid', gap: 12 }}>{b.utilisation.map((u: any, i: number) => <div key={i}><div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}><span><b>{u.number}</b> · {u.item} <span className="mut">· {u.supplier}</span></span><b>{u.utilisation ?? '—'}%</b></div><Bar value={u.utilisation ?? 0} max={100} tone={u.utilisation >= 90 ? 'bad' : u.utilisation >= 70 ? 'warn' : 'm2'} /><div className="mut" style={{ fontSize: 12 }}>{u.used} of {u.cap} used</div></div>)}{!b.utilisation.length && <div className="mut">No published contract lines with a cap.</div>}</div></Panel>
        <Panel title="Contracts expiring within 90 days"><div className="tscroll"><table><tbody>{b.expiring.map((e: any) => <tr key={e.id}><td><Link href={`/contracts/${e.id}`}><b>{e.number}</b></Link><div className="mut">{e.supplier}</div></td><td>{e.validTo}</td><td><span className={`tag ${e.days <= 30 ? 'bad' : 'warn'}`}>{e.days} days</span></td></tr>)}{!b.expiring.length && <tr><td className="mut">None expiring soon.</td></tr>}</tbody></table></div></Panel></div>}

      <h2 style={{ margin: 'var(--sp-2) 0 var(--sp-3)' }}>Category performance</h2>
      <DataTable label="Category performance" rows={b.categories} rowKey={(c: any) => c.category} initialSort={{ key: 'value', dir: 'desc' }}
        cols={[{ key: 'cat', label: 'Category', sort: (c: any) => c.category, render: (c: any) => <b>{catLabel(c.category)}</b> },
          { key: 'lines', label: 'Lines', num: true, sort: (c: any) => c.lines, render: (c: any) => c.lines },
          { key: 'value', label: 'Committed (₹)', num: true, sort: (c: any) => Number(c.value), render: (c: any) => inr(c.value).replace('₹', '') },
          { key: 'cov', label: 'On contract', num: true, width: 200, sort: (c: any) => c.coverage, render: (c: any) => <div style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end' }}><Bar value={c.coverage ?? 0} max={100} tone="pri" /><span style={{ minWidth: 40 }}>{c.coverage ?? '—'}%</span></div> }]}
        empty={{ icon: 'grid', title: 'No category spend in this period', text: 'Choose a longer period or a different scope above.' }} />

      <details className="card"><summary style={{ fontSize: 15 }}><Icon name="chevronRight" size={15} />Metric definitions ({defs.length})</summary>
        <div style={{ display: 'grid', gap: 14, marginTop: 14 }}>{defs.map((d) => <div key={d.id}><b>{d.name}</b> <span className="tag">{d.unit}</span><div>{d.definition}</div><div className="mut" style={{ fontSize: 12 }}>Source: {d.sources.join(', ')}</div>{d.caveat && <div style={{ fontSize: 12, color: 'var(--warn)' }}>Note: {d.caveat}</div>}</div>)}</div></details>
    </>}</>;
}
