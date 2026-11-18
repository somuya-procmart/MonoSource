/* DEVELOPMENT DEMO DATA (fictional): a Model 3 plant with no contracts, three suppliers, policy set. Run after dev-demo.ts. */
const API = process.env.API || 'http://localhost:4000'; const PW = 'demo-password-123';
async function call(path: string, token: string | null, body?: any) {
  const r = await fetch(API + path, { method: body ? 'POST' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); if (!r.ok) throw new Error(`${path} ${r.status} ${t}`); return t ? JSON.parse(t) : null;
}
(async () => {
  const a = (await call('/auth/login', null, { tenant: 'demo', email: 'admin@demo.local', password: PW })).token;
  const tree = await call('/org/tree', a); const p200 = tree.find((n: any) => n.code === 'P200').id; const s01 = (await call('/erp-systems', a)).find((e: any) => e.code === 'S01').id;
  await call('/allocations', a, { scopeNodeId: p200, model: 3, status: 'active', approvedByCustomer: 'DEMO approver (fictional)', approvedByProcmart: 'DEMO approver (fictional)' });
  await call('/policy', a, { minQuotes: 2, procmartMayBid: false });
  for (const [email, roleKey, scope] of [['buyer2@demo.local', 'plant_procurement', p200], ['ops@demo.local', 'procmart_ops', undefined]] as const)
    try { await call('/users', a, { email, name: email.split('@')[0], password: PW, roleKey, scopeNodeId: scope }); } catch (e: any) { if (!/409/.test(e.message)) throw e; }
  for (const [n, v] of [['Volt Electricals (demo)', 'V-DEMO-2'], ['Bright Switchgear (demo)', 'V-DEMO-3'], ['Northline Industrial (demo)', 'V-DEMO-4']]) {
    try { const s = await call('/suppliers', a, { legalName: n }); await call(`/suppliers/${s.id}/erp-codes`, a, { erpSystemId: s01, vendorCode: v }); } catch (e: any) { if (!/409/.test(e.message)) throw e; }
  }
  console.log('sourcing demo ready: buyer2@demo.local (plant South, Model 3), ops@demo.local; password', PW);
})().catch((e) => { console.error(e.message); process.exit(1); });
