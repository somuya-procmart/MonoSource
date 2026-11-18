'use client';
import Link from 'next/link';
import { use, useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { can, useApp } from '../../shell';
import { Icon } from '../../../components/Icon';
import { SupplierDrawer } from '../../../components/SupplierDrawer';
import { useOpenProduct } from '../../../components/ProductPanel';
import { CONTRACT_STATUS, dmy, num, price } from '../../../lib/format';
import { useConfirm } from '../../../components/Confirm';

const TYPE: Record<string, string> = { ARC: 'Annual rate contract', QRC: 'Quarterly rate contract', PROCMART_DIRECT: 'ProcMart price list' };
const LINE: Record<string, [string, string]> = { extracted: ['To review', 'warn'], needs_review: ['To review', 'warn'], approved: ['Approved', 'ok'], published: ['Live', 'ok'], rejected: ['Rejected', 'bad'] };
const LEVEL: Record<string, string> = { group: 'Group', business: 'Business', company_code: 'Company', plant: 'Plant', delivery_point: 'Delivery point' };

export default function ContractDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const ask = useConfirm(); const { me, notify } = useApp(); const [c, setC] = useState<any>(null); const [err, setErr] = useState(''); const [problems, setProblems] = useState<any[] | null>(null);
  const [sup, setSup] = useState(false); const { open } = useOpenProduct(); const [busy, setBusy] = useState('');
  const [hd, setHd] = useState<{ number: string; validFrom: string; validTo: string }>({ number: '', validFrom: '', validTo: '' });
  const load = () => api(`/contracts/${id}`).then(setC).catch((e) => setErr(e.message));
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);
  const run = async (key: string, f: () => Promise<any>, ok: string) => { setBusy(key); setProblems(null); try { await f(); notify(ok); await load(); } catch (e: any) { if (Array.isArray(e.body?.problems)) setProblems(e.body.problems); else notify(e.message, { error: true }); } finally { setBusy(''); } };
  if (err) return <div className="card"><div className="empty"><b>We couldn’t open this contract</b><p>{err}</p><div className="acts"><Link href="/contracts" className="btn sec sm">Back to contracts</Link></div></div></div>;
  if (!c) return <div style={{ display: 'grid', gap: 12 }}><div className="skel" style={{ height: 70 }} /><div className="skel" style={{ height: 160 }} /><div className="skel" style={{ height: 260 }} /></div>;
  const st = CONTRACT_STATUS[c.status] ?? [c.status, '']; const editable = (c.status === 'draft' || c.status === 'in_review') && can(me, 'contracts:write');
  const sg = c.extractionRuns.map((r: any) => r.stats?.header).find(Boolean); const last = c.extractionRuns.at(-1);
  const toReview = c.lines.filter((l: any) => ['extracted', 'in_review'].includes(l.status)).length;
  return <>
    <div className="crumbs"><Link href="/contracts">Contracts</Link>›<b>{c.number || 'Untitled contract'}</b></div>
    <div className="pagehead"><div><div className="title-row"><h1>{c.number || 'Untitled contract'}</h1><span className={`tag lg ${st[1]}`}>{st[0]}</span></div>
      <p>{TYPE[c.contract_type] ?? c.contract_type} · {c.supplier_id ? <button className="link" style={{ height: 'auto', padding: 0 }} onClick={() => setSup(true)}>{c.supplier_name}</button> : 'No supplier set'} · valid {dmy(c.valid_from)} to {dmy(c.valid_to)}</p></div>
      <div className="actions">
        {can(me, 'contracts:approve') && c.status === 'in_review' && <button className={busy === 'approve' ? 'busy' : ''} disabled={!!busy} onClick={async () => { if (await ask({ title: `Approve ${c.number || 'this contract'}?`, body: 'Approval confirms the supplier, prices, validity and plant scope. It still has to be made live before buyers can use it.', confirm: 'Approve contract' })) run('approve', () => api(`/contracts/${id}/approve`, { method: 'POST', body: {} }), 'Contract approved'); }}>Approve contract</button>}
        {can(me, 'contracts:publish') && c.status === 'approved' && <button className={busy === 'publish' ? 'busy' : ''} disabled={!!busy} onClick={async () => { if (await ask({ title: `Make ${c.number || 'this contract'} live?`, body: `Buyers at ${c.scopes.map((s: any) => s.name).join(', ') || 'the plants in scope'} will see these prices immediately and can raise requirements against them.`, confirm: 'Make live' })) run('publish', () => api(`/contracts/${id}/publish`, { method: 'POST', body: {} }), 'Contract is live — plants in scope can now buy on it'); }}>Make live for buying</button>}</div></div>

    {problems && <div className="banner bad"><Icon name="alert" size={16} /><div><b>This contract can’t move forward yet:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{problems.map((p: any, i: number) => <li key={i}>{p.message}</li>)}</ul></div></div>}

    <section className="card"><dl className="kv">
      <dt>Applies to</dt><dd>{c.scopes.length ? c.scopes.map((s: any) => `${LEVEL[s.level_type] ?? s.level_type}: ${s.name}`).join(' · ') : <span className="err">No plants yet — a contract needs at least one scope before it can be approved</span>}</dd>
      <dt>Source document</dt><dd>{c.filename ?? '—'}</dd>
      <dt>Lines</dt><dd>{c.lines.length} line{c.lines.length === 1 ? '' : 's'}{toReview > 0 && <span className="tag warn" style={{ marginLeft: 8 }}>{toReview} to review</span>}</dd>
      <dt>Read by</dt><dd className="mut" style={{ fontWeight: 400 }}>{last ? `${/csv|xlsx|sheet|rule/i.test(last.provider) ? 'Spreadsheet reader' : 'AI document reader'} · ${last.status === 'succeeded' ? 'completed' : last.status}${last.error ? ` — ${last.error}` : ''}` : 'Not read yet'}</dd></dl>
      {c.status === 'draft' && c.lines.length === 0 && can(me, 'contracts:write') && <div className="banner" style={{ margin: 'var(--sp-4) 0 0' }}><Icon name="alert" size={16} /><span style={{ flex: 1 }}>No lines could be read from the document{last?.error ? `: ${last.error}` : '.'}</span><button className={`sec sm ${busy === 'x' ? 'busy' : ''}`} onClick={() => run('x', () => api(`/contracts/${id}/extract`, { method: 'POST', body: {} }), 'Document read again')}><Icon name="refresh" size={14} />Read the document again</button></div>}
      {editable && <div style={{ marginTop: 'var(--sp-5)', paddingTop: 'var(--sp-4)', borderTop: '1px solid var(--bd)' }}><h3 style={{ marginBottom: 'var(--sp-2)' }}>Contract details</h3>
        {sg && <div className="banner info"><Icon name="sparkles" size={16} /><span style={{ flex: 1 }}>Suggested from the document — not applied until you save: {[sg.contractNumber && `number ${sg.contractNumber}`, sg.validFrom && `from ${dmy(sg.validFrom)}`, sg.validTo && `to ${dmy(sg.validTo)}`].filter(Boolean).join(' · ')}</span><button className="sec sm" onClick={() => setHd({ number: sg.contractNumber ?? '', validFrom: sg.validFrom ?? '', validTo: sg.validTo ?? '' })}>Use suggestion</button></div>}
        <div className="form-grid" style={{ alignItems: 'end' }}><label className="field"><span>Contract number</span><input placeholder={c.number || 'e.g. ARC-26-BRG-001'} value={hd.number} onChange={(e) => setHd({ ...hd, number: e.target.value })} /></label>
          <label className="field"><span>Valid from</span><input type="date" value={hd.validFrom} onChange={(e) => setHd({ ...hd, validFrom: e.target.value })} /></label>
          <label className="field"><span>Valid to</span><input type="date" value={hd.validTo} onChange={(e) => setHd({ ...hd, validTo: e.target.value })} /></label>
          <div className="field"><button className={busy === 'h' ? 'busy' : ''} disabled={!Object.values(hd).some(Boolean) || !!busy} onClick={() => run('h', () => api(`/contracts/${id}/header`, { body: Object.fromEntries(Object.entries(hd).filter(([, v]) => v)) }), 'Contract details saved')}>Save details</button></div></div></div>}</section>

    <section className="card flush"><div className="sec-head" style={{ padding: 'var(--sp-4) var(--sp-5) 0' }}><h2>Contract lines</h2>{toReview > 0 && can(me, 'contracts:review') && <Link href="/contracts" className="btn sec sm">Open review queue</Link>}</div>
      <div style={{ overflowX: 'auto' }}><table><thead><tr><th className="num">#</th><th>Description</th><th>Unit</th><th className="num">Net price</th><th className="num">Min. order</th><th className="num">Quantity cap</th><th className="num">Read confidence</th><th>Status</th><th>Catalogue item</th></tr></thead><tbody>
        {c.lines.map((l: any) => { const ls = LINE[l.status] ?? [l.status, '']; const conf = Number(l.extraction_confidence); return <tr key={l.id}><td className="num mut">{l.line_no}</td><td><b>{l.description}</b><div className="mut xsmall">{[l.material_code && `Code ${l.material_code}`, l.brand, l.mpn].filter(Boolean).join(' · ')}{l.source_ref && ` · ${l.source_ref}`}</div></td><td>{l.uom}</td><td className="num">{price(l.net_price)}</td><td className="num">{l.moq != null ? num(l.moq) : '—'}</td><td className="num">{l.qty_cap != null ? num(l.qty_cap) : '—'}</td>
          <td className="num">{isNaN(conf) ? '—' : <span className={conf < 0.7 ? 'err' : ''}>{Math.round(conf * (conf <= 1 ? 100 : 1))}%</span>}</td><td><span className={`tag ${ls[1]}`}>{ls[0]}</span></td>
          <td>{l.item_id ? <button className="sec sm" onClick={() => open(l.item_id)}>View item</button> : l.candidates.length ? <span className="mut xsmall">Suggested: {l.candidates.map((x: any) => x.itemName).join(', ')}</span> : <span className="mut xsmall">Not matched</span>}</td></tr>; })}
        {!c.lines.length && <tr><td colSpan={9}><div className="empty"><b>No lines yet</b><p>Lines appear here once the contract document has been read.</p></div></td></tr>}</tbody></table></div></section>
    {sup && c.supplier_id && <SupplierDrawer id={c.supplier_id} onClose={() => setSup(false)} />}</>;
}
