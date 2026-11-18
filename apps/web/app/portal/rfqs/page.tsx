'use client';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { Icon } from '../../../components/Icon';
import { Empty } from '../../../components/Ui';
import { useApp } from '../../shell';
export default function PortalRfqs() {
  const [rows, setRows] = useState<any[] | null>(null); const [v, setV] = useState<Record<string, { p: string; f: string; d: string }>>({}); const { notify } = useApp();
  const load = () => api('/portal/rfqs').then(setRows).catch(() => setRows([])); useEffect(() => { load(); }, []);
  const set = (id: string, k: 'p' | 'f' | 'd', x: string) => setV({ ...v, [id]: { ...({ p: '', f: '', d: '' }), ...v[id], [k]: x } });
  const send = async (r: any) => { try { await api(`/portal/rfqs/${r.id}/quote`, { body: { lines: r.lines.filter((l: any) => v[l.id]?.p).map((l: any) => ({ rfqLineId: l.id, unitPrice: Number(v[l.id].p), freightPerUnit: Number(v[l.id].f || 0), leadTimeDays: v[l.id].d ? Number(v[l.id].d) : undefined, uom: l.uom })) } }); notify('Quotation submitted — the buyer has been notified'); load(); } catch (e: any) { notify(e.message, { error: true }); } };
  return <><div className="pagehead"><div><h1>Requests for quotation</h1><p>Only requests you were invited to are shown. Other suppliers never see your prices.</p></div></div>
    {rows?.map((r) => <div className="card" key={r.id}><div className="sec-head"><h2>{r.number}</h2>{r.quoted ? <span className="tag ok"><Icon name="check" size={13} />Quotation sent</span> : <span className="tag warn">Awaiting your quotation</span>}</div>
      {r.lines.map((l: any) => <div className="form-grid" key={l.id} style={{ gridTemplateColumns: 'minmax(220px,1.4fr) repeat(3,minmax(140px,1fr))', alignItems: 'end' }}><div className="field"><span>Item</span><div style={{ minHeight: 'var(--h-md)', display: 'flex', alignItems: 'center' }}><b>{l.item}</b>&nbsp;<span className="mut">· {Number(l.qty).toLocaleString('en-IN')} {l.uom}</span></div></div>{!r.quoted && <><label className="field"><span>Unit price (₹)</span><input type="number" min={0} placeholder="0.00" value={v[l.id]?.p ?? ''} onChange={(e) => set(l.id, 'p', e.target.value)} /></label><label className="field"><span>Freight per unit (₹)</span><input type="number" min={0} placeholder="0.00" value={v[l.id]?.f ?? ''} onChange={(e) => set(l.id, 'f', e.target.value)} /></label><label className="field"><span>Lead time (days)</span><input type="number" min={0} placeholder="e.g. 10" value={v[l.id]?.d ?? ''} onChange={(e) => set(l.id, 'd', e.target.value)} /></label></>}</div>)}
      {!r.quoted && <button disabled={!r.lines.some((l: any) => v[l.id]?.p)} onClick={() => send(r)}>Send quotation</button>}</div>)}
    {rows && !rows.length && <div className="card"><Empty icon="inbox" title="No open requests for quotation"><p>When a buyer invites you to quote, the request appears here and you’ll also receive it by email.</p></Empty></div>}</>;
}
