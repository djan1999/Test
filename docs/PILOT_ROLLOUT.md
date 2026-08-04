# Controlled Restaurant Pilot

This is the release gate for adding one external restaurant. Code completion
does not by itself authorize production guest data.

## Current decision

**No-Go until every evidence box below is signed.** The repository now contains
the tenant-safe client, role-hardening migration, executable pgTAP role matrix,
neutral seed, and controlled onboarding workflow. The remaining gates require
real infrastructure or physical devices and cannot be truthfully replaced by a
unit test.

### 2026-08-04 database proof

- The canonical pre-hardening `schema.sql` bootstrap and
  `20260804103132_pilot_role_hardening.sql` both applied cleanly to an isolated
  Supabase branch.
- `supabase/tests/pilot_role_matrix.sql` passed **49/49** assertions there, and
  the post-migration Supabase security advisor returned no findings.
- Supabase's automatic branch migration replay failed before the new migration
  ran. The production migration ledger contains older migrations and timestamp
  variants that are absent from this checkout. That history mismatch is a
  rollout blocker even though the canonical-schema proof is green: reconcile
  or squash the migration history, then prove a fresh automatic branch replay
  before checking the full-stack migration gate below.

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
- [ ] `supabase test db` passed against a disposable database after the full
  migration stack, including `supabase/tests/pilot_role_matrix.sql`.
- [ ] A fresh Supabase branch completed its **automatic** migration replay; the
  repository migration files and production migration ledger were reconciled.
- [ ] The resilient client release reached every existing tablet and all
  upload queues were drained before the RLS migration.
- [ ] The composite workspace/service FK, exact grants, RLS matrix, audit
  redaction, and database advisors were verified after migration.
- [ ] Supabase Auth leaked-password protection is enabled and its security
  advisor warning is cleared.
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
  service-day rollover match this specific restaurant.
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
