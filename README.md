# MonoSource

Group procurement operating platform by ProcMart. Independent product: own code, DB, auth, API, jobs. Not coupled to ProcMart ERP.

## Run locally
```bash
docker compose -f infra/docker-compose.yml up -d   # Postgres 17 + pgvector on :54322 (same as Supabase)
npm install
npm run db:migrate                  # apps/api/migrations → creates tables + runtime role monosource_app
npm -w apps/api run seed            # dev platform admin: platform@monosource.local / dev-platform-pass-1
npm run api                         # http://localhost:4000  (OpenAPI: /docs)
npm run web                         # http://localhost:3000
npx tsx apps/api/scripts/dev-demo.ts   # optional: fictional DEV demo customer "demo" (password demo-password-123)
npm test                            # needs a DB named monosource_test on the same server (createdb -h localhost -p 54322 -U postgres monosource_test)
```

Going live (Supabase + Vercel): see `DEPLOY.md`.

## Real Adani data
`apps/api/scripts/adani/`: `extract.py` turns the three workbooks (BU-wise PO data, ProcMart supporting file, category structure) into seed files under the git-ignored `apps/api/.data/adani/`; `seed.ts` loads them into tenant `adani` (taxonomy, 930 plants, 158k items, 12k ARCs, 301k PO lines). Commands in `DEPLOY.md` §5. `npx tsx apps/api/scripts/adani/try-search.ts "electrical cables"` shows what search does with a query.

## Search, Ask MonoSource, MCP
- **Search** (`src/catalogue/search.ts`, `taxonomy.ts`): understands the kind of product first (head noun + ProcMart taxonomy + SAP abbreviations, plus vector search over the 3,447 product types), then ranks items by type fit, words, sizes/ratings and purchase frequency. "electrical cables" never returns an MCB. See `docs/adr/ADR-005-search-and-agent.md`.
- **Ask MonoSource**: guided questions from the taxonomy (which kind → required attributes, only values real items have). With `LLM_API_KEY` set it becomes an agent using the same tools (Gemini / Groq / OpenRouter / Ollama).
- **MCP server** at `/mcp`: the same catalogue/ARC tools for Claude Desktop, Claude Code or any MCP client (`DEPLOY.md`).

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
