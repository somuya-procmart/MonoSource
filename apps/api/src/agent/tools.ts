import { PoolClient } from 'pg';
import { Ctx, canAtNode, visibleNodeIds } from '../common/security';
import { searchCatalogue, taxonomyFor } from '../catalogue/search';
import { embedQuery, toPgVector } from '../catalogue/embed';
import { understandQuery } from '../catalogue/taxonomy';

/**
 * Catalogue / taxonomy / ARC / purchase-history tools. One definition, two consumers:
 *   - the MCP server at POST /mcp (Claude Desktop, Claude Code, any MCP client)
 *   - the Ask MonoSource agent (any OpenAI-compatible LLM: Gemini, Groq, OpenRouter, Ollama…)
 * All read-only. Every call runs inside the caller's tenant transaction, so row-level security applies, and plant
 * arguments are checked against the caller's scope. Outputs are compact on purpose (LLM context is expensive).
 */
export interface ToolDef {
  name: string; title: string; description: string;
  inputSchema: { type: 'object'; properties: Record<string, any>; required?: string[]; additionalProperties?: boolean };
  run: (c: PoolClient, ctx: Ctx, args: any) => Promise<any>;
}

const isId = (s: any) => typeof s === 'string' && /^[0-9a-f-]{36}$/.test(s);
const titleCase = (s: string) => String(s ?? '').toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase()).replace(/\b(Mcb|Mccb|Rccb|Led|Ups|Plc|Vfd|Hrc|Pvc|Xlpe|Sap|Arc)\b/g, (m) => m.toUpperCase());
const clamp = (n: any, lo: number, hi: number, d: number) => Math.max(lo, Math.min(hi, Number.isFinite(Number(n)) ? Number(n) : d));
const today = () => new Date().toISOString().slice(0, 10);

async function checkPlant(c: PoolClient, ctx: Ctx, plantId?: string) {
  if (!plantId) return null;
  if (!isId(plantId)) throw new Error('plant_id must be a plant id from list_plants');
  if (!(await canAtNode(c, ctx, 'catalogue:read', plantId))) throw new Error('That plant is not in your scope');
  return (await c.query(`SELECT n.id, n.name, n.code, e.code AS server, n.erp_system_id FROM org_nodes n LEFT JOIN erp_systems e ON e.id=n.erp_system_id WHERE n.id=$1`, [plantId])).rows[0] ?? null;
}

/** Live ARCs per item; with a plant, whether its supplier has a vendor code on that plant's SAP server (needed to order). */
async function liveArcs(c: PoolClient, itemIds: string[], plantErp?: string | null) {
  if (!itemIds.length) return new Map<string, any[]>();
  const rows = (await c.query(
    `SELECT cl.item_id, ct.id AS contract_id, ct.number, ct.contract_type AS type, s.legal_name AS supplier, ct.valid_from, ct.valid_to, cl.net_price, cl.uom,
            e.code AS server, ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM supplier_erp_codes sc WHERE sc.supplier_id=ct.supplier_id AND sc.erp_system_id=$2)) AS orderable_here
       FROM contract_lines cl JOIN contracts ct ON ct.id=cl.contract_id LEFT JOIN suppliers s ON s.id=ct.supplier_id LEFT JOIN erp_systems e ON e.id=ct.erp_system_id
      WHERE cl.item_id = ANY($1::uuid[]) AND cl.status='published' AND ct.status='published'
        AND (ct.valid_from IS NULL OR ct.valid_from <= current_date) AND (ct.valid_to IS NULL OR ct.valid_to >= current_date)
      ORDER BY ct.valid_to NULLS LAST`, [itemIds, plantErp ?? null])).rows;
  const m = new Map<string, any[]>();
  for (const r of rows) (m.get(r.item_id) ?? m.set(r.item_id, []).get(r.item_id)!).push({
    arc: r.number, supplier: r.supplier, valid: `${r.valid_from ?? '…'} to ${r.valid_to ?? 'open'}`, rate: r.net_price == null ? 'in SAP' : `${r.net_price}/${r.uom}`, server: r.server,
    ...(plantErp ? { orderableAtPlant: r.orderable_here } : {}) });
  return m;
}

export const TOOLS: ToolDef[] = [
  {
    name: 'search_products', title: 'Search the catalogue',
    description: 'Find catalogue items for a need described in words, a spec, a SAP material code or a part number. Understands SAP abbreviations (BRG, VLV, CBL…), sizes (32A, 16 sqmm, 65mm) and plain English ("something to cut grass"). Returns the best items with product type, SAP codes, live group ARCs and how often the group buys them. Use product_type_id (from browse_taxonomy or a previous result) to restrict to one kind of product.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: 'What is needed, as the user said it or refined (e.g. "MCB 32A 2 pole", "LT power cable 4C 16 sqmm Al")' },
      product_type_id: { type: 'string', description: 'Optional taxonomy node id to restrict results to' },
      plant_id: { type: 'string', description: 'Optional plant id: ARCs then say whether they can be ordered at that plant' },
      limit: { type: 'number', description: '1-25, default 10' } }, required: ['query'], additionalProperties: false },
    async run(c, ctx, a) {
      const plant = await checkPlant(c, ctx, a.plant_id);
      const r = await searchCatalogue(c, String(a.query ?? '').slice(0, 300), { limit: clamp(a.limit, 1, 25, 10), typeIds: isId(a.product_type_id) ? [a.product_type_id] : undefined });
      const ids = r.hits.map((h) => h.id);
      const rows = ids.length ? (await c.query(`SELECT i.id, i.name, i.brand, i.mpn, i.uom, i.category, i.specs, i.po_lines, i.plant_count, i.last_po_date, i.procmart_serviceability, t.name AS type, t.level,
          (SELECT string_agg(e.code || ':' || ic.material_code, ', ') FROM item_erp_codes ic JOIN erp_systems e ON e.id=ic.erp_system_id WHERE ic.item_id=i.id) AS codes
          FROM catalogue_items i LEFT JOIN taxonomy_nodes t ON t.id=i.product_type_id WHERE i.id = ANY($1::uuid[])`, [ids])).rows : [];
      const arcs = await liveArcs(c, ids, plant?.erp_system_id);
      return {
        understood: { thing: r.understanding.head, category: r.understanding.categoryHint, sizes: r.understanding.specs },
        productTypes: r.types.slice(0, 6).map((t) => ({ id: t.id, name: titleCase(t.name), matches: t.count })),
        total: r.total,
        items: r.hits.map((h) => { const x = rows.find((y) => y.id === h.id); return x && {
          item_id: x.id, name: x.name, type: x.type ? titleCase(x.type) + (x.level === 'product_type' ? '' : ' (kind)') : null, brand: x.brand, part_no: x.mpn, uom: x.uom,
          specs: Object.keys(x.specs ?? {}).length ? x.specs : undefined, sap_codes: x.codes, bought: x.po_lines ? `${x.po_lines} PO lines at ${x.plant_count} plants, last ${x.last_po_date}` : 'not in FY25-26 POs',
          procmart: x.procmart_serviceability ?? undefined, live_arcs: arcs.get(x.id) ?? [] }; }).filter(Boolean),
      };
    },
  },
  {
    name: 'get_product', title: 'Product details',
    description: 'Everything about one catalogue item: description, specs, the attributes its product type should have (required ones first, with which are unknown), SAP material codes per server, live ARCs, ProcMart serviceability and a purchase summary.',
    inputSchema: { type: 'object', properties: { item_id: { type: 'string' }, plant_id: { type: 'string' } }, required: ['item_id'], additionalProperties: false },
    async run(c, ctx, a) {
      if (!isId(a.item_id)) throw new Error('item_id must be an id from search_products');
      const plant = await checkPlant(c, ctx, a.plant_id);
      const it = (await c.query(`SELECT i.*, t.name AS type, t.path AS type_path, t.level FROM catalogue_items i LEFT JOIN taxonomy_nodes t ON t.id=i.product_type_id WHERE i.id=$1`, [a.item_id])).rows[0];
      if (!it) throw new Error('No such item');
      const attrs = it.product_type_id ? (await c.query(`SELECT key, label, unit, required FROM product_type_attributes WHERE product_type_id=$1 ORDER BY position`, [it.product_type_id])).rows : [];
      const codes = (await c.query(`SELECT e.code AS server, ic.material_code AS code FROM item_erp_codes ic JOIN erp_systems e ON e.id=ic.erp_system_id WHERE ic.item_id=$1`, [it.id])).rows;
      const po = (await c.query(`SELECT count(*)::int AS lines, sum(qty)::float AS qty, max(po_date) AS last, count(DISTINCT plant_node_id)::int AS plants, round(100.0*avg(arc::int))::int AS arc_pct FROM po_history WHERE item_id=$1`, [it.id])).rows[0];
      return {
        item_id: it.id, name: it.name, description: it.description?.slice(0, 600) || undefined, brand: it.brand, part_no: it.mpn, uom: it.uom,
        product_type: it.type_path ?? null, classified_by: it.classification?.basis,
        attributes: attrs.map((x) => ({ attribute: x.label + (x.unit ? ` (${x.unit})` : ''), required: x.required, value: it.specs?.[x.key] ?? 'unknown' })),
        sap_codes: codes, procmart_serviceability: it.procmart_serviceability, spend: [it.spend_head, it.spend_category].filter(Boolean).join(' / ') || undefined,
        live_arcs: (await liveArcs(c, [it.id], plant?.erp_system_id)).get(it.id) ?? [],
        purchases_fy25_26: po.lines ? { po_lines: po.lines, total_qty: po.qty, plants: po.plants, last: po.last, on_arc_pct: po.arc_pct } : 'none',
      };
    },
  },
  {
    name: 'find_arcs', title: 'Find ARCs',
    description: 'Find group ARCs (annual rate contracts). ARCs are group-level: a live ARC applies at every plant; ordering also needs the vendor to have a code on the plant\'s SAP server. Search by what is covered (query), by item_id, or by vendor_code. Returns contracts with validity, vendor and the covered items.',
    inputSchema: { type: 'object', properties: {
      query: { type: 'string', description: 'Item description or need, e.g. "safety shoes"' }, item_id: { type: 'string' }, vendor_code: { type: 'string' },
      include_expired: { type: 'boolean', description: 'Also return expired ARCs (default false)' }, plant_id: { type: 'string' }, limit: { type: 'number', description: '1-20, default 8' } }, additionalProperties: false },
    async run(c, ctx, a) {
      const plant = await checkPlant(c, ctx, a.plant_id);
      let itemIds: string[] = [];
      if (isId(a.item_id)) itemIds = [a.item_id];
      else if (a.query) itemIds = (await searchCatalogue(c, String(a.query).slice(0, 300), { limit: 200 })).hits.map((h) => h.id);
      if (!itemIds.length && !a.vendor_code) return { contracts: [], note: 'Give a query, item_id or vendor_code.' };
      const rows = (await c.query(
        `SELECT ct.id, ct.number, ct.status, ct.valid_from, ct.valid_to, s.legal_name AS supplier, e.code AS server,
                ($4::uuid IS NULL OR EXISTS (SELECT 1 FROM supplier_erp_codes sc WHERE sc.supplier_id=ct.supplier_id AND sc.erp_system_id=$4)) AS orderable_here,
                count(cl.id)::int AS lines, json_agg(json_build_object('item_id', cl.item_id, 'item', cl.description, 'uom', cl.uom) ORDER BY cl.line_no) FILTER (WHERE cl.item_id = ANY($1::uuid[]) OR cardinality($1::uuid[]) = 0) AS matched
           FROM contracts ct JOIN contract_lines cl ON cl.contract_id=ct.id LEFT JOIN suppliers s ON s.id=ct.supplier_id LEFT JOIN erp_systems e ON e.id=ct.erp_system_id
           LEFT JOIN supplier_erp_codes v ON v.supplier_id=ct.supplier_id
          WHERE ct.contract_type IN ('ARC','QRC') AND (cardinality($1::uuid[]) = 0 OR cl.item_id = ANY($1::uuid[]) OR EXISTS (SELECT 1 FROM contract_lines z WHERE z.contract_id=ct.id AND z.item_id = ANY($1::uuid[])))
            AND ($2::text IS NULL OR v.vendor_code = $2) AND ($3 OR (ct.status='published' AND (ct.valid_to IS NULL OR ct.valid_to >= current_date)))
          GROUP BY ct.id, s.legal_name, e.code ORDER BY (ct.status='published') DESC, ct.valid_to DESC NULLS FIRST LIMIT $5`,
        [itemIds, a.vendor_code ? String(a.vendor_code) : null, a.include_expired === true, plant?.erp_system_id ?? null, clamp(a.limit, 1, 20, 8)])).rows;
      return {
        rule: 'Group-level ARC: a live ARC applies at every plant. If one exists, the order goes to it.',
        contracts: rows.map((r) => ({ arc: r.number, contract_id: r.id, status: r.status === 'published' ? 'live' : r.status, valid: `${r.valid_from ?? '…'} to ${r.valid_to ?? 'open'}`, supplier: r.supplier, sap_server: r.server,
          ...(plant ? { orderable_at_plant: r.orderable_here } : {}), total_lines: r.lines, covers: (r.matched ?? []).slice(0, 8), rates: 'held in SAP (not in the imported data)' })),
      };
    },
  },
  {
    name: 'browse_taxonomy', title: 'Browse product types',
    description: 'ProcMart category structure (category > sub category > child category > product type). With query: the product types that match it (by words and by meaning), with item counts. With node_id: that node\'s children. With neither: the top-level categories. Use it to pick the right kind of product before searching, or to offer the user a choice of kinds.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, node_id: { type: 'string' }, limit: { type: 'number', description: '1-30, default 12' } }, additionalProperties: false },
    async run(c, _ctx, a) {
      const lim = clamp(a.limit, 1, 30, 12);
      const shape = (r: any) => ({ id: r.id, name: titleCase(r.name), level: r.level, path: r.path, items: r.item_count ?? undefined });
      if (isId(a.node_id)) return { children: (await c.query(`SELECT id, name, level, path, item_count FROM taxonomy_nodes WHERE parent_id=$1 ORDER BY item_count DESC, name LIMIT $2`, [a.node_id, lim * 3])).rows.map(shape) };
      if (!a.query) return { categories: (await c.query(`SELECT id, name, level, path FROM taxonomy_nodes WHERE level='category' ORDER BY name`)).rows.map(shape) };
      const tax = await taxonomyFor(c);
      const u = understandQuery(tax.idx, String(a.query), tax.categories);
      const scores = new Map(u.typeScores);
      const qv = await embedQuery(String(a.query));
      if (qv) for (const r of (await c.query(`SELECT id, 1 - (embedding <=> $1::vector) AS sim FROM taxonomy_nodes WHERE level='product_type' AND embedding IS NOT NULL ORDER BY embedding <=> $1::vector LIMIT 15`, [toPgVector(qv)])).rows)
        scores.set(r.id, Math.max(scores.get(r.id) ?? 0, (r.sim - 0.7) * 3));
      const ids = [...scores].sort((x, y) => y[1] - x[1]).slice(0, lim).map(([k]) => k);
      const rows = (await c.query(`SELECT t.id, t.name, t.level, t.path, t.item_count, (SELECT string_agg(label, ', ' ORDER BY position) FROM product_type_attributes p WHERE p.product_type_id=t.id AND p.required) AS required FROM taxonomy_nodes t WHERE t.id = ANY($1::uuid[])`, [ids])).rows;
      return { productTypes: ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean).map((r) => ({ ...shape(r), required_attributes: r.required ?? undefined })) };
    },
  },
  {
    name: 'get_product_type', title: 'Product type attributes',
    description: 'The attributes a product type has (required first, with units) and the values actually seen on catalogue items of that type with counts. Use it to know what to ask the user (e.g. MCB: current rating, poles, breaking capacity).',
    inputSchema: { type: 'object', properties: { product_type_id: { type: 'string' } }, required: ['product_type_id'], additionalProperties: false },
    async run(c, _ctx, a) {
      if (!isId(a.product_type_id)) throw new Error('product_type_id must come from browse_taxonomy or search_products');
      const t = (await c.query(`SELECT id, name, path, item_count FROM taxonomy_nodes WHERE id=$1`, [a.product_type_id])).rows[0]; if (!t) throw new Error('No such product type');
      const attrs = (await c.query(`SELECT key, label, unit, required FROM product_type_attributes WHERE product_type_id=$1 ORDER BY position`, [t.id])).rows;
      const vals = (await c.query(`SELECT e.key, e.value, count(*)::int n FROM catalogue_items i, jsonb_each_text(i.specs) e WHERE i.product_type_id=$1 GROUP BY 1,2 ORDER BY 3 DESC`, [t.id])).rows;
      const brands = (await c.query(`SELECT brand, count(*)::int n FROM catalogue_items WHERE product_type_id=$1 AND brand IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 8`, [t.id])).rows;
      return { product_type: t.path, items: t.item_count,
        attributes: attrs.map((x) => ({ key: x.key, attribute: x.label + (x.unit ? ` (${x.unit})` : ''), required: x.required, seen_values: vals.filter((v) => v.key === x.key).slice(0, 8).map((v) => `${v.value} (${v.n})`) })),
        brands: brands.map((b) => `${b.brand} (${b.n})`) };
    },
  },
  {
    name: 'purchase_history', title: 'Purchase history',
    description: 'FY25-26 purchase-order history from the group\'s SAP data. For an item_id or a query, optionally one plant: PO lines, quantities, vendors, plants and how much went through ARCs. Use it to tell the user who buys this, from whom, and whether it is usually on ARC.',
    inputSchema: { type: 'object', properties: { item_id: { type: 'string' }, query: { type: 'string' }, plant_id: { type: 'string' }, limit: { type: 'number', description: 'recent lines to show, 1-20, default 8' } }, additionalProperties: false },
    async run(c, ctx, a) {
      const plant = await checkPlant(c, ctx, a.plant_id);
      const vis = await visibleNodeIds(c, ctx, 'catalogue:read');
      let ids: string[] = isId(a.item_id) ? [a.item_id] : a.query ? (await searchCatalogue(c, String(a.query), { limit: 30 })).hits.map((h) => h.id) : [];
      if (!ids.length) return { note: 'Give an item_id or a query.' };
      const where = `p.item_id = ANY($1::uuid[]) AND ($2::uuid IS NULL OR p.plant_node_id=$2) AND ($3::uuid[] IS NULL OR p.plant_node_id = ANY($3))`;
      const args = [ids, plant?.id ?? null, vis];
      const sum = (await c.query(`SELECT count(*)::int lines, count(DISTINCT p.plant_node_id)::int plants, count(DISTINCT p.supplier_id)::int vendors, round(100.0*avg(p.arc::int))::int arc_pct, min(p.po_date) first, max(p.po_date) last FROM po_history p WHERE ${where}`, args)).rows[0];
      const byPlant = (await c.query(`SELECT n.name, count(*)::int n, sum(p.qty)::float qty, max(p.uom) uom FROM po_history p JOIN org_nodes n ON n.id=p.plant_node_id WHERE ${where} GROUP BY n.name ORDER BY 2 DESC LIMIT 6`, args)).rows;
      const byVendor = (await c.query(`SELECT s.legal_name, count(*)::int n, bool_or(p.arc) arc FROM po_history p JOIN suppliers s ON s.id=p.supplier_id WHERE ${where} GROUP BY 1 ORDER BY 2 DESC LIMIT 6`, args)).rows;
      const recent = (await c.query(`SELECT p.po_number, p.po_date, n.name AS plant, i.name AS item, p.qty::float, p.uom, p.arc FROM po_history p JOIN org_nodes n ON n.id=p.plant_node_id LEFT JOIN catalogue_items i ON i.id=p.item_id WHERE ${where} ORDER BY p.po_date DESC LIMIT $4`, [...args, clamp(a.limit, 1, 20, 8)])).rows;
      return { summary: sum, top_plants: byPlant.map((r) => `${r.name}: ${r.n} lines, ${r.qty} ${r.uom}`), top_vendors: byVendor.map((r) => `${r.legal_name}: ${r.n} lines${r.arc ? ' (incl. ARC)' : ''}`),
        recent: recent.map((r) => `${r.po_date} PO ${r.po_number} · ${r.plant} · ${r.qty} ${r.uom} ${r.item ?? ''}${r.arc ? ' · ARC' : ''}`), prices: 'not in the imported data' };
    },
  },
  {
    name: 'list_plants', title: 'Find plants',
    description: 'Find plants (and their BU, company code and SAP server) the user can buy for. Query by plant name, code, location, company or BU.',
    inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number', description: '1-30, default 10' } }, additionalProperties: false },
    async run(c, ctx, a) {
      const vis = await visibleNodeIds(c, ctx, 'catalogue:read');
      const like = `%${String(a.query ?? '').toLowerCase().replace(/[%_\\]/g, '')}%`;
      const rows = (await c.query(
        `SELECT p.id, p.code, p.name, cc.name AS company, cc.code AS company_code, bu.name AS bu, e.code AS server,
                (SELECT count(*)::int FROM po_history h WHERE h.plant_node_id=p.id) AS po_lines
           FROM org_nodes p LEFT JOIN org_nodes cc ON cc.id=p.parent_id LEFT JOIN org_nodes bu ON bu.id=cc.parent_id LEFT JOIN erp_systems e ON e.id=p.erp_system_id
          WHERE p.level_type='plant' AND ($1::uuid[] IS NULL OR p.id = ANY($1)) AND lower(p.name || ' ' || p.code || ' ' || coalesce(cc.name,'') || ' ' || coalesce(bu.name,'')) LIKE $2
          ORDER BY po_lines DESC LIMIT $3`, [vis, like, clamp(a.limit, 1, 30, 10)])).rows;
      return { plants: rows.map((r) => ({ plant_id: r.id, plant: `${r.code} ${r.name}`, company: `${r.company_code} ${r.company}`, bu: r.bu, sap_server: r.server, po_lines_fy25_26: r.po_lines })) };
    },
  },
  {
    name: 'catalogue_overview', title: 'Catalogue overview',
    description: 'Size and shape of the catalogue and the data behind it: items, product types, plants, ARCs (live/expired), PO lines and where the data comes from. Use when the user asks what MonoSource knows.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run(c) {
      const r = (await c.query(`SELECT (SELECT count(*) FROM catalogue_items)::int items, (SELECT count(*) FROM catalogue_items WHERE product_type_id IS NOT NULL)::int classified,
        (SELECT count(*) FROM taxonomy_nodes WHERE level='product_type')::int product_types, (SELECT count(*) FROM org_nodes WHERE level_type='plant')::int plants,
        (SELECT count(*) FROM contracts WHERE contract_type='ARC' AND status='published' AND (valid_to IS NULL OR valid_to >= current_date))::int live_arcs,
        (SELECT count(*) FROM contracts WHERE contract_type='ARC')::int all_arcs, (SELECT count(*) FROM po_history)::int po_lines, (SELECT config FROM tenants LIMIT 1) AS config`)).rows[0];
      return { ...r, as_of: today(), notes: ['No prices are in the imported data; ARC rates are held in SAP.', 'Vendor names are not in the data; vendors show as their SAP vendor code.', 'SAP is not connected live: PR/PO creation is simulated.'] };
    },
  },
];

export const toolByName = new Map(TOOLS.map((t) => [t.name, t]));
