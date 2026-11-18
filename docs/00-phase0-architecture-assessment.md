# MonoSource — Phase 0: Repository and Architecture Assessment

Status: Phase 0 complete · Date: 2026-11-17 · Authority tags per the BRD: [P] proposal, [Z] public benchmark, [R] recommendation, [?PM]/[?AD] open.

## 1. What was inspected

| Source | Finding |
|---|---|
| `WEBD/connect.procmart.com` | Buyer storefront. React + TypeScript, Redux Toolkit, PrimeReact, axios, SAP Ariba cXML punch-out handler. **Frontend only** — no backend source, no `package.json` checked in, no schema, no CI. |
| `WEBD/portal.procmart.com` | ProcMart ERP portal. React (JSX), Redux, socket.io client, PrimeReact; hundreds of screens (RFQ, PO, quotations, VMI, contracts, dispatch, approvals, material code). **Frontend only.** API base is an environment value; the real API surface is only visible through the service calls. |
| `WEBD/ProcMart/*` | Business notes per ERP module (Contracts, Material Code, Quotations, Roles…). Useful domain knowledge, not code. |
| BRD v1 (`docs/source/BRD.md`) | Authoritative design for routing (§10), ARC engine (§8–9), models and fees (§5), supplier identity (§7), open questions (§15–16). |
| Landing page | Describes intended experience. Contains demo numbers/timings (e.g. "every 48 hours") — **not** product rules. |
| Adani PO extract (`Business unit wise data.xlsx`, ~309k PO lines, 35 columns) | Columns `BU, Server, Company code, Plant code, Vendor code, Material number, ARC/Non ARC, Ariba/Non Ariba…`. Confirms plant identity must include the SAP **server**. Useful as an org-hierarchy seed source and for later utilisation analysis. **Not** proof of active ARCs (BRD §0). |
| Commercial proposal v8 (.pptx) | Present in `docs/source`; the BRD already cites it slide-by-slide and is the working reference. |

**Consequence:** the ProcMart repositories contain no backend, auth, DB, job or integration code that can be reused. Only domain knowledge (screens, vocabulary, flows) carries over. MonoSource therefore starts clean, with no code dependency on ProcMart.

## 2. Reuse / adapt / avoid

| Class | Items |
|---|---|
| Reuse (knowledge only) | Vocabulary and state flows for RFQ, PO, GRN, dispatch; the Ariba cXML punch-out contract (as an *integration adapter* later). |
| Adapt | UX patterns from the storefront (brand/category browsing, cart). Re-implemented, not copied. |
| Do not reuse | Redux-global architecture, PrimeReact shell, ProcMart auth/session model, any shared DB. |
| Implement independently | Everything: auth, tenants, org, catalogue, ARC engine, routing, fees, jobs, audit. |
| ProcMart APIs MonoSource may *integrate* with | Supplier network lookup, Model 1 price lists, PO status for ProcMart-supplied lines — via a `procmart` adapter, contract TBD [?PM]. |
| Dependencies to avoid | Shared database; ProcMart session cookies/JWT; ProcMart S3 buckets; any import of ProcMart packages. |

## 3. Recommended stack (decision, with deviations)

| Layer | Choice | Evidence / deviation |
|---|---|---|
| Frontend | Next.js 16 + React + TypeScript | As proposed. |
| Backend | NestJS 11, modular monolith, REST + OpenAPI | As proposed. |
| Data | PostgreSQL 16, **plain SQL migrations**, `pg` driver | **Deviation:** no ORM. Tenant isolation relies on Postgres Row-Level Security set per transaction; explicit SQL keeps that auditable. |
| Tenant isolation | RLS on every tenant table, `FORCE ROW LEVEL SECURITY`, app connects as a non-owner role without `BYPASSRLS` | Enforced and **tested** (`tenant-isolation` e2e). |
| Background jobs | **Transactional outbox in Postgres** (`FOR UPDATE SKIP LOCKED`, retries, idempotency keys) | **Deviation (justified):** durable, no extra infra, atomic with business writes. BullMQ/Redis is the documented scale-out path (ADR-004) once throughput or scheduling needs justify it. |
| Search | Postgres `tsvector` + `pg_trgm` | OpenSearch deferred until catalogue size/relevance demands it. |
| Files | Storage interface; local-disk driver now, S3-compatible driver in Phase 7 | Honest: dev only is implemented. |
| AI | `ExtractionProvider` / `SimilarityProvider` interfaces, prompt+version stored per run; rule-based provider shipped; LLM providers are pluggable | No provider hardcoded. AI output is *suggestion only* (status `pending`). |
| Auth | Local email+password (scrypt) with JWT access tokens now; OIDC/SAML adapters behind an `IdentityProvider` seam in Phase 7 | Dev-grade; not claimed as SSO. |
| Infra | Docker Compose (Postgres, Redis, MinIO), GitHub-Actions-style CI definition | Compose is provided; CI file is a template, not run. |

## 4. System architecture

```
 Browser (Next.js)  ──REST/JSON──▶  NestJS API (modular monolith)
                                     ├─ identity   (login, JWT, permissions, data scope)
                                     ├─ tenancy    (tenants, ERP systems, org hierarchy)
                                     ├─ catalogue  (items, ERP code mappings, FTS search)
                                     ├─ suppliers  (legal entities, per-ERP vendor codes)
                                     ├─ contracts  (ARC/QRC lifecycle, extraction, matching, review)
                                     ├─ buying     (cart, requirement, routing engine, fee treatment)
                                     ├─ integrations (adapter port, mock SAP — SIMULATED)
                                     ├─ outbox     (durable job runner)
                                     └─ audit      (append-only)
                                          │
                              PostgreSQL (RLS)   Object store   (Redis: later)
```

**Data ownership.** MonoSource owns requirements, carts, contracts (digitised working copy), catalogue enrichment, routing, fee ledger. SAP remains system of record for material/vendor master, PR, PO, GRN, invoice, payment (BRD §4.4). MonoSource mirrors those and never approves/releases SAP documents.

**Integration architecture.** One port, `ErpAdapter { syncOrgMaster, submitPurchaseRequisition, fetchStatus }`. Adapters register by `erp_systems.kind`. Only `mock-sap` exists; every response is stamped `simulated: true` and stored that way. Each outbound message has an idempotency key and an audit row.

**Security approach.** RLS tenant isolation; permission strings (`module:action`) on routes; data scope via org-node subtree on role assignments; upload validation (type, size, hash); append-only audit table (update/delete blocked by trigger); rate limiting and input validation on every route; secrets via env only.

**Deployment model.** Single API container + web container + managed Postgres; dev/stage/prod via env. Backups: `pg_dump` + PITR on managed Postgres (runbook in Phase 7).

## 5. Repository structure

```
MonoSource/
  apps/api/        NestJS modular monolith + SQL migrations + tests
  apps/web/        Next.js app
  docs/            this report, ADRs, decision register, tracker, source docs
  infra/           docker-compose, CI template
```

## 6. Major risks

1. **Org master from SAP** — hierarchy must come from SAP; until the sync method is agreed [?AD], a CSV importer (same shape as the PO extract) feeds the same tables and is labelled `source=import`.
2. **PDF extraction quality** — needs an LLM/OCR provider and human review; only CSV extraction is built in Phase 2 slice.
3. **Policy unknowns** — ARC-vs-direct priority, fee bases, repeat order (see decision register). Built as configuration with *no approved default*.
4. **Utilisation accuracy** — needs full SAP PO feed (BRD BR-UTL-03).
5. **No reusable ProcMart backend** — more to build, but zero coupling.

## 7. Build phases

As in the master prompt (Phase 0–7). Progress is tracked in `docs/PROGRESS.md`.
