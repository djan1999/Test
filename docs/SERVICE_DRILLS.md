# Service Drills — PowerSync-primary contract

Manual acceptance drills for the sync architecture. Run all core drills against the
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

## Drill F — Ending a service preserves its entity and board

**Setup:** Two devices in the same live service, with several active tables.
Keep device 2 on the Service board.

1. On device 1 choose Archive & Clear and confirm.
2. Observe device 2 without touching or refreshing it.
3. Confirm the database has exactly one newly ended `services` row and that
   every `service_tables` row still belongs to that ended service id with its
   original content. There is no blank-row clear and no shared `service_date`
   pointer to reset.
4. Start another Demo service, take device 1 offline, add one seat note, then
   Archive & Clear while still offline. Reconnect device 1.

**Pass:**
- Device 1 exits service immediately in both the online and offline cases.
- Online, device 2 exits the ended service automatically in under one second,
  without a refresh or a half-cleared intermediate state.
- Offline, device 2 keeps the old live service until device 1 reconnects; after
  reconnect it receives the archive/board/date transition together.
- Each run produces exactly one ended service entity. The offline seat note is
  present in that entity's retained board rows, and no write remains stuck.

## Drill G — Rejected operation cannot wedge the device

Use a Kitchen account and a preview/staging database. Attempt an Admin-only
mutation (for example archive destruction) while a second device observes.

**Pass:** the server denies the operation, Admin → System records a diagnostic,
the disallowed UI state is corrected by sync, and a later valid kitchen table
update uploads successfully. The upload queue and download stream continue.

## Drill H — Same-row concurrent edits have an explicit loser

Take two devices offline after both have the same populated table. Change the
same seat or whole-row field differently on each, then reconnect them in a
recorded order.

**Pass:** the documented CAS/fold rule chooses one outcome, a refused edit is
visible in diagnostics where applicable, unrelated seats survive, and neither
device wedges. Record which value lost; do not claim conflict-free editing.

## Drill I — Account change with pending work

On a staging tablet, create an offline edit, then attempt to sign out/change
accounts before it uploads.

**Pass:** the operator is warned that the account change clears the local sync
database and can discard pending edits. After confirmation, no previous-user
rows are visible to the new account.

## Drill J — Stale PWA returns after a schema release

Keep one installed tablet offline while deploying a preview client plus a
compatible schema change. Bring it back days later without manually refreshing.

**Pass:** the old build does not corrupt data or wedge; the update waits safely,
Admin → System identifies the old build, and applying the update outside a
service returns the tablet to a healthy complete sync.

## Drill K — Recovery and lost-device procedure

On staging, deliberately create a stuck/error state, capture the diagnostic,
then use Admin → System → Reset Local Sync DB. Separately simulate a lost
tablet by revoking its user session.

**Pass:** the reset clearly warns about local loss, re-downloads only authorized
workspace data, and valid writes resume. The revoked device can no longer sync.

---

# Gate B additions — the untested seven

Drills A–K cover the sync architecture. They do not cover a full room, tired
hands, or hardware that goes to sleep. These seven were added because a
restaurant that isn't us will meet all of them in its first week, and nothing
in this repository has ever seen them.

Every one of these needs the pilot's **actual** hardware. Record every failure
in `FAILURE_LOG.md`, including the ones that look cosmetic — an unrecorded
failure is indistinguishable from a passing drill.

## Drill L — Device reboot mid-service

**Setup:** a service running, this device holding at least one edit made while
briefly offline (put it in airplane mode, make the edit, leave it offline).

1. Hard-power the device off, without closing the app.
2. Power it back on, unlock, reopen the app, and let it reconnect.

**Pass:** the offline edit still uploads after the reboot — the write queue
survives a power cut, not just a reload. The board repaints to the current
service, not to the state at power-off. No duplicate rows appear.

## Drill M — iPad sleep / wake across a service

**Setup:** a service running, two devices, one of them a real iPad on its
normal auto-lock setting.

1. Let device 1 sleep for at least 30 minutes (a genuine lull, not 30 seconds).
2. Make five changes on device 2 while device 1 sleeps, including one on the
   kitchen path (SEND a table).
3. Wake device 1 with a single tap. Do not reload it.

**Pass:** device 1 shows all five changes within seconds of waking, without a
reload. The status chip returns to live by itself. Tap **?** beside the chip
during the first seconds after wake and confirm the readout does not accuse a
healthy device of being stalled once it has caught up.

## Drill N — Kitchen display restart mid-service

**Setup:** a service running with at least four seated tables at different
course progress, and one fired ticket.

1. Fully close the app on the kitchen display (not a reload — kill it).
2. Reopen it and go straight to the kitchen view.

**Pass:** the display returns to the live service with every ticket at its
correct course state, including the fired one. It does not re-alert already
handled tickets, and it does not sit on NO ACTIVE SERVICE while a service is
running.

## Drill O — Twenty-plus reservations, one night

**Setup:** an empty test service on the Demo workspace.

1. Enter 25 reservations across the evening's sittings, several with dietary
   restrictions and several as hotel guests if that feature is on.
2. Seat 15 of them, working the board as a real service would.
3. Switch to kitchen, fire courses across at least eight tables.

**Pass:** every screen stays responsive on the pilot's oldest device — board
taps under a quarter-second, kitchen repaint under a second. Reservation
resolution against the active layout stays correct. Measure and record the
numbers even when it passes; "felt fine" is not a result.

## Drill P — Full restaurant, every table worked

**Setup:** the Demo workspace with the pilot's real table count configured.

1. Seat **every** table, with a mix of party sizes and at least three merges.
2. Give each table drinks, restrictions and notes, then progress courses on all
   of them until the last table has been served.

**Pass:** no table loses content, no merge splits, the kitchen shows every
table, and ending the service archives all of them. This is the drill most
likely to surface a limit nobody has hit — record what breaks first, even if it
is only layout.

## Drill Q — Many kitchen tickets at once

**Setup:** the state at the end of Drill P, kitchen display in tickets view.

1. From the floor, SEND eight tables within one minute.
2. While those alerts are live, change the menu type on two of them and
   un-seat one.

**Pass:** all eight tickets appear with correct seat deltas, the two edits
repaint their tickets, and the un-seated table's ticket disappears rather than
lingering. Nothing scrolls out of reach on the actual kitchen panel — record
how many tickets fit before the ninth becomes invisible.

## Drill R — Accidental double taps

**Setup:** a service running. Assume gloved, wet, or hurried hands throughout.

1. Double-tap SEAT on a free table.
2. Double-tap SEND on a seated table.
3. Double-tap END SERVICE and dismiss nothing.
4. Double-tap a reservation's save button.
5. Repeat 1–2 on a device that is offline.

**Pass:** each action happens exactly once. No duplicate reservation, no
duplicate service, no double-fired ticket, no second archive entry. A
double-tapped destructive action still requires its confirmation. The offline
repeats produce one queued write each, not two.

---

## Fallback drill (PowerSync outage)

Use a preview deployment with `VITE_POWERSYNC_URL` set to an empty string (or
block the PowerSync origin), then log into the ordinary Demo test account.

**Pass:** the board/menu/reservations load via direct Supabase reads (slower
is fine), realtime changes still appear without refreshing, admin edits persist
via direct writes, and nothing blanks or duplicates the Demo workspace rows.
