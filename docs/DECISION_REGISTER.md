# Product Decision Register

No answer below is hard-coded as approved. "Mechanism" says how the software makes it configurable.

| ID | Question | Business impact | Proposed default (NOT approved) | Owner | Status | Modules | Mechanism |
|---|---|---|---|---|---|---|---|
| Q1 | Does an eligible Adani ARC always beat ProcMart direct supply? | Wrong supplier of record, contract leakage | Yes, ARC first (BRD BR-MOD-05) | Adani Procurement + ProcMart | Open [?AD] | routing | `tenant_policies.arc_priority_over_direct` (null = unset → routing refuses to run Model 1 when ARC exists and flag is unset → exception) |
| Q2 | Can ProcMart bid in an RFQ it runs? | Conflict of interest | No | Adani + ProcMart | Open | RFQ (Phase 4) | `tenant_policies.procmart_may_bid` |
| Q3 | Model 3 fee basis | Revenue / invoice disputes | GRN qty × PO unit basic price, ex-GST | ProcMart Finance + Adani Finance | Open | fees | `fee_rules.basis` |
| Q4 | What is a repeat order (2.5%)? | Fee rate | Re-buy within award validity at awarded price | ProcMart + Adani | Open | fees | `fee_rules.repeat_definition` |
| Q5 | ARC supplier refuses enablement fee | Model 2 viability | Not ARC-enabled; escalate | ProcMart | Open | suppliers/fees | supplier `fee_terms_accepted` flag |
| Q6 | ARC covering several suppliers | Allocation | Share-based ranking (BRD 9.4) | Adani Procurement | Open | routing | ranking config (Phase 4) |
| Q7 | Supplier entity reconciliation across SAP servers and ProcMart | Duplicate/wrong vendor | Never auto-merge; reviewed link only | Adani MDM | Open | suppliers | `supplier_erp_codes` + review queue |
| Q8 | Role of Ariba | Scope | Adapter, later | Adani IT | Open | integrations | adapter port |
| Q9 | SAP integration method | Go-live | Unknown; mock adapter only | Adani IT | Open | integrations | adapter port |
| Q10 | Pilot plants/categories | Pilot scope | None assumed | Adani + ProcMart | Open | allocation register | `model_allocations` |
| Q11 | Partial fulfilment / rejection / replacement / cancel rules | Order ops | Per BRD §11–12 as exceptions | Adani | Open (system records quantities and raises an exception; never auto-replaces or cancels) | orders | exception queue |
| Q12 | Policy thresholds & approvals | Sourcing method | None — sourcing refuses without thresholds (BR-RTE-01) | Adani Procurement | Open (only `minQuotes` modelled; value bands/approval chains still needed) | routing, RFQ | `tenant_policies.thresholds.minQuotes` |
| Q13 (new) | Follow-up intervals, channels and escalation count | Supplier chasing | None assumed; follow-ups stay off until configured. Landing-page timings (e.g. 48h) are demo values | Adani Procurement + ProcMart Ops | Open | follow-ups | `tenant_policies.thresholds.followUp` |
| Q14 (new) | Should uploader ≠ approver (four-eyes) apply to contracts, awards and quotes entered by ProcMart? | Control | Yes for contracts | Adani + ProcMart | Open | contracts, RFQ | not built |
| Q15 (new) | May customer contract text be sent to an external AI provider for PDF extraction? Which provider/region? | Confidentiality, NDA | Off until the customer approves; use a zero-retention / in-region provider | Adani Legal + ProcMart | Open | contracts | `ANTHROPIC_API_KEY` (unset = disabled) |
| Q16 (new) | Does Adani MDM keep a list of equivalent/duplicate material codes, and who maintains it in MonoSource? | Match step 3 | Maintained by catalogue admins; never inferred | Adani MDM | Open | catalogue | `material_equivalents` |
| Q17 (new) | When a buyer picks a supply other than the rules' recommendation, is approval needed (APR-03, BRD 9.4)? Threshold X%? | Control vs. buyer freedom | Allow with a recorded choice; approval above 2% landed-cost difference | Adani Procurement | Open (choice is recorded in the routing trace; no approval step yet) | routing, product page | `cart_lines.contract_line_id` |
