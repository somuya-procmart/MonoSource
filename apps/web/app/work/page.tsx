'use client';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '../../lib/api';
import { can, useApp, useMe } from '../shell';
import { Empty } from '../../components/Ui';
import { Icon } from '../../components/Icon';
import { useOpenProduct } from '../../components/ProductPanel';
import { dmy } from '../../lib/format';
import { AttentionBoard, useTasks } from '../../components/AttentionBoard';
import { useConfirm } from '../../components/Confirm';
import { DataTable } from '../../components/DataTable';
const KIND: Record<string, string> = { routing: 'Routing needs a decision', pr_failed: 'Order could not be sent to SAP', supplier_partial: 'Supplier can supply only part', supplier_rejected: 'Supplier declined the order', quality_rejection: 'Goods rejected at receipt', supplier_unresponsive: 'Supplier not responding', vendor_code_missing: 'Supplier has no SAP vendor code for this plant' };

function Work() {
  const me = useMe(); const ask = useConfirm(); const { notify } = useApp(); const { open } = useOpenProduct(); const sp = useSearchParams(); const router = useRouter(); const tab = sp.get('tab') ?? 'action'; const { d: tasks, load: loadTasks } = useTasks();
  const [ex, setEx] = useState<any[] | null>(null); const [note, setNote] = useState<Record<string, string>>({}); const [editing, setEditing] = useState('');
  const load = () => { api('/exceptions?status=open').then(setEx).catch(() => setEx([])); };
  useEffect(load, []); // eslint-disable-line
  const resolve = async (id: string) => { try { await api(`/exceptions/${id}/resolve`, { body: { resolution: note[id] ?? '' } }); notify('Exception resolved'); setEditing(''); load(); } catch (e: any) { notify(e.message, { error: true }); } };
  return <><div className="pagehead"><div><h1>Work queue</h1><p>Decisions the agents can’t make on their own, exceptions in the order flow, and plant requests to use a group contract.</p></div></div>
    <div className="tabs"><button className={`tab ${tab === 'action' ? 'on' : ''}`} onClick={() => router.replace('/work?tab=action')}>Needs action{(tasks?.counts?.needsMe ?? '') ? <span className="cnt-n">{tasks?.counts?.needsMe ?? ''}</span> : null}</button><button className={`tab ${tab === 'exceptions' ? 'on' : ''}`} onClick={() => router.replace('/work?tab=exceptions')}>Exceptions{ex?.length ? <span className="cnt-n">{ex.length}</span> : null}</button></div>
    {tab === 'action' && <AttentionBoard d={tasks} load={loadTasks} who="staff" />}
    {tab === 'exceptions' && <DataTable label="Open exceptions" rows={ex} rowKey={(e: any) => e.id} search={(e: any) => `${KIND[e.kind] ?? e.kind} ${e.detail ?? ''} ${e.item ?? ''} ${e.requirement ?? ''}`} searchPlaceholder="Problem, item or requirement"
      cols={[{ key: 'kind', label: 'What happened', sort: (e: any) => KIND[e.kind] ?? e.kind, render: (e: any) => <><b>{KIND[e.kind] ?? e.kind}</b><div className="mut small">{e.detail}</div></> },
        { key: 'item', label: 'Item', sort: (e: any) => e.item, render: (e: any) => e.item ?? '—', hideBelow: 'md' },
        { key: 'req', label: 'Requirement', sort: (e: any) => e.requirement, render: (e: any) => e.requirementId ? <Link href={`/requirements/${e.requirementId}`}>{e.requirement}</Link> : '—' },
        { key: 'act', label: '', width: 320, render: (e: any) => !can(me, 'buying:source') ? <span className="mut small">Procurement resolves this</span> : editing === e.id
          ? <form className="row" style={{ margin: 0, alignItems: 'flex-end' }} onSubmit={(ev) => { ev.preventDefault(); resolve(e.id); }}><label className="field" style={{ margin: 0, flex: 1 }}><span>What was done?</span><input autoFocus required value={note[e.id] ?? ''} onChange={(ev) => setNote({ ...note, [e.id]: ev.target.value })} placeholder="e.g. Supplier confirmed new date" /></label><button className="sm" type="submit" disabled={!(note[e.id] ?? '').trim()}>Save</button><button className="sec sm" type="button" onClick={() => setEditing('')}>Cancel</button></form>
          : <button className="sec sm" onClick={() => setEditing(e.id)}>Resolve…</button> }]}
      empty={{ icon: 'checkCircle', title: 'No open exceptions', text: 'Orders are flowing normally. New problems — a supplier declining, goods rejected — appear here.' }} />}
  </>;
}
export default function Page() { return <Suspense><Work /></Suspense>; }
