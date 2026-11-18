/** Contract validation before approval/publication (BRD §8). Pure and unit-tested. */
export interface VContract {
  contract_type: string; supplier_id: string | null; valid_from: string | null; valid_to: string | null; scopeCount: number;
}
export interface VLine {
  id: string; line_no: number; status: string; item_id: string | null; uom: string | null; item_uom: string | null;
  net_price: number | null; moq: number | null; qty_cap: number | null; brand?: string | null;
}
export interface Problem { code: string; message: string; lineId?: string }

export function validateForApproval(c: VContract, lines: VLine[], today: string): Problem[] {
  const p: Problem[] = [];
  if (!c.supplier_id) p.push({ code: 'supplier_missing', message: 'Supplier legal entity must be set' });
  if (!c.valid_from || !c.valid_to) p.push({ code: 'validity_missing', message: 'Validity dates are required' });
  else if (c.valid_to < c.valid_from) p.push({ code: 'validity_invalid', message: 'valid_to is before valid_from' });
  else if (c.valid_to < today) p.push({ code: 'expired', message: 'Contract has already expired' });
  if (c.scopeCount === 0) p.push({ code: 'scope_missing', message: 'Applicability (business/company/plant) must be set' });

  const live = lines.filter((l) => l.status !== 'rejected');
  if (!live.length) p.push({ code: 'no_lines', message: 'No approved lines' });
  const seen = new Map<string, number>();
  for (const l of live) {
    if (l.status !== 'approved') p.push({ code: 'unresolved_line', message: `Line ${l.line_no} still needs a human decision`, lineId: l.id });
    if (!l.item_id) continue;
    if (l.net_price === null || l.net_price <= 0) p.push({ code: 'price_invalid', message: `Line ${l.line_no}: price must be > 0`, lineId: l.id });
    // BR-MAT-02: no UOM conversion factors exist yet, so UOMs must match exactly rather than be guessed.
    if (!l.uom || l.uom !== l.item_uom) p.push({ code: 'uom_incompatible', message: `Line ${l.line_no}: UOM ${l.uom ?? '?'} vs catalogue ${l.item_uom} (no conversion factor)`, lineId: l.id });
    if (l.moq !== null && l.qty_cap !== null && l.moq > l.qty_cap) p.push({ code: 'moq_over_cap', message: `Line ${l.line_no}: MOQ exceeds quantity cap`, lineId: l.id });
    const k = l.item_id;
    if (seen.has(k)) p.push({ code: 'duplicate_line', message: `Line ${l.line_no} duplicates line ${seen.get(k)} (same item)`, lineId: l.id });
    else seen.set(k, l.line_no);
  }
  return p;
}
