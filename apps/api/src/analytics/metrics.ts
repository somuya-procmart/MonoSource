/**
 * Documented metric definitions. Every number the control tower shows must exist here with its formula,
 * source tables and caveats (a test fails if an API metric has no definition). No metric is shown without a way
 * to trace it back to records (see the drill-down keys).
 */
export interface MetricDef {
  id: string; name: string; unit: 'count' | 'inr' | 'percent' | 'hours' | 'days';
  definition: string; sources: string[]; caveat?: string; drill?: string;
}

export const METRICS: MetricDef[] = [
  { id: 'requirements', name: 'Requirements raised', unit: 'count', definition: 'Number of requirements submitted in the period for the selected plants.', sources: ['requirements'], drill: 'lines' },
  { id: 'lines', name: 'Requirement lines', unit: 'count', definition: 'Number of lines across those requirements.', sources: ['requirement_lines'], drill: 'lines' },
  { id: 'committed_value', name: 'Committed value', unit: 'inr', definition: 'Sum of quantity × unit price (excl. GST) for lines routed to a supplier (contract, ProcMart direct or awarded).',
    sources: ['requirement_lines'], caveat: 'MonoSource-originated requirements only. Orders raised directly in SAP/Ariba are not included until a full PO feed exists (BR-UTL-03). Not an invoice or payment figure.', drill: 'spend' },
  { id: 'contract_coverage', name: 'Contract coverage', unit: 'percent', definition: 'Lines routed to a customer ARC/QRC ÷ all lines submitted.',
    sources: ['requirement_lines.route'], caveat: 'Measures MonoSource requirements only; says nothing about spend placed outside MonoSource.', drill: 'coverage' },
  { id: 'contract_candidate_unused', name: 'Contract existed but was not used', unit: 'count', definition: 'Lines where an eligible-looking customer contract existed for the item and plant but failed a check (MOQ, balance, UOM, price or supplier), so the line was not routed to it.',
    sources: ['requirement_lines.routing_trace'], caveat: 'This is the in-MonoSource view of leakage risk. True off-contract buying (BRD 9.7) needs the SAP PO feed and is not measured.', drill: 'off_contract' },
  { id: 'rfq_competition_spread', name: 'RFQ competition spread', unit: 'inr', definition: 'For each awarded RFQ line: (average landed unit cost of all valid quotes − landed unit cost of the awarded quote) × quantity, summed.',
    sources: ['awards', 'quote_lines', 'rfq_lines'], caveat: 'This is NOT savings against a baseline. Baseline-based savings need the agreed baseline method (BR-FEE-08 / Q6), which is not defined yet.', drill: 'awards' },
  { id: 'non_l1_awards', name: 'Non-L1 awards', unit: 'count', definition: 'Awards given to a quote that was not the lowest landed cost (each carries a written reason).', sources: ['awards'], drill: 'awards' },
  { id: 'open_exceptions', name: 'Open exceptions', unit: 'count', definition: 'Exceptions with status open for the selected plants.', sources: ['exceptions'], drill: 'exceptions' },
  { id: 'pending_grn_streams', name: 'Orders awaiting goods receipt', unit: 'count', definition: 'Order streams dispatched (fully or partly) whose receipt is not complete.', sources: ['streams'], drill: 'pipeline' },
  { id: 'late_deliveries', name: 'Late deliveries', unit: 'count', definition: 'Order streams with a shipment whose supplier-stated expected date has passed while receipt is not complete.', sources: ['shipments', 'streams'], caveat: 'Uses the expected date the supplier entered; no customer need-by comparison yet.', drill: 'pipeline' },
  { id: 'fee_base_value', name: 'Fee-base value (GRN-completed)', unit: 'inr', definition: 'Accepted GRN quantity × unit price (excl. GST), grouped by the line’s single fee treatment.',
    sources: ['grn_receipts', 'requirement_lines'], caveat: 'A base only. No rates are applied: fee rates, bases and repeat-order rules are not approved (Q3/Q4). GRN is simulated until a real ERP feed exists.' },
  { id: 'supplier_fill_rate', name: 'Supplier fill rate', unit: 'percent', definition: 'Accepted quantity ÷ ordered quantity, for order lines that have at least one GRN.', sources: ['grn_receipts', 'requirement_lines'], caveat: 'GRN is simulated until a real ERP feed exists.' },
  { id: 'supplier_rejection_rate', name: 'Supplier rejection rate', unit: 'percent', definition: 'Rejected quantity ÷ (accepted + rejected) at GRN.', sources: ['grn_receipts'] },
  { id: 'supplier_ack_hours', name: 'Average acknowledgement time', unit: 'hours', definition: 'Average hours from PO release to the supplier’s acknowledgement.', sources: ['order_events'], caveat: 'PO release time is simulated until a real ERP feed exists.' },
  { id: 'supplier_ontime_dispatch', name: 'On-time dispatch', unit: 'percent', definition: 'Shipments sent on or before the committed date, among lines where the supplier gave a committed date.', sources: ['line_commitments', 'shipments'] },
  { id: 'contract_utilisation', name: 'Contract utilisation', unit: 'percent', definition: 'Quantity ordered through MonoSource on a contract line ÷ the line’s quantity cap.', sources: ['contract_lines', 'requirement_lines'], caveat: 'Counts MonoSource orders only; the cap is shared across all plants, the used quantity respects the plant scope you selected.' },
];
export const METRIC_IDS = new Set(METRICS.map((m) => m.id));

export const pct = (num: number, den: number): number | null => (den > 0 ? +((num / den) * 100).toFixed(1) : null);
