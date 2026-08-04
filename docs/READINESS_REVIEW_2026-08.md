# Independent Review — Codex Production-Readiness Plan (Restaurant Service App)

Repo: djan1999/Test @ ea42936 · Live project: cvljktjmksfibuyphdln · Reviewed: 2026-08-04

## Context

Codex produced a production-readiness plan to prepare the app (currently serving Hotel Milka in production) for one controlled external restaurant pilot. This review independently verified Codex's findings against the actual repository code AND the live Supabase database (read-only catalog/policy/grant queries), challenged its conclusions, and identifies what is missing before implementation starts.

**Overall verdict: Codex's factual findings are essentially all correct — none are technically wrong. But the plan has three structural problems: (1) its Phase 2 remedy as written would convert silent data loss into permanently wedged devices; (2) its phase ordering does DDL/RLS changes on the live DB before backups are verified restorable and before the client can survive an RLS denial; (3) it misses the single most dangerous second-restaurant defect — the SYNC button importing Milka's catalogue into the new restaurant — and understates that RLS/tenancy currently has zero executed tests (existing "migration tests" only string-match SQL files).**

---

## Q1 — Are any confirmed findings technically incorrect?

No finding is factually wrong. Verdicts with corrections of emphasis:

| Codex finding | Verdict | Correction / nuance |
|---|---|---|
| 1. services policies member-only | ✅ Confirmed live (`pg_policies`) | Purge (DELETE) additionally requires `status='ended' AND deleted_at IS NOT NULL` — but any member incl. Kitchen can reach it in two steps (UPDATE to ended+trashed, then DELETE). Worse than Codex states: that DELETE **cascades into `service_tables`** (FK `ON DELETE CASCADE`), destroying board rows *despite* the admin-only `service_tables_admin_delete` policy — FK cascades are not subject to RLS — and `services` has **no audit trigger**, so it's untraceable. |
| 1b. Kitchen can insert/update reservations | ✅ Confirmed (`reservations_role_insert/update` include kitchen; DELETE is admin+service) | Codex missed the same question for **`service_tables`**: INSERT/UPDATE also include kitchen. This needs the same trace-and-decide treatment. |
| 2. PowerSync loses original workspace | ✅ Mechanism confirmed verbatim (`SupabaseConnector.js:161-167`; `trackPrevious` missing on exactly services/service_archive/beverages, `AppSchema.js:32,162,175`) | Two corrections: (a) it is **silent data loss, not cross-tenant corruption** — all three at-risk tables use globally-unique keys, the server query always filters `workspace_id`, and RLS backstops; a wrong-workspace op matches nothing and evaporates. (b) The zero-row-drop is *deliberate* for the deleted-row case (documented in-code); the defect is that the same path swallows wrong-workspace ops with no diagnostic. Ops actually exposed: service end/resume/soft-delete/purge, archive soft-delete/purge, beverage replace — the end-of-service patch (`serviceLifecycle.js:112-137`) carries no `workspace_id`. |
| 3. No cross-workspace constraint on service_tables | ✅ Confirmed | Not expressible today: `services` has `PRIMARY KEY (id)` only — the composite FK first needs `UNIQUE (workspace_id, id)` on services. See Q5. |
| 4. Onboarding manual | ✅ Confirmed — zero scripts, zero edge functions, no workspace INSERT anywhere in repo | Worse: the one documented onboarding SQL (`docs/DEMO_ACCOUNT_SETUP.md:17`) inserts role `'owner'`, which **violates the live CHECK constraint** (`admin|service|kitchen`) — copy-paste onboarding fails today. Staff invitation flow (`api/workspace-members.js`) is real and well-designed (service key only for auth-admin calls; membership writes via user JWT so RLS+audit apply). |
| 5. Milka-specific behaviour | ✅ Confirmed | Materially incomplete — see Q6. The most dangerous item (SYNC importing Milka's catalogue into restaurant 2) is missing from Codex's list. |
| 6. Recovery/field-testing incomplete | ✅ Confirmed (`INVARIANTS.md:66`: drills "never yet run on real tablets"; Drill F describes the retired blank-row-archive model and would produce a **false failure** for a tester) | Add: `README.md:51-53` claims roles are **not enforced** — flatly false and dangerous for anyone scoping a threat model from docs. Leaked-password protection disabled: confirmed via live advisor. Backup table: confirmed — `public.service_tables_backup_20260724`, 6 rows, RLS on/no policies, but **GRANT ALL to `anon` and `authenticated` incl. TRUNCATE** (TRUNCATE is not RLS-governed; PostgREST doesn't expose it, so not remotely exploitable — still the only anon grant in the schema, and the table exists in no repo SQL). |

Baseline claims (tests pass, build passes, migrations match, sync rules membership-filtered, Pro plan, one multi-workspace account, all-admin memberships) all verified or consistent with what I found. Live data: Hotel Milka = 3 admins, Demo = 2 admins, zero service/kitchen memberships ever created — confirming the role model is production-untested.

---

## Q2 — Is trackPrevious + removing the fallback sufficient?

**Right direction, insufficient as specified, and one part is actively dangerous as written.**

1. **Do both belt-and-braces, plus stamp at write time.** Enable `trackPrevious` on services/service_archive/beverages AND change the write helpers (`src/powersync/writes.js:112-129,147-150,309-333,344-347`; `src/lib/serviceLifecycle.js:112-137`) to include `workspace_id` in every UPDATE payload. Stamping makes `opData` authoritative (fallback tier 1) so correctness doesn't hinge on PowerSync internals; `trackPrevious` covers DELETEs (no payload) and legacy queued ops from before the fix.
2. **Codex Phase 2 item 3 ("treat unprovable ownership as a visible synchronization failure") must NOT be implemented as a retriable error.** The connector's `NEVER_DROP_TABLES` policy (`SupabaseConnector.js:91-93,378-421`) retries any permanent-classed error on services/service_tables/service_settings/reservations/service_archive **forever**, blocking uploads *and* downloads; the only recovery is an admin button that discards the queue. An "unresolvable workspace" op must be **skipped + recorded to the client diagnostics store + surfaced in UI** — never thrown as transient. This distinction is absent from Codex's plan and is the difference between "one lost edit" and "a wedged kitchen tablet mid-service".
3. **Detect the zero-row match.** Add `.select()` to update/delete calls and treat 0 affected rows as a diagnosable event (expected for deleted-row PATCH, alarming for anything else). Today PostgREST returns success on 0 rows and the connector can't tell. Note: the current test mock always returns `{error:null}` and structurally cannot represent 0-row matches — the harness needs extending before this is testable.
4. Also fix the adjacent wedge Codex missed: three CAS helpers throw code-less `Error`s after 4 attempts (`serviceTableCas.js:112`, `reservationCas.js:81`, `serviceSettingCas.js:57`) → classified transient → infinite retry. The reservations one is deterministically reachable (uuid existing under another workspace + `on conflict (id) do nothing`).
5. Existing tests will mislead implementers: `supabaseConnector.test.js:91-94` injects `workspace_id` into a services PATCH (real code never does), and the menu_courses fallback test (:499-505) encodes the active-workspace fallback as the *expected contract*. Both fixtures need correcting as part of Phase 2.

Encoding ownership differently (e.g. per-op metadata, per-workspace queues, clearing local DB on switch) is not needed: sync rules stream all memberships per user by design, local IDs are workspace-prefixed, and INSERTs are already airtight (`requireWorkspace()` + explicit column). Keep the architecture; fix the three tables and the failure surfacing.

---

## Q3 — Exact Admin/Service/Kitchen matrix (recommended)

Legend: ✓ allow · ✗ deny · **T** = decide by tracing actual device surfaces before enforcement (Codex planned this only for reservations; it must also cover service_tables and any background "heal"/reconcile writes that run on kitchen devices — an automatic write from a kitchen tablet that RLS now denies becomes a queue wedge).

| Table · action | Admin | Service | Kitchen |
|---|---|---|---|
| services SELECT | ✓ | ✓ | ✓ |
| services INSERT (start) | ✓ | ✓ | ✗ |
| services UPDATE (end/resume/label/snapshot) | ✓ | ✓ | ✗ **T** (verify kitchen devices never auto-heal services) |
| services UPDATE (soft-delete) | ✓ | ✗ | ✗ (column-guarded via trigger or fold into archive-management admin surface) |
| services DELETE (purge; keep ended+trashed predicate) | ✓ | ✗ | ✗ |
| service_tables SELECT | ✓ | ✓ | ✓ |
| service_tables INSERT | ✓ | ✓ | **T** (needed only if kitchen board CAS-inserts missing rows) |
| service_tables UPDATE | ✓ | ✓ | **T** (likely ✓ if kitchen writes course/fired state into `data`; else ✗) |
| service_tables DELETE | ✓ (existing) | ✗ | ✗ |
| reservations SELECT | ✓ | ✓ | ✓ |
| reservations INSERT/UPDATE | ✓ | ✓ | ✗ **T** (kitchen surfaces appear display-only; verify) |
| reservations DELETE | ✓ | ✓ (existing) | ✗ |
| service_archive SELECT | ✓ | ✓ | ✓ |
| service_archive INSERT/UPDATE | ✓ | ✓ (end-of-service writes archive) | ✗ |
| service_archive DELETE (purge) | ✓ | ✗ (tighten from current a+s) | ✗ |
| service_settings | keep existing granular per-key policies (good model) | | |
| wines/beverages/menu_courses | keep existing (admin write, all read) | | |
| workspace_members / workspaces / audit_log | keep existing (admin-managed; audit read-only) | | |

Practical notes: soft-delete vs other UPDATEs on `services` can't be separated by RLS alone (row-level, not column-level) — either accept service-role soft-delete or add a small BEFORE UPDATE trigger guarding `deleted_at` transitions to admin. The RPCs are all SECURITY INVOKER, so tightening table policies automatically tightens every RPC path — no separate RPC work needed. Keep the ended+trashed purge predicate; it's good.

---

## Q4 — Cross-tenant / lifecycle paths Codex missed

1. **FK-cascade purge bypass (new, important):** member-level `services` DELETE cascades to `service_tables` regardless of its admin-only DELETE policy, unaudited. Fixed by the Q3 matrix (purge → admin) + audit coverage (below).
2. **No audit triggers on `services`, `service_tables`, `reservations`, `service_archive`** — every lifecycle-destructive op is unlogged. Also `capture_admin_audit` skips when `auth.uid()` is null, so all service-role writes (wine cron, onboarding tooling) are invisible. At minimum add triggers on `services` + `service_archive` deletes/status flips.
3. **Restaurant-2 catalogue leak via SYNC (new, launch-critical):** with no saved `wine_sync_config`, the client's `DEFAULT_SYNC_CONFIG` (`src/config/syncConfig.js:6-15`) is Milka's scrape URLs — restaurant 2's admin pressing SYNC imports **Milka's commercial wine list** into their workspace, silently, successfully. Meanwhile the nightly cron (`api/sync-wines.js:367-368`) targets only `slug='milka'`, so restaurant 2's catalogue also silently never refreshes. Codex's Phase 4 must make sync **opt-in per workspace with no default source** — this is a blocker, not a branding cleanup.
4. **Live DB ≠ repo (bootstrap drift):** prod `private.is_workspace_member` has `search_path=public` while the repo says `''` (the hardening was never applied live — Codex's "harden" item is really "apply the repo to prod"); prod has an `rls_auto_enable` event trigger and three orphan trigger functions that exist in no repo SQL; the backup table exists in no repo SQL; live `service_tables_workspace_id_fkey` lacks the `ON DELETE CASCADE` that `schema.sql:190` declares. Consequence: **bootstrapping a fresh project from the repo does not reproduce production** — Phase 3 (onboarding) must first establish a canonical, tested bootstrap or the pilot's project will silently lack prod's safety nets.
5. **Grant hygiene:** `authenticated` retains Supabase's bootstrap `GRANT ALL` (incl. TRUNCATE, not RLS-governed) on every table incl. `audit_log`; the repo's narrower grant block is additive and effectively a no-op. Not remotely exploitable via PostgREST, but revoke to match intent.
6. **API endpoints:** no rate limiting, no CORS restriction; cron secret compared with plain `===` (not timing-safe); `findUserByEmail` caps at 10,000 users (fine for pilot). Minor, worth one pass.
7. **Conflict-model gaps that will surface in a two-restaurant/multi-device pilot:** service_tables PUT without previousValues degrades to whole-row overwrite — two devices each holding real content = last-uploader-wins (the guard only covers blank-over-worked); reservation "deleted on another device" signal is computed then discarded on the primary path (`SupabaseConnector.js:261-271`); most `service_settings` keys are blind LWW (only 3 floor keys get CAS/merge); account *change* silently discards a pending upload queue (`system.js:32-35`).

---

## Q5 — Composite constraint: migration/cascade problems?

Feasible and low-risk, but Codex's step is under-specified:

1. `ALTER TABLE services ADD CONSTRAINT services_workspace_id_key UNIQUE (workspace_id, id);` — prerequisite, trivially satisfiable (id already unique; 23 live rows).
2. Add `FOREIGN KEY (workspace_id, service_id) REFERENCES services (workspace_id, id) ON DELETE CASCADE` on service_tables; drop the old single-column FK after. **Preserving `ON DELETE CASCADE` is mandatory** — purge flows depend on it.
3. Zero mismatched rows confirmed by Codex; tables are tiny, so plain `ALTER` locks are fine (use `NOT VALID` + `VALIDATE` if being extra careful). No ON UPDATE concerns (ids immutable). PowerSync publication/replica identity unaffected.
4. Do it in the same migration wave as the RLS changes, and update `schema.sql` + the string-contract tests (`migrationContracts.test.js`) in the same PR.
5. While there: decide the drift on `service_tables_workspace_id_fkey` cascade (live lacks it, repo declares it) — align one way deliberately.

The constraint does **not** mitigate the cascade-purge bypass (#1 in Q4) — different problem, don't let it be sold as such.

---

## Q6 — Other Milka assumptions affecting a second restaurant

Beyond Codex's list (branding, env defaults, manifest, menu flags, rooms/sittings, wine sync, cron):

- **Build-time tenancy ceiling:** all `VITE_*` config (app name, rooms, sittings, PINs, rollover hour) is compiled into the bundle — one Vercel deployment cannot serve two differently-branded restaurants. Either migrate these to per-workspace `service_settings` (preferred; `restaurant_config_v1` already does this for name/tables) or accept one-deployment-per-restaurant and say so in the onboarding runbook.
- `VITE_APP_NAME` falls back to literal `"MILKA"` in **10+ files** — a misconfigured deploy fails *toward Milka*, not toward neutral. Change fallbacks to the neutral name once chosen.
- **Two PWA manifests disagree** (`public/manifest.webmanifest` vs inline `vite.config.js:35-52`) — a latent bug independent of branding; consolidate.
- **Hotel-restaurant structural assumptions:** `guestType === "hotel"` + room-number picker are hardwired across reservation forms and kitchen board — a standalone restaurant gets a dead Hotel toggle. Make it a workspace feature flag.
- **Locale/timezone/language:** `en-GB` and `sl-SI` formatting hardcoded across ~17 render sites; EN/SI is schema-structural (`*_si` columns); no per-workspace timezone — service-day rollover runs on device clocks with a build-time global rollover hour. Fine for a Slovenian pilot; a blocker for anything further. Scope-check the pilot restaurant's language/timezone explicitly.
- **Safety-relevant:** admin-added custom dietary restriction keys are **silently inert** (hardcoded `RESTRICTION_PRIORITY_KEYS`/`RESTRICTION_COLUMN_MAP`; documented in `APP_ANALYSIS_2026-07.md:673-676`). A second restaurant customizing its allergy list gets configured-but-nonfunctional substitution behaviour. Fix or explicitly constrain in onboarding.
- **Don't churn:** `milka*` localStorage keys, `milka-powersync-v3.db`, `MILKA_TABLE_CONFLICT` wire code are cosmetic; renaming them mid-pilot risks data/compat bugs for zero user value. Leave them; note as post-pilot cleanup.
- The migration `20260710010000` preflight hardcodes slug `'milka'`; verification SQL in README/docs keys on `('milka','demo')` — extend for new workspaces.
- `env.example` is stale vs `DEPLOYMENT_RUNBOOK.md` (`APP_URL`, `VERCEL_PROJECT_PRODUCTION_URL`, server-side `SUPABASE_ANON_KEY` missing).

---

## Q7 — Missing failure scenarios (automated + physical)

Additions to Codex's Phase 6 list:

**Automated (and the big structural one):**
- **RLS tests must execute against a real Postgres** (supabase CLI local stack or a CI database), not the current string-matching of SQL files — today there is exactly **one** grep-hit resembling a cross-workspace test in 86 files, and no policy is ever evaluated. Codex says "adversarial RLS tests" without specifying the harness; if they land as more string-matches, they're worthless. This is the largest single testing gap.
- Queue-wedge scenarios: RLS-denied op on a NEVER_DROP table (must surface, not wedge); CAS 4-attempt exhaustion; reservation uuid collision across workspaces.
- Zero-row update/delete detection (requires extending the connector test mock, which can't currently represent it).
- Two devices offline both START a service → `services_single_live` supersede semantics on reconnect.
- Two devices edit the same table with real content on both → current whole-row LWW; at minimum assert-and-document the loser.
- Reservation deleted on device A while edited on device B → the deleted:true signal must surface.
- Account switch (not workspace switch) with pending uploads → currently silently discards the queue.
- Post-Phase-1 permission matrix: every role × action × table against real RLS, incl. the two-step purge path and the FK-cascade path.

**Physical / operational:**
- Restore drill: not just "restore into an isolated environment" — also write the **post-restore client playbook**: after a DB point-in-time restore, every device's PowerSync checkpoint and pending queue are ahead of the server; they will need forced clear-and-resync, which discards local edits. Restoring the DB without this step produces divergent tablets. Codex's Phase 5 omits it entirely.
- PWA update propagation: reconnect-after-deploy is listed, but also test stale service-worker + new schema (device offline during deploy, returns days later).
- Wedge-recovery drill on a real tablet: deliberately wedge the queue, verify the diagnostic surfaces, run clear-and-resync, document what was lost.
- Old-tablet performance: no local SQLite indexes are declared (`indexes: {}` everywhere) while reads filter on workspace/date/service — measure on the actual kitchen hardware before pilot.
- Drill F rewrite (Codex has it) — plus fix the false README security claim and the broken `'owner'` onboarding SQL in the same docs pass.

---

## Q8 — Is the rollout order safe for a live restaurant?

**No — two reorderings required, one strongly recommended:**

1. **Backups verified BEFORE any DDL, not in Phase 5.** Codex runs constraint + policy migrations on the live DB in Phase 1 and only tests restore in Phase 5. Move "confirm current backup + prove restore into a scratch project" to Phase 0.
2. **Client resilience (Phase 2's error-surfacing + workspace stamping) must deploy BEFORE server-side RLS tightening (Phase 1), with queues drained.** Otherwise the first RLS denial of an op already queued on a tablet wedges that device mid-service (NEVER_DROP retry-forever). Concretely: ship the connector changes → confirm Milka's devices have drained (diagnostics/audit) → then apply the policy migrations. Since all current production users are admins, the Milka-facing risk of the policy change itself is low — the danger window is exactly the interaction between new policies and queued/automatic writes from future role-restricted devices, so create the first service/kitchen test memberships only *after* both halves have landed.
3. Recommended sequence: **0)** backup+restore proof, enable leaked-password protection (safe: only evaluated on new sign-ins/password changes, existing sessions unaffected), lock down backup table (revoke grants / move schema; keep data pending approval) — all zero-risk to live behaviour. **1)** PowerSync ownership + failure surfacing (client). **2)** DB integrity + role matrix + function hardening + real-DB RLS test harness. **3)** Onboarding (incl. canonical bootstrap that reproduces prod — see Q4#4). **4)** Milka decoupling incl. sync-config opt-in. **5)** Drills, docs refresh, physical simulation. Everything via PR + preview as Codex says.

---

## Q9 — Before the first external restaurant handles real guest data

Codex's item 7 (review PII handling, defer legal wording) is right but under-scoped. This data is **GDPR Art. 9 special-category (health)** — allergy/dietary data tied to named guests — as the repo's own roadmap acknowledges. Minimum technical bar before external guest data:

1. **An export path exists** (there is none today — no CSV/JSON anywhere; the only output is print HTML) and **a deletion path that doesn't require hand-written SQL against JSONB** (reservations have no soft-delete; erasure today = manual surgery).
2. **A written retention decision** (today: indefinite accumulation of names+allergies in reservations, ended services, archive snapshots, audit before/after images, plus unencrypted copies in localStorage and the on-device SQLite of every tablet).
3. **Device posture:** tablets hold full unencrypted guest/allergy data offline — document device PIN/lock requirements and a lost-device procedure (clear-and-resync equivalent / Supabase session revocation) in the onboarding checklist.
4. **Processor chain:** Supabase + Vercel + PowerSync (note: the PowerSync instance URL is a hardcoded shared default — one instance, both tenants) — confirm DPAs exist for all three for the pilot restaurant's jurisdiction.
5. Fix the inert-custom-allergy-keys bug (Q6) — it is a food-safety issue, not cosmetics.

---

## Q10 — Go/No-Go checklist

**Launch blockers (No-Go until all green):**
- [ ] Role matrix (Q3) enforced in RLS and proven by tests that execute against a real Postgres — every role × action × table, plus cross-workspace denial, two-step purge, FK-cascade path.
- [ ] PowerSync workspace ownership fixed (trackPrevious + write-time stamping + fallback removed) AND unresolvable/denied ops surface as diagnostics instead of wedging or vanishing; regression tests for the A→B switch scenario.
- [ ] Composite `services(workspace_id,id)` constraint live (with cascade preserved).
- [ ] Wine/beverage sync is opt-in per workspace with **no default source**; cron remains Milka-only explicitly; restaurant 2 has a working catalogue path (manual entry or CSV import).
- [ ] Onboarding runbook executed end-to-end at least once (fresh workspace + admin + neutral seed) against a bootstrap that provably reproduces production (drift items from Q4#4 resolved), with rollback steps, no service key in the browser.
- [ ] Backup restore proven in an isolated environment + post-restore device playbook written.
- [ ] Neutral branding build verified: bundle + PWA manifests + onboarded workspace contain no Milka strings (Codex's grep step) and `VITE_APP_NAME` fallbacks are neutral.
- [ ] Drills rewritten for the service-entity model and the full physical multi-device simulation (FOH/Kitchen/Admin, offline segments, deploy-during-offline) passed on the pilot's actual hardware.
- [ ] Guest-data minimum (Q9 items 1–3): export, deletion, retention decision, device posture documented.
- [ ] Milka regression: full suite + build + a live service night (or Demo drill) on the new build before the pilot restaurant is onboarded.

**Strongly recommended, not blocking:**
- [ ] Audit triggers on services/service_archive lifecycle ops; decide on service-role write auditing.
- [ ] Backup table grants revoked / table moved (data kept pending explicit approval — Codex is right to gate deletion).
- [ ] `is_workspace_member` search_path aligned live-vs-repo; bootstrap grants (`GRANT ALL` incl. TRUNCATE to authenticated) trimmed.
- [ ] Wedge-recovery + lost-device procedures in the ops runbook; stale docs fixed (README role claim, DEMO_ACCOUNT_SETUP `'owner'` bug, drill F, REWORK_NOTES counts).
- [ ] Timing-safe cron secret compare; basic rate limiting on the two API endpoints.
- [ ] Local SQLite indexes for hot reads; measure on real kitchen hardware.

---

## Summary of changes to make to Codex's plan before implementation

1. **Reorder:** backups/restore proof → Phase 0; client-side Phase 2 lands before server-side Phase 1; leaked-password protection can be enabled immediately.
2. **Rewrite Phase 2 item 3:** failure surfacing = skip + diagnostic + UI, explicitly *not* a retried error (NEVER_DROP wedge); add write-time workspace stamping; add zero-row detection; fix the two misleading connector test fixtures; extend the mock to represent 0-row results.
3. **Extend Phase 1:** service_tables kitchen-write decision; background-write trace on kitchen devices before enforcement; UNIQUE(workspace_id,id) prerequisite + cascade preservation for the composite FK; audit triggers for service lifecycle; keep RPCs as-is (SECURITY INVOKER means they inherit the fix).
4. **Extend Phase 3:** canonical bootstrap reproducing prod (drift list Q4#4); fix the broken documented onboarding SQL.
5. **Extend Phase 4:** sync default-source removal is a **blocker**, not cleanup; add manifest consolidation, neutral fallbacks, hotel-mode flag; explicitly de-scope cosmetic `milka*` key renames.
6. **Extend Phase 5/6:** real-DB RLS test harness as a named deliverable; post-restore client playbook; wedge-recovery drill; PII export/delete/retention as pilot prerequisites; docs-staleness fixes.

