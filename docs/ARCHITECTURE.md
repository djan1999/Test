# Milka Service Board Architecture

This document describes the application as an operating restaurant system, not just as a collection of screens.

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
| Live table/seat state | `service_tables` |
| Active service identity/date | `service_settings.service_date` |
| Reservations | `reservations` |
| Kitchen/floor operational markers | selected `service_settings` rows |
| Restaurant name and configured tables | `service_settings.restaurant_config_v1` |
| Courses and menu variants | `menu_courses` |
| Wines and beverages | `wines`, `beverages` |
| Completed services | `service_archive` |
| Staff access | `workspace_members` |
| Human administrative history | `audit_log` |

Browser storage is an instant-paint/offline optimization. It must never overrule newer database or PowerSync state.

## Service lifecycle

A service has both a date and a `startedAt` identity. Ending a service calls one Postgres transaction that:

1. Locks and verifies the service identity.
2. Refuses the operation if another device has already started a newer service.
3. Writes the archive snapshot.
4. Clears the existing configured table rows.
5. Clears the active service setting.

This prevents a stale tablet from ending or clearing a newer service. The database operation is atomic: all steps commit together or none commit.

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
- `src/config/restaurantConfig.js` validates restaurant/table configuration.
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
- API routes emit structured Vercel logs with route, event, request ID, and duration.

## Data lifecycle

- Service archives use soft delete first. Permanent purge is an explicit Admin action.
- Audit records have no browser-side delete path.
- No automatic retention deletion is enabled. This is the conservative choice until the restaurant selects a legal/operational retention period.
- Operational high-frequency taps are excluded from the administrative audit trail.

## Current intentional limitations

- A local Supabase database lint requires Docker/Postgres; static migration contracts run without it.
- Physical three-device drills remain mandatory before a production promotion.
- `App.jsx` still owns cross-domain orchestration and should continue shrinking only behind passing integration tests.
