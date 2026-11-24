process.env.NODE_ENV = 'test';
process.env.OUTBOX_WORKER = 'off';
process.env.DATABASE_ADMIN_URL = 'postgres://postgres@localhost:54322/monosource_test';
process.env.DATABASE_URL = 'postgres://monosource_app:monosource_app_dev@localhost:54322/monosource_test';
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

describe('Source of supply: cases, coverage requests, non-catalogue, aliases', () => {
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

  let Z: string;
  it('setup: an item whose only contract covers plant one', async () => {
    await arc('ARC-D', supB, [power], 80, '7002');
    Z = (await request(http).get('/catalogue/search?q=').set(as(admin))).body.find((i: any) => i.name === 'Cable 2mm').id;
  });

  it('ARCs are group-level: a contract scoped to plant one is case A (orderable) at plant two as well; E when nothing exists', async () => {
    const at = async (item: string, plant: string, t: string) => (await request(http).get(`/discover?plantId=${plant}&q=Cable 2mm`).set(as(t)).expect(200)).body.items.find((i: any) => i.id === item);
    expect((await at(Z, p1, b1)).source.case).toBe('A');
    const b = await at(Z, p2, b2); expect(b.source.case).toBe('A'); expect(b.source.supplies).toHaveLength(1); // the compact list holds only orderable supplies
    expect((await request(http).get(`/products/${Y}?plantId=${p1}`).set(as(b1))).body.source.case).toBe('E');
  });

  it('an ARC item routes to its ARC at any plant; an item with no ARC goes to ProcMart', async () => {
    await request(http).post('/cart/items').set(as(b2)).send({ plantId: p2, itemId: Z, qty: 5 }).expect(201); // ARC-D's MOQ
    await request(http).post('/cart/items').set(as(b2)).send({ plantId: p2, itemId: Y, qty: 1, intent: 'source' }).expect(201);
    const cart = (await request(http).get(`/cart?plantId=${p2}`).set(as(b2))).body; const by = Object.fromEntries(cart.lines.map((l: any) => [l.item_id, l.routing]));
    expect(by[Z]).toMatchObject({ route: 'arc' }); expect(by[Y]).toMatchObject({ route: 'sourcing', model: 3 });
    for (const l of cart.lines) await request(http).delete(`/cart/lines/${l.id}`).set(as(b2)).expect(200);
  });

  it('non-catalogue requirement becomes a requested item routed to sourcing, not to a contract', async () => {
    await request(http).post('/cart/non-catalogue').set(as(b1)).send({ plantId: p1, name: 'Anti-vibration rubber mounts 40 x 40', qty: 8, uom: 'EA', reason: 'pump base' }).expect(201);
    const cart = (await request(http).get(`/cart?plantId=${p1}`).set(as(b1))).body; const line = cart.lines.find((l: any) => l.intent === 'source');
    expect(line).toBeTruthy(); expect(line.routing.route).toBe('sourcing');
    const sub = await request(http).post(`/cart/${cart.cartId}/submit`).set(as(b1)).expect(201); await outbox.runOnce();
    const pend = (await request(http).get('/sourcing/pending').set(as(central))).body; expect(JSON.stringify(pend)).toMatch(/rubber mounts/);
    expect(sub.body.requirementId).toBeTruthy();
  });

  it('search matches common names, SAP descriptions and applications, and says what matched', async () => {
    await request(http).post(`/catalogue/items/${X}/aliases`).set(as(admin)).send({ kind: 'common_name', value: 'power wire' }).expect(201);
    await request(http).post(`/catalogue/items/${X}/aliases`).set(as(admin)).send({ kind: 'sap_description', value: 'CABLE FLEX 4SQMM CU' }).expect(201);
    const d = async (q: string) => (await request(http).get(`/discover?plantId=${p1}&q=${encodeURIComponent(q)}`).set(as(b1)).expect(200)).body.items;
    expect((await d('power wire'))[0].matchedOn).toMatchObject({ kind: 'common_name', value: 'power wire' });
    expect((await d('CABLE FLEX 4SQMM CU'))[0].id).toBe(X);
    expect(await d('zzz no such thing')).toEqual([]);
  });

  it('staff-entered alternatives are approved equivalents; tenant isolation holds', async () => {
    await request(http).post('/catalogue/alternatives').set(as(admin)).send({ itemId: X, alternativeItemId: Y }).expect(201);
    const p = (await request(http).get(`/products/${X}?plantId=${p1}`).set(as(b1))).body; expect(p.alternatives[0].status).toBe('approved');
    const plat = await login('platform', 'platform@test.local'); const rivalAdmin = await login('rival', 'admin@rival.test'); void plat;
    expect((await request(http).get('/coverage-requests?status=open').set(as(rivalAdmin)).expect(200)).body).toEqual([]);
    await request(http).get(`/products/${X}`).set(as(rivalAdmin)).expect(404);
  });
});
