# Deploying MonoSource

## Current live deployment

- Website: https://monosource.vercel.app (Vercel project `somuya/monosource`)
- API: https://api-production-87e7b122.up.railway.app (Railway project `monosource`, service `api`, Postgres + volume at `/data`)
- First sign-in: organisation ID `platform`, with the admin email and password kept in the git-ignored `.env.deploy` file of the machine that set it up.
- The API redeploys on every push to `main` (Railway is connected to GitHub).
- The website is **not** connected to GitHub yet: redeploy it from the repo root with `vercel deploy --prod`, or connect it once in Vercel → Project → Settings → Git (needs a GitHub login connection on the Vercel account).


Two services and a database:

| Part | Host | Why |
|---|---|---|
| Web (`apps/web`, Next.js) | **Vercel** | Built for Next.js; redeploys on every push |
| API (`apps/api`, NestJS) | **Railway** | Must stay running: the outbox (SAP, simulated) and supplier follow-ups run on timers, and uploaded files are kept on disk |
| Postgres | **Railway Postgres** | Same project as the API, private network |

Config already in the repo: `railway.json` at the repo root (Railway reads it automatically: build, migrations before each deploy, start, health check) and `apps/web/vercel.json` (framework, security headers, skip builds when only the API changed).

> ⚠ The SAP/ERP connection is **simulated** (`mock-sap`). A live deployment is a demo or pilot, not a system connected to SAP.

---

## 1. Railway: database and API

1. Create a project at railway.com → **New → Database → PostgreSQL**.
2. **New → GitHub repo → `somuya-procmart/MonoSource`.** This is the API service.
   - **Settings → Root Directory:** leave empty. No build or start command needed; they come from `railway.json`.
   - If you earlier set **Config-as-code → Railway config file** to `/apps/api/railway.json`, clear it (that file has moved to the root).
   - **Settings → Networking → Generate domain.** This is your API address, e.g. `https://monosource-api.up.railway.app`.
3. **Volume:** right-click the API service → **Attach volume**, mount path `/data`. Uploaded contract PDFs and product images live here.
4. **Variables** on the API service (`${{…}}` are Railway references, type them as shown):

   | Variable | Value |
   |---|---|
   | `NODE_ENV` | `production` |
   | `JWT_SECRET` | a long random string, e.g. output of `openssl rand -hex 32` |
   | `APP_DB_PASSWORD` | another long random string (password of the restricted `monosource_app` database user) |
   | `DATABASE_ADMIN_URL` | `${{Postgres.DATABASE_URL}}` |
   | `DATABASE_URL` | `postgresql://monosource_app:${{APP_DB_PASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}` |
   | `STORAGE_DIR` | `/data` |
   | `WEB_ORIGIN` | your Vercel address, e.g. `https://monosource.vercel.app` (comma-separate several; fill in after step 2 below) |
   | `PLATFORM_ADMIN_EMAIL` | the email you will sign in with as platform admin |
   | `PLATFORM_ADMIN_PASSWORD` | at least 12 characters |
   | `ANTHROPIC_API_KEY` | *optional.* Turns on AI reading of contract PDFs. **The PDF text is then sent to Anthropic**, so check customer NDAs first |

5. Deploy. On every start the API first runs the migrations (safe to repeat), which also create the `monosource_app` user and the first platform admin. The deploy is live when `https://<api-domain>/docs` opens.

The app connects as `monosource_app`, which cannot bypass row-level security, so one customer's data can never reach another's. Only migrations use the admin URL.

## 2. Vercel: web

1. vercel.com → **Add New → Project → import `somuya-procmart/MonoSource`**.
2. **Root Directory:** `apps/web` (Vercel picks up Next.js and the npm workspace).
3. **Environment variable:** `NEXT_PUBLIC_API_URL` = your Railway API address (no trailing slash).
4. Deploy, then put the Vercel address into `WEB_ORIGIN` on Railway (the API only accepts browser requests from there) and redeploy the API.

`NEXT_PUBLIC_API_URL` is baked in at build time: after changing it, redeploy the web app.

## 3. First sign-in

Open the Vercel address and sign in with organisation ID **`platform`** and the `PLATFORM_ADMIN_*` email and password. From there you create customer organisations and their admins.

Changing `PLATFORM_ADMIN_PASSWORD` later does **not** change an existing admin's password.

## Optional: load the demo company

The demo loader **wipes the whole database** and refills it with the fictional "demo" company. Only do this on a database that holds nothing else.

1. In Railway's Postgres service → **Settings → Networking**, enable the public TCP proxy; note the public host and port.
2. On your machine, from the repo root:

   ```bash
   DATABASE_ADMIN_URL='postgresql://postgres:<password>@<public-host>:<port>/railway' \
   DATABASE_URL='postgresql://monosource_app:<APP_DB_PASSWORD>@<public-host>:<port>/railway' \
   npm run -w apps/api demo
   ```

3. Redeploy the API, so your `PLATFORM_ADMIN_*` admin is created again.
4. **Security:** the demo accounts' passwords are written in the README, and the loader also creates `platform@monosource.local` with a development password. Anyone with your URL could sign in with them. Switch that admin off right away (Railway → Postgres → **Data → Query**):

   ```sql
   UPDATE users SET status = 'disabled' WHERE email = 'platform@monosource.local';
   ```

   For anything beyond a short demo, don't load the demo data at all.

## After going live

- Every push to `main` redeploys both. Vercel skips the web build when only the API changed.
- New migrations run when the new API version starts. If one fails, that version doesn't start and Railway keeps the previous one serving.
- The API allows 600 requests a minute per client by default (`RATE_LIMIT` to change).
- Not built yet: cloud file storage (files live on the Railway volume, so back it up), a real SAP connection, email/WhatsApp sending (previews only).
