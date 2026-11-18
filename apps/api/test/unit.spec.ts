import { matchLine } from '../src/contracts/matching';
import { validateForApproval } from '../src/contracts/validation';
import { resolveAllocation, routeLine, RouteInput, FEE_FOR_MODEL } from '../src/buying/routing';
import { CsvRuleExtractor, normaliseUom } from '../src/ai/extraction';
import { permMatches } from '../src/common/security';

const S1 = 'server-1', S2 = 'server-2';
const items = [
  { id: 'a', brand: 'SKF', mpn: '6205-2RS', category: 'bearings', specs: { bore: '25' }, erpCodes: [{ erpSystemId: S1, materialCode: '1000123' }] },
  { id: 'b', brand: 'FAG', mpn: '6205-2RS', category: 'bearings', specs: { bore: '25' }, erpCodes: [{ erpSystemId: S2, materialCode: '1000123' }] },
];

describe('matching ladder', () => {
  it('exact code only within the same ERP server', () => {
    expect(matchLine({ materialCode: '1000123' }, S1, items).map((c) => c.itemId)).toEqual(['a']);
    expect(matchLine({ materialCode: '1000123' }, S2, items).map((c) => c.itemId)).toEqual(['b']);
  });
  it('MPN alone is not enough, needs brand', () => {
    expect(matchLine({ mpn: '6205-2RS' }, S1, items)).toEqual([]);
    expect(matchLine({ mpn: '6205 2rs', brand: 'fag' }, S1, items)[0]).toMatchObject({ itemId: 'b', basis: 'supplier_code_or_mpn_brand' });
  });
  it('stops at the first successful step', () => {
    const r = matchLine({ materialCode: '1000123', mpn: '6205-2RS', brand: 'FAG' }, S1, items);
    expect(r.every((c) => c.basis === 'exact_code')).toBe(true);
  });
  it('flags brand clash on exact code with lower confidence', () => {
    expect(matchLine({ materialCode: '1000123', brand: 'FAG' }, S1, items)[0].confidence).toBeLessThan(0.9);
  });
  it('spec match needs category and every attribute', () => {
    expect(matchLine({ category: 'bearings', specs: { bore: '25' } }, S1, items).length).toBe(2);
    expect(matchLine({ category: 'bearings', specs: { bore: '30' } }, S1, items)).toEqual([]);
  });
  it('description similarity is capped and low confidence', () => {
    const r = matchLine({}, S1, items, [{ itemId: 'a', score: 0.9 }, { itemId: 'b', score: 0.2 }]);
    expect(r).toHaveLength(1);
    expect(r[0].confidence).toBeLessThanOrEqual(0.6);
  });
});

describe('contract validation', () => {
  const ok = { contract_type: 'ARC', supplier_id: 's', valid_from: '2026-01-01', valid_to: '2027-12-31', scopeCount: 1 };
  const line = (o = {}) => ({ id: 'l1', line_no: 1, status: 'approved', item_id: 'a', uom: 'EA', item_uom: 'EA', net_price: 10, moq: 1, qty_cap: 100, ...o });
  it('accepts a clean contract', () => expect(validateForApproval(ok, [line()], '2026-11-17')).toEqual([]));
  it('rejects expired, unscoped, unsupplied', () => {
    const codes = validateForApproval({ ...ok, valid_to: '2026-01-02', scopeCount: 0, supplier_id: null }, [line()], '2026-11-17').map((p) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['expired', 'scope_missing', 'supplier_missing']));
  });
  it('blocks unresolved lines, UOM mismatch, duplicates, bad price', () => {
    const codes = validateForApproval(ok, [line(), line({ id: 'l2', line_no: 2, status: 'needs_review' }), line({ id: 'l3', line_no: 3, uom: 'KG' }), line({ id: 'l4', line_no: 4, net_price: 0 }), line({ id: 'l5', line_no: 5 })], '2026-11-17').map((p) => p.code);
    expect(codes).toEqual(expect.arrayContaining(['unresolved_line', 'uom_incompatible', 'duplicate_line', 'price_invalid']));
  });
  it('ignores rejected lines', () => expect(validateForApproval(ok, [line(), line({ id: 'x', line_no: 2, status: 'rejected', item_id: null })], '2026-11-17')).toEqual([]));
});

describe('allocation register', () => {
  const t = '2026-11-17';
  it('nearest node wins; category-specific beats general', () => {
    expect(resolveAllocation([{ model: 2, category: null, scopeDepth: 2 }, { model: 3, category: null, scopeDepth: 0 }], 'x', t)).toEqual({ model: 3 });
    expect(resolveAllocation([{ model: 2, category: 'bearings', scopeDepth: 3 }, { model: 3, category: null, scopeDepth: 0 }], 'bearings', t)).toEqual({ model: 2 });
  });
  it('same-level disagreement is a conflict, not a guess', () => {
    expect(resolveAllocation([{ model: 2, category: null, scopeDepth: 1 }, { model: 3, category: null, scopeDepth: 1 }], null, t)).toHaveProperty('conflict');
  });
  it('none → null; expired entries ignored', () => {
    expect(resolveAllocation([], null, t)).toBeNull();
    expect(resolveAllocation([{ model: 2, category: null, scopeDepth: 0, validTo: '2026-01-01' }], null, t)).toBeNull();
  });
});

describe('routing', () => {
  const arc = (o = {}) => ({ contractLineId: 'cl1', contractType: 'ARC' as const, supplierId: 'sup1', netPrice: 10, uom: 'EA', moq: 1, qtyCap: 100, usedQty: 0, validTo: '2027-01-01', scopeDepth: 1, ...o });
  const base = (o: Partial<RouteInput> = {}): RouteInput => ({
    line: { qty: 5, uom: 'EA', itemUom: 'EA', itemActive: true, category: null },
    allocations: [{ model: 2, category: null, scopeDepth: 1 }], policy: { arcPriorityOverDirect: null }, candidates: [arc()], today: '2026-11-17', ...o });

  it('routes to eligible ARC with the register model and its single fee treatment', () => {
    const d = routeLine(base());
    expect(d).toMatchObject({ route: 'arc', model: 2, feeTreatment: 'supplier_enablement', supplierId: 'sup1', unitPrice: 10 });
  });
  it('fee treatment always matches the model (never two)', () => {
    for (const m of [1, 2, 3] as const) expect(FEE_FOR_MODEL[m]).toBeDefined();
    expect(routeLine(base({ allocations: [{ model: 3, category: null, scopeDepth: 1 }] }))).toMatchObject({ model: 3, feeTreatment: 'management_fee' });
  });
  it('no allocation entry is not a dead end: a group ARC still wins (Model 2)', () => expect(routeLine(base({ allocations: [] }))).toMatchObject({ route: 'arc', model: 2 }));
  it('UOM mismatch is returned (no conversion factor, no guessing)', () =>
    expect(routeLine(base({ line: { qty: 5, uom: 'KG', itemUom: 'EA', itemActive: true, category: null } })).route).toBe('returned'));
  it('MOQ and balance are enforced (below MOQ → ProcMart); partial balance → exception', () => {
    expect(routeLine(base({ candidates: [arc({ moq: 10 })] })).route).toBe('sourcing');
    expect(routeLine(base({ candidates: [arc({ usedQty: 97 })] })).route).toBe('exception');
  });
  it('ranks by specific scope then price', () => {
    const d = routeLine(base({ candidates: [arc({ contractLineId: 'broad', scopeDepth: 3, netPrice: 1 }), arc({ contractLineId: 'near', scopeDepth: 0, netPrice: 9 }), arc({ contractLineId: 'cheap', scopeDepth: 0, netPrice: 8 })] }));
    expect(d.contractLineId).toBe('cheap');
  });
  it('an existing group ARC always wins, even in a Model 1 scope', () => {
    const d = routeLine(base({ allocations: [{ model: 1, category: null, scopeDepth: 1 }] }));
    expect(d).toMatchObject({ route: 'arc', model: 2 });
  });
  it('Model 1 scope, no ARC, ProcMart price list → direct, fee none', () => {
    const d = routeLine(base({ allocations: [{ model: 1, category: null, scopeDepth: 1 }], candidates: [arc({ contractType: 'PROCMART_DIRECT', contractLineId: 'pm', supplierId: 'procmart' })] }));
    expect(d).toMatchObject({ route: 'direct', model: 1, feeTreatment: 'none', supplierId: 'procmart' });
  });
  it('Model 3 scope with no ARC → sourcing, parked without a supplier', () => {
    const d = routeLine(base({ allocations: [{ model: 3, category: null, scopeDepth: 1 }], candidates: [] }));
    expect(d).toMatchObject({ route: 'sourcing', model: 3, supplierId: null });
  });
  it('no ARC → ProcMart instant procurement', () => expect(routeLine(base({ candidates: [] }))).toMatchObject({ route: 'sourcing', model: 3 }));
});

describe('extraction', () => {
  it('normalises UOM and keeps raw + confidence + issues', async () => {
    const csv = 'Description,Material Code,UOM,Net Price,MOQ\nBearing 6205,1000123,Nos,"1,250.50",10\nBad row,,,abc,\n';
    const r = await new CsvRuleExtractor().extract(Buffer.from(csv), 'x.csv');
    expect(r.lines[0]).toMatchObject({ uom: 'EA', netPrice: 1250.5, moq: 10, materialCode: '1000123', sourceRef: 'row 2' });
    expect(r.lines[0].raw['uom']).toBe('Nos');
    expect(r.lines[1].issues).toContain('missing_or_invalid_price');
    expect(r.lines[1].confidence).toBeLessThan(0.5);
    expect(normaliseUom('pcs')).toBe('EA');
  });
});

describe('permissions', () => {
  it('wildcards', () => {
    expect(permMatches('*', 'x:y')).toBe(true);
    expect(permMatches('catalogue:*', 'catalogue:write')).toBe(true);
    expect(permMatches('catalogue:*', 'contracts:write')).toBe(false);
    expect(permMatches('catalogue:read', 'catalogue:write')).toBe(false);
  });
});

describe('matching: equivalent codes (step 3)', () => {
  const eq = [{ erpSystemId: S1, materialCode: 'OLD-77', itemId: 'a' }];
  it('uses only the approved list, within the same ERP', () => {
    expect(matchLine({ materialCode: 'OLD-77' }, S1, items, [], eq)[0]).toMatchObject({ itemId: 'a', basis: 'equivalent_code' });
    expect(matchLine({ materialCode: 'OLD-77' }, S2, items, [], eq)).toEqual([]);
    expect(matchLine({ materialCode: 'OLD-78' }, S1, items, [], eq)).toEqual([]);
  });
  it('exact code still wins over an equivalent', () => {
    expect(matchLine({ materialCode: '1000123' }, S1, items, [], [{ erpSystemId: S1, materialCode: '1000123', itemId: 'b' }])[0].basis).toBe('exact_code');
  });
});

describe('routing: buyer-selected supply', () => {
  const arc = (id: string, price: number, o = {}) => ({ contractLineId: id, contractType: 'ARC' as const, supplierId: 's-' + id, netPrice: price, uom: 'EA', moq: 1, qtyCap: 100, usedQty: 0, validTo: '2027-01-01', scopeDepth: 1, ...o });
  const base = (o: any = {}) => ({ line: { qty: 5, uom: 'EA', itemUom: 'EA', itemActive: true, category: null }, allocations: [{ model: 2 as const, category: null, scopeDepth: 1 }], policy: { arcPriorityOverDirect: null }, candidates: [arc('cheap', 90), arc('dear', 120)], today: '2026-11-17', ...o });
  it('without a choice the documented ranking applies; with a choice only that supply is used', () => {
    expect(routeLine(base()).contractLineId).toBe('cheap');
    const d = routeLine(base({ preferredContractLineId: 'dear' }));
    expect(d).toMatchObject({ route: 'arc', contractLineId: 'dear', unitPrice: 120, supplierId: 's-dear' });
    expect(d.trace.some((t) => t.step === 'supply-choice')).toBe(true);
  });
  it('a chosen supply must still pass eligibility (MOQ / balance) and never silently falls back to another', () => {
    expect(routeLine(base({ candidates: [arc('cheap', 90), arc('dear', 120, { moq: 10 })], preferredContractLineId: 'dear' })).route).not.toBe('arc');
    const gone = routeLine(base({ preferredContractLineId: 'missing' }));
    expect(gone.route).toBe('returned'); expect(JSON.stringify(gone.trace)).toMatch(/no longer valid/);
  });
});
