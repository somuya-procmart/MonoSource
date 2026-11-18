# ProcMart × Adani — BRD and Business Solution Blueprint

Nov 13, 2026 · @somuya khandelwal

## 0. Document control and how to read this document

**Purpose.** This is the first deliverable for the ProcMart–Adani MonoSource programme: a Business Requirements Document (BRD) and Business Solution Blueprint. It sets out the business logic: the commercial models, ARC rules, supplier identity, routing, workflow, responsibilities, exceptions and open questions. ProcMart's product and procurement teams can then validate it before anyone writes a Functional Requirements Document (FRD).

**Out of scope for this document (by instruction).** UI designs, wireframes, database schemas, API specifications, integration-method selection and application code. Where a business rule implies a technical need, it is noted as a requirement on the FRD or the technical design, not designed here.

**Primary references.**

- Reference B (primary business reference): *ProcMart\_Adani\_Commercial\_Proposal\_v8.pptx* (26 slides, November 2026).
- Reference A (benchmark): Zinit's public website, supplier guide and public RFP listing (read 13 Nov 2026). Only what Zinit shows publicly is described. Nothing here claims knowledge of Zinit's internal algorithms, data model or architecture.

### Classification legend

Every business rule carries one or more tags. A rule is never shown as confirmed unless it is tagged **\[P\]**. A rule tagged **\[R\]** together with **\[?PM\]** or **\[?AD\]** is a proposal awaiting sign-off.

| Tag | Meaning | What the reviewer does |
| --- | --- | --- |
| **\[P\]** | Confirmed by the supplied proposal | Check the rule matches the slide cited |
| **\[Z\]** | Verified from public Zinit documentation | Reference only: it tells us what a comparable product does, not what we must build |
| **\[R\]** | Recommended design decision (this document's proposal) | Accept, change or reject |
| **\[?PM\]** | Requires confirmation from ProcMart | ProcMart commercial, operations or product owner decides |
| **\[?AD\]** | Requires confirmation from Adani | Adani procurement, finance, IT or master-data owner decides |

**Rule IDs.** Rules are numbered by area so the FRD and test cases can trace back to them: SUP (supplier identity), ARC (contracts), MAT (matching), UTL (utilisation), MOD (commercial model), RTE (routing), WF (workflow), EXC (exceptions), APR (approvals), FEE (fees and invoicing), KPI (metrics).

**Terms used.**

| Term | Meaning in this document |
| --- | --- |
| ARC | Annual Rate Contract: Adani's negotiated item-level rate with a supplier for a period |
| QRC | Quarterly Rate Contract: same as ARC but for a quarter (named on slide 6) |
| Requirement | A plant user's need, raised in MonoSource, before any SAP document exists |
| PR | Purchase Requisition created in Adani SAP |
| PO | Purchase Order created and released in Adani SAP |
| Order | MonoSource's operational record that tracks a PO line through fulfilment |
| Supplier of record | The legal entity named on the PO, which invoices Adani |
| Golden supplier | MonoSource's single cross-system identity for one real-world supplier (section 7) |
| Plant | An Adani SAP plant. The proposal counts 963 plants under 253 company codes in 37 businesses \[P, slide 5\] |

## 1. Executive summary

**The business problem \[P\].** Adani negotiates rate contracts centrally, but its 963 plants do not use them evenly. Across 3,09,144 PO lines (Apr 2025 – Mar 2026), 74% are bought off ARC. 47,937 PO lines were bought off-ARC for 9,272 items that Adani already buys on ARC elsewhere (slides 5 and 10). Only 26% of PO lines go through Ariba (slide 10).

**What the proposal commits to \[P\].** MonoSource, ProcMart's own platform, becomes the buying front door, linked to Adani SAP. SAP stays the system of record for PR, approval, PO, GRN, invoice and payment (slide 12). The proposal offers three commercial models on one platform (slides 19–21), a ₹10 lakh one-time set-up, and a 90–180-day pilot that starts with the ₹800 Cr ARC base (slide 24).

**What the proposal does not yet define.** The software rules that make the business model work. For example: how a requirement line is assigned to Model 1, 2 or 3; how an ARC is matched when several apply; how one supplier is recognised across ProcMart and Adani master data; how utilisation is counted across PR, PO, dispatch, GRN and cancellation; and how fees are kept off the wrong transaction. This document proposes those rules.

**The ten design positions this BRD takes** (all **\[R\]** unless tagged otherwise):

1. **Decide per line, not per requirement.** The commercial model, ARC and supplier are decided for each requirement line. One requirement can split into several streams under one parent reference, and nothing is lost in the split.
2. **ARC first, always.** When an active, eligible ARC covers a line, the line goes to that ARC. ProcMart direct supply (Model 1) and competitive sourcing come into play only when no eligible ARC exists or the ARC cannot fulfil. This protects Adani's negotiated contracts and stops MonoSource from steering spend to ProcMart. \[?AD\] \[?PM\]
3. **The system recommends; people with authority decide.** MonoSource routes, ranks and flags. Adani's SAP release strategy approves. A deviation from the recommendation needs a recorded reason and an authorised approver.
4. **One golden supplier, many identities.** One cross-system supplier record links ProcMart supplier IDs, Adani vendor codes (across 11 SAP servers), GSTINs and branches. The golden record is never a second registration.
5. **The model is locked at the PO line.** Once a PO line is released, its commercial model, supplier of record and fee basis are fixed. A change means cancelling and re-routing, never an edit.
6. **Fees are decided by rule, not by hand.** Each PO line carries exactly one fee treatment: none, the supplier enablement fee, or the Model 3 management fee (3% or 2.5%). This enforces the proposal's rule that supplier-paid and Adani-paid charges never apply to the same transaction \[P, slide 20\].
7. **Utilisation is counted in layers.** Committed (PR), ordered (PO), dispatched, received (GRN) and invoiced quantities are tracked separately. An ARC's balance check uses committed plus ordered, net of cancellations.
8. **No silent overrides.** Off-contract purchases, ARC breaches, price mismatches and expiry crossings each have a named exception type, an owner, an SLA and an approval level.
9. **SAP events are the truth for SAP stages.** MonoSource shows the PR, PO, GRN, invoice and payment status that SAP reports. It never infers them.
10. **Pilot first.** Pilot plants and the six high-readiness categories (Electrical, Stationery, Bearings, Hand Tools, Chemicals, Safety: 68–88% addressable, slide 7) are the recommended first scope. \[?AD\]

**What happens next.** ProcMart and Adani answer the critical questions in section 16. The FRD is then written against the rules approved here.

## 2. Part A: What Zinit publicly demonstrates

Everything in this section is tagged **\[Z\]** unless marked otherwise. Sources are Zinit's homepage, its supplier guide and its public RFP listing at app.zinit.com/requests, read on 13 Nov 2026. A third-party interview is used only where noted. Zinit's internal implementation is not public, and none is assumed here.

### 2.1 What kind of product Zinit is

- Zinit presents itself as an *agentic* procurement platform: a set of AI agents that run sourcing work while the buyer's team directs it ([homepage](https://zinit.com/)).
- Its public material centres on **sourcing**: turning a need into an RFP or RFQ, finding suppliers, running bidding, and supporting the award decision. The homepage demo walks through four stages: RFP Creation, Supplier Match, Bidding, and Award & Analytics.
- Its commercial model is **supplier-funded**. Buyers do not pay. Only the winning supplier pays a success fee, calculated on the value of the winning offer, using a fee scale published on each RFP ([supplier guide](https://zinit.com/supplier-guide)).
- It offers a free **tail-spend benchmark**: comparing a buyer's tail spend with pre-negotiated rates from 100+ suppliers in categories such as office supplies, MRO, packaging and uniforms, and routing that spend to better contracts ([homepage](https://zinit.com/)).
- It offers services alongside the software: ERP and S2P integration, BI integration by API, tailored analytics, and team capability building ([homepage](https://zinit.com/)). In a third-party interview, Zinit said it integrates with SAP and Oracle and writes the award decision, new price or new supplier back to the ERP ([Art of Procurement](https://artofprocurement.com/blog/insider-startup-of-the-week-zinit); third-party source, not Zinit documentation).
- Headline claims such as 15%+ savings, set-up in under an hour, and a 103M-supplier database are Zinit's marketing claims. They have not been verified.

**What Zinit does not show publicly.** There is no public evidence of catalogue buying, ARC lifecycle management, contract-utilisation tracking, PO fulfilment, dispatch/ASN, GRN, or invoice and payment tracking. On public evidence, Zinit stops at the award. Everything after the award is left to the buyer's ERP. This is the most important difference from what Adani needs (section 3).

### 2.2 Zinit's published AI agents

| Agent | What Zinit says it does | Who it serves | What triggers it (inferred from the description) | Next stage |
| --- | --- | --- | --- | --- |
| RFx & SoW Drafting | Turns a one-line brief into a structured, policy-compliant request or statement of work | Requester, buyer | A requester describes a need | Supplier discovery |
| Supplier Discovery | Searches its supplier database by category, region and qualification, and builds a shortlist | Buyer | An RFx draft exists | Invitations |
| Supplier Communication | Sends RFx invitations and follows them up by email, text, phone and LinkedIn | Buyer | A shortlist is approved | Bidding |
| Negotiation | Runs multi-round bid negotiation using category levers, and recommends an award with a total-cost-of-ownership (TCO) view | Category manager | Bids received | Award |
| Policy Strategist | Holds SOPs and policies by category, and flags non-compliant requests before they reach a buyer | Procurement head | A request is created | Drafting or rejection |
| Supplier Pool Auditor | Keeps vetting approved suppliers, flags poor performers, and finds new qualified vendors | Supplier manager | Ongoing | Supplier pool updates |
| Spend Analyst | Aggregates spend, finds consolidation opportunities, and ranks sourcing events by savings potential | Procurement leadership | Ongoing or on demand | New sourcing events |
| Deviation Auditor | Flags decisions that differ from the AI's recommendation or a policy threshold | Category manager, audit | An award or decision | Audit review |
| Compliance Guard | Monitors tender integrity and supplier conduct during events | Audit, compliance | During an event | Escalation |
| Custom agents | Built to a buyer's categories, policies and workflows | Buyer | As configured | As configured |

For every agent above, Zinit does not publish how decisions are computed, what happens in its backend, or how failures are handled. Those columns are left out on purpose rather than guessed.

### 2.3 The supplier journey (from Zinit's public supplier guide)

1. **Registration.** The supplier signs up with a corporate email, verifies a 6-digit code, then sets a name and password. Registration is free.
2. **Company profile.** The supplier picks a country and enters a tax ID. The platform looks up registration data automatically, with manual entry as a fallback. The supplier adds a logo, legal and brand names, employee count and registration date, contacts and an address. They add at least three "We sell" keyword tags, which the platform uses to match them to RFPs. They mark service-coverage regions on a map and upload certificates such as ISO 9001 (up to 25 MB each). The confirmed profile becomes public.
3. **Finding RFPs.** Public RFPs are listed with three statuses: collecting offers, evaluating offers, and completed. Each RFP shows its description, delivery address, tags, deadline, bid type, offer visibility, currency, tax treatment, whether alternative offers are allowed, and an item specification. Where there is no specification, a generic offer is expected.
4. **Making an offer.** The supplier joins the RFP, accepting the user agreement and commission terms. They then work through four tabs: Request, Bid, Comparison and Final Results. For each item they enter availability, quantity, unit price before tax, and tax rate. Totals calculate automatically. Large bids can be filled in offline with an Excel template and imported. The supplier attaches documents and answers the buyer's questionnaire if there is one. They send a main offer, plus an optional alternative offer if the buyer allows it.
5. **Tracking and results.** A dashboard shows offers sent, winning offers, total requests and active requests. The Comparison tab shows how the offer ranks, if the buyer has turned visibility on. Emails go out when comparison starts, when the RFP closes, when a winner is chosen, and when the fee invoice is issued.

### 2.4 The public RFP listing (observed)

On 13 Nov 2026 the public listing showed 15 RFPs from buyers including Linde Peru, White Martins, LKQ Corporation and Piramal Pharma ([public RFPs](https://app.zinit.com/requests)). Each card shows a title, an RFP number, the submitted date, the bid deadline with a countdown, the **RFP phase (Stage 1 or Stage 2)**, the delivery region and the organiser. The listing can be filtered by open-for-bidding, buyer, delivery region, bid deadline and condition. The Stage 1 / Stage 2 label shows that Zinit supports **multi-stage sourcing events**.

### 2.5 Ideas worth adopting, and ideas to reject

| Zinit idea | Use for Adani? | Why |
| --- | --- | --- |
| Need-to-RFx drafting from plain language | Adopt \[R\] | Fits Model 3 "On Quote" items, which are 66.6% of items (slide 6) |
| Keyword tags plus coverage regions for supplier matching | Adopt \[R\] | A cheap first version of supplier eligibility for non-ARC sourcing |
| Excel bulk bid import and export | Adopt \[R\] | Adani's RFQs will have many lines |
| Main offer plus an optional alternative offer | Adopt \[R\] | Lets suppliers propose equivalent brands without breaking comparability |
| Multi-stage events (technical, then commercial) | Adopt \[R\] \[?AD\] | Common in Indian industrial sourcing; Adani's policy decides whether it is used |
| Bid visibility to suppliers (rank shown) | Configurable, off by default \[R\] \[?AD\] | Adani's policy may forbid showing rank |
| Deviation Auditor (flag decisions that differ from the recommendation) | Adopt \[R\] | Directly supports the off-contract leakage goal |
| Policy check before a request reaches a buyer | Adopt \[R\] | Catches ARC-covered items before they go to quote |
| Success fee charged only to the winning supplier | Do not copy \[R\] | The proposal already sets its own fee structure (section 5) |
| Autonomous multi-channel outreach and negotiation | Adopt only with human approval gates \[R\] | Adani keeps commercial authority (slide 18) |
| Public RFP marketplace | Do not adopt by default \[R\] \[?AD\] | Adani's RFQs are likely confidential; invited suppliers only unless Adani agrees otherwise |

## 3. Zinit compared with the proposed ProcMart solution, and what the proposal leaves open

From this section onwards, the document is **Part B: what ProcMart should build for Adani**.

### 3.1 Side-by-side

| Dimension | Zinit (public evidence) \[Z\] | MonoSource for Adani (proposal \[P\] plus this BRD \[R\]) |
| --- | --- | --- |
| Core job | Sourcing: need, RFx, bidding, award | Buying on contract first, sourcing second, then order follow-through to GRN and payment visibility |
| Where spend goes by default | To a new competitive event | To an existing ARC; competitive sourcing only when no ARC fits \[R\] |
| Catalogue buying | Not shown | Central: browse, cart, contract price, plant-wise access \[P, slides 12 and 14\] |
| Contract (ARC) lifecycle | Not shown | Full lifecycle: intake, mapping, validity, limits, amendments, utilisation, renewal \[R\] |
| ERP role | Receives award results \[third-party\] | SAP is the system of record for PR, approval, PO, GRN, invoice and payment \[P, slide 12\] |
| Post-award execution | Not shown | PO acknowledgement, dispatch, ASN, partial delivery, GRN follow-up, invoice status \[P, slides 13, 15 and 18\] |
| Who pays | Winning supplier (success fee) | Varies by model: Model 1 none; Model 2 indicative 1% from supplier; Model 3 3% or 2.5% from Adani; ₹10 lakh set-up \[P, slide 20\] |
| Supplier of record | Always the winning supplier | ProcMart (Model 1), ARC supplier (Model 2), ARC supplier or chosen supplier (Model 3) \[P, slide 20\] |
| Human operations | Advisory services | Procurement BPO team inside the workflow \[P, slide 18\] |
| Supplier network | Open global marketplace | Closed: Adani-approved suppliers, ProcMart's network, and newly onboarded suppliers \[P, slide 11\] |
| Identity problem | Single registration per tax ID | Two existing masters (ProcMart and Adani across 11 SAP servers) to reconcile \[R\] |
| AI | Agent workforce across sourcing | Agents to classify, match, flag and draft; humans approve every commercial decision \[R\] |

### 3.2 Software capabilities the proposal names but does not define

The proposal is a commercial document, and it says so: model allocation "will be set once Adani's supplier data is received and evaluated" (slide 6), and the integration approach is "to be agreed with Adani IT during Phase 1" (slide 12). The gaps below are what this BRD fills, or flags for decision.

| # | Gap | Why it matters | Covered in |
| --- | --- | --- | --- |
| G1 | No rule assigns a line to Model 1, 2 or 3 | Fees, supplier of record and invoices all depend on it | Sections 5 and 10 |
| G2 | No supplier identity model across ProcMart and Adani | Avoids duplicate onboarding; ARC eligibility must follow the right entity | Section 7 |
| G3 | ARC structure is only "items, prices, specs, codes" | Plant applicability, limits, MOQ, UOM, brand discounts, amendments and expiry are all undefined | Section 8 |
| G4 | No ARC matching or tie-break rule | 24,803 items are bought from 2+ vendors (slide 10), so multiple ARCs per item are likely | Section 9 |
| G5 | Utilisation not defined by event | PR, PO, GRN and cancellation each move the numbers differently | Section 9 |
| G6 | Off-contract detection is a goal without a mechanism | 47,937 leakage lines (slide 10) | Sections 9, 10 and 12 |
| G7 | No requirement-consolidation rule | 70% of POs are not consolidated (slide 9) | Section 10 |
| G8 | "Repeat order" (for the 2.5% fee) is undefined | It changes the fee | Section 5 |
| G9 | "Value of procurement managed" (3% fee basis) is undefined | It changes the fee | Section 5 |
| G10 | Model 3 "Adani approves L1 per policy" (slide 20): the policy is not supplied | Decides when non-L1 awards need extra approval | Section 12 |
| G11 | Exception, escalation and SLA matrices are named but not defined | Slide 25 lists SLAs and an escalation matrix, both still to be written | Section 12 |
| G12 | Material master quality: 5,253 codes with more than one description (slide 9) | Matching and catalogue accuracy depend on it | Sections 8 and 9 |
| G13 | Brand-discount ARCs (3,970 items, slide 6) need a list-price source | Without one, the price can't be calculated | Section 8 |
| G14 | QRC (quarterly rate contracts) appear in the data but not in the models | Need the same engine with a shorter validity | Section 8 |
| G15 | Ariba already handles 26% of PO lines (slide 10) | Unclear whether MonoSource replaces, sits beside or feeds Ariba | Section 16 |
| G16 | Returns, rejections and debit notes are not mentioned | Every enterprise P2P flow needs them | Sections 11 and 12 |
| G17 | GST and e-way bill responsibility differs by model and is not stated | Compliance risk | Sections 5 and 11 |

## 4. Adani procurement business architecture

### 4.1 The parties and systems

| Party or system | Role | Source |
| --- | --- | --- |
| Adani businesses and plants | Raise requirements; receive goods; post GRN in SAP | \[P\] slides 5 and 11 |
| Adani procurement (central and plant) | Own policy, supplier selection, contract award, commercial approval and final say on exceptions | \[P\] slide 18 |
| Adani SAP (11 servers per slide 5) | System of record: material master, users, cost centres, PR, release strategy, PO, GRN, invoice, payment, audit trail | \[P\] slide 12 |
| Adani finance | Invoice verification and payment; approves fee billing frequency | \[P\] slide 21 |
| Adani IT | Agrees the integration approach | \[P\] slide 12 |
| SAP Ariba (existing) | Already handles 26% of PO lines; its role alongside MonoSource is undefined | \[P\] slide 10; role \[?AD\] |
| MonoSource | Experience and management layer: catalogue, code mapping, search and cart, tracking, supplier follow-up, BPO operations, MIS | \[P\] slides 12 and 13 |
| ProcMart operations (BPO) | Supplier coordination, catalogue maintenance, PR and PO support, follow-ups, delivery tracking, escalations, MIS | \[P\] slide 18 |
| ProcMart as supplier (Model 1) | Supplier of record for items in its portfolio | \[P\] slide 19 |
| Adani ARC suppliers | Supplier of record under their own ARCs | \[P\] slide 20 |
| Newly onboarded suppliers | Take part in sourcing for non-ARC needs | \[P\] slide 11 |

### 4.2 The Adani organisation hierarchy MonoSource must respect

Group → Business (37) → Company code (253) → Plant (963) → Delivery point or storage location → User \[P, slide 5\]. MonoSource needs this hierarchy because ARC applicability, catalogue visibility, approval routing and reporting all attach to one of its levels.

- **BR-ORG-01** \[R\] \[?AD\]: Every user belongs to at least one plant. Every plant belongs to exactly one company code and one business. MonoSource takes this hierarchy from SAP, never from manual set-up.
- **BR-ORG-02** \[R\] \[?AD\]: Plants are linked to an SAP server. The same plant code may exist on two SAP servers. A plant is always identified by its server and plant code together.
- **BR-ORG-03** \[R\] \[?AD\]: Purchasing organisation and purchasing group come from SAP for each plant and category. MonoSource uses them to route a PR and to work out which ARCs apply.

### 4.3 Item universe and the default path for each bucket

| Item bucket \[P, slide 6\] | Items | PO lines | Default path in MonoSource \[R\] |
| --- | --- | --- | --- |
| ARC (annual rate contract) | 39,847 | 99,776 | Catalogue at contract price, routed to the ARC supplier |
| QRC (quarterly rate contract) | 2,393 | 11,929 | Same as ARC, with quarterly validity |
| On Quote | 91,220 | 1,69,395 | Requirement goes to a quote: Model 3 sourcing, or Model 1 if in ProcMart's portfolio and Adani approves |
| Non-serviceable | 3,502 | 28,044 | Stays with Adani's current sources. MonoSource may record the requirement for visibility only \[?AD\] |

**Important.** The bucket shows ProcMart's serviceability tagging, which is not the same as Adani's contract status. The slide 6 "ARC" bucket means items ProcMart can supply on rate contract. It does not mean an Adani ARC exists today. MonoSource must keep these two facts in separate fields: **ProcMart serviceability** and **Adani contract coverage**. Routing (section 10) reads both. \[R\]

### 4.4 System of record for each business object

| Business object | System of record | MonoSource holds | Source |
| --- | --- | --- | --- |
| Material master (Adani code, description, UOM) | Adani SAP | A mapped and enriched copy: clean description, specs, images | \[P\] slide 12 |
| Vendor master (Adani vendor code) | Adani SAP | A mapped copy linked to the golden supplier | \[R\] \[?AD\] |
| ProcMart supplier master | ProcMart / MonoSource | The master | \[R\] |
| ARC (commercial terms) | Contract owner: Adani. Digitised record: MonoSource | The working contract used for pricing and utilisation | \[R\] \[?AD\] Does SAP hold ARCs as outline agreements or info records? |
| Requirement and cart | MonoSource | The master | \[P\] slide 12 |
| RFQ, quotations, comparison | MonoSource (Model 3) | The master | \[R\] \[?AD\] Does Adani need the RFQ in SAP too? |
| PR | Adani SAP | Mirrored status and number | \[P\] slide 12 |
| PO | Adani SAP | Mirrored copy and status | \[P\] slide 12 |
| Supplier acknowledgement, ASN, dispatch, POD | MonoSource | The master; may be pushed to SAP | \[P\] slide 12 (flows) |
| GRN | Adani SAP | Mirrored | \[P\] slide 12 |
| Supplier invoice to Adani | Adani SAP (MIRO or equivalent) | Uploaded copy plus mirrored status | \[R\] \[?AD\] |
| Payment status | Adani SAP | Mirrored | \[P\] slide 12 |
| ProcMart service invoice (Model 3) and supplier fee invoice (Model 2) | ProcMart finance | Fee ledger | \[P\] slide 21 |
| Supplier performance | MonoSource (computed) | The master | \[P\] slide 14 |

## 5. The three commercial models: how each behaves in the software

### 5.1 What the proposal fixes \[P\]

- **Model 1, ProcMart as direct supplier:** ProcMart supplies, at prices agreed by category. No service fee. ProcMart invoices Adani against an Adani PO, on delivery and GRN (slides 19–21).
- **Model 2, management of existing ARCs:** Adani's ARCs stay, and ARC suppliers remain the suppliers of record and keep invoicing Adani. There is no fee to Adani. Suppliers pay an indicative 1% enablement fee, invoiced by ProcMart to the supplier. ProcMart digitises ARCs, coordinates suppliers, tracks utilisation and performance, and renegotiates.
- **Model 3, procurement process management:** everything in Model 2, plus sourcing, quotes, comparison, PO support, expediting, GRN, invoice and exception handling. The fee is 3% management fee (2.5% on repeat orders), invoiced separately against a separate Adani PO, on GRN-completed transactions. No supplier fee applies to items under the Model 3 fee.
- **All models:** ₹10 lakh one-time implementation fee, invoiced separately. "Supplier-paid and Adani-paid charges never apply to the same transaction." (slide 20)
- Which items and POs sit in each model will be decided after Adani's supplier data is evaluated (slides 6 and 19).

### 5.2 How a model is assigned: the Model Allocation Register

The proposal leaves allocation to a later agreement. The software therefore needs a governed register that records that agreement. Lines are never assigned by hand at order time. \[R\]

- **BR-MOD-01** \[R\]: MonoSource keeps a **Model Allocation Register**. Each entry assigns a model to a *scope*: business, company code or plant, crossed with category, item, ARC or supplier, plus validity dates. Entries are created only by a joint ProcMart–Adani approval. \[?AD\] \[?PM\]
- **BR-MOD-02** \[R\]: The most specific entry wins: ARC-level, then item-level, then category-level, then default. If two entries at the same level conflict, the line goes to an exception (EXC-MOD-01) and cannot proceed.
- **BR-MOD-03** \[R\]: Model 3 is a *process* scope, not a supply source. If a scope is under Model 3, then ARC lines within it are managed under Model 3 (3% fee, no supplier fee), and non-ARC lines are sourced under Model 3. This follows slide 19: "Everything in Model 2, plus…".
- **BR-MOD-04** \[R\] \[?AD\]: Model 1 lines sit inside or outside a Model 3 scope. Even inside a Model 3 scope, a line supplied by ProcMart as supplier of record carries **no** 3% fee, because ProcMart earns through supply (slide 19). This must be confirmed: the proposal does not say so explicitly.
- **BR-MOD-05** \[R\]: An item with an active eligible Adani ARC is never assigned to Model 1 while that ARC is active, unless Adani records an approved exception (EXC-RTE-04). \[?AD\]
- **BR-MOD-06** \[R\]: The model is resolved per requirement line, shown to the requester before submission, and **locked when the SAP PO line is released**. A later change needs the PO line cancelled and the line re-routed.
- **BR-MOD-07** \[R\]: A Model 1 price list is held as a contract record whose supplier is ProcMart, of type "ProcMart direct". This means the same ARC engine handles matching, validity and utilisation for both models.

### 5.3 Behaviour by model

| Question | Model 1: ProcMart direct | Model 2: ARC management | Model 3: Procurement process management |
| --- | --- | --- | --- |
| Who owns the supplier relationship | ProcMart (its own supply network, invisible to Adani) | Adani (contract), coordinated by ProcMart | Adani (contract and award), operated by ProcMart |
| Who receives the SAP PO | ProcMart, as an Adani vendor | ARC supplier | ARC supplier, or the supplier awarded by Adani |
| Who fulfils | ProcMart, through its supply network | ARC supplier | ARC supplier or awarded supplier |
| Who invoices Adani for goods | ProcMart | ARC supplier | ARC supplier or awarded supplier |
| Who dispatches and raises the e-way bill | ProcMart (or its sub-supplier on ProcMart's behalf) \[?PM\] | Supplier | Supplier |
| Who tracks delivery | ProcMart | ProcMart (follow-up) and supplier (updates) | ProcMart (expediting) and supplier (updates) |
| Who follows up on GRN | ProcMart (it is owed payment) | ProcMart, as coordinator \[P, slide 19\] | ProcMart \[P, slide 19\] |
| Who manages supplier communication | ProcMart | ProcMart, within ARC terms; commercial terms stay Adani's | ProcMart, including RFQs; award stays Adani's |
| Fees | None to Adani; margin in supply price | Indicative 1% from supplier to ProcMart; none to Adani | 3% (2.5% repeat) from Adani to ProcMart; none from supplier |
| Records MonoSource keeps | Price list, PO mirror, fulfilment, ProcMart supply invoice reference | ARC, utilisation, PO mirror, fulfilment, supplier-fee ledger | ARC, RFQ, quotes, comparison, award record, PO mirror, fulfilment, service-fee ledger |
| What the Adani buyer sees | Item, price, "Supplied by ProcMart", lead time | Item, ARC price, ARC supplier, contract reference, balance | ARC items as Model 2; RFQ status, comparison, recommendation, approval tasks |
| What the supplier sees | Not applicable to Adani-side suppliers; ProcMart's sub-suppliers see ProcMart only | Its own ARC, its POs, its delivery and GRN status, its fee statement | Its RFQ invitations, its own bids, its POs and statuses; never other suppliers' prices unless Adani enables rank visibility |
| What ProcMart operations sees | Everything, plus the internal supply cost | All POs, utilisation and exceptions for the scope; never its own Model 1 margin data next to ARC supplier prices in Adani-facing views | Everything in scope, including bid comparison |

### 5.4 Fee and invoicing rules

- **BR-FEE-01** \[P\]: Every PO line carries exactly one fee treatment: *None (Model 1)*, *Supplier enablement (Model 2)*, or *Management fee (Model 3)*. The system rejects any line with more than one.
- **BR-FEE-02** \[P\] \[R\]: The Model 3 fee accrues on **GRN-completed** quantity (slide 21). Recommended basis: GRN quantity × PO unit basic price, excluding GST \[R\]. Freight, packing and other PO charges excluded unless agreed otherwise \[?PM\] \[?AD\].
- **BR-FEE-03** \[R\] \[?PM\] \[?AD\]: A **repeat order** (2.5%) is a Model 3 PO line for a material that the same business already bought through a completed Model 3 sourcing event, re-bought within that award's validity, at the awarded price, with no new RFQ. ARC call-offs under Model 3 are treated as repeat orders after the first PO line against that ARC in each plant. Both definitions need commercial agreement.
- **BR-FEE-04** \[R\] \[?PM\]: The Model 2 supplier enablement fee accrues on GRN-completed value at the ARC price, excluding GST, unless the supplier agreement says otherwise. A supplier is ARC-enabled in MonoSource only after accepting the fee terms. What happens if a supplier refuses is open (question Q-C4).
- **BR-FEE-05** \[R\]: Fees reverse automatically when a GRN is reversed or goods are returned, and in the same billing period where possible. Otherwise a credit note is raised in the next one.
- **BR-FEE-06** \[P\]: The ₹10 lakh implementation fee is a one-off invoice, never tied to transactions.
- **BR-FEE-07** \[R\]: The Model 3 service invoice references a separate Adani service PO (slide 21). MonoSource keeps the open value of that PO and warns at 80% consumed.
- **BR-FEE-08** \[P\] \[?PM\]: Savings above the 2% target are shared 30:70 (ProcMart:Adani) on the agreed baseline method. That method is not yet defined (question Q-C6). MonoSource stores the baseline price for each item and plant once agreed.

### 5.5 Controls that prevent the four costly errors

| Error | Control \[R\] |
| --- | --- |
| Wrong invoicing (for example ProcMart invoicing goods in Model 2) | The PO's supplier of record must equal the invoicing party. A Model 2 or 3 PO cannot carry ProcMart as vendor unless the line is Model 1 |
| Duplicate orders | Duplicate check on requirement and PR: same plant, material, quantity band and delivery date within N days triggers a warning \[?AD for N\]. Each integration message carries an idempotency key (FRD requirement). A PR can be created only once per requirement line |
| Wrong supplier | The supplier must hold a valid ARC or award for the line, be active for the plant's company code in SAP, and be the mapped golden supplier entity. Otherwise the line is blocked |
| Wrong fee | Fee treatment comes from the model (BR-FEE-01), is locked at PO release, and is recalculated only from GRN events. Manual fee edits need ProcMart finance approval and are logged |

### 5.6 End-to-end flow by model

Each step names who acts. **U** = Adani plant user. **MS** = MonoSource platform. **PM-Ops** = ProcMart operations. **S** = supplier. **SAP** = Adani SAP.

**Model 1: ProcMart direct**

1. U searches the catalogue and adds a ProcMart-direct item at the category-agreed price. MS confirms the model, price validity and plant eligibility.
2. U submits. MS creates the requirement and sends a PR request to SAP with ProcMart's Adani vendor code as the desired vendor.
3. SAP creates the PR and runs Adani's release strategy. Adani approvers approve. SAP converts it to a PO addressed to ProcMart and releases it.
4. MS receives the PO, matches it to the requirement line, and checks price and quantity. PM-Ops acknowledges the PO in MS within the SLA.
5. PM-Ops places back-to-back orders in ProcMart's own supply chain (outside the Adani view), dispatches with an invoice and e-way bill, and records an ASN in MS.
6. U or the stores team receives the goods and posts the GRN in SAP. MS mirrors the GRN.
7. ProcMart's supply invoice is submitted to Adani and verified in SAP. MS mirrors invoice and payment status. The line closes when it is fully received, invoiced and paid, or short-closed.

**Model 2: ARC management**

1. U searches and finds the item at ARC price, with the ARC supplier and the contract balance shown.
2. MS runs the ARC checks (section 9): validity, plant applicability, balance, MOQ. U submits.
3. MS sends a PR request to SAP with the ARC supplier as the fixed vendor and the contract reference \[?AD: outline agreement number or info record\].
4. SAP approves, creates and releases the PO to the ARC supplier.
5. MS notifies S. S acknowledges in the supplier portal. PM-Ops follows up if S hasn't acknowledged within the SLA.
6. S dispatches and records an ASN with the invoice and e-way bill. MS tracks. PM-Ops expedites late lines.
7. The GRN is posted in SAP and mirrored in MS, and utilisation updates.
8. S invoices Adani. SAP verifies and pays, and MS mirrors status. The supplier fee accrues on the GRN and ProcMart invoices S periodically.

**Model 3: procurement process management**

1. U raises a requirement: catalogue items, free text, or attachments.
2. MS classifies each line. ARC-covered lines follow the Model 2 path, with the fee treatment set to Model 3. Lines with no ARC go to sourcing.
3. PM-Ops (helped by the drafting agent) builds the RFQ. Adani's category owner approves the supplier list where policy requires it. MS invites suppliers.
4. S submits quotes. MS normalises them (UOM, taxes, freight, lead time) and PM-Ops prepares the comparison and recommendation.
5. The Adani approver awards in MS: L1, or non-L1 with a recorded reason, per policy. MS sends a PR request to SAP with the awarded vendor and price.
6. SAP approves and releases the PO. From here the flow is Model 2 steps 5–8.
7. The management fee accrues on the GRN. ProcMart invoices Adani against the service PO.

## 6. Responsibilities of ProcMart, Adani, suppliers and SAP

**R** = does the work. **A** = accountable (one per row). **C** = consulted. **I** = informed. "SAP" means the event happens in, or is recorded by, Adani SAP. Columns: **PM-Ops** = ProcMart operations; **PM-Plat** = MonoSource platform and product; **Plant** = Adani plant user or stores; **Adani Proc** = Adani central or category procurement; **Fin** = Adani finance; **IT/MDM** = Adani IT and master data; **Supp** = supplier. All rows are \[R\], built on slides 12, 18 and 20, and need joint sign-off \[?AD\] \[?PM\].

| Activity | PM-Ops | PM-Plat | Plant | Adani Proc | Fin | IT/MDM | Supp | SAP |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Approve Model Allocation Register | C | I | I | A/R | C | I | I | – |
| Supply ARC documents and owners | C | I | I | A/R | I | I | C | – |
| Digitise ARC into MonoSource | R | C | I | A (sign-off) | I | I | C | – |
| Map Adani material codes to catalogue | R | C | I | C | I | A | I | Source |
| Create a new material code when missing | C | I | I | C | I | A/R | I | Record |
| Map supplier identities (golden record) | R | C | I | C | I | A | C | Source |
| Create or extend an Adani vendor code | C | I | I | C | C | A/R | C | Record |
| Catalogue content (images, specs) | A/R | C | I | C | I | I | C | – |
| Raise requirement or cart | I | System | A/R | I | I | I | I | – |
| Route line (model, ARC, supplier recommendation) | C | A/R (rule engine) | I | I | I | I | I | – |
| Approve routing deviation or off-contract purchase | C | Records | R (requests) | A | I | I | I | – |
| Run RFQ and comparison (Model 3) | A/R | System | C | C | I | I | R (bids) | – |
| Award decision | C (recommends) | Records | C | A/R | I | I | I | – |
| PR creation | C | R (request) | I | I | I | C | I | A (record) |
| PR and PO approval (release strategy) | I | Mirrors | C | A/R | C | I | I | Record |
| PO creation and release | I | Mirrors | I | A/R | I | I | I | Record |
| PO acknowledgement | R (follow-up) | Records | I | I | I | I | A/R | – |
| Dispatch, ASN, e-way bill | C | Records | I | I | I | I | A/R | – |
| Expediting and delivery follow-up | A/R | Alerts | C | I | I | I | R | – |
| GRN posting | R (follow-up) | Mirrors | A/R | I | I | I | I | Record |
| Quality rejection or return | C | Records | A/R | C | I | I | R | Record |
| Supplier invoice submission | C | Records | I | I | I | I | A/R | – |
| Invoice verification and payment | C (follow-up, Model 3) | Mirrors | C | I | A/R | I | I | Record |
| Supplier performance scoring | R | A (calculation) | C | C | I | I | I | – |
| ARC renewal and renegotiation | R (proposes) | Alerts | I | A | C | I | C | – |
| Fee invoicing (Models 2 and 3) | A/R | Computes ledger | I | C | C | I | I (Model 2 pays) | – |
| SLA and exception escalation | A/R | Timers | C | C | C | C | C | – |

**Boundaries that must never be crossed** \[P, slides 12 and 18\]:

- MonoSource never creates, releases or changes a PO outside SAP.
- MonoSource and ProcMart never approve a PR or PO for Adani.
- ProcMart never awards a contract or chooses the supplier on Adani's behalf. It recommends.
- Adani has the final say on every exception.

## 7. Supplier master and identity mapping

**Why this module exists.** Adani has 13,429 vendor codes across 11 SAP servers (slide 5). ProcMart has its own supplier base. Many suppliers exist in both, often under different codes, legal names, GSTINs or branches. Without a reconciled identity, three things go wrong. Suppliers get onboarded twice. ARC eligibility attaches to the wrong entity. Supplier performance and spend are split across duplicate records. Everything in this section is \[R\] unless tagged.

### 7.1 The identity model

| Level | Indian anchor | Example | Holds |
| --- | --- | --- | --- |
| **Golden supplier** (legal entity) | PAN (and CIN or LLPIN where applicable) | "Shree Bearings Pvt Ltd", PAN AAACS1234K | Legal name, constitution, MSME status, overall status, performance |
| **Tax registration** | GSTIN (one per state; contains the PAN) | 24AAACS1234K1Z5 (Gujarat) | State, GST status, registered address |
| **Branch or dispatch location** | Address under a GSTIN | Ahmedabad warehouse | Dispatch address, service regions, lead times |
| **System identity** | Adani vendor code (per SAP server or company code); ProcMart supplier ID | Adani S04: 100023456; ProcMart: PM-SUP-8812 | System-specific status, payment terms, bank details |
| **Portal user** | Person with role | Sales manager | Login, permissions |

One golden supplier has many GSTINs, branches and system identities. A system identity belongs to exactly one golden supplier.

### 7.2 Matching rules (how the same supplier is recognised)

| Priority | Evidence | Result |
| --- | --- | --- |
| 1 | Same PAN (taken directly or from characters 3–12 of the GSTIN) and same constitution type | **Auto-link** to the same golden supplier |
| 2 | Same GSTIN | **Auto-link** to the same tax registration |
| 3 | Same CIN or LLPIN | Auto-link (company or LLP) |
| 4 | Same bank account and IFSC, but different PAN | **Review**: never auto-link (possible related party, or a fraud signal) |
| 5 | Similar name and address (fuzzy) with no tax-ID match | **Review**: candidate only |
| 6 | No match | **New** golden supplier, pending verification |

- **BR-SUP-01**: A golden supplier is anchored on a verified PAN. Records with no PAN or GSTIN cannot become active golden suppliers. They stay "Unverified" and cannot receive ARC eligibility or POs routed by MonoSource. \[?AD: do any Adani vendors lack a PAN, such as foreign vendors? Those need a different anchor.\]
- **BR-SUP-02**: Auto-links are logged with the evidence used. Review matches go to a PM-Ops data steward, with Adani MDM consulted. Any link can be undone, and undoing it restores the separate records.
- **BR-SUP-03**: For a **sole proprietorship**, the PAN belongs to the proprietor, who may run several trade names. Trade names under one proprietor PAN stay as separate tax registrations or branches. They are not merged into one trading identity without review.
- **BR-SUP-04**: **Group companies** with different PANs stay separate golden suppliers. They can be linked under a "supplier group" for reporting only. ARC eligibility, POs and performance never transfer across PANs.
- **BR-SUP-05**: **Duplicate Adani vendor codes** for one PAN, whether across servers or within one, are all linked to one golden supplier. MonoSource never merges or blocks SAP vendor codes. It reports duplicates to Adani MDM for their decision. \[P, slide 25: "exceptions sent to Adani master data"\]
- **BR-SUP-06**: Verification uses a GSTIN and PAN verification source chosen by ProcMart \[?PM: provider\], at onboarding and on a schedule (recommended: quarterly, and before each ARC activation). A cancelled GSTIN suspends that tax registration automatically.

### 7.3 Suppliers that exist in only one ecosystem

| Situation | What happens | Documents collected |
| --- | --- | --- |
| In Adani SAP and ProcMart | Golden supplier created and both identities linked. The supplier is invited to *claim* its portal account | None, unless something is missing or expired |
| In Adani SAP only | Golden supplier created from SAP vendor data. The supplier claims its account with an OTP sent to the email or phone on the Adani vendor master \[?AD: are those contact fields reliable?\] | Only what MonoSource needs and SAP lacks, such as a catalogue or dispatch locations |
| In ProcMart only, needed for an Adani PO (Model 2 or 3 award) | MonoSource raises a **vendor-code extension request** to Adani, pre-filled with the KYC already held. Adani runs its own vendor onboarding and approval | Only what Adani's vendor form needs beyond what is held \[?AD: Adani's vendor-creation checklist\] |
| In ProcMart only, Model 1 sub-supplier | No Adani relationship needed: ProcMart is the supplier of record | None for Adani |
| In neither (new from sourcing) | Lightweight registration for RFQ participation. Full Adani vendor creation only if awarded | Light at RFQ stage; full on award |

- **BR-SUP-07**: A supplier is never asked to upload a document MonoSource already holds as valid, whether from ProcMart's records or synced from Adani. Each document is stored once against the golden supplier with its type, issuer, number, validity, source and verifier. It is reused across contexts unless Adani's policy requires a fresh copy. \[?AD\]
- **BR-SUP-08**: Commercial separation. ProcMart's own buying terms with a supplier (for Model 1 back-to-back supply) are never visible in any Adani-facing view, and Adani's ARC terms are never used to set ProcMart's Model 1 prices. \[?PM\] \[?AD\]: the data-use clause must be agreed (slide 25 says "Adani data used only for Adani").

### 7.4 Status and eligibility

A supplier can only be routed an order when *all* of these are true:

1. The golden supplier is **Active**: not Suspended, Blacklisted or Unverified.
2. The tax registration used for the dispatch is **Active** on GST.
3. The Adani vendor code for the plant's company code is **not blocked** for purchasing in SAP. SAP status is the master \[?AD: which block flags MonoSource reads\].
4. For ARC routing: the supplier holds an **active, eligible ARC** for that item and plant (section 9).
5. For RFQ invitation: the supplier is **approved** for that category by Adani's policy, or invited under an approved exception.
6. For Model 2 routing: the supplier has **accepted the MonoSource supplier terms** (BR-FEE-04) \[?PM\].

| Status change | Triggered by | Effect on new routing | Effect on open POs |
| --- | --- | --- | --- |
| Suspended (performance) | Adani procurement, on PM-Ops recommendation | Blocked | Continue. PM-Ops reviews each one \[?AD\] |
| Blacklisted | Adani | Blocked | Escalated to Adani to cancel or continue, line by line |
| GSTIN cancelled | Verification job | Blocked for that GSTIN | Flagged: invoices from that GSTIN can't be accepted |
| SAP vendor block | SAP sync | Blocked for that company code | Follows SAP behaviour |
| ARC expired or exhausted | ARC engine | Blocked under that ARC only | See section 9 (expiry rules) |
| Document expired (such as a licence) | Document registry | Warning, or block if Adani marks the document mandatory \[?AD\] | Flagged |

- **BR-SUP-09**: Every status change records who made it, why, the evidence, and its effective date. Statuses are shown to the supplier, except for internal review notes.

## 8. ARC management engine (part 1): lifecycle, configuration and governance

The ARC engine is the heart of the platform. The ₹800 Cr ARC base is Phase 1's whole scope \[P, slide 24\], and every Model 2 and Model 3 transaction depends on it. One engine handles four contract types \[R\]: **ARC** (annual), **QRC** (quarterly; 2,393 items per slide 6), **ProcMart direct price list** (Model 1, BR-MOD-07), and **Award contract** (the price that results from a Model 3 sourcing event, valid for the period the award states).

### 8.1 How an ARC enters the system

| Channel | When used | Processing | Source |
| --- | --- | --- | --- |
| Standard Excel or CSV template | Default for every new ARC | Column validation, then auto-mapping, then exception list | \[P\] slide 13 (bulk CSV/Excel), template \[R\] |
| Supplier's or Adani's own Excel layout | Legacy ARCs | Column-mapping step saved per source layout, then validation | \[R\] |
| PDF or scanned contract | ARCs that exist only as signed documents | AI extraction of header and line fields, then **mandatory human check of every line** before validation | \[R\] |
| Manual entry | Small ARCs and amendments | Same validation as uploads | \[R\] |
| SAP sync | If Adani holds ARCs in SAP as outline agreements or info records | Pull header, lines and conditions, then enrich in MonoSource | \[R\] \[?AD\]: are ARCs in SAP, and in what form? |

- **BR-ARC-01**: Every ARC, whatever its channel, passes the same states: **Draft → Validation → Pending Adani sign-off → Active**. Nothing is orderable before Active. \[P, slide 25: "Adani sign-off before go-live"\]
- **BR-ARC-02**: The signed source document is attached to the ARC, and each line keeps a link to its row or page in the source. A reviewer can then trace every price to the contract.

### 8.2 What an ARC holds

**Header (business data):** Adani contract reference; SAP agreement number if any; contract type; golden supplier and the Adani vendor code(s) it covers; issuing Adani entity (business or company code); start date and end date; total value cap; currency; payment terms; price-revision basis (fixed, periodic or indexed); freight and delivery terms; LD and warranty clauses; applicability scope; owner (Adani category manager); status; version.

**Line (business data):** Adani material code; ARC line description; clean catalogue description; specification attributes (by category template); approved brand(s) and model or MPN; supplier part number; order UOM, pack size, and conversion to SAP base UOM; MOQ; maximum order quantity; order multiple; price type (net, or brand discount); net price, *or* discount % plus the list-price reference; HSN and GST rate; whether freight is included; lead time (by zone if it varies); quantity cap; value cap; plant-level price overrides; line status.

### 8.3 Configuration rules

**Material codes**

- **BR-ARC-03**: Each ARC line must map to exactly one Adani material code per SAP server where it is used. The mapping is suggested automatically (from the ARC file, or by matching the SAP material master) and confirmed by a data steward. \[P, slide 14: "each item linked to its Adani code"\]
- **BR-ARC-04**: If no Adani code exists, the line stays "Pending code", and a material-creation request goes to Adani MDM. Whether a pending-code line can be ordered through a free-text PR is Adani's decision \[?AD\]. The recommendation is no, except during the pilot under an approved exception.
- **BR-ARC-05**: Where one Adani code carries several descriptions (5,253 such codes, slide 9), the steward chooses the canonical description for the catalogue and reports the others to Adani MDM. MonoSource does not change SAP descriptions.

**Specification, brand, UOM and pack size**

- **BR-ARC-06**: A line lists the brand or brands it allows. "Any equivalent" is allowed only if the ARC says so, and then equivalence rules apply (section 9).
- **BR-ARC-07**: Every line states its order UOM and a conversion factor to the SAP base UOM. For example, 1 box = 100 nos. The PR goes to SAP in SAP's order UOM. Prices are held per order UOM and converted for display.
- **BR-ARC-08**: Ordered quantity must be at least the MOQ and a whole multiple of the order multiple or pack size. Otherwise MonoSource proposes the next valid quantity, and the user must accept it or request an exception.

**Price: net price versus brand discount** (38,270 net-price items and 3,970 brand-discount items per slide 6)

- **BR-ARC-09**: A **net-price line** has a fixed price for its validity, unless an approved amendment changes it.
- **BR-ARC-10**: A **brand-discount line** has a price of list price × (1 − discount %). The list price comes from a **brand price list**, held with a version, an effective date and an approval. A new brand price list version needs PM-Ops validation and Adani sign-off before it takes effect \[?AD\]. A list-price rise above a set threshold (recommended: 5%) needs Adani category approval \[?AD\].
- **BR-ARC-11**: The price shown to the buyer always states its basis, for example "Net ARC price" or "List ₹1,240 (Brand list v2026-04) less 18% ARC discount".

**GST, freight and delivery**

- **BR-ARC-12**: GST is held per line as HSN and rate. Prices are held exclusive of GST, and GST is shown separately. Changes to the GST rate follow law, not ARC amendments: when the law changes, the rate updates and the basic price stays the same.
- **BR-ARC-13**: Freight is one of: *included*, *extra fixed per unit*, *extra by zone*, or *extra at actuals within a cap*. Lines with freight at actuals are flagged so the approver sees the full landed cost. \[?AD: which types Adani's ARCs use\]
- **BR-ARC-14**: Delivery terms (for example FOR destination or ex-works) and lead time are held per ARC, and per zone if they vary. Lead time sets the expected delivery date that the on-time KPI uses.

**Plant and business applicability**

- **BR-ARC-15**: Scope is set as include-lists of businesses, company codes or plants, and exclude-lists of plants. The default for a group-level ARC is all plants of the issuing entity's businesses. \[?AD: can an ARC signed by one business be used by another? This drives the "use across all plants" lever on slide 17\]
- **BR-ARC-16**: A line may carry **plant- or zone-level price overrides**. The most specific price wins: plant, then zone, then ARC base.

### 8.4 Validity, limits and governance

| State | Meaning | Orderable? | Entered by |
| --- | --- | --- | --- |
| Draft | Being created or extracted | No | PM-Ops |
| Validation | Automatic checks plus steward review | No | System, then PM-Ops |
| Pending sign-off | Waiting for the Adani contract owner | No | PM-Ops submits |
| Active | In force | Yes | Adani approval |
| Expiring | Within 60 days of the end date (configurable) | Yes, with a renewal alert | System |
| Suspended | Temporarily stopped (dispute, quality or supplier issue) | No (new orders) | Adani |
| Exhausted | Value or quantity cap reached | No (new orders) | System |
| Expired | Past the end date | No | System |
| Closed | All POs closed, nothing left to reconcile | No | System |

- **BR-ARC-17**: **Limits.** Header value cap, line quantity cap, line value cap and optional per-plant caps are checked against *committed plus ordered* utilisation (section 9.4). At 80% a warning goes to the ARC owner and PM-Ops. At 100% new orders are blocked, or overspend goes to an exception if Adani allows it \[?AD: tolerance %\].
- **BR-ARC-18**: **Amendments** (price change, item added or removed, validity extended, scope changed, cap changed) create a new ARC **version**, with an effective date, reason, approver and source document. Versions are never edited in place.
- **BR-ARC-19**: **Price changes never apply backwards** to PO lines already released. A PR still waiting for approval when a price changes is flagged. The approver sees both prices, and Adani policy decides which applies \[?AD\].
- **BR-ARC-20**: **Renewal.** Alerts go to the ARC owner and PM-Ops at 90, 60 and 30 days before expiry. The offered options are: renew on the same terms, renegotiate (PM-Ops proposes savings, slide 22), re-tender (a Model 3 event), short **bridging extension** (Adani approval), or let it lapse.
- **BR-ARC-21**: **Approvals.** ARC activation and every amendment need the Adani contract owner's approval. Price-related amendments may need a second approver above a threshold \[?AD: Adani's delegation of authority\].
- **BR-ARC-22**: **Supplier restrictions** may be held per ARC, for example a maximum number of open POs, service regions, or a delivery calendar. **Plant restrictions** may be held too, for example plants that must not use the ARC.
- **BR-ARC-23**: The supplier must **accept** each new ARC or version in the supplier portal before it goes Active. This proves the supplier agrees to the digitised terms \[R\] \[?AD: is acceptance needed, given the ARC is already signed?\].

## 9. ARC management engine (part 2): applicability, matching and utilisation

All rules in this section are \[R\] unless tagged.

### 9.1 Where a requirement line comes from

| Origin | What MonoSource knows | Matching needed |
| --- | --- | --- |
| Catalogue item added to cart | ARC line and price already attached | Eligibility re-check only (9.3) |
| Adani material code typed in | Exact code | Ladder from step 1 |
| Repeat of a past order | Previous ARC line or award | Re-check that it is still valid; re-match if expired |
| Free text or attachment | Description, possibly brand and spec | Ladder from step 4 or 5, with confirmation |
| Bulk upload of many lines | Mixed | Each line runs the ladder separately |

### 9.2 The matching ladder (how coverage is decided)

MonoSource tries each step in order and stops at the first that yields at least one candidate ARC line. The step that matched is recorded on the line as its **match basis**.

| Step | Match basis | Rule | Auto-route allowed? |
| --- | --- | --- | --- |
| 1 | **Exact Adani code** | Same material code on the same SAP server as the plant | Yes |
| 2 | **Supplier code or MPN plus brand** | Same supplier part number, or the same manufacturer part number and brand | Yes, once the user confirms the item card |
| 3 | **Approved equivalent code** | The code is on Adani MDM's list of duplicate or equivalent codes, mapped to an ARC code | Yes, shown as "equivalent code" \[?AD: does an equivalence list exist?\] |
| 4 | **Specification match** | Same category template, every mandatory attribute equal, and the brand allowed by the ARC line | Only after the user confirms. Logged |
| 5 | **Description similarity (AI)** | Suggestion ranked by similarity | **Never** auto-routes. The user or PM-Ops must confirm |

- **BR-MAT-01 Brand.** If the requester names a brand, only ARC lines allowing that brand match at steps 1–4. A different brand is offered as an *alternative*, marked as such, and only if the ARC line allows equivalents or Adani's approved-makes list includes it \[?AD\].
- **BR-MAT-02 UOM.** The requested quantity is converted into the ARC line's order UOM using the line's conversion factor. With no factor, there is no match, and the line goes to an exception (EXC-MAT-02), so the system never guesses.
- **BR-MAT-03 No silent near-miss.** If steps 4 or 5 find a candidate but the requester rejects it, the line is marked "ARC candidate declined" with a reason. It counts as a possible leakage case for reporting.

### 9.3 Eligibility filter (every candidate must pass every test)

1. The ARC version is **Active** (or Expiring) on the expected PO date.
2. The **plant is in scope** (BR-ARC-15).
3. The **supplier is routable** (section 7.4).
4. The quantity meets the **MOQ and order multiple**.
5. **Balance**: the remaining quantity or value is at least the requested quantity (or partly available, see 9.5).
6. The **lead time** can meet the need-by date. If not, the line stays eligible but is flagged "late against need-by".
7. No ARC or plant **restriction** blocks it.

**BR-MAT-04 Expiry crossing.** A PO released while the ARC is Active stays valid at the ARC price even if delivery falls after expiry, unless the ARC says otherwise. A PR still waiting for approval when the ARC expires is put on hold and goes to an exception (EXC-ARC-03). \[?AD\]

### 9.4 Choosing between several eligible ARCs (conflict resolution)

Slide 10 shows 24,803 items bought from two or more vendors, so several ARCs per item are likely. When more than one candidate passes 9.3, MonoSource ranks them in this order:

| Rank | Rule | Notes |
| --- | --- | --- |
| 1 | **Adani mandate**: an ARC marked sole or preferred for this plant or category | \[?AD\] whether mandates exist |
| 2 | **Allocation share**: if Adani split an award (for example 70/30 between L1 and L2), the ARC furthest below its target share | \[?AD\] |
| 3 | **Better match basis**: exact code beats supplier or MPN, which beats equivalent, which beats spec |  |
| 4 | **More specific scope**: plant-specific beats business-level, which beats group-level |  |
| 5 | **Lowest landed unit cost** for this plant: price (brand discount applied) plus freight, excluding GST | Shown to the user |
| 6 | **Meets the need-by date** |  |
| 7 | **Supplier performance score** at or above the threshold | Score per section 14 |
| 8 | **Earlier expiry** (use up the contract that ends first) | Tie-break only |

- **BR-MAT-05**: The top-ranked ARC is the **recommendation**. The user may pick another eligible ARC with a reason code. If the chosen ARC's landed cost is more than X% above the recommended one, approval is needed (APR-03) \[?AD: X, recommended 2%\].
- **BR-MAT-06**: If plants have different ARC prices for the same item, the plant only ever sees its own applicable price. Group users see the spread, which feeds price harmonisation (slide 10, lever 03).

### 9.5 Partial availability, expiry and no-match outcomes

| Situation | Outcome |
| --- | --- |
| Balance covers only part of the quantity | Offer a split: up to the balance on this ARC, the rest on the next-ranked eligible ARC. If there is none, the remainder goes to routing (section 10) as a non-ARC line, with the reason "ARC balance exhausted". PM-Ops is also told so they can raise a cap amendment |
| ARC expired, renewal in sign-off | Show "Renewal pending". The user may hold the requirement or ask for bridging under the old terms (Adani approval) |
| ARC expired, no renewal | Not eligible. Routed as a non-ARC line. The ARC owner is alerted |
| ARC suspended | Not eligible. Routed to the next ARC, or as non-ARC with reason "ARC suspended" |
| No candidate at any step | Non-ARC line, routed per section 10 |

### 9.6 Utilisation ledger: how each event moves the numbers

Utilisation is tracked per ARC line, and can be summed by plant, business, supplier and ARC header. Quantities are held in the ARC order UOM. Value = quantity × the applicable price on the PO line.

| Event (system) | Committed | Ordered | Dispatched | Received | Invoiced |
| --- | --- | --- | --- | --- | --- |
| PR created in SAP (MonoSource or SAP) | + PR qty |  |  |  |  |
| PR rejected or deleted | − PR qty |  |  |  |  |
| PO line released | − qty converted | + PO qty |  |  |  |
| PO quantity increased or decreased |  | ± change |  |  |  |
| PO line cancelled or short-closed |  | − open qty |  |  |  |
| ASN or dispatch (MonoSource) |  |  | + dispatched qty |  |  |
| GRN posted (SAP) |  |  |  | + accepted qty |  |
| GRN reversed (SAP) |  |  |  | − qty |  |
| Return to vendor |  | Unchanged if a replacement is due, else − qty |  | − qty |  |
| Invoice posted (SAP) |  |  |  |  | + qty and value |

- **BR-UTL-01 Balance used for checks** = Cap − (Committed + Ordered). Dispatched and received figures are for performance reporting, not for balance.
- **BR-UTL-02** Remaining value = Value cap − (Committed value + Ordered value). Both quantity and value caps apply; whichever is reached first blocks the line.
- **BR-UTL-03 Counting outside MonoSource.** To count all use of an ARC, MonoSource needs **every** SAP PO line for ARC-covered materials, including POs raised directly in SAP or Ariba. Otherwise both utilisation and leakage will be understated. \[?AD: SAP must provide a full PO feed for in-scope plants and materials, not just MonoSource-originated POs\]

### 9.7 Off-contract purchase detection

An **off-contract line** is an SAP PO line, from any channel, for a material that had an eligible active ARC at the plant on the PO date, where the PO went to a different vendor or at a price above the ARC price.

| Classification | Test | Treatment |
| --- | --- | --- |
| **Leakage** | Eligible ARC existed with balance, and no approved exception | Counted in the leakage KPI, reported to the plant head and category manager |
| **Justified** | ARC exhausted, supplier failed, lead time could not meet an urgent need, or an approved exception exists | Counted separately, and reason trends are reviewed |
| **Coverage gap** | The material is on an ARC that does not apply to this plant | Treated as an expansion opportunity (slide 17 lever "use across all plants") |
| **Price leakage** | Right vendor, but PO price above ARC price | Flagged to Adani procurement and the supplier |

- **BR-UTL-04** Off-contract lines raised *in MonoSource* are stopped before PR creation (section 10, scenario 8). Lines raised *outside* MonoSource are detected after the fact from the SAP PO feed.

## 10. Commercial model determination and supplier routing logic

Routing decides where each requirement line goes: which contract, which supplier, which model, and whether approval is needed. It is **not** "pick the cheapest". It protects Adani's contracts first, and it never favours ProcMart's own supply over an eligible Adani ARC. All rules are \[R\] unless tagged. The **\[?AD\] \[?PM\]** flags mark the policy points that must be signed off.

### 10.1 Routing decision tree (per requirement line)

1. **Is the line complete and valid?** It needs a material code or description, quantity, UOM, plant, delivery point, need-by date, and the account assignment Adani requires (cost centre, WBS, etc.).
   - No: return it to the requester with the missing fields.
   - Possible duplicate (BR-WF-03): warn, and the requester confirms or withdraws.
2. **Is the line in MonoSource's scope?** Check the Model Allocation Register.
   - Out of scope (for example a non-serviceable category kept by Adani): hand it back to Adani's normal process, and record it for visibility only. **End.**
3. **Is there an eligible Adani ARC?** Run the matching ladder (9.2), eligibility filter (9.3) and ranking (9.4).
   - Yes, with enough balance: **route to the top-ranked ARC supplier.** The model is 2 or 3, per the Register. Approval is needed only if the user overrides the ranking (APR-03). **End.**
   - Yes, with a partial balance: split the line (9.5). The covered part ends here, and the remainder continues to step 4.
   - An ARC exists but is not eligible (wrong plant, exhausted, expired or suspended): record the reason, and continue to step 4.
4. **Is there a valid Model 3 award contract** (a previous sourcing award still in its validity) for this item and plant?
   - Yes: **route to the awarded supplier** as a repeat order. **End.**
5. **Does ProcMart's direct price list cover the item for this plant, and is Model 1 allowed for this scope?**
   - Yes: **recommend Model 1** (ProcMart as supplier of record). Adani's approver sees that no ARC exists and the price basis. **End.** \[?AD: does Model 1 need a comparison quote above a value threshold?\]
6. **Is the line in a Model 3 scope?**
   - Yes: **go to sourcing** (10.3).
   - No: hand it back to the Adani buyer for their normal process, recorded as "returned: no route". **End.**

**Approval overlays at any step.** An override of the recommendation (APR-03), an off-contract choice (APR-04), an urgent or emergency path (APR-06), or a value above the Adani threshold (handled by SAP's release strategy) adds the matching approval. It never changes the route silently.

### 10.2 Routing priority matrix

| Priority | Route | Condition | Model | Supplier of record | Approval in MonoSource |
| --- | --- | --- | --- | --- | --- |
| 1 | Adani ARC (exact or equivalent code) | Eligible, with balance | 2 or 3 | ARC supplier | None, unless overridden |
| 2 | Adani ARC (spec match) | Eligible, user confirms the item | 2 or 3 | ARC supplier | None, unless overridden |
| 3 | Valid Model 3 award | Within validity and quantity | 3 | Awarded supplier | None |
| 4 | ProcMart direct | Item on the ProcMart list, Model 1 allowed, no eligible ARC | 1 | ProcMart | Adani-defined \[?AD\] |
| 5 | Limited quote from approved suppliers | Model 3, value below the competitive threshold | 3 | Selected supplier | Adani award approval |
| 6 | Competitive RFQ | Model 3, value at or above the threshold, or policy requires it | 3 | Awarded supplier | Adani award approval |
| 7 | Emergency purchase | Urgent need with a safety or production impact | 3 or Adani direct | As approved | Post-facto per Adani policy \[?AD\] |
| 8 | Return to Adani | No route in scope | – | – | – |

**Where Model 1 sits.** Model 1 ranks *below* Adani ARCs and valid awards. Whether it should rank above or below competitive sourcing for On Quote items is a commercial decision. The recommendation is: Model 1 is the default for items on ProcMart's direct list, but Adani may require a periodic market benchmark of ProcMart's category prices \[?AD\] \[?PM\].

### 10.3 Sourcing path (Model 3)

- **BR-RTE-01**: The sourcing method follows Adani's procurement policy thresholds: the number of quotes needed by value band, and when an open RFQ is needed versus an approved-supplier RFQ \[?AD: the value bands\]. Until Adani supplies them, no default is assumed. The pilot cannot launch sourcing without them.
- **BR-RTE-02**: The invited suppliers are Adani-approved suppliers for the category, plus ProcMart network suppliers that Adani's category owner has approved for this event, plus Model 1 (ProcMart) if Adani allows ProcMart to bid \[?AD\] \[?PM\]. If ProcMart bids, PM-Ops staff who run the event must not see competing bids before the close. Otherwise, ProcMart must not bid in events it runs. **This is a conflict of interest that must be decided** (question Q-C2).
- **BR-RTE-03**: The recommended award is L1 on landed cost among technically acceptable bids. A non-L1 award needs a recorded reason and approval per Adani policy \[P, slide 20: "Adani approves L1 per policy"\].

### 10.4 Order splitting rules

- **BR-RTE-04**: One requirement can produce several **streams**. A stream groups lines with the same plant, model, supplier of record and purchasing group. Each stream becomes one PR request. SAP may still split POs by vendor as usual.
- **BR-RTE-05**: Every split keeps the chain: requirement → requirement line → stream → PR line → PO line → schedule line → shipment → GRN → invoice. A user can always see the parent requirement and its completion.
- **BR-RTE-06**: A line is never split across models silently. The requester sees the split before submission.
- **BR-RTE-07**: Lines with different delivery points or need-by dates may share a PR but carry separate schedule lines \[?AD: SAP practice\].

### 10.5 The ten scenarios

| # | Scenario | How MonoSource handles it |
| --- | --- | --- |
| 1 | Item on an active Adani ARC | Steps 1–3: route to the ARC supplier. The PR is created with the ARC vendor and contract reference. Adani's SAP release strategy applies unchanged |
| 2 | Item in ProcMart's portfolio | First check for an eligible Adani ARC (BR-MOD-05). If none: step 5, Model 1, supplier of record ProcMart, PR with ProcMart's vendor code |
| 3 | Item on several ARCs | Ranking in 9.4: mandate, then allocation share, then match basis, scope, landed cost, need-by, performance and expiry. The user may override with a reason, and approval is needed above the cost threshold |
| 4 | No ARC | Step 4 (award), then step 5 (Model 1), then step 6 (sourcing by threshold, or return to Adani) |
| 5 | Supplier in both systems | Routing uses the golden supplier. The PR carries the Adani vendor code valid for the plant's company code. If the supplier has no code for that company code, routing is blocked and a vendor-code extension request goes to Adani MDM. The supplier is not registered again |
| 6 | Supplier can't fulfil the full quantity | At acknowledgement, the supplier accepts a partial quantity and date. PM-Ops proposes cover for the remainder (next ARC, then award, then Model 1, then sourcing). Adani reduces the PO quantity in SAP, and a new stream for the remainder is linked to the same requirement line. The approval follows the new route |
| 7 | Several plants need the same item | Aggregation window (10.6). Each plant keeps its own PR, PO and GRN unless Adani uses central POs. The consolidated volume is used for RFQ or renegotiation |
| 8 | Plant tries an off-contract purchase | MonoSource shows the eligible ARC, its price and the difference. The user must give a reason code. APR-04 approval is needed. The line is logged as "justified" or "leakage" |
| 9 | Supplier fails after the PO | Escalation ladder (EXC-FUL-02): reminder, PM-Ops call, then escalation to Adani. Adani decides to extend, or to cancel and reallocate. Reallocation creates a new stream on the same line. The failure is recorded for supplier performance, and LDs apply per contract \[?AD\] |
| 10 | One requirement, several models | Per-line routing, with streams grouped by model and supplier (BR-RTE-04). The parent requirement shows all streams and their status |

### 10.6 Demand consolidation rules (scenario 7)

- **BR-RTE-08**: For categories Adani marks as consolidable, requirements wait in an **aggregation window**, for example weekly. The window is set per category \[?AD\].
- **BR-RTE-09**: A line joins the window only if its need-by date minus the expected lead time is after the window closes. Urgent lines never wait.
- **BR-RTE-10**: Consolidation crosses plants only within the same purchasing organisation, unless Adani allows otherwise \[?AD\]. On ARC lines it improves volume visibility for renegotiation. On Model 3 lines it produces one RFQ covering every plant's delivery point, then separate POs per plant.

### 10.7 Routing logic in structured business form

This is the decision logic in plain structured steps, written for the business teams to validate. It is not code.

1. For each requirement line L:
   1. Validate L. If invalid, return L to the requester and stop.
   2. Look up the scope in the Model Allocation Register. If out of scope, hand L to Adani and stop.
   3. Find candidate ARC lines using the matching ladder. Keep those that pass every eligibility test. Rank them.
   4. If at least one is eligible:
      1. Take the top-ranked ARC, A.
      2. If A's balance covers L's quantity, assign L to A. The model comes from the Register. Stop.
      3. Otherwise assign A's balance to A, then continue with the remaining quantity using the next ARC, and so on. Any quantity left over continues to step 5.
   5. If a valid Model 3 award covers L, assign L to the award and stop.
   6. If ProcMart's direct list covers L and Model 1 is allowed, assign L to ProcMart (Model 1) and stop.
   7. If L is in a Model 3 scope, choose the sourcing method from Adani's value thresholds and send L to sourcing. Stop.
   8. Otherwise hand L back to Adani with the reason "no route".
2. Add any approvals the line triggers (override, off-contract, urgency).
3. Group lines into streams by plant, model, supplier of record and purchasing group.
4. Show the requester the routing result and the reason for each line before submission.

### 10.8 Ten routing examples (hypothetical data)

| # | Requirement (hypothetical) | What MonoSource finds | Routing result |
| --- | --- | --- | --- |
| R1 | Cement plant P-101: 200 nos of bearing 6205-2RS, brand SKF | ARC-A (SKF, exact code, ₹182, balance 5,000) | ARC-A, Model 2. No approval beyond SAP |
| R2 | Same item at Ports plant P-702 | ARC-A applies to Cement plants only. ProcMart list has it at ₹190 | Coverage gap logged. Model 1 to ProcMart, if allowed for Ports |
| R3 | 50 reams of A4 paper at P-101 | ARC-B (₹245) and ARC-C (₹238), both group-level, 60/40 allocation, ARC-B under its share | ARC-B on allocation share (rank 2). The user sees ARC-C is cheaper. An override to ARC-C is allowed without approval because it is cheaper |
| R4 | 1,000 safety gloves; ARC-D balance 600 | Partial balance | 600 on ARC-D; 400 to the next eligible ARC, else Model 1; PM-Ops alerted to raise the cap |
| R5 | Custom gasket drawing (free text plus PDF) | No match at steps 1–4. AI suggests a 62% similar item | Not auto-routed. Model 3 scope, so it goes to RFQ by value band |
| R6 | Hydraulic hose; the user picks a local vendor although ARC-E is eligible | Off-contract attempt | Warning with ARC price. Reason code "urgent breakdown" plus APR-04 approval. Logged as justified |
| R7 | Cable 4C x 16 sq mm, 2 km; the ARC supplier has no vendor code for the Thermal company code | Golden supplier found, vendor code missing | Blocked. Vendor-code extension request to Adani MDM. The requester sees "waiting for vendor extension" |
| R8 | Cart with 6 lines: 3 ARC, 2 ProcMart-direct, 1 unmatched | Mixed | Three streams: Model 2 (ARC), Model 1 (ProcMart), Model 3 sourcing. One parent requirement |
| R9 | Toner cartridge priced by brand discount: list ₹4,000, ARC discount 22% | Brand list v2026-04 active | Price ₹3,120 shown with its basis. Routed to the ARC |
| R10 | 20 tons of lime for three Cement plants, Model 3 | No ARC. Consolidable category | Weekly window: one RFQ covering three delivery points, award L1, three plant POs |

## 11. Requirement-to-order-to-delivery workflow

The 25 stages below run from the moment a plant user raises a need until the line is closed. Stages 6–11 apply only to lines that go to sourcing (Model 3). Stages owned by SAP are only **mirrored** in MonoSource, never decided there \[P, slide 12\]. PR, PO, acknowledgement, dispatch, delivery (proof of delivery) and GRN are six separate events with six separate timestamps. All rules are \[R\] unless tagged.

### 11.1 Stages: who, what rules, and what status results

| # | Stage | Initiator → responsible | Key inputs and business rules | Line status after |
| --- | --- | --- | --- | --- |
| 1 | Requirement creation | Plant user → plant user | Plant, delivery point, need-by date, account assignment; user must be authorised for the plant (BR-ORG-01); duplicate check (BR-WF-03) | Draft → Submitted |
| 2 | Item identification | MonoSource → user confirms | Matching ladder; free text needs confirmation; missing code goes to MDM request | Identified / Pending code |
| 3 | ARC and catalogue matching | MonoSource | Eligibility, ranking and balance (section 9) | ARC-matched / Not covered |
| 4 | Model determination | MonoSource | Model Allocation Register (5.2); lock happens later, at PO release | Routed (Model 1/2/3) |
| 5 | Supplier selection or sourcing decision | MonoSource recommends → user accepts | Routing tree (10.1); overrides need reasons and approvals | Supplier assigned / To sourcing |
| 6 | RFQ generation | PM-Ops (with drafting agent) → PM-Ops | Spec, quantity, delivery points, terms, evaluation criteria, closing date; method by Adani value band | RFQ draft → RFQ approved |
| 7 | Supplier invitations | PM-Ops → Adani category owner approves the list (where policy needs it) | Only eligible suppliers (7.4); at least N invitees per policy | Invited |
| 8 | Quotation submission | Supplier → supplier | Before the deadline; sealed until close \[?AD\]; alternative offer allowed if enabled | Quotes received |
| 9 | Quotation comparison | MonoSource normalises → PM-Ops reviews | Same UOM, ex-GST, landed cost, lead time, technical compliance | Comparison ready |
| 10 | Negotiation | PM-Ops, within the mandate Adani set | Rounds logged; never shares one supplier's price with another unless the event rules allow it | Negotiated |
| 11 | Commercial approval (award) | PM-Ops recommends → Adani approver awards | L1 or justified non-L1 (BR-RTE-03); approver per Adani DoA \[?AD\] | Awarded |
| 12 | PR creation in SAP | MonoSource requests → SAP creates | One PR per stream; vendor, price and contract reference carried; idempotent | PR requested → PR created |
| 13 | SAP approval | SAP release strategy → Adani approvers | Unchanged Adani control \[P\] | PR approved / rejected |
| 14 | PO generation | Adani buyer or SAP auto-conversion | PO price must match the routed price within tolerance (EXC-PRC-01) | PO released |
| 15 | PO transmission to supplier | SAP or MonoSource (agreed channel \[?AD\]) | The supplier must receive the released version only | PO sent |
| 16 | Supplier acknowledgement | Supplier → supplier; PM-Ops follows up | Accept fully, accept partly (quantity and date), or reject with a reason; SLA \[?AD\] | Acknowledged / Partly accepted / Rejected |
| 17 | Order processing | Supplier | Supplier marks progress stages (slide 15: acknowledged, processing, dispatched, delivered) | In processing |
| 18 | Dispatch | Supplier | ASN with quantity, invoice number, e-way bill, transporter and LR number; cannot exceed the open PO quantity plus tolerance | Dispatched / Partly dispatched |
| 19 | Shipment tracking | Supplier or transporter updates → PM-Ops monitors | Expected delivery date versus PO delivery date | In transit / Delayed |
| 20 | Partial delivery | Supplier | Each shipment tracked separately; the PO line stays open for the balance | Partly delivered |
| 21 | GRN | Plant stores → SAP | Accepted and rejected quantities; quality inspection where Adani uses it | Partly received / Received |
| 22 | Invoice submission | Supplier (Model 2/3) or ProcMart (Model 1) | Invoice GSTIN must belong to the supplier of record; must reference the PO | Invoiced (pending verification) |
| 23 | Invoice verification | Adani finance in SAP | Three-way match (PO, GRN, invoice) per Adani practice \[?AD\] | Invoice verified / blocked |
| 24 | Payment-status visibility | SAP → mirrored | Read-only in MonoSource | Paid / Partly paid / Due |
| 25 | Order closure | System, when conditions are met | Fully received, invoiced and paid, or short-closed by Adani in SAP; fee ledger settled | Closed |

### 11.2 Stages: integration events, notifications, failures and audit

| # | Integration event (business level) | Notifications | Failure scenarios and handling | Audit record |
| --- | --- | --- | --- | --- |
| 1 | None | Confirmation to the requester | Unauthorised plant: blocked; duplicate: warning | Who, when, every field |
| 2 | Material master lookup (SAP data held in MonoSource) | MDM request to Adani if the code is missing | No code: Pending code (BR-ARC-04) | Match basis and who confirmed |
| 3 | None (MonoSource ARC data) | None | Balance changed meanwhile: re-check before PR | ARC version, price and balance at that moment |
| 4 | None | None | Register conflict: EXC-MOD-01 | Register entry used |
| 5 | None | Approver task if overridden | Supplier blocked: next-ranked | Recommendation, choice and reason |
| 6 | None | None | Spec incomplete: back to requester | Draft versions |
| 7 | None | Invitation to suppliers (email plus portal) | Too few suppliers: approval to proceed, or extend the list | Invite list and approver |
| 8 | None | Reminders before the deadline | Late bid: rejected unless the event allows | Bid timestamps, sealed |
| 9 | None | Comparison ready to PM-Ops | Missing fields: clarification round | Normalisation rules applied |
| 10 | None | Supplier round notices | Mandate exceeded: escalate to Adani | Every round and offer |
| 11 | Optional: award to SAP as a contract or info record \[?AD\] | Award to the winner; regret to others | Approver absent: delegation per DoA | Approver, reason, non-L1 justification |
| 12 | **PR create request → SAP; PR number ← SAP** | PR number to the requester | SAP rejects (data or budget): EXC-INT-01; retry is idempotent | Request, response and retries |
| 13 | **PR release status ← SAP** | Approved or rejected to the requester | Stalled approval: reminder after N days \[?AD\] | Each release step mirrored |
| 14 | **PO released ← SAP** (number, version, lines, price) | Requester and PM-Ops | Price or vendor differs from routing: EXC-PRC-01 | PO version mirrored |
| 15 | PO to supplier (SAP output or MonoSource) | Supplier notified | Not delivered: resend; PM-Ops calls | Delivery proof |
| 16 | Acknowledgement → SAP (optional) \[?AD\] | Requester sees the commitment date | No acknowledgement within SLA: escalation ladder | Acknowledgement version and dates |
| 17 | None | None | Stalled: follow-up | Stage changes |
| 18 | ASN → SAP as inbound delivery (optional) \[?AD\] | Plant stores told what is coming | ASN over quantity: blocked | ASN and documents |
| 19 | Tracking feeds (transporter) | Delay alert to requester and PM-Ops | Predicted late: escalation (EXC-FUL-01) | Tracking events |
| 20 | As 18 | As 18 | Balance never shipped: short-close request to Adani | Each shipment |
| 21 | **GRN ← SAP** | Requester; supplier sees GRN status | Short or damaged: rejection flow (EXC-QUA-01) | GRN number, quantities |
| 22 | Invoice copy uploaded; posting status ← SAP | Finance and PM-Ops (Model 3 follow-up) | GSTIN mismatch: rejected (EXC-INV-01) | File and checks |
| 23 | **Invoice status ← SAP** | Supplier sees the status | Blocked (price or quantity variance): resolution task | Status mirrored |
| 24 | **Payment status ← SAP** | Supplier sees the status | Feed missing: shown as "status unavailable", never guessed | Status mirrored |
| 25 | None | Closure notice | Open fee or credit items: closure waits | Closure reason |

### 11.3 Workflow rules

- **BR-WF-01**: MonoSource shows SAP-owned statuses only as SAP reports them, with a "last synced" time. It never shows an assumed status. \[R\]
- **BR-WF-02**: A requirement line can be cancelled in MonoSource only before a PR exists. After that, cancellation is an SAP action (PR deletion or PO cancellation), which MonoSource mirrors.
- **BR-WF-03**: Duplicate check. The same plant, material, quantity within ±10% and need-by date within 7 days of an open line triggers a warning. The thresholds are configurable \[?AD\].
- **BR-WF-04**: Returns and rejections. A rejected quantity at GRN opens a return case. The supplier chooses replace or credit. Replacement keeps the PO line open; credit reduces the invoiceable quantity. Fees reverse (BR-FEE-05).
- **BR-WF-05**: PO amendments made in SAP (quantity, date, price) are mirrored as a new PO version. Utilisation and fees recalculate from the new version. A price change on an ARC line triggers an EXC-PRC-01 check.

## 12. Exception handling and approval boundaries

### 12.1 Exception matrix

Each exception has an owner, a time limit to resolve it (SLA), and an escalation path. The SLA values are placeholders until Adani and ProcMart agree them \[?AD\] \[?PM\]. Slide 25 commits both sides to an SLA set and an escalation matrix.

| ID | Exception | Detected by | Owner | Proposed SLA | Escalates to | Resolution options |
| --- | --- | --- | --- | --- | --- | --- |
| EXC-MOD-01 | Model Allocation Register conflict for a line | Routing | PM-Ops | 1 working day | Adani category owner | Fix the register (joint approval) |
| EXC-RTE-04 | Model 1 requested for an item with an eligible Adani ARC | Routing | Adani category owner | 2 working days | Adani procurement head | Approve the exception with a reason, or use the ARC |
| EXC-MAT-02 | No UOM conversion | Matching | PM-Ops data steward | 1 working day | Adani MDM | Add the factor, or re-identify the item |
| EXC-MAT-03 | Material code missing | Matching | Adani MDM | Per Adani MDM SLA \[?AD\] | Adani MDM lead | Create the code, or map to an existing one |
| EXC-ARC-01 | ARC balance at or above 80% | Utilisation | ARC owner and PM-Ops | Informational | – | Plan an amendment or renewal |
| EXC-ARC-02 | ARC balance exhausted | Utilisation | ARC owner | 2 working days | Category head | Cap amendment, next ARC, or sourcing |
| EXC-ARC-03 | ARC expired with a PR pending | ARC engine | ARC owner | 2 working days | Category head | Bridging extension, or re-route |
| EXC-ARC-04 | Brand list-price change above the threshold | ARC engine | Adani category owner | 3 working days | Category head | Approve or reject the new list |
| EXC-PRC-01 | SAP PO price differs from the routed price beyond tolerance | PO mirror | PM-Ops | 1 working day | Adani buyer | Correct the PO in SAP, or record the reason |
| EXC-SUP-01 | Supplier blocked or GSTIN cancelled with open POs | Supplier sync | PM-Ops | 1 working day | Adani supplier management | Continue, cancel or reallocate (Adani decides) |
| EXC-SUP-02 | Vendor code missing for the company code | Routing | Adani MDM | Per Adani SLA | Adani MDM lead | Extend the vendor, or re-route |
| EXC-OFC-01 | Off-contract attempt in MonoSource | Routing | Plant head (APR-04) | 1 working day | Category head | Approve as justified, or use the ARC |
| EXC-OFC-02 | Off-contract PO raised outside MonoSource | SAP PO feed | PM-Ops (reporting) | Weekly review | Monthly ops review (slide 25) | Classify; act through governance |
| EXC-ACK-01 | No PO acknowledgement within the SLA | Timer | PM-Ops | 24 hours after release \[?AD\] | Adani buyer | Chase, then reallocate |
| EXC-ACK-02 | Supplier rejects or partly accepts | Supplier portal | PM-Ops | 1 working day | Adani buyer | Re-route the remainder (scenario 6) |
| EXC-FUL-01 | Predicted or actual delay against the PO date | Tracking | PM-Ops | Same day | Adani buyer, then category head | Expedite, accept a new date, or reallocate |
| EXC-FUL-02 | Supplier fails to dispatch after acknowledging | Timer | PM-Ops | Day 0: reminder; day +3: call; day +7: escalation \[?AD\] | Adani category head | Extend, or cancel and reallocate; record LD |
| EXC-QUA-01 | GRN rejection or short receipt | GRN mirror | Plant stores | Per Adani QA | Category owner | Replacement, credit or debit note |
| EXC-INV-01 | Invoice GSTIN not the supplier of record's, or invoice without a PO | Invoice upload | PM-Ops | 1 working day | Adani finance | Reject and re-issue |
| EXC-INV-02 | Invoice blocked in SAP (variance) | Invoice mirror | Adani finance; PM-Ops follows up in Model 3 | Per Adani finance | Finance head | Resolve the variance |
| EXC-INT-01 | SAP rejects a PR request, or the integration fails | Integration | PM-Plat support | 4 business hours | Adani IT | Fix the data and retry (idempotent) |
| EXC-FEE-01 | Fee treatment missing or conflicting on a PO line | Fee ledger | ProcMart finance | Before the billing run | ProcMart commercial head | Correct the model mapping |
| EXC-DUP-01 | Possible duplicate requirement | Requirement | Requester | Immediate | – | Confirm or withdraw |

### 12.2 Approval boundaries

SAP's release strategy stays the approval for every PR and PO \[P\]. The approvals below are **in addition**, for decisions MonoSource makes or records before SAP. Who approves each one depends on Adani's delegation of authority (DoA), which has not been supplied \[?AD\].

| ID | Decision | Approver (proposed) | Basis |
| --- | --- | --- | --- |
| APR-01 | Activate or amend an ARC | Adani contract owner (second approver above a value threshold) | BR-ARC-21 |
| APR-02 | Change the Model Allocation Register | Adani procurement head and ProcMart account head | BR-MOD-01 |
| APR-03 | Override the recommended ARC or supplier at higher landed cost (above X%) | Plant procurement manager | BR-MAT-05 |
| APR-04 | Off-contract purchase when an eligible ARC exists | Plant head, or the category manager per DoA | Scenario 8 |
| APR-05 | Award to a non-L1 bidder | Per Adani policy \[P, slide 20\] | BR-RTE-03 |
| APR-06 | Emergency purchase bypassing normal sourcing | Per Adani emergency-purchase policy | Matrix priority 7 |
| APR-07 | Supplier suspension or reinstatement | Adani supplier management | Section 7.4 |
| APR-08 | Manual fee adjustment | ProcMart finance, with an Adani finance copy for Model 3 | BR-FEE-01 |
| APR-09 | Bridging extension of an expired ARC | Adani contract owner | BR-ARC-20 |

### 12.3 What automation, including AI agents, may never do

- Approve, award, sign or accept any commercial term for Adani.
- Create, change, release or cancel an SAP PR or PO on its own. It may only *request* a PR on a user's submission.
- Change an ARC price, scope or cap.
- Share one supplier's price with another supplier.
- Suspend or blacklist a supplier.
- Post a GRN, or mark an invoice as verified or paid.
- Change a fee amount.

Every agent suggestion that a human accepts or rejects is logged with the suggestion, the evidence it used, the human's decision, and the reason for any override. This is Zinit's "deviation auditor" idea \[Z\], applied under human authority.

## 13. Worked business examples

**All names, codes, quantities and prices below are hypothetical.** They exist to test the rules above. Fee amounts use the fee rates proposed on slide 20 and the fee bases recommended in this BRD (BR-FEE-02 to 04), which are not yet agreed.

### Example A: a plant orders an item on an existing Adani ARC

- **Requirement:** Cement plant P-101 needs 300 nos of bearing 6205-2RS (SKF), Adani code 10045522, by 20 Dec.
- **System decision:** step 1 exact-code match to ARC-A (Shree Bearings, ₹182 net, cap 5,000 nos, balance 4,100). Eligible and in scope. Register says Model 2.
- **Supplier selection:** Shree Bearings, recommended and accepted. No override.
- **PR/PO:** PR request to SAP with Shree Bearings' vendor code and the ARC reference. The PR is approved under Adani's release strategy, and PO 4500012345 is released. Utilisation moves 300 from committed to ordered, so the balance check now shows 3,800.
- **Supplier interaction:** Shree acknowledges in 6 hours with delivery on 15 Dec.
- **Dispatch and GRN:** one shipment of 300, with an ASN and e-way bill. GRN accepts 298 and rejects 2 (damaged). A return case opens and the supplier sends 2 replacements. GRN for 2.
- **Invoice and payment:** Shree invoices ₹54,600 plus GST to Adani. SAP verifies it, and payment shows as paid on its due date.
- **Fee:** 1% supplier enablement fee on GRN value: 300 × ₹182 × 1% = **₹546**, invoiced by ProcMart to Shree. Nothing to Adani.
- **Final status:** Closed (fully received, invoiced, paid).

### Example B: a plant orders an item supplied directly by ProcMart

- **Requirement:** Renewable Power site P-455 needs 40 reams of A4 paper.
- **System decision:** no eligible Adani ARC for this plant. ProcMart's direct list has it at ₹240 per ream for Renewable Power, and Model 1 is allowed for Stationery.
- **Supplier selection:** ProcMart is the supplier of record.
- **PR/PO:** PR with ProcMart's Adani vendor code, approved in SAP. PO released to ProcMart.
- **Supplier interaction:** PM-Ops acknowledges and fulfils from ProcMart's network. Back-to-back buying is invisible to Adani.
- **Dispatch and GRN:** ProcMart dispatches with its own invoice and e-way bill. GRN for 40.
- **Invoice and payment:** ProcMart's supply invoice of ₹9,600 plus GST, against the PO, on GRN.
- **Fee:** none (Model 1).
- **Final status:** Closed.

### Example C: an item with no ARC, which needs competitive sourcing

- **Requirement:** Thermal plant P-220 needs 40 nos of a 4″ class-600 gate valve, specification attached.
- **System decision:** no match at steps 1–4. No award contract. Not on ProcMart's list. Model 3 scope. Value estimated at about ₹7.5 lakh, which falls in Adani's (assumed) "3 quotes minimum" band.
- **Sourcing:** PM-Ops drafts the RFQ, and the Adani category owner approves 5 invitees. 4 bids arrive. After normalisation, L1 is ₹18,500 landed per unit. The Adani approver awards L1.
- **PR/PO:** PR to SAP with the awarded supplier and price. PO released.
- **Dispatch and GRN:** delivered in full, 3 days late. That counts against on-time delivery. GRN for 40.
- **Invoice and payment:** supplier invoices ₹7,40,000 plus GST to Adani.
- **Fee:** 3% Model 3 management fee on GRN value: ₹7,40,000 × 3% = **₹22,200**, invoiced by ProcMart to Adani against the service PO. The award is recorded as an award contract valid for 12 months \[?AD\], so a re-order within that time is a repeat order at **2.5%**.
- **Final status:** Closed.

### Example D: the same supplier is registered in ProcMart and Adani under different IDs

- **Data found:** ProcMart PM-SUP-8812 "Shree Bearings Pvt Ltd" (GSTIN 24AAACS1234K1Z5). Adani S04 vendor 100023456 "SHREE BEARINGS PRIVATE LIMITED" (same GSTIN). Adani S07 vendor 200077889 with GSTIN 27AAACS1234K1Z1 (Maharashtra).
- **System decision:** all three share the PAN AAACS1234K, so they **auto-link** to golden supplier G-0001 with two tax registrations. S04 and S07 are reported to Adani MDM as one entity holding two codes. MonoSource does not merge them in SAP.
- **Onboarding:** Shree claims its portal account with an OTP sent to the email on the S04 vendor master. No documents are collected again. Its GST certificate, PAN and cancelled cheque are already held and valid.
- **Routing:** ARC-A was signed with S04's entity. A P-101 order (on server S04) uses 100023456. A Maharashtra plant on server S07 uses 200077889, if ARC-A's scope includes that plant. The dispatch GSTIN must belong to PAN AAACS1234K.
- **Final status:** one supplier, one performance score, one portal account, with spend reported together.

### Example E: three plants need the same material, and demand is aggregated

- **Requirements:** three Cement plants need safety helmets (Model 3 scope, a consolidable category, no ARC): P-101 needs 400, P-115 needs 250 and P-130 needs 350. All need-by dates are 3 or more weeks away.
- **System decision:** all three join the weekly aggregation window, giving 1,000 units in one RFQ with three delivery points.
- **Sourcing:** L1 is ₹310 landed, against a baseline average of ₹355 for the same plants \[baseline method per Q-C6\].
- **PR/PO:** three PRs and three POs, one per plant, so that each plant posts its own GRN.
- **Outcome:** savings of (355 − 310) × 1,000 = **₹45,000** recorded against the baseline. Model 3 fee of 3% × ₹3,10,000 = ₹9,300 on GRN. A candidate ARC is proposed to Adani for next year.

### Example F: an ARC supplier cannot fulfil the full quantity

- **Requirement:** Ports plant P-702 needs 2,000 m of cable 4C × 16 sq mm. ARC-F (Delta Cables) is eligible, with a balance of 10,000 m.
- **Supplier interaction:** at acknowledgement, Delta accepts 1,200 m by the due date and declines 800 m. This raises EXC-ACK-02.
- **System decision:** no other eligible ARC. ProcMart's direct list has the cable. Adani's buyer agrees to Model 1 for the 800 m remainder, which is allowed because no ARC can fulfil it.
- **PR/PO:** Adani reduces PO 1 to 1,200 m in SAP, so utilisation on ARC-F frees 800 m. A new stream raises a PR for 800 m to ProcMart. Both streams sit under the same requirement line.
- **Final status:** both streams closed. Delta's fill-rate KPI drops for this PO.

### Example G: the supplier dispatches in part

- **PO:** 500 pairs of gloves on ARC-G, due 10 Dec.
- **Shipment 1:** 300 pairs on 8 Dec. GRN for 300 on 9 Dec, on time.
- **Shipment 2:** 200 pairs on 12 Dec, two days late. GRN on 13 Dec.
- **Utilisation:** ordered 500. Received 300, then 500.
- **Invoices:** two invoices, one per shipment. Each is checked against its GRN.
- **KPI effect:** the PO line is *not* OTIF, because it was not complete by the due date. Each shipment's on-time status is also recorded (section 14).
- **Final status:** Closed after the second payment.

### Example H: an ARC expires while orders are still pending

- **ARC-K** ends on 31 Mar. Its renewal (+4% price) is pending Adani sign-off.
- **PO released on 25 Mar**, delivery 10 Apr: stays valid at the old ARC price (BR-MAT-04). Delivery and GRN proceed as normal.
- **PR created on 28 Mar**, still awaiting SAP approval on 1 Apr: put on hold and raised as EXC-ARC-03. The ARC owner approves a 30-day **bridging extension** at the old price (APR-09), and the PR proceeds.
- **New requirement on 2 Apr**: the user sees "Renewal pending; bridging extension active until 30 Apr" and can order under the extension.
- **On 15 Apr** the renewal goes Active. New lines use version 2 at the new price. Lines already ordered keep their price.
- **Final status:** no orders lost, no price applied backwards, and every decision recorded against the ARC version.

## 14. Business KPIs and how they are calculated

Dashboards and screens are out of scope for this document. The **definitions** are in scope, because they are business rules both sides must agree before the pilot baseline is set \[P, slide 23: "Benefits baselined in the pilot"\]. All definitions are \[R\] \[?AD\] \[?PM\] unless tagged. "Value" means basic value excluding GST.

| KPI | Calculation | Source events | Named in proposal |
| --- | --- | --- | --- |
| **ARC utilisation %** | (Ordered value against the ARC, net of cancellations) ÷ ARC value cap. Also by quantity per line | PO mirror | Slide 23 |
| **On-contract spend %** | PO value of lines on an eligible ARC or a valid award ÷ PO value of all in-scope lines (every channel, per BR-UTL-03) | Full SAP PO feed | Slides 10 and 13 |
| **Leakage value** | Σ over leakage lines (9.7) of quantity × PO price, plus price-leakage lines' quantity × (PO price − ARC price) | Full SAP PO feed | Slide 10 lever 01 |
| **Catalogue adoption %** | In-scope PO lines that started in MonoSource ÷ all in-scope PO lines, by plant | PO mirror plus the full feed | Slide 17 |
| **Catalogue coverage %** | Items with an Active catalogue entry ÷ addressable items, by category | Catalogue | Slide 23 |
| **PR-to-PO time** | PO release timestamp − PR creation timestamp (median and 90th percentile), working days | SAP | Slides 13 and 23 |
| **Requirement-to-PO time** | PO release − requirement submission (includes sourcing time) | MonoSource plus SAP | New |
| **Acknowledgement SLA %** | POs acknowledged within the SLA ÷ POs released | MonoSource | Slide 25 |
| **Fill rate** | Quantity received and accepted ÷ quantity ordered, per PO line, closed lines only | GRN | Slide 14 |
| **On-time delivery (shipment)** | Shipments delivered on or before the PO line delivery date ÷ shipments | POD or GRN date | Slide 14 |
| **OTIF (PO line)** | PO lines where the *full* ordered quantity was accepted at GRN on or before the delivery date ÷ PO lines due in the period | GRN | Slide 13 |
| **Pending POs** | Released PO lines with an open quantity above 0, by age since release | PO mirror and GRN | Slide 15 |
| **Pending GRN** | Shipments marked delivered (POD) with no GRN after N days \[?AD\] | POD and GRN | New: needed for Model 1, 2 and 3 follow-up |
| **Delayed orders** | Open PO lines past their delivery date, or predicted late | PO and tracking | Slide 15 |
| **Outstanding invoices** | Verified, unpaid supplier invoices, by age: 1–15, 15–45 and 45+ days | SAP invoice and payment | Slide 15 |
| **Supplier performance score** | Weighted: OTIF 40%, fill rate 25%, quality acceptance 20%, acknowledgement SLA 10%, document accuracy 5%. Rolling 6 months, at least 5 PO lines \[weights R, ?AD\] | All the above | Slide 14 |
| **Price variation** | For each item, (max − min unit price) ÷ min across plants in a period | PO feed | Slide 23 |
| **Savings** | Σ (baseline price − PO price) × GRN quantity, using the agreed baseline method only | Baseline register plus GRN | Slides 10 and 22: method open (Q-C6) |
| **Model mix** | PO line count and value by model (1, 2 or 3) by plant and category | PO mirror plus the model lock | New |
| **Fee accrual** | Σ by model per BR-FEE-02 to 04, net of reversals | Fee ledger | Slide 21 |

- **BR-KPI-01**: Each KPI on a dashboard shows its definition and its data freshness (last SAP sync).
- **BR-KPI-02**: KPIs that depend on the full SAP PO feed (on-contract spend, leakage, adoption) are labelled "partial" until that feed is live for a plant.

## 15. Assumptions and ambiguities register

These are the working assumptions this BRD uses so the analysis could continue. None of them is a confirmed requirement.

| ID | Assumption or ambiguity | Used in | Risk if wrong | Confirm with |
| --- | --- | --- | --- | --- |
| A1 | The slide 6 "ARC/QRC" buckets are ProcMart serviceability, not Adani contract status | 4.3, 10 | Routing reads the wrong fact | ProcMart |
| A2 | Model allocation is set by scope through a jointly approved register, not chosen per order | 5.2 | Fees and supplier of record become inconsistent | Both |
| A3 | Model 3 scope includes ARC management for ARC lines in that scope, with no supplier fee (slides 19 and 21) | BR-MOD-03 | Double-charging, or under-charging | Both |
| A4 | A Model 1 line inside a Model 3 scope carries no 3% fee | BR-MOD-04 | Fee dispute | Both |
| A5 | An eligible Adani ARC always ranks above ProcMart direct supply | BR-MOD-05, 10.2 | Commercial conflict with ProcMart's supply revenue | Both |
| A6 | The 3% fee basis is GRN quantity × PO basic price, excluding GST and freight | BR-FEE-02 | Fee miscalculation | Both |
| A7 | Definition of "repeat order" (BR-FEE-03) | BR-FEE-03 | Fee dispute | Both |
| A8 | The supplier enablement fee is accrued on GRN value at the ARC price | BR-FEE-04 | Supplier dispute | ProcMart |
| A9 | PAN is a usable golden-supplier anchor for almost all Adani vendors | 7.2 | Foreign or unregistered vendors can't be mapped | Adani |
| A10 | Adani can provide a full SAP PO feed (all channels) for in-scope plants | BR-UTL-03 | Leakage and utilisation understated | Adani IT |
| A11 | Adani ARCs exist as documents and may or may not exist as SAP outline agreements or info records | 8.1 | Double maintenance, or conflicting prices | Adani IT |
| A12 | PO creation and release stay entirely in SAP, and MonoSource only requests a PR | 11 | Integration design changes | Adani IT |
| A13 | One PR per stream (plant, model, supplier, purchasing group) suits Adani's SAP practice | BR-RTE-04 | PR volume or approval-fatigue issues | Adani |
| A14 | POs released before expiry keep the ARC price for delivery after expiry | BR-MAT-04 | Disputes on late deliveries | Adani |
| A15 | Brand price lists can be obtained and versioned for brand-discount ARCs | BR-ARC-10 | 3,970 items can't be priced | Both |
| A16 | Each plant posts its own GRN, so consolidated demand still means per-plant POs | 10.6 | Central-PO model needed instead | Adani |
| A17 | Adani's procurement policy thresholds (quotes needed by value) will be supplied | BR-RTE-01 | Model 3 sourcing can't go live | Adani |
| A18 | Pilot plants and categories follow slide 7's six high-readiness categories | 1 | Pilot scope changes | Adani |
| A19 | Ariba remains for its current scope, and MonoSource does not replace it in the pilot | G15 | Overlap or conflicting channels | Adani |
| A20 | Supplier performance weights in section 14 are acceptable to start with | 14 | Scores disputed | Both |

**Contradictions or tensions found in the proposal**

- Slide 12 says "Supplier acknowledgement, ASN, delivery" flow into SAP, while slide 15 places them in MonoSource. This BRD treats MonoSource as master, with an optional push to SAP (A12, Q-S4).
- Slide 16 offers suppliers access to the whole Adani network, but ARC scope (BR-ARC-15) may legally limit use to the signing business. Expanding a contract's scope needs the contract owner's approval.
- Slide 22 says ProcMart "renegotiates ARCs" (also under Model 2), while slide 18 says Adani keeps "supplier selection and contract award". This BRD treats ProcMart's role as proposing and preparing, with Adani awarding.
- Slide 2 says Model 1 has "no service fee". Slide 20 lists the ₹10 lakh implementation fee for every model. These are consistent: the implementation fee is not a service fee. The wording should be made explicit in the contract.

## 16. Critical questions to answer before the FRD

**Blocks FRD** means the FRD cannot specify that area until the question is answered. Each question cites the section it affects.

### Commercial (ProcMart and Adani)

| ID | Question | Section | Owner | Blocks FRD? |
| --- | --- | --- | --- | --- |
| Q-C1 | Is an eligible Adani ARC always ranked above ProcMart direct supply (Model 1), even when ProcMart is cheaper? If not, what is the rule? | 10.2 | Both | Yes |
| Q-C2 | May ProcMart bid as a supplier in Model 3 events it runs? If yes, what separation of duties applies? | BR-RTE-02 | Both | Yes |
| Q-C3 | What exactly is the 3% fee basis (GRN value? including freight?), and what counts as a "repeat order" for 2.5%? | BR-FEE-02, 03 | Both | Yes |
| Q-C4 | If an ARC supplier refuses the 1% enablement fee, is its ARC still digitised and routed? | BR-FEE-04 | Both | Yes |
| Q-C5 | Does a Model 1 line inside a Model 3 scope carry the 3% fee? | BR-MOD-04 | Both | Yes |
| Q-C6 | What is the savings baseline method (price, period and plant basis) for the 2% target and the 30:70 share? | BR-FEE-08, 14 | Both | Yes, for savings |
| Q-C7 | Who signs off the Model Allocation Register, and at what level (business, category, ARC)? | 5.2 | Both | Yes |
| Q-C8 | Must ProcMart's Model 1 category prices be benchmarked against the market periodically? | 10.2 | Adani | No |

### Procurement policy (Adani)

| ID | Question | Section | Blocks FRD? |
| --- | --- | --- | --- |
| Q-P1 | What are the value bands for the number of quotes, open versus limited RFQ, and single-source justification? | BR-RTE-01 | Yes, for sourcing |
| Q-P2 | What is the delegation of authority for ARC activation and amendments, non-L1 awards, off-contract approvals and emergency purchases? | 12.2 | Yes |
| Q-P3 | Can an ARC signed by one business be used by plants of another business? | BR-ARC-15 | Yes |
| Q-P4 | Are there mandated or preferred ARCs, or split allocations (such as 70/30)? | 9.4 | Yes |
| Q-P5 | What is the price-tolerance % above which a user override needs approval? | BR-MAT-05 | No (configurable) |
| Q-P6 | Is bid rank visibility to suppliers allowed? Are bids sealed until close? Are multi-stage events used? | 2.5, 11 | No |
| Q-P7 | Which categories are consolidable, and what aggregation windows suit each? | 10.6 | No |
| Q-P8 | What are the acknowledgement, delivery-follow-up and escalation SLAs, and the LD rules? | 12.1 | Yes, for operations |
| Q-P9 | Do PRs pending approval at an ARC price change use the old or the new price? | BR-ARC-19 | Yes |

### SAP and integration (Adani IT)

| ID | Question | Section | Blocks FRD? |
| --- | --- | --- | --- |
| Q-S1 | Which SAP versions and modules run on each of the 11 servers? Which plants are on which server? | 4.2 | Yes |
| Q-S2 | Are ARCs held in SAP (outline agreements, info records, conditions)? Should MonoSource read them, write them, or neither? | 8.1 | Yes |
| Q-S3 | Can SAP provide a full PO-line feed (all channels) for in-scope plants and materials? | BR-UTL-03 | Yes |
| Q-S4 | Should acknowledgements, ASNs and award results be pushed into SAP? | 11.2 | No |
| Q-S5 | How are POs sent to suppliers today (SAP output, Ariba, email), and who sends them under MonoSource? | 11, stage 15 | Yes |
| Q-S6 | Which vendor-block flags and statuses should MonoSource respect? | 7.4 | Yes |
| Q-S7 | Is a free-text PR (no material code) permitted? | BR-ARC-04 | Yes |
| Q-S8 | What is Ariba's role: replaced, coexisting, or integrated? | G15 | Yes |
| Q-S9 | Is invoice verification a three-way match, and which invoice statuses are exposed? | 11, stage 23 | No |

### Master data (Adani MDM and ProcMart)

| ID | Question | Section | Blocks FRD? |
| --- | --- | --- | --- |
| Q-M1 | Does an equivalence or duplicate-code list exist for materials? | 9.2 | No |
| Q-M2 | Do all Adani vendors carry a PAN or GSTIN? How are foreign vendors identified? | BR-SUP-01 | Yes |
| Q-M3 | Are vendor-master email and phone reliable enough for account-claim OTPs? | 7.3 | No |
| Q-M4 | What is Adani's vendor-creation checklist, and which documents can be reused from ProcMart's records? | BR-SUP-07 | Yes |
| Q-M5 | What is the SLA for material-code and vendor-code creation requests? | 12.1 | No |
| Q-M6 | What data-use and confidentiality terms apply between ProcMart's supplier data and Adani's ARC data? | BR-SUP-08 | Yes |

### Pilot and operations

| ID | Question | Section | Blocks FRD? |
| --- | --- | --- | --- |
| Q-X1 | Which pilot plants and categories? Is Model 3 sourcing in the pilot, or only Models 1 and 2? | 1 | Yes |
| Q-X2 | Which ARCs (owners, files, formats) make up the ₹800 Cr base, and how many are PDF-only? | 8.1 | Yes |
| Q-X3 | What is the PM-Ops team's size and working hours for the pilot (this sets SLA feasibility)? | 12.1 | No |
| Q-X4 | Who at Adani acts as plant champion and approver in the pilot plants? | 6 | No |

## 17. What comes next, and sources

### 17.1 Sign-off steps for this BRD

- [ ] ProcMart product and procurement operations review every \[R\] rule, and accept, change or reject it
- [ ] ProcMart commercial answers Q-C1 to Q-C8 jointly with Adani
- [ ] Adani procurement answers Q-P1 to Q-P9 and supplies its DoA and procurement policy
- [ ] Adani IT answers Q-S1 to Q-S9
- [ ] Adani MDM answers Q-M1 to Q-M6
- [ ] Pilot scope agreed (Q-X1 to Q-X4)
- [ ] Approved rules re-tagged from \[R\] to "Approved", with the approver and date

### 17.2 Deferred until this BRD is approved (by instruction)

These parts of the brief are held back on purpose, and will be built on the approved rules: supplier portal and buyer portal design (functional and UI), SAP integration architecture and method selection (OData, IDoc, BAPI/RFC, middleware, PunchOut), the AI agent specifications, the entity model and database design, dashboard designs, the technical architecture, and the phased roadmap with a prioritised backlog. Each will trace back to the rule IDs in this document.

### 17.3 Sources

- *ProcMart\_Adani\_Commercial\_Proposal\_v8.pptx*, slides 1–26 (supplied by ProcMart)
- [Zinit homepage](https://zinit.com/) (agents, business model, services)
- [Zinit supplier guide](https://zinit.com/supplier-guide) (registration, profile, RFPs, offers, fees)
- [Zinit public RFP listing](https://app.zinit.com/requests) (observed 13 Nov 2026)
- [Art of Procurement interview with Zinit](https://artofprocurement.com/blog/insider-startup-of-the-week-zinit) (third-party; ERP write-back claim only)
