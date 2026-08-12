# Milka Service Board Architecture

This document describes the application as an operating restaurant system, not just as a collection of screens.

> **Where the truth lives today (read this first).** The live board is the
> `service_tables` card engine — documents, compare-and-swap merges, folds,
> the worked-content shield and the database board history. The append-only
> Logbook (`service_events`, `docs/EVENT_LOG_PLAN.md`) is **dual-written
> alongside it and read only for diagnostics** (Time Machine story view,
> parity checks, archived-night reports). The Phase-4 cutover that would make
> the folded log the board was **cancelled by owner decision on 12.08.2026**
> (`docs/EVENT_LOG_PLAN.md`, STATUS close-out) — the log is frozen as a
> diagnostics-only observer. Nothing in this document describes the log as a
> source of truth, and the card-path defences listed here are permanent.

## What the application is

Milka Service Board is an installable React PWA used by Service, Kitchen, and Admin devices during a restaurant service. It combines reservations, table and seat state, guest restrictions, drinks, course progress, terrace movement, kitchen tickets, menu configuration, and service archives.

The design goal is local-first operation: a tablet should continue working through a short network interruption and merge back into the shared restaurant state when connectivity returns.

## Operating surfaces

| Surface | Primary purpose | Allowed roles |
| --- | --- | --- |
| Service | Seat parties, edit seats, drinks, restrictions, table moves, and course coordination | Admin, Service |
| Kitchen | Kitchen tickets, firing, archive/recovery, terrace and dining-floor views | Admin, Kitchen |
| Reservations | Weekly planner and reservation editing | Admin, Service |
| Menu | Guest menu preview and printing | Admin, Service |
| Admin | Staff, restaurant setup, courses, drinks, floor maps, audit trail, diagnostics | Admin |

The UI hides unavailable surfaces for convenience. Supabase Row Level Security is the actual authorization boundary.

## Device-to-device data path

```text
Service tablet ─┐
Kitchen screen ─┼─ local SQLite (PowerSync) ─ upload/download stream ─ Supabase/Postgres
Admin device ───┘
```

When PowerSync is unavailable or disabled, the app uses a direct Supabase fallback with Realtime subscriptions, retries, and local browser caches. The fallback exists for continuity; PowerSync SQLite is the preferred operating store.

### Sources of truth

| Information | Source of truth |
| --- | --- |
| Live table/seat state | `service_tables`, scoped by `service_id` |
| Active service identity/date | the `services` row with `status='live'` |
| Reservations | `reservations` |
| Kitchen/floor operational markers | selected `service_settings` rows (floor SET strips are per-service keys) |
| Restaurant name, subtitle, configured tables, hotel features | `service_settings.restaurant_config_v1` |
| External catalogue sync source | `service_settings.milka_sync_config_v1` — **no provider by default** |
| Courses and menu variants | `menu_courses` |
| Wines and beverages | `wines`, `beverages` |
| Completed services | ended `services` rows (with their `service_tables`); `service_archive` holds pre-entity legacy snapshots only |
| Recent prior versions of a board row (newest 48 per table, server-written, Admin-readable) | `service_tables_history` |
| Recorded gestures (diagnostics, not board truth) | `service_events` |
| Staff access | `workspace_members` |
| Human administrative history | `audit_log` |

Browser storage is an instant-paint/offline optimization. It must never overrule newer database or PowerSync state.

## Service lifecycle

**A service is a permanent entity, and ending one is non-destructive.**

Each service is one row in `services` (`id`, `date`, `session`, `started_at`,
`status`, …), and every board row carries the `service_id` it belongs to.

- **START** inserts a new `services` row. Nothing is cleared — the new service
  simply has no `service_tables` rows yet. A serialized single-live trigger
  ends any other live service as `superseded`, which is also non-destructive:
  that service keeps every one of its rows.
- **END** flips that one row to `status='ended'`. It is idempotent, addresses
  exactly one row by id, and copies and blanks nothing. **The ended service,
  with all its table rows, *is* the archive entry.**
- **RESUME** flips an ended row back to `status='live'`; its board comes back
  on every device because its rows were never removed. The single-live trigger
  still arbitrates, so a resume can never displace a newer running service.

Because a stale or offline device can only ever address the old service row it
already knows about, **no lifecycle transition can blank the board**. That is
the property that makes the mid-service wipe class structurally impossible
rather than guarded-against: the wipes all came from a lifecycle step that
also cleared rows, and no lifecycle step clears rows any more. The legacy
`archive_and_finish_service` RPC, whose transaction did clear rows, is a
neutered stub with no client caller; the pre-entity behaviour it implemented
is history, not current design.

### Blanking the board is still possible — deliberately

The lifecycle cannot do it. Two explicit operator actions still can, and both
are outside the lifecycle:

- **Admin → CLEAR ALL** blanks every configured table on the live board. It is
  Admin-only, confirmed, and names its consequence in the prompt; it discards
  without archiving, which is why the prompt points at Archive & Clear
  instead. This is a real whole-board blank — do not read "a service is never
  blanked" as covering it.
- **CLEAR TABLE** does the same for one table.

Both go through the normal write path, so the compare-and-swap, the
worked-content shield and the board-history recorder all apply: the blanking
writes are recorded like any other edit, and the operator's device must have
seen the content it is replacing.

Deletion of a whole service is also possible, but only as a deliberate Admin
act: soft-delete to trash, then an explicit purge that cascades that service's
rows *and its history* away.

### Board write safety

Board writes go through `save_service_table_if_current`, a compare-and-swap
RPC. On top of it:

- **Board history** — an `AFTER` trigger records each new version of a board
  row into `service_tables_history`. No client can write to it or skip it.
  **It is capped by version count, not by age**, and the two are easy to
  confuse:

  - The same trigger prunes each `(workspace, service, table)` key to its
    **newest 48 versions**, but only *on a write to that key*. A busy table's
    older versions are therefore gone — while a table that has stopped being
    written to keeps whatever it last held, **indefinitely**. Nothing ages out
    on its own; there is no scheduled job.
  - So an ended service's history does not shrink over time. It goes away only
    with **guest erasure** (which deletes the versions still carrying the
    erased party's name) or an **Admin service purge** (the `service_id` FK
    cascades that service's whole history away) — the latter being a manual
    action today.

  Read the guarantee as "recent board state on a live table is recoverable",
  never as "nothing can ever be lost" and never as "old history cleans itself
  up". Both halves matter: the first is why the Time Machine is not a backup,
  the second is why this table is in scope for a retention decision (see Data
  lifecycle).
- **The worked-content shield** — a write may not replace a row holding worked
  content (kitchen activity, drinks, seat data) with one holding none, unless
  the writer attests it saw that content.
- **The Time Machine** — `restore_service_board` puts a service's board back to
  any moment **still inside the retained window**, writing through the normal
  row path so the restore is itself recorded and undoable. A moment older than
  a table's 48 retained versions, or one belonging to a purged service or an
  erased guest, cannot be restored.

> **Known inconsistency — behaviour deliberately unchanged here.** The CLEAR
> ALL prompt says the discard "cannot be undone". In practice the Time Machine
> often *can* undo it: the blanking write is itself a recorded version, so the
> pre-clear state is restorable while it remains within that table's 48
> retained versions. The prompt is therefore more absolute than the system.
> Both readings are defensible — the prompt is a safe over-warning, and
> recovery is genuinely not guaranteed — but they disagree, and an operator
> may abandon a recoverable night because the dialog told them it was gone.
> Resolving it (softening the wording, or surfacing "restore the last moment
> before this clear") is a UI change on a destructive path and needs its own
> tested PR; it is out of scope for a documentation cleanup.

## Merge rules that must remain true

- A stale device cannot end a newer service.
- A live table is never replaced by an empty/stale table during reconciliation.
- Different seats edited on different devices are folded together.
- Conflicting edits to the same seat use the newest valid update.
- Table identity follows the stable table ID, never screen position.
- A table move/swap updates table state and reservation ownership through the same storage seams.
- A test service is in-memory only and never writes, archives, or caches its board.
- A deployed PWA update waits; it never forcibly reloads every tablet mid-service.

See `docs/INVARIANTS.md` and `docs/SERVICE_DRILLS.md` for the executable operating expectations.

## Role enforcement

Roles are `admin`, `service`, and `kitchen`. Legacy `owner` and `staff` rows migrate to `admin` and `service`.

Postgres policies decide which rows and actions a signed-in account may use. Server functions that hold the Supabase service key independently verify the user's token, active workspace, and Admin role before privileged work.

The final Admin cannot be removed or demoted. A serialized database trigger prevents two Admin devices from racing each other and leaving a restaurant without administration.

## Code boundaries

- `src/App.jsx` coordinates live operating state and cross-domain workflows.
- `src/hooks/useWorkspaceAccess.js` owns login, workspace selection, and the current role.
- `src/components/service/DisplayBoard.jsx` owns the service timeline/cards and quick controls.
- `src/components/service/MoveTablePicker.jsx` owns move/swap confirmation UI.
- `src/config/restaurantConfig.js` validates restaurant/table/hotel-feature configuration.
- `src/config/buildDefaults.js` parses the build-time restaurant defaults (room options, sitting times, quick-access items, the neutral config seed). They are a pre-login starting point only; workspace data wins once loaded.
- `src/lib/eventLog.js` is the append-only Logbook seam; `src/utils/eventFold.js` and `src/lib/parityRecord.js` fold and grade it. None of them write the board.
- `src/utils/menuCourseMapper.js` translates between database rows and UI course models.
- `src/lib/*Store.js` files are storage seams. UI components should call them instead of constructing database writes.
- `src/powersync/` owns local SQLite reads, writes, schema, watches, and uploads.
- `api/` contains Vercel server functions whose secrets must never enter the browser bundle.
- `supabase/migrations/` is the authoritative ordered database change history.

`src/__tests__/seamDiscipline.test.js` fails when a new direct database call bypasses an approved storage seam.

## Failure behavior and diagnostics

- Failed reads keep the last usable local/cached information on screen.
- Failed writes remain visible as sync errors and retry where the workflow allows it.
- React render crashes show a recovery screen instead of a blank page.
- Browser errors and unhandled promise failures are retained locally in a bounded, redacted diagnostic report.
- Admin System shows build ID, storage mode, sync state, stream errors, pending PWA updates, and device diagnostics.
- Admin System → Logbook shows the live service's event count, the night as a story, a CHECK PARITY button, the end-of-night parity record, and the Time Machine restore points. These are **diagnostics over the card engine**, not an alternative board.
- Diagnostics distinguish a DEFENCE that fired (a stale write refused — the system working) from an ERROR (something broke), so a red entry still means something.
- API routes emit structured Vercel logs with route, event, request ID, and duration.

## Restaurant configuration is workspace data

The restaurant name, subtitle, table set (ids and labels) and hotel features
(hotel-guest mode and its room list) live in the workspace's
`restaurant_config_v1` setting, not in the build. `VITE_*` values only seed a
brand-new deployment before a workspace has loaded. A new workspace starts
neutral: ten `T01`–`T10` tables, hotel features off, and **no external
catalogue sync provider** — so a new restaurant's first SYNC press cannot
import another restaurant's catalogue. The Milka scrape remains an explicit,
opt-in, Milka-only integration.

Admin-added **custom dietary restrictions participate in menu substitution**.
The substitution order is built from the live workspace vocabulary (allergies
outrank lifestyle choices, then in-group order), with the legacy fixed list
appended so old data still resolves; a configured variant for a custom key
reaches menus and kitchen tickets like any built-in.

## Data lifecycle

- Service archives use soft delete first. Permanent purge is an explicit Admin action.
- Audit records have no browser-side delete path.
- Admin → Data & Privacy provides a **workspace data export** and **exact-name guest erasure** (the typed name must match; erasure covers reservations, service history, board-row history versions and event payloads).
- No automatic retention deletion is enabled **for reservations, services, archives or audit records**. This is the conservative choice until the restaurant selects a legal/operational retention period.
- `service_tables_history` is **capped by version count, not by age** — and that is not an exception to the line above. Each write drops that table's versions beyond the newest 48, so a *live* table's undo window stays bounded without an external job. But the cap is enforced *by writes*: once a service ends and its rows go quiet, its remaining versions stop being pruned and persist indefinitely. Those rows carry guest names and allergy data, so `service_tables_history` **is** in scope for a retention decision — it should follow the parent service's approved period, which the `service_id` FK cascade already applies whenever a service is purged. That purge is a manual Admin action today, and the period is still unapproved.
- Operational high-frequency taps are excluded from the administrative audit trail.

## Current intentional limitations

Verified open as of 2026-08-11. Each of these is *not implemented*, not merely
undocumented — do not read the sections above as covering them.

- **Timezone is per device, not per workspace.** Service-day rollover runs on the device clock against a build-time rollover hour.
- **Sittings and languages are not generalized.** Sitting times come from a build-time `VITE_DEFAULT_SITTING_TIMES` list; EN/SI is structural in the schema (`*_si` columns) and locale formatting is hardcoded at the render sites.
- **No approved retention periods.** The controller has not signed a reservation/allergy, archive, audit, backup or device-cache retention schedule.
- **No restore proof.** No production backup has been restored into an isolated project with recorded evidence.
- **No physical role drills.** Admin/Service/Kitchen drills on the real FOH and Kitchen hardware have not been run; live role memberships remain admin-only.
- **No centralized telemetry.** There is no Sentry/APM or server-side error aggregation. Diagnostics are a bounded, redacted, per-device local log surfaced in Admin → System, and Vercel logs cover the API routes only.
- The executable Postgres role matrix (`supabase/tests/pilot_role_matrix.sql`) passed 64/64 on a disposable branch, but **GitHub CI does not run it** — CI is `npm run check` plus `npm audit` only.
- A local Supabase database lint requires Docker/Postgres; static migration contracts run without it.
- `App.jsx` still owns cross-domain orchestration and should continue shrinking only behind passing integration tests.
