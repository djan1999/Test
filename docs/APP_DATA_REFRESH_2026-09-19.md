# App-wide data refresh

## Problem

Several settings were read only at mount. Catalogue editors retained their first
copy of the data. Realtime events alone could not repair missed updates, and
overlapping reads could apply an older snapshot after a newer notification.
These paths made restarting or clearing a device appear necessary.

## Changes

- Shared query lifecycle: refresh on focus, visibility return, network return,
  database notifications, and every 60 seconds while visible. Failed reads retry
  with capped backoff. Reads time out after 20 seconds; disposed or superseded
  results cannot paint over current data. Errors keep the last successful data.
- Both PowerSync and direct Supabase readers participate. PowerSync transport
  recovery reconnects without clearing SQLite or its upload queue; new sync
  checkpoints also invalidate readers.
- Live settings include menu profiles and migrations, rules, bilingual text,
  logo, restrictions, quick notes, aperitif/digestivo configuration, catalogue
  sync configuration, restaurant configuration, floor maps/markers, and ticket order.
- Catalogues, reservations, services, board data, archives, guest history,
  service cadence history, inventory, workspace access, staff lists, setup
  readiness, and audit history use refreshable reads. Paginated catalogue,
  reservation, settings-prefix, and archive-table reads avoid the REST row cap.
- Settings with pending saves hold remote adoption. Menu text saves originate
  from edits, not effects that also run when remote data arrives.
- Clean editors follow incoming data. Drink drafts merge unrelated row/field
  changes; conflicting drafts remain visible and require an explicit reload.
  Settings forms retain dirty drafts and block conflicting saves. Menu-course
  drafts retain their existing protection and refresh when abandoned, including
  when the saved menu is empty.
- Inventory queues counts immediately, so closing its window cannot cancel a
  debounce. Failed reads no longer erase other devices' counts; zero counts are
  preserved when recovering local data.
- Admin → System includes **REFRESH ALL DATA**, read-error details, and per-reader
  freshness. The sync indicator accounts for reads and PowerSync transfers,
  rather than treating an open transport alone as proof of freshness.

Device-only preferences remain local. Deliberate point-in-time reports and print
drafts remain snapshots. The existing destructive database-reset action is still
available separately; automatic recovery never invokes it. App updates retain
the existing safe activation policy, avoiding forced reloads during service.

## Verification and rollout

Regression coverage includes overlapping reads, late results, retries, wake and
network recovery, workspace disposal, missed deletions, simultaneous setting
consumers, pending saves, editor conflicts, pagination, menu text without write
echoes, inventory persistence, and reconnects without database clearing. Existing
application-harness tests exercise service operations on both storage paths.

Validation completed: the full suite passed 1,775 tests across 123 files, followed
by three additional inventory regression tests passing in their own file. The
production build passed, including the PWA build. `git diff --check` passed.

These are automated local tests, not verification on the restaurant's tablets.
No deployment or live database changes are included. After deployment, validate
with two devices: edit a menu/settings item on one, check the second while open,
then repeat with the second asleep/offline and verify catch-up after waking.
Also check a dirty editor and a pending inventory count survive recovery.

This addresses refresh and adoption. Existing whole-setting last-writer-wins
storage and multi-request fallback catalogue writes are not converted into
server-side transactions by this change. Actual cross-device latency still
depends on network connectivity and the deployed PowerSync/realtime configuration.

## Follow-up: live-service latency (2026-09-24)

After rollout, a table seated on one device took 10–20 s to reach the kitchen
display (previously 1–2 s). Every tap caused a storm of re-reads and re-renders.

- **Two lanes.** `registerLiveQuery({ lane })` is `"live"` or `"background"`.
  Live readers (board, floor SET status, kitchen ticket order, services,
  reservations) re-read the moment a change lands. Background readers
  (catalogues, menu courses, layouts, logo, config, archives, audit, staff,
  inventory, workspace access) coalesce *passive* notifications (another
  device's write, a sync checkpoint, the 60 s sweep) into one read
  `BACKGROUND_DELAY_MS` (5 s) later. First loads and explicit refreshes
  (reload buttons, wake, REFRESH ALL DATA) are never deferred.
  `useLiveQuery`/`useLiveSetting` default to background; pass `lane: "live"`
  for anything that changes during service.
- **Checkpoints.** Only the first PowerSync checkpoint after a (re)connect
  invalidates every reader; the table watches deliver the rest.
- **No starvation.** A read superseded by a newer notification is discarded at
  most once in a row, then painted.
- **No redundant adoption.** `useLiveQuery` skips applying a result identical to
  the last one it applied, and the app root subscribes only to a two-fact sync
  summary instead of every reader's state.
- **History.** The service-history reader no longer follows `service_tables`.
- **Fallback path.** Board, reservation, floor-status and kitchen-order realtime
  events paint straight from the event payload.
