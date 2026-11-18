/* DEVELOPMENT DEMO DATA — clearly fictional, created through the public API (so every rule applies). Never run in production. */
const API = process.env.API || 'http://localhost:4000';
const PW = 'demo-password-123';
async function call(path: string, token: string | null, body?: any, form?: FormData) {
  const r = await fetch(API + path, { method: body || form ? 'POST' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const t = await r.text(); if (!r.ok) throw new Error(`${path} ${r.status} ${t}`); return t ? JSON.parse(t) : null;
}
const file = (name: string, content: string) => { const f = new FormData(); f.append('file', new Blob([content]), name); return f; };
(async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('no');
  const plat = (await call('/auth/login', null, { tenant: 'platform', email: 'platform@monosource.local', password: 'dev-platform-pass-1' })).token;
  try { await call('/platform/tenants', plat, { slug: 'demo', name: 'Demo Customer (DEV DATA)', adminEmail: 'admin@demo.local', adminPassword: PW }); } catch (e: any) { if (!/409/.test(e.message)) throw e; console.log('tenant exists'); }
  const a = (await call('/auth/login', null, { tenant: 'demo', email: 'admin@demo.local', password: PW })).token;
  const erps = await call('/erp-systems', a);
  if (!erps.find((e: any) => e.code === 'S01')) await call('/erp-systems', a, { code: 'S01', name: 'Simulated SAP server 1', kind: 'mock-sap' });
  await call('/org/import', a, undefined, file('org.csv', 'BU,Server,Company code,Company name,Plant code,Plant name,Location\nPower,S01,1000,Demo Power Ltd,P100,Demo Plant North,Store-1\nPower,S01,1000,Demo Power Ltd,P200,Demo Plant South,\n'));
  const s01 = (await call('/erp-systems', a)).find((e: any) => e.code === 'S01').id;
  const tree = await call('/org/tree', a); const biz = tree.find((n: any) => n.levelType === 'business').id; const p100 = tree.find((n: any) => n.code === 'P100').id;
  const users: [string, string][] = [['buyer@demo.local', 'plant_procurement'], ['reviewer@demo.local', 'central_procurement']];
  for (const [email, roleKey] of users) { try { await call('/users', a, { email, name: email.split('@')[0], password: PW, roleKey, scopeNodeId: roleKey === 'plant_procurement' ? p100 : undefined }); } catch (e: any) { if (!/409/.test(e.message)) throw e; } }
  await call('/catalogue/import', a, undefined, file('items.csv', 'name,description,brand,mpn,uom,category,serviceability,server,material_code\nDeep groove ball bearing 6205-2RS,25mm bore sealed,SKF,6205-2RS,EA,bearings,arc,S01,1000123\nSafety gloves nitrile large,Pair,3M,GL-L,PAIR,ppe,arc,S01,1000456\nMCB 32A single pole,C-curve,Schneider,A9F74132,EA,electrical,on_quote,S01,1000789\n'));
  const sup = await call('/suppliers', a, { legalName: 'Shree Bearings Pvt Ltd (demo)', taxId: 'DEMO-TAX-001' });
  await call(`/suppliers/${sup.id}/erp-codes`, a, { erpSystemId: s01, vendorCode: 'V-DEMO-1' });
  await call('/allocations', a, { scopeNodeId: biz, model: 2, status: 'active', approvedByCustomer: 'DEMO approver (fictional)', approvedByProcmart: 'DEMO approver (fictional)' });
  const f = file('demo-arc.csv', 'Description,Material Code,Brand,MPN,UOM,Base Price,Discount %,MOQ,Quantity Cap\nBall bearing 6205 2RS sealed,1000123,SKF,6205-2RS,Nos,100,10,5,200\nNitrile gloves large,1000456,3M,GL-L,Pair,40,0,10,500\nMystery fastener,9999999,,,Nos,5,0,1,50\n');
  for (const [k, v] of Object.entries({ contractType: 'ARC', number: 'DEMO-ARC-001', supplierId: sup.id, erpSystemId: s01, validFrom: '2026-01-01', validTo: '2027-12-31', scopeNodeIds: biz })) f.append(k, v as string);
  console.log('uploaded', await call('/contracts', a, undefined, f));
  console.log('Demo ready. tenant=demo; admin@demo.local / buyer@demo.local / reviewer@demo.local; password:', PW);
})().catch((e) => { console.error(e.message); process.exit(1); });
