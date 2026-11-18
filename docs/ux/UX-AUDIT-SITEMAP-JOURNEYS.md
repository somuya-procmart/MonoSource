# MonoSource — UX audit, information architecture, journeys and design system

Status: Phase 0 (UX) · 2026-11-17 · Source tags per BRD: [P] proposal · [R] recommended · [?AD]/[?PM] open

## 1. What was inspected
| Source | Finding |
|---|---|
| Current MonoSource UI (19 routes) | Built feature-by-feature. Top nav mixes buyer, procurement, supplier and admin items; Ask MonoSource is a separate page; the home page contains a "How MonoSource buys for you" explainer; product page has one price row; layouts capped at 1200 px. |
| Alibaba.com (opened live: home, `ball bearing` search) | Mode tabs **AI Mode / Products / Suppliers** sit *under the search bar* with an underline indicator; AI answer shows its reasoning ("Understanding your requirements → Matching products"); a one-tap **quick-filter chip row** above results; **compare checkbox on every card**; card = large image + title + price + MOQ + supplier line + Add to cart; wide fluid layout. |
| Landing page + BRD (§4, §9, §10, §11) | The buyer must see *contract* truth: supplier, contract, price, validity, plant applicability, MOQ; routing decided by rules, not chosen by the buyer; ProcMart serviceability ≠ customer contract coverage. |
| Public-benchmark UX (NN/g, Baymard guidance as commonly summarised) | Search-first, scannable lists for technical goods, visible applied filters, spec tables over prose, persistent purchase action, progressive disclosure, no dead ends. |

## 2. UX audit
| Area | Existing problem | Proposed change | User benefit |
|---|---|---|---|
| Search | Plain box; separate "Ask" page; recent/suggestions only on home | One global bar on every buyer page with **Products \| Ask MonoSource** modes, animated indicator, suggestions, recents, category shortcuts | Search is always one click away; AI is part of discovery, not a detour |
| Ask MonoSource | Isolated page that feels like a different product | Inline **Ask panel** under the bar: shows what it understood, asks one question at a time, previews matches, then "See N matching products" continues into the normal results with filters pre-set | Users stay in flow; AI narrows, the catalogue decides |
| Product results | Consumer-style cards, no filters, no sort, no compare | Dense **list** (default, comparison-friendly) + grid toggle; category-aware filters with removable chips; sort; compare up to 4; quick chips (On ARC for my plant, Brand, Supplier) | Scan 20 items in seconds; narrow without jargon |
| Product details | Single price line; no multi-supplier view; no tabs | **Current ARC supply** table (all valid supplies, never silently picking one), specs table, tabs (Documents · Supplier · Contract conditions · Alternatives), sticky purchase panel; clear "no ARC" next step | Buyer answers "who, what price, which contract, valid for my plant?" without leaving the page |
| Navigation | Flat top nav of 8–9 items for everyone | **Grouped left sidebar by intent** (Buy · My activity · Procurement · Insights · Administration), role-filtered, collapsible | Requesters see 3 items, procurement sees what it needs |
| Requirements | Cart → submit → list; no review step; status only on detail | Cart **drawer** for quick add, **Review requirement** page (how each line will be bought, need-by, totals), then tracking with stepper | Predictable: add → review → submit → track |
| Orders | Only visible inside a requirement | **My orders** list (PO, supplier, status, next step) + order page with timeline | "Has it been acknowledged? When will it arrive?" answered in one place |
| ARC visibility | Contracts hidden in a staff table | **Contracts / ARCs** register with validity, utilisation, expiry; ARC chips on every product; contract page lists lines and applicability | ARC coverage is visible where buying happens |
| Layout and spacing | 1200 px container, wasted side space | Fluid layout, 94% width up to 1760 px, shared page header grid | Uses the screen; consistent alignment |
| Visual consistency | Mixed button/tag/card patterns per page | One design system (tokens, components, motion) | Looks like one premium product |
| Marketing in app | "How MonoSource buys for you" explainer on home | **Removed.** Home = work: search, continue where you left off, tasks, saved, recent | The app gets work done, not a sales pitch |

## 3. Navigation (role-based, intent-grouped)
| Group | Items | Visible to |
|---|---|---|
| **Buy** | Discover (home + search) · Categories | requester, plant procurement, central, ProcMart ops |
| **My activity** | Requirements · Orders · Saved items | requester, plant procurement, central |
| **Procurement** | Contracts / ARCs · Suppliers · Sourcing (RFQs) · Exceptions | plant procurement (limited), central, ProcMart ops |
| **Insights** | Procurement overview | central, plant procurement (own plants), finance, approver |
| **Administration** | Organisation · Users & access · Catalogue management · Configuration | customer admin, ProcMart ops (catalogue) |
| Supplier portal | Orders · Quote requests (own app shell) | supplier users only |

Ask MonoSource is **not** a nav item: it is a mode of the global search. Categories is a page, not a menu of 40 links.

## 4. Sitemap
```
/                         Discover (search hero · continue · tasks · saved · recent)
/search?q&mode&filters    Results (list/grid · filters · sort · compare) — also hosts Ask mode results
/categories               Category browse
/product/:id              Product detail (overview · current ARC supply · specs · tabs · purchase)
/compare?ids=             Side-by-side comparison
/requirements/review      Review & submit requirement (from cart)
/requirements             My requirements          /requirements/:id   Requirement tracking
/orders                   My orders                /orders/:id         Order tracking
/saved                    Saved items
/contracts                ARC / QRC register       /contracts/:id      Contract (header · lines · utilisation · review)
/suppliers                Supplier directory       /suppliers/:id      Supplier (contracts · orders · performance)
/sourcing  /sourcing/:id  RFQs                     /exceptions         Exception queue
/insights                 Procurement overview (control tower)
/admin/organisation  /admin/users  /admin/catalogue  /admin/configuration
/portal  /portal/orders/:id  /portal/rfqs    Supplier portal
```

## 5. Journeys (route between pages)
1. **Find a product:** any page → global bar (Products) → suggestions → `/search?q` → card → `/product/:id`.
2. **Ask MonoSource:** global bar → Ask tab → describe need → inline panel (understood chips → question → options) → "See N matching products" → `/search?q&ask=…` (filters pre-set) → `/product/:id`.
3. **Browse a category:** `/categories` → `/search?category=` (category filters appear) → product.
4. **Open a product:** card → `/product/:id` (breadcrumb: Catalogue › Category › Item; back keeps filters via URL).
5. **Compare current ARC supplies:** product → *Current ARC supply* table (all valid supplies) → select supply → purchase panel.
6. **Add to requirement:** purchase panel / card → cart drawer slides in (Continue shopping · Review requirement).
7. **Review & submit:** drawer or header cart → `/requirements/review` (route per line, need-by, totals) → Submit → confirmation with link to tracking.
8. **Track a requirement:** confirmation / `/requirements` → `/requirements/:id` (stepper, lines, streams).
9. **Track an order:** `/orders` → `/orders/:id` (timeline: placed → confirmed → dispatched → received → invoiced → paid; shipments; follow-ups).
10. **View an ARC:** product supply row or `/contracts` → `/contracts/:id`.
11. **Review suppliers:** `/suppliers` → `/suppliers/:id` (contracts, orders, performance).
12. **Handle an exception:** Home task card / `/exceptions` → exception → linked requirement/order → resolve with note.

## 6. Role experience
| Role | Lands on | Sees |
|---|---|---|
| Plant requester | Discover | Buy, My activity |
| Plant procurement | Discover + task strip | + Contracts (read), Suppliers, Exceptions, Insights (own plants), award approvals |
| Central procurement | Insights summary + Discover | + Contract approval/publish, Sourcing, Insights (group) |
| ProcMart operations | Exceptions / follow-ups | + Catalogue management, sourcing (no award) |
| Supplier | Portal | Own orders, quote requests only |
| Administrator | Administration | Organisation, users, configuration, catalogue |
Permissions and routing rules stay as built (BRD-governed); this is presentation only.

## 7. Design system
**Tokens** — Surface `#fff` on canvas `#f5f6fa`; ink `#0f1728`/`#475467`; primary `#2547d0` (actions, selection); accent `#ff6a1a` reserved for the search button and the single primary buying CTA; model colours (contract teal, ProcMart violet, sourcing amber) used only for "how it will be bought"; status: ok `#067647`, warn `#b54708`, bad `#b42318`. Radius 12/16; shadows 3 levels; Inter 14.5/13/12, headings 700 tight tracking. Spacing 4-pt scale.
**Layout** — Sidebar 232 px (collapsible to 68), topbar 64 px, content `width: min(94%, 1760px)`; page header = title + subtitle + one primary action; max one primary button per view.
**Components** — GlobalSearch (modes, suggestions, Ask panel), ProductRow/ProductCard, FilterBar + chips, SupplyTable, SpecTable, Tabs, Drawer, Stepper, StatusTag, Toast, Skeleton, EmptyState, Breadcrumb, Compare tray.
**Motion** — 120–220 ms ease-out; search-mode indicator slide, suggestion fade/slide, card lift, drawer slide, accordion height, toast rise, skeleton shimmer; all disabled under `prefers-reduced-motion`.
**Data honesty** — Demo mode shows an unobtrusive "Illustrative demo data" pill; no fake ratings, stock, delivery promises or supplier verification; contract price only from published, in-validity, in-scope contract lines; ProcMart serviceability stays a separate field.

## 8. Demo-first strategy
The existing backend already enforces the real rules, so the demo runs on **real persisted data** produced by a seed script that uses the public API (contracts go through review → approval → publication; orders through the supplier portal). The dataset is clearly *illustrative* (fictional group, plants, suppliers), consistent across every screen. SAP remains the labelled mock adapter. Production work stays in Phase 7.
