import { createHash } from 'crypto';

export interface PrRequest {
  idempotencyKey: string;
  serverCode: string;
  plantCode: string;
  vendorCode: string;
  lines: { materialCode: string; qty: number; uom: string; unitPrice: number | null; needBy: string | null; contractRef: string | null }[];
}
export interface PrResponse { prNumber: string; status: 'created'; simulated: boolean; raw: Record<string, unknown> }

/** The one port every ERP connector implements. Business modules never talk to SAP/Ariba/Oracle directly. */
export interface ErpAdapter {
  readonly kind: string;
  submitPurchaseRequisition(req: PrRequest, config: Record<string, any>): Promise<PrResponse>;
}
export class NonRetryableError extends Error {}

/**
 * ⚠ SIMULATED. This is NOT SAP. It fabricates deterministic PR numbers for development and tests.
 * Every response is stamped simulated:true and stored that way. The real method is Adani IT's decision (Q9).
 */
export class MockSapAdapter implements ErpAdapter {
  readonly kind = 'mock-sap';
  /** test hook: number of times to fail per idempotency key before succeeding */
  static failures = new Map<string, number>();
  async submitPurchaseRequisition(req: PrRequest, config: Record<string, any>): Promise<PrResponse> {
    const left = MockSapAdapter.failures.get(req.idempotencyKey) ?? 0;
    if (left > 0) { MockSapAdapter.failures.set(req.idempotencyKey, left - 1); throw new Error('SIMULATED SAP timeout'); }
    if (config?.rejectAll) throw new NonRetryableError('SIMULATED SAP rejected the PR');
    const n = parseInt(createHash('sha256').update(req.idempotencyKey).digest('hex').slice(0, 7), 16) % 10_000_000;
    return { prNumber: `SIM-PR-${String(n).padStart(7, '0')}`, status: 'created', simulated: true, raw: { note: 'SIMULATED response, not from a real SAP system', server: req.serverCode, lines: req.lines.length } };
  }
}

export class UnavailableAdapter implements ErpAdapter {
  constructor(readonly kind: string) {}
  async submitPurchaseRequisition(): Promise<PrResponse> {
    throw new NonRetryableError(`No live ${this.kind} integration exists yet; the integration method is not agreed with the customer's IT (decision Q9)`);
  }
}

export function adapterFor(kind: string): ErpAdapter {
  return kind === 'mock-sap' ? new MockSapAdapter() : new UnavailableAdapter(kind);
}
