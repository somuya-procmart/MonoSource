/**
 * Order lifecycle rules (BRD §11). Pure and unit-tested.
 * Who owns each event: ERP (simulated today) = po_released, GRN, payment. Supplier = acknowledge, dispatch, invoice.
 * Partial fulfilment / rejection / replacement policy is still an open decision (Q11): this code records the facts,
 * derives a status, and raises an exception. It never decides a replacement or cancellation by itself.
 */
export interface LineQty { lineId: string; ordered: number; committed: number | null; dispatched: number; received: number; rejected: number }

export type AckDecision = 'accepted' | 'partial' | 'rejected';

export function ackDecision(lines: { ordered: number; committed: number }[]): AckDecision {
  if (lines.every((l) => l.committed === 0)) return 'rejected';
  return lines.every((l) => l.committed >= l.ordered) ? 'accepted' : 'partial';
}

/** Basis for "fully dispatched/received": the committed qty if the supplier committed, else the ordered qty. */
const target = (l: LineQty) => (l.committed ?? l.ordered);

/** Status derived purely from quantities, so partial dispatches and partial receipts always agree. Lines the supplier refused (committed 0) are ignored. */
export function deriveStatus(lines: LineQty[]): 'acknowledged' | 'partially_dispatched' | 'dispatched' | 'partially_received' | 'grn_posted' {
  const live = lines.filter((l) => target(l) > 0);
  const allDispatched = live.every((l) => l.dispatched >= target(l));
  const allReceipted = live.every((l) => l.received + l.rejected >= target(l));
  if (live.length && allDispatched && allReceipted) return 'grn_posted';
  if (live.some((l) => l.received + l.rejected > 0)) return 'partially_received';
  if (allDispatched && live.length) return 'dispatched';
  if (live.some((l) => l.dispatched > 0)) return 'partially_dispatched';
  return 'acknowledged';
}

/** Allowed status moves for events that are not quantity-driven. */
const FLOW: Record<string, string[]> = { pr_created: ['po_released'], po_released: ['acknowledged'], grn_posted: ['invoiced'], invoiced: ['paid'] };
export const canMove = (from: string, to: string) => !!FLOW[from]?.includes(to);
/** Statuses in which quantities (dispatch / GRN) may still change. */
export const QTY_OPEN = ['acknowledged', 'partially_dispatched', 'dispatched', 'partially_received'];

export function validateDispatch(lines: LineQty[], dispatch: { lineId: string; qty: number }[]): string[] {
  const errs: string[] = [];
  for (const d of dispatch) {
    const l = lines.find((x) => x.lineId === d.lineId);
    if (!l) { errs.push('Line is not part of this order'); continue; }
    if (!(d.qty > 0)) errs.push('Quantity must be positive');
    if (l.dispatched + d.qty > target(l)) errs.push(`Cannot dispatch ${d.qty}: ${l.dispatched} of ${target(l)} already sent`);
  }
  return errs;
}
export function validateGrn(lines: LineQty[], grn: { lineId: string; accepted: number; rejected: number }[]): string[] {
  const errs: string[] = [];
  for (const g of grn) {
    const l = lines.find((x) => x.lineId === g.lineId);
    if (!l) { errs.push('Line is not part of this order'); continue; }
    if (g.accepted < 0 || g.rejected < 0 || g.accepted + g.rejected <= 0) errs.push('Quantities must be positive');
    if (l.received + l.rejected + g.accepted + g.rejected > l.dispatched) errs.push(`Cannot receive more than dispatched (${l.dispatched})`);
  }
  return errs;
}

export interface FollowUpRule { ackHours?: number; dispatchHours?: number; deliveryHours?: number; escalateAfter?: number; channels?: string[] }
export type FollowKind = 'ack' | 'dispatch' | 'delivery';
export const KIND_FOR_STATUS: Record<string, FollowKind> = { po_released: 'ack', acknowledged: 'dispatch', partially_dispatched: 'dispatch', dispatched: 'delivery', partially_received: 'delivery' };

/** Follow-ups are disabled unless the customer configured intervals AND channels AND an escalation count. No default SLA. */
export function followUpConfig(raw: any): { hours: Record<FollowKind, number>; escalateAfter: number; channels: ('email' | 'whatsapp' | 'call')[] } | null {
  const r: FollowUpRule | undefined = raw?.followUp;
  if (!r || !r.channels?.length || !(r.escalateAfter! >= 1)) return null;
  const ch = r.channels.filter((c) => ['email', 'whatsapp', 'call'].includes(c)) as ('email' | 'whatsapp' | 'call')[];
  if (!ch.length || !(r.ackHours! > 0) || !(r.dispatchHours! > 0) || !(r.deliveryHours! > 0)) return null;
  return { hours: { ack: r.ackHours!, dispatch: r.dispatchHours!, delivery: r.deliveryHours! }, escalateAfter: r.escalateAfter!, channels: ch };
}

/** What to do for one waiting stream. `sent` = follow-ups already sent in this status; `lastAt` = last activity (status change or follow-up). */
export function followUpAction(cfg: NonNullable<ReturnType<typeof followUpConfig>>, status: string, sent: number, lastAt: Date, now: Date): 'none' | 'send' | 'escalate' {
  const kind = KIND_FOR_STATUS[status]; if (!kind) return 'none';
  if ((now.getTime() - lastAt.getTime()) / 36e5 < cfg.hours[kind]) return 'none';
  return sent >= cfg.escalateAfter ? 'escalate' : 'send';
}
