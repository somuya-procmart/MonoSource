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

describe('Agentic procurement simulation: agents, human tasks, notifications', () => {
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

  let req: string;
  const ws = async (t = b2) => (await request(http).get(`/requirements/${req}/workspace`).set(as(t)).expect(200)).body;

  it('submitting an item with no ARC starts the ProcMart sourcing run (no applicability step) and notifies the requester', async () => {
    await request(http).post('/cart/items').set(as(b2)).send({ plantId: p2, itemId: Y, qty: 500, intent: 'source', note: 'need 500' }).expect(201);
    const cart = (await request(http).get(`/cart?plantId=${p2}`).set(as(b2))).body; req = (await request(http).post(`/cart/${cart.cartId}/submit`).set(as(b2)).expect(201)).body.requirementId;
    const w = await ws(); expect(w).toMatchObject({ kind: 'sourcing', step: 0, stage: 'coordination' });
    expect(w.agents.map((a: any) => a.agent)).toEqual(['discovery', 'outreach', 'followup', 'quotation', 'comparison', 'coordination']);
    expect(w.threads.map((t: any) => t.status)).toEqual(['invited', 'invited', 'invited']);
    expect(w.tasks).toEqual([]); // ARCs are group-level: there is nothing to confirm about plant applicability
    expect(w.timeline.every((e: any) => e.simulated || e.agent === 'human')).toBe(true);
    const n = (await request(http).get('/notifications').set(as(b2)).expect(200)).body; expect(n.unread).toBeGreaterThanOrEqual(2); expect(n.items[0].email.body).toMatch(/not sent/);
    await request(http).get(`/requirements/${req}/workspace`).set(as(b1)).expect(404); // another plant's requester cannot see it
  });

  it('the scripted days progress, and human decisions gate the process', async () => {
    await request(http).post(`/requirements/${req}/demo/advance`).set(as(admin)).expect(201);
    let w = await ws(); expect(w.threads.find((t: any) => t.status === 'quoted')).toBeTruthy(); expect(w.waiting).toMatchObject({ responded: 1, total: 3 });
    await request(http).post(`/requirements/${req}/demo/advance`).set(as(admin)).expect(201);
    w = await ws(); expect(w.tasks.filter((t: any) => t.status === 'open').map((t: any) => t.kind).sort()).toEqual(['supplier_exception', 'technical_clarification']);
    const adv = await request(http).post(`/requirements/${req}/demo/advance`).set(as(admin)).expect(409); expect(adv.body.message).toMatch(/human decision/);
    const tech = w.tasks.find((t: any) => t.kind === 'technical_clarification');
    await request(http).post(`/tasks/${tech.id}/resolve`).set(as(b2)).send({ action: 'accept' }).expect(400); // not the requester's decision
    expect((await request(http).get('/tasks').set(as(b2)).expect(200)).body.needsMe).toEqual([]);
    const mine = (await request(http).get('/tasks').set(as(central)).expect(200)).body; expect(mine.needsMe.map((t: any) => t.kind)).toEqual(expect.arrayContaining(['technical_clarification', 'supplier_exception']));
    await request(http).post(`/tasks/${tech.id}/resolve`).set(as(central)).send({ action: 'accept', note: 'same dimensions and load rating' }).expect(201);
    w = await ws(); expect(w.step).toBe(3); expect(w.comparison.rows).toHaveLength(2); expect(w.comparison.rows.filter((r: any) => r.lowest)).toHaveLength(1);
    const com = w.tasks.find((t: any) => t.kind === 'commercial_review'); expect(com.status).toBe('open');
    await request(http).post(`/requirements/${req}/demo/advance`).set(as(admin)).expect(409);
    await request(http).post(`/tasks/${com.id}/resolve`).set(as(central)).send({ action: 'proceed', supplier: 'Nobody Ltd' }).expect(400);
    await request(http).post(`/tasks/${com.id}/resolve`).set(as(central)).send({ action: 'proceed', supplier: w.comparison.rows[0].supplier }).expect(201);
    w = await ws(); expect(w).toMatchObject({ step: 4, stage: 'approval' }); expect(w.sap.pr).toMatch(/^PR-SIM-/); expect(w.sap.note).toMatch(/does not approve/);
    for (let i = 0; i < 3; i++) await request(http).post(`/requirements/${req}/demo/advance`).set(as(admin)).expect(201);
    w = await ws(); expect(w).toMatchObject({ step: 7, stage: 'complete' }); expect(w.sap.po).toMatch(/^PO-SIM-/);
    await request(http).post(`/requirements/${req}/demo/advance`).set(as(admin)).expect(409);
    await request(http).post(`/tasks/${com.id}/resolve`).set(as(central)).send({ action: 'proceed' }).expect(409); // already decided
  });

  it('notifications: read state, preferences, and categories are separate from tasks', async () => {
    const n = (await request(http).get('/notifications').set(as(b2)).expect(200)).body; expect(n.items.map((i: any) => i.category)).toEqual(expect.arrayContaining(['milestone', 'supplier', 'human', 'complete']));
    await request(http).post('/notifications/read').set(as(b2)).send({ ids: [n.items[0].id] }).expect(201); expect((await request(http).get('/notifications').set(as(b2))).body.unread).toBe(n.unread - 1);
    await request(http).post('/notifications/read').set(as(b2)).send({ all: true }).expect(201); expect((await request(http).get('/notifications').set(as(b2))).body.unread).toBe(0);
    await request(http).put('/notification-prefs').set(as(b2)).send({ prefs: { supplier: false } }).expect(200);
    const before = (await request(http).get('/notifications').set(as(b2))).body.items.length;
    await request(http).post('/cart/items').set(as(b2)).send({ plantId: p2, itemId: Y, qty: 5, intent: 'source' }).expect(201);
    const cart = (await request(http).get(`/cart?plantId=${p2}`).set(as(b2))).body; const r2 = (await request(http).post(`/cart/${cart.cartId}/submit`).set(as(b2)).expect(201)).body.requirementId;
    await request(http).post(`/requirements/${r2}/demo/advance`).set(as(admin)).expect(201); // step 1 would send two supplier notifications
    const after = (await request(http).get('/notifications').set(as(b2))).body; expect(after.items.length - before).toBe(2); expect(after.items.some((i: any) => i.category === 'supplier' && i.requirementId === r2)).toBe(false);
    expect((await request(http).get('/notifications').set(as(b1))).body.items).toEqual([]); // nobody else's
  });
});
