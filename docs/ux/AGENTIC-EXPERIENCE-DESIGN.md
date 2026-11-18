# MonoSource — Agentic experience design (demo)

Positioning: **the user tells MonoSource what they need; agents coordinate in the background; the user is kept informed; humans act only where judgement or authority is needed.**
Everything agent-driven in this build is a **deterministic, labelled simulation**: no autonomous agents, no real email / WhatsApp / calls, no supplier accounts, no SAP transactions. Every simulated event carries `simulated = true` and the UI says so.

## 1. Information architecture (updated)

| Area | Page | Who | Change |
|---|---|---|---|
| Buy | `/` Find & buy | everyone | search ⇄ Ask toggle; submitting Ask *transitions* into `/ask` |
| Buy | `/ask` | requester | **new** conversational workspace (replaces the search-bar AI option) |
| My activity | `/activity` | requester | tabs: **Needs me** · Requirements · Orders · Saved |
| My activity | `/requirements/:id` | everyone | **rebuilt** as the Requirement workspace (progress · agents · suppliers · timeline · interventions · comparison · SAP boundary · order) |
| Procurement | `/work` | procurement | tabs: **Needs action** (human tasks) · Exceptions · Coverage requests |
| Procurement | `/contracts`, `/sourcing`, `/insights` | procurement | retained |
| Global | bell in top bar | everyone | **notification centre** (+ preferences, email / WhatsApp previews) — notifications ≠ tasks |
| Supplier | `/portal` | — | not a destination for users; represents the *magic-link response page* a supplier would open from an email/WhatsApp message. Not in navigation for staff. |

No new top-level pages besides `/ask`. Everything else extends existing pages.

## 2. Ask MonoSource interaction flow

1. Home hero: segmented control **Products | Ask MonoSource**. In Ask mode the box becomes a multi-line conversational input with example prompts.
2. On send → route to `/ask?q=…` with a FLIP-style transition (the hero box expands into the chat panel; the query becomes message 1). No retyping.
3. MonoSource thinks (typing indicator + **Discovery Agent** activity line: “searching catalogue… checking contracts for <plant>”).
4. Progressive clarification: only questions the catalogue cannot answer (existing deterministic narrowing: it asks only about attributes that split the remaining items; skips what the text already stated). Suggested-answer chips on every question.
5. Results appear *inside* the conversation as cards: exact match with ARC at plant (Add), several suppliers (compare), ARC at another plant (“applicability needs confirmation” → raise sourcing requirement with applicability review), approved supplier without ARC, alternatives (suggested, needs confirmation), non-catalogue sourcing.
6. Add-to-requirement happens in-line; a docked requirement tray lets the user submit without leaving the chat. “Back to buying workspace” always visible.
7. Conversation state persists in `sessionStorage`; the chat can continue after results.

## 3. Agent operating model and UI representation

| Agent | Responsibility (simulated) | Verb shown while working |
|---|---|---|
| Discovery | match catalogue, check ARC coverage, shortlist suppliers/alternatives | searching catalogue |
| Supplier Outreach | choose suppliers, prepare + send RFQ invitations by channel | contacting suppliers |
| Follow-up | monitor deadlines, remind, escalate, record outcomes | monitoring responses |
| Quotation Processing | extract price/qty/UOM/tax/validity/delivery, flag gaps | extracting quotation |
| Comparison | organise & compare, highlight differences, prepare for review | preparing comparison |
| Procurement Coordination | track lifecycle, surface delays/blocks, keep requester informed | coordinating next steps |

UI elements: `AgentChip` (identity + state dot), `AgentCard` (status badge Completed / Monitoring / In progress / Waiting / Blocked, one-line current activity), handoff markers in the timeline, subtle pulse only on “working/monitoring”, `prefers-reduced-motion` respected. Agents **never** approve an SAP requisition, a PO, or award — those are human/SAP events and are drawn as such.

## 4. Human intervention design

Three visually distinct states used everywhere:
- **Agent working** — blue-grey, pulsing dot, “no action needed”.
- **Waiting on external party** — neutral/amber outline, hourglass, shows who, since when, next follow-up.
- **Human action required** — strong solid card with a left accent, owner (role/team), reason, related item, raised-at, priority, consequence of inaction, and the action buttons.

`HumanTaskCard` kinds: technical clarification (accept / reject / request info), commercial review (view comparison / request clarification / proceed to approval), supplier response exception (escalate / pick another supplier / keep waiting), ARC applicability confirmation (request review / view contract). Priority uses restrained tones (normal / high), not red alarms. Tasks are real rows (`human_tasks`); resolving one changes state and advances the scenario.

“Needs my action / Waiting for others / Agents working / Completed recently” is a four-part view on `/activity` (requester) and `/work` (procurement).

## 5. Notification and update strategy

- **Notification** = something happened (read/unread, category, time, deep link). **Task** = something must be done (state, owner, actions). Different components, different colours, different places (bell vs. Needs-me).
- Milestone-only: submitted · suppliers identified · quotation received/processed · reminder sent · human action required · comparison ready · delay · awaiting SAP approval · PO created · dispatched/received · completed. Internal agent steps stay in the timeline.
- Preferences per user (important milestones, human action required, supplier response, delays & exceptions, completion) × channels (in-app, email preview, WhatsApp preview). Previews are rendered, never sent.

## 6. Requirement lifecycle and activity timeline

16 fine-grained states are collapsed into five visible stages: **Discovery → Supplier coordination → Evaluation → Approval → Fulfilment**. Each stage expands to its activity; elapsed time and next planned action are shown; no completion date is invented.

Timeline rows use simulated *Day N · hh:mm* labels from submission, agent chip, channel icon, and a “simulated” tag. A **Demo timeline control** (“Advance the demo”) moves the deterministic script one step; it is visible only in demo environments.

Awaiting-supplier panel: *N of M responded · waiting X h · last follow-up · next scheduled follow-up · agent monitoring*.

## 7. Screen hierarchy

`/` → `/ask` → (cart drawer) → `/requirements/:id` (workspace) → `/orders/:id` (ARC orders) · `/activity` (Needs me / Requirements / Orders / Saved) · `/work` (Needs action / Exceptions / Coverage) · bell → deep links into the workspace anchored to the relevant card.

## 8. Reusable components

`AgentChip`, `AgentCard`, `StageTrack` (5 groups), `Timeline`/`TimelineEvent` (agent · channel · simulated), `ChannelIcon`, `SupplierThread` (per-supplier communication history + extracted response + next follow-up), `MessagePreview` (email / WhatsApp / magic-link / call), `QuoteComparison`, `HumanTaskCard`, `AttentionBoard` (4 groups), `NotificationBell` + `NotificationPanel`, `PreferencesForm`, `ChatShell` (+ `ChatMessage`, `ProductAnswerCard`, `ClarifyCard`, `Suggestions`, `Typing`), `DemoClock`/`AdvanceDemo`, `SapBoundary` banner.

## Demo scenario (deterministic)

Plant employee needs 500 bearings → Ask → clarifies (application, size) → MonoSource finds group ARC at another plant → *applicability needs confirmation* → submits sourcing requirement → Discovery (done) → Outreach to 3 suppliers (A email, B email, C WhatsApp + magic link) → A quotes (Day 2) → B silent → Follow-up Agent WhatsApp reminder → C proposes an alternative (magic link, Day 3) → Quotation Processing extracts → **technical review task** → procurement accepts → Comparison Agent prepares comparison → **commercial review task** → authorised person proceeds → requisition shown at the **SAP boundary** (approval in SAP) → simulated PO → order tracking milestones → completion. Milestone notifications throughout.

Honest limits: scripted/simulated; fulfilment milestones for sourced lines are scripted inside the requirement workspace (ARC lines keep using the real order flow); no real messaging; the supplier portal pages remain only as the magic-link response illustration.
