/**
 * Loads REAL Adani data (from extract.py, then clean.py) into tenant "adani".
 *
 *   DATABASE_ADMIN_URL=... npx tsx scripts/adani/seed.ts [--data .data/adani] [--reset] [--semantic] [--read-write]
 *
 * What gets created, all from the files (nothing invented):
 *   taxonomy      ProcMart category structure: category > sub > child > product type, attributes, product-type vectors
 *   org           Group > BU > company code > plant, per SAP server (servers are labelled simulated: no live SAP link)
 *   catalogue     one item per distinct material description, every SAP material code it is known by, classified to a
 *                 product type (or child category), specs read off the text, ProcMart category/serviceability/make
 *   suppliers     one per (SAP server, vendor code). The files carry no vendor names, so they show as "Vendor <code>"
 *   ARCs          one published contract per (server, vendor, validity window) seen on ARC-flagged PO lines, a line per item.
 *                 The files carry no prices: ARC lines have no price (the ARC in SAP holds it)
 *   PO history    every FY25-26 PO line, linked to plant, item and vendor
 *   users         admin + role users; random passwords written to <data>/accounts.txt (git-ignored)
 */
import { Client } from 'pg';
import { randomUUID, randomBytes } from 'crypto';
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'fs';
import { createInterface } from 'readline';
import { join } from 'path';
import { parse } from 'csv-parse/sync';
import { DEFAULT_ADMIN_URL } from '../../src/db/db';
import { hashPassword } from '../../src/common/security';
import { ADANI_LEVELS, ROLE_PRESETS } from '../../src/common/roles';
import { attrKey, buildTypeIndex, childKeyOf, classify, extractSpecs, TYPE_SYNONYMS, words, AttrSpec } from '../../src/catalogue/taxonomy';
import { embed, embeddingsEnabled, toPgVector, typeText } from '../../src/catalogue/embed';

const arg = (k: string, d?: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('--data', join(__dirname, '..', '..', '.data', 'adani'))!;
const RESET = process.argv.includes('--reset');
const SEMANTIC = process.argv.includes('--semantic') && embeddingsEnabled();   // ~7 min for ~1.5% more placed items
const TODAY = new Date().toISOString().slice(0, 10);
const SLUG = 'adani';
const log = (...a: any[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase()).replace(/\b(Mm|Kv|Kw|Hp|Ss|Ms|Cs|Gi|Pvc|Xlpe|Mcb|Mccb|Led|Ups|Plc|Vfd|No)\b/g, (m) => m.toUpperCase());

async function bulk(c: Client, table: string, cols: string[], types: string[], rows: any[][], extra = '') {
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = rows.slice(i, i + 2000);
    const arrays = cols.map((_, j) => chunk.map((r) => r[j] ?? null));
    await c.query(`INSERT INTO ${table}(${cols.join(',')}) SELECT * FROM unnest(${types.map((t, j) => `$${j + 1}::${t}[]`).join(',')}) ${extra}`, arrays);
  }
}

/**
 * Deletes a tenant in committed steps, children before parents, with VACUUM between passes. In one transaction the
 * deleted rows stay on disk until commit (the old and new data together overflow Supabase's free disk) and every
 * foreign-key check scans the dead rows of the child tables (a 30-minute wipe).
 */
async function wipeTenant(c: Client, tenantId: string) {
  const tables = (await c.query(`SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='tenant_id' AND table_name <> 'tenants'`)).rows.map((r) => r.table_name as string);
  await c.query(`ALTER TABLE audit_log DISABLE TRIGGER audit_no_update`);
  try {
    let left = [...tables];
    for (let pass = 0; left.length && pass < 30; pass++) {
      const next: string[] = []; const done: string[] = [];
      for (const t of left) {
        try { await c.query(`DELETE FROM ${t} WHERE tenant_id=$1`, [tenantId]); done.push(t); }
        catch (e: any) { if (e.code === '23503') next.push(t); else throw e; }
      }
      // self-references (taxonomy, org tree): null the parents, then retry
      if (next.includes('taxonomy_nodes')) await c.query(`UPDATE taxonomy_nodes SET parent_id=NULL WHERE tenant_id=$1`, [tenantId]);
      if (next.includes('org_nodes')) await c.query(`UPDATE org_nodes SET parent_id=NULL WHERE tenant_id=$1`, [tenantId]);
      if (done.length) await c.query(`VACUUM ${done.join(', ')}`);
      log(`wipe pass ${pass + 1}: ${done.length} tables emptied, ${next.length} waiting on references`);
      left = next;
    }
    if (left.length) throw new Error('could not wipe: ' + left.join(', '));
    await c.query(`DELETE FROM tenants WHERE id=$1`, [tenantId]);
  } finally { await c.query(`ALTER TABLE audit_log ENABLE TRIGGER audit_no_update`); }
}

(async () => {
  const c = new Client({ connectionString: process.env.DATABASE_ADMIN_URL || DEFAULT_ADMIN_URL });
  await c.connect();
  await c.query(`SELECT set_config('app.platform','on',false)`);
  await c.query(`SET statement_timeout = 0`);   // Supabase's default timeout cancels the tenant wipe (FK checks over 300k rows)
  // Supabase turns a full database read-only; --read-write lifts that for this session only, so the reset can free the space
  if (process.argv.includes('--read-write')) await c.query(`SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE`);
  const old = (await c.query(`SELECT id FROM tenants WHERE slug=$1`, [SLUG])).rows[0];
  if (old && !RESET) throw new Error(`tenant "${SLUG}" exists; run with --reset to rebuild it (deletes all its data)`);
  if (old) { log('wiping existing tenant (committed: the tenant is gone until the load below finishes)'); await wipeTenant(c, old.id); }
  await c.query('BEGIN');
  try {

    // ───────── tenant, levels, roles, servers ─────────
    const T = randomUUID();
    await c.query(`INSERT INTO tenants(id,slug,name,config) VALUES ($1,$2,'Adani Group',$3)`, [T, SLUG, JSON.stringify({ realData: true, source: 'Adani FY25-26 PO data + ProcMart supporting file + category structure' })]);
    await c.query(`INSERT INTO tenant_policies(tenant_id, arc_priority_over_direct, procmart_may_bid, thresholds) VALUES ($1, true, true, '{"minQuotes":3}')`, [T]);
    for (const l of ADANI_LEVELS) await c.query(`INSERT INTO org_level_types(tenant_id,key,label,rank) VALUES ($1,$2,$3,$4)`, [T, l.key, l.label, l.rank]);
    const roleId: Record<string, string> = {};
    for (const [key, r] of Object.entries(ROLE_PRESETS)) roleId[key] = (await c.query(`INSERT INTO roles(tenant_id,key,name,permissions) VALUES ($1,$2,$3,$4) RETURNING id`, [T, key, r.name, r.permissions])).rows[0].id;

    const org = parse(readFileSync(join(DATA, 'org.csv')), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
    const erp = new Map<string, string>();
    for (const s of [...new Set(org.map((r) => r.server))].sort()) {
      const id = randomUUID(); erp.set(s, id);
      await c.query(`INSERT INTO erp_systems(id,tenant_id,code,name,kind,config) VALUES ($1,$2,$3,$4,'mock-sap',$5)`, [id, T, `SAP-${s}`, `SAP server ${s}`, JSON.stringify({ note: 'Real server code from the PO data. No live SAP connection: PR/PO calls are simulated.' })]);
    }

    // ───────── org tree ─────────
    const group = randomUUID(); const nodes: any[][] = [[group, T, null, 'group', 'ADANI', 'Adani Group', null, 'import']];
    const bu = new Map<string, string>(), cc = new Map<string, string>(), plant = new Map<string, string>();
    for (const r of org) {
      if (!bu.has(r.BU)) { const id = randomUUID(); bu.set(r.BU, id); nodes.push([id, T, group, 'business', r.BU, r.BU, null, 'import']); }
      const ck = `${r.server}|${r['Company code']}`;
      if (!cc.has(ck)) { const id = randomUUID(); cc.set(ck, id); nodes.push([id, T, bu.get(r.BU), 'company_code', r['Company code'], title(r['Company name'] || r['Company code']), erp.get(r.server), 'import']); }
      const pk = `${r.server}|${r['Plant code']}`;
      if (!plant.has(pk)) { const id = randomUUID(); plant.set(pk, id); nodes.push([id, T, cc.get(ck), 'plant', r['Plant code'], `${r['Plant name']}${r.Location ? ' · ' + title(r.Location) : ''}`, erp.get(r.server), 'import']); }
    }
    await bulk(c, 'org_nodes', ['id', 'tenant_id', 'parent_id', 'level_type', 'code', 'name', 'erp_system_id', 'source'], ['uuid', 'uuid', 'uuid', 'text', 'text', 'text', 'uuid', 'text'], nodes);
    log('org', bu.size, 'BUs', cc.size, 'company codes', plant.size, 'plants');

    // ───────── taxonomy ─────────
    const tax = JSON.parse(readFileSync(join(DATA, 'taxonomy.json'), 'utf8')) as { category: string; sub: string; child: string; product: string; attrs: { name: string; unit: string | null; mandatory: boolean }[] }[];
    const tnode = new Map<string, string>(); const trows: any[][] = []; const ptAttrs = new Map<string, AttrSpec[]>(); const arows: any[][] = [];
    const node = (level: string, parts: string[], name: string, category: string, parent: string | null, syn: string[] = []) => {
      const path = parts.join(' > '); let id = tnode.get(path);
      if (!id) { id = randomUUID(); tnode.set(path, id); trows.push([id, T, parent, level, name, path, category, syn]); }
      return id;
    };
    const types: { id: string; name: string; category: string; sub: string; child: string; synonyms: string[] }[] = [];
    const childNode = new Map<string, string>();
    for (const t of tax) {
      const a = node('category', [t.category], t.category, t.category, null);
      const b = node('sub_category', [t.category, t.sub], t.sub, t.category, a);
      const ch = node('child_category', [t.category, t.sub, t.child], t.child, t.category, b); childNode.set(childKeyOf(t), ch);
      const syn = TYPE_SYNONYMS[words(t.product, { expand: false }).join(' ')] ?? [];
      const p = node('product_type', [t.category, t.sub, t.child, t.product], t.product, t.category, ch, syn);
      types.push({ id: p, name: t.product, category: t.category, sub: t.sub, child: t.child, synonyms: syn });
      const attrs = [...t.attrs].sort((x, y) => Number(y.mandatory) - Number(x.mandatory)).map((x, i) => ({ key: attrKey(x.name), label: title(x.name), unit: x.unit, required: x.mandatory, pos: i }));
      ptAttrs.set(p, attrs);
      for (const x of attrs) arows.push([randomUUID(), T, p, x.key, x.label, x.unit, x.required, x.pos]);
    }
    await bulk(c, 'taxonomy_nodes', ['id', 'tenant_id', 'parent_id', 'level', 'name', 'path', 'category'], ['uuid', 'uuid', 'uuid', 'text', 'text', 'text', 'text'], trows.map((r) => r.slice(0, 7)));
    for (const r of trows) if ((r[7] as string[]).length) await c.query(`UPDATE taxonomy_nodes SET synonyms=$2 WHERE id=$1`, [r[0], r[7]]);
    await bulk(c, 'product_type_attributes', ['id', 'tenant_id', 'product_type_id', 'key', 'label', 'unit', 'required', 'position'], ['uuid', 'uuid', 'uuid', 'text', 'text', 'text', 'boolean', 'int'], arows, 'ON CONFLICT DO NOTHING');
    log('taxonomy', trows.length, 'nodes,', types.length, 'product types,', arows.length, 'attributes');
    let V: number[][] = [];
    if (embeddingsEnabled()) {
      V = await embed(types.map(typeText));
      for (let i = 0; i < types.length; i += 500)
        await c.query(`UPDATE taxonomy_nodes t SET embedding = v.e::vector FROM unnest($1::uuid[], $2::text[]) AS v(id, e) WHERE t.id = v.id`, [types.slice(i, i + 500).map((t) => t.id), V.slice(i, i + 500).map(toPgVector)]);
      log('product types embedded');
    }

    // ───────── catalogue ─────────
    const idx = buildTypeIndex(types);
    const typeById = new Map(types.map((t, i) => [t.id, { ...t, i }]));
    const items: any[] = [];
    // clean.py's output (tidied names, part numbers, makes) when it has been run; the raw extract otherwise
    const itemsFile = existsSync(join(DATA, 'items.clean.jsonl')) ? 'items.clean.jsonl' : 'items.jsonl';
    log('items from', itemsFile);
    for await (const line of createInterface({ input: createReadStream(join(DATA, itemsFile)) })) if (line.trim()) items.push(JSON.parse(line));
    const unplaced: number[] = [];
    const placed = items.map((it, i) => {
      const k = classify(idx, it.name, { category: it.pm_category });
      if (!k) unplaced.push(i);
      return k ? { node: k.typeId ?? childNode.get(k.childKey!)!, typeId: k.typeId, basis: k.basis, score: k.score, matched: k.matched } : null;
    });
    if (SEMANTIC && unplaced.length) {
      log('semantic pass for', unplaced.length, 'items the rules could not place');
      const qv = await embed(unplaced.map((i) => `${items[i].name} ${items[i].description.slice(0, 120)}`), 128);
      let n = 0;
      unplaced.forEach((i, j) => {
        let best = -1, bi = -1; for (let t = 0; t < V.length; t++) { let s = 0; const a = qv[j], b = V[t]; for (let d = 0; d < a.length; d++) s += a[d] * b[d]; if (s > best) { best = s; bi = t; } }
        if (best >= 0.82) { placed[i] = { node: types[bi].id, typeId: types[bi].id, basis: 'semantic', score: Math.round(best * 1000) / 1000, matched: types[bi].name }; n++; }
      });
      log('semantic placed', n);
    }
    const itemId = new Map<string, string>(); const irows: any[][] = []; const crows: any[][] = []; const seenCode = new Set<string>();
    for (const [i, it] of items.entries()) {
      const id = randomUUID(); itemId.set(it.key, id);
      const p = placed[i]; const pt = p?.typeId ? typeById.get(p.typeId) : undefined;
      const childTypes = p && !p.typeId ? types.filter((t) => childNode.get(childKeyOf(t)) === p.node) : [];
      const category = pt?.category ?? childTypes[0]?.category ?? (it.pm_category || null);
      const specs = pt ? extractSpecs(`${it.name} ${it.description}`, ptAttrs.get(pt.id)!, it.mpn) : {};
      const kw = [...new Set([...words(it.name, { expand: true }), ...(it.raw_name ? words(it.raw_name, { expand: true }) : []), ...(pt ? words(pt.name, { expand: false }) : []), ...(pt?.synonyms ?? []).flatMap((s) => words(s)),
        ...(p && !p.typeId ? [p.matched] : []), ...(pt ? words(pt.child, { expand: false }) : [])])].join(' ');
      irows.push([id, T, it.name.slice(0, 300), it.description, it.brand || null, it.brand || null, it.mpn || null, (it.uom || 'EA').slice(0, 10), category, JSON.stringify(specs),
        it.serviceability || null, 'active', p?.node ?? null, JSON.stringify(p ? { basis: p.basis, score: p.score, matched: p.matched } : { basis: 'none' }), kw,
        it.spend_head || null, it.spend_category || null, it.capex_opex || null, it.pricing || null, it.rrs || null, it.material_group || null, it.po_lines, it.plant_count, it.last_po || null]);
      for (const [server, mat] of it.codes) { const e = erp.get(server); const ck = `${server}|${mat}`; if (e && !seenCode.has(ck)) { seenCode.add(ck); crows.push([randomUUID(), T, id, e, mat]); } }
    }
    await bulk(c, 'catalogue_items', ['id', 'tenant_id', 'name', 'description', 'manufacturer', 'brand', 'mpn', 'uom', 'category', 'specs', 'procmart_serviceability', 'status', 'product_type_id', 'classification', 'keywords',
      'spend_head', 'spend_category', 'capex_opex', 'pricing_mechanism', 'rrs_class', 'material_group', 'po_lines', 'plant_count', 'last_po_date'],
      ['uuid', 'uuid', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'jsonb', 'text', 'text', 'uuid', 'jsonb', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'int', 'int', 'date'], irows);
    await bulk(c, 'item_erp_codes', ['id', 'tenant_id', 'item_id', 'erp_system_id', 'material_code'], ['uuid', 'uuid', 'uuid', 'uuid', 'text'], crows);
    const nType = placed.filter((p) => p?.typeId).length, nChild = placed.filter((p) => p && !p.typeId).length;
    log('items', irows.length, `(product type ${nType}, child category only ${nChild}, unplaced ${irows.length - nType - nChild})`, 'material codes', crows.length);
    await c.query(`UPDATE taxonomy_nodes t SET item_count = x.n FROM (SELECT product_type_id, count(*) n FROM catalogue_items WHERE tenant_id=$1 GROUP BY 1) x WHERE t.id = x.product_type_id`, [T]);

    // ───────── suppliers, ARCs, PO history ─────────
    const po = parse(readFileSync(join(DATA, 'po.csv')), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
    const sup = new Map<string, string>(); const srows: any[][] = []; const scrows: any[][] = [];
    for (const r of po) {
      const k = `${r.server}|${r['Vendor code']}`; if (!r['Vendor code'] || sup.has(k) || !erp.get(r.server)) continue;
      const id = randomUUID(); sup.set(k, id);
      srows.push([id, T, `Vendor ${r['Vendor code']} (SAP ${r.server})`, 'active']); scrows.push([randomUUID(), T, id, erp.get(r.server), r['Vendor code']]);
    }
    await bulk(c, 'suppliers', ['id', 'tenant_id', 'legal_name', 'status'], ['uuid', 'uuid', 'text', 'text'], srows);
    await bulk(c, 'supplier_erp_codes', ['id', 'tenant_id', 'supplier_id', 'erp_system_id', 'vendor_code'], ['uuid', 'uuid', 'uuid', 'uuid', 'text'], scrows);
    log('suppliers', srows.length);

    const arcs = new Map<string, { id: string; server: string; vendor: string; from: string; to: string; lines: Map<string, { uom: string; qty: number; pos: Set<string>; plants: Set<string>; mat: string }> }>();
    for (const r of po) {
      if (r['ARC/ Non ARC'] !== 'ARC' || !sup.get(`${r.server}|${r['Vendor code']}`)) continue;
      const k = `${r.server}|${r['Vendor code']}|${r['Validitiy start date']}|${r['Validity end date']}`;
      let a = arcs.get(k); if (!a) arcs.set(k, a = { id: randomUUID(), server: r.server, vendor: r['Vendor code'], from: r['Validitiy start date'], to: r['Validity end date'], lines: new Map() });
      let l = a.lines.get(r.ikey); if (!l) a.lines.set(r.ikey, l = { uom: r.UoM, qty: 0, pos: new Set(), plants: new Set(), mat: r.mat });
      l.qty += Number(r.Quantity) || 0; l.pos.add(`${r['Purchasing document number']}/${r['Purchasing document item']}`); l.plants.add(r['Plant code']);
    }
    const ctrows: any[][] = []; const clrows: any[][] = [];
    for (const a of arcs.values()) {
      const live = !a.to || a.to >= TODAY;
      ctrows.push([a.id, T, 'ARC', `ARC-${a.server}-${a.vendor}-${(a.from || 'open').replace(/-/g, '')}`, sup.get(`${a.server}|${a.vendor}`), erp.get(a.server), a.from || null, a.to || null, live ? 'published' : 'expired', new Date().toISOString()]);
      let n = 0;
      for (const [ikey, l] of a.lines) {
        const item = itemId.get(ikey); if (!item) continue;
        clrows.push([randomUUID(), T, a.id, ++n, JSON.stringify({ purchaseOrders: [...l.pos].slice(0, 20), plants: [...l.plants], qtyOrdered: l.qty }), `PO ${[...l.pos][0]}`,
          null, null, null, null, l.mat || null, l.uom || null, null, 'INR', 'published', item]);
      }
    }
    await bulk(c, 'contracts', ['id', 'tenant_id', 'contract_type', 'number', 'supplier_id', 'erp_system_id', 'valid_from', 'valid_to', 'status', 'published_at'], ['uuid', 'uuid', 'text', 'text', 'uuid', 'uuid', 'date', 'date', 'text', 'timestamptz'], ctrows);
    await bulk(c, 'contract_lines', ['id', 'tenant_id', 'contract_id', 'line_no', 'raw', 'source_ref', 'description', 'supplier_item_code', 'mpn', 'brand', 'material_code', 'uom', 'base_price', 'currency', 'status', 'item_id'],
      ['uuid', 'uuid', 'uuid', 'int', 'jsonb', 'text', 'text', 'text', 'text', 'text', 'text', 'text', 'numeric', 'text', 'text', 'uuid'], clrows);
    // description/mpn/brand come from the linked item
    await c.query(`UPDATE contract_lines cl SET description = i.name, mpn = i.mpn, brand = i.brand FROM catalogue_items i WHERE i.id = cl.item_id AND cl.tenant_id = $1`, [T]);
    log('ARCs', ctrows.length, `(${ctrows.filter((r) => r[8] === 'published').length} valid today)`, 'lines', clrows.length);

    const prows: any[][] = [];
    for (const r of po) {
      const pl = plant.get(`${r.server}|${r['Plant code']}`); if (!pl || !r['Purchasing Document date']) continue;
      const qty = Number(r.Quantity); if (!Number.isFinite(qty)) continue;
      prows.push([randomUUID(), T, 'adani_po_fy25_26', r['Purchasing document number'], r['Purchasing Document date'], pl, itemId.get(r.ikey) ?? null, r.mat || null, r['Vendor code'] || null,
        sup.get(`${r.server}|${r['Vendor code']}`) ?? null, qty, r.UoM || null, r['Purchasing document item'] || null, r['ARC/ Non ARC'] === 'ARC', r['Validitiy start date'] || null, r['Validity end date'] || null, r['Purchase requisition number'] || null, r['Spend Category'] || null]);
    }
    await bulk(c, 'po_history', ['id', 'tenant_id', 'source', 'po_number', 'po_date', 'plant_node_id', 'item_id', 'material_code', 'vendor_code', 'supplier_id', 'qty', 'uom', 'po_item', 'arc', 'valid_from', 'valid_to', 'pr_number', 'spend_category'],
      ['uuid', 'uuid', 'text', 'text', 'date', 'uuid', 'uuid', 'text', 'text', 'uuid', 'numeric', 'text', 'text', 'boolean', 'date', 'date', 'text', 'text'], prows);
    log('PO history lines', prows.length);

    // ───────── users ─────────
    const busiest = (await c.query(`SELECT plant_node_id, n.name, count(*) FROM po_history p JOIN org_nodes n ON n.id=p.plant_node_id WHERE p.tenant_id=$1 GROUP BY 1,2 ORDER BY 3 DESC LIMIT 1`, [T])).rows[0];
    const accounts: [string, string, string, string | null][] = [
      ['admin@adani.monosource', 'Adani administrator', 'customer_admin', null], ['central@adani.monosource', 'Central procurement', 'central_procurement', null],
      ['requester@adani.monosource', `Requester · ${busiest.name}`, 'requester', busiest.plant_node_id], ['plantproc@adani.monosource', `Plant procurement · ${busiest.name}`, 'plant_procurement', busiest.plant_node_id],
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
    log('analyzing (fresh statistics keep search fast)'); await c.query('ANALYZE');
    log('done. Accounts in', join(DATA, 'accounts.txt'));
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { await c.end(); }
})().catch((e) => { console.error(e); process.exit(1); });
