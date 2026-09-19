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
