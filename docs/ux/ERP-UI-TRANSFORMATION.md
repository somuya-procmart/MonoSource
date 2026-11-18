# MonoSource — Enterprise UI transformation

Scope: the MonoSource web app (`apps/web`, Next.js). Modules that the brief lists but this product does not have (warehouse, inventory, stock movement, buyer invoices, branches) are out of scope; GRN, dispatch, invoices and payments exist only as order-tracking steps from (simulated) SAP and supplier events.

## 1. Inventory

### Routes (19)
| Area | Route | Who | Purpose |
|---|---|---|---|
| Buy | `/` | requester | Find & buy: search / Ask, bought often, recent requirements and orders |
| Buy | `/search` | requester | Results with source-of-supply, filters, compare tray |
| Buy | `/ask` | requester | Ask MonoSource conversation |
| Buy | `/product/[id]` (+ panel `?open=`) | all | How to buy this item at my plant |
| Buy | `/compare` | requester | Side-by-side items |
| My activity | `/activity` (Needs me · Requirements · Orders · Saved) | requester | Attention board and lists |
| My activity | `/requirements/[id]` | all | Requirement workspace (stages, agents, suppliers, decisions, timeline) |
| My activity | `/orders/[id]` | all | Order tracking (PO → GRN → invoice → payment) |
| Procurement | `/contracts` (Register · Coverage opportunities · Lines to review · Upload) | procurement | Contract register and leakage |
| Procurement | `/contracts/[id]` | procurement | Contract detail, lines, approval |
| Procurement | `/sourcing`, `/sourcing/[id]` | procurement | Lines waiting for quotes, RFQs, award |
| Procurement | `/work` (Needs action · Exceptions · Coverage requests) | procurement | Work queue |
| Procurement | `/insights` | management | Procurement overview (KPIs, breakdowns, export) |
| Admin | `/admin` (Organisation · Users & access · Catalogue · Commercial rules) | admin | Configuration |
| Supplier | `/portal`, `/portal/orders/[id]`, `/portal/rfqs` | supplier | Response pages |
| Public | `/login` | — | Sign in |

### Shared components (14)
Shell (sidebar, top bar, toasts) · GlobalSearch · NotificationBell · CartDrawer · ProductPanel/ProductDetail · ProductBits (row, card, qty, heart) · Source (badges, summary) · SupplierDrawer · NonCatalogueDialog · Agents (chips, cards, stage track, timeline, supplier thread, comparison, decision card, SAP boundary) · AttentionBoard · Ui (Empty, PageHead, Skeleton, Toast) · Icon · Thumb/AuthImage.

### Baseline inspection (skill checker `consistency.mjs`, signed-in snapshots, 1440/768/390 + 320 walk)
| Route | FAIL | WARN |
|---|---|---|
| /contracts | 27 | 49 |
| /work | 31 | 57 |
| /insights | 43 | 49 |
| / (home) | 46 | 42 |
| /search | 78 | 81 |

Applicable problems found (the rest are marketing-site checks: hero, photographs, a visual per card — not used for an app):
1. **Contrast** — muted text `#5d6b82` (5.0:1 on page ground) used for body copy; labels and nav group titles `#8a94a6` at 3.1:1.
2. **Focus** — buttons replaced the outline with a 18%-alpha ring: no visible focus on Search, Collapse, bell, account, cart.
3. **Button styles** — three or more per screen: primary with border, the borderless Search button, white segmented buttons, tinted nav pills; one secondary style in 30/32/36px heights.
4. **Tap targets** — 28px segmented and filter buttons, table links and tags on phones.
5. **Labels** — filter selects, list search, decision notes and compare checkboxes labelled only by placeholder or aria-label; product thumbnail links and icon-only search modes without names; mobile menu button without its open state.
6. **Overflow** — off-canvas sidebar still laid out at 320px; Overview cards with `minmax(340px)`; home rows with a fixed 280px column colliding at 320–390px; attention board rows.
7. **Data presentation** — hand-written tables per page: no sorting, no pagination, no per-table search, uppercase headers that clip, inconsistent numeric alignment.
8. **Consequential actions without confirmation** — approve/make contract live, award, stop quote collection, exclude a contract line, decline/extend coverage, record decisions.
9. **Copy** — a few vague actions ("Continue waiting", "Definition"), inconsistent stage words (fixed in the previous pass; checked again with `copy-lint`).

## 2. Three directions

| | A · Console | B · Ledger | C · Workspace |
|---|---|---|---|
| Idea | Dark navy chrome, dense monospace numbers, everything a table (trading-desk feel) | Light, flat, hairline-ruled surfaces; type and alignment carry hierarchy; one blue for action; compact tables with tabular figures | Card-first, roomy, soft shadows, friendly illustrations; every list is cards |
| Density | Very high | High, adjustable per table | Low |
| Readability over a full day | Tiring for non-technical users; poor for long text | Calm; black-on-white text, grey only for labels | Pleasant but scroll-heavy |
| Data-heavy screens | Excellent | Excellent | Weak (cards hide columns) |
| Navigation clarity | Strong but intimidating | Strong: module header + breadcrumbs + bold active item | Moderate |
| Scales across modules | Yes | Yes — the same table, header and form everywhere | Every module invents its card |
| Fit for procurement, finance, warehouse, management | Finance/ops only | All four | Requesters only |

**Selected: B · Ledger.** MonoSource is used all day by people who scan, compare and decide: procurement checks contracts and quotes, finance reconciles, managers read numbers. Ledger keeps the screen information-dense without noise: hairline rules instead of shadows, sentence-case column headers, right-aligned tabular numbers, one primary blue, and colour reserved for status. The requester front door (home, Ask, product panel) keeps the same tokens with slightly more air, so buyers aren't met by a spreadsheet — but it is the same system, not a second one.

### Principles
1. **Text is ink.** Body copy at 7:1 or better; grey only for labels and metadata, never below 4.5:1.
2. **Rules, not shadows.** Surfaces separate by 1px hairlines; elevation only for things that float (menus, drawers, dialogs, toasts).
3. **Colour means status.** Blue = action/in progress, green = done, amber = partial/attention, red = blocked/decision needed, grey = neutral. Nothing else is coloured.
4. **One of each.** One primary and one secondary button, two heights (32, 36); one table; one page header; one form field; one dialog.
5. **Numbers line up.** Tabular figures, right-aligned, units in the header; dates as `17 Nov 2026`.
6. **Every action says what it does, and the risky ones ask first.**

## 3. Design system
See `DESIGN-SYSTEM.md` (tokens and components, updated for Ledger).

## 4. Redesigned components
Shell (sidebar active state, top bar, phone search button, menu toggle state) · buttons (one primary, one secondary, 32/36/40) · segmented control · form fields (`.field`, `.field.inline`, visible labels) · **DataTable** (new) · **Confirm dialog** (new) · status tags · page header and `.title-row` · tabs with counts · banners · empty states · toasts · modal · drawer · stage track and order steps (stack on phones) · decision cards (labelled note field, clearer action wording, confirmations) · agent cards · KPI tiles (keyboard reachable) · product rows (visible “Compare” label, named thumbnails) · home “bought often” rows · filters (heading levels, sizes).

## 5. Redesigned pages
All 19 routes use the system. Converted to `DataTable`: My activity (Requirements, Orders with an “All / Running late” switch), Contract register (status filter in the toolbar), Sourcing requests for quotation, Work queue (Exceptions with an inline labelled “Resolve…” form, Coverage requests), Administration (Catalogue, Organisation, People), Overview (Plant comparison, Supplier performance, Category performance). Confirmations added to: approve contract, make contract live, extend contract to a plant (Coverage opportunities, Work queue, decision card), decline coverage, exclude a contract line, stop collecting quotes, award a quote, proceed with a supplier, reject an alternative, invite another supplier.

## 6. Copy and terminology
Copy linter (`copy-lint.mjs --kind software`) on all 20 captured routes: **0 FAIL**. Kept WARNs: “stat strip” on KPI rows (an operational overview needs them) and a stock company name in the illustrative demo data (Apex). Changes this pass: decision buttons (“Keep waiting for a reply”, “Invite another supplier”, “Ask the supplier for details”), table headers with units (“Value (₹)”, “Committed (₹)”), “Valid until”, “Quantity used”, “On contract”, “Avg. confirmation time”, filters labelled “Find”, “Scope”, “Period”, KPI tiles “Select to see the records”, order filter “Running late”, empty states for no-match vs nothing-yet. Earlier passes established SAP (not ERP), requirement (not cart), live (not published) and the five requester stages.

## 7. Before and after (skill checker `consistency.mjs --quick`, 1440/768/390 + 320 walk, signed-in snapshots)
| | All FAIL | Applicable to an app |
|---|---|---|
| Before (5 routes: contracts, work, insights, home, search) | 225 | 117 |
| After (11 routes: the same five + orders, activity orders, admin people, contract detail, requirement, product) | 247 | **45** |

Not applicable (marketing-site rules the checker applies to every page): `cta`, `hero-fill`, `fold-action`, `copy-actions` (“at most 2 actions in the hero”), `action-repeat` (a per-row action in a list), `card-layout` (uniform result rows), `no-visual`, `card-visual`, `empty-visual`, `text-only`, `assets`, `fold-cut`, `row-gap`, `section-gaps`, `flush`, `copy-headline`; `menu-toggle` and some focus checks are artefacts of the static snapshot (no JavaScript; verified live); `sample-label` flags the simulation disclosure the client required.

Remaining applicable findings (45), all reviewed:
- `stagger` (≈30): phone table cards are label/value pairs, so the first line starts at a different left than the values — intended.
- `field-label` / `focus-visible` on the two search boxes: named by `aria-label`, the search icon and the Search button, with focus shown on the whole field — kept.
- `field-label` on the quantity stepper and the supply-choice radio: named by `aria-label` inside a labelled row — kept.
- `cut-text` on wide detail tables (order lines, contract lines, supply table) at 390–768: they scroll sideways inside their card by design.
- `off-grid` 11px on the Overview period selector at 768px.

Copy linter: 0 FAIL on every route. Production build: clean. API tests: 125/125.

## 8. Interaction tests (live app)
Sorting (click → ascending, `aria-sort` updated), “Find” filter (“1 of 9”), no-match state with “Clear the filter”, segmented status filter (“Ending within 90 days” → 2 rows), confirmation dialog (opens with context, Esc and Cancel decline, nothing changes), destructive dialogs focus Cancel, horizontal overflow checked at 320px on 10 routes (none), 375px phone layout of the register (cards), top-bar at 320px. Earlier passes: requirement submission, agent scenario, decisions, notifications.

## 9. Remaining issues and blockers
- Modules in the brief that MonoSource does not have (warehouse, inventory, stock movement, buyer invoices, branches, vendor onboarding) were not built: that is new product scope, not a redesign.
- The skill’s finish gate (`gate.mjs`) is built for a single marketing page (hero, photographs, one section per screen) and was not armed; its checkers were run on signed-in snapshots instead.
- No bulk actions were added: no existing API supports acting on several records at once, and the brief rules out controls that do nothing.
- Product detail, compare and the supplier portal order page received token, copy and responsive fixes but not a layout redesign.
- Screen-reader testing and a contrast tool on every state (hover, disabled) were not done.
