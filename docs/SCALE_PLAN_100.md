# Scale plan: 100-restaurant production readiness

Status: FOR REVIEW — no code in this PR. Approved decisions this plan builds
on: **operator-console onboarding** (no public self-signup), **no billing
enforcement yet**, **DACH/EU market from day one** (full i18n), single
multi-tenant deployment.

Every phase carries one non-negotiable constraint: **zero regression for live
tenants.** Milka (and each later restaurant) must run through every phase
unaffected; anything that risks that ships behind a compatibility window and
its own verification gate.

---

## 0. What already scales (verified, done)

- Tenancy: per-workspace RLS with the enforced admin/service/kitchen matrix,
  composite workspace/service FK, workspace-immutability triggers, lifecycle
  audit — proven by the executable 64-assertion pgTAP contract.
- Sync: PowerSync streams filtered by membership; evidence-based workspace
  resolution in the connector; skip+diagnose failure handling.
- Migration discipline: clean two-entry replayable ledger; fresh-branch
  replay proven; canonical `schema.sql` bootstrap.
- Privacy machinery: admin export (streaming), atomic guest erasure with
  stale-device replay protection.
- Per-workspace config: name, subtitle, tables, hotel-guest feature, rooms,
  catalogue-sync provider.
- Data volume: ~a few MB/restaurant/year — Postgres is not a ceiling at 100.

## 1. Phase M — Multi-tenant completion (small, do first)

Remove the last build-time tenant coupling so ONE deployment serves all
restaurants:

- Move to `restaurant_config_v1` (workspace settings, admin-editable):
  admin/menu PINs (hashed, not plaintext), gate access password, service-day
  rollover hour. Env vars remain as neutral fallbacks only.
- Per-workspace **timezone** (IANA name) in workspace settings; service-day
  and rollover computed against it instead of the device clock
  (`src/utils/serviceDay.js`). Display formatting keeps using device locale
  until Phase I lands.
- Fix the **inert custom dietary keys** defect: admin-added restriction keys
  must flow into `RESTRICTION_PRIORITY_KEYS` / `RESTRICTION_COLUMN_MAP`
  equivalents dynamically (food-safety relevant; today they configure but do
  nothing).
- Milka safety: settings are seeded from current env values by a data
  migration before the client that reads them deploys (same pattern as the
  hotel-features stamp — stamp first, client second).

## 2. Phase I — Internationalization (the big one)

Target: a German or Austrian restaurant onboards with German UI labels,
German/English guest menus, correct local formatting — without touching
Milka's Slovenian behaviour.

**Schema: locale-keyed JSONB, not a translations table.** The app is
offline-first and row-synced; a side-table per translation would multiply
sync rows and break the CAS/merge model. Instead each translatable field
becomes a locale map inside the existing JSONB shape:

- `menu_courses`: `menu`/`menu_si` (and every `*_si` twin: wp/na/os/premium,
  restrictions_si, force_pairing_*_si, optional_pairing_*_si) collapse into
  locale-keyed values: `menu: {"en": {...}, "si": {...}, "de": {...}}`.
  Migration backfills `en` + `si` from existing columns; legacy columns are
  kept read-only for one compatibility release, then dropped.
- Workspace gains `locales` config: UI language, guest-menu language list,
  default guest language, number/date formatting locale.
- Client: one accessor layer (`localizedField(course, 'menu', locale)`)
  replaces every direct `menu_si`/`lang === "si"` branch (menuGenerator,
  KitchenBoard, print paths — ~25 sites); all `en-GB`/`sl-SI` hardcoded
  `toLocaleDateString` calls (~17 sites) route through one workspace-aware
  formatter.
- Hardcoded Slovenian strings (VINSKA SPREMLJAVA etc.) move into a small
  translations catalog with per-workspace override.
- Currency: explicitly OUT of scope — the product stores no prices; revisit
  only if menus gain prices as a feature.
- Milka safety: the migration is a pure reshaping with byte-equivalent
  output for en/si; verified by snapshot-comparing generated menus (existing
  `generatorSnapshots` tests) before/after, plus a Demo-workspace drill.
- This is the highest-risk phase: schema migration + wide client refactor.
  It ships in three separately deployable steps (schema+backfill dual-read →
  client switch → column drop), each gated on the full suite + pgTAP +
  generator snapshots.

## 3. Phase O — Operator platform

The approved onboarding model: restaurants are provisioned by the operator,
staff arrive by invite.

- **`platform_operators`** table (service-role-only, like the erasure
  register) naming the operator accounts. Operator status is checked
  server-side per request; it grants nothing through RLS/PostgREST.
- **Operator API** (`api/operator.js`, service key, same split-privilege
  pattern as `workspace-members.js`): create restaurant (wraps the logic of
  `scripts/onboard-restaurant.mjs`: workspace + neutral seed + admin
  invite, idempotent, dry-run), list workspaces with health (member count,
  last activity, storage), assign/approve catalogue sync source, suspend
  flag (see below), trigger export (offboarding step 1).
- **Operator console**: a protected `/operator` route in the existing app,
  rendered only for signed-in `platform_operators`; shows the directory,
  provisioning form, per-workspace health, and the catalogue-source
  assignment the SystemPanel already promises.
- **CSV catalogue import**: operator- and admin-facing wine/beverage CSV
  upload (validated, transactional via `replace_synced_catalog`-style RPC,
  `source='import'`, never touching manual rows). Kills the biggest
  onboarding time sink.
- **Suspension switch (built, not enforced-for-billing):** `workspaces`
  gains `suspended_at`; RLS gains `and suspended_at is null` on
  reads/writes; the operator console can toggle it. Billing was descoped by
  decision — but offboarding, abuse, and any future billing all need the
  same switch, and adding it later means another RLS migration. Building
  the switch now (unused by default) is cheap insurance; flag for approval.
- Onboarding checklist automation: provisioning emits the runbook checklist
  (device setup, invite links, drill schedule) per restaurant.

## 4. Phase H — Hardening & observability

You cannot operate 100 tenants blind:

- **Error tracking** client + serverless (Sentry or equivalent — needs an
  account/DSN from the operator), with workspace tag on every event.
- **Alerting**: nightly-sync failure, migration/advisor drift (scheduled
  advisor check), backup presence check, PowerSync connection errors.
  Delivery: email/webhook to operator.
- **Real rate limiting** (Upstash Redis or Vercel WAF) replacing the
  per-instance in-memory limiter on `api/*`; CORS/origin allow-list on all
  endpoints; timing-safe secret compare already done.
- **Auth**: leaked-password protection ON (dashboard toggle — still
  pending); password policy; evaluate MFA requirement for operator + admin
  accounts.
- **CI**: pgTAP + fresh-replay check as a GitHub Actions job (now possible
  since the ledger reconciliation) so tenant isolation is proven on every
  PR, not just at deploy time.

## 5. Phase D — Data lifecycle automation

- Retention cron implementing the signed-off `DATA_RETENTION_POLICY` (a
  Vercel cron like sync-wines: purge ended services/reservations/audit
  past their windows, per workspace, with a dry-run mode and an audit row
  per run).
- Offboarding tooling in the operator console (export → freeze → window →
  delete, automating `docs/OFFBOARDING.md`).
- Backup: scheduled restore-verification drill (quarterly), documented in
  the runbook with the post-restore device procedure.

## 6. Phase C — Capacity & rollout engineering

- **PowerSync** is the one shared ceiling: ~4–6 devices/restaurant → 400–600
  concurrent connections at 100. Confirm instance plan limits, load-test
  with synthetic tenants (the onboarding API makes seeding 100 sandbox
  workspaces trivial), measure sync-rules bucket fan-out.
- **Supabase**: compute headroom check under synthetic load; connection
  pooling audit (PostgREST + PowerSync replication slots).
- **Release process at scale**: staged client rollout is impossible with one
  Vercel deployment + PWA — mitigate with the existing resilience layer +
  a canary sandbox workspace that runs drills against every preview before
  main merges.
- Cost model per restaurant (Supabase + PowerSync + Vercel) so pricing has
  a floor.

## 7. Non-engineering gates (operator's list)

- Product name, logo, PWA icons (placeholders ship today).
- Legal pack: ToS, DPA + sub-processor list (Supabase/Vercel/PowerSync),
  privacy notice, retention sign-off (draft awaits decisions).
- Price (billing enforcement deliberately deferred; invoicing is manual).
- Support arrangement: who answers the playbook's escalations, hours, SLA.
- Physical multi-device drills with role accounts on real hardware — still
  the final gate before ANY external restaurant, and the canary-workspace
  drill becomes routine per release thereafter.

## Sequencing & effort

```
M (multi-tenant completion)  ─┐  small; unblocks single-deployment model
O (operator platform)        ─┼─ parallel after M      ~ the core build
I (internationalization)     ─┘  largest; 3-step ship  ~ the long pole
H (hardening/observability)  ── parallel anytime (needs Sentry account)
D (lifecycle automation)     ── after retention sign-off
C (capacity/rollout)         ── after O (needs synthetic tenants)
```

Order of PRs: M → O + H in parallel → I (three PRs) → D → C. Each PR follows
the now-standard bar: full suite green, pgTAP green, migration replay green,
Milka-regression statement, staged data-stamp-before-client where relevant.

Honest calendar note: M/O/H/D are days-each of focused work. I is the long
pole (schema + ~40 call sites + three-step rollout). C and the physical
drills have irreducible real-world time. "100 restaurants tomorrow" is not
achievable by anyone; "the platform stops being the bottleneck within the
I-phase timeline, with restaurants onboardable in minutes via the operator
console" is.

## Explicit non-goals (per decisions)

Public self-signup; Stripe/billing enforcement (suspension switch is built
but idle); native app-store apps; per-restaurant deployments; currency/price
features.
