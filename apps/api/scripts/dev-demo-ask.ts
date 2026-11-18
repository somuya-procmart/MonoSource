/* DEVELOPMENT DEMO DATA (fictional): specs + attribute templates so Ask MonoSource has something to ask about. */
const API = process.env.API || 'http://localhost:4000'; const PW = 'demo-password-123';
async function call(path: string, token: string | null, body?: any, form?: FormData) {
  const r = await fetch(API + path, { method: body || form ? 'POST' : 'GET', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const t = await r.text(); if (!r.ok) throw new Error(`${path} ${r.status} ${t}`); return t ? JSON.parse(t) : null;
}
(async () => {
  const a = (await call('/auth/login', null, { tenant: 'demo', email: 'admin@demo.local', password: PW })).token;
  const items = await call('/catalogue/search?q=', a); const by = (n: string) => items.find((i: any) => i.name.startsWith(n));
  await call(`/catalogue/items/${by('Deep groove').id}/update`, a, { specs: { bore: '25', seal: 'sealed', series: '6205' } });
  const f = new FormData(); f.append('file', new Blob(['name,description,brand,mpn,uom,category,server,material_code,spec_bore,spec_seal,spec_series\nDeep groove ball bearing 6205 open,25mm bore open,SKF,6205,EA,bearings,S01,1000124,25,open,6205\nDeep groove ball bearing 6306 sealed,30mm bore sealed,SKF,6306-2RS,EA,bearings,S01,1000125,30,sealed,6306\n']), 'more.csv');
  try { await call('/catalogue/import', a, undefined, f); } catch (e: any) { console.log(e.message.slice(0, 80)); }
  for (const [key, label, required, position] of [['bore', 'Bore diameter (mm)', true, 1], ['seal', 'Seal type', false, 2], ['series', 'Bearing series', false, 3]] as const)
    await call('/catalogue/category-attributes', a, { category: 'bearings', key, label, required, position });
  console.log('ask demo ready');
})().catch((e) => { console.error(e.message); process.exit(1); });
