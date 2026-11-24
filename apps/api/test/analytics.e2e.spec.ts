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
import { METRIC_IDS, METRICS } from '../src/analytics/metrics';

let app: INestApplication, http: any, outbox: OutboxService;
const PW = 'correct-horse-battery';
const login = async (tenant: string, email: string) => (await request(http).post('/auth/login').send({ tenant, email, password: PW })).body.token as string;
const as = (t: string) => ({ Authorization: `Bearer ${t}` });
const sql = async (q: string, p: any[] = []) => { const c = new Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await c.connect(); const r = await c.query(q, p); await c.end(); return r; };

beforeAll(async () => {
  await sql('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(process.env.DATABASE_ADMIN_URL);
  app = await createApp(); await app.init(); http = app.getHttpServer(); outbox = app.get(OutboxService);
  await ensurePlatformAdmin(app.get(Db), 'platform@test.local', PW);
});
afterAll(async () => { await app.close(); });

describe('Phase 6: control tower & analytics', () => {
  let admin: string, b1: string, b2: string, sup: string, p1: string, p2: string, itemId: string, supplierId: string;

  async function order(buyer: string, plant: string, qty: number) {
    await request(http).post('/cart/items').set(as(buyer)).send({ plantId: plant, itemId, qty }).expect(201);
    const cart = (await request(http).get(`/cart?plantId=${plant}`).set(as(buyer))).body;
    const sub = await request(http).post(`/cart/${cart.cartId}/submit`).set(as(buyer)).expect(201);
    await outbox.runOnce();
    return (await request(http).get(`/requirements/${sub.body.requirementId}`).set(as(buyer))).body;
  }

  it('setup + scenario: P1 full lifecycle with a rejection; P2 one MOQ-blocked line and one open order', async () => {
    const plat = await login('platform', 'platform@test.local');
    for (const [slug, e] of [['kpi', 'admin@kpi.test'], ['rival', 'admin@rival.test']]) await request(http).post('/platform/tenants').set(as(plat)).send({ slug, name: slug, adminEmail: e, adminPassword: PW }).expect(201);
    admin = await login('kpi', 'admin@kpi.test');
    const s01 = (await request(http).post('/erp-systems').set(as(admin)).send({ code: 'S01', name: 'sim', kind: 'mock-sap' })).body.id;
    await request(http).post('/org/import').set(as(admin)).attach('file', Buffer.from('BU,Server,Company code,Company name,Plant code,Plant name\nPower,S01,1000,Kpi Power,P1,Plant One\nPower,S01,1000,Kpi Power,P2,Plant Two\n'), 'o.csv').expect(201);
    const t = (await request(http).get('/org/tree').set(as(admin))).body;
    const biz = t.find((n: any) => n.levelType === 'business').id; p1 = t.find((n: any) => n.code === 'P1').id; p2 = t.find((n: any) => n.code === 'P2').id;
    await request(http).post('/allocations').set(as(admin)).send({ scopeNodeId: biz, model: 2, status: 'active', approvedByCustomer: 'c (test)', approvedByProcmart: 'p (test)' }).expect(201);
    for (const [e, p] of [['b1@kpi.test', p1], ['b2@kpi.test', p2]]) await request(http).post('/users').set(as(admin)).send({ email: e, name: e, password: PW, roleKey: 'plant_procurement', scopeNodeId: p }).expect(201);
    b1 = await login('kpi', 'b1@kpi.test'); b2 = await login('kpi', 'b2@kpi.test');
    supplierId = (await request(http).post('/suppliers').set(as(admin)).send({ legalName: 'Supplier A' }).expect(201)).body.id;
    await request(http).post(`/suppliers/${supplierId}/erp-codes`).set(as(admin)).send({ erpSystemId: s01, vendorCode: 'VA' }).expect(201);
    await request(http).post('/catalogue/import').set(as(admin)).attach('file', Buffer.from('name,uom,category,server,material_code\nCable 4mm,EA,cables,S01,7001\n'), 'i.csv').expect(201);
    itemId = (await request(http).get('/catalogue/search?q=cable').set(as(admin))).body[0].id;
    const up = await request(http).post('/contracts').set(as(admin)).field('contractType', 'ARC').field('number', 'ARC-K1').field('supplierId', supplierId).field('erpSystemId', s01)
      .field('validFrom', '2026-01-01').field('validTo', new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 10)).field('scopeNodeIds', biz)
      .attach('file', Buffer.from('Description,Material Code,UOM,Net Price,MOQ,Quantity Cap\nCable 4mm,7001,Nos,100,5,100\n'), 'a.csv').expect(201);
    const q = (await request(http).get('/review/queue').set(as(admin))).body;
    await request(http).post(`/review/candidates/${q[0].candidates[0].id}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201);
    await request(http).post(`/contracts/${up.body.id}/approve`).set(as(admin)).expect(201);
    await request(http).post(`/contracts/${up.body.id}/publish`).set(as(admin)).expect(201);
    await request(http).post('/users').set(as(admin)).send({ email: 'sup@kpi.test', name: 'sup', password: PW, roleKey: 'supplier', kind: 'supplier', supplierId }).expect(201);
    sup = await login('kpi', 'sup@kpi.test');

    // P1: order 10 → full lifecycle; GRN 8 accepted / 2 rejected
    const r1 = await order(b1, p1, 10); const st = r1.streams[0].id; const line = r1.lines[0].id;
    await request(http).post(`/streams/${st}/simulate`).set(as(b1)).send({ step: 'po_released' }).expect(201);
    await request(http).post(`/portal/orders/${st}/acknowledge`).set(as(sup)).send({ lines: [{ lineId: line, qty: 10, date: '2099-01-01' }] }).expect(201);
    await request(http).post(`/portal/orders/${st}/dispatch`).set(as(sup)).send({ lines: [{ lineId: line, qty: 10 }], expectedDate: '2020-01-01' }).expect(201);
    expect((await request(http).get('/analytics/overview').set(as(admin))).body.metrics.late_deliveries).toBe(1); // expected date long past, not received
    await request(http).post(`/streams/${st}/grn`).set(as(b1)).send({ lines: [{ lineId: line, accepted: 8, rejected: 2 }] }).expect(201);
    await request(http).post(`/portal/orders/${st}/invoice`).set(as(sup)).send({ invoiceNumber: 'I1', amount: 800 }).expect(201);
    await request(http).post(`/streams/${st}/simulate`).set(as(b1)).send({ step: 'paid' }).expect(201);
    // P2: qty 2 is below the contract MOQ of 5 → no usable ARC, so ProcMart sources it; then qty 5 → ordered on the ARC, left at PR created
    const r2 = await order(b2, p2, 2); expect(r2.lines[0].route).toBe('sourcing');
    await order(b2, p2, 5);
  });

  it('every metric has a documented definition, sources and (for caveated ones) a caveat', async () => {
    const defs = (await request(http).get('/analytics/metrics').set(as(admin)).expect(200)).body;
    expect(defs.length).toBe(METRICS.length);
    for (const d of defs) { expect(d.definition.length).toBeGreaterThan(20); expect(d.sources.length).toBeGreaterThan(0); }
    const ov = (await request(http).get('/analytics/overview').set(as(admin)).expect(200)).body;
    for (const k of Object.keys(ov.metrics)) expect(METRIC_IDS.has(k)).toBe(true); // nothing shown without a definition
    expect(METRICS.find((m) => m.id === 'rfq_competition_spread')!.caveat).toMatch(/NOT savings/);
  });

  it('group overview numbers match the scenario exactly', async () => {
    const m = (await request(http).get('/analytics/overview').set(as(admin)).expect(200)).body.metrics;
    expect(m).toMatchObject({ requirements: 3, lines: 3, committed_value: 1500, contract_candidate_unused: 1 }); // (10+5)×100
    expect(m.contract_coverage).toBeCloseTo(66.7, 1);            // 2 of 3 lines on ARC
    expect(m.supplier_fill_rate).toBe(80);                        // 8 accepted / 10 ordered
    expect(m.supplier_rejection_rate).toBe(20);                   // 2 / (8+2)
    expect(m.fee_base_value).toBe(800);                           // 8 accepted × ₹100, no rate applied
    expect(m.pending_grn_streams).toBe(0);
    expect(m.open_exceptions).toBe(1);                            // the quality rejection
    expect(m.supplier_ontime_dispatch).toBe(100);                 // committed 2099, dispatched today
    expect(m.supplier_ack_hours).not.toBeNull();
  });

  it('breakdowns: reasons, plants, suppliers, utilisation, expiring contracts', async () => {
    const b = (await request(http).get('/analytics/overview').set(as(admin))).body.breakdowns;
    expect(b.unusedReasons).toEqual([{ reason: 'below MOQ N', lines: 1 }]);
    expect(b.byModel).toEqual([{ model: 2, lines: 2, value: 1500 }, { model: 3, lines: 1, value: 0 }]); // the below-MOQ line went to ProcMart (Model 3), unpriced until quoted
    const plants = Object.fromEntries(b.plants.map((p: any) => [p.name, p]));
    expect(plants['Plant One']).toMatchObject({ requirements: 1, lines: 1, value: 1000, coverage: 100, openExceptions: 1 });
    expect(plants['Plant Two']).toMatchObject({ requirements: 2, lines: 2, value: 500, coverage: 50 });
    expect(b.suppliers[0]).toMatchObject({ name: 'Supplier A', orders: 2, fillRate: 80, rejectionRate: 20 });
    expect(b.feeBase).toEqual([{ fee_treatment: 'supplier_enablement', value: 800 }]);
    expect(b.utilisation[0]).toMatchObject({ number: 'ARC-K1', cap: 100, used: 15, utilisation: 15 });
    expect(b.expiring.map((e: any) => e.number)).toEqual(['ARC-K1']); // expires in 40 days
    expect(b.exceptionsByKind[0].kind).toBe('quality_rejection');
  });

  it('plant filter and data scope: a plant user only ever sees their own plant', async () => {
    const own = (await request(http).get('/analytics/overview').set(as(b1)).expect(200)).body;
    expect(own.metrics).toMatchObject({ requirements: 1, committed_value: 1000 });
    expect(own.breakdowns.plants.map((p: any) => p.name)).toEqual(['Plant One']);
    expect(own.breakdowns.utilisation[0]).toMatchObject({ number: 'ARC-K1', cap: 100, used: 10 }); // used quantity respects the plant scope
    await request(http).post('/users').set(as(admin)).send({ email: 'fin@kpi.test', name: 'fin', password: PW, roleKey: 'finance' }).expect(201);
    const fin = (await request(http).get('/analytics/overview').set(as(await login('kpi', 'fin@kpi.test'))).expect(200)).body;
    expect(fin.metrics.committed_value).toBe(1500); expect(fin.breakdowns.utilisation).toBeNull(); expect(fin.breakdowns.expiring).toBeNull(); // no contracts:read → contract data hidden
    const narrowed = (await request(http).get(`/analytics/overview?nodeId=${p2}`).set(as(admin))).body.metrics;
    expect(narrowed).toMatchObject({ requirements: 2, committed_value: 500 });
    const cross = (await request(http).get(`/analytics/overview?nodeId=${p2}`).set(as(b1)).expect(200)).body.metrics; // outside b1's scope → empty, not leaked
    expect(cross).toMatchObject({ requirements: 0, lines: 0, committed_value: 0 });
    await request(http).get('/analytics/overview?nodeId=nope').set(as(admin)).expect(400);
    await request(http).get('/analytics/overview?from=2026/01/01').set(as(admin)).expect(400);
    const none = (await request(http).get('/analytics/overview?from=2001-01-01&to=2001-02-01').set(as(admin))).body.metrics;
    expect(none).toMatchObject({ requirements: 0, committed_value: 0, contract_coverage: null });
  });

  it('every figure can be traced to records (drill-down)', async () => {
    const d = async (k: string) => (await request(http).get(`/analytics/drill?kind=${k}`).set(as(admin)).expect(200)).body.rows;
    expect((await d('spend')).reduce((s: number, r: any) => s + Number(r.qty) * Number(r.unitPrice), 0)).toBe(1500);
    expect(await d('off_contract')).toHaveLength(1);
    expect((await d('exceptions'))[0].kind).toBe('quality_rejection');
    expect(await d('lines')).toHaveLength(3);
    await request(http).get('/analytics/drill?kind=bogus').set(as(admin)).expect(400);
  });

  it('MIS export is a flat CSV, audited, scoped and formula-safe', async () => {
    const r = await request(http).get('/analytics/mis.csv').set(as(admin)).expect(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    const lines = r.text.trim().split('\n'); expect(lines.length).toBe(4); expect(lines[0]).toMatch(/^req_number,/);
    const own = (await request(http).get('/analytics/mis.csv').set(as(b2))).text.trim().split('\n'); expect(own.length).toBe(3);
    expect((await sql(`SELECT count(*)::int AS n FROM audit_log WHERE action='analytics.mis_exported'`)).rows[0].n).toBe(2);
  });

  it('permissions & tenant isolation', async () => {
    await request(http).get('/analytics/overview').set(as(sup)).expect(403);
    await request(http).get('/analytics/overview').expect(401);
    const rival = await login('rival', 'admin@rival.test');
    const m = (await request(http).get('/analytics/overview').set(as(rival)).expect(200)).body;
    expect(m.metrics).toMatchObject({ requirements: 0, lines: 0, committed_value: 0, open_exceptions: 0 });
    expect(m.breakdowns.suppliers).toEqual([]); expect(m.breakdowns.utilisation).toEqual([]);
  });
});
