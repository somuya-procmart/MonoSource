'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { can, useApp } from '../shell';
import { Empty } from '../../components/Ui';
import { Icon } from '../../components/Icon';
import { CONTRACT_STATUS, dmy, daysLeft, inr } from '../../lib/format';
import { useOpenProduct } from '../../components/ProductPanel';
import { DataTable } from '../../components/DataTable';
import { useConfirm } from '../../components/Confirm';
import { useRouter } from 'next/navigation';

const CLS: Record<string, [string, string, string]> = { on_contract: ['Bought on contract', 'ok', 'Right supplier, contract price'], price_leakage: ['Paid above contract price', 'warn', 'Contract supplier, but a higher price'], leakage: ['Bought off-contract', 'bad', 'Another supplier, although a contract applied'], coverage_gap: ['Contract not extended', 'warn', 'A group contract exists for another plant'], no_contract: ['No contract in the group', '', 'Candidate for a new contract'] };
function Coverage() {
  const ask = useConfirm();
  const { notify } = useApp(); const { open } = useOpenProduct(); const [d, setD] = useState<any>(null); const me = useApp().me;
  const load = () => api('/coverage/analysis').then(setD).catch(() => setD({ classes: [], opportunities: [], byPlant: [], byCategory: [], totalValue: 0, totalLines: 0 }));
  useEffect(() => { load(); }, []);
  const extend = async (o: any) => { if (!(await ask({ title: `Extend ${o.contract} to ${o.plant}?`, body: `${o.plant} will be able to order ${o.item} and every other item on this contract at contract prices. You can remove the plant later from the contract.`, confirm: 'Extend contract' }))) return; try { await api(`/contracts/${o.contractId}/scopes`, { body: { nodeId: o.plantId } }); notify(`${o.contract} extended to ${o.plant}`); load(); } catch (e: any) { notify(e.message, { error: true }); } };
  if (!d) return <div className="skel" style={{ height: 200 }} />;
  return <div style={{ display: 'grid', gap: 16 }}>
    <div className="banner neutral" style={{ margin: 0 }}><Icon name="info" size={16} /><span>Based on {d.totalLines} purchase order lines worth {inr(d.totalValue)}. Source: {d.source}.</span></div>
    <div className="tile-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))' }}>{d.classes.map((c: any) => <div key={c.cls} className="card stat" style={{ marginBottom: 0 }}><span className={`tag ${CLS[c.cls]?.[1] ?? ''}`}>{CLS[c.cls]?.[0] ?? c.cls}</span><div className="v">{c.lines} <small>line{c.lines === 1 ? '' : 's'}</small></div><div className="mut xsmall">{CLS[c.cls]?.[2]}</div><div className="mut">{inr(c.value)}{c.avoidable > 0 && <> · <b className="err">{inr(c.avoidable)} avoidable</b></>}</div></div>)}</div>
    <div className="card flush" style={{ overflowX: 'auto' }}><div className="sec-head" style={{ padding: 'var(--sp-4) var(--sp-5) 0' }}><h2>Opportunities</h2><span className="hint">Largest avoidable spend first</span></div><table><thead><tr><th>Item</th><th>Plant</th><th>What happened</th><th>Contract that applied</th><th className="num">Avoidable spend</th><th /></tr></thead><tbody>
      {d.opportunities.map((o: any, i: number) => <tr key={i}><td><button className="link" style={{ height: 'auto', padding: 0, textAlign: 'left' }} onClick={() => open(o.itemId)}>{o.item}</button></td><td>{o.plant}</td><td><span className={`tag ${CLS[o.cls]?.[1] ?? ''}`}>{CLS[o.cls]?.[0]}</span></td><td>{o.contractId ? <Link href={`/contracts/${o.contractId}`}>{o.contract}</Link> : '—'}<div className="mut" style={{ fontSize: 12 }}>{o.supplier}</div></td><td className="num"><b>{inr(o.avoidable)}</b></td>
        <td>{o.cls === 'coverage_gap' && o.contractId && can(me, 'contracts:approve') && <button className="sec sm" onClick={() => extend(o)}><Icon name="link" size={14} />Extend to {o.plant}</button>}</td></tr>)}
      {!d.opportunities.length && <tr><td colSpan={6}><Empty icon="checkCircle" title="No savings opportunities found"><p>Every analysed purchase was made on an applicable contract at the contract price.</p></Empty></td></tr>}</tbody></table></div></div>;
}

const TABS = [['all', 'All'], ['published', 'Live'], ['in_review', 'In review'], ['draft', 'Draft'], ['expiring', 'Ending within 90 days']] as const;

export default function Contracts() {
  const router = useRouter(); const confirmAsk = useConfirm(); const { me, notify } = useApp(); const [rows, setRows] = useState<any[] | null>(null); const [tab, setTab] = useState<string>('all'); const [q, setQ] = useState(''); const [queue, setQueue] = useState<any[]>([]); const [view, setView] = useState<'register' | 'coverage' | 'review' | 'upload'>('register');
  const [sup, setSup] = useState<any[]>([]); const [erps, setErps] = useState<any[]>([]); const [tree, setTree] = useState<any[]>([]);
  const [f, setF] = useState({ contractType: 'ARC', number: '', supplierId: '', erpSystemId: '', validFrom: '', validTo: '', scope: '' });
  const load = () => { api('/contracts').then(setRows).catch(() => setRows([])); if (can(me, 'contracts:review')) api('/review/queue').then(setQueue).catch(() => {}); };
  useEffect(() => { load(); api('/suppliers').then(setSup).catch(() => {}); api('/erp-systems').then(setErps).catch(() => {}); api('/org/tree').then(setTree).catch(() => {}); /* eslint-disable-next-line */ }, [me]);
  const shown = useMemo(() => (rows ?? []).filter((r) => (tab === 'all' || (tab === 'expiring' ? r.status === 'published' && (daysLeft(r.validTo) ?? 999) <= 90 : r.status === tab)) && (!q || `${r.number} ${r.supplier}`.toLowerCase().includes(q.toLowerCase()))), [rows, tab, q]);
  const up = async () => {
    const file = (document.getElementById('arcfile') as HTMLInputElement).files?.[0]; if (!file) { notify('Choose the contract file to upload (CSV, Excel or PDF).', { error: true }); return; }
    const fd = new FormData(); fd.append('file', file); for (const k of ['contractType', 'number', 'supplierId', 'erpSystemId', 'validFrom', 'validTo'] as const) if ((f as any)[k]) fd.append(k, (f as any)[k]); if (f.scope) fd.append('scopeNodeIds', f.scope);
    try { const r = await api('/contracts', { form: fd }); notify(r.extraction ? `Saved as a draft. ${r.error}` : `Read ${r.lines} lines · ${r.candidates} item matches to review`, { href: `/contracts/${r.id}`, label: 'Open contract' }); load(); setView(r.extraction ? 'register' : 'review'); } catch (e: any) { notify(e.message, { error: true }); }
  };
  const decide = async (id: string, decision: 'approve' | 'reject') => { try { await api(`/review/candidates/${id}/decision`, { body: { decision } }); load(); } catch (e: any) { notify(e.message, { error: true }); } };
  const rejectLine = async (id: string) => { if (!(await confirmAsk({ title: 'Exclude this contract line?', body: 'The line will never be offered to buyers. Use this for lines that are not real items, such as freight or notes.', confirm: 'Exclude line', danger: true }))) return; try { await api(`/review/lines/${id}/reject`, { body: {} }); load(); } catch (e: any) { notify(e.message, { error: true }); } };
  const staff = can(me, 'contracts:write');
  return <>
    <div className="pagehead"><div><h1>Contracts</h1><p>Rate contracts set the prices and suppliers plants can buy from. Only live contracts, within their validity and plant scope, are offered to buyers.</p></div>
      {staff && <div className="actions"><button className={view === 'upload' ? 'sec' : ''} onClick={() => setView(view === 'upload' ? 'register' : 'upload')}>{view === 'upload' ? 'Cancel upload' : <><Icon name="plus" size={16} />Upload contract</>}</button></div>}</div>
    <div className="tabs">{[['register', 'Contract register', null], ...(can(me, 'contracts:review') ? [['review', 'Lines to review', queue.length]] : [])].map(([id, l, n]: any) => <button key={id} className={`tab ${view === id ? 'on' : ''}`} onClick={() => setView(id)}>{l}{n ? <span className="cnt-n">{n}</span> : null}</button>)}</div>

    {view === 'upload' && staff && <div className="card tab-panel"><h2>Upload a contract</h2><p className="mut small">CSV and Excel files are read automatically. PDFs need the AI document reader to be configured. Every line goes to review before it can be used for buying.</p>
      <div className="form-grid">
        <label className="field"><span>Contract type</span><select value={f.contractType} onChange={(e) => setF({ ...f, contractType: e.target.value })}><option value="ARC">Annual rate contract (ARC)</option><option value="QRC">Quarterly rate contract (QRC)</option><option value="PROCMART_DIRECT">ProcMart price list</option></select></label>
        <label className="field"><span>Contract number</span><input placeholder="e.g. ARC-26-BRG-004" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} /></label>
        <label className="field"><span>Supplier</span><select value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })}><option value="">Select a supplier…</option>{sup.map((s) => <option key={s.id} value={s.id}>{s.legalName}</option>)}</select></label>
        <label className="field"><span>SAP system</span><select value={f.erpSystemId} onChange={(e) => setF({ ...f, erpSystemId: e.target.value })}><option value="">Select…</option>{erps.map((s) => <option key={s.id} value={s.id}>{s.code}{s.name ? ` · ${s.name}` : ''}</option>)}</select><span className="help">Used to match the contract’s material codes</span></label>
        <label className="field"><span>Valid from</span><input type="date" value={f.validFrom} onChange={(e) => setF({ ...f, validFrom: e.target.value })} /></label>
        <label className="field"><span>Valid to</span><input type="date" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} /></label>
        <label className="field"><span>Applies to</span><select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}><option value="">Select scope…</option>{tree.filter((n) => ['group', 'business', 'company_code', 'plant'].includes(n.levelType)).map((n) => <option key={n.id} value={n.id}>{({ group: 'Group', business: 'Business', company_code: 'Company', plant: 'Plant' } as any)[n.levelType]}: {n.name}{n.server ? ` (${n.server})` : ''}</option>)}</select></label>
        <label className="field"><span>Contract file</span><input id="arcfile" type="file" accept=".csv,.xlsx,.pdf" /></label></div>
      <button onClick={up}><Icon name="file" size={16} />Upload and read lines</button></div>}

    {view === 'coverage' && <Coverage />}
    {view === 'register' && <DataTable label="Contract register" rows={rows ? shown : null} rowKey={(r: any) => r.id} onRowClick={(r: any) => router.push(`/contracts/${r.id}`)} search={(r: any) => `${r.number ?? ''} ${r.supplier ?? ''} ${(r.appliesTo ?? []).join(' ')}`} searchPlaceholder="Contract, supplier or scope" initialSort={{ key: 'to', dir: 'asc' }}
      toolbar={<div className="seg" role="group" aria-label="Show contracts">{TABS.map(([id, l]) => <button key={id} className={tab === id ? 'on' : ''} aria-pressed={tab === id} onClick={() => setTab(id)}>{l}</button>)}</div>}
      cols={[{ key: 'number', label: 'Contract', sort: (r: any) => r.number, render: (r: any) => <><Link href={`/contracts/${r.id}`}><b>{r.number || 'Untitled'}</b></Link><div className="mut xsmall">{r.type === 'PROCMART_DIRECT' ? 'ProcMart price list' : r.type === 'QRC' ? 'Quarterly rate contract' : 'Annual rate contract'}</div></> },
        { key: 'supplier', label: 'Supplier', sort: (r: any) => r.supplier, render: (r: any) => r.supplier ?? '—' },
        { key: 'scope', label: 'Applies to', render: (r: any) => <span className="mut">{(r.appliesTo ?? []).join(', ') || '—'}</span>, hideBelow: 'lg' },
        { key: 'to', label: 'Valid until', sort: (r: any) => r.validTo, render: (r: any) => { const d = daysLeft(r.validTo); return <>{dmy(r.validTo)}{r.status === 'published' && d !== null && d <= 90 && <div><span className={`tag ${d <= 30 ? 'bad' : 'warn'}`}>{d < 0 ? 'Ended' : `Ends in ${d} days`}</span></div>}</>; } },
        { key: 'lines', label: 'Lines', num: true, sort: (r: any) => Number(r.lines), render: (r: any) => r.lines, hideBelow: 'md' },
        { key: 'use', label: 'Quantity used', num: true, sort: (r: any) => r.utilisation, width: 170, title: 'Ordered quantity against the contract’s quantity caps', render: (r: any) => r.utilisation == null ? <span className="mut">No cap</span> : <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}><div className="bar" style={{ width: 80 }}><i style={{ width: `${Math.min(100, r.utilisation)}%`, background: r.utilisation >= 90 ? 'var(--bad)' : r.utilisation >= 70 ? 'var(--warn)' : 'var(--pri)' }} /></div><span style={{ minWidth: 40 }}>{r.utilisation}%</span></div> },
        { key: 'status', label: 'Status', sort: (r: any) => r.status, render: (r: any) => <span className={`tag ${(CONTRACT_STATUS[r.status] ?? ['', ''])[1]}`}>{(CONTRACT_STATUS[r.status] ?? [r.status])[0]}</span> }]}
      empty={tab !== 'all' ? { icon: 'file', title: 'No contracts in this view', text: 'Choose “All” to see every contract.', action: <button className="sec sm" onClick={() => setTab('all')}>Show all contracts</button> } : { icon: 'file', title: 'No contracts yet', text: 'Upload your first rate contract to start offering contract prices to plants.' }} />}
    {view === 'review' && can(me, 'contracts:review') && <div className="card tab-panel flush"><div style={{ padding: 'var(--sp-4) var(--sp-5) 0' }}><h2>Lines to review</h2><p className="mut small">Each contract line must be matched to a catalogue item by a person before it can be used. Suggestions change nothing on their own.</p></div>
      <div style={{ overflowX: 'auto' }}><table><thead><tr><th>Contract line</th><th>Price</th><th>Suggested catalogue item</th><th /></tr></thead><tbody>
        {queue.map((l) => <tr key={l.lineId}><td><b>{l.contractNumber} · line {l.lineNo}</b> <span className="mut xsmall">{l.sourceRef}</span><div>{l.description}</div><div className="mut xsmall">{[l.materialCode && `Code ${l.materialCode}`, l.brand, l.mpn].filter(Boolean).join(' · ') || 'No code, brand or part number'}</div>{l.issues?.length > 0 && <div className="err xsmall">{l.issues.join(', ')}</div>}</td><td className="nowrap">{l.netPrice != null ? `₹${l.netPrice}` : 'Price missing'} / {l.uom ?? 'unit missing'}</td>
          <td>{l.candidates.length ? l.candidates.map((c: any) => <div key={c.id} className="row"><span style={{ flex: 1 }}>{c.itemName}<div className="mut xsmall">Matched by {c.basis.replace(/_/g, ' ')}</div></span><button className="sm" onClick={() => decide(c.id, 'approve')}>Confirm match</button><button className="sec sm" onClick={() => decide(c.id, 'reject')}>Not this item</button></div>) : <span className="mut small">No catalogue item suggested</span>}</td><td><button className="sec sm" onClick={() => rejectLine(l.lineId)}>Exclude line</button></td></tr>)}
        {!queue.length && <tr><td colSpan={4}><Empty icon="checkCircle" title="Nothing to review"><p>Lines from newly uploaded contracts appear here for matching.</p></Empty></td></tr>}</tbody></table></div></div>}
  </>;
}
