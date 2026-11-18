import { PoolClient } from 'pg';
import { norm } from '../buying/ask';

/**
 * Source-of-supply determination for an item at a plant — the heart of MonoSource.
 * Mirrors SAP's "valid contract before anything else" logic but looks ACROSS THE GROUP, so a contract that exists
 * for another plant is surfaced honestly (never as orderable). Cases (see docs/ux/REDIRECTION-RESEARCH-AND-DESIGN.md):
 *  A on contract at your plant · B contract elsewhere in the group · D known supplier, no applicable contract · E no known source.
 *  C (several suppliers) is A with multiple=true. F (alternatives) is reported separately.
 */
export type SourceCase = 'A' | 'B' | 'D' | 'E';
export interface Supply {
  contractLineId: string; contractId: string; type: string; number: string; supplierId: string; supplier: string;
  netPrice: number; uom: string; moq: number | null; qtyCap: number | null; balance: number | null; validFrom: string | null; validTo: string | null; daysLeft: number | null;
  appliesTo: string[]; appliesToPlant: boolean | null; orderable: boolean | null; blockedReason: string | null;
}
export interface SourceView {
  case: SourceCase; multiple: boolean; supplies: Supply[]; elsewhere: Supply[]; knownSuppliers: { id: string | null; name: string; why: string }[];
  alternatives: { approved: number; suggested: number }; request: { id: string; status: string } | null; lowestPrice: number | null;
}
const today = () => new Date().toISOString().slice(0, 10);

export async function computeSources(c: PoolClient, itemIds: string[], plantId: string | null, userId?: string): Promise<Map<string, SourceView>> {
  const out = new Map<string, SourceView>();
  if (!itemIds.length) return out;
  const rows = (await c.query(
    `SELECT cl.item_id, cl.id AS "contractLineId", ct.id AS "contractId", ct.contract_type AS type, ct.number, ct.supplier_id AS "supplierId", s.legal_name AS supplier,
            cl.net_price::float AS "netPrice", cl.uom, cl.moq::float AS moq, cl.qty_cap::float AS "qtyCap", ct.valid_from AS "validFrom", ct.valid_to AS "validTo",
            coalesce((SELECT sum(rl.qty) FROM requirement_lines rl WHERE rl.contract_line_id=cl.id),0)::float AS used,
            coalesce((SELECT json_agg(n.name ORDER BY n.name) FROM contract_scopes cs JOIN org_nodes n ON n.id=cs.node_id WHERE cs.contract_id=ct.id),'[]') AS "appliesTo"
       FROM contract_lines cl JOIN contracts ct ON ct.id=cl.contract_id LEFT JOIN suppliers s ON s.id=ct.supplier_id
      WHERE cl.item_id = ANY($1::uuid[]) AND cl.status='published' AND ct.status='published' AND ct.contract_type IN ('ARC','QRC')
        AND (ct.valid_from IS NULL OR ct.valid_from <= current_date) AND (ct.valid_to IS NULL OR ct.valid_to >= current_date)`, [itemIds])).rows;
  const applicable = new Set<string>();
  let vendorOk: Set<string> | null = null; let plantCategorySuppliers = new Map<string, Set<string>>();
  // ARCs are group-level: every live contract line applies at every plant.
  rows.forEach((r) => applicable.add(r.contractLineId));
  if (plantId) {
    const e = (await c.query(`SELECT erp_system_id FROM org_nodes WHERE id=$1`, [plantId])).rows[0]?.erp_system_id;
    if (e) vendorOk = new Set((await c.query(`SELECT supplier_id FROM supplier_erp_codes WHERE erp_system_id=$1`, [e])).rows.map((r) => r.supplier_id));
    // suppliers with a current contract at this plant for any item, by category (known-supplier evidence for case D)
    (await c.query(
      `WITH RECURSIVE up AS (SELECT id, parent_id FROM org_nodes WHERE id=$1 UNION ALL SELECT n.id, n.parent_id FROM org_nodes n JOIN up ON n.id=up.parent_id)
       SELECT DISTINCT i.category, ct.supplier_id, s.legal_name FROM contract_lines cl JOIN contracts ct ON ct.id=cl.contract_id JOIN catalogue_items i ON i.id=cl.item_id JOIN suppliers s ON s.id=ct.supplier_id
        WHERE cl.status='published' AND ct.status='published' AND ct.contract_type IN ('ARC','QRC') AND (ct.valid_to IS NULL OR ct.valid_to >= current_date) AND i.category IS NOT NULL
          AND EXISTS (SELECT 1 FROM contract_scopes cs JOIN up ON up.id=cs.node_id WHERE cs.contract_id=ct.id)`, [plantId])).rows
      .forEach((r) => { const k = r.category; (plantCategorySuppliers.get(k) ?? plantCategorySuppliers.set(k, new Set()).get(k)!).add(`${r.supplier_id}|${r.legal_name}`); });
  }
  const items = (await c.query(`SELECT id, category, specs FROM catalogue_items WHERE id = ANY($1::uuid[])`, [itemIds])).rows;
  const expired = (await c.query(
    `SELECT cl.item_id, ct.supplier_id, s.legal_name, ct.number, ct.valid_to FROM contract_lines cl JOIN contracts ct ON ct.id=cl.contract_id JOIN suppliers s ON s.id=ct.supplier_id
      WHERE cl.item_id = ANY($1::uuid[]) AND ct.contract_type IN ('ARC','QRC') AND cl.status='published' AND ct.valid_to < current_date`, [itemIds])).rows;
  const requests = plantId ? (await c.query(`SELECT id, item_id, status FROM coverage_requests WHERE plant_node_id=$1 AND item_id = ANY($2::uuid[]) AND status='open'`, [plantId, itemIds])).rows : [];
  const approved = (await c.query(`SELECT item_id, alternative_item_id FROM item_alternatives WHERE item_id = ANY($1::uuid[]) OR alternative_item_id = ANY($1::uuid[])`, [itemIds])).rows;
  const sameCat = (await c.query(`SELECT id, category, specs FROM catalogue_items WHERE status='active' AND category = ANY($1::text[])`, [[...new Set(items.map((i) => i.category).filter(Boolean))]])).rows;

  for (const it of items) {
    const mine = rows.filter((r) => r.item_id === it.id).map((r): Supply => ({
      contractLineId: r.contractLineId, contractId: r.contractId, type: r.type, number: r.number, supplierId: r.supplierId, supplier: r.supplier, netPrice: r.netPrice, uom: r.uom, moq: r.moq, qtyCap: r.qtyCap,
      balance: r.qtyCap === null ? null : Math.max(0, r.qtyCap - r.used), validFrom: r.validFrom, validTo: r.validTo, daysLeft: r.validTo ? Math.round((new Date(r.validTo).getTime() - Date.now()) / 864e5) : null, appliesTo: r.appliesTo,
      appliesToPlant: plantId ? applicable.has(r.contractLineId) : null,
      orderable: plantId ? applicable.has(r.contractLineId) && (!vendorOk || vendorOk.has(r.supplierId)) : null,
      blockedReason: plantId && vendorOk && !vendorOk.has(r.supplierId) ? 'Supplier has no vendor code on your plant’s ERP yet' : null,
    }));
    const supplies = plantId ? mine.filter((s) => s.orderable) : [];
    const elsewhere = plantId ? mine.filter((s) => !s.appliesToPlant) : mine;
    const known: SourceView['knownSuppliers'] = [];
    for (const e of expired.filter((x) => x.item_id === it.id)) known.push({ id: e.supplier_id, name: e.legal_name, why: `Contract ${e.number} for this item ended ${String(e.valid_to).slice(0, 10)}` });
    for (const s of mine.filter((x) => x.appliesToPlant && x.orderable === false)) known.push({ id: s.supplierId, name: s.supplier, why: s.blockedReason ?? 'Not orderable yet' });
    for (const k of plantCategorySuppliers.get(it.category ?? '') ?? []) { const [id, name] = k.split('|'); if (!known.some((x) => x.id === id)) known.push({ id, name, why: `Approved supplier for ${it.category} at your plant` }); }
    const cs: SourceCase = !plantId ? (mine.length ? 'A' : 'E') : supplies.length ? 'A' : elsewhere.length ? 'B' : known.length ? 'D' : 'E';
    const nApproved = approved.filter((a) => a.item_id === it.id || a.alternative_item_id === it.id).length;
    out.set(it.id, { case: plantId ? cs : cs, multiple: supplies.length > 1, supplies: supplies.sort((a, b) => a.netPrice - b.netPrice), elsewhere, knownSuppliers: known,
      alternatives: { approved: nApproved, suggested: suggestSimilar(it, sameCat, approved).length }, request: requests.find((r) => r.item_id === it.id) ?? null,
      lowestPrice: supplies.length ? Math.min(...supplies.map((s) => s.netPrice)) : null });
  }
  void userId;
  return out;
}

/** Spec-similar items that nobody has approved as equivalent. They are SUGGESTIONS and need the requester's confirmation (case F). */
export function suggestSimilar(it: { id: string; category: string | null; specs: Record<string, string> }, pool: { id: string; category: string | null; specs: Record<string, string> }[], approved: { item_id: string; alternative_item_id: string }[]) {
  const keys = Object.keys(it.specs ?? {}); if (keys.length < 2) return [];
  const okIds = new Set(approved.flatMap((a) => [a.item_id, a.alternative_item_id]));
  return pool.filter((p) => p.id !== it.id && p.category === it.category && !(okIds.has(p.id) && approved.some((a) => (a.item_id === it.id && a.alternative_item_id === p.id) || (a.alternative_item_id === it.id && a.item_id === p.id))))
    .map((p) => ({ p, same: keys.filter((k) => p.specs?.[k] !== undefined && norm(p.specs[k]) === norm(it.specs[k])).length, known: keys.filter((k) => p.specs?.[k] !== undefined).length }))
    .filter((x) => x.known >= 2 && x.same >= Math.ceil(keys.length * 0.5)).sort((a, b) => b.same - a.same).slice(0, 4).map((x) => x.p);
}
