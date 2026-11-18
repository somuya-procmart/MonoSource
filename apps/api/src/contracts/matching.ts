/**
 * Material matching ladder (BRD §9.2). Pure functions — no database — so the rules are unit-tested.
 * Stops at the first step that yields a candidate. Every candidate is only a SUGGESTION:
 * nothing here activates a contract line; a human decision does (BR / ADR-005).
 */
export type MatchBasis = 'exact_code' | 'supplier_code_or_mpn_brand' | 'equivalent_code' | 'spec_match' | 'description_similarity';

export interface MatchItem {
  id: string;
  brand?: string | null;
  mpn?: string | null;
  category?: string | null;
  specs?: Record<string, string>;
  /** customer material codes keyed by ERP system id */
  erpCodes: { erpSystemId: string; materialCode: string }[];
}
export interface MatchLine {
  materialCode?: string;
  mpn?: string;
  brand?: string;
  supplierItemCode?: string;
  specs?: Record<string, string>;
  category?: string;
}
export interface Candidate { itemId: string; basis: MatchBasis; confidence: number; note?: string }

const norm = (s?: string | null) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function matchLine(
  line: MatchLine,
  contractErpSystemId: string | null,
  items: MatchItem[],
  /** description-similarity hits supplied by the caller (e.g. trigram scores); optional */
  similar: { itemId: string; score: number }[] = [],
  /** customer-approved equivalent codes (e.g. from MDM): a different code that means the same item */
  equivalents: { erpSystemId: string; materialCode: string; itemId: string }[] = [],
): Candidate[] {
  // 1. Exact customer material code — only within the same ERP/server context.
  if (line.materialCode && contractErpSystemId) {
    const hits = items.filter((i) => i.erpCodes.some((k) => k.erpSystemId === contractErpSystemId && norm(k.materialCode) === norm(line.materialCode)));
    if (hits.length)
      return hits.map((i) => {
        const clash = line.brand && i.brand && norm(line.brand) !== norm(i.brand);
        return { itemId: i.id, basis: 'exact_code' as const, confidence: clash ? 0.7 : 0.99, note: clash ? 'brand differs from catalogue' : undefined };
      });
  }
  // 2. Manufacturer part number + brand (an MPN alone is not enough: different makers reuse numbers).
  if (line.mpn && line.brand) {
    const hits = items.filter((i) => norm(i.mpn) === norm(line.mpn) && norm(i.mpn) !== '' && norm(i.brand) === norm(line.brand));
    if (hits.length) return hits.map((i) => ({ itemId: i.id, basis: 'supplier_code_or_mpn_brand' as const, confidence: 0.9 }));
  }
  // 3. Approved equivalent codes: only entries someone approved in the equivalence list. Never inferred.
  if (line.materialCode && contractErpSystemId) {
    const hits = equivalents.filter((e) => e.erpSystemId === contractErpSystemId && norm(e.materialCode) === norm(line.materialCode));
    if (hits.length) return hits.map((e) => ({ itemId: e.itemId, basis: 'equivalent_code' as const, confidence: 0.85, note: 'equivalent code from the approved list' }));
  }
  // 4. Structured specification match: same category and every stated attribute equal.
  if (line.category && line.specs && Object.keys(line.specs).length) {
    const hits = items.filter((i) =>
      norm(i.category) === norm(line.category) &&
      Object.entries(line.specs!).every(([k, v]) => norm(i.specs?.[k]) === norm(v)));
    if (hits.length) return hits.map((i) => ({ itemId: i.id, basis: 'spec_match' as const, confidence: 0.75 }));
  }
  // 5. Description similarity — lowest trust, capped confidence, never auto-activates.
  const sim = similar.filter((s) => s.score >= 0.45).sort((a, b) => b.score - a.score).slice(0, 3);
  return sim.map((s) => ({ itemId: s.itemId, basis: 'description_similarity' as const, confidence: Math.min(0.6, +s.score.toFixed(3)) }));
}
