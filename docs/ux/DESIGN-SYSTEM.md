# MonoSource design system — “Ledger”

Direction: light, flat, hairline-ruled, information-dense (see `ERP-UI-TRANSFORMATION.md` for the three directions and why this one).

All tokens live at the top of `apps/web/app/globals.css`. Components use the tokens; avoid hard-coded colours, sizes and radii in TSX.

## Tokens
| Group | Tokens |
|---|---|
| Colour | `--pri` (one brand primary; the old orange CTA is retired) · semantic `--ok / --warn / --bad / --info` each with `-soft` and `-bd` · `--ai` (Ask MonoSource and agents only) · neutrals `--fg --fg2 --mut --mut2 --bd --bd2 --bg --surface --surface2 --hover` |
| Type | `--fs-xs 12 · --fs-sm 13 · --fs-base 14 · --fs-md 15 · --fs-lg 16 · --fs-xl 18 · --fs-2xl 22 · --fs-3xl 28`; weights `--fw-reg/med/semi/bold` (400/500/600/700) |
| Spacing | 4-px grid: `--sp-1…--sp-10` (4, 8, 12, 16, 20, 24, 32, 40) |
| Shape | radii `--r-xs 4 · --r-sm 6 · --r 8 · --r-lg 8 · --r-xl 12`; control heights `--h-sm 32 · --h-md 36 · --h-lg 40`; table rows 40 (`--row`), dense 34 |
| Layout | sidebar 232 (collapsed 64) · top bar 56 · page padding 24 (16 under 900px) · max content width 1600 · card padding 20 · drawer 460 · modal 640 (confirm 460) |
| Elevation | none on surfaces (1px `--bd` hairlines); `--sh2/--sh3` only for menus, drawers, dialogs, toasts |
| Contrast | body and secondary text `--fg/--fg2/--mut` ≥ 7:1; labels and metadata `--mut2` ≥ 4.5:1 on white and on `--bg` |

## Type roles
Table headers are sentence case 12/600 in `--mut2`; table values 14/400 with tabular figures, numbers right-aligned (`.num`) with the unit in the header (“Value (₹)”).

Page title `h1` 22/700 · section heading `h2` 16/600 · card/sub heading `h3` 15/600 · body 14/400 · secondary `.mut` · helper `.small` 13 / `.xsmall` 12 · labels and table headers 12/600 uppercase · status tags 12/600.

## Components
- **Buttons**: primary `<button>`/`.btn` · secondary `.sec`/`.btn.ghost` · tertiary `.link`/`.btn.text` · destructive `.danger` · sizes `.sm` (32) / default (36) / `.lg` (40) · loading `.busy` (spinner, keeps width) · focus ring on every button.
- **Inputs**: one height (36), `.field` with label, `.help` and `.ferr`; `aria-invalid` styling; `.form-grid` for multi-field forms.
- **Status**: `.tag` + tone (`ok` finished well · `pri` moving normally · `warn` partial/needs a look · `bad` blocked · neutral). `.tag.sim` marks simulated data. Status words come from `lib/format.ts` (`STATUS_LABEL`, `RFQ_STATUS`, `CONTRACT_STATUS`).
- **Layout**: `.pagehead` (title, subtitle, `.actions`), `.crumbs`, `.tabs` with `.cnt-n` counts, `.card` / `.card.flush` (tables edge-to-edge), `.sec-head` with `.hint`, `.stat`.
- **Feedback**: `.banner` (`warn` default, `info`, `ok`, `bad`, `neutral`), floating toasts (success / info / error, manual dismiss, error stays longer), `.empty` (title, explanation, `.acts`), `.skel`.
- **Overlays**: `.drawer`, `.modal` (`.modal-h/-b/-f`, Esc closes), `.notif-pop`.
- **Agentic**: `AgentChip`, `AgentCard`, `StageTrack` (+ `STAGE_COPY`), `Timeline`, `SupplierThread`, `Comparison`, `HumanTaskCard` (actionable / passive / waiting / decided), `SapBoundary`.

## Vocabulary
SAP (not “ERP”) in user-facing text · “requirement” (never “cart”) · “request for quotation” / “quotation” · “live” contract (not “published”) · stages: Finding a source → Collecting quotes → Reviewing offers → Approval in SAP → Delivery.

## Added in the Ledger pass
- **`DataTable`** (`components/DataTable.tsx`): sortable headers (`aria-sort`), a labelled “Find” filter, a toolbar slot (segmented filters), row count, pagination (25 per page by default), skeleton rows, separate “nothing yet” and “nothing matches” empty states, clickable rows, `hideBelow` column priority, and on phones (≤640px) each row becomes a label/value card.
- **`useConfirm`** (`components/Confirm.tsx`): one alert dialog for consequential actions; Esc and Cancel decline; on destructive dialogs the focus starts on Cancel.
- **Focus**: a solid 2px `--pri` outline on every button, link, checkbox and `role=button`; fields show a 1px inner ring plus a blue border.
- **Phones**: every control and table link at least 44px tall; long button labels wrap; top-bar search becomes a search button; the off-canvas menu is hidden from layout and focus when closed; order steps stack vertically.
- **Utilities**: `.field.inline` (label beside a control), `.title-row` (heading + status tag, kept outside the heading), `.home-item`, `.split.split-narrow`, `.show-sm/.hide-md/.hide-lg`.
