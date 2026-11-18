import { ackDecision, canMove, deriveStatus, followUpAction, followUpConfig, validateDispatch, validateGrn, LineQty } from '../src/buying/orders';
const L = (o: Partial<LineQty> = {}): LineQty => ({ lineId: 'l', ordered: 10, committed: 10, dispatched: 0, received: 0, rejected: 0, ...o });
describe('acknowledgement', () => {
  it('accepted / partial / rejected', () => {
    expect(ackDecision([{ ordered: 10, committed: 10 }])).toBe('accepted');
    expect(ackDecision([{ ordered: 10, committed: 6 }, { ordered: 5, committed: 5 }])).toBe('partial');
    expect(ackDecision([{ ordered: 10, committed: 0 }])).toBe('rejected');
  });
});
describe('derived order status', () => {
  it('walks through partial dispatch → dispatched → partial receipt → GRN', () => {
    expect(deriveStatus([L()])).toBe('acknowledged');
    expect(deriveStatus([L({ dispatched: 4 })])).toBe('partially_dispatched');
    expect(deriveStatus([L({ dispatched: 10 })])).toBe('dispatched');
    expect(deriveStatus([L({ dispatched: 10, received: 4 })])).toBe('partially_received');
    expect(deriveStatus([L({ dispatched: 10, received: 8, rejected: 2 })])).toBe('grn_posted');
  });
  it('uses committed qty as the target and ignores refused lines', () => {
    expect(deriveStatus([L({ committed: 6, dispatched: 6 }), L({ lineId: 'b', committed: 0 })])).toBe('dispatched');
  });
  it('partly received but more still to ship stays partially_received, not GRN', () => {
    expect(deriveStatus([L({ dispatched: 5, received: 5 })])).toBe('partially_received');
  });
});
describe('quantity validation', () => {
  it('cannot dispatch more than committed, or receive more than dispatched', () => {
    expect(validateDispatch([L({ committed: 6, dispatched: 4 })], [{ lineId: 'l', qty: 3 }])[0]).toMatch(/Cannot dispatch/);
    expect(validateDispatch([L()], [{ lineId: 'l', qty: 10 }])).toEqual([]);
    expect(validateGrn([L({ dispatched: 5 })], [{ lineId: 'l', accepted: 4, rejected: 2 }])[0]).toMatch(/more than dispatched/);
    expect(validateGrn([L({ dispatched: 5 })], [{ lineId: 'l', accepted: 3, rejected: 2 }])).toEqual([]);
  });
});
describe('status moves', () => {
  it('ERP/supplier steps stay in order', () => {
    expect(canMove('pr_created', 'po_released')).toBe(true);
    expect(canMove('pr_created', 'paid')).toBe(false);
    expect(canMove('grn_posted', 'invoiced')).toBe(true);
    expect(canMove('po_released', 'dispatched')).toBe(false);
  });
});
describe('follow-up rules (no default SLA)', () => {
  const full = { followUp: { ackHours: 24, dispatchHours: 48, deliveryHours: 72, escalateAfter: 2, channels: ['email', 'sms'] } };
  it('disabled unless fully configured', () => {
    expect(followUpConfig({})).toBeNull();
    expect(followUpConfig({ followUp: { ackHours: 24 } })).toBeNull();
    expect(followUpConfig({ followUp: { ...full.followUp, channels: ['pigeon'] } })).toBeNull();
    expect(followUpConfig(full)!.channels).toEqual(['email']); // unknown channels dropped
  });
  it('waits for the interval, sends, then escalates after N unanswered', () => {
    const cfg = followUpConfig(full)!; const now = new Date('2026-01-10T12:00:00Z'); const hrs = (h: number) => new Date(now.getTime() - h * 36e5);
    expect(followUpAction(cfg, 'po_released', 0, hrs(10), now)).toBe('none');
    expect(followUpAction(cfg, 'po_released', 0, hrs(25), now)).toBe('send');
    expect(followUpAction(cfg, 'po_released', 1, hrs(25), now)).toBe('send');
    expect(followUpAction(cfg, 'po_released', 2, hrs(25), now)).toBe('escalate');
    expect(followUpAction(cfg, 'dispatched', 0, hrs(50), now)).toBe('none'); // delivery interval is 72h
    expect(followUpAction(cfg, 'paid', 0, hrs(500), now)).toBe('none');
  });
});
