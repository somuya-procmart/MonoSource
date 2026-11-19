process.env.NODE_ENV = 'test';
process.env.OUTBOX_WORKER = 'off';
process.env.DATABASE_ADMIN_URL = 'postgres://postgres@localhost:54322/monosource_test';
process.env.DATABASE_URL = 'postgres://monosource_app:monosource_app_dev@localhost:54322/monosource_test';
process.env.STORAGE_DIR = require('os').tmpdir() + '/monosource-test-storage';
process.env.RATE_LIMIT = '100000';
delete process.env.ANTHROPIC_API_KEY;
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Client } from 'pg';
import ExcelJS from 'exceljs';
import { migrate } from '../src/db/migrate';
import { createApp } from '../src/main';
import { Db } from '../src/db/db';
import { ensurePlatformAdmin } from '../src/db/bootstrap';
import { setLlmClient } from '../src/ai/extraction';

let app: INestApplication, http: any;
const PW = 'correct-horse-battery';
const login = async (tenant: string, email: string) => (await request(http).post('/auth/login').send({ tenant, email, password: PW })).body.token as string;
const as = (t: string) => ({ Authorization: `Bearer ${t}` });
const sql = async (q: string, p: any[] = []) => { const c = new Client({ connectionString: process.env.DATABASE_ADMIN_URL }); await c.connect(); const r = await c.query(q, p); await c.end(); return r; };

/** Smallest valid-enough text PDF (pdf.js rebuilds a missing xref table). */
function pdf(lines: string[]): Buffer {
  const text = lines.map((l, i) => `BT /F1 11 Tf 40 ${780 - i * 16} Td (${l.replace(/[()\\]/g, '')}) Tj ET`).join('\n');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const off: number[] = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out);
}
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(32, 1)]);

beforeAll(async () => {
  await sql('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate(process.env.DATABASE_ADMIN_URL);
  app = await createApp(); await app.init(); http = app.getHttpServer();
  await ensurePlatformAdmin(app.get(Db), 'platform@test.local', PW);
});
afterAll(async () => { setLlmClient(undefined); await app.close(); });

describe('Phase 2–3 gaps: Excel/PDF extraction, equivalents, assets, versions, product detail, Ask MonoSource', () => {
  let admin: string, buyer: string, s01: string, biz: string, plant: string, supplierId: string;
  let items: Record<string, string> = {};

  it('setup: tenant, plant, items with specs, category attributes, supplier', async () => {
    const plat = await login('platform', 'platform@test.local');
    for (const [slug, e] of [['gap', 'admin@gap.test'], ['rival', 'admin@rival.test']]) await request(http).post('/platform/tenants').set(as(plat)).send({ slug, name: slug, adminEmail: e, adminPassword: PW }).expect(201);
    admin = await login('gap', 'admin@gap.test');
    s01 = (await request(http).post('/erp-systems').set(as(admin)).send({ code: 'S01', name: 'sim', kind: 'mock-sap' })).body.id;
    await request(http).post('/org/import').set(as(admin)).attach('file', Buffer.from('BU,Server,Company code,Company name,Plant code,Plant name\nPower,S01,1000,Gap,P1,Plant One\n'), 'o.csv').expect(201);
    const t = (await request(http).get('/org/tree').set(as(admin))).body; biz = t.find((n: any) => n.levelType === 'business').id; plant = t.find((n: any) => n.levelType === 'plant').id;
    await request(http).post('/allocations').set(as(admin)).send({ scopeNodeId: biz, model: 2, status: 'active', approvedByCustomer: 'c (test)', approvedByProcmart: 'p (test)' }).expect(201);
    await request(http).post('/users').set(as(admin)).send({ email: 'b@gap.test', name: 'b', password: PW, roleKey: 'plant_procurement', scopeNodeId: plant }).expect(201);
    buyer = await login('gap', 'b@gap.test');
    const csv = ['name,uom,category,brand,mpn,server,material_code,spec_bore,spec_seal',
      'Ball bearing 6205 sealed,EA,bearings,SKF,6205-2RS,S01,1000123,25,sealed',
      'Ball bearing 6205 open,EA,bearings,SKF,6205,S01,1000124,25,open',
      'Ball bearing 6306 sealed,EA,bearings,SKF,6306-2RS,S01,1000125,30,sealed',
      'Ball bearing 6205 generic,EA,bearings,,,S01,1000126,25,',
      'Safety gloves nitrile,PAIR,ppe,3M,GL-L,S01,1000456,,'].join('\n');
    expect((await request(http).post('/catalogue/import').set(as(admin)).attach('file', Buffer.from(csv), 'i.csv').expect(201)).body.imported).toBe(5);
    for (const i of (await request(http).get('/catalogue/search?q=').set(as(admin))).body) items[i.name] = i.id;
    expect((await request(http).get(`/catalogue/items/${items['Ball bearing 6205 sealed']}/detail`).set(as(admin))).body.specs).toEqual({ bore: '25', seal: 'sealed' });
    await request(http).post('/catalogue/category-attributes').set(as(admin)).send({ category: 'bearings', key: 'bore', label: 'Bore (mm)', required: true, position: 1 }).expect(201);
    await request(http).post('/catalogue/category-attributes').set(as(admin)).send({ category: 'bearings', key: 'seal', label: 'Seal type', position: 2 }).expect(201);
    supplierId = (await request(http).post('/suppliers').set(as(admin)).send({ legalName: 'Shree Bearings' }).expect(201)).body.id;
    await request(http).post(`/suppliers/${supplierId}/erp-codes`).set(as(admin)).send({ erpSystemId: s01, vendorCode: 'V-SHREE' }).expect(201);
  });

  const upload = (name: string, buf: Buffer, extra: Record<string, string> = {}) => {
    let r = request(http).post('/contracts').set(as(admin)).field('contractType', 'ARC').field('erpSystemId', s01).field('scopeNodeIds', biz).field('supplierId', supplierId)
      .field('validFrom', '2026-01-01').field('validTo', '2028-12-31');
    for (const [k, v] of Object.entries(extra)) r = r.field(k, v);
    return r.attach('file', buf, name);
  };

  it('Excel contract: extracted by rules, sheet!row references, candidates queued, nothing activated', async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Rates');
    ws.addRow(['Description', 'Material Code', 'Brand', 'UOM', 'Base Price', 'Discount %']); ws.addRow(['Ball bearing 6205 sealed', '1000123', 'SKF', 'Nos', 100, 10]);
    const up = await upload('rates.xlsx', Buffer.from(await wb.xlsx.writeBuffer()), { number: 'ARC-XL' }).expect(201);
    expect(up.body).toMatchObject({ status: 'in_review', lines: 1, candidates: 1 });
    const c = (await request(http).get(`/contracts/${up.body.id}`).set(as(admin))).body;
    expect(c.extractionRuns[0]).toMatchObject({ provider: 'xlsx-rules', status: 'succeeded' });
    expect(c.lines[0]).toMatchObject({ source_ref: 'Rates!row 2', status: 'needs_review', item_id: null }); expect(+c.lines[0].net_price).toBe(90);
    await upload('bad.xlsx', Buffer.from('not really a workbook')).expect(201).then((r) => expect(r.body).toMatchObject({ status: 'draft', extraction: 'failed' })); // kept as a draft, not lost
  });

  let pdfContractId: string;
  it('PDF without an AI provider: stored, honestly marked unsupported with the reason', async () => {
    const up = await upload('arc.pdf', pdf(['ARC-PDF-9 Shree Bearings', 'Ball bearing 6205 sealed code 1000123 Nos Rate 90.00 MOQ 5'])).expect(201);
    expect(up.body).toMatchObject({ status: 'draft', extraction: 'unsupported' }); expect(up.body.error).toMatch(/ANTHROPIC_API_KEY/);
    pdfContractId = up.body.id;
  });

  it('PDF with an AI provider configured: suggestions only, page refs, grounding flags, header suggestion is not applied automatically', async () => {
    setLlmClient({ model: 'fake-llm', complete: async () => JSON.stringify({ header: { contractNumber: 'ARC-PDF-9', supplierName: 'Shree Bearings', validTo: '2027-06-30' },
      lines: [{ page: 1, description: 'Ball bearing 6205 sealed', materialCode: '1000123', uom: 'Nos', netPrice: 90, moq: 5 }, { page: 1, description: 'Made-up item', materialCode: '5555555', uom: 'Nos', netPrice: 12 }] }) });
    const r = await request(http).post(`/contracts/${pdfContractId}/extract`).set(as(admin)).expect(201);
    expect(r.body).toMatchObject({ status: 'in_review', lines: 2 }); expect(r.body.header.contractNumber).toBe('ARC-PDF-9');
    const c = (await request(http).get(`/contracts/${pdfContractId}`).set(as(admin))).body;
    const run = c.extractionRuns.find((x: any) => x.status === 'succeeded'); expect(run).toMatchObject({ provider: 'pdf-llm', prompt_version: 'contract-extract-v1' });
    expect(c.lines[0]).toMatchObject({ source_ref: 'page 1', status: 'needs_review', item_id: null }); expect(+c.lines[0].extraction_confidence).toBeLessThanOrEqual(0.85);
    expect(c.lines[1].raw._issues).toEqual(expect.arrayContaining(['materialCode_not_found_in_source'])); expect(+c.lines[1].extraction_confidence).toBeLessThan(0.5);
    expect(c.number).toBeNull(); // AI header is a suggestion; a person must set it
    await request(http).post(`/contracts/${pdfContractId}/header`).set(as(buyer)).send({ number: 'X' }).expect(403);
    await request(http).post(`/contracts/${pdfContractId}/header`).set(as(admin)).send({ number: 'ARC-PDF-9', validTo: '2027-06-30' }).expect(201);
    expect((await request(http).get(`/contracts/${pdfContractId}`).set(as(admin))).body).toMatchObject({ number: 'ARC-PDF-9' });
    await request(http).post(`/contracts/${pdfContractId}/extract`).set(as(admin)).expect(409); // already has lines
    setLlmClient(undefined);
  });

  it('a failing AI provider keeps the contract as a draft with the failure recorded', async () => {
    setLlmClient({ model: 'fake-llm', complete: async () => { throw new Error('LLM request failed (500)'); } });
    const up = await upload('arc2.pdf', pdf(['Some long enough contract text for the extractor to accept this page as readable text'])).expect(201);
    expect(up.body).toMatchObject({ status: 'draft', extraction: 'failed' });
    setLlmClient(undefined);
  });

  it('equivalent codes: only approved entries create a step-3 suggestion; existing codes cannot be "equivalents"', async () => {
    const eq = { erpSystemId: s01, materialCode: 'OLD-9', itemId: items['Ball bearing 6205 open'] };
    await request(http).post('/catalogue/equivalents').set(as(buyer)).send(eq).expect(403);
    await request(http).post('/catalogue/equivalents').set(as(admin)).send(eq).expect(201);
    await request(http).post('/catalogue/equivalents').set(as(admin)).send(eq).expect(409);
    await request(http).post('/catalogue/equivalents').set(as(admin)).send({ ...eq, materialCode: '1000123' }).expect(409);
    const up = await upload('eq.csv', Buffer.from('Description,Material Code,UOM,Net Price\nOld code bearing,OLD-9,Nos,50\nUnlisted code,OLD-10,Nos,50\n')).expect(201);
    const c = (await request(http).get(`/contracts/${up.body.id}`).set(as(admin))).body;
    expect(c.lines[0].candidates[0]).toMatchObject({ basis: 'equivalent_code', itemId: items['Ball bearing 6205 open'], status: 'pending' });
    expect(c.lines[1].candidates.every((x: any) => x.basis !== 'equivalent_code')).toBe(true);
    expect((await request(http).get('/catalogue/equivalents').set(as(admin))).body).toHaveLength(1);
  });

  it('item images and documents: byte-sniffed, size-limited, tenant-scoped; served safely', async () => {
    const id = items['Ball bearing 6205 sealed'];
    await request(http).post(`/catalogue/items/${id}/assets`).set(as(buyer)).attach('file', PNG, 'x.png').expect(403);
    await request(http).post(`/catalogue/items/${id}/assets`).set(as(admin)).attach('file', Buffer.from('<svg onload="alert(1)"/>'), 'x.png').expect(400); // name says png, bytes say svg
    await request(http).post(`/catalogue/items/${id}/assets`).set(as(admin)).attach('file', Buffer.from('MZ\x90\x00 evil'), 'a.pdf').expect(400);
    await request(http).post(`/catalogue/items/${id}/assets`).set(as(admin)).attach('file', Buffer.alloc(6 * 1024 * 1024, 1), 'big.png').expect(413);
    const a = await request(http).post(`/catalogue/items/${id}/assets`).set(as(admin)).field('caption', 'Front view').attach('file', PNG, 'photo.png').expect(201);
    const d = await request(http).post(`/catalogue/items/${id}/assets`).set(as(admin)).attach('file', pdf(['datasheet']), 'datasheet.pdf').expect(201);
    expect([a.body.kind, d.body.kind]).toEqual(['image', 'document']);
    const img = await request(http).get(`/catalogue/assets/${a.body.id}`).set(as(buyer)).expect(200);
    expect(img.headers['content-type']).toBe('image/png'); expect(img.headers['x-content-type-options']).toBe('nosniff'); expect(img.headers['content-security-policy']).toMatch(/sandbox/); expect(img.headers['content-disposition']).toMatch(/^inline/);
    expect((await request(http).get(`/catalogue/assets/${d.body.id}`).set(as(buyer))).headers['content-disposition']).toMatch(/^attachment/);
    await request(http).get(`/catalogue/assets/${a.body.id}`).expect(401);
    expect((await request(http).get('/catalogue/search?q=6205').set(as(buyer))).body.find((i: any) => i.id === id).imageId).toBe(a.body.id);
    const rival = await login('rival', 'admin@rival.test');
    await request(http).get(`/catalogue/assets/${a.body.id}`).set(as(rival)).expect(404);
  });

  it('item versions: every change is a new version with who/when; product detail carries plant coverage', async () => {
    const id = items['Ball bearing 6205 sealed'];
    await request(http).post(`/catalogue/items/${id}/update`).set(as(buyer)).send({ description: 'x' }).expect(403);
    expect((await request(http).post(`/catalogue/items/${id}/update`).set(as(admin)).send({ description: 'Double-sealed deep groove', specs: { bore: '25', seal: 'sealed', material: 'steel' } }).expect(201)).body.version).toBe(2);
    const v = (await request(http).get(`/catalogue/items/${id}/versions`).set(as(admin))).body;
    expect(v.map((x: any) => x.version)).toEqual([2, 1]); expect(v[0].snapshot.specs.material).toBe('steel'); expect(v[0].changedBy).toBeTruthy();
    // publish a contract so the detail shows coverage for the plant
    const up = await upload('p.csv', Buffer.from('Description,Material Code,UOM,Net Price,MOQ\nBall bearing 6205 sealed,1000123,Nos,90,5\n'), { number: 'ARC-D' }).expect(201);
    const q = (await request(http).get('/review/queue').set(as(admin))).body.find((l: any) => l.contractNumber === 'ARC-D');
    await request(http).post(`/review/candidates/${q.candidates[0].id}/decision`).set(as(admin)).send({ decision: 'approve' }).expect(201);
    await request(http).post(`/contracts/${up.body.id}/approve`).set(as(admin)).expect(201); await request(http).post(`/contracts/${up.body.id}/publish`).set(as(admin)).expect(201);
    const det = (await request(http).get(`/catalogue/items/${id}/detail?plantId=${plant}`).set(as(buyer))).body;
    expect(det).toMatchObject({ version: 2, routing: { route: 'arc', model: 2 } }); expect(det.contractCoverage[0]).toMatchObject({ contractNumber: 'ARC-D', supplier: 'Shree Bearings' });
    expect(det.assets).toHaveLength(2); expect(det.attributes.map((a: any) => a.key)).toEqual(['bore', 'seal']); expect(det.codes[0]).toMatchObject({ server: 'S01', code: '1000123' });
  });

  it('Ask MonoSource: reads what you said, asks the required question first, narrows, never invents', async () => {
    const ask = async (body: any, t = buyer) => (await request(http).post('/ask').set(as(t)).send(body).expect(201)).body;
    expect((await ask({ text: '' })).message).toMatch(/Tell me what you need/);
    const t1 = await ask({ text: 'I need a ball bearing', plantId: plant });
    expect(t1.question).toMatchObject({ key: 'bore', required: true, label: 'Bore (mm)' }); expect(t1.question.options.map((o: any) => o.value).sort()).toEqual(['25', '30']); expect(t1.total).toBe(4);
    const t2 = await ask({ text: 'ball bearing for a 25 mm shaft', plantId: plant });
    expect(t2.answers.bore).toMatchObject({ value: '25', source: 'your text' }); expect(t2.question.key).toBe('seal'); expect(t2.total).toBe(3);
    const t3 = await ask({ text: 'ball bearing for a 25 mm shaft', plantId: plant, answers: { seal: 'sealed' } });
    expect(t3.answers.seal.source).toBe('you'); expect(t3.candidates.find((c: any) => c.name.endsWith('generic')).unknownSpecs).toEqual(['Seal type']); // spec not recorded → flagged, not dropped; expect(t3.candidates.map((c: any) => c.name)).toEqual(expect.arrayContaining(['Ball bearing 6205 sealed']));
    const sealed = t3.candidates.find((c: any) => c.name === 'Ball bearing 6205 sealed');
    expect(sealed.contractCoverage[0]).toMatchObject({ contractNumber: 'ARC-D' }); expect(sealed.routing).toMatchObject({ route: 'arc', model: 2 });
    const open = (await ask({ text: 'ball bearing 25 mm', plantId: plant, answers: { seal: 'open' } })).candidates.find((c: any) => c.name.endsWith('open'));
    expect(open.contractCoverage).toEqual([]); expect(open.routing.route).not.toBe('arc'); // no contract → no price shown, nothing invented
    const t4 = await ask({ text: 'ball bearing 25 mm', plantId: plant, answers: { seal: 'sealed', bore: '25' } });
    expect(t4).toMatchObject({ question: null, done: true, total: 2 }); // sealed + generic (seal unrecorded): nothing left to ask, you choose
    const ex = await ask({ text: 'ball bearing', plantId: plant, answers: { bore: '30', seal: 'sealed' } }); expect(ex.candidates).toHaveLength(1); expect(ex.done).toBe(true);
    expect((await ask({ text: 'unobtainium widget' })).message).toMatch(/Nothing in the catalogue/);
    const rival = await login('rival', 'admin@rival.test');
    expect((await ask({ text: 'ball bearing' }, rival)).candidates).toEqual([]); // tenant isolation
    await request(http).post('/ask').set(as(buyer)).send({ text: 'x', plantId: 'not-a-uuid' }).expect(400);
  });

  it('every extraction attempt is recorded and audited', async () => {
    const runs = (await sql(`SELECT provider, status FROM extraction_runs ORDER BY created_at`)).rows.map((r) => `${r.provider}:${r.status}`);
    expect(runs).toEqual(expect.arrayContaining(['xlsx-rules:succeeded', 'xlsx-rules:failed', 'none:unsupported', 'pdf-llm:succeeded', 'pdf-llm:failed', 'csv-rules:succeeded']));
    const actions = (await sql(`SELECT DISTINCT action FROM audit_log`)).rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(['contract.extraction_unsupported', 'contract.extraction_failed', 'contract.header_set', 'catalogue_item.updated', 'catalogue_asset.added', 'equivalent.added']));
  });
});
