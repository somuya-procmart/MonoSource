process.env.NODE_ENV = 'test';
process.env.OUTBOX_WORKER = 'off';
process.env.DATABASE_ADMIN_URL = 'postgres://localhost:5432/monosource_test';
process.env.DATABASE_URL = 'postgres://monosource_app:monosource_app_dev@localhost:5432/monosource_test';
process.env.STORAGE_DIR = require('os').tmpdir() + '/monosource-test-storage';
process.env.RATE_LIMIT = '100000';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import { migrate } from '../src/db/migrate';
import { createApp } from '../src/main';
import { Db } from '../src/db/db';
import { ensurePlatformAdmin } from '../src/db/bootstrap';
import { OutboxService } from '../src/outbox/outbox.service';

let app: INestApplication, http: any, outbox: OutboxService;
const PW = 'correct-horse-battery';
const login = async (tenant: string, email: string) => (await request(http).post('/auth/login').send({ tenant, email, password: PW })).body.token as string;
const as = (t: string) => ({ Authorization: `Bearer ${t}` });
const sql = async (q: string, p: any[] = []) => { const c = new Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await c.connect(); const r = await c.query(q, p); await c.end(); return r; };
beforeAll(async () => {
  await sql('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await migrate(process.env.DATABASE_ADMIN_URL);
  app = await createApp(); await app.init(); http = app.getHttpServer(); outbox = app.get(OutboxService);
  await ensurePlatformAdmin(app.get(Db), 'platform@test.local', PW);
});
afterAll(async () => { await app.close(); });

describe('Experience: discover, multi-supplier supplies, supply choice, saved, cart editing, orders, home, supplier overview', () => {
  let admin: string, b1: string, b2: string, central: string, p1: string, p2: string, power: string, ports: string, s01: string;
  let X: string, Y: string, supA: string, supB: string, supC: string, lineA: string, lineB: string;

  async function arc(number: string, supplier: string, scopes: string[], price: number, code = '7001', extra = '') {
    const up = await request(http).post('/contracts').set(as(admin)).field('contractType', 'ARC').field('number', number).field('supplierId', supplier).field('erpSystemId', s01)
      .field('validFrom', '2026-01-01').field('validTo', '2028-12-31').field('scopeNodeIds', scopes.join(',')).attach('file', Buffer.from(`Description,Material Code,UOM,Net Price,MOQ,Quantity Cap\nCable 4mm,${code},Nos,${price},5,100${extra}\n`), 'a.csv').expect(201);
    const q = (await request(http).get('/review/queue').set(as(admin))).body.find((l: any) => l.contractId === up.body.id);
    await request(http).post(`/review/candidates/${q.candidates[0].id}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201);
    await request(http).post(`/contracts/${up.body.id}/approve`).set(as(admin)).expect(201); await request(http).post(`/contracts/${up.body.id}/publish`).set(as(admin)).expect(201);
    return (await request(http).get(`/contracts/${up.body.id}`).set(as(admin))).body.lines[0].id as string;
  }

  it('setup: two plants, two suppliers (+ one without a vendor code) on contract for the same item', async () => {
    const plat = await login('platform', 'platform@test.local');
    for (const [slug, e] of [['exp', 'admin@exp.test'], ['rival', 'admin@rival.test']]) await request(http).post('/platform/tenants').set(as(plat)).send({ slug, name: slug, adminEmail: e, adminPassword: PW }).expect(201);
    admin = await login('exp', 'admin@exp.test');
    s01 = (await request(http).post('/erp-systems').set(as(admin)).send({ code: 'S01', name: 'sim', kind: 'mock-sap' })).body.id;
    await request(http).post('/org/import').set(as(admin)).attach('file', Buffer.from('BU,Server,Company code,Company name,Plant code,Plant name\nPower,S01,1000,Exp Power,P1,Plant One\nPorts,S01,2000,Exp Ports,P2,Plant Two\n'), 'o.csv').expect(201);
    const t = (await request(http).get('/org/tree').set(as(admin))).body; const id = (c: string) => t.find((n: any) => n.code === c || n.name === c).id;
    p1 = id('P1'); p2 = id('P2'); power = id('Power'); ports = id('Ports');
    for (const b of [power, ports]) await request(http).post('/allocations').set(as(admin)).send({ scopeNodeId: b, model: 2, status: 'active', approvedByCustomer: 'c (test)', approvedByProcmart: 'p (test)' }).expect(201);
    await request(http).post('/users').set(as(admin)).send({ email: 'b1@exp.test', name: 'b1', password: PW, roleKey: 'requester', scopeNodeId: p1 }).expect(201);
    await request(http).post('/users').set(as(admin)).send({ email: 'b2@exp.test', name: 'b2', password: PW, roleKey: 'requester', scopeNodeId: p2 }).expect(201);
    await request(http).post('/users').set(as(admin)).send({ email: 'c@exp.test', name: 'central', password: PW, roleKey: 'central_procurement' }).expect(201);
    b1 = await login('exp', 'b1@exp.test'); b2 = await login('exp', 'b2@exp.test'); central = await login('exp', 'c@exp.test');
    const mk = async (n: string) => (await request(http).post('/suppliers').set(as(admin)).send({ legalName: n }).expect(201)).body.id;
    supA = await mk('Supplier A'); supB = await mk('Supplier B'); supC = await mk('Supplier C');
    for (const [s, v] of [[supA, 'VA'], [supB, 'VB']]) await request(http).post(`/suppliers/${s}/erp-codes`).set(as(admin)).send({ erpSystemId: s01, vendorCode: v }).expect(201); // C has none
    await request(http).post('/catalogue/import').set(as(admin)).attach('file', Buffer.from('name,uom,category,brand,server,material_code,spec_cores\nCable 4mm,EA,cables,Polycab,S01,7001,4C\nValve ball 2in,EA,valves,Flowtech,S01,8001,\nCable 2mm,EA,cables,Havells,S01,7002,2C\n'), 'i.csv').expect(201);
    const all = (await request(http).get('/catalogue/search?q=').set(as(admin))).body; X = all.find((i: any) => i.name === 'Cable 4mm').id; Y = all.find((i: any) => i.name === 'Valve ball 2in').id;
    lineA = await arc('ARC-A', supA, [power, ports], 100); lineB = await arc('ARC-B', supB, [power], 120); await arc('ARC-C', supC, [power], 90);
  });

  it('product supplies: every valid contract is listed and, being group-level, applies at every plant; nothing is picked for the buyer', async () => {
    const at = async (plant: string, token = b1) => (await request(http).get(`/products/${X}?plantId=${plant}`).set(as(token)).expect(200)).body;
    const p = await at(p1); expect(p.supplies.map((s: any) => s.supplier).sort()).toEqual(['Supplier A', 'Supplier B', 'Supplier C']);
    const byName = Object.fromEntries(p.supplies.map((s: any) => [s.supplier, s]));
    expect(byName['Supplier A']).toMatchObject({ number: 'ARC-A', netPrice: 100, appliesToPlant: true, orderable: true, moq: 5, qtyCap: 100, balance: 100 });
    expect(byName['Supplier C']).toMatchObject({ appliesToPlant: true, orderable: false }); expect(byName['Supplier C'].blockedReason).toMatch(/vendor code/);
    expect(p.supplies[0].orderable).toBe(true); // orderable ones first, cheapest first
    expect(byName['Supplier A'].appliesTo).toEqual(['Ports', 'Power']);
    const q2 = await at(p2, b2); const n2 = Object.fromEntries(q2.supplies.map((s: any) => [s.supplier, s]));
    expect(n2['Supplier A']).toMatchObject({ appliesToPlant: true, orderable: true }); expect(n2['Supplier B']).toMatchObject({ appliesToPlant: true, orderable: true }); // ARCs are group-level
    const none = (await request(http).get(`/products/${X}`).set(as(b1))).body; expect(none.supplies.every((s: any) => s.appliesToPlant === null)).toBe(true); // no plant → no claim
    expect(p.procmartServiceability).toBeNull(); expect(p.codes[0]).toMatchObject({ server: 'S01', code: '7001' });
    const y = (await request(http).get(`/products/${Y}?plantId=${p1}`).set(as(b1))).body; expect(y.supplies).toEqual([]); expect(y.nextStep).toMatch(/usual purchasing process|No current contract/);
    await request(http).get(`/products/${X}?plantId=${p2}`).set(as(b1)).expect(400); // b1 cannot ask as another plant
    await request(http).get('/products/not-a-uuid').set(as(b1)).expect(404);
  });

  it('the buyer’s supply choice reaches routing (even when it is not the cheapest) and must stay valid', async () => {
    await request(http).post('/cart/items').set(as(b1)).send({ plantId: p1, itemId: X, qty: 10, contractLineId: lineB }).expect(201);
    let cart = (await request(http).get(`/cart?plantId=${p1}`).set(as(b1))).body;
    expect(cart.lines[0].contract_line_id).toBe(lineB); expect(cart.lines[0].routing).toMatchObject({ route: 'arc', unitPrice: 120, supplierId: supB });
    expect(JSON.stringify(cart.lines[0].routing.trace)).toMatch(/buyer selected this supply/);
    const sub = await request(http).post(`/cart/${cart.cartId}/submit`).set(as(b1)).expect(201);
    await outbox.runOnce();
    const r = (await request(http).get(`/requirements/${sub.body.requirementId}`).set(as(b1))).body;
    expect(r.streams[0].supplier_name).toBe('Supplier B'); expect(+r.lines[0].unit_price).toBe(120);
    // ARCs are group-level: Supplier B's contract is just as valid at Plant Two, and the buyer's choice is kept (never swapped for A)
    await request(http).post('/cart/items').set(as(b2)).send({ plantId: p2, itemId: X, qty: 10, contractLineId: lineB }).expect(201);
    cart = (await request(http).get(`/cart?plantId=${p2}`).set(as(b2))).body;
    expect(cart.lines[0].routing).toMatchObject({ route: 'arc', unitPrice: 120, supplierId: supB });
    await request(http).post('/cart/items').set(as(b2)).send({ plantId: p2, itemId: X, qty: 1, contractLineId: 'nope' }).expect(400);
  });

  it('cart lines: quantity and need-by edits and removal are limited to the owner’s open cart', async () => {
    const cart = (await request(http).get(`/cart?plantId=${p2}`).set(as(b2))).body; const line = cart.lines[0].id;
    await request(http).post(`/cart/lines/${line}`).set(as(b2)).send({ qty: 7, needBy: '2027-03-01' }).expect(201);
    const after = (await request(http).get(`/cart?plantId=${p2}`).set(as(b2))).body.lines[0]; expect(+after.qty).toBe(7); expect(after.need_by).toBe('2027-03-01');
    await request(http).post(`/cart/lines/${line}`).set(as(b1)).send({ qty: 1 }).expect(404); await request(http).delete(`/cart/lines/${line}`).set(as(b1)).expect(404);
    await request(http).post(`/cart/lines/${line}`).set(as(b2)).send({ qty: -3 }).expect(400);
    await request(http).delete(`/cart/lines/${line}`).set(as(b2)).expect(200);
    expect((await request(http).get(`/cart?plantId=${p2}`).set(as(b2))).body.lines).toEqual([]);
  });

  it('discover: search, facets with counts, removable filters, sorting, id restriction', async () => {
    const d = async (qs: string, t = b1) => (await request(http).get(`/discover?${qs}`).set(as(t)).expect(200)).body;
    const all = await d(`plantId=${p1}`); expect(all.total).toBe(3);
    expect(all.facets.categories).toEqual(expect.arrayContaining([{ value: 'cables', count: 2 }, { value: 'valves', count: 1 }])); expect(all.facets.coverage).toEqual({ onContract: 1, noContract: 2 });
    expect(all.facets.suppliers.map((s: any) => s.value).sort()).toEqual(['Supplier A', 'Supplier B']); // Supplier C has no vendor code on this ERP, so it is not offered in lists
    expect((await d(`plantId=${p1}&category=valves`)).items.map((i: any) => i.name)).toEqual(['Valve ball 2in']);
    expect((await d(`plantId=${p1}&supplier=Supplier B`)).items.map((i: any) => i.name)).toEqual(['Cable 4mm']);
    expect((await d(`plantId=${p1}&coverage=none`)).total).toBe(2); expect((await d(`plantId=${p1}&coverage=on`)).total).toBe(1);
    expect((await d(`plantId=${p1}&brand=Havells,Flowtech`)).total).toBe(2);
    const x = (await d(`plantId=${p1}&q=cable`)).items.find((i: any) => i.id === X); expect(x.lowestPrice).toBe(100); expect(x.contractCoverage.length).toBe(2); // C (no vendor code) is not offered as a price in lists; the product page still shows it, blocked, with the reason
    const byPrice = (await d(`plantId=${p1}&sort=price_asc`)).items; expect(byPrice[0].id).toBe(X); expect(byPrice.at(-1).lowestPrice).toBeNull(); // no price sorts last
    expect((await d(`ids=${Y}`)).items.map((i: any) => i.id)).toEqual([Y]);
    expect((await d('q=zzzzqq')).total).toBe(0);
    await request(http).get('/discover?ids=bad').set(as(b1)).expect(400); await request(http).get('/discover?plantId=bad').set(as(b1)).expect(400); await request(http).get(`/discover?plantId=${p2}`).set(as(b1)).expect(400);
    await request(http).get('/discover').expect(401);
    const rival = await login('rival', 'admin@rival.test'); expect((await d('', rival)).total).toBe(0);
  });

  it('saved items are per user and shown on search results', async () => {
    await request(http).post(`/saved/${X}`).set(as(b1)).send({}).expect(201); await request(http).post(`/saved/${X}`).set(as(b1)).send({}).expect(201); // idempotent
    expect((await request(http).get('/saved').set(as(b1))).body.map((i: any) => i.id)).toEqual([X]);
    expect((await request(http).get('/saved').set(as(b2))).body).toEqual([]);
    expect((await request(http).get('/discover?q=cable').set(as(b1))).body.items.find((i: any) => i.id === X).saved).toBe(true);
    expect((await request(http).get('/discover?q=cable').set(as(b2))).body.items.find((i: any) => i.id === X).saved).toBe(false);
    await request(http).delete(`/saved/${X}`).set(as(b1)).expect(200); expect((await request(http).get('/saved').set(as(b1))).body).toEqual([]);
    await request(http).post('/saved/not-a-uuid').set(as(b1)).send({}).expect(404);
  });

  it('orders: list and detail are scoped to what the user may see', async () => {
    const mine = (await request(http).get('/orders').set(as(b1)).expect(200)).body; expect(mine).toHaveLength(1); expect(mine[0]).toMatchObject({ supplier: 'Supplier B', plant: 'Plant One', status: 'pr_created', value: 1200 });
    expect((await request(http).get('/orders').set(as(b2))).body).toEqual([]);
    expect((await request(http).get('/orders').set(as(central))).body).toHaveLength(1);
    const o = (await request(http).get(`/orders/${mine[0].id}`).set(as(b1)).expect(200)).body; expect(o.lines[0]).toMatchObject({ item: 'Cable 4mm', ordered: 10, unitPrice: 120 }); expect(o.events.map((e: any) => e.kind)).toContain('pr_created');
    await request(http).get(`/orders/${mine[0].id}`).set(as(b2)).expect(404);
    const rival = await login('rival', 'admin@rival.test'); await request(http).get(`/orders/${mine[0].id}`).set(as(rival)).expect(404); expect((await request(http).get('/orders').set(as(rival))).body).toEqual([]);
  });

  it('home summary: work for the requester, tasks only where the role can act', async () => {
    const h = (await request(http).get(`/home?plantId=${p1}`).set(as(b1)).expect(200)).body;
    expect(h.requirements).toHaveLength(1); expect(h.orders.open).toBe(1); expect(h.tasks).toEqual({}); expect(h.expiringContracts).toBeUndefined(); // a requester gets no procurement tasks or contract data
    const c = (await request(http).get('/home').set(as(central)).expect(200)).body; expect(c.tasks).toHaveProperty('openExceptions'); expect(c.tasks).toHaveProperty('reviewQueue'); expect(Array.isArray(c.expiringContracts)).toBe(true);
    await request(http).get('/home?plantId=bad').set(as(b1)).expect(400);
  });

  it('supplier overview: procurement only; includes vendor codes, contracts and performance', async () => {
    await request(http).get(`/suppliers/${supA}/overview`).set(as(b1)).expect(403);
    const s = (await request(http).get(`/suppliers/${supA}/overview`).set(as(central)).expect(200)).body;
    expect(s).toMatchObject({ legalName: 'Supplier A', status: 'active' }); expect(s.erpCodes).toEqual([{ server: 'S01', vendorCode: 'VA' }]); expect(s.contracts[0]).toMatchObject({ number: 'ARC-A', lines: 1 }); expect(s.performance.orders).toBe(0); expect(s.items.map((i: any) => i.name)).toEqual(['Cable 4mm']);
    const rival = await login('rival', 'admin@rival.test'); await request(http).get(`/suppliers/${supA}/overview`).set(as(rival)).expect(404);
  });

  it('contracts register carries applicability and utilisation; demo flag is exposed', async () => {
    const list = (await request(http).get('/contracts').set(as(central))).body; const a = list.find((c: any) => c.number === 'ARC-A'); const b = list.find((c: any) => c.number === 'ARC-B');
    expect(a.appliesTo).toEqual(['Ports', 'Power']); expect(+b.utilisation).toBe(10); // 10 of 100 ordered through MonoSource
    expect((await request(http).get('/me').set(as(b1))).body.tenant.demo).toBe(false);
    await sql(`UPDATE tenants SET config = config || '{"demo": true}' WHERE slug='exp'`); expect((await request(http).get('/me').set(as(b1))).body.tenant.demo).toBe(true);
  });
});
