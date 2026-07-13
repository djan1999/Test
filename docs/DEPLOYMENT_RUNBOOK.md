# Deployment and Recovery Runbook

Use this checklist for production changes. A green frontend build alone is not enough because this application includes database policies, migrations, server functions, an offline PWA, and long-running tablets.

## Required environments

Browser-visible variables:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_POWERSYNC_URL`
- Optional restaurant defaults such as `VITE_APP_NAME`, `VITE_APP_SUBTITLE`, room options, sitting times, rollover hour, access password, and PINs.

Server-only variables:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_KEY` (or the documented service-role alias)
- `CRON_SECRET`
- Optional `SYNC_SECRET`
- Recommended `APP_URL` for staff invitation redirects.

Never place a service-role key in a `VITE_*` variable. Vite variables are compiled into code sent to every browser.

## Pre-deployment checks

1. Confirm the release branch and review the complete diff.
2. Run `npm ci` on Node 24.
3. Run `npm run test:run`.
4. Run `npm run build`.
5. Run `npm audit --omit=dev --audit-level=high`.
6. Link the intended Supabase project and review pending migrations.
7. Run Supabase database lint against a local or linked project when Docker/database access is available.
8. Perform the service drills in `docs/SERVICE_DRILLS.md` on desktop and tablet viewports.

## Promotion order

1. Apply the Supabase migrations first.
2. Verify role migration, RLS policies, `archive_and_finish_service`, `replace_synced_catalog`, audit table, and query indexes.
3. Deploy the Vercel application/server functions.
4. Confirm the deployment is READY.
5. Open the application as an Admin, Service account, and Kitchen account.
6. Allow installed tablets to download the PWA update in the background.
7. Apply the update intentionally from Admin System or on the next full app reopen. Do not force-reload devices during service.

## Smoke test

- Admin sees Staff & Roles, Restaurant Setup, Audit Trail, and System.
- Service cannot open Admin or Kitchen-only functions.
- Kitchen sees Tickets/Terrace/Dining Room and cannot edit Admin catalogues.
- A reservation created on one device appears on another.
- Seating and a seat-level edit propagate between devices.
- Kitchen receives a new/changed Send exactly once.
- A table move updates both board and reservation ownership.
- A stale device is refused when attempting to end a newer service.
- Ending a test service writes nothing.
- Ending a real service creates one archive and clears existing configured rows.
- Admin System shows the correct build and a healthy sync stream.

## Early production monitoring

For the first hour after promotion:

- Check Vercel runtime logs for `workspace_members_failed` and `catalog_sync_failed`.
- Check Supabase Auth and Postgres logs for RLS denials, trigger errors, or function failures.
- Check at least one Service and one Kitchen device's System diagnostics.
- Confirm the nightly wine sync on its next scheduled run.

## Rollback

Frontend deployments can be rolled back through Vercel, but database migrations are forward-only operational history.

- Do not manually reverse a migration during service.
- Do not restore legacy role strings after accounts have migrated.
- If a database change fails, stop the promotion and create a corrective forward migration.
- Preserve `service_tables`, `service_settings.service_date`, reservations, and archives before any emergency data repair.
- Keep active tablets on their current waiting PWA build until the corrective deployment is ready.

## Backups and retention

Enable Supabase project backups appropriate to the production plan and verify that a restore procedure is documented outside the application repository. Archive purge is permanent; export or back up historical service data before using it.

No automatic archive or audit retention deletion is currently configured. Select and document the retention period before adding scheduled deletion.
