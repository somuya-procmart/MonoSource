# MonoSource redirection — problem, research, value proposition, and the redesigned product

Status: supersedes the module-based navigation in `UX-AUDIT-SITEMAP-JOURNEYS.md` · 2026-11-17 · tags: [P] proposal · [R] recommendation · [?AD] needs Adani confirmation · [Z] public reference

## 1. The product problem, in my words
A group negotiates rate contracts (ARCs/QRCs) centrally or at one plant. The plant employee who needs a bearing never sees them: they search SAP by a material description, don't know the supplier or the supplier's code, can't tell whether a contract covers *their* plant, can't tell that another plant already negotiated the same item, and so they buy off-contract or raise a free-text request. The contract exists but is **undiscoverable and unusable at the point of need**.

MonoSource's job is to turn *"I need a bearing"* into an honest answer about **source of supply for my plant**, and a next action that always exists:

> Need → **Discover** → **Determine source** → Buy → Track

Everything else (suppliers, ARC registers, RFQs, exceptions, KPIs) is **supporting context that appears where it helps that journey**, not a set of modules the user must visit.

What I got wrong in the previous version: I organised the app around *internal objects* (contracts, suppliers, orders, exceptions) and decorated a home page with their counts. The source-of-supply answer — the actual value — was one table on a product page. Cases where there is *no* valid contract at the user's plant (the common, valuable ones) were handled as "returned" or empty states.

## 2. Research findings (SAP, Ariba, Coupa)
Sources are official SAP Learning / SAP site pages where available; vendor and community pages are marked as secondary.

1. **SAP S/4HANA source determination** ([SAP Learning](https://learning.sap.com/courses/sourcing-in-sap-s4hana/outlining-source-determination)): for a requisition SAP checks, in order, **quota arrangement → source list (info record or outline agreement; the entry marked *Fixed* wins, outline agreement beats info record) → valid outline agreements (contracts) → info records**. If one valid outline-agreement item exists it is assigned; if several exist **the user chooses from a list**; per-item determination offers all valid sources. *The page does not describe what happens when no source exists* — exactly the gap non-catalogue/sourcing flows fill. Related: [Controlling Source Determination with Source Lists](https://learning.sap.com/courses/purchasing-in-sap-s-4hana/controlling-source-determination-with-source-lists-1); the source list does **not** check whether a contract is exhausted ([SAP PRESS](https://blog.sap-press.com/source-lists-in-sap-s4hana), secondary).
2. **Contracts are plant-/material-scoped in SAP.** A source is valid for a *material–vendor–plant–period* combination. A plant that has no source-list/contract entry simply does not see the contract; SAP has no "this exists elsewhere in the group" concept at requisition time. [R: inference from the above]
3. **Requisition lifecycle** ([SAP Learning: releasing purchase requisitions](https://learning.sap.com/courses/purchasing-in-sap-s-4hana/releasing-purchase-requisitions), [release procedures](https://learning.sap.com/courses/exploring-operational-procurement-in-sap-s-4hana/processing-release-procedures-for-purchase-requisitions)): requisition → **release/approval strategy** (configured per release group/document type) → purchaser creates PO → supplier delivers → requester confirms goods receipt. An unreleased document cannot be sent to a vendor or receipted. Release strategies are customer-specific. **We do not invent Adani's** [?AD].
4. **SAP Ariba Guided Buying** ([SAP Learning](https://learning.sap.com/courses/sap-ariba-procurement-overview-1/exploring-catalog-requisition-in-guided-buying), [catalog search](https://learning.sap.com/courses/sap-ariba-procurement-overview-1/understanding-catalog-search-and-punchout-catalog)): predictive type-ahead search, refinement filters with counts, results kept until a new search, cart → checkout → prefilled requisition (accounting, address from the user's profile) → **approval flow shown before submit** → "Submitted" until approvers act. **Items not in any catalog are added as ad hoc (non-catalog) items.** Release notes describe search results organised by **buying channel tabs** and a non-catalog request page that shows **recommended catalog alternatives** to steer users back to catalog items (SAP release notes via [support.ariba.com](https://support.ariba.com/item/view/205203), secondary).
5. **Coupa** (vendor material, secondary — [Open Buy brochure](https://get.coupa.com/rs/950-OLU-185/images/AB_CoupaOpenBuyBrochure_FINAL.pdf?version=1)): guided buying routes by category, supplier approval status, location and **contract availability**; "maverick/off-contract spend" is tracked as share of spend through compliant channels. I found no Coupa primary documentation on free-text request handling.

### What a plant employee normally does in SAP
Create a requisition (ME51N / Fiori "Create Purchase Requisition" / Ariba cart): enter material (or free text), quantity, UOM, delivery date, plant, account assignment; accept or pick the determined source; save; wait for release; later confirm goods receipt.
**Information needed:** the material and its description; whether a contract/source exists *for the plant*; the supplier and price (or that none exists); the need-by date; who approves; status afterwards.
**Why it is hard:** search is by SAP description/code; contract coverage is invisible unless you already know the source; coverage elsewhere in the group is invisible; when no source exists the user is on their own; status lives in several transactions.
**MonoSource simplifies:** discovery in plain language; source-of-supply determination across the group with honest eligibility; a clear next step in every case; one place to track requirement → PO → delivery.
**Must remain in SAP:** material master, the requisition itself, release/approval strategy, PO, goods receipt, invoice, payment. MonoSource *requests* and *mirrors*; it never approves or releases.
**MonoSource adds:** group-wide contract discovery, plain-language/alias/supplier-code/PO-text search, coverage-gap requests to procurement, non-catalogue and sourcing requests, equivalent/alternative suggestions with explicit confirmation, off-contract analytics against PO history.

## 3. Value proposition
**For plant requesters:** find the item in your own words, see instantly whether you can buy it on a group contract *at your plant*, and raise the requirement in a minute.
**For group procurement:** every plant sees the contracts you negotiated, so ARC utilisation rises, off-contract buying falls, coverage gaps become visible requests, and missing sources arrive as structured sourcing work — not emails.
**Measured by:** share of lines routed to ARC; contract utilisation; off-contract spend where an ARC existed; coverage requests resolved; time from need to submitted requirement.

## 4. Personas and jobs to be done
| Persona | Main jobs | Needs to see | Must not see |
|---|---|---|---|
| **Plant requester** | Get an item for my plant; know if there's a contract; track it | Search/Ask, source-of-supply answer, my requirements/orders | Central admin, KPIs, other plants' prices |
| **Plant procurement** | Check applicability; handle exceptions; chase suppliers | + work queue for my plant, contract applicability | Group admin |
| **Central procurement** | Extend contracts to plants; run sourcing; reduce off-contract buying; review ARCs | Contracts & coverage, coverage requests, sourcing, overview | — |
| **ProcMart operations** | Digitise ARCs; source non-catalogue items; follow up suppliers | Contracts, sourcing, work queue | Award decisions |
| **Supplier** | Confirm, dispatch, invoice, quote | Own orders/RFQs only | Fees, other suppliers |
| **Administrator** | Organisation, access, rules | Admin | — |

## 5. Simplified sitemap (task-based)
```
BUY            /                     Buy workspace: search · Ask · coverage-aware results · product panel · cart & review drawer
MY ACTIVITY    /activity             Requirements · Orders · Saved (tabs)        /requirements/:id  one requirement: lines, orders, exceptions, timeline
PROCUREMENT    /contracts            Contracts & coverage: register · coverage opportunities (off-contract) · review    /contracts/:id  one ARC
(role-based)   /sourcing             Sourcing: waiting items & non-catalogue requests · RFQs      /sourcing/:id
               /work                 Work queue: exceptions · coverage requests (one list, linked to the affected requirement/contract)
               /insights             Overview
ADMIN          /admin                Organisation · Users · Catalogue · Configuration (tabs)
SUPPLIER       /portal …             unchanged
```
**Removed or merged:** `/categories` (a menu inside the workspace) · `/saved` (tab in Activity) · `/orders`, `/orders/:id` (tab + section of the requirement page) · `/requirements/review` (a step inside the cart drawer) · `/suppliers`, `/suppliers/:id` (side drawer opened from a product or contract) · `/exceptions` (shown in the affected requirement; consolidated list in Work queue) · separate `/product/:id` page becomes a **side panel over the results** (the full page remains as a link, not the main path).
| Page | Who | Task | Why not contextual? |
|---|---|---|---|
| Buy workspace | everyone buying | find + determine source + add | it *is* the product |
| Product panel | requester | understand source, choose supply | contextual over results |
| Cart & review drawer | requester | review, submit | drawer |
| Activity | requester/proc. | see my requirements/orders/saved | one list, tabs |
| Requirement page | requester/proc. | follow one need end to end | needs room (lines, orders, timeline) |
| Contracts & coverage | procurement | find an ARC, see gaps, extend | register + opportunities |
| Contract page | procurement | review one ARC | needs room |
| Sourcing | procurement | turn missing sources into RFQs | queue + RFQ workspace |
| Work queue | procurement | clear exceptions/requests | one inbox |
| Insights | central | see compliance | analytics |
| Admin | admin | configure | restricted |

## 6. Journeys
1. **Need → buy on contract (A):** type "bearing 6205" → results show *On contract at your plant* (supplier, price, ARC, validity) → open panel → quantity → Add → drawer: review & submit → confirmation → requirement page with status.
2. **Opportunity (B):** result says *Group has a contract (Plant X), not confirmed for your plant* → "Ask procurement to extend to my plant" → request appears in Work queue → procurement extends the ARC scope in one click → requester's result flips to A.
3. **Choice (C):** *3 suppliers on contract* → panel lists all with price/validity/balance → user picks (no auto-pick unless an approved rule exists [?AD]).
4. **Own words:** "BRG BALL 6205 2RS SKF" (old SAP text), a supplier code, or "for conveyor motor" → results show *Matched on: SAP description / supplier code / application*.
5. **No contract (D/E):** *Known supplier, no current contract* or *No known source* → "Request sourcing" / "Raise a non-catalogue requirement" → lands in Sourcing as structured work → RFQ → award → PR.
6. **Track:** requirement page keeps the original product and source context: lines, how each was sourced, orders, exceptions, timeline.
7. **Central procurement (off-contract):** Contracts & coverage → *Coverage opportunities*: PO history where an ARC existed but the buy went elsewhere (leakage, price leakage, coverage gap) → extend contract / chase plant.
8. **ARC review:** Contract page: supplier, validity, **applicable plants**, covered products and prices, utilisation, related leakage, pending coverage requests.

## 7. Source-of-supply determination (the six cases) [R]
Computed per item for the selected plant. Order mirrors SAP's *contract before info record* logic, but extends it **across the group**.
| Case | Test | Result shown | Primary action |
|---|---|---|---|
| **A** On contract at your plant | ≥1 published, in-validity ARC/QRC line covering the plant and orderable | Supplier(s), ARC ref, price, UOM, validity, MOQ, balance | **Add to requirement** |
| **B** Contract elsewhere | Valid contract for the item exists in the group but **not** for this plant | "Group has a contract (plants…) — not confirmed for you" + supplier/price *as information*, not orderable | **Ask procurement to extend to my plant** (a request, never an order) |
| **C** Multiple suppliers | A with ≥2 supplies | Comparison table; **no auto-selection** | Choose a supply |
| **D** Known supplier, no applicable contract | Expired/other-plant history, or supplier on contract for the category at this plant | Supplier named, contract status explained | **Request sourcing** (quote) |
| **E** No known source | Nothing above | Guidance, never an empty page | **Non-catalogue requirement** or sourcing |
| **F** Alternatives | Approved equivalents or spec-similar items | Spec diff; *Approved equivalent* vs *Suggested – needs confirmation* | Add with explicit suitability confirmation |
Open [?AD]: allocation/mandate rules between several ARC suppliers (we do not invent them); whether a contract can be extended to a plant by procurement alone.

## 8. Workspace design (wireframes)
```
┌ sidebar ┬─────────────────────────────────────────────────────────────────────────────┐
│ Buy     │ Plant: Coastal Power ▾                                      🛒 3   RS ▾     │
│ Activity│                                                                              │
│ ─ proc ─│        What do you need?     [ Products | ✨ Ask MonoSource ]  [ search … ]  │
│ …       │        categories ▾ · “plant buys often” (with coverage badges)             │
│         │        ▸ Draft requirement (3 items) · ▸ 1 order needs your attention       │
├─────────┴─────────────────────────────────────────────────────────────────────────────┤
│ RESULTS ─ filters │ [img] Deep groove 6205-2RS  SKF  6205  matched on: SAP description │
│                   │       ● On contract at your plant  Shree ₹475 · Apex ₹476  [Compare]│
│                   │ [img] Roller bearing NU2210 … ◐ Group contract elsewhere  [Ask…]   │
│                   │ [img] Cable 3C×2.5 … ○ No known source  [Raise requirement]       │
│                                   click row ─▶ ┌ PRODUCT PANEL (slides over) ─────────┐ │
│                                                 │ How can I buy this for my plant?     │ │
│                                                 │ [A/B/C/D/E answer + supplies table]  │ │
│                                                 │ specs · alternatives · docs · ARC ▸  │ │
│                                                 │ [qty] [Add to requirement]           │ │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```
**Home for a requester contains only:** search/Ask, "bought often at your plant" (each with its source badge), a compact recent requirements/orders list, and genuinely actionable alerts (e.g. a supplier declined, a draft requirement). No procurement tiles.

## 9. Product panel structure
1. **Header:** image, name, brand/MPN, material code, UOM.
2. **"How can I buy this for [plant]?"** — one case banner (A–F), then the supplies table or the next-step card. This is first, above specifications.
3. Buy box (sticky in panel): selected supply, quantity, total, **Add to requirement**.
4. Specifications (structured), alternatives (F), documents, contract conditions, supplier (drawer link).

## 10. Scenarios → implementation
1 A · 2 B (+ extension request → procurement extends → flips to A) · 3 C · 4 alias/supplier-code/contract-description search · 5 D/E with sourcing & non-catalogue · 6 requirement page retains source context · 7 coverage opportunities from (illustrative, simulated-SAP) PO history · 8 contract page.
**Honest limits:** PO history in the demo is an illustrative stand-in for a SAP PO feed (BR-UTL-03); photo/document search is **not** built (text from an old PO/invoice line works through aliases); approval/release stay in SAP; MDM/vendor-code and allocation rules are configuration, not invented.
