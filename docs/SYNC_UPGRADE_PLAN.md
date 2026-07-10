# Sync & Data-Storage Upgrade Plan

Status: proposal · Owner: engineering · Context: the live service board is a
multi-device, realtime, offline-tolerant app whose sync was hand-rolled inside
`src/App.jsx`. A run of production incidents (board wipe on a joining device,
service-date pinning, account/workspace picker bounce, slow sync) all trace to
that one foundation. This document is the plan to fix it properly.

---

## 1. Diagnosis — why the bugs cluster

The live-service state is synced by **five separate `useEffect`s** in a
4,600-line component, with implicit ordering rules between them:

1. initial load (`loadRemoteTables`)
2. an 8s poll
3. realtime subscription
4. the reservation→board reconcile
5. the debounced autosave

Combined with three structural weaknesses:

- **Whole-row, last-write-wins writes.** Each table is one JSON blob, overwritten
  wholesale; conflicts are "resolved" by comparing `updated_at`. Two devices
  editing the same table clobber; there is no version check, so a stale device
  could overwrite good data (the wipe).
- **localStorage used as live state, not just cache.** Stale boot state could be
  pushed over the live board. The `tableLocalFreshRef` timestamp is a per-device
  heuristic, not concurrency control.
- **Reconcile mixes two jobs** — templating tables from reservations *and*
  touching live state — which is structurally why it could destroy work.

Recent fixes (remoteBoardLoaded gate, non-destructive reconcile, mass-blank
backstop, join-without-clear) are correct but are **guards bolted on** to this
model. Phase A replaces the guards with a sound model; Phase B replaces the
hand-rolled sync entirely.

---

## 2. Phase A — Stabilise the current stack (days, low risk, no migration)

Same Supabase. Goal: make sync a single, tested module with real concurrency
control, so the bug class is impossible rather than guarded against.

### A1. One owned sync module
Extract load + poll + realtime + merge + write out of `App.jsx` into
`src/lib/boardSync.js` (pure logic) + `src/hooks/useBoardSync.js` (wiring).
Pure decision functions already exist and are tested: `tableHasServiceContent`,
`planBoardWrites` (`src/utils/boardPersist.js`). Start with a
**behaviour-preserving extraction** (no logic change) guarded by the existing
App smoke test + new unit tests, so the seams stop hiding bugs.

### A2. Optimistic concurrency on writes (the real fix)
Every `service_tables` row already has `updated_at`. Change the write from a
blind upsert to a **compare-and-swap**:
`update(payload).eq('table_id', id).eq('updated_at', lastSeenUpdatedAt)` and
check the affected-row count. If 0 → the remote advanced (another device wrote):
re-fetch that row, **merge only the fields this device changed** onto it, and
retry. This makes a stale device physically unable to overwrite newer data and
retires the mass-blank backstop.

### A3. Field/seat-level merge
On the CAS retry, diff `local vs lastSeen` and apply only the changed
paths (seat, water, pairing, kitchenLog, …) onto the fresh remote row. Two
devices editing **different seats of the same table** then merge instead of
clobbering — today they clobber.

### A4. Reconcile becomes a pure, decoupled function
`reservationTemplateForBlankTables(tables, reservations)` returns updates **only**
for tables with no service content (`tableHasServiceContent === false`). It
never touches live tables and is fully unit-tested, decoupled from the write
path.

### A5. Cache is paint-only
Keep rendering from localStorage for instant paint, but formally forbid the
write path from acting on cache before the server load (the `remoteBoardLoaded`
gate, made explicit in the module).

### A6. Tests
Unit tests for the CAS/merge decision logic and a simulated two-device
concurrent-edit test (device A seats T1, device B seats T2 → both survive;
both edit T1 different seats → merge).

**Risk & deploy:** this touches the live write path, and the repo auto-deploys
to the floor. Do Phase A on a branch with a **Vercel preview URL**, test on a
spare tablet against a scratch workspace, and only merge to `main` during a
closed window (not before a dinner service).

---

## 3. Phase B — Offline-first sync engine (the structural upgrade)

The app is textbook local-first: tablets, spotty floor wifi, shared live state.
Purpose-built engines handle offline, persistence, realtime, and conflict
resolution so we stop hand-rolling them. Researched options (June 2026):

### Recommended: PowerSync
- **Why it fits:** built specifically for **Supabase + offline-first**, with a
  **Web SDK** (not just mobile). Syncs Supabase Postgres ⇄ a local **SQLite** DB
  in the client; the app reads/writes locally (instant, works offline) and an
  **upload queue** flushes to Supabase when the network returns. Connects
  non-invasively (no schema changes / no write access required). **Sync Rules**
  scope which data reaches which device — a natural fit for our per-`workspace_id`
  isolation. Conflict handling is built-in and configurable.
- **What changes in our app:** `scopedFrom(...)` queries are replaced by
  PowerSync local queries; the five sync effects, `planBoardWrites`,
  `tableLocalFreshRef`, the poll, and the autosave are **deleted**. Writes go to
  local SQLite; PowerSync's backend connector pushes them to Supabase via the
  existing client. Realtime "just works" through the sync stream.
- **Effort:** ~1–2 weeks. Main work: define Sync Rules, write the backend
  connector, and migrate the data-access layer. RLS/auth stays as-is.
- **Cost/ops:** adds the PowerSync service (managed cloud or self-host).

### Alternatives
- **ElectricSQL** — Postgres sync engine (in beta, used in production e.g.
  Trigger.dev). Excellent at **read sync** (shapes) and pairs with PGLite +
  TanStack DB; you build more of the **write path** yourself. Lighter/less
  batteries-included for offline writes than PowerSync. Good if reads dominate.
- **Zero (Rocicorp)** — strong DX, query-driven sync; newer, less Supabase-native.
- **Stay hand-rolled but hardened (Phase A only)** — viable if offline isn't a
  hard requirement; cheapest, but you keep owning the sync engine.

### Recommendation
Ship **Phase A now** to make the current app trustworthy on the stack you run,
then adopt **PowerSync** for the live-service tables as the deliberate Phase B —
piloted on one screen (e.g. the kitchen board) before cutting over the whole
floor.

---

## 4. Sequencing
1. Phase A on a preview branch → test on a spare tablet → merge in a closed window.
2. Retire the band-aid guards once A2/A3 land.
3. Spike PowerSync on a scratch workspace; validate Sync Rules + offline + write
   queue; pilot one screen; then migrate the rest and delete the hand-rolled sync.

## Sources
- PowerSync × Supabase guide — https://docs.powersync.com/integrations/supabase/guide
- PowerSync “offline-first, the right way” — https://powersync.com/blog/bringing-offline-first-to-supabase
- Supabase partner page (PowerSync) — https://supabase.com/partners/integrations/powersync
- ElectricSQL Postgres Sync — https://electric-sql.com/primitives/postgres-sync
- Electric vs PowerSync vs Zero (2026) — https://trybuildpilot.com/648-electric-sql-vs-powersync-vs-zero-2026

---

## 5. COMPLETE — workspace-qualified PowerSync ids

**Status: implemented in the 2026-07-10 hardening release.** The app, sync
rules, connector mapping, tests, and v2 local database filename are coordinated.
Reads remain explicitly workspace-scoped; an authenticated multi-workspace user
may safely retain authorized rows for more than one workspace.

### The hazard
PowerSync requires a text `id` primary key on every local table. The composite-
key tables have no such column, so the sync streams alias the natural key into
`id`:

```
service_tables → CAST(table_id AS TEXT) AS id
menu_courses   → CAST(position AS TEXT) AS id
wines          → "key" AS id
```

These aliases are **not workspace-qualified**. Within one workspace that's
fine (table_id/position/key are unique per workspace). But if one device syncs
**two** workspaces at once, workspace A's `service_tables` row for table 3 and
workspace B's row for table 3 both land on local `id = "3"` — they collide and
one silently overwrites the other. Same for `menu_courses` position and any
`wines` key shared across workspaces.

The uuid-keyed tables (`reservations`, `service_archive`) and `service_settings`
(id already unique per workspace only, but its rows are workspace-scoped in
every query) are **not** affected the same way — reservations/archive use real
uuids; service_settings collisions would need the same id in two workspaces,
which the app's fixed id set makes possible, so include it in the fix too.

### The fix — client + sync rules deploy TOGETHER
The alias must become a composite of workspace_id + the natural key, on **both**
sides in one coordinated deploy. Deploying one side without the other duplicates
or drops rows, so treat this as a single atomic change with the app in a
maintenance window.

**1. `powersync/sync-rules.yaml`** — qualify every aliased id (illustrative):

```yaml
service_tables:
  query: >-
    SELECT (workspace_id || '|' || CAST(table_id AS TEXT)) AS id, *
    FROM service_tables
    WHERE workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.user_id())
menu_courses:
  query: >-
    SELECT (workspace_id || '|' || CAST(position AS TEXT)) AS id, *
    FROM menu_courses
    WHERE ...
wines:
  query: >-
    SELECT (workspace_id || '|' || "key") AS id, *
    FROM wines
    WHERE ...
service_settings:
  query: >-
      SELECT (workspace_id || '|' || id) AS id, state, updated_at, workspace_id
    FROM service_settings
    WHERE ...
```
(This file is normally OUT OF SCOPE to edit — this is the one sanctioned change,
and only in the coordinated window.)

**2. Client `id` construction** must match the new alias EXACTLY, everywhere the
local `id` PK is written or matched:
- `src/powersync/writes.js` — `upsertLocalRow`, `writeReservation`,
  `replaceManualBeverages`, and the menu/wines helpers set the local `id` to
  `String(naturalKey)`. Change to `` `${ws}|${naturalKey}` `` for the four
  aliased tables (service_tables, menu_courses, wines, service_settings).
- `src/powersync/SupabaseConnector.js` — `uploadData()` reconstructs the natural
  key FROM the local `id` (`buildRow`, the DELETE branch). Split on `'|'` and
  take the last segment instead of using the whole `id`. The upload conflict
  targets and Postgres payloads are unchanged (they already use the real
  columns, not the alias), so **only the id↔naturalKey mapping moves.**
- The `reviveRow` reads (`src/powersync/reads.js`) select real columns, not
  `id`, so reads need no change beyond what's already workspace-scoped.

**3. Migration / cutover**
- Bump `dbFilename` in `src/powersync/system.js` (e.g. `milka-powersync-v2.db`)
  so every client rebuilds its local DB from scratch under the new aliases —
  avoids a half-migrated local file mixing old (`"3"`) and new (`ws|3`) ids.
- Deploy the sync-rules change and the client change in the same release.
- Verify with the dashboard Sync Test tool (simulate a user in two workspaces →
  no id collisions) before trusting any client read.

### Checklist to close this out
- [x] sync-rules aliases workspace-qualified for the 4 tables
- [x] `writes.js` local id = `${ws}|${key}` for the 4 tables
- [x] `SupabaseConnector` natural-key rebuild removes the workspace prefix
- [x] `dbFilename` bumped so local DBs rebuild
- [x] connector + writes unit tests updated for the composite id
- [ ] Sync Test: a two-workspace user sees no collisions
- [x] obsolete foreign-row tripwire removed; account changes still clear the v2 local DB
