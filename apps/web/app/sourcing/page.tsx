'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Empty } from '../../components/Ui';
import { DataTable } from '../../components/DataTable';
import { Icon } from '../../components/Icon';
import { can, useApp } from '../shell';
import { num, RFQ_STATUS } from '../../lib/format';


export default function Sourcing() {
  const { me, notify } = useApp(); const [pending, setPending] = useState<any[] | null>(null); const [rfqs, setRfqs] = useState<any[] | null>(null); const [sup, setSup] = useState<any[]>([]);
  const [req, setReq] = useState(''); const [lines, setLines] = useState<string[]>([]); const [sel, setSel] = useState<string[]>([]); const [busy, setBusy] = useState(false);
  const staff = can(me, 'buying:source');
  const load = () => { if (staff) api('/sourcing/pending').then(setPending).catch(() => setPending([])); else setPending([]); api('/rfqs').then(setRfqs).catch(() => setRfqs([])); };
  useEffect(load, [me]); // eslint-disable-line
  useEffect(() => { if (req) api(`/rfqs/suggest-suppliers?requirementId=${req}`).then(setSup).catch((e) => notify(e.message, { error: true })); }, [req]); // eslint-disable-line
  const byReq = (pending ?? []).reduce((m: Record<string, any[]>, p) => ((m[p.requirementId] ??= []).push(p), m), {});
  const create = async () => { setBusy(true); try { const r = await api('/rfqs', { body: { requirementId: req, requirementLineIds: lines, supplierIds: sel } }); notify(`Request for quotation ${r.number ?? ''} created`); window.location.href = `/sourcing/${r.id}`; } catch (e: any) { notify(e.message, { error: true }); setBusy(false); } };
  return <>
    <div className="pagehead"><div><h1>Sourcing</h1><p>Items with no applicable contract go out for quotes. Group the lines, invite eligible suppliers, compare landed cost and award.</p></div></div>
    {staff && <section className="card"><div className="sec-head"><div className="title-row"><h2>Waiting for quotes</h2><span className="tag">{pending?.length ?? 0} lines</span></div><span className="hint">Select lines from one requirement to start a request for quotation</span></div>
      {!pending ? <div className="skel" style={{ height: 80 }} /> : !pending.length ? <Empty icon="checkCircle" title="Nothing is waiting to be sourced"><p>Lines without a usable contract appear here as soon as a requester submits them.</p></Empty>
        : <div className="split split-narrow">
          <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>{Object.entries(byReq).map(([rid, ls]) => <div key={rid} style={{ border: '1px solid var(--bd)', borderRadius: 'var(--r)', padding: 'var(--sp-3) var(--sp-4)', background: req === rid ? 'var(--pri-soft)' : '#fff' }}>
            <div className="row" style={{ marginBottom: 6 }}><Link href={`/requirements/${rid}`}><b>{ls[0].number}</b></Link><span className="mut small">{ls[0].plant}</span></div>
            {ls.map((l) => <label key={l.lineId} className="fopt" style={{ fontSize: 'var(--fs-base)' }}><input type="checkbox" checked={req === rid && lines.includes(l.lineId)} onChange={(e) => { if (req !== rid) { setReq(rid); setLines([l.lineId]); setSel([]); } else setLines(e.target.checked ? [...lines, l.lineId] : lines.filter((x) => x !== l.lineId)); }} /><span>{l.item} · {num(l.qty)} {l.uom}{(l.requested || l.intent === 'source') && <span className="tag warn" style={{ marginLeft: 6 }}>{l.requested ? 'Non-catalogue' : 'Sourcing requested'}</span>}{(l.note || l.itemNote) && <div className="mut xsmall">{l.note || l.itemNote}</div>}</span></label>)}</div>)}</div>
          <div className="card flat" style={{ margin: 0, background: 'var(--surface2)' }}><h3 style={{ marginBottom: 'var(--sp-2)' }}>Invite suppliers</h3>
            {!req ? <p className="mut small" style={{ margin: 0 }}>Select one or more lines to see which suppliers can quote for that plant.</p> : <>
              <p className="mut xsmall">Only active suppliers with a vendor code on this plant’s SAP system are eligible. ProcMart appears only when the customer allows it to bid.</p>
              {sup.map((s) => <label key={s.id} className="fopt"><input type="checkbox" checked={sel.includes(s.id)} onChange={(e) => setSel(e.target.checked ? [...sel, s.id] : sel.filter((x) => x !== s.id))} /><span>{s.legalName}</span>{s.isProcmart && <span className="tag">ProcMart</span>}</label>)}
              {!sup.length && <p className="mut small">No supplier is eligible for this plant yet. Add a vendor code under Administration.</p>}
              <button className={`block ${busy ? 'busy' : ''}`} style={{ marginTop: 'var(--sp-3)', width: '100%' }} disabled={!lines.length || !sel.length || busy} onClick={create}>Send request for quotation ({sel.length} supplier{sel.length === 1 ? '' : 's'})</button></>}</div></div>}</section>}
    <h2 style={{ margin: 'var(--sp-6) 0 var(--sp-3)' }}>Requests for quotation</h2>
    <DataTable label="Requests for quotation" rows={rfqs} rowKey={(r: any) => r.id} onRowClick={(r: any) => { window.location.href = `/sourcing/${r.id}`; }} search={(r: any) => `${r.number} ${r.requirement} ${r.plant} ${(RFQ_STATUS[r.status] ?? [r.status])[0]}`} searchPlaceholder="RFQ, requirement or plant"
      cols={[{ key: 'number', label: 'RFQ', sort: (r: any) => r.number, render: (r: any) => <Link href={`/sourcing/${r.id}`}><b>{r.number}</b></Link> },
        { key: 'req', label: 'Requirement', sort: (r: any) => r.requirement, render: (r: any) => r.requirement },
        { key: 'plant', label: 'Plant', sort: (r: any) => r.plant, render: (r: any) => r.plant, hideBelow: 'md' },
        { key: 'quotes', label: 'Quotes received', num: true, sort: (r: any) => Number(r.quotes), render: (r: any) => <>{r.quotes} of {r.invited}{Number(r.quotes) < Number(r.minQuotes) && <div className="mut xsmall">needs {r.minQuotes}</div>}</> },
        { key: 'status', label: 'Status', sort: (r: any) => (RFQ_STATUS[r.status] ?? [r.status])[0], render: (r: any) => { const st = RFQ_STATUS[r.status] ?? [r.status, '']; return <span className={`tag ${st[1]}`}>{st[0]}</span>; } }]}
      empty={{ icon: 'handshake', title: 'No requests for quotation yet', text: staff ? 'Start one from the lines waiting for quotes above.' : 'Requests for quotation raised by procurement appear here.' }} /></>;
}
