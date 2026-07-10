# Service Drills — PowerSync-primary contract

Manual acceptance drills for the sync architecture. Run all six core drills against the
Demo workspace before promoting any sync-layer change to production, and again
after enabling it for a restaurant. Each drill states the exact steps and the
observable result that counts as a pass.

Architecture under test: the on-device SQLite database (PowerSync) is the
single read/write path for all synced tables (`service_tables`,
`service_settings`, `reservations`, `menu_courses`, `wines`, `beverages`);
`SupabaseConnector.uploadData()` drains local writes back to Postgres.
If PowerSync is unavailable or deliberately disabled, the app falls back to
direct Supabase reads/writes plus realtime. Service ending is one local
transaction; its upload is collapsed into one Postgres transaction before
other devices receive it.

---

## Drill A — Two-device propagation (board → board, board → kitchen)

**Setup:** Two devices (or two browsers) logged into the same workspace, both
online. Device 1 on the Service board, device 2 first on the Service board,
then on the Kitchen board.

1. On device 1, seat a table (SEAT), set P1 water to Sparkling, add one
   by-the-glass wine to P2, and set the table's pairing for P1 to Wine.
2. Watch device 2's Service board.
3. Switch device 2 to Kitchen mode. On device 1, press SEND on the table.
4. On device 1, edit a reservation's menu type (long → short) for a table
   whose service already started.

**Pass:**
- Every edit from step 1 appears on device 2's board in **under 1 second**
  (PowerSync watch propagation; no manual refresh, no 30 s poll wait).
- The kitchen alert from step 3 appears on device 2's Kitchen board in under
  1 second, with the correct seat delta.
- The menu-type change from step 4 repaints the kitchen board's course list
  for that table without any component interaction.

## Drill B — Airplane-mode edits reconcile on reconnect

**Setup:** One device mid-service, online, board synced. A second device
online, observing.

1. Put device 1 in airplane mode (full offline).
2. On device 1: seat one more table, add drinks to two seats, clear one
   previously-empty table's drinks, and add a note to a third table.
3. Confirm device 1's UI keeps working (all edits render instantly; the sync
   chip leaves "live").
4. Leave it offline for at least 2 minutes, then re-enable the network.

**Pass:**
- On reconnect, every offline edit uploads (watch the `service_tables` rows in
  Supabase or device 2's board) within a few seconds — **no edit is lost, no
  table is blanked**, and no duplicate rows appear.
- Device 2's concurrent edits to *other* tables survive. Edits to different
  seats on the same table are merged. If both devices change the exact same
  seat at the same time, the last committed edit wins.

## Drill C — Fresh device joins mid-service, no blanking

**Setup:** A live service running with 4+ active tables (seats, drinks,
kitchen progress). A device that has **never** logged into this workspace (or
with site data fully cleared).

1. Log the fresh device in, pick the workspace, and enter Service mode via
   the join path.
2. Time the first paint of the live board.

**Pass:**
- The fresh device shows the running service — every active table with its
  seats/drinks/kitchen state — without ever flashing an empty board.
- Joining does **not** clear or overwrite anything: the other devices' boards
  are untouched and no blank rows are written to `service_tables` (check
  `updated_at` stamps stay put for tables the fresh device never edited).
- The board is usable within seconds (priority-1 sync: board, reservations,
  settings sync before wines/archive).

## Drill D — Cold-start instant paint, fully offline

**Setup:** A device that has previously synced this workspace. Kill the app /
tab. Put the device fully offline (airplane mode). PWA installed or tab
restore available.

1. Launch the app while offline.
2. Enter Service mode.

**Pass:**
- The board paints from local SQLite with the last-synced state — tables,
  reservations, menu, wines — with no network round-trip and no empty flash.
- Edits made while offline queue locally and upload on reconnect (spot-check
  one edit after re-enabling the network).

## Drill E — Wine scrape preserves manual rows

**Setup:** Workspace with synced wines present. Admin → wine list.

1. Edit one *synced* wine (fix a producer name). Confirm it saves.
2. Add one brand-new manual wine.
3. Trigger the website wine sync (Admin → SYNC, or wait for the nightly cron).

**Pass:**
- The edited wine keeps the correction after the sync (copy-on-edit flipped it
  to `source: 'manual'`; the scraper never deletes or overwrites manual keys).
- The manually added wine is still present with `source: 'manual'`.
- Both rows carry the correct `workspace_id` and survive on every device after
  the sync's realtime/watch refresh.

## Drill F — Ending service is atomic and live

**Setup:** Two devices in the same live service, with several active tables.
Keep device 2 on the Service board.

1. On device 1 choose Archive & Clear and confirm.
2. Observe device 2 without touching or refreshing it.
3. Confirm the database has one archive row, ten blank `service_tables` rows,
   and an empty `service_date` setting for the workspace.
4. Start another Demo service, take device 1 offline, add one seat note, then
   Archive & Clear while still offline. Reconnect device 1.

**Pass:**
- Device 1 exits service immediately in both the online and offline cases.
- Online, device 2 exits the service automatically and sees the cleared board
  in under one second, without a refresh or a half-cleared intermediate state.
- Offline, device 2 keeps the old live service until device 1 reconnects; after
  reconnect it receives the archive/board/date transition together.
- Each run creates exactly one archive entry. The offline seat note is present
  in that archive, and no table or lifecycle write remains stuck in the queue.

---

## Fallback drill (PowerSync outage)

Use a preview deployment with `VITE_POWERSYNC_URL` set to an empty string (or
block the PowerSync origin), then log into the ordinary Demo test account.

**Pass:** the board/menu/reservations load via direct Supabase reads (slower
is fine), realtime changes still appear without refreshing, admin edits persist
via direct writes, and nothing blanks or duplicates the Demo workspace rows.
