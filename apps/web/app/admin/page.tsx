'use client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '../../lib/api';
import { useApp, can } from '../shell';
import { Empty } from '../../components/Ui';
import { Icon } from '../../components/Icon';
import { DataTable } from '../../components/DataTable';
import { catLabel } from '../../lib/format';

function useLoad<T>(path: string | null, deps: any[] = []) {
  const [d, setD] = useState<T | null>(null); const [e, setE] = useState('');
  const load = useCallback(() => { if (path) api<T>(path).then(setD).catch((x) => setE(x.message)); }, [path]);
  useEffect(load, [load, ...deps]); // eslint-disable-line
  return { d, e, reload: load };
}
const ROLES: Record<string, string> = { customer_admin: 'Customer administrator', central_procurement: 'Central procurement', plant_procurement: 'Plant procurement', requester: 'Requester', approver: 'Approver', finance: 'Finance', procmart_ops: 'ProcMart operations', supplier: 'Supplier user' };
const LEVELS: Record<string, string> = { group: 'Group', business: 'Business', company_code: 'Company', plant: 'Plant', delivery_point: 'Delivery point' };
const ERP_KINDS: Record<string, string> = { 'mock-sap': 'SAP (simulated)', sap: 'SAP', ariba: 'SAP Ariba', oracle: 'Oracle', procmart: 'ProcMart' };
const SERVICE: Record<string, string> = { arc: 'Annual contract', qrc: 'Quarterly contract', on_quote: 'On quote', non_serviceable: 'Not serviced' };
const yesNo = (v: any) => v === true ? 'Yes' : v === false ? 'No' : 'Not decided';

function Admin() {
  const { me, notify } = useApp(); const sp = useSearchParams(); const router = useRouter(); const tab = sp.get('tab') ?? 'organisation'; const [items, setItems] = useState<any[] | null>(null); const [busy, setBusy] = useState('');
  const run = async (key: string, f: () => Promise<any>, ok: string, after?: () => void) => { setBusy(key); try { await f(); notify(ok); after?.(); } catch (x: any) { notify(x.message, { error: true }); } finally { setBusy(''); } };
  const tenants = useLoad<any[]>(me?.platform ? '/platform/tenants' : null);
  const erps = useLoad<any[]>(can(me, 'org:read') ? '/erp-systems' : null);
  const tree = useLoad<any[]>(can(me, 'org:read') ? '/org/tree' : null);
  const users = useLoad<any[]>(can(me, 'users:read') ? '/users' : null);
  const allocs = useLoad<any[]>(can(me, 'allocation:read') ? '/allocations' : null);
  const policy = useLoad<any>(can(me, 'allocation:read') ? '/policy' : null);
  const [t, setT] = useState({ slug: '', name: '', adminEmail: '', adminPassword: '' });
  const [u, setU] = useState({ email: '', name: '', password: '', roleKey: 'requester', scopeNodeId: '' });
  const [er, setEr] = useState({ code: '', name: '', kind: 'mock-sap' });
  const [al, setAl] = useState({ scopeNodeId: '', model: '2', approvedByCustomer: '', approvedByProcmart: '' });
  useEffect(() => { if (tab === 'catalogue') api('/catalogue/search?q=').then(setItems).catch(() => setItems([])); }, [tab]);
  if (!me) return null;
  const nodes = tree.d ?? []; const scopeNodes = nodes.filter((n) => ['business', 'company_code', 'plant'].includes(n.levelType));
  const TABS = [['organisation', 'Organisation', can(me, 'org:write') || me.platform], ['users', 'Users & access', can(me, 'users:read')], ['catalogue', 'Catalogue', can(me, 'catalogue:read')], ['configuration', 'Commercial rules', can(me, 'allocation:read')]].filter((x) => x[2]) as [string, string, boolean][];
  const upload = (inputId: string, path: string, key: string, ok: (r: any) => string, after: () => void) => { const f = (document.getElementById(inputId) as HTMLInputElement).files?.[0]; if (!f) { notify('Choose a CSV file first.', { error: true }); return; } const fd = new FormData(); fd.append('file', f); setBusy(key); api(path, { form: fd }).then((r) => { notify(ok(r)); after(); }).catch((x) => notify(x.message, { error: true })).finally(() => setBusy('')); };
  const policyRow = (label: string, help: string, value: string, opts: [string, any][], key: string) => <div className="row" style={{ justifyContent: 'space-between', padding: 'var(--sp-3) 0', borderTop: '1px solid var(--bd)', margin: 0 }}>
    <div style={{ maxWidth: 560 }}><b>{label}</b><div className="mut small">{help}</div></div>
    <div className="row" style={{ margin: 0 }}><span className="tag lg">{value}</span>{can(me, 'policy:write') && <div className="seg" role="group" aria-label={label}>{opts.map(([l, v]) => <button key={l} className={String(policy.d?.[key]) === String(v) ? 'on' : ''} disabled={!!busy} onClick={() => run('p' + key, () => api('/policy', { body: { [key]: v } }), 'Rule updated', policy.reload)}>{l}</button>)}</div>}</div></div>;
  return <>
    <div className="pagehead"><div><h1>Administration</h1><p>Organisation, people, catalogue and commercial rules for {me.tenant.name}.</p></div></div>
    <div className="tabs">{TABS.map(([id, l]) => <button key={id} className={`tab ${tab === id ? 'on' : ''}`} onClick={() => router.replace(`/admin?tab=${id}`)}>{l}</button>)}</div>

    {tab === 'catalogue' && <section className="card flush"><div className="sec-head" style={{ padding: 'var(--sp-4) var(--sp-5) 0' }}><div><h2>Catalogue</h2><div className="mut small">{items ? `${items.length} active items` : 'Loading…'} · open an item to edit details, add images and datasheets, and see its history.</div></div>
      {can(me, 'catalogue:write') && <div className="row" style={{ margin: 0 }}><label className="field inline"><span>CSV file</span><input type="file" accept=".csv" id="itemcsv" /></label><button className={`sec ${busy === 'items' ? 'busy' : ''}`} onClick={() => upload('itemcsv', '/catalogue/import', 'items', (r) => `Imported ${r.imported} item${r.imported === 1 ? '' : 's'}${r.errors.length ? `. ${r.errors.length} row(s) skipped: ${r.errors.join('; ')}` : ''}`, () => api('/catalogue/search?q=').then(setItems))}>Import items</button></div>}</div>
      <DataTable flush={false} label="Catalogue items" rows={items} rowKey={(i: any) => i.id} search={(i: any) => `${i.name} ${i.brand ?? ''} ${i.category ?? ''} ${i.codes?.map((c: any) => c.code).join(' ') ?? ''}`} searchPlaceholder="Name, brand, category or code" initialSort={{ key: 'name', dir: 'asc' }}
        cols={[{ key: 'name', label: 'Item', sort: (i: any) => i.name, render: (i: any) => <Link href={`/product/${i.id}`}><b>{i.name}</b></Link> },
          { key: 'brand', label: 'Brand', sort: (i: any) => i.brand, render: (i: any) => i.brand ?? '—' },
          { key: 'cat', label: 'Category', sort: (i: any) => i.category, render: (i: any) => catLabel(i.category) || '—' },
          { key: 'uom', label: 'Unit', render: (i: any) => i.uom, hideBelow: 'md' },
          { key: 'codes', label: 'Material codes', render: (i: any) => <span className="mut small">{i.codes?.map((c: any) => `${c.code} (${c.server})`).join(', ') || '—'}</span>, hideBelow: 'lg' },
          { key: 'svc', label: 'ProcMart service', sort: (i: any) => SERVICE[i.procmart_serviceability], render: (i: any) => SERVICE[i.procmart_serviceability] ?? '—', hideBelow: 'md' }]}
        empty={{ icon: 'package', title: 'The catalogue is empty', text: 'Import a CSV of items with names, units, categories and SAP material codes.' }} /></section>}

    {tab === 'organisation' && <>
      {me.platform && <section className="card"><div className="sec-head"><h2>Customers</h2><span className="hint">Platform administration</span></div>
        <div className="tscroll"><table><thead><tr><th>Short name</th><th>Customer</th><th>Type</th></tr></thead><tbody>{tenants.d?.map((x) => <tr key={x.id}><td>{x.slug}</td><td><b>{x.name}</b></td><td className="mut">{x.kind === 'platform' ? 'Platform' : 'Customer'}</td></tr>)}</tbody></table></div>
        <h3 style={{ margin: 'var(--sp-5) 0 var(--sp-3)' }}>Add a customer</h3><div className="form-grid" style={{ alignItems: 'end' }}>
          <label className="field"><span>Short name</span><input placeholder="e.g. acme" value={t.slug} onChange={(e) => setT({ ...t, slug: e.target.value })} /><span className="help">Lowercase letters, numbers and dashes; used to sign in</span></label>
          <label className="field"><span>Customer name</span><input placeholder="e.g. Acme Industries" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></label>
          <label className="field"><span>Administrator email</span><input type="email" placeholder="admin@company.com" value={t.adminEmail} onChange={(e) => setT({ ...t, adminEmail: e.target.value })} /></label>
          <label className="field"><span>Temporary password</span><input type="password" placeholder="At least 10 characters" value={t.adminPassword} onChange={(e) => setT({ ...t, adminPassword: e.target.value })} /></label>
          <div className="field"><button className={busy === 't' ? 'busy' : ''} disabled={!t.slug || !t.name || !t.adminEmail || t.adminPassword.length < 10} onClick={() => run('t', () => api('/platform/tenants', { body: t }), `${t.name} added`, () => { tenants.reload(); setT({ slug: '', name: '', adminEmail: '', adminPassword: '' }); })}>Add customer</button></div></div></section>}

      {can(me, 'org:write') && <section className="card"><div className="sec-head"><h2>SAP systems</h2><span className="hint">Each plant belongs to one system</span></div>
        <div className="tscroll"><table><thead><tr><th>Code</th><th>Name</th><th>Connection</th></tr></thead><tbody>{erps.d?.map((x) => <tr key={x.id}><td><b>{x.code}</b></td><td>{x.name}</td><td><span className={`tag ${x.kind === 'mock-sap' ? 'sim' : ''}`}>{ERP_KINDS[x.kind] ?? x.kind}</span></td></tr>)}
          {erps.d && !erps.d.length && <tr><td colSpan={3} className="mut">No systems yet. Add one before importing the organisation.</td></tr>}</tbody></table></div>
        <h3 style={{ margin: 'var(--sp-5) 0 var(--sp-3)' }}>Add a system</h3><div className="form-grid" style={{ alignItems: 'end' }}>
          <label className="field"><span>Code</span><input placeholder="e.g. S01" value={er.code} onChange={(e) => setEr({ ...er, code: e.target.value })} /></label>
          <label className="field"><span>Name</span><input placeholder="e.g. Power SAP" value={er.name} onChange={(e) => setEr({ ...er, name: e.target.value })} /></label>
          <label className="field"><span>Connection type</span><select value={er.kind} onChange={(e) => setEr({ ...er, kind: e.target.value })}>{Object.entries(ERP_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><span className="help">Only the simulated SAP connection works today</span></label>
          <div className="field"><button className={busy === 'er' ? 'busy' : ''} disabled={!er.code || !er.name} onClick={() => run('er', () => api('/erp-systems', { body: er }), 'System added', () => { erps.reload(); setEr({ code: '', name: '', kind: 'mock-sap' }); })}>Add system</button></div></div></section>}

      {can(me, 'org:write') && <section className="card flush"><div className="sec-head" style={{ padding: 'var(--sp-4) var(--sp-5) 0' }}><div><h2>Organisation structure</h2><div className="mut small">Import a CSV with: BU, Server, Company code, Company name, Plant code, Plant name, Location — the same shape as the SAP PO extract.</div></div>
          <div className="row" style={{ margin: 0 }}><label className="field inline"><span>CSV file</span><input type="file" accept=".csv" id="orgcsv" /></label><button className={`sec ${busy === 'org' ? 'busy' : ''}`} onClick={() => upload('orgcsv', '/org/import', 'org', () => 'Organisation imported', tree.reload)}>Import structure</button></div></div>
        <DataTable flush={false} label="Organisation units" rows={tree.d ? nodes : null} rowKey={(n: any) => n.id} pageSize={50} search={(n: any) => `${n.name} ${n.code ?? ''} ${LEVELS[n.levelType] ?? ''} ${n.server ?? ''}`} searchPlaceholder="Name, code or level"
          cols={[{ key: 'level', label: 'Level', sort: (n: any) => n.levelType, render: (n: any) => LEVELS[n.levelType] ?? n.levelType },
            { key: 'code', label: 'Code', sort: (n: any) => n.code, render: (n: any) => n.code ?? '—' },
            { key: 'name', label: 'Name', sort: (n: any) => n.name, render: (n: any) => <b>{n.name}</b> },
            { key: 'server', label: 'SAP system', sort: (n: any) => n.server, render: (n: any) => n.server ?? '—', hideBelow: 'md' },
            { key: 'src', label: 'Source', render: (n: any) => <span className="mut small">{n.source === 'import' ? 'CSV import' : n.source ?? '—'}</span>, hideBelow: 'md' }]}
          empty={{ icon: 'building', title: 'No organisation yet', text: 'Import the structure to create businesses, companies and plants.' }} /></section>}</>}

    {tab === 'users' && can(me, 'users:read') && <section className="card flush"><div className="sec-head" style={{ padding: 'var(--sp-4) var(--sp-5) 0' }}><h2>People</h2><span className="hint">{users.d?.length ?? 0} users</span></div>
      <DataTable flush={false} label="People" rows={users.d} rowKey={(x: any) => x.id} search={(x: any) => `${x.name} ${x.email} ${x.roles.map((r: any) => ROLES[r.role] ?? r.role).join(' ')}`} searchPlaceholder="Name, email or role" initialSort={{ key: 'name', dir: 'asc' }}
        cols={[{ key: 'name', label: 'Name', sort: (x: any) => x.name, render: (x: any) => <b>{x.name}</b> }, { key: 'email', label: 'Email', sort: (x: any) => x.email, render: (x: any) => x.email },
          { key: 'roles', label: 'Role and scope', render: (x: any) => x.roles.map((r: any, i: number) => <span key={i} className="tag" style={{ marginRight: 4 }}>{ROLES[r.role] ?? r.role}{r.scopeNodeId ? ` · ${nodes.find((n) => n.id === r.scopeNodeId)?.name ?? 'scoped'}` : ' · whole customer'}</span>) }]}
        empty={{ icon: 'users', title: 'No people yet', text: 'Add the first person below.' }} />
      {can(me, 'users:write') && <div style={{ padding: 'var(--sp-5)', borderTop: '1px solid var(--bd)' }}><h3 style={{ marginBottom: 'var(--sp-3)' }}>Invite a person</h3><div className="form-grid" style={{ alignItems: 'end' }}>
        <label className="field"><span>Full name</span><input placeholder="e.g. Priya Sharma" value={u.name} onChange={(e) => setU({ ...u, name: e.target.value })} /></label>
        <label className="field"><span>Work email</span><input type="email" placeholder="name@company.com" value={u.email} onChange={(e) => setU({ ...u, email: e.target.value })} /></label>
        <label className="field"><span>Temporary password</span><input type="password" placeholder="At least 10 characters" value={u.password} onChange={(e) => setU({ ...u, password: e.target.value })} /></label>
        <label className="field"><span>Role</span><select value={u.roleKey} onChange={(e) => setU({ ...u, roleKey: e.target.value })}>{Object.entries(ROLES).filter(([k]) => k !== 'supplier').map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="field"><span>Scope</span><select value={u.scopeNodeId} onChange={(e) => setU({ ...u, scopeNodeId: e.target.value })}><option value="">Whole customer</option>{scopeNodes.map((n) => <option key={n.id} value={n.id}>{LEVELS[n.levelType]}: {n.name}{n.server ? ` (${n.server})` : ''}</option>)}</select></label>
        <div className="field"><button className={busy === 'u' ? 'busy' : ''} disabled={!u.name || !u.email || u.password.length < 10} onClick={() => run('u', () => api('/users', { body: { ...u, scopeNodeId: u.scopeNodeId || undefined } }), `${u.name} can now sign in`, () => { users.reload(); setU({ email: '', name: '', password: '', roleKey: 'requester', scopeNodeId: '' }); })}>Add person</button></div></div></div>}</section>}

    {tab === 'configuration' && can(me, 'allocation:read') && <>
      <section className="card"><div className="sec-head"><div><h2>Commercial model by scope</h2><div className="mut small">Decides whether a business, company or plant buys through ProcMart direct supply (Model 1), managed contracts (Model 2) or managed sourcing (Model 3). An allocation goes live only when both the customer and ProcMart approvals are recorded.</div></div></div>
        <div className="tscroll"><table><thead><tr><th>Model</th><th>Scope</th><th>Category</th><th>Status</th></tr></thead><tbody>{allocs.d?.map((a) => <tr key={a.id}><td><b>Model {a.model}</b> <span className="mut small">· {({ 1: 'ProcMart direct', 2: 'Contract management', 3: 'Sourcing management' } as any)[a.model]}</span></td><td>{a.scope}</td><td>{a.category ?? 'All categories'}</td><td><span className={`tag ${a.status === 'active' ? 'ok' : ''}`}>{a.status === 'active' ? 'Live' : a.status === 'draft' ? 'Awaiting approvals' : 'Retired'}</span></td></tr>)}
          {allocs.d && !allocs.d.length && <tr><td colSpan={4}><Empty icon="layers" title="Nothing allocated yet"><p>Without an allocation, buyers keep using their usual process.</p></Empty></td></tr>}</tbody></table></div>
        {can(me, 'allocation:write') && <><h3 style={{ margin: 'var(--sp-5) 0 var(--sp-3)' }}>Allocate a model</h3><div className="form-grid" style={{ alignItems: 'end' }}>
          <label className="field"><span>Scope</span><select value={al.scopeNodeId} onChange={(e) => setAl({ ...al, scopeNodeId: e.target.value })}><option value="">Select…</option>{scopeNodes.map((n) => <option key={n.id} value={n.id}>{LEVELS[n.levelType]}: {n.name}</option>)}</select></label>
          <label className="field"><span>Model</span><select value={al.model} onChange={(e) => setAl({ ...al, model: e.target.value })}><option value="1">Model 1 · ProcMart direct</option><option value="2">Model 2 · Contract management</option><option value="3">Model 3 · Sourcing management</option></select></label>
          <label className="field"><span>Customer approver</span><input placeholder="Name and role" value={al.approvedByCustomer} onChange={(e) => setAl({ ...al, approvedByCustomer: e.target.value })} /></label>
          <label className="field"><span>ProcMart approver</span><input placeholder="Name and role" value={al.approvedByProcmart} onChange={(e) => setAl({ ...al, approvedByProcmart: e.target.value })} /></label>
          <div className="field"><button className={busy === 'al' ? 'busy' : ''} disabled={!al.scopeNodeId} onClick={() => run('al', () => api('/allocations', { body: { scopeNodeId: al.scopeNodeId, model: +al.model, approvedByCustomer: al.approvedByCustomer || undefined, approvedByProcmart: al.approvedByProcmart || undefined, status: al.approvedByCustomer && al.approvedByProcmart ? 'active' : 'draft' } }), al.approvedByCustomer && al.approvedByProcmart ? 'Allocation is live' : 'Saved — waiting for both approvals', allocs.reload)}>{al.approvedByCustomer && al.approvedByProcmart ? 'Save and make live' : 'Save as draft'}</button></div></div></>}</section>
      <section className="card"><h2>Buying rules</h2><p className="mut small">Rules that are “Not decided” are never assumed: the affected step stops and asks a person.</p>
        {policyRow('ProcMart may quote in requests it runs', 'Allows ProcMart Direct to bid alongside other suppliers.', yesNo(policy.d?.procmartMayBid), [['Yes', true], ['No', false]], 'procmartMayBid')}
        {policyRow('Minimum quotes before awarding', 'Sourcing cannot award until this many quotes are in.', policy.d?.minQuotes ? `${policy.d.minQuotes}` : 'Not decided — sourcing is paused', [['1', 1], ['2', 2], ['3', 3]], 'minQuotes')}
        {policyRow('Contract supply before ProcMart direct', 'When both apply, offer the plant’s rate contract first.', yesNo(policy.d?.arcPriorityOverDirect), [['Yes', true], ['No', false]], 'arcPriorityOverDirect')}</section></>}
  </>;
}
export default function AdminPage() { return <Suspense><Admin /></Suspense>; }
