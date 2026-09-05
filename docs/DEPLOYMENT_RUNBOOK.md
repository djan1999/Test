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
2. Prove the current production backup can be restored into an isolated
   project. Record the backup timestamp, restored project, verifier, and the
   smoke-query result. A dashboard badge alone is not restore evidence.
3. Run `npm ci` on Node 24.
4. Run `npm run check`.
5. Run `npm audit --omit=dev --audit-level=high`.
6. Link the intended Supabase project and review pending migrations without
   applying them. Compare the production migration ledger with the checked-in
   files; missing migrations or timestamp/name variants are a stop condition.
   Check the **latest** files, not the last recorded proof — every migration
   added since the previous promotion has to appear on both sides.
7. Create a fresh disposable Supabase branch and require its automatic
   migration replay to complete. Then execute `supabase test db` against the
   full stack — currently `pilot_role_matrix.sql`, `board_history.sql` and
   `service_events.sql`. A manual canonical-schema bootstrap is useful
   migration proof, but it does not prove that the recorded migration history
   is reproducible.

> **What GitHub CI does and does not cover.** `.github/workflows/ci.yml` runs
> `npm ci`, `npm run check` (Vitest + the production Vite/PWA build) and
> `npm audit`. It does **not** provision Postgres, does **not** run anything
> under `supabase/`, and therefore never evaluates a single RLS policy or
> pgTAP assertion. Steps 2, 6, 7, 8 and 9 above are manual gates with no
> automated backstop; a green PR badge is not evidence for any of them.
8. Run Supabase database lint/advisors and resolve or record every finding.
9. Perform `docs/SERVICE_DRILLS.md` on the actual FOH and Kitchen hardware.

### Migration-history recovery

The 2026-08-04 readiness run found that a fresh Supabase branch failed while
replaying pre-existing migration history, before the pilot hardening migration
ran. The repository's canonical base schema plus the new migration did apply
and pass 49/49 database assertions, so treat these as separate facts.

1. Export the production migration ledger and identify every missing file and
   timestamp/name variant.
2. Choose a reviewed Supabase-supported history-reconciliation or squash
   procedure; do not edit production migration records ad hoc.
3. Prove that procedure on an isolated project restored from backup.
4. Create another fresh automatic branch and require a healthy replay before
   production promotion.

**EXECUTED 2026-08-04/05.** The reconciliation above was carried out against
production (`cvljktjmksfibuyphdln`):

- Root cause confirmed: the production ledger held 28 entries, 18 with no
  repository file and two (`20260713112749`, `20260713124500`) with **empty
  statement arrays**, so automatic branch replay could never reproduce them.
- Before any change, the full ledger, all `public` policies, and the
  configuration-critical tables were copied server-side into the
  `ops_snapshot_20260805` schema (not API-exposed; keep until the next
  verified backup restore, then drop).
- `supabase/migrations/20260804103132_pilot_role_hardening.sql` was applied to
  production (ledger version `20260804231735`). Post-apply verification: 38
  policies with the role-scoped `services` set, both tenant constraints,
  lifecycle audit + immutability triggers, `ensure_rls` event trigger,
  hardened `is_workspace_member`, backup table relocated to `private`, Milka
  feature/provider stamps present, all row counts unchanged, security
  advisors free of new findings.
- The ledger was then squashed to two replayable entries: `20260804000000
  baseline_squash_canonical_schema` (the canonical schema, pre-hardening
  portion) and `20260804231735 pilot_role_hardening`. The prior 28 entries
  remain in `ops_snapshot_20260805.schema_migrations`.
- Proof: a fresh automatic branch (`replay-proof`) rebuilt the complete
  schema from the new ledger alone (12 tables / 38 policies, matching
  production exactly), and `supabase/tests/pilot_role_matrix.sql` passed
  **64/64** assertions on that branch. The branch was deleted afterwards.
- The next production service day (2026-08-05) completed normally on the
  migrated database: board, reservation, and settings writes all day, and a
  manual catalogue sync succeeded post-migration.

Going forward, every schema change MUST be a repository migration applied
through tooling that records the ledger entry — never an ad-hoc dashboard
edit.

> **Do not carry the lockstep claim forward unchecked.** The statement "the
> ledger and `supabase/migrations/` are in lockstep" was true of the tree as
> it stood on 2026-08-05. Two migrations have been added since:
>
> - `20260808230000_board_history_and_worked_content_shield.sql`
> - `20260809010000_service_events_append_only_log.sql`
>
> Before any promotion, re-export the production ledger and diff it against
> `supabase/migrations/`, then re-prove a fresh automatic branch replay. Treat
> the last recorded proof as expired the moment a new migration file lands —
> nothing in CI re-checks it (see below).

## Promotion order

1. Outside a live service, update every existing tablet to its current approved
   build and drain all pending upload queues.
2. Reconfirm the restore evidence from the pre-deployment gate, then apply the
   reviewed Supabase migration. This must precede the new client/server release
   because that release calls the atomic board-batch and privacy-erasure RPCs.
3. Execute the real-Postgres role matrix, cross-tenant checks, composite-FK
   check, grant check, and advisors against the migrated database.
4. Deploy the client/server-function release containing workspace-stamped
   PowerSync writes, atomic board gestures, streaming exports, and permanent-
   verdict handling. Confirm the deployment is READY before opening tablets.
5. Update every existing tablet outside a live service and verify each device
   has no upload/stream error. The client has a Milka-slug compatibility fallback
   for hotel rooms, while the migration also upserts the durable feature block.
6. Open the application as an Admin, Service account, and Kitchen account.
7. Run the two-device smoke test. Create the first restricted-role pilot users
   only after both the resilient client and tightened RLS are live.
8. Apply future PWA updates intentionally from Admin System or on the next full
   app reopen. Never force-reload devices during service.

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
- Ending a real service flips exactly one `services` row to `ended` and
  **removes no board rows** — the ended service, with all its `service_tables`,
  is the archive entry, and resuming it brings the same board back on every
  device.
- Admin System shows the correct build, a healthy sync stream, and a Logbook
  event count that advances during the smoke test.

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
- Preserve `services`, `service_tables`, `service_tables_history`, `service_events`, reservations, and archives before any emergency data repair. (The shared `service_settings.service_date` pointer is retired — the live service is the `services` row with `status='live'`.)
- Keep active tablets on their current waiting PWA build until the corrective deployment is ready.

### After a database point-in-time restore

The restored server is behind every tablet's PowerSync checkpoint and may be
behind queued local writes. Do not simply reconnect those tablets.

1. Put the restaurant into a controlled service pause and prevent new edits.
2. Restore and verify the database in isolation, then promote it according to
   the provider's documented procedure.
3. Revoke affected sessions if the incident involved credentials or a lost
   device.
4. On **every** tablet, use Admin → System → Reset Local Sync DB before
   resuming work. This discards un-uploaded local edits, so record the loss
   window and reconcile it operationally first.
5. Reopen the app, wait for a complete sync, and repeat the smoke test.

## Backups and retention

Enable Supabase project backups appropriate to the production plan and retain
the most recent successful restore evidence outside the application repository.
Archive purge is permanent; export historical service data before using it.

No automatic archive or audit retention deletion is currently configured. The
restaurant, as data controller, must approve a written reservation/allergy,
archive, audit, and backup retention schedule before real pilot guest data is
entered. Record device PIN/auto-lock requirements and the lost-device response
in the signed pilot checklist.
