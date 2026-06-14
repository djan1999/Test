# PowerSync pilot — Demo workspace only

Goal: prove the offline-first sync engine end-to-end on the **Demo** workspace,
with **zero risk** to the live Hotel Milka service. The real workspace keeps
running on the current Supabase sync exactly as today.

Project facts (yours):
- Supabase project ref: `cvljktjmksfibuyphdln`
- Demo workspace_id: `547ffccc-cc93-42bd-942e-23eb0dc3a99e`
- Hotel Milka workspace_id (NEVER synced by the pilot): `a011c48c-f95b-4d9e-bd75-8a766ec5032b`
- Stack: Vite + React + TS — matches PowerSync's official starter exactly.

---

## Step 1 — Postgres prerequisite (one SQL statement, safe + reversible)
PowerSync replicates via a logical-replication publication. Run this once
(I can run it for you via the Supabase tools on your go — it only *creates* a
publication object; it changes no data and is undone with `drop publication`):

```sql
create publication powersync for table
  public.service_tables, public.service_settings, public.reservations,
  public.menu_courses, public.wines, public.beverages, public.service_archive;
```

## Step 2 — Create the PowerSync instance (your account — I can't do this)
1. Sign up at powersync.com → create an instance.
2. Connect it to your Supabase Postgres (it'll ask for the connection string;
   use the **Session/Direct** connection from Supabase → Project Settings →
   Database). Tell it the publication name `powersync`.
3. Configure auth to validate **Supabase JWTs** (PowerSync's Supabase guide has
   a one-click "Supabase Auth" option — point it at your project's JWKS).
4. Paste `powersync/sync-rules.yaml` (this folder) into the Sync Rules editor
   and deploy. Validate it shows the `demo_pilot` bucket with the 7 tables.
5. Copy the instance URL (looks like `https://<id>.powersync.journeyapps.com`).

## Step 3 — Client integration (I build + verify this, on a preview branch)
Once Step 2 gives me the instance URL, I will:
- Add `@powersync/web` + `@powersync/react` and the wa-sqlite Vite config on a
  **separate branch with its own preview deploy** (so it can't break the floor
  build), behind a `VITE_POWERSYNC_URL` env var and **gated to the Demo
  workspace only** — when the var is unset or the workspace is Milka, the app
  is byte-for-byte the current Supabase path.
- Wire a `PowerSyncBackendConnector`:
  - `fetchCredentials()` → returns the instance URL + the current Supabase
    session access token.
  - `uploadData(db)` → drains the local SQLite upload queue and writes each
    CRUD op back through the existing `supabase-js` client (RLS still applies).
- Mirror the Demo board reads/writes through the local SQLite DB so it's
  instant + offline, and you can pull a tablet's wifi and watch it keep working
  and reconcile on reconnect.

Reference for the exact current client API (the docs blocked automated fetch):
PowerSync's official **Vite + React + TS + Supabase** starter — follow its
`schema`, `db`, and connector files; our `sync-rules.yaml` and the Demo gating
above are the only project-specific parts.

## Why it's safe
- Sync rules hard-filter to the Demo workspace_id — Milka data physically can't
  enter the pilot.
- The client path is env-flagged + Demo-gated; prod/Milka stays on today's code.
- The build-affecting SDK lands on a preview branch first, never straight to the
  floor.

## What I need from you to proceed to Step 3
The PowerSync **instance URL** from Step 2 (and confirmation auth is wired to
Supabase). Then I build and you test on the preview, on Demo, with no risk to
service.
