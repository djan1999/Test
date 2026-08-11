# Controlled Restaurant Pilot

This is the release gate for adding one external restaurant. Code completion
does not by itself authorize production guest data.

## Current decision

**No-Go until every evidence box below is signed.** The repository now contains
the tenant-safe client, role-hardening migration, executable pgTAP role matrix,
neutral seed, and controlled onboarding workflow. The remaining gates require
real infrastructure or physical devices and cannot be truthfully replaced by a
unit test.

A `[~]` box below means *proven once, then expired* — the evidence was real but
no longer covers the current tree, so it must be re-executed rather than
re-read.

**What the pilot foundation does cover.** Restaurant name, subtitle, table set
and hotel features are workspace-owned; new workspaces start neutral with
catalogue sync disabled and no provider; Admin has a workspace data export and
exact-name guest erasure; custom dietary restrictions reach menu substitution;
and the board carries server-side history, a worked-content shield and a Time
Machine. The live board remains the `service_tables` card engine — the
append-only Logbook is dual-written for diagnostics only and its Phase-4
cutover has not happened (`docs/EVENT_LOG_PLAN.md`).

### Database proof — what was executed, and what has expired

**2026-08-04 (superseded, kept for the record).** The canonical pre-hardening
`schema.sql` bootstrap and `20260804103132_pilot_role_hardening.sql` both
applied cleanly to an isolated Supabase branch; `pilot_role_matrix.sql` passed
**49/49** assertions there and the security advisor returned no findings. But
Supabase's *automatic* branch migration replay failed before the new migration
ran, because the production ledger held older migrations and timestamp
variants absent from the checkout.

**2026-08-05 (the executed proof).** After the ledger was reconciled and
squashed, a fresh automatic branch (`replay-proof`) rebuilt the whole schema
from the ledger alone and `pilot_role_matrix.sql` passed **64/64** assertions
on it. The full record is in `DEPLOYMENT_RUNBOOK.md`. The 49/49 figure above
is the *earlier, partial* run — do not quote it as the current result.

> **This proof has partially expired and must be re-run before promotion.**
>
> - **The 64/64 run is a one-off on a branch that was deleted. GitHub CI does
>   not repeat it.** `.github/workflows/ci.yml` runs `npm run check` and
>   `npm audit` only; the pgTAP suites under `supabase/tests/` never execute
>   in CI, so no automated signal will tell you when a change breaks the role
>   matrix. Re-running it is a manual pre-deployment step, not something the
>   green PR badge covers.
> - **Two migrations have landed since the 2026-08-05 squash** —
>   `20260808230000_board_history_and_worked_content_shield.sql` and
>   `20260809010000_service_events_append_only_log.sql` — and they bring their
>   own pgTAP suites (`supabase/tests/board_history.sql`,
>   `supabase/tests/service_events.sql`). **Do not claim migration lockstep
>   from the 2026-08-05 record.** Re-export the production ledger, diff it
>   against `supabase/migrations/`, and re-prove a fresh automatic branch
>   replay plus `supabase test db` (all three suites) before promotion.

## Authorization matrix

| Data/action | Admin | Service | Kitchen |
|---|---:|---:|---:|
| Services: read | Allow | Allow | Allow |
| Services: start/update/end | Allow | Allow | Deny |
| Services: trash/purge | Allow | Deny | Deny |
| Board rows: read/write | Allow | Allow | Allow |
| Board rows: delete | Allow | Deny | Deny |
| Reservations: read/create/update | Allow | Allow | Allow |
| Reservations: delete | Allow | Allow | Deny |
| Archive: read | Allow | Allow | Allow |
| Legacy archive: create | Allow | Allow | Deny |
| Archive: trash/purge | Allow | Deny | Deny |
| Restaurant setup, staff, catalogues | Allow | Deny | Deny |

Kitchen board writes remain allowed because course/fired state is written from
Kitchen devices. Reservation create/update remains allowed for the current
floor/walk-in workflow. Both decisions must be re-confirmed on the pilot's
actual Kitchen profile during the role drill.

## Evidence gates

- [ ] A current production backup was restored into an isolated project; date,
  project, verifier, and smoke-query evidence are recorded.
- [~] `supabase test db` passed against a disposable database after the full
  migration stack, including `supabase/tests/pilot_role_matrix.sql`.
  *(2026-08-05: 64/64 assertions on branch `replay-proof`, built from the
  reconciled ledger — see the executed record in DEPLOYMENT_RUNBOOK.md.
  **Re-run required:** that branch is deleted, GitHub CI does not repeat the
  matrix, and two migrations have landed since — with two further pgTAP
  suites, `board_history.sql` and `service_events.sql`, that this run never
  covered.)*
- [~] A fresh Supabase branch completed its **automatic** migration replay; the
  repository migration files and production migration ledger were reconciled.
  *(2026-08-05: ledger squashed to baseline + hardening; branch replay
  reproduced production exactly. **Re-verify:** the two post-August migrations
  must be present in both the ledger and `supabase/migrations/` and must
  replay automatically before lockstep can be claimed again.)*
- [x] Every existing tablet's old upload queue was drained, then the compatible
  database migration was applied before deploying the client/server build that
  depends on its new RPCs. *(Executed in the reverse-safe order on
  2026-08-04: resilient client deployed first, migration applied the same
  night outside service; the following full service day ran normally on the
  migrated database, including a successful post-migration catalogue sync.)*
- [x] The composite workspace/service FK, exact grants, RLS matrix, audit
  redaction, and database advisors were verified after migration.
  *(2026-08-04 post-apply verification — recorded in DEPLOYMENT_RUNBOOK.md.)*
- [ ] Supabase Auth leaked-password protection is enabled and its security
  advisor warning is cleared. *(One-click toggle in the Supabase dashboard
  under Authentication → Providers → Password; not reachable via SQL.)*
- [ ] Admin, Service, and Kitchen accounts completed every service drill on the
  actual FOH/Kitchen devices, including offline, stale PWA, and reset recovery.
- [ ] The controller approved retention periods for reservations/allergies,
  service history, audit records, backups, and device caches.
- [ ] Device PIN, auto-lock, OS update, session revocation, and lost-device
  procedures are signed by the restaurant.
- [ ] DPAs/processor terms for Supabase, Vercel, and PowerSync and the pilot
  privacy notice were reviewed for the restaurant's jurisdiction.
- [ ] Product name/logo and the neutral first-login experience were approved.
- [ ] Hotel mode, EN/SI language, Europe/Ljubljana timezone, table count, and
  service-day rollover match this specific restaurant. *(Partially satisfiable
  today: restaurant name, table set and hotel features ARE workspace-owned and
  can be set per restaurant. Timezone is **not** — rollover runs on each
  device's clock against a build-time hour — and sitting times and languages
  are **not** generalized either: sittings come from a build-time variable and
  EN/SI is structural in the schema. A restaurant outside Europe/Ljubljana, or
  needing other sittings or a third language, cannot be served by this build.)*
- [ ] Milka passed the same build in Demo and one controlled live-service
  regression before the pilot workspace was created.

## Onboard only after the gates are green

The command is a dry-run unless `--apply` is present:

```sh
npm run onboard:restaurant -- \
  --name "Restaurant Name" \
  --admin-email admin@example.com \
  --tables 10 \
  --courses 8 \
  --app-url https://app.example.com

npm run onboard:restaurant -- \
  --name "Restaurant Name" \
  --admin-email admin@example.com \
  --tables 10 \
  --courses 8 \
  --app-url https://app.example.com \
  --apply
```

The workflow creates/reuses one exact slug, links or invites the initial Admin,
seeds neutral table labels, an editable course scaffold and optional hotel
rooms, and leaves external catalogue sync disabled. Rerun the same command to verify idempotency; a slug
whose existing name/kind differs is refused.

## Rollback boundary

- Client/server functions: roll back the deployment outside active service.
- Database: use a corrective forward migration for ordinary defects. Use a
  point-in-time restore only under the proven recovery procedure.
- After any database restore, reset every tablet's local PowerSync database
  before reconnecting; otherwise checkpoints and queued edits may be ahead of
  the restored server.
- Do not delete the legacy backup table until restore evidence and a separate
  explicit data-deletion approval exist. The hardening migration removes its
  browser privileges without destroying the rows.

See `docs/DEPLOYMENT_RUNBOOK.md` for exact release order and
`docs/SERVICE_DRILLS.md` for physical acceptance.
