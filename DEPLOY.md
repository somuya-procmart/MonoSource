# Deploying MonoSource (Supabase + Vercel)

| Part | Host | Notes |
|---|---|---|
| Web (`apps/web`, Next.js) | **Vercel** project 1 | unchanged |
| API (`apps/api`, NestJS) | **Vercel** project 2 (serverless function) | `apps/api/vercel.json`. Migrations run on every build |
| Postgres 17 + pgvector | **Supabase** | row-level security per tenant, as before |
| Files (contract PDFs, product images) | **Supabase Storage**, private bucket | served only through the API |
| Background work (outbox, supplier follow-ups) | **Supabase pg_cron** → `POST <API>/cron/tick` every minute | serverless has no timers |

Railway is no longer used. If the old Railway project is still connected to GitHub, delete it (or disconnect the repo) so pushes stop deploying there.

> ⚠ SAP is **simulated** (`mock-sap`). The Adani data contains no prices and no vendor names; ARC rates are shown as "held in SAP".

## 1. Supabase

1. Create a project (region **Mumbai, ap-south-1**). Keep the database password.
2. Project → **Connect**: note two connection strings
   - **Session pooler** (port 5432, user `postgres.<ref>`) → `DATABASE_ADMIN_URL` (migrations, seed, setup)
   - **Transaction pooler** (port 6543) → used for `DATABASE_URL` below, with the app user
3. Project → **Settings → API**: note the **Project URL** and the **service_role** key (server-side only, never in the web app).

The API connects as `monosource_app` (created by the migrations, cannot bypass row-level security). Through the pooler its user name is `monosource_app.<ref>`:

```
DATABASE_URL=postgresql://monosource_app.<ref>:<APP_DB_PASSWORD>@aws-1-ap-south-1.pooler.supabase.com:6543/postgres?uselibpqcompat=true&sslmode=require
```

Use the pooler host shown under **Connect** (it can be `aws-0-…` or `aws-1-…`). Add `?uselibpqcompat=true&sslmode=require` to both URLs: the Node driver otherwise tries to verify Supabase's own certificate authority and refuses to connect.

## 2. Vercel: API

1. vercel.com → **Add New → Project →** import the repo again → **Root Directory `apps/api`**. Framework: Other (settings come from `apps/api/vercel.json`).
2. Environment variables:

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `JWT_SECRET` | `openssl rand -hex 32` |
   | `APP_DB_PASSWORD` | another long random string |
   | `DATABASE_ADMIN_URL` | Supabase session pooler URL |
   | `DATABASE_URL` | transaction pooler URL as above |
   | `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | from step 1.3 (turns on Supabase Storage) |
   | `CRON_SECRET` | `openssl rand -hex 32` |
   | `WEB_ORIGIN` | the web app's address |
   | `PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD` | first platform admin (12+ characters) |
   | `LLM_API_KEY` (+ optional `LLM_BASE_URL`, `LLM_MODEL`) | *optional*: turns on the Ask MonoSource agent (see below) |
   | `ANTHROPIC_API_KEY` | *optional*: AI reading of contract PDFs |

3. Deploy. The build compiles, runs the migrations and creates the platform admin. Live when `https://<api>/docs` opens.

## 3. One-time Supabase setup (bucket + cron)

```bash
DATABASE_ADMIN_URL='<session pooler URL>' API_URL='https://<api>.vercel.app' CRON_SECRET='<same as on Vercel>' npm -w apps/api run supabase:setup
```

## 4. Vercel: web

Existing web project (Root Directory `apps/web`): set `NEXT_PUBLIC_API_URL` to the new API address and redeploy. Put the web address into the API's `WEB_ORIGIN`.

## 5. Load the real Adani data

The workbooks never go into git. On a trusted machine:

```bash
python3 -I apps/api/scripts/adani/extract.py --bu "<Business unit wise data.xlsx>" --products "<ProcMart supporting file.xlsx>" --taxonomy "<Category Structure.xlsx>" --out apps/api/.data/adani
DATABASE_ADMIN_URL='<session pooler URL>' npm -w apps/api run seed:adani
```

About 10 minutes. Adds `--reset` to rebuild the tenant (deletes its data). Sign-in: organisation ID `adani`; the generated accounts and passwords are written to `apps/api/.data/adani/accounts.txt` (git-ignored). This is real company data: share the URL only with people allowed to see it.

**Supabase size:** about 400 MB with everything (items 158 MB, PO history 103 MB, ARC lines 47 MB). That fits the free tier's 500 MB, with little room to grow: move to Pro before adding more years of POs or per-item vectors.

## Ask MonoSource agent (optional)

Without an LLM key, Ask is the guided search (no AI; nothing leaves your servers). With one, Ask becomes an agent that calls the catalogue/ARC tools. Any OpenAI-compatible provider works:

| Provider | `LLM_BASE_URL` | example `LLM_MODEL` | Data note |
|---|---|---|---|
| Google Gemini (default) | *(leave empty)* | `gemini-2.5-flash` | free tier may use data to improve Google products: use a billed key for real data |
| Groq | `https://api.groq.com/openai/v1` | `openai/gpt-oss-120b` | open-weight model, fast, free tier |
| OpenRouter | `https://openrouter.ai/api/v1` | any tool-calling model | check each model's data policy |
| Ollama (self-hosted) | `http://<host>:11434/v1` | `qwen3:8b` | nothing leaves your network |

The user's messages and the matching catalogue/ARC rows are sent to the provider you choose.

## MCP server (Claude Desktop, Claude Code, other agents)

`<API>/mcp` (Streamable HTTP). Get a 30-day read-only token while signed in: `POST <API>/auth/mcp-token`. Then, e.g. Claude Code:

```bash
claude mcp add --transport http monosource https://<api>.vercel.app/mcp --header "Authorization: Bearer <token>"
```

Tools: `search_products`, `get_product`, `find_arcs`, `browse_taxonomy`, `get_product_type`, `purchase_history`, `list_plants`, `catalogue_overview`.
