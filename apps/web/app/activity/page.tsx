'use client';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';
import { useApp } from '../shell';
import { Empty } from '../../components/Ui';
import { AttentionBoard, useTasks } from '../../components/AttentionBoard';
import { DataTable } from '../../components/DataTable';
import { ProductCard } from '../../components/ProductBits';
import { STATUS_TONE, ago, dmy, inr, statusLabel } from '../../lib/format';
import { Icon } from '../../components/Icon';

function Activity() {
  const sp = useSearchParams(); const router = useRouter(); const { plant } = useApp(); const tab = sp.get('tab') ?? 'attention'; const { d: tasks, load: loadTasks } = useTasks(); const f = sp.get('f') ?? 'all';
  const [reqs, setReqs] = useState<any[] | null>(null); const [orders, setOrders] = useState<any[] | null>(null); const [saved, setSaved] = useState<any[] | null>(null);
  useEffect(() => { const l = () => { api('/requirements').then(setReqs).catch(() => setReqs([])); api('/orders').then(setOrders).catch(() => setOrders([])); }; l(); const t = setInterval(l, 8000); return () => clearInterval(t); }, []);
  useEffect(() => { api(`/saved${plant ? `?plantId=${plant}` : ''}`).then(setSaved).catch(() => setSaved([])); }, [plant]);
  const go = (t: string) => router.replace(`/activity?tab=${t}`);
  const late = (o: any) => ['dispatched', 'partially_dispatched', 'partially_received'].includes(o.status) && o.expectedDate && new Date(o.expectedDate) < new Date(new Date().toDateString());
  const shownOrders = (orders ?? []).filter((o) => f === 'late' ? late(o) : true);
  return <><div className="pagehead"><div><h1>My activity</h1><p>What needs you, what you’ve asked for, the orders it became, and items you saved.</p></div><div className="actions"><Link href="/" className="btn"><Icon name="plus" size={16} />New requirement</Link></div></div>
    <div className="tabs">{[['attention', 'Needs me', tasks?.counts?.needsMe], ['requirements', 'Requirements', reqs?.length], ['orders', 'Orders', orders?.length], ['saved', 'Saved items', saved?.length]].map(([id, l, n]: any) => <button key={id} className={`tab ${tab === id ? 'on' : ''}`} onClick={() => go(id)}>{l}{n ? <span className="cnt-n">{n}</span> : null}</button>)}</div>
    {tab === 'attention' && <AttentionBoard d={tasks} load={loadTasks} who="requester" />}
    {tab === 'requirements' && <DataTable label="Requirements" rows={reqs} rowKey={(r: any) => r.id} onRowClick={(r: any) => router.push(`/requirements/${r.id}`)} search={(r: any) => `${r.number} ${r.plant} ${r.requester} ${statusLabel(r.status)}`} searchPlaceholder="Number, plant or person" initialSort={{ key: 'created', dir: 'desc' }}
      cols={[{ key: 'number', label: 'Requirement', sort: (r: any) => r.number, render: (r: any) => <Link href={`/requirements/${r.id}`}><b>{r.number}</b></Link> },
        { key: 'plant', label: 'Plant', sort: (r: any) => r.plant, render: (r: any) => r.plant },
        { key: 'requester', label: 'Raised by', sort: (r: any) => r.requester, render: (r: any) => r.requester, hideBelow: 'md' },
        { key: 'lines', label: 'Lines', num: true, sort: (r: any) => Number(r.lines), render: (r: any) => r.lines },
        { key: 'streams', label: 'Orders', num: true, sort: (r: any) => Number(r.streams), render: (r: any) => r.streams, hideBelow: 'md' },
        { key: 'status', label: 'Status', sort: (r: any) => statusLabel(r.status), render: (r: any) => <span className={`tag ${STATUS_TONE(r.status)}`}>{statusLabel(r.status)}</span> },
        { key: 'created', label: 'Raised', sort: (r: any) => new Date(r.createdAt).getTime(), render: (r: any) => <span title={dmy(r.createdAt)}>{ago(r.createdAt)}</span> }]}
      empty={{ icon: 'list', title: 'No requirements yet', text: 'Search for an item or ask MonoSource to raise your first requirement.', action: <Link href="/" className="btn sm">Find an item</Link> }} />}
    {tab === 'orders' && <DataTable label="Orders" rows={orders ? shownOrders : null} rowKey={(o: any) => o.id} onRowClick={(o: any) => router.push(`/orders/${o.id}`)} search={(o: any) => `${o.po ?? ''} ${o.pr ?? ''} ${o.requirement} ${o.supplier ?? ''} ${statusLabel(o.status)}`} searchPlaceholder="PO, requirement or supplier" initialSort={{ key: 'expected', dir: 'asc' }}
      toolbar={<div className="seg" role="group" aria-label="Show"><button className={f !== 'late' ? 'on' : ''} aria-pressed={f !== 'late'} onClick={() => router.replace('/activity?tab=orders')}>All orders</button><button className={f === 'late' ? 'on' : ''} aria-pressed={f === 'late'} onClick={() => router.replace('/activity?tab=orders&f=late')}>Running late</button></div>}
      cols={[{ key: 'po', label: 'PO / requisition', sort: (o: any) => o.po ?? o.pr, render: (o: any) => <Link href={`/orders/${o.id}`}><b>{o.po ?? o.pr ?? 'Not yet in SAP'}</b></Link> },
        { key: 'req', label: 'Requirement', sort: (o: any) => o.requirement, render: (o: any) => <Link href={`/requirements/${o.requirementId}`}>{o.requirement}</Link>, hideBelow: 'md' },
        { key: 'supplier', label: 'Supplier', sort: (o: any) => o.supplier, render: (o: any) => o.supplier ?? '—' },
        { key: 'value', label: 'Value (₹)', num: true, sort: (o: any) => Number(o.value ?? 0), render: (o: any) => inr(o.value).replace('₹', '') },
        { key: 'expected', label: 'Expected', sort: (o: any) => o.expectedDate ? new Date(o.expectedDate).getTime() : null, render: (o: any) => <span className={late(o) ? 'err' : ''}>{o.expectedDate ? dmy(o.expectedDate) : '—'}{late(o) && <span className="tag bad" style={{ marginLeft: 6 }}>Late</span>}</span> },
        { key: 'status', label: 'Status', sort: (o: any) => statusLabel(o.status), render: (o: any) => <span className={`tag ${STATUS_TONE(o.status)}`}>{statusLabel(o.status)}</span> }]}
      empty={f === 'late' ? { icon: 'checkCircle', title: 'Nothing is running late', text: 'Every open order is within its expected delivery date.' } : { icon: 'truck', title: 'No orders yet', text: 'Orders appear once a requirement is approved in SAP and a purchase order is released.' }} />}
    {tab === 'saved' && (!saved ? <div className="skel" style={{ height: 200 }} /> : !saved.length ? <div className="card"><Empty icon="heart" title="No saved items"><p>Use the heart on any product to keep it here for quick reordering.</p><div className="acts"><Link href="/" className="btn sec sm">Browse products</Link></div></Empty></div> : <div className="grid4">{saved.map((it, i) => <ProductCard key={it.id} it={it} plant={plant} i={i} />)}</div>)}
  </>;
}
export default function Page() { return <Suspense><Activity /></Suspense>; }
