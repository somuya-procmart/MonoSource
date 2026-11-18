import { canInviteProcmart, rankQuotes, readMinQuotes } from '../src/buying/sourcing';
const q = (id: string, landed: number, lead: number | null = 5, uom = 'EA') => ({ quoteLineId: id, supplierId: id, supplierName: id, unitPrice: landed, freightPerUnit: 0, landedUnitCost: landed, leadTimeDays: lead, uom });
describe('quote ranking', () => {
  it('ranks by landed cost; L1 flagged; delta computed', () => {
    const { ranked } = rankQuotes([q('b', 110), q('a', 100), q('c', 120)], 'EA');
    expect(ranked.map((r) => r.quoteLineId)).toEqual(['a', 'b', 'c']);
    expect(ranked[0]).toMatchObject({ isL1: true, rank: 1, deltaPct: 0 });
    expect(ranked[1]).toMatchObject({ isL1: false, deltaPct: 10 });
  });
  it('ties break on lead time and both stay L1', () => {
    const { ranked } = rankQuotes([q('slow', 100, 20), q('fast', 100, 3)], 'EA');
    expect(ranked[0].quoteLineId).toBe('fast');
    expect(ranked.every((r) => r.isL1)).toBe(true);
  });
  it('quotes in another UOM are excluded, not converted', () => {
    const r = rankQuotes([q('a', 50, 5, 'KG'), q('b', 100)], 'EA');
    expect(r.ranked.map((x) => x.quoteLineId)).toEqual(['b']);
    expect(r.rejected[0].why).toMatch(/no conversion/);
  });
});
describe('policy gates', () => {
  it('ProcMart bidding: undecided and "no" both block', () => {
    expect(canInviteProcmart({ procmartMayBid: null }).ok).toBe(false);
    expect(canInviteProcmart({ procmartMayBid: false }).ok).toBe(false);
    expect(canInviteProcmart({ procmartMayBid: true }).ok).toBe(true);
  });
  it('minQuotes must be an explicit positive integer', () => {
    expect(readMinQuotes({})).toBeNull();
    expect(readMinQuotes({ minQuotes: 0 })).toBeNull();
    expect(readMinQuotes({ minQuotes: '3' })).toBeNull();
    expect(readMinQuotes({ minQuotes: 3 })).toBe(3);
  });
});
