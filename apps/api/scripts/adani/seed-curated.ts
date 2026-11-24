/**
 * Builds tenant "adani" with the CURATED showcase catalogue (scripts/adani/curated/catalogue.ts).
 *
 *   DATABASE_ADMIN_URL=... npx tsx scripts/adani/seed-curated.ts [--data .data/adani] [--reset]
 *
 * Real (from the Adani files):  org tree (BU > company code > plant per SAP server), ProcMart taxonomy + attribute
 *                               templates + product-type vectors, and the demand ranking (FY25-26 PO lines per product type).
 * Curated:                      ~1,600 products — real brands, manufacturer part numbers, dimensions/ratings, full spec sheets,
 *                               descriptions, SAP short texts, product images and data sheets.
 * Illustrative (made up):       prices, distributors, SAP material codes. 90% of items are on a group ARC with a distributor
 *                               (a quarter of those with a second ARC supplier); 10% are supplied by ProcMart at a price-list rate.
 *
 * Images and data sheets go to Supabase Storage when SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are set, else to ./.storage.
 */
import { Client } from 'pg';
import { randomUUID, randomBytes, createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'csv-parse/sync';
import { DEFAULT_ADMIN_URL } from '../../src/db/db';
import { hashPassword } from '../../src/common/security';
import { ADANI_LEVELS, ROLE_PRESETS } from '../../src/common/roles';
import { attrKey, TYPE_SYNONYMS, words, childKeyOf } from '../../src/catalogue/taxonomy';
import { embed, embeddingsEnabled, toPgVector, typeText } from '../../src/catalogue/embed';
import { Storage } from '../../src/storage/storage';
import { CATALOGUE, CItem } from './curated/catalogue';
import { renderItem } from './curated/art';

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', join(__dirname, '..', '..', '.data', 'adani'))!;
const RESET = process.argv.includes('--reset');
const SLUG = 'adani';
const log = (...a: any[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase()).replace(/\b(Mm|Kv|Kw|Hp|Ss|Ms|Cs|Gi|Pvc|Xlpe|Mcb|Mccb|Led|Ups|Plc|Vfd|No|Ip|Oem|Api|Nlgi|Gsm|Ram)\b/g, (m) => m.toUpperCase());
/** deterministic 0..1 from a string, so re-seeding gives the same supply split and prices */
const hash01 = (s: string) => parseInt(createHash('sha1').update(s).digest('hex').slice(0, 8), 16) / 0xffffffff;

async function bulk(c: Client, table: string, cols: string[], types: string[], rows: any[][], extra = '') {
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = rows.slice(i, i + 2000);
    const arrays = cols.map((_, j) => chunk.map((r) => r[j] ?? null));
    await c.query(`INSERT INTO ${table}(${cols.join(',')}) SELECT * FROM unnest(${types.map((t, j) => `$${j + 1}::${t}[]`).join(',')}) ${extra}`, arrays);
  }
}
async function wipeTenant(c: Client, tenantId: string) {
  const tables = (await c.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='tenant_id' AND table_name <> 'tenants'`)).rows.map((r) => r.table_name as string);
  await c.query(`ALTER TABLE audit_log DISABLE TRIGGER audit_no_update`);
  let left = [...tables];
  for (let pass = 0; left.length && pass < 30; pass++) {
    const next: string[] = [];
    for (const t of left) {
      await c.query('SAVEPOINT w');
      try { await c.query(`DELETE FROM ${t} WHERE tenant_id=$1`, [tenantId]); await c.query('RELEASE SAVEPOINT w'); }
      catch (e: any) { await c.query('ROLLBACK TO SAVEPOINT w'); if (e.code === '23503') next.push(t); else throw e; }
    }
    if (next.includes('taxonomy_nodes')) await c.query(`UPDATE taxonomy_nodes SET parent_id=NULL WHERE tenant_id=$1`, [tenantId]);
    if (next.includes('org_nodes')) await c.query(`UPDATE org_nodes SET parent_id=NULL WHERE tenant_id=$1`, [tenantId]);
    left = next;
  }
  await c.query(`ALTER TABLE audit_log ENABLE TRIGGER audit_no_update`);
  if (left.length) throw new Error('could not wipe: ' + left.join(', '));
  await c.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]);
}
function pdf(lines: string[]): Buffer {
  const clean = (l: string) => l.normalize('NFKD').replace(/[^\x20-\x7e]/g, (ch) => ({ '–': '-', '×': 'x', '°': ' deg', 'µ': 'u', '²': '2', '³': '3', '½': '1/2', '¼': '1/4', '±': '+/-' } as any)[ch] ?? '').replace(/[()\\]/g, '');
  const text = lines.map((l, i) => `BT /F1 ${i === 0 ? 15 : 10} Tf 50 ${790 - i * 17} Td (${clean(l).slice(0, 105)}) Tj ET`).join('\n');
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${text.length} >>\nstream\n${text}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  let out = '%PDF-1.4\n'; const off: number[] = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out);
}
const wrap = (s: string, n = 100) => s.split(' ').reduce<string[]>((acc, w) => { const l = acc[acc.length - 1]; if (l && (l + ' ' + w).length <= n) acc[acc.length - 1] = l + ' ' + w; else acc.push(w); return acc; }, []);

/** Distributors (fictional) by the categories they hold ARCs for. */
const DISTRIBUTORS: { key: string; name: string; cats: string[]; city: string }[] = [
  { key: 'brg1', name: 'Bharat Bearing & Transmission Co.', cats: ['Bearings & Power Transmission'], city: 'Ahmedabad' },
  { key: 'brg2', name: 'Western Drives & Bearings Pvt Ltd', cats: ['Bearings & Power Transmission'], city: 'Mumbai' },
  { key: 'ele1', name: 'Shakti Electricals & Controls', cats: ['Electrical'], city: 'Ahmedabad' },
  { key: 'ele2', name: 'Kalinga Power Systems Pvt Ltd', cats: ['Electrical', 'Industrial Automation'], city: 'Bhubaneswar' },
  { key: 'aut1', name: 'Precision Automation Solutions LLP', cats: ['Industrial Automation', 'Measuring Instrumentation & Calibration', 'Electronics'], city: 'Pune' },
  { key: 'saf1', name: 'Suraksha Safety Supplies', cats: ['Safety & Supplies'], city: 'Vadodara' },
  { key: 'saf2', name: 'Coastline PPE Distributors', cats: ['Safety & Supplies', 'Housekeeping'], city: 'Chennai' },
  { key: 'fst1', name: 'Gujarat Fasteners & Hardware', cats: ['Fasteners', 'Hand Tools'], city: 'Rajkot' },
  { key: 'tol1', name: 'Mahavir Tools & Abrasives', cats: ['Hand Tools', 'Power Tools', 'Abrasives', 'Welding & Soldering'], city: 'Surat' },
  { key: 'hyd1', name: 'Fluid Power Engineering Services', cats: ['Hydraulics & Pneumatics'], city: 'Pune' },
  { key: 'hyd2', name: 'Deccan Valves & Hoses Pvt Ltd', cats: ['Hydraulics & Pneumatics', 'Plumbing'], city: 'Hyderabad' },
  { key: 'mec1', name: 'Sealtech Mechanical Spares', cats: ['Mechanical'], city: 'Vadodara' },
  { key: 'lub1', name: 'Saurashtra Lubricants Agency', cats: ['Lubricants & Oil', 'Automotive'], city: 'Jamnagar' },
  { key: 'mhs1', name: 'Liftwell Rigging & Handling', cats: ['Material Handling'], city: 'Mundra' },
  { key: 'stl1', name: 'Metro Steel & Building Materials', cats: ['Structural', 'Building & Construction Material', 'Paints & Emulsions'], city: 'Ahmedabad' },
  { key: 'off1', name: 'Omkar Office & IT Supplies', cats: ['Stationery', 'I. T.', 'Packaging', 'Adhesives Sealants & Tapes'], city: 'Ahmedabad' },
  { key: 'lab1', name: 'Scientific Lab & Industrial Supplies', cats: ['Lab Supplies', 'Industrial Equipments', 'Adhesives Sealants & Tapes', 'Paints & Emulsions'], city: 'Vadodara' },
];

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_ADMIN_URL || DEFAULT_ADMIN_URL });
  await c.connect();
  await c.query(`SELECT set_config('app.platform','on',false)`);
  await c.query(`SET statement_timeout = 0`);
  const storage = new Storage();
  await c.query('BEGIN');
  try {
    const old = (await c.query(`SELECT id FROM tenants WHERE slug=$1`, [SLUG])).rows[0];
    if (old && !RESET) throw new Error(`tenant "${SLUG}" exists; run with --reset to rebuild it (deletes all its data)`);
    if (old) { log('wiping existing tenant'); await wipeTenant(c, old.id); }

    // ───────── tenant, levels, roles, servers, org (real) ─────────
    const T = randomUUID();
    await c.query(`INSERT INTO tenants(id,slug,name,config) VALUES ($1,$2,'Adani Group',$3)`, [T, SLUG, JSON.stringify({ curated: true, source: 'Real org and ProcMart taxonomy; curated catalogue of what the group buys. Prices, distributors and SAP codes are illustrative.' })]);
    await c.query(`INSERT INTO tenant_policies(tenant_id, arc_priority_over_direct, procmart_may_bid, thresholds) VALUES ($1, true, true, '{"minQuotes":3}')`, [T]);
    for (const l of ADANI_LEVELS) await c.query(`INSERT INTO org_level_types(tenant_id,key,label,rank) VALUES ($1,$2,$3,$4)`, [T, l.key, l.label, l.rank]);
    const roleId: Record<string, string> = {};
    for (const [key, r] of Object.entries(ROLE_PRESETS)) roleId[key] = (await c.query(`INSERT INTO roles(tenant_id,key,name,permissions) VALUES ($1,$2,$3,$4) RETURNING id`, [T, key, r.name, r.permissions])).rows[0].id;
    const org = parse(readFileSync(join(DATA, 'org.csv')), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
    const erp = new Map<string, string>();
    for (const s of [...new Set(org.map((r) => r.server))].sort()) {
      const id = randomUUID(); erp.set(s, id);
      await c.query(`INSERT INTO erp_systems(id,tenant_id,code,name,kind,config) VALUES ($1,$2,$3,$4,'mock-sap',$5)`, [id, T, `SAP-${s}`, `SAP server ${s}`, JSON.stringify({ note: 'Real server code. No live SAP connection: PR/PO calls are simulated.' })]);
    }
    const group = randomUUID(); const nodes: any[][] = [[group, T, null, 'group', 'ADANI', 'Adani Group', null, 'import']];
    const bu = new Map<string, string>(), cc = new Map<string, string>(), plant = new Map<string, { id: string; name: string }>();
    for (const r of org) {
      if (!bu.has(r.BU)) { const id = randomUUID(); bu.set(r.BU, id); nodes.push([id, T, group, 'business', r.BU, r.BU, null, 'import']); }
      const ck = `${r.server}|${r['Company code']}`;
      if (!cc.has(ck)) { const id = randomUUID(); cc.set(ck, id); nodes.push([id, T, bu.get(r.BU), 'company_code', r['Company code'], title(r['Company name'] || r['Company code']), erp.get(r.server), 'import']); }
      const pk = `${r.server}|${r['Plant code']}`;
      if (!plant.has(pk)) { const id = randomUUID(); const name = `${r['Plant name']}${r.Location ? ' · ' + title(r.Location) : ''}`; plant.set(pk, { id, name }); nodes.push([id, T, cc.get(ck), 'plant', r['Plant code'], name, erp.get(r.server), 'import']); }
    }
    await bulk(c, 'org_nodes', ['id', 'tenant_id', 'parent_id', 'level_type', 'code', 'name', 'erp_system_id', 'source'], ['uuid', 'uuid', 'uuid', 'text', 'text', 'text', 'uuid', 'text'], nodes);
    log('org', bu.size, 'BUs', cc.size, 'company codes', plant.size, 'plants');

    // ───────── taxonomy (real) ─────────
    const tax = JSON.parse(readFileSync(join(DATA, 'taxonomy.json'), 'utf8')) as { category: string; sub: string; child: string; product: string; attrs: { name: string; unit: string | null; mandatory: boolean }[] }[];
    const tnode = new Map<string, string>(); const trows: any[][] = []; const arows: any[][] = [];
    const node = (level: string, parts: string[], name: string, category: string, parent: string | null, syn: string[] = []) => {
      const path = parts.join(' > '); let id = tnode.get(path);
      if (!id) { id = randomUUID(); tnode.set(path, id); trows.push([id, T, parent, level, name, path, category, syn]); }
      return id;
    };
    const types: { id: string; name: string; category: string; sub: string; child: string; synonyms: string[]; path: string }[] = [];
    const typeBy = new Map<string, (typeof types)[number]>();
    const attrLabels = new Map<string, Map<string, string>>();
    for (const t of tax) {
      const a = node('category', [t.category], t.category, t.category, null);
      const b = node('sub_category', [t.category, t.sub], t.sub, t.category, a);
      const ch = node('child_category', [t.category, t.sub, t.child], t.child, t.category, b); void childKeyOf;
      const syn = TYPE_SYNONYMS[words(t.product, { expand: false }).join(' ')] ?? [];
      const path = [t.category, t.sub, t.child, t.product].join(' > ');
      const p = node('product_type', [t.category, t.sub, t.child, t.product], t.product, t.category, ch, syn);
      const ty = { id: p, name: t.product, category: t.category, sub: t.sub, child: t.child, synonyms: syn, path };
      types.push(ty); if (!typeBy.has(`${t.category}|${t.product}`)) typeBy.set(`${t.category}|${t.product}`, ty);
      const attrs = [...t.attrs].sort((x, y) => Number(y.mandatory) - Number(x.mandatory));
      attrLabels.set(p, new Map(attrs.map((x) => [attrKey(x.name), title(x.name)])));
      attrs.forEach((x, i) => arows.push([randomUUID(), T, p, attrKey(x.name), title(x.name), x.unit, x.mandatory, i]));
    }
    await bulk(c, 'taxonomy_nodes', ['id', 'tenant_id', 'parent_id', 'level', 'name', 'path', 'category'], ['uuid', 'uuid', 'uuid', 'text', 'text', 'text', 'text'], trows.map((r) => r.slice(0, 7)));
    for (const r of trows) if ((r[7] as string[]).length) await c.query(`UPDATE taxonomy_nodes SET synonyms=$2 WHERE id=$1`, [r[0], r[7]]);
    await bulk(c, 'product_type_attributes', ['id', 'tenant_id', 'product_type_id', 'key', 'label', 'unit', 'required', 'position'], ['uuid', 'uuid', 'uuid', 'text', 'text', 'text', 'boolean', 'int'], arows, 'ON CONFLICT DO NOTHING');
    log('taxonomy', trows.length, 'nodes,', types.length, 'product types');
    if (embeddingsEnabled()) {
      const V = await embed(types.map(typeText));
      for (let i = 0; i < types.length; i += 500)
        await c.query(`UPDATE taxonomy_nodes t SET embedding = v.e::vector FROM unnest($1::uuid[], $2::text[]) AS v(id, e) WHERE t.id = v.id`, [types.slice(i, i + 500).map((t) => t.id), V.slice(i, i + 500).map(toPgVector)]);
      log('product types embedded');
    }

    // ───────── catalogue (curated) ─────────
    const demand: Record<string, number> = existsSync(join(DATA, 'type_demand.json')) ? JSON.parse(readFileSync(join(DATA, 'type_demand.json'), 'utf8') || '{}') ?? {} : {};
    const perType = new Map<string, number>(); for (const i of CATALOGUE) perType.set(`${i.category}|${i.product}`, (perType.get(`${i.category}|${i.product}`) ?? 0) + 1);
    const servers = [...erp.keys()];
    const busiest = [...servers].sort((a, b) => org.filter((r) => r.server === b).length - org.filter((r) => r.server === a).length);
    const itemId = new Map<string, string>(); const irows: any[][] = []; const crows: any[][] = []; const alrows: any[][] = [];
    let mat = 2100500000;
    // exactly 10% via ProcMart: the items with the lowest stable hash
    const viaPm = new Set([...CATALOGUE].sort((a, b) => hash01('supply|' + a.key) - hash01('supply|' + b.key)).slice(0, Math.round(CATALOGUE.length * 0.1)).map((i) => i.key));
    const supplyOf = (i: CItem) => (viaPm.has(i.key) ? 'procmart' : 'arc');
    for (const i of CATALOGUE) {
      const ty = typeBy.get(`${i.category}|${i.product}`); if (!ty) throw new Error(`no product type ${i.category} / ${i.product}`);
      const id = randomUUID(); itemId.set(i.key, id);
      const specs: Record<string, string> = {}; for (const [k, v] of Object.entries(i.specs)) specs[attrKey(k)] = v;
      const kw = [...new Set([...words(i.name, { expand: true }), ...words(i.sap, { expand: true }), ...words(ty.name, { expand: false }), ...ty.synonyms.flatMap((s) => words(s)), ...words(ty.child, { expand: false }), ...words(i.mpn, { expand: false })])].join(' ');
      // ranking signal: real group demand for this product type, shared across its curated products
      const poLines = Math.max(1, Math.round((demand[ty.path] ?? 0) / (perType.get(`${i.category}|${i.product}`) ?? 1)));
      irows.push([id, T, i.name, i.description, i.brand, i.brand, i.mpn, i.uom, ty.category, JSON.stringify(specs), supplyOf(i) === 'arc' ? 'arc' : 'qrc', 'active', ty.id,
        JSON.stringify({ basis: 'manual', score: 1, matched: ty.name }), kw, poLines, Math.min(plant.size, 3 + Math.round(hash01('pl|' + i.key) * 40))]);
      const nServers = 1 + Math.floor(hash01('srv|' + i.key) * 3);
      for (const s of busiest.slice(0, nServers)) crows.push([randomUUID(), T, id, erp.get(s), String(mat++)]);
      alrows.push([randomUUID(), T, id, 'sap_description', i.sap]);
    }
    await bulk(c, 'catalogue_items', ['id', 'tenant_id', 'name', 'description', 'manufacturer', 'brand', 'mpn', 'uom', 'category', 'specs', 'procmart_serviceability', 'status', 'product_type_id', 'classification', 'keywords', 'po_lines', 'plant_count'],
      ['uuid', 'uuid', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'jsonb', 'text', 'text', 'uuid', 'jsonb', 'text', 'int', 'int'], irows);
    await bulk(c, 'item_erp_codes', ['id', 'tenant_id', 'item_id', 'erp_system_id', 'material_code'], ['uuid', 'uuid', 'uuid', 'uuid', 'text'], crows);
    await bulk(c, 'item_aliases', ['id', 'tenant_id', 'item_id', 'kind', 'value'], ['uuid', 'uuid', 'uuid', 'text', 'text'], alrows, 'ON CONFLICT DO NOTHING');
    await c.query(`UPDATE taxonomy_nodes t SET item_count = x.n FROM (SELECT product_type_id, count(*) n FROM catalogue_items WHERE tenant_id=$1 GROUP BY 1) x WHERE t.id = x.product_type_id`, [T]);
    // approved equivalents: same designation from another brand
    const groups = new Map<string, string[]>(); for (const i of CATALOGUE) if (i.equiv) (groups.get(i.equiv) ?? groups.set(i.equiv, []).get(i.equiv)!).push(itemId.get(i.key)!);
    const altRows: any[][] = [];
    for (const ids of groups.values()) for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) altRows.push([randomUUID(), T, ids[a], ids[b], 'Same designation and dimensions, interchangeable (approved by central procurement)']);
    await bulk(c, 'item_alternatives', ['id', 'tenant_id', 'item_id', 'alternative_item_id', 'note'], ['uuid', 'uuid', 'uuid', 'uuid', 'text'], altRows);
    log('items', irows.length, 'material codes', crows.length, 'approved alternatives', altRows.length);

    // ───────── suppliers ─────────
    const sup = new Map<string, string>(); const srows: any[][] = []; const scrows: any[][] = [];
    const vcode = (k: number, s: string) => `${s === '470' ? 'V47' : 'V'}${String(100000 + k * 37).slice(0, 6)}`;
    [...DISTRIBUTORS, { key: 'procmart', name: 'ProcMart Direct Supply', cats: [], city: 'Ahmedabad' }].forEach((d, k) => {
      const id = randomUUID(); sup.set(d.key, id);
      srows.push([id, T, d.name, 'active', d.key === 'procmart', `24AAACP${String(1000 + k * 13).slice(0, 4)}Q1Z${k % 10}`, `orders@${d.key}.example`, `+91 79 ${String(40000000 + k * 104729).slice(0, 8)}`]);
      for (const s of servers) scrows.push([randomUUID(), T, id, erp.get(s), vcode(k + 1, s)]);
    });
    await bulk(c, 'suppliers', ['id', 'tenant_id', 'legal_name', 'status', 'is_procmart', 'tax_id', 'contact_email', 'contact_phone'], ['uuid', 'uuid', 'text', 'text', 'boolean', 'text', 'text', 'text'], srows);
    await bulk(c, 'supplier_erp_codes', ['id', 'tenant_id', 'supplier_id', 'erp_system_id', 'vendor_code'], ['uuid', 'uuid', 'uuid', 'uuid', 'text'], scrows);

    // ───────── contracts: group ARCs (90%) + ProcMart price list (10%) ─────────
    const homeErp = erp.get(busiest[0])!;
    const contracts = new Map<string, { id: string; n: number }>(); const ctrows: any[][] = []; const csrows: any[][] = []; const clrows: any[][] = [];
    const contractFor = (key: string, type: 'ARC' | 'PROCMART_DIRECT') => {
      let ct = contracts.get(key); if (ct) return ct;
      ct = { id: randomUUID(), n: 0 }; contracts.set(key, ct);
      const k = contracts.size; const ending = type === 'ARC' && hash01('end|' + key) < 0.15;
      ctrows.push([ct.id, T, type, type === 'ARC' ? `ARC/AGL/26-27/${String(100 + k * 7).padStart(4, '0')}` : 'PM-PL/AGL/26-27/0001', sup.get(type === 'ARC' ? key : 'procmart'), homeErp, type === 'ARC' ? '2026-04-01' : '2026-07-01', ending ? '2026-12-31' : '2027-03-31', 'published', new Date().toISOString()]);
      csrows.push([randomUUID(), T, ct.id, group]);
      return ct;
    };
    let nArc = 0, nDual = 0, nPm = 0;
    for (const i of CATALOGUE) {
      const item = itemId.get(i.key)!;
      const line = (ct: { id: string; n: number }, price: number, disc: number, cap: number | null) => {
        const net = Math.round(price * (1 - disc / 100) * 100) / 100;
        clrows.push([randomUUID(), T, ct.id, ++ct.n, JSON.stringify({ source: 'curated showcase', listPrice: price }), `line ${ct.n}`, i.name, i.mpn, i.mpn, i.brand, i.uom, price, disc, net, cap, 'INR', 'published', item]);
      };
      if (supplyOf(i) === 'procmart') { line(contractFor('procmart', 'PROCMART_DIRECT'), i.price, 0, null); nPm++; continue; }
      const cands = DISTRIBUTORS.filter((d) => d.cats.includes(i.category));
      if (!cands.length) throw new Error('no distributor for ' + i.category);
      const h = hash01('arc|' + i.key); const first = cands[Math.floor(h * cands.length)];
      const disc = [6, 8, 10, 12, 15][Math.floor(hash01('d|' + i.key) * 5)];
      const cap = hash01('cap|' + i.key) < 0.3 ? Math.max(10, Math.round((i.price < 500 ? 2000 : i.price < 5000 ? 400 : 40) * (0.5 + hash01('q|' + i.key)))) : null;
      line(contractFor(first.key, 'ARC'), i.price, disc, cap); nArc++;
      if (cands.length > 1 && hash01('dual|' + i.key) < 0.25) { const second = cands.find((d) => d !== first)!; line(contractFor(second.key, 'ARC'), Math.round(i.price * (1.02 + hash01('p2|' + i.key) * 0.06) * 100) / 100, Math.max(5, disc - 2), null); nDual++; }
    }
    await bulk(c, 'contracts', ['id', 'tenant_id', 'contract_type', 'number', 'supplier_id', 'erp_system_id', 'valid_from', 'valid_to', 'status', 'published_at'], ['uuid', 'uuid', 'text', 'text', 'uuid', 'uuid', 'date', 'date', 'text', 'timestamptz'], ctrows);
    await bulk(c, 'contract_scopes', ['id', 'tenant_id', 'contract_id', 'node_id'], ['uuid', 'uuid', 'uuid', 'uuid'], csrows);
    await bulk(c, 'contract_lines', ['id', 'tenant_id', 'contract_id', 'line_no', 'raw', 'source_ref', 'description', 'supplier_item_code', 'mpn', 'brand', 'uom', 'base_price', 'discount_pct', 'net_price', 'qty_cap', 'currency', 'status', 'item_id'],
      ['uuid', 'uuid', 'uuid', 'int', 'jsonb', 'text', 'text', 'text', 'text', 'text', 'text', 'numeric', 'numeric', 'numeric', 'numeric', 'text', 'text', 'uuid'], clrows);
    log('contracts', ctrows.length, `— items on ARC ${nArc} (${nDual} with two suppliers), via ProcMart ${nPm} (${Math.round((nPm / CATALOGUE.length) * 100)}%)`);

    // ───────── images + data sheets ─────────
    const asrows: any[][] = []; let done = 0;
    const work = [...CATALOGUE];
    const worker = async () => {
      for (let i = work.shift(); i; i = work.shift()) {
        const id = itemId.get(i.key)!;
        const png = await renderItem(i.art.kind, i.art.color, i.art.label, i.brand, i.art.o ?? {});
        const a = await storage.put(T, png);
        asrows.push([randomUUID(), T, id, 'image', `${i.key}.png`, 'image/png', png.length, a.sha256, a.key, 'Product illustration']);
        const ty = typeBy.get(`${i.category}|${i.product}`)!; const labels = attrLabels.get(ty.id)!;
        const sheet = pdf([`${i.brand} ${i.mpn} - product data sheet`, i.name, '', ...wrap(i.description), '', 'SPECIFICATIONS', ...Object.entries(i.specs).map(([k, v]) => `${labels.get(attrKey(k)) ?? title(k)}: ${v}`), '', `Category: ${ty.path}`, `SAP short text: ${i.sap}`, `Unit of measure: ${i.uom}`]);
        const d = await storage.put(T, sheet);
        asrows.push([randomUUID(), T, id, 'document', `${i.mpn.replace(/[^A-Za-z0-9.-]+/g, '_')}-datasheet.pdf`, 'application/pdf', sheet.length, d.sha256, d.key, 'Data sheet']);
        if (++done % 250 === 0) log('assets', done, '/', CATALOGUE.length);
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    await bulk(c, 'item_assets', ['id', 'tenant_id', 'item_id', 'kind', 'filename', 'mime', 'size_bytes', 'sha256', 'storage_key', 'caption'], ['uuid', 'uuid', 'uuid', 'text', 'text', 'text', 'bigint', 'text', 'text', 'text'], asrows);
    log('assets', asrows.length);

    // ───────── users ─────────
    const home = [...plant.values()].find((p) => /mundra/i.test(p.name)) ?? [...plant.values()][0];
    const accounts: [string, string, string, string | null][] = [
      ['admin@adani.monosource', 'Adani administrator', 'customer_admin', null], ['central@adani.monosource', 'Central procurement', 'central_procurement', null],
      ['requester@adani.monosource', `Requester · ${home.name}`, 'requester', home.id], ['plantproc@adani.monosource', `Plant procurement · ${home.name}`, 'plant_procurement', home.id],
      ['approver@adani.monosource', 'Approver', 'approver', null], ['ops@adani.monosource', 'ProcMart operations', 'procmart_ops', null],
    ];
    const out = [`# Tenant (organisation ID): ${SLUG}. Generated ${new Date().toISOString()}. Keep private.`];
    for (const [email, name, role, scope] of accounts) {
      const pw = randomBytes(12).toString('base64url');
      const u = (await c.query(`INSERT INTO users(tenant_id,email,name,password_hash) VALUES ($1,$2,$3,$4) RETURNING id`, [T, email, name, await hashPassword(pw)])).rows[0];
      await c.query(`INSERT INTO user_roles(tenant_id,user_id,role_id,scope_node_id) VALUES ($1,$2,$3,$4)`, [T, u.id, roleId[role], scope]);
      out.push(`${email}\t${pw}\t${name}`);
    }
    writeFileSync(join(DATA, 'accounts.txt'), out.join('\n') + '\n', { mode: 0o600 });
    await c.query('COMMIT');
    log('analyzing'); await c.query('ANALYZE catalogue_items; ANALYZE contract_lines; ANALYZE taxonomy_nodes;');
    log('done. Accounts in', join(DATA, 'accounts.txt'));
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { await c.end(); }
})().catch((e) => { console.error(e); process.exit(1); });
