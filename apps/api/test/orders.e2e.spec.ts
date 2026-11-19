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
import { FollowUpService } from '../src/buying/followups.service';

let app: INestApplication, http: any, outbox: OutboxService, followUps: FollowUpService;
const PW = 'correct-horse-battery';
const login = async (tenant: string, email: string) => (await request(http).post('/auth/login').send({ tenant, email, password: PW })).body.token as string;
const as = (t: string) => ({ Authorization: `Bearer ${t}` });
const sql = async (q: string, p: any[] = []) => { const c = new Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await c.connect(); const r = await c.query(q, p); await c.end(); return r; };

beforeAll(async () => {
  await sql('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(process.env.DATABASE_ADMIN_URL);
  app = await createApp(); await app.init(); http = app.getHttpServer(); outbox = app.get(OutboxService); followUps = app.get(FollowUpService);
  await ensurePlatformAdmin(app.get(Db), 'platform@test.local', PW);
});
afterAll(async () => { await app.close(); });

describe('Phase 5: supplier portal, delivery tracking, GRN, invoice, follow-ups', () => {
  let admin: string, buyer: string, supA: string, supB: string, plant: string, itemId: string, sA: string, sB: string;
  let reqId: string, streamId: string, lineId: string;

  async function order(qty: number) {
    await request(http).post('/cart/items').set(as(buyer)).send({ plantId: plant, itemId, qty }).expect(201);
    const cart = (await request(http).get(`/cart?plantId=${plant}`).set(as(buyer))).body;
    const sub = await request(http).post(`/cart/${cart.cartId}/submit`).set(as(buyer)).expect(201);
    await outbox.runOnce();
    const r = (await request(http).get(`/requirements/${sub.body.requirementId}`).set(as(buyer))).body;
    expect(r.streams[0].status).toBe('pr_created');
    return { reqId: sub.body.requirementId as string, streamId: r.streams[0].id as string, lineId: r.lines[0].id as string };
  }

  it('setup: ARC published for supplier A; supplier users for A and B', async () => {
    const plat = await login('platform', 'platform@test.local');
    await request(http).post('/platform/tenants').set(as(plat)).send({ slug: 'omni', name: 'Omni', adminEmail: 'admin@omni.test', adminPassword: PW }).expect(201);
    await request(http).post('/platform/tenants').set(as(plat)).send({ slug: 'rival', name: 'Rival', adminEmail: 'admin@rival.test', adminPassword: PW }).expect(201);
    admin = await login('omni', 'admin@omni.test');
    const s01 = (await request(http).post('/erp-systems').set(as(admin)).send({ code: 'S01', name: 'sim', kind: 'mock-sap' })).body.id;
    await request(http).post('/org/import').set(as(admin)).attach('file', Buffer.from('BU,Server,Company code,Company name,Plant code,Plant name\nPower,S01,1000,Omni,P1,Plant One\n'), 'o.csv').expect(201);
    const t = (await request(http).get('/org/tree').set(as(admin))).body;
    const biz = t.find((n: any) => n.levelType === 'business').id; plant = t.find((n: any) => n.levelType === 'plant').id;
    await request(http).post('/allocations').set(as(admin)).send({ scopeNodeId: biz, model: 2, status: 'active', approvedByCustomer: 'c (test)', approvedByProcmart: 'p (test)' }).expect(201);
    await request(http).post('/users').set(as(admin)).send({ email: 'buyer@omni.test', name: 'b', password: PW, roleKey: 'plant_procurement', scopeNodeId: plant }).expect(201);
    buyer = await login('omni', 'buyer@omni.test');
    sA = (await request(http).post('/suppliers').set(as(admin)).send({ legalName: 'Supplier A', contactEmail: 'a@supplier.test' }).expect(201)).body.id;
    sB = (await request(http).post('/suppliers').set(as(admin)).send({ legalName: 'Supplier B' }).expect(201).expect(201)).body.id;
    for (const [s, v] of [[sA, 'VA'], [sB, 'VB']]) await request(http).post(`/suppliers/${s}/erp-codes`).set(as(admin)).send({ erpSystemId: s01, vendorCode: v }).expect(201);
    await request(http).post('/catalogue/import').set(as(admin)).attach('file', Buffer.from('name,uom,category,server,material_code\nCable 4mm,EA,cables,S01,7001\n'), 'i.csv').expect(201);
    itemId = (await request(http).get('/catalogue/search?q=cable').set(as(admin))).body[0].id;
    const up = await request(http).post('/contracts').set(as(admin)).field('contractType', 'ARC').field('number', 'ARC-1').field('supplierId', sA).field('erpSystemId', s01)
      .field('validFrom', '2026-01-01').field('validTo', '2028-12-31').field('scopeNodeIds', biz).attach('file', Buffer.from('Description,Material Code,UOM,Net Price,MOQ,Quantity Cap\nCable 4mm,7001,Nos,100,1,1000\n'), 'a.csv').expect(201);
    const q = (await request(http).get('/review/queue').set(as(admin))).body;
    await request(http).post(`/review/candidates/${q[0].candidates[0].id}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201);
    await request(http).post(`/contracts/${up.body.id}/approve`).set(as(admin)).expect(201);
    await request(http).post(`/contracts/${up.body.id}/publish`).set(as(admin)).expect(201);
    for (const [e, s] of [['a@omni.test', sA], ['b@omni.test', sB]]) await request(http).post('/users').set(as(admin)).send({ email: e, name: e, password: PW, roleKey: 'supplier', kind: 'supplier', supplierId: s }).expect(201);
    supA = await login('omni', 'a@omni.test'); supB = await login('omni', 'b@omni.test');
  });

  it('supplier isolation: sees only its own orders, nothing staff-side', async () => {
    ({ reqId, streamId, lineId } = await order(10));
    expect((await request(http).get('/portal/orders').set(as(supA))).body).toHaveLength(0); // PO not released yet: nothing to act on
    await request(http).post(`/streams/${streamId}/simulate`).set(as(buyer)).send({ step: 'po_released' }).expect(201);
    expect((await request(http).get('/portal/orders').set(as(supA))).body).toHaveLength(1);
    expect((await request(http).get('/portal/orders').set(as(supB))).body).toHaveLength(0);
    await request(http).get(`/portal/orders/${streamId}`).set(as(supB)).expect(404);
    await request(http).post(`/portal/orders/${streamId}/acknowledge`).set(as(supB)).send({ lines: [{ lineId, qty: 10 }] }).expect(404);
    for (const p of ['/org/tree', '/requirements', '/contracts', '/catalogue/search?q=', '/suppliers']) await request(http).get(p).set(as(supA)).expect(403);
    await request(http).get('/portal/orders').set(as(buyer)).expect(403); // staff are not suppliers
    const rival = await login('rival', 'admin@rival.test');
    await request(http).get(`/portal/orders/${streamId}`).set(as(rival)).expect(403);
  });

  it('partial acknowledgement raises an exception; supplier cannot over-commit', async () => {
    await request(http).post(`/portal/orders/${streamId}/acknowledge`).set(as(supA)).send({ lines: [{ lineId, qty: 11 }] }).expect(400);
    const a = await request(http).post(`/portal/orders/${streamId}/acknowledge`).set(as(supA)).send({ lines: [{ lineId, qty: 6, date: '2027-02-01', note: 'balance next month' }] }).expect(201);
    expect(a.body).toMatchObject({ decision: 'partial', status: 'acknowledged' });
    const ex = (await request(http).get('/exceptions').set(as(admin))).body;
    expect(ex.map((e: any) => e.kind)).toContain('supplier_partial');
    await request(http).post(`/portal/orders/${streamId}/acknowledge`).set(as(supA)).send({ lines: [{ lineId, qty: 6 }] }).expect(409); // already acknowledged
  });

  it('split dispatches, quantity limits, partial GRN with rejection, then full GRN', async () => {
    const d = (qty: number) => request(http).post(`/portal/orders/${streamId}/dispatch`).set(as(supA)).send({ lines: [{ lineId, qty }], carrier: 'FastLine', trackingRef: 'TRK1' });
    expect((await d(4).expect(201)).body.status).toBe('partially_dispatched');
    expect((await d(3).expect(400)).body.message).toMatch(/Cannot dispatch/); // 4 + 3 > committed 6
    await request(http).post(`/streams/${streamId}/grn`).set(as(buyer)).send({ lines: [{ lineId, accepted: 5, rejected: 0 }] }).expect(400); // more than dispatched
    const g1 = await request(http).post(`/streams/${streamId}/grn`).set(as(buyer)).send({ lines: [{ lineId, accepted: 3, rejected: 1 }] }).expect(201);
    expect(g1.body).toMatchObject({ status: 'partially_received', simulated: true });
    expect((await request(http).get('/exceptions').set(as(admin))).body.map((e: any) => e.kind)).toContain('quality_rejection');
    expect((await d(2).expect(201)).body.status).toBe('partially_received'); // 4 sent, 4 received; 2 more sent, not yet received
    const g2 = await request(http).post(`/streams/${streamId}/grn`).set(as(buyer)).send({ lines: [{ lineId, accepted: 2, rejected: 0 }] }).expect(201);
    expect(g2.body.status).toBe('grn_posted');
    const det = (await request(http).get(`/portal/orders/${streamId}`).set(as(supA))).body;
    expect(det.shipments).toHaveLength(2); expect(det.lines[0]).toMatchObject({ committed: 6, dispatched: 6, received: 5, rejected: 1 });
  });

  it('invoice only after GRN; duplicates refused; payment closes the requirement', async () => {
    await request(http).post(`/streams/${streamId}/simulate`).set(as(buyer)).send({ step: 'paid' }).expect(409);
    await request(http).post(`/portal/orders/${streamId}/invoice`).set(as(supA)).send({ invoiceNumber: 'INV-9', amount: 500 }).expect(201);
    await request(http).post(`/portal/orders/${streamId}/invoice`).set(as(supA)).send({ invoiceNumber: 'INV-9', amount: 500 }).expect(409);
    await request(http).post(`/streams/${streamId}/simulate`).set(as(buyer)).send({ step: 'paid' }).expect(201);
    const r = (await request(http).get(`/requirements/${reqId}`).set(as(buyer))).body;
    expect(r.streams[0].status).toBe('paid'); expect(r.status).toBe('closed');
    const kinds = r.events.map((e: any) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['acknowledged', 'dispatched', 'grn_partial', 'grn_posted', 'invoiced', 'paid']));
  });

  it('follow-ups: off until the customer configures them; then send, rotate channels, record failures, escalate once', async () => {
    const o = await order(5); streamId = o.streamId;
    await request(http).post(`/streams/${streamId}/simulate`).set(as(buyer)).send({ step: 'po_released' }).expect(201);
    await sql(`UPDATE streams SET status_at = now() - interval '30 hours' WHERE id=$1`, [streamId]);
    expect(await followUps.scan()).toEqual({ sent: 0, failed: 0, escalated: 0 }); // no config → no default SLA
    await request(http).post('/policy').set(as(admin)).send({ followUp: { ackHours: 24, dispatchHours: 48, deliveryHours: 72, escalateAfter: 2, channels: ['email', 'whatsapp'] } }).expect(201);
    expect((await followUps.scan()).sent).toBe(1); // email, supplier A has an address
    expect((await followUps.scan()).sent).toBe(0); // interval not elapsed again
    await sql(`UPDATE follow_ups SET at = now() - interval '25 hours'`);
    expect(await followUps.scan()).toMatchObject({ failed: 1 }); // WhatsApp: no phone on file → recorded as failed, not silently dropped
    await sql(`UPDATE follow_ups SET at = now() - interval '25 hours'`);
    expect(await followUps.scan()).toMatchObject({ escalated: 1 });
    expect(await followUps.scan()).toMatchObject({ escalated: 0 }); // no duplicate exception
    const ex = (await request(http).get('/exceptions').set(as(admin))).body.filter((e: any) => e.kind === 'supplier_unresponsive');
    expect(ex).toHaveLength(1);
    const rows = (await sql(`SELECT channel, status, simulated FROM follow_ups ORDER BY at, channel`)).rows;
    expect(rows.every((r) => r.simulated)).toBe(true);
    expect(rows.map((r) => r.channel).sort()).toEqual(['email', 'whatsapp']);
    // supplier responds → status moves, follow-ups stop
    const det = (await request(http).get(`/portal/orders/${streamId}`).set(as(supA))).body;
    await request(http).post(`/portal/orders/${streamId}/acknowledge`).set(as(supA)).send({ lines: [{ lineId: det.lines[0].id, qty: 5 }] }).expect(201);
    expect(await followUps.scan()).toEqual({ sent: 0, failed: 0, escalated: 0 });
  });

  it('whole-order rejection stays at PO released and raises an exception', async () => {
    const o = await order(2);
    await request(http).post(`/streams/${o.streamId}/simulate`).set(as(buyer)).send({ step: 'po_released' }).expect(201);
    const r = await request(http).post(`/portal/orders/${o.streamId}/acknowledge`).set(as(supA)).send({ lines: [{ lineId: o.lineId, qty: 0 }] }).expect(201);
    expect(r.body).toEqual({ decision: 'rejected', status: 'po_released' });
    expect((await request(http).get('/exceptions').set(as(admin))).body.map((e: any) => e.kind)).toContain('supplier_rejected');
  });

  it('DB isolation holds for the new tables', async () => {
    const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
    for (const t of ['shipments', 'grn_receipts', 'invoices', 'follow_ups', 'line_commitments']) expect((await c.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n).toBe(0);
    await c.end();
  });
});
