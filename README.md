# MonoSource

Group procurement operating platform by ProcMart. Independent product: own code, DB, auth, API, jobs. Not coupled to ProcMart ERP.

## Run locally
```bash
createdb monosource
npm install
npm run db:migrate                  # apps/api/migrations → creates tables + runtime role monosource_app
npm -w apps/api run seed            # dev platform admin: platform@monosource.local / dev-platform-pass-1
npm run api                         # http://localhost:4000  (OpenAPI: /docs)
npm run web                         # http://localhost:3000
npx tsx apps/api/scripts/dev-demo.ts   # optional: fictional DEV demo customer "demo" (password demo-password-123)
npm test                            # needs a local Postgres DB named monosource_test
```
Docker alternative for dependencies: `docker compose -f infra/docker-compose.yml up -d`.

Docs: `docs/00-phase0-architecture-assessment.md`, `docs/DECISION_REGISTER.md`, `docs/adr/`, `docs/PROGRESS.md`.

⚠ The ERP adapter is **simulated** (`mock-sap`). No live SAP/Ariba integration exists.

## Optional: AI-assisted PDF extraction
Off by default. Set `ANTHROPIC_API_KEY` (and optionally `EXTRACTION_MODEL`, default `claude-sonnet-5-5`) on the API to enable it.
⚠ When enabled, the **text of uploaded contract PDFs is sent to the AI provider**. Check your customer's NDA and data-handling terms first.
Extraction is suggestion-only: every line still needs human review. Without the key, PDFs are stored and marked unsupported; CSV and Excel work without AI.

## Client demo
```bash
npm run -w apps/api demo     # rebuilds the dev DB with the illustrative demo world (destructive for the dev DB)
npm run api && npm run web   # then sign in at http://localhost:3000, company "demo", password demo-password-123
```
Try: `requester@demo.local` (buy), `central@demo.local` (procurement), `ops@demo.local`, `approver@demo.local`, `apex@demo.local` (supplier portal), `admin@demo.local`. All data is fictional and marked "Illustrative demo data" in the app; SAP is a labelled simulation.
