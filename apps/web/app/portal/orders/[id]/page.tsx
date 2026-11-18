'use client';
import { use, useEffect, useState } from 'react';
import { api } from '../../../../lib/api';
import { STATUS_LABEL } from '../../page';
export default function PortalOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const [o, setO] = useState<any>(null); const [toast, setToast] = useState<{ t: string; e?: boolean } | null>(null);
  const [ack, setAck] = useState<Record<string, string>>({}); const [disp, setDisp] = useState<Record<string, string>>({}); const [ship, setShip] = useState({ carrier: '', trackingRef: '', invoiceNumber: '', ewayBill: '', expectedDate: '' }); const [inv, setInv] = useState({ invoiceNumber: '', amount: '' });
  const load = () => api(`/portal/orders/${id}`).then(setO).catch((e) => setToast({ t: e.message, e: true }));
  useEffect(() => { load(); }, [id]); // eslint-disable-line
  const run = async (f: () => Promise<any>, ok: string) => { setToast(null); try { await f(); setToast({ t: ok }); load(); } catch (e: any) { setToast({ t: e.message, e: true }); } };
  if (!o) return <p className="mut">{toast?.t ?? 'Loading…'}</p>;
  const s = o.status;
  return <><div className="title-row"><h1>{o.poReference ?? 'Order'}</h1><span className="tag">{STATUS_LABEL[s] ?? s}</span></div><p className="mut">Deliver to {o.deliverTo}</p>
    {toast && <div className={`toast ${toast.e ? 'e' : ''}`}>{toast.t}</div>}
    <div className="card"><h2>Items</h2><table><thead><tr><th>Item</th><th>Ordered</th><th>Price</th><th>You committed</th><th>Dispatched</th><th>Received</th><th>Rejected</th></tr></thead><tbody>
      {o.lines.map((l: any) => <tr key={l.id}><td><b>{l.item}</b></td><td>{Number(l.ordered)} {l.uom}</td><td>₹{Number(l.unitPrice).toLocaleString('en-IN')}</td><td>{l.committed ?? '—'}</td><td>{l.dispatched}</td><td>{l.received}</td><td>{l.rejected}</td></tr>)}</tbody></table></div>

    {s === 'po_released' && <div className="card"><h2>Confirm this order</h2><p className="mut" style={{ marginTop: -6 }}>Enter how much you can supply. Anything less than ordered goes to the buyer to decide.</p>
      {o.lines.map((l: any) => <div className="row" key={l.id}><b style={{ minWidth: 200 }}>{l.item}</b><input type="number" min={0} max={l.ordered} placeholder={`Qty (max ${l.ordered})`} value={ack[l.id] ?? ''} onChange={(e) => setAck({ ...ack, [l.id]: e.target.value })} /></div>)}
      <div className="row"><button className="btn sm" onClick={() => run(() => api(`/portal/orders/${id}/acknowledge`, { body: { lines: o.lines.map((l: any) => ({ lineId: l.id, qty: Number(ack[l.id] ?? l.ordered) })) } }), 'Order acknowledged')}>Confirm {Object.keys(ack).length ? 'quantities' : 'full quantity'}</button></div></div>}

    {['acknowledged', 'partially_dispatched', 'partially_received'].includes(s) && <div className="card"><h2>Dispatch goods</h2><p className="mut" style={{ marginTop: -6 }}>You can ship in several lots.</p>
      {o.lines.filter((l: any) => (l.committed ?? 0) - l.dispatched > 0).map((l: any) => <div className="row" key={l.id}><b style={{ minWidth: 200 }}>{l.item}</b><input type="number" min={0} placeholder={`Qty (left ${l.committed - l.dispatched})`} value={disp[l.id] ?? ''} onChange={(e) => setDisp({ ...disp, [l.id]: e.target.value })} /></div>)}
      <div className="row">{(['carrier', 'trackingRef', 'invoiceNumber', 'ewayBill'] as const).map((k) => <input key={k} placeholder={{ carrier: 'Carrier', trackingRef: 'Tracking no.', invoiceNumber: 'Invoice no.', ewayBill: 'E-way bill' }[k]} value={ship[k]} onChange={(e) => setShip({ ...ship, [k]: e.target.value })} />)}<input type="date" value={ship.expectedDate} onChange={(e) => setShip({ ...ship, expectedDate: e.target.value })} /></div>
      <button className="btn sm" onClick={() => run(() => api(`/portal/orders/${id}/dispatch`, { body: { ...Object.fromEntries(Object.entries(ship).filter(([, v]) => v)), lines: Object.entries(disp).filter(([, v]) => Number(v) > 0).map(([lineId, v]) => ({ lineId, qty: Number(v) })) } }).then(() => setDisp({})), 'Dispatch recorded')}>Record dispatch</button></div>}

    {s === 'grn_posted' && <div className="card"><h2>Submit your invoice</h2><div className="row"><input placeholder="Invoice number" value={inv.invoiceNumber} onChange={(e) => setInv({ ...inv, invoiceNumber: e.target.value })} /><input type="number" placeholder="Amount ₹" value={inv.amount} onChange={(e) => setInv({ ...inv, amount: e.target.value })} />
      <button className="btn sm" onClick={() => run(() => api(`/portal/orders/${id}/invoice`, { body: { invoiceNumber: inv.invoiceNumber, amount: Number(inv.amount) } }), 'Invoice submitted')}>Submit</button></div></div>}

    {(o.shipments.length > 0 || o.invoices.length > 0) && <div className="card"><h2>History</h2>{o.shipments.map((x: any) => <div key={x.asn}>{x.asn} · {x.carrier ?? 'carrier —'} {x.trackingRef ?? ''} · {new Date(x.at).toLocaleString()}</div>)}{o.invoices.map((x: any) => <div key={x.invoiceNumber}>Invoice {x.invoiceNumber} · ₹{x.amount} · <span className="tag">{x.status}</span></div>)}</div>}</>;
}
