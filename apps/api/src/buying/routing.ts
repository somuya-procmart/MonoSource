/**
 * Line-level routing engine (BRD §10.1). Pure: all data is passed in, so every rule is unit-tested.
 *
 * Not built yet (and said so in the trace, never faked): valid Model 3 awards (step 4), RFQ/sourcing thresholds,
 * ARC split across several contracts, demand consolidation.
 * Policy answers that are still open in the decision register are NULL here and make the engine stop with an
 * exception rather than assume an answer.
 */
export type Model = 1 | 2 | 3;
export type FeeTreatment = 'none' | 'supplier_enablement' | 'management_fee';
export type RouteKind = 'arc' | 'award' | 'direct' | 'sourcing' | 'returned' | 'exception';

export const FEE_FOR_MODEL: Record<Model, FeeTreatment> = { 1: 'none', 2: 'supplier_enablement', 3: 'management_fee' };

export interface AllocationEntry {
  model: Model; category: string | null; scopeDepth: number; // 0 = plant itself, higher = broader
  validFrom?: string | null; validTo?: string | null;
}
export interface ContractCandidate {
  contractLineId: string; contractType: 'ARC' | 'QRC' | 'PROCMART_DIRECT'; supplierId: string | null;
  netPrice: number | null; uom: string | null; moq: number | null; qtyCap: number | null; usedQty: number;
  validTo: string | null; scopeDepth: number; contractNumber?: string | null;
  /** The supplier has no vendor code on this plant's ERP server, so a PR cannot be raised (BRD scenario 5). */
  vendorCodeMissing?: boolean;
}
export interface RouteInput {
  line: { qty: number; uom: string; itemUom: string; itemActive: boolean; category: string | null; intent?: 'buy' | 'source'; requested?: boolean };
  allocations: AllocationEntry[];
  policy: { arcPriorityOverDirect: boolean | null };
  candidates: ContractCandidate[];
  today: string;
  /** The buyer's chosen ARC/QRC supply. Only that contract line is considered; it must still pass every eligibility check. */
  preferredContractLineId?: string | null;
}
export interface TraceStep { step: string; outcome: string; detail?: any }
export interface Decision {
  route: RouteKind; model: Model | null; feeTreatment: FeeTreatment | null;
  contractLineId: string | null; supplierId: string | null; unitPrice: number | null; trace: TraceStep[];
}

export type AllocationResult = { model: Model } | { conflict: string } | null;

/** BR-MOD-02: most specific wins (category-specific, then nearest node); same-level disagreement is a conflict. */
export function resolveAllocation(entries: AllocationEntry[], category: string | null, today: string): AllocationResult {
  const live = entries.filter((e) => (!e.validFrom || e.validFrom <= today) && (!e.validTo || e.validTo >= today) && (e.category === null || e.category === category));
  if (!live.length) return null;
  const rank = (e: AllocationEntry) => [e.category !== null ? 0 : 1, e.scopeDepth];
  live.sort((a, b) => rank(a)[0] - rank(b)[0] || rank(a)[1] - rank(b)[1]);
  const best = live.filter((e) => rank(e)[0] === rank(live[0])[0] && rank(e)[1] === rank(live[0])[1]);
  const models = new Set(best.map((e) => e.model));
  return models.size > 1 ? { conflict: 'Two allocation entries at the same level assign different models' } : { model: best[0].model };
}

function done(route: RouteKind, trace: TraceStep[], extra: Partial<Decision> = {}): Decision {
  const model = extra.model ?? null;
  return { route, model, feeTreatment: model ? FEE_FOR_MODEL[model] : null, contractLineId: null, supplierId: null, unitPrice: null, trace, ...extra };
}

export function routeLine(i: RouteInput): Decision {
  const trace: TraceStep[] = [];
  const { line } = i;

  // 1. Validate
  if (!(line.qty > 0)) return done('returned', [...trace, { step: 'validate', outcome: 'returned', detail: 'quantity must be > 0' }]);
  if (line.requested) { /* non-catalogue request: no catalogue UOM or status to validate; it can only be sourced */ } else if (!line.itemActive) return done('returned', [...trace, { step: 'validate', outcome: 'returned', detail: 'item is not active' }]);
  if (!line.requested && line.uom !== line.itemUom)
    return done('returned', [...trace, { step: 'validate', outcome: 'returned', detail: `UOM ${line.uom} ≠ item UOM ${line.itemUom}; no conversion factor defined` }]);
  trace.push({ step: 'validate', outcome: 'ok' });

  // 2. Scope — Model Allocation Register
  // The model is decided behind the scenes. No allocation entry is not a dead end: ARC lines default to Model 2,
  // everything else goes to ProcMart instant procurement.
  let alloc = resolveAllocation(i.allocations, line.category, i.today);
  if (alloc && 'conflict' in alloc) return done('exception', [...trace, { step: 'allocation', outcome: 'exception', detail: alloc.conflict }]);
  trace.push({ step: 'allocation', outcome: alloc ? `model ${alloc.model}` : 'no entry; defaulting by supply' });

  // 3. Eligible customer ARC/QRC
  const eligible: ContractCandidate[] = [];
  let partial = false; const vendorBlocked: ContractCandidate[] = [];
  const pool = i.candidates.filter((x) => x.contractType !== 'PROCMART_DIRECT');
  const chosen = i.preferredContractLineId ? pool.filter((x) => x.contractLineId === i.preferredContractLineId) : pool;
  if (i.preferredContractLineId) {
    trace.push({ step: 'supply-choice', outcome: chosen.length ? 'buyer selected this supply' : 'selected supply is not valid for this plant/date any more', detail: { contractLineId: i.preferredContractLineId } });
    if (!chosen.length) return done('returned', [...trace, { step: 'supply-choice', outcome: 'returned', detail: 'The supply you selected is no longer valid for this plant. Pick another supply.' }]);
  }
  for (const c of chosen) {
    const why: string[] = [];
    // A real ARC keeps its rate in SAP; MonoSource may not have it. The order still goes to the ARC (PO priced in SAP).
    if (!c.supplierId) why.push('no supplier');
    if (c.uom !== line.uom) why.push('uom differs');
    if (c.moq !== null && line.qty < c.moq) why.push(`below MOQ ${c.moq}`);
    if (c.qtyCap !== null) {
      const bal = c.qtyCap - c.usedQty;
      if (bal < line.qty) { why.push(`balance ${bal} < ${line.qty}`); if (bal > 0) partial = true; }
    }
    if (why.length) trace.push({ step: 'arc-eligibility', outcome: 'rejected', detail: { contractLineId: c.contractLineId, why } });
    else if (c.vendorCodeMissing) { vendorBlocked.push(c); trace.push({ step: 'arc-eligibility', outcome: 'rejected', detail: { contractLineId: c.contractLineId, why: ['supplier has no vendor code on this plant’s ERP'] } }); }
    else eligible.push(c);
  }
  eligible.sort((a, b) => a.scopeDepth - b.scopeDepth || ((a.netPrice ?? Infinity) - (b.netPrice ?? Infinity) || 0) || String(a.validTo).localeCompare(String(b.validTo)));

  if (eligible.length) {
    const top = eligible[0];
    const mk = (model: Model) => done('arc', [...trace, { step: 'arc', outcome: 'routed', detail: { contractLineId: top.contractLineId, rankedAmong: eligible.length } }], {
      model, contractLineId: top.contractLineId, supplierId: top.supplierId, unitPrice: top.netPrice });
    // Rule: if a group ARC exists, the order goes to that ARC. Always.
    return mk(alloc && alloc.model !== 1 ? alloc.model : 2);
  } else if (vendorBlocked.length) {
    return done('exception', [...trace, { step: 'vendor-code', outcome: 'exception', detail: 'The contract supplier has no vendor code on this plant’s ERP server. A vendor-code extension request to master data is needed before this can be ordered.' }]);
  } else if (partial) {
    return done('exception', [...trace, { step: 'arc', outcome: 'exception', detail: 'ARC balance covers only part of the quantity; split across contracts is not built yet' }]);
  } else trace.push({ step: 'arc', outcome: 'no eligible ARC/QRC' });

  // 4. Valid Model 3 award
  trace.push({ step: 'award', outcome: 'skipped', detail: 'award contracts are not built yet (Phase 4)' });

  // 5. No ARC → ProcMart instant procurement. A ProcMart price list fixes the price at once; otherwise ProcMart sources it.
  const d = i.candidates
    .filter((x) => x.contractType === 'PROCMART_DIRECT' && x.netPrice !== null && x.uom === line.uom && (x.moq === null || line.qty >= x.moq) && (x.qtyCap === null || x.qtyCap - x.usedQty >= line.qty))
    .sort((a, b) => a.netPrice! - b.netPrice!)[0];
  if (d && !line.requested) return done('direct', [...trace, { step: 'procmart', outcome: 'routed to ProcMart price list', detail: { contractLineId: d.contractLineId } }], {
    model: 1, contractLineId: d.contractLineId, supplierId: d.supplierId, unitPrice: d.netPrice });
  return done('sourcing', [...trace, { step: 'procmart', outcome: 'routed to ProcMart instant procurement', detail: line.requested ? 'Item not in the catalogue: ProcMart finds suppliers and quotes.' : 'No group ARC: ProcMart finds suppliers and quotes.' }], { model: 3 });
}
