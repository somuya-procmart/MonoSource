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
import { MockSapAdapter } from '../src/integrations/erp-adapter';

let app: INestApplication, http: any, outbox: OutboxService;
const PW = 'correct-horse-battery';

async function resetDb() {
  const c = new Client({ connectionString: process.env.DATABASE_ADMIN_URL });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await c.end();
  await migrate(process.env.DATABASE_ADMIN_URL);
}
const login = async (tenant: string, email: string, password = PW) =>
  (await request(http).post('/auth/login').send({ tenant, email, password })).body.token as string;
const as = (t: string) => ({ Authorization: `Bearer ${t}` });

beforeAll(async () => {
  await resetDb();
  app = await createApp();
  await app.init();
  http = app.getHttpServer();
  outbox = app.get(OutboxService);
  await ensurePlatformAdmin(app.get(Db), 'platform@test.local', PW);
});
afterAll(async () => { await app.close(); });

const ORG_CSV = [
  'BU,Server,Company code,Company name,Plant code,Plant name,Location',
  'Power,S01,1000,Adani Power Ltd,P100,Mundra Plant,Store-1',
  'Power,S01,1000,Adani Power Ltd,P200,Tiroda Plant,',
  'Power,S02,2000,Adani Power Two,P100,Other Server Plant 100,',
].join('\n');
const ITEMS_CSV = [
  'name,description,brand,mpn,uom,category,serviceability,server,material_code',
  'Deep groove ball bearing 6205-2RS,25mm bore sealed,SKF,6205-2RS,EA,bearings,arc,S01,1000123',
  'Safety gloves nitrile,Large,3M,GL-L,PAIR,ppe,arc,S01,1000456',
].join('\n');
const ARC_CSV = [
  'Description,Material Code,Brand,MPN,UOM,Base Price,Discount %,MOQ,Quantity Cap',
  'Ball bearing 6205 2RS sealed,1000123,SKF,6205-2RS,Nos,100,10,5,200',
  'Mystery fastener,9999999,,,Nos,5,0,1,50',
].join('\n');

describe('MonoSource vertical slice (real backend, real Postgres)', () => {
  let platform: string, admin: string, reviewer: string, buyer: string, buyer2: string;
  let s01: string, s02: string, business: string, plantP100: string, plantP100b: string, plantP200: string;
  let supplierId: string, contractId: string, itemId: string, reqId: string, streamId: string;

  it('1. platform admin creates a customer; wrong credentials are rejected', async () => {
    expect((await request(http).post('/auth/login').send({ tenant: 'platform', email: 'platform@test.local', password: 'nope-nope-nope' })).status).toBe(401);
    platform = await login('platform', 'platform@test.local');
    const r = await request(http).post('/platform/tenants').set(as(platform)).send({ slug: 'adani', name: 'Adani Group', adminEmail: 'admin@adani.test', adminPassword: PW });
    expect(r.status).toBe(201);
    await request(http).post('/platform/tenants').set(as(platform)).send({ slug: 'rival', name: 'Rival Co', adminEmail: 'admin@rival.test', adminPassword: PW }).expect(201);
    admin = await login('adani', 'admin@adani.test');
    expect(admin).toBeTruthy();
  });

  it('customer admins cannot use platform endpoints', async () => {
    await request(http).post('/platform/tenants').set(as(admin)).send({ slug: 'x1', name: 'X', adminEmail: 'a@b.test', adminPassword: PW }).expect(403);
    await request(http).get('/users').expect(401);
  });

  it('2. hierarchy: ERP servers + CSV import; same plant code on two servers = two plants', async () => {
    s01 = (await request(http).post('/erp-systems').set(as(admin)).send({ code: 'S01', name: 'SAP server 1 (simulated)', kind: 'mock-sap' }).expect(201)).body.id;
    const imp = await request(http).post('/org/import').set(as(admin)).attach('file', Buffer.from(ORG_CSV), 'org.csv').expect(201);
    expect(imp.body.newPlants).toBe(3);
    const tree = (await request(http).get('/org/tree').set(as(admin)).expect(200)).body;
    const plants = tree.filter((n: any) => n.levelType === 'plant');
    expect(plants.filter((p: any) => p.code === 'P100').map((p: any) => p.server).sort()).toEqual(['S01', 'S02']);
    business = tree.find((n: any) => n.levelType === 'business').id;
    plantP100 = plants.find((p: any) => p.code === 'P100' && p.server === 'S01').id;
    plantP100b = plants.find((p: any) => p.code === 'P100' && p.server === 'S02').id;
    plantP200 = plants.find((p: any) => p.code === 'P200').id;
    s02 = (await request(http).get('/erp-systems').set(as(admin))).body.find((e: any) => e.code === 'S02').id;
    expect((await request(http).get('/erp-systems').set(as(admin))).body.find((e: any) => e.code === 'S01').kind).toBe('mock-sap');
  });

  it('3. users with plant scope; scope limits what they can act on', async () => {
    await request(http).post('/users').set(as(admin)).send({ email: 'buyer@adani.test', name: 'Plant Buyer', password: PW, roleKey: 'plant_procurement', scopeNodeId: plantP100 }).expect(201);
    await request(http).post('/users').set(as(admin)).send({ email: 'buyer2@adani.test', name: 'Other Buyer', password: PW, roleKey: 'plant_procurement', scopeNodeId: plantP200 }).expect(201);
    await request(http).post('/users').set(as(admin)).send({ email: 'rev@adani.test', name: 'Reviewer', password: PW, roleKey: 'central_procurement' }).expect(201);
    await request(http).post('/users').set(as(admin)).send({ email: 'weak', name: 'x', password: 'short', roleKey: 'requester' }).expect(400);
    buyer = await login('adani', 'buyer@adani.test');
    buyer2 = await login('adani', 'buyer2@adani.test');
    reviewer = await login('adani', 'rev@adani.test');
    // buyer sees only own subtree in the org tree
    const t = (await request(http).get('/org/tree').set(as(buyer)).expect(200)).body;
    expect(t.map((n: any) => n.id)).toContain(plantP100);
    expect(t.map((n: any) => n.id)).not.toContain(plantP200);
  });

  it('4. catalogue import + supplier with per-server vendor codes (no auto merge)', async () => {
    const imp = await request(http).post('/catalogue/import').set(as(admin)).attach('file', Buffer.from(ITEMS_CSV), 'items.csv').expect(201);
    expect(imp.body).toMatchObject({ imported: 2, errors: [] });
    supplierId = (await request(http).post('/suppliers').set(as(admin)).send({ legalName: 'Shree Bearings Pvt Ltd', taxId: '27ABCDE1234F1Z5' }).expect(201)).body.id;
    const dup = await request(http).post('/suppliers').set(as(admin)).send({ legalName: 'Shree Bearings Pvt Ltd', taxId: '27ABCDE1234F1Z5' }).expect(201);
    expect(dup.body.possibleDuplicates).toHaveLength(1); // flagged for review, NOT merged
    await request(http).post(`/suppliers/${supplierId}/erp-codes`).set(as(admin)).send({ erpSystemId: s01, vendorCode: 'V-5551' }).expect(201);
    await request(http).post(`/suppliers/${supplierId}/erp-codes`).set(as(admin)).send({ erpSystemId: s01, vendorCode: 'V-5551' }).expect(409);
    const items = (await request(http).get('/catalogue/search?q=bearing').set(as(admin)).expect(200)).body;
    itemId = items[0].id;
    expect(items[0].contractCoverage).toEqual([]);
  });

  it('5. allocation needs both approvals; policy Q1 starts undecided', async () => {
    await request(http).post('/allocations').set(as(admin)).send({ scopeNodeId: business, model: 2, status: 'active' }).expect(400);
    await request(http).post('/allocations').set(as(admin)).send({ scopeNodeId: business, model: 2, status: 'active', approvedByCustomer: 'Adani procurement head (test)', approvedByProcmart: 'ProcMart ops head (test)' }).expect(201);
    expect((await request(http).get('/policy').set(as(admin))).body.arcPriorityOverDirect).toBeNull();
  });

  it('6. ARC upload → extraction → suggested mapping; PDF is honestly unsupported', async () => {
    const pdf = await request(http).post('/contracts').set(as(admin)).field('contractType', 'ARC').attach('file', Buffer.from('%PDF-1.4 fake'), 'arc.pdf').expect(201);
    expect(pdf.body.extraction).toBe('unsupported');
    await request(http).post('/contracts').set(as(admin)).field('contractType', 'ARC').attach('file', Buffer.from('x'), 'evil.exe').expect(400);

    const up = await request(http).post('/contracts').set(as(admin))
      .field('contractType', 'ARC').field('number', 'ARC-TEST-001').field('supplierId', supplierId).field('erpSystemId', s01)
      .field('validFrom', '2026-01-01').field('validTo', '2027-12-31').field('scopeNodeIds', business)
      .attach('file', Buffer.from(ARC_CSV), 'arc.csv').expect(201);
    expect(up.body).toMatchObject({ status: 'in_review', lines: 2 });
    contractId = up.body.id;
    const c = (await request(http).get(`/contracts/${contractId}`).set(as(admin)).expect(200)).body;
    expect(c.extractionRuns[0]).toMatchObject({ provider: 'csv-rules', status: 'succeeded' });
    expect(c.lines[0]).toMatchObject({ uom: 'EA', status: 'needs_review', source_ref: 'row 2' });
    expect(+c.lines[0].net_price).toBe(90);
    expect(c.lines[0].raw.uom).toBe('Nos'); // original value preserved
    expect(c.lines[0].item_id).toBeNull(); // AI/rules never activate a mapping
    expect(c.lines[0].candidates[0]).toMatchObject({ basis: 'exact_code', status: 'pending' });
  });

  it('7. human review: unresolved contract cannot be approved; buyers cannot review', async () => {
    const q = (await request(http).get('/review/queue').set(as(reviewer)).expect(200)).body;
    expect(q).toHaveLength(2);
    await request(http).get('/review/queue').set(as(buyer)).expect(403);
    expect((await request(http).post(`/contracts/${contractId}/approve`).set(as(reviewer))).status).toBe(422);

    const l1 = q.find((x: any) => x.lineNo === 1), l2 = q.find((x: any) => x.lineNo === 2);
    await request(http).post(`/review/candidates/${l1.candidates[0].id}/decision`).set(as(reviewer)).send({ decision: 'approve', reason: 'matches SAP material' }).expect(201);
    await request(http).post(`/review/candidates/${l1.candidates[0].id}/decision`).set(as(reviewer)).send({ decision: 'approve' }).expect(409);
    await request(http).post(`/review/lines/${l2.lineId}/reject`).set(as(reviewer)).send({ reason: 'unknown material' }).expect(201);
    // not yet published → buyer sees no contract coverage
    const pre = (await request(http).get(`/catalogue/search?q=bearing&plantId=${plantP100}`).set(as(buyer)).expect(200)).body;
    expect(pre[0].contractCoverage).toEqual([]);

    // publication requires approval first
    await request(http).post(`/contracts/${contractId}/publish`).set(as(reviewer)).expect(409);
    await request(http).post(`/contracts/${contractId}/approve`).set(as(reviewer)).expect(201);
    expect((await request(http).post(`/contracts/${contractId}/publish`).set(as(reviewer)).expect(201)).body.linesPublished).toBe(1);
  });

  it('8. buyer search shows contract price only for plants the contract applies to', async () => {
    const hit = (await request(http).get(`/catalogue/search?q=bearing&plantId=${plantP100}`).set(as(buyer)).expect(200)).body[0];
    expect(hit.contractCoverage[0]).toMatchObject({ type: 'ARC', supplier: 'Shree Bearings Pvt Ltd', contractNumber: 'ARC-TEST-001' });
    expect(+hit.contractCoverage[0].netPrice).toBe(90);
    // buyer cannot ask about a plant outside their scope
    await request(http).get(`/catalogue/search?q=bearing&plantId=${plantP200}`).set(as(buyer)).expect(400);
    // search by material code works
    const byCode = (await request(http).get('/catalogue/search?q=1000123').set(as(buyer)).expect(200)).body;
    expect(byCode[0].id).toBe(itemId);
  });

  it('9. cart → routing preview → requirement → simulated PR through the outbox', async () => {
    await request(http).post('/cart/items').set(as(buyer2)).send({ plantId: plantP100, itemId, qty: 1 }).expect(403); // scope
    await request(http).post('/cart/items').set(as(buyer)).send({ plantId: plantP100, itemId, qty: 10, needBy: '2027-01-15' }).expect(201);
    const cart = (await request(http).get(`/cart?plantId=${plantP100}`).set(as(buyer)).expect(200)).body;
    expect(cart.lines[0].routing).toMatchObject({ route: 'arc', model: 2, feeTreatment: 'supplier_enablement', supplierId });
    const sub = await request(http).post(`/cart/${cart.cartId}/submit`).set(as(buyer)).expect(201);
    expect(sub.body).toMatchObject({ number: 'REQ-000001', streams: 1 });
    await request(http).post(`/cart/${cart.cartId}/submit`).set(as(buyer)).expect(409); // PR only once per line
    reqId = sub.body.requirementId;

    let r = (await request(http).get(`/requirements/${reqId}`).set(as(buyer)).expect(200)).body;
    expect(r.streams[0].status).toBe('pr_requested');
    expect(await outbox.runOnce()).toBe(1);
    r = (await request(http).get(`/requirements/${reqId}`).set(as(buyer)).expect(200)).body;
    streamId = r.streams[0].id;
    expect(r.streams[0].status).toBe('pr_created');
    expect(r.streams[0].pr_reference).toMatch(/^SIM-PR-/);
    expect(r.events.find((e: any) => e.kind === 'pr_created').simulated).toBe(true);
    expect(r.lines[0]).toMatchObject({ route: 'arc', model: 2, fee_treatment: 'supplier_enablement' });
    expect(r.lines[0].routing_trace.length).toBeGreaterThan(2);
    expect(await outbox.runOnce()).toBe(0); // idempotent: nothing left
  });

  it('10. order lifecycle: ERP steps simulated, supplier steps through the real supplier portal', async () => {
    const sim = (step: string, t = buyer) => request(http).post(`/streams/${streamId}/simulate`).set(as(t)).send({ step });
    await sim('paid').expect(409); // out of order
    await sim('po_released').expect(201);
    await request(http).post('/users').set(as(admin)).send({ email: 'sup@shree.test', name: 'Shree user', password: PW, roleKey: 'supplier', kind: 'supplier', supplierId }).expect(201);
    const sup = await login('adani', 'sup@shree.test');
    const ord = (await request(http).get('/portal/orders').set(as(sup)).expect(200)).body;
    expect(ord).toHaveLength(1);
    const detail = (await request(http).get(`/portal/orders/${streamId}`).set(as(sup)).expect(200)).body;
    for (const o of [detail, ...detail.lines]) for (const k of Object.keys(o)) expect(/fee|model/i.test(k)).toBe(false); // supplier never sees the commercial model or fee treatment (checked on keys, not on UUID text)
    const lineId = detail.lines[0].id;
    await request(http).post(`/portal/orders/${streamId}/dispatch`).set(as(sup)).send({ lines: [{ lineId, qty: 10 }] }).expect(409); // must acknowledge first
    await request(http).post(`/portal/orders/${streamId}/acknowledge`).set(as(sup)).send({ lines: [{ lineId, qty: 10 }] }).expect(201);
    await request(http).post(`/portal/orders/${streamId}/dispatch`).set(as(sup)).send({ lines: [{ lineId, qty: 10 }], carrier: 'TestCarrier' }).expect(201);
    await request(http).post(`/streams/${streamId}/grn`).set(as(buyer)).send({ lines: [{ lineId, accepted: 10, rejected: 0 }] }).expect(201);
    await request(http).post(`/portal/orders/${streamId}/invoice`).set(as(sup)).send({ invoiceNumber: 'INV-1', amount: 900 }).expect(201);
    await sim('paid').expect(201);
    const r = (await request(http).get(`/requirements/${reqId}`).set(as(buyer))).body;
    expect(r.status).toBe('closed');
    expect(r.events.filter((e: any) => e.simulated).map((e: any) => e.kind)).toEqual(['pr_created', 'po_released', 'grn_posted', 'paid']);
  });

  it('11. same plant code on another server is not covered by the contract scope', async () => {
    // contract scope is the Power business → covers both. Narrow check: P100@S02 has no vendor code → PR is blocked, not guessed.
    await request(http).post('/users').set(as(admin)).send({ email: 'buyer3@adani.test', name: 'S02 Buyer', password: PW, roleKey: 'plant_procurement', scopeNodeId: plantP100b }).expect(201);
    const b3 = await login('adani', 'buyer3@adani.test');
    await request(http).post('/cart/items').set(as(b3)).send({ plantId: plantP100b, itemId, qty: 5 }).expect(201);
    const cart = (await request(http).get(`/cart?plantId=${plantP100b}`).set(as(b3))).body;
    const sub = await request(http).post(`/cart/${cart.cartId}/submit`).set(as(b3)).expect(201);
    expect(sub.body.streams).toBe(0); // blocked before any PR: the supplier has no vendor code on S02 (BRD scenario 5)
    const r = (await request(http).get(`/requirements/${sub.body.requirementId}`).set(as(b3))).body;
    expect(r.lines[0].route).toBe('exception'); expect(JSON.stringify(r.lines[0].routing_trace)).toMatch(/vendor code/);
    const ex = (await request(http).get('/exceptions').set(as(admin))).body; expect(ex.some((e: any) => e.kind === 'routing' && /vendor-code extension/.test(e.detail))).toBe(true);
    void s02;
  });

  it('12. transient ERP failure is retried and succeeds exactly once (idempotent)', async () => {
    await request(http).post(`/suppliers/${supplierId}/erp-codes`).set(as(admin)).send({ erpSystemId: s02, vendorCode: 'V-7001' }).expect(201);
    // item has no material code on S02 yet → PR must be blocked rather than sent with a guessed code
    const b3 = await login('adani', 'buyer3@adani.test');
    await request(http).post('/cart/items').set(as(b3)).send({ plantId: plantP100b, itemId, qty: 2 }).expect(201);
    const small = (await request(http).get(`/cart?plantId=${plantP100b}`).set(as(b3))).body;
    expect(small.lines[0].routing.route).toBe('sourcing'); // below the ARC's MOQ of 5: the ARC can't take it, so ProcMart sources it; reason is in the trace
    expect(JSON.stringify(small.lines[0].routing.trace)).toMatch(/below MOQ 5/);
    await request(http).post('/cart/items').set(as(b3)).send({ plantId: plantP100b, itemId, qty: 3 }).expect(201); // now 5
    const cart = (await request(http).get(`/cart?plantId=${plantP100b}`).set(as(b3))).body;
    const sub = await request(http).post(`/cart/${cart.cartId}/submit`).set(as(b3)).expect(201);
    await outbox.runOnce();
    const r = (await request(http).get(`/requirements/${sub.body.requirementId}`).set(as(b3))).body;
    expect(r.events.find((e: any) => e.kind === 'pr_failed').detail.reason).toMatch(/no material code on ERP S02/);

    // transient failure on S01: fail once, then succeed
    await request(http).post('/cart/items').set(as(buyer)).send({ plantId: plantP100, itemId, qty: 5 }).expect(201);
    const c2 = (await request(http).get(`/cart?plantId=${plantP100}`).set(as(buyer))).body;
    const s2 = await request(http).post(`/cart/${c2.cartId}/submit`).set(as(buyer)).expect(201);
    const st = (await request(http).get(`/requirements/${s2.body.requirementId}`).set(as(buyer))).body.streams[0];
    MockSapAdapter.failures.set(`pr:${st.id}`, 1);
    await outbox.runOnce();
    let cur = (await request(http).get(`/requirements/${s2.body.requirementId}`).set(as(buyer))).body.streams[0];
    expect(cur.status).toBe('pr_requested'); // failed once, rescheduled
    const adminDb = new Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await adminDb.connect();
    await adminDb.query(`UPDATE outbox SET next_run_at = now() WHERE idempotency_key=$1`, [`pr:${st.id}`]);
    await outbox.runOnce();
    cur = (await request(http).get(`/requirements/${s2.body.requirementId}`).set(as(buyer))).body.streams[0];
    expect(cur.status).toBe('pr_created');
    expect((await adminDb.query(`SELECT count(*)::int AS n FROM erp_messages WHERE idempotency_key=$1`, [`pr:${st.id}`])).rows[0].n).toBe(1);
    await adminDb.end();
  });

  it('13. TENANT ISOLATION: another customer sees nothing of Adani, by API and by raw SQL', async () => {
    const rival = await login('rival', 'admin@rival.test');
    for (const path of ['/catalogue/search?q=bearing', '/contracts', '/suppliers', '/requirements', '/users', '/org/tree', '/erp-systems'])
      expect((await request(http).get(path).set(as(rival)).expect(200)).body.filter((x: any) => x.email !== 'admin@rival.test')).toEqual([]);
    const rivalAudit = (await request(http).get('/audit').set(as(rival)).expect(200)).body.map((a: any) => a.action);
    expect(rivalAudit).not.toEqual(expect.arrayContaining(['contract.published']));
    await request(http).get(`/contracts/${contractId}`).set(as(rival)).expect(404);
    await request(http).get(`/catalogue/items/${itemId}`).set(as(rival)).expect(404);
    await request(http).get(`/requirements/${reqId}`).set(as(rival)).expect(404);
    await request(http).post(`/contracts/${contractId}/approve`).set(as(rival)).expect(404);
    // rival cannot cart an Adani item into an Adani plant
    await request(http).post('/cart/items').set(as(rival)).send({ plantId: plantP100, itemId, qty: 1 }).expect(400);

    // Even a buggy query is blocked by Postgres itself: app role + no tenant set = zero rows; wrong tenant = zero rows.
    const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
    expect((await c.query(`SELECT count(*)::int AS n FROM contracts`)).rows[0].n).toBe(0);
    await c.query('BEGIN');
    const rivalTenant = (await c.query(`SELECT set_config('app.platform','on',true)`), (await c.query(`SELECT id FROM tenants WHERE slug='rival'`)).rows[0].id);
    await c.query(`SELECT set_config('app.platform','off',true), set_config('app.tenant_id',$1,true)`, [rivalTenant]);
    expect((await c.query(`SELECT count(*)::int AS n FROM contract_lines`)).rows[0].n).toBe(0);
    const adminC = new Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await adminC.connect();
    const adaniId = (await adminC.query(`SELECT id FROM tenants WHERE slug='adani'`)).rows[0].id; await adminC.end();
    await expect(c.query(`INSERT INTO suppliers(tenant_id,legal_name) VALUES ($1,'smuggled')`, [adaniId])).rejects.toThrow(/row-level security/);
    await c.query('ROLLBACK'); await c.end();
  });

  it('14. database enforces one fee treatment matching the model; audit log is append-only', async () => {
    const c = new Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await c.connect();
    await expect(c.query(`UPDATE requirement_lines SET fee_treatment='management_fee' WHERE model=2`)).rejects.toThrow(/check constraint/);
    await expect(c.query(`UPDATE audit_log SET action='tampered'`)).rejects.toThrow(/append-only/);
    await expect(c.query(`DELETE FROM audit_log`)).rejects.toThrow(/append-only/);
    const actions = (await c.query(`SELECT DISTINCT action FROM audit_log`)).rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['tenant.created', 'user.created', 'contract.uploaded', 'mapping.approve', 'contract.approved', 'contract.published', 'requirement.submitted', 'pr.created']));
    await c.end();
  });
});
