/** Quote comparison and award rules (BRD §10.3). Pure and unit-tested. */
export interface QuoteLineView {
  quoteLineId: string; supplierId: string; supplierName: string; unitPrice: number; freightPerUnit: number;
  landedUnitCost: number; leadTimeDays: number | null; uom: string;
}
export interface Ranked extends QuoteLineView { rank: number; isL1: boolean; deltaPct: number }

/** Rank by landed unit cost (price + freight, excl. GST); ties go to the shorter lead time. L1 = lowest. */
export function rankQuotes(lines: QuoteLineView[], lineUom: string): { ranked: Ranked[]; rejected: { quoteLineId: string; why: string }[] } {
  const rejected = lines.filter((l) => l.uom !== lineUom).map((l) => ({ quoteLineId: l.quoteLineId, why: `quoted in ${l.uom}, requested ${lineUom} (no conversion factor)` }));
  const ok = lines.filter((l) => l.uom === lineUom).sort((a, b) => a.landedUnitCost - b.landedUnitCost || (a.leadTimeDays ?? 1e9) - (b.leadTimeDays ?? 1e9));
  const best = ok[0]?.landedUnitCost ?? 0;
  const ranked = ok.map((l, i) => ({ ...l, rank: i + 1, isL1: l.landedUnitCost === best, deltaPct: best ? +(((l.landedUnitCost - best) / best) * 100).toFixed(2) : 0 }));
  return { ranked, rejected };
}

export function canInviteProcmart(policy: { procmartMayBid: boolean | null }): { ok: boolean; why?: string } {
  if (policy.procmartMayBid === null) return { ok: false, why: 'Whether ProcMart may bid in RFQs it runs is not decided (Q2)' };
  return policy.procmartMayBid ? { ok: true } : { ok: false, why: 'Policy does not allow ProcMart to bid in RFQs it runs' };
}

export function readMinQuotes(thresholds: any): number | null {
  const n = thresholds?.minQuotes;
  return Number.isInteger(n) && n >= 1 ? n : null;
}
