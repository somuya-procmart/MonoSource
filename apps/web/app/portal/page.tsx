'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Icon } from '../../components/Icon';
import { Empty } from '../../components/Ui';
export const STATUS_LABEL: Record<string, string> = { po_released: 'Needs your acknowledgement', acknowledged: 'Ready to dispatch', partially_dispatched: 'Partly dispatched', dispatched: 'Dispatched', partially_received: 'Partly received', grn_posted: 'Ready to invoice', invoiced: 'Invoiced', paid: 'Paid', delivered: 'Delivered' };
const ACTION = ['po_released', 'acknowledged', 'partially_dispatched', 'grn_posted'];
export default function PortalHome() {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { api('/portal/orders').then(setRows).catch(() => setRows([])); }, []);
  const todo = rows?.filter((r) => ACTION.includes(r.status)) ?? [];
  return <><div className="pagehead"><div><h1>Your orders</h1><p>Purchase orders placed with you. Confirm, dispatch and invoice from here.</p></div></div>
    {todo.length > 0 && <div className="banner"><Icon name="alert" size={16} /><span><b>{todo.length}</b> order{todo.length === 1 ? ' needs' : 's need'} your action.</span></div>}
    <div className="card flush"><table><thead><tr><th>PO</th><th>Requirement</th><th>Deliver to</th><th>Lines</th><th>Status</th></tr></thead><tbody>
      {rows?.map((r) => <tr key={r.id}><td><Link href={`/portal/orders/${r.id}`}><b>{r.poReference ?? '—'}</b></Link></td><td>{r.requirement}</td><td>{r.plant}</td><td>{r.lines}</td><td><span className={`tag ${ACTION.includes(r.status) ? 'warn' : ''}`}>{STATUS_LABEL[r.status] ?? r.status}</span></td></tr>)}
      {rows && !rows.length && <tr><td colSpan={5}><Empty icon="truck" title="No orders yet"><p>When a buyer places a purchase order with you, it appears here.</p></Empty></td></tr>}</tbody></table></div></>;
}
