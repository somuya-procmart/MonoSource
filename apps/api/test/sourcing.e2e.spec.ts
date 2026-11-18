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

beforeAll(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;'); await c.end();
  await migrate(process.env.DATABASE_ADMIN_URL);
  app = await createApp(); await app.init(); http = app.getHttpServer(); outbox = app.get(OutboxService);
  await ensurePlatformAdmin(app.get(Db), 'platform@test.local', PW);
});
afterAll(async () => { await app.close(); });

describe('Phase 4: sourcing — RFQ, quotes, award, exceptions', () => {
  let admin: string, buyer: string, ops: string, s01: string, biz: string, plant: string;
  let itemA: string, itemB: string, sA: string, sB: string, sC: string, sPM: string;
  let reqId: string, lineIds: string[], rfqId: string, rfqLines: any[];

  it('setup: tenant, plant on simulated SAP, model-3 allocation, users, suppliers, items', async () => {
    const plat = await login('platform', 'platform@test.local');
    await request(http).post('/platform/tenants').set(as(plat)).send({ slug: 'acme', name: 'Acme', adminEmail: 'admin@acme.test', adminPassword: PW }).expect(201);
    await request(http).post('/platform/tenants').set(as(plat)).send({ slug: 'rival', name: 'Rival', adminEmail: 'admin@rival.test', adminPassword: PW }).expect(201);
    admin = await login('acme', 'admin@acme.test');
    s01 = (await request(http).post('/erp-systems').set(as(admin)).send({ code: 'S01', name: 'sim', kind: 'mock-sap' })).body.id;
    await request(http).post('/org/import').set(as(admin)).attach('file', Buffer.from('BU,Server,Company code,Company name,Plant code,Plant name\nPower,S01,1000,Acme Power,P1,Plant One\n'), 'o.csv').expect(201);
    const t = (await request(http).get('/org/tree').set(as(admin))).body;
    biz = t.find((n: any) => n.levelType === 'business').id; plant = t.find((n: any) => n.levelType === 'plant').id;
    await request(http).post('/allocations').set(as(admin)).send({ scopeNodeId: biz, model: 3, status: 'active', approvedByCustomer: 'cust (test)', approvedByProcmart: 'pm (test)' }).expect(201);
    for (const [e, r, s] of [['buyer@acme.test', 'plant_procurement', plant], ['ops@acme.test', 'procmart_ops', undefined]] as const)
      await request(http).post('/users').set(as(admin)).send({ email: e, name: e, password: PW, roleKey: r, scopeNodeId: s }).expect(201);
    buyer = await login('acme', 'buyer@acme.test'); ops = await login('acme', 'ops@acme.test');
    await request(http).post('/catalogue/import').set(as(admin)).attach('file', Buffer.from('name,uom,category,server,material_code\nHydraulic hose 1in,EA,hoses,S01,5001\nValve actuator,EA,valves,,\n'), 'i.csv').expect(201);
    const items = (await request(http).get('/catalogue/search?q=').set(as(admin))).body;
    itemA = items.find((i: any) => i.name.startsWith('Hydraulic')).id; itemB = items.find((i: any) => i.name.startsWith('Valve')).id;
    const mk = async (n: string, pm = false) => (await request(http).post('/suppliers').set(as(admin)).send({ legalName: n, isProcmart: pm }).expect(201)).body.id;
    sA = await mk('Supplier A'); sB = await mk('Supplier B'); sC = await mk('Supplier C (no vendor code)'); sPM = await mk('ProcMart Direct', true);
    for (const [s, v] of [[sA, 'VA'], [sB, 'VB'], [sPM, 'VP']]) await request(http).post(`/suppliers/${s}/erp-codes`).set(as(admin)).send({ erpSystemId: s01, vendorCode: v }).expect(201);
  });

  it('lines with no contract in a Model 3 scope are parked for sourcing; no PR is sent', async () => {
    for (const [i, q] of [[itemA, 4], [itemB, 2]] as const) await request(http).post('/cart/items').set(as(buyer)).send({ plantId: plant, itemId: i, qty: q }).expect(201);
    const cart = (await request(http).get(`/cart?plantId=${plant}`).set(as(buyer))).body;
    expect(cart.lines.map((l: any) => l.routing.route)).toEqual(['sourcing', 'sourcing']);
    const sub = await request(http).post(`/cart/${cart.cartId}/submit`).set(as(buyer)).expect(201);
    expect(sub.body.streams).toBe(0); reqId = sub.body.requirementId;
    expect(await outbox.runOnce()).toBe(0);
    const pend = (await request(http).get('/sourcing/pending').set(as(ops)).expect(200)).body;
    expect(pend).toHaveLength(2); lineIds = [...pend].sort((x: any, y: any) => x.item.localeCompare(y.item)).map((p: any) => p.lineId); // Hydraulic hose first
    await request(http).get('/sourcing/pending').set(as(buyer)).expect(403);
  });

  it('RFQ cannot start without customer policy; gates for supplier count, vendor code and ProcMart bidding', async () => {
    const body = (ids: string[], lines = [lineIds[0]]) => ({ requirementId: reqId, requirementLineIds: lines, supplierIds: ids });
    expect((await request(http).post('/rfqs').set(as(ops)).send(body([sA, sB]))).status).toBe(409); // minQuotes undecided (Q12)
    await request(http).post('/policy').set(as(admin)).send({ minQuotes: 2 }).expect(201);
    await request(http).post('/rfqs').set(as(buyer)).send(body([sA, sB])).expect(403);
    await request(http).post('/rfqs').set(as(ops)).send(body([sA])).expect(400);
    expect((await request(http).post('/rfqs').set(as(ops)).send(body([sA, sC]))).body.message).toMatch(/no vendor code/);
    expect((await request(http).post('/rfqs').set(as(ops)).send(body([sA, sPM]))).body.message).toMatch(/Q2/); // undecided
    await request(http).post('/policy').set(as(admin)).send({ procmartMayBid: false }).expect(201);
    expect((await request(http).post('/rfqs').set(as(ops)).send(body([sA, sPM]))).status).toBe(409);
    const sug = (await request(http).get(`/rfqs/suggest-suppliers?requirementId=${reqId}`).set(as(ops))).body.map((s: any) => s.legalName);
    expect(sug).toEqual(['Supplier A', 'Supplier B']); // ProcMart and no-code supplier excluded
    const r = await request(http).post('/rfqs').set(as(ops)).send(body([sA, sB])).expect(201);
    rfqId = r.body.id; expect(r.body.number).toBe('RFQ-000001');
    await request(http).post('/rfqs').set(as(ops)).send(body([sA, sB])).expect(409); // line already in an RFQ
    expect((await request(http).get('/sourcing/pending').set(as(ops))).body).toHaveLength(1);
  });

  it('quotes: only invited suppliers, UOM must match, one per supplier, min quotes before close', async () => {
    rfqLines = (await request(http).get(`/rfqs/${rfqId}`).set(as(ops))).body.comparison; const l = rfqLines[0].id;
    await request(http).post(`/rfqs/${rfqId}/quotes`).set(as(ops)).send({ supplierId: sC, lines: [{ rfqLineId: l, unitPrice: 1, uom: 'EA' }] }).expect(400);
    await request(http).post(`/rfqs/${rfqId}/quotes`).set(as(ops)).send({ supplierId: sA, lines: [{ rfqLineId: l, unitPrice: 100, uom: 'KG' }] }).expect(400);
    await request(http).post(`/rfqs/${rfqId}/quotes`).set(as(ops)).send({ supplierId: sA, lines: [{ rfqLineId: l, unitPrice: -5, uom: 'EA' }] }).expect(400);
    // supplier A quotes itself through the portal; an uninvited supplier sees nothing and cannot quote
    for (const [e, sid] of [['a@acme.test', sA], ['c@acme.test', sC]]) await request(http).post('/users').set(as(admin)).send({ email: e, name: e, password: PW, roleKey: 'supplier', kind: 'supplier', supplierId: sid }).expect(201);
    const pa = await login('acme', 'a@acme.test'), pc = await login('acme', 'c@acme.test');
    expect((await request(http).get('/portal/rfqs').set(as(pc))).body).toEqual([]);
    await request(http).post(`/portal/rfqs/${rfqId}/quote`).set(as(pc)).send({ lines: [{ rfqLineId: l, unitPrice: 1, uom: 'EA' }] }).expect(404);
    const mine = (await request(http).get('/portal/rfqs').set(as(pa))).body; expect(mine).toHaveLength(1); expect(JSON.stringify(mine)).not.toContain('Supplier B'); expect(mine[0]).not.toHaveProperty('comparison'); expect(Object.keys(mine[0].lines[0]).sort()).toEqual(['id', 'item', 'qty', 'uom']); // no other suppliers or prices
    await request(http).post(`/portal/rfqs/${rfqId}/quote`).set(as(pa)).send({ lines: [{ rfqLineId: l, unitPrice: 100, freightPerUnit: 5, leadTimeDays: 7, uom: 'EA' }] }).expect(201);
    await request(http).post(`/rfqs/${rfqId}/quotes`).set(as(ops)).send({ supplierId: sA, lines: [{ rfqLineId: l, unitPrice: 90, uom: 'EA' }] }).expect(409);
    expect((await request(http).post(`/rfqs/${rfqId}/close`).set(as(ops))).status).toBe(409); // 1 of 2 quotes
    await request(http).post(`/rfqs/${rfqId}/quotes`).set(as(ops)).send({ supplierId: sB, lines: [{ rfqLineId: l, unitPrice: 98, freightPerUnit: 10, leadTimeDays: 5, uom: 'EA' }] }).expect(201);
    await request(http).post(`/rfqs/${rfqId}/close`).set(as(ops)).expect(201);
    await request(http).post(`/rfqs/${rfqId}/quotes`).set(as(ops)).send({ supplierId: sB, lines: [{ rfqLineId: l, unitPrice: 1, uom: 'EA' }] }).expect(409);
  });

  it('comparison ranks on landed cost (L1 = A at 105 vs B at 108)', async () => {
    const cmp = (await request(http).get(`/rfqs/${rfqId}`).set(as(ops))).body.comparison[0];
    expect(cmp.ranked.map((r: any) => [r.supplierName, r.landedUnitCost, r.isL1])).toEqual([['Supplier A', 105, true], ['Supplier B', 108, false]]);
    expect(cmp.ranked[1].deltaPct).toBeCloseTo(2.86, 1);
    await request(http).post(`/rfqs/${rfqId}/recommend`).set(as(ops)).send({ rfqLineId: cmp.id, quoteLineId: cmp.ranked[0].quoteLineId }).expect(201);
  });

  it('award is the customer’s call: ops cannot; non-L1 needs a reason; award feeds the PR pipeline', async () => {
    const cmp = (await request(http).get(`/rfqs/${rfqId}`).set(as(ops))).body.comparison[0];
    const [a, b] = cmp.ranked;
    await request(http).post(`/rfqs/${rfqId}/award`).set(as(ops)).send({ awards: [{ rfqLineId: cmp.id, quoteLineId: a.quoteLineId }] }).expect(403);
    await request(http).post(`/rfqs/${rfqId}/award`).set(as(buyer)).send({ awards: [{ rfqLineId: cmp.id, quoteLineId: b.quoteLineId }] }).expect(400);
    const ok = await request(http).post(`/rfqs/${rfqId}/award`).set(as(buyer)).send({ awards: [{ rfqLineId: cmp.id, quoteLineId: b.quoteLineId, reason: 'Faster delivery needed for shutdown' }] }).expect(201);
    expect(ok.body).toMatchObject({ streams: 1, rfqStatus: 'awarded' });
    await request(http).post(`/rfqs/${rfqId}/award`).set(as(buyer)).send({ awards: [{ rfqLineId: cmp.id, quoteLineId: a.quoteLineId }] }).expect(409);
    expect(await outbox.runOnce()).toBe(1);
    const r = (await request(http).get(`/requirements/${reqId}`).set(as(buyer))).body;
    const line = r.lines.find((x: any) => x.item_id === itemA);
    expect(line).toMatchObject({ route: 'award', model: 3, fee_treatment: 'management_fee', supplier_name: 'Supplier B' });
    expect(+line.unit_price).toBe(98);
    const st = r.streams.find((s: any) => s.id === line.stream_id);
    expect(st.status).toBe('pr_created'); expect(st.pr_reference).toMatch(/^SIM-PR-/);
    expect(r.events.map((e: any) => e.kind)).toEqual(expect.arrayContaining(['rfq_opened', 'awarded', 'pr_created']));
  });

  it('exception queue: a blocked PR raises an exception; resolving needs a note', async () => {
    const pend = (await request(http).get('/sourcing/pending').set(as(ops))).body; expect(pend).toHaveLength(1);
    const r = await request(http).post('/rfqs').set(as(ops)).send({ requirementId: reqId, requirementLineIds: [pend[0].lineId], supplierIds: [sA, sB] }).expect(201);
    const l = (await request(http).get(`/rfqs/${r.body.id}`).set(as(ops))).body.comparison[0].id;
    for (const [s, p] of [[sA, 40], [sB, 45]] as const) await request(http).post(`/rfqs/${r.body.id}/quotes`).set(as(ops)).send({ supplierId: s, lines: [{ rfqLineId: l, unitPrice: p, uom: 'EA' }] }).expect(201);
    await request(http).post(`/rfqs/${r.body.id}/close`).set(as(ops)).expect(201);
    const c = (await request(http).get(`/rfqs/${r.body.id}`).set(as(ops))).body.comparison[0];
    await request(http).post(`/rfqs/${r.body.id}/award`).set(as(buyer)).send({ awards: [{ rfqLineId: l, quoteLineId: c.ranked[0].quoteLineId }] }).expect(201); // L1, no reason needed
    await outbox.runOnce();
    const ex = (await request(http).get('/exceptions').set(as(ops)).expect(200)).body;
    expect(ex).toHaveLength(1); expect(ex[0]).toMatchObject({ kind: 'pr_failed', item: 'Valve actuator' }); expect(ex[0].detail).toMatch(/no material code on ERP S01/);
    await request(http).post(`/exceptions/${ex[0].id}/resolve`).set(as(ops)).send({ resolution: ' ' }).expect(400);
    await request(http).post(`/exceptions/${ex[0].id}/resolve`).set(as(ops)).send({ resolution: 'Material code requested from MDM' }).expect(201);
    expect((await request(http).get('/exceptions').set(as(ops))).body).toHaveLength(0);
    expect((await request(http).get('/exceptions?status=resolved').set(as(ops))).body).toHaveLength(1);
  });

  it('isolation: another customer sees no RFQs, exceptions or sourcing; DB rejects non-L1 award without reason', async () => {
    const rival = await login('rival', 'admin@rival.test');
    await request(http).get(`/rfqs/${rfqId}`).set(as(rival)).expect(404);
    for (const p of ['/rfqs', '/exceptions']) expect((await request(http).get(p).set(as(rival)).expect(200)).body).toEqual([]);
    const c = new Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await c.connect();
    await expect(c.query(`UPDATE awards SET is_l1=false, reason=NULL`)).rejects.toThrow(/check constraint/);
    await c.end();
  });
});
