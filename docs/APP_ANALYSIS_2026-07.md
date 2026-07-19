# Milka Service Board — App Breakdown & Improvement Analysis

*July 19, 2026 · Focus areas requested by the owner: (1) Lunch/Dinner switch, (2) Archive, (3) Restrictions, (4) Floor Map — editor, switching people, connectivity.*

**How this was produced:** seven parallel deep-analysis passes (one per subsystem, ~1.9M tokens of code reading) over the full source, tests, migrations and docs, producing 114 findings. The six unique **critical** findings and several highs were then independently re-verified line-by-line against the code — every one held up. Medium/low findings are single-pass analysis results with cited evidence but no second verification pass; treat their details as very likely but re-check the citation before building a fix on one.

---

## 1. Executive summary

The app is in much better shape than a 5,000-line `App.jsx` suggests. The board write path (per-table CAS + seat-level three-way fold + mass-blank guard), the service-day clock (6 a.m. rollover, deliberate-past-date handling), the atomic end-of-service RPC, and the invariants test suite are genuinely sophisticated and clearly hardened by real incidents (04.07, 10.06, 19.06 are all pinned by tests). The floor-map editor's pure-function core (`utils/floorMaps.js`) is well factored.

The problems cluster into three themes, and they explain all four of your concerns:

1. **The protections are concentrated on `service_tables` only.** Everything else that is shared between devices — floor maps, floor SET strips, `reservations.data` (which carries terrace flow AND restrictions), kitchen order, restaurant config — is a whole-JSON-blob, last-writer-wins write with no merge and no conflict detection. Two devices touching the same blob within a sync window silently erase each other's work. This is the root cause behind most of the floor-map "connectivity" weirdness you're feeling.

2. **Lunch/Dinner is a label, not a lifecycle event.** There is no "end lunch / start dinner" operation. Flipping the session just changes a filter and mints a new service identity — lunch is never archived, seated lunch tables ride into dinner and get archived under `– DINNER`, and un-arrived lunch reservations vanish without a no-show record. Meanwhile the switch UI itself (the date picker) has a real double-write race that can corrupt the shared service identity, and several code paths stamp the *device's local* session default (`"dinner"`) onto shared state and archives.

3. **One confirmed catastrophic hole in the end-of-service path.** An offline device's queued END SERVICE replays on reconnect as an **unguarded** server RPC and wipes whatever service is live at that moment, restaurant-wide, with no archive of the victim service. This is the same wipe class the July 11/12 migrations were built to stop — the guard parameters exist in the RPC but the PowerSync upload path never sends them. This is the single most important fix in this report.

---

## 2. How the app fits together (orientation)

- **State spine:** `App.jsx` (~5,060 lines, ~177 hooks) owns auth gating, mode routing (service / kitchen / reservations / menu / admin), the live 10-slot board, service lifecycle, reservations, floor maps, catalogs, restrictions, archive — and *both* sync transports.
- **Sync:** primary path is PowerSync SQLite (local-first, durable queue, upload via `SupabaseConnector`); fallback is direct Supabase + Realtime with RAM-only retry queues. The active service is one shared settings row `service_settings[id="service_date"]` = `{date, chosenOn, session, startedAt}`; `startedAt` is the service's identity.
- **Floor:** floor maps live in one settings blob (`floor_maps_v1`), floor SET/DIRTY strips in another (`floor_status_v1`); tiles resolve to board slots via label matching + explicit `boardId` claims; terrace occupancy is a `visit_state` machine inside `reservations.data`.
- **Restrictions:** flat `{pos, note, detail}` entries stored on both the reservation and the live table row; kitchen sees seat chips + an UNASSIGNED strip; menu prints substitute per-course variants via a hardcoded priority list.
- **Archive:** one row per service in `service_archive`, id = deterministic UUID from `(workspace, startedAt)`, written by the atomic finish op (local SQLite transaction or `archive_and_finish_service` RPC), soft-delete + explicit purge.

---

## 3. Concern #1 — Lunch/Dinner switch

### How it works today
The session is **manual**, not clock-based: chosen in the ServiceDatePicker (reachable from the date chip in the Service readout and from Reservations), stored in the shared `service_date` blob, adopted read-only by every other device. The clock only decides the service *day* (rolls at 06:00, not midnight) and a fallback that classifies session-less reservations by time (`< 15:00` → lunch) — a heuristic duplicated in four files.

### What's wrong (worst first)

| # | Severity | Finding |
|---|----------|---------|
| S1 | **Critical · verified** | Offline END SERVICE replays unguarded and wipes the successor service (see §7 — this is the cross-cutting #1 issue; the lunch→dinner handover is exactly when it fires: a tablet offline at end of lunch, dinner started elsewhere, tablet reconnects → dinner board wiped restaurant-wide). |
| S2 | **Critical · verified** | Changing the service date mid-service blanks the whole board **with no archive** (`persistServiceDate` sets `intentionalBoardClearRef` and blanks; the mass-blank guard is deliberately bypassed) — and the red "stale date — TAP TO SET TODAY" banner routes users straight into this destructive path, while the auto-end heal proves the correct behavior is re-date-*without*-clear. |
| S3 | **High · verified** | Picker confirm runs two racing writes to `service_date`: `persistServiceSession` fires an *unawaited* read-then-write that usually lands **after** `persistServiceDate`'s write, re-asserting the stale date/`startedAt` with the new session. Devices end up holding an identity the store no longer carries → guarded END SERVICE refused ("already ended on another device"). |
| S4 | **High** | Lunch→dinner is not a lifecycle event: lunch never archived; seated lunch tables archived under `– DINNER`; unseated lunch reservations dropped with no no-show record; every re-confirm mints a fresh `startedAt` even for a no-op re-pick. |
| S5 | **High** | Auto-end / re-date heal stamps the **device's local** session (default `"dinner"`) — an abandoned lunch is archived as DINNER; a heal can flip every device's session filter mid-lunch, hiding the live session's reservations. |
| S6 | **High · verified** | The server end-RPC blanks only `generate_series(1,10)` while restaurant config supports table ids to 999 — tables 11+ survive the end and resurrect as ghosts next service; on the PowerSync path their queued blanks are *discarded* when the transaction collapses into the RPC. |
| S7 | High | A device with a skewed clock / different timezone computes staleness locally but **writes shared state** — a traveling owner opening the app from UTC+9 can re-date or auto-end the restaurant's live dinner. |
| S8 | Medium | Session switch is barely discoverable: the LUNCH/DINNER badge is a non-interactive span; the switch hides inside the date picker whose confirm button says "START DINNER ›" — indistinguishable from starting a new service. |

Also worth noting: after midnight the picker defaults to the wrong service day; concurrent starts on two devices are silent last-write-wins; an offline fallback-path start fails silently and then "starts itself" later.

### Recommended direction
1. **Make lunch→dinner a real, single operation** — "End lunch & start dinner" = archive lunch (guarded, identity-checked) + clear + start dinner with fresh identity, in one flow. This kills S4 and gives the archive honest per-session records — which is also what your archive insights need.
2. **Fix the picker race (S3)** by making the confirm a *single* write of the complete new blob (date + session + chosenOn + startedAt) — delete `persistServiceSession`'s read-modify-write for this path.
3. **Make the stale-date banner run the re-date-forward heal** (no clear), and hard-gate any picker date change over a board with live content behind "N seated tables will be cleared **unarchived**".
4. Replace `generate_series(1,10)` in the RPC with the workspace's configured table ids (or blank `where table_id >= 1`), and promote the session badge to a first-class tappable control with a clear "switching ends lunch" confirmation.

---

## 4. Concern #2 — Archive

### How it works today
One `service_archive` row per service: full board snapshot + the entire menu catalog in a `state` jsonb blob. Dedup identity = deterministic UUID from `(workspaceId, startedAt)` with `on conflict do nothing`, cosmetic `" · n"` label suffix for same-day repeats. Soft delete ("Recently Deleted") with explicit purge. Browsed via ArchiveModal (kitchen) and ArchivePanel (admin); `archiveInsights` computes covers/timing/pairing stats over recent services.

### What's wrong (worst first)

| # | Severity | Finding |
|---|----------|---------|
| A1 | **Critical · verified** | Same offline-end hole as S1 — the archive side effect: the victim service is wiped **with no archive row**, and the stale service double-files. |
| A2 | **High** | Admin ArchivePanel double-counts covers and renders ghost rows for multi-table parties (the reconcile stamps the full party size on every group member; ArchiveModal fixed this via `mergeTableGroups`, ArchivePanel never did) — the exact numbers you'd use to audit a night are inflated. |
| A3 | **High** | Unbounded growth: sync rules ship **every archive blob ever** (including soft-deleted) to every device forever; each blob is ~100KB+; the SQLite read path parses the whole table on every Archive open just to show 60. The modal gets slower every week of operation. |
| A4 | Medium | Insights math: no-shows counted as covers; pairing-uptake uses inconsistent denominators for grouped tables; out-of-menu-order fires poison the timing stats. |
| A5 | Medium | The 6 a.m. auto-end archives via a stale closure — wrong LUNCH/DINNER label and stale menu snapshot (compounds S5). |
| A6 | Medium | The archive filter keeps only tables with seats/kitchen content — a drinks-only table (bar service) is silently absent from the archive. |
| A7 | Medium | Two devices ending with divergent identities file duplicate archives; a kitchen-role device tapping archive-delete wedges its PowerSync upload queue permanently (RLS rejects, connector rethrows forever). |
| A8 | Medium | Two taps destroy all archive history (purge has no friction); trash never expires; load failure is indistinguishable from "no archives yet". |

### Recommended direction
1. Fix the end-of-service guard (§7) — it's the archive's integrity foundation.
2. Port `mergeTableGroups` into ArchivePanel (small fix, big trust win).
3. **Add retention/windowing now, not later:** sync only the last N days of archives to devices (sync-rules bucket filter), keep the rest server-side behind an on-demand query; exclude soft-deleted rows from the bucket; paginate the modal read.
4. Correct the insights denominators and filter (count a table as served if it has *any* service content, reusing `tableHasServiceContent`), and snapshot session/menu at end time rather than closure time.

---

## 5. Concern #3 — Restrictions

This area is the most safety-relevant, and the pattern is consistent: **the label display path is fail-safe, but every *derived* safety output (menu substitutions, ticket mod lines, allergy sheet) fails silent.**

### How it works today
Restrictions are flat `{pos, note, detail?}` entries with a workspace-editable vocabulary (admin RestrictionsPanel) mirrored into a *mutable module array*. They live on both the reservation and the live table row. Kitchen sees seat chips + UNASSIGNED strip + derived "N× MOD" course lines; menu prints substitute at most one variant per course via the hardcoded `RESTRICTION_PRIORITY_KEYS`.

### What's wrong (worst first)

| # | Severity | Finding |
|---|----------|---------|
| R1 | **Critical · verified** | `DEFAULT_DIETARY_KEYS` uses `gluten_free/dairy_free/nut_free/shellfish_free` while the runtime vocabulary uses `gluten/dairy/nut/shellfish` (visible side-by-side in `constants/dietary.js`). On a fresh device, if the menu fetch wins the boot race against the restrictions-cache load, all four allergy course variants map to null, the broken mapping is **written into the local menu cache**, and a celiac guest's printed menu shows the original dish with zero warning. |
| R2 | **Critical · verified** | Kitchen-added allergies are wiped by any reservation edit: `startedTablePatchFromReservation` rebuilds `table.restrictions` purely from the reservation's set (verified in `tableHelpers.js`), so a waiter fixing a typo deletes the kitchen's nut-allergy entry from the live ticket. For terrace tickets (table not "started") the reconcile re-templates on every change — the kitchen's entry can vanish in **seconds** with no user action. |
| R3 | **High** | Only one substitution per course, and the priority list puts vegan/veg **above** gluten/nut/shellfish — a vegan + nut-allergic guest gets the vegan variant with the nut allergy silently unapplied. No multi-restriction intersection; `hazards` (cross-contamination) is mapped from the DB but consumed nowhere; "allergy vs preference" is purely cosmetic grouping. |
| R4 | **High** | Custom restrictions never produce substitutions (`applyCourseRestriction` iterates the hardcoded list, not the live vocabulary) — and deleting + re-adding a *built-in* mints a new slug (`gluten_free`) that matches nothing: from then on gluten guests get zero substitutions while everything looks configured. |
| R5 | **High** | Cross-device concurrent restriction edits lose one side: `table.restrictions` folds as a single field (local wins wholesale), so kitchen adds shellfish while the waiter pins a position → one edit erased. Two surfaces still write whole arrays from render-captured state. |
| R6 | **High** | A restriction can be pinned to a nonexistent seat (chips are generated 1..N but chair-identity seats can be `{1,2,3,5,6}`) — it then matches no seat chip, is excluded from the UNASSIGNED strip *and* from mod counts: the allergy exists in data but is invisible on every kitchen surface. |
| R7 | Medium | No FOH path to record an allergy for a seated walk-in; chips only increment (no toggle-off); custom `detail` text never reaches the live ticket; printed allergy sheet can disagree with the live ticket. |

### Recommended direction
1. **Unify the key space** (R1/R4): one canonical key list, `DEFAULT_DIETARY_KEYS` = `DEFAULT_RESTRICTIONS` keys, column mapping tolerant of both forms, and substitution matching driven by the *live* vocabulary, not a hardcoded list.
2. **Make kitchen entries first-class** (R2): union `kitchenAdded` entries when rebuilding from a reservation, or write them through to the reservation row.
3. **Allergies outrank preferences** (R3): apply substitutions as an intersection (all matching variants considered; allergy keys always win over lifestyle keys), and surface "no safe variant configured" on the ticket instead of silence.
4. Add a real severity flag (allergy vs preference) that flows to the ticket, and validate pin positions against actual seat ids (R6).
5. Longer-term: per-seat restriction merging in `foldTable` (R5) — the board already folds per-seat; restrictions deserve the same.

---

## 6. Concern #4a — Floor Map: editor

### How it works today
Genuinely well-factored: every mutation is a pure, tested function in `utils/floorMaps.js` applied through one seam. Multi-map model (dining maps + terrace + kitchen), tables are tiles with label-based identity plus explicit `boardId` claims; the layout-switch flow plans a diff (`planLayoutSwitch`), shows conflicts, then repoints reservations and moves live board state.

### What's wrong (worst first)

| # | Severity | Finding |
|---|----------|---------|
| E1 | **Critical · verified** | The entire multi-map model is **one settings blob written whole on every gesture**, unconditional upsert, offline replay with no staleness bound (`dropPendingStateKey` is called for floor *status* on service end but never for floor *maps*). Two admins editing different maps erase each other's entire work; a stale iPad reconnecting hours later overwrites a redesign with its old blob. No undo, no draft/publish, no history. |
| E2 | **High** | Layout switch is non-atomic across three persistence domains (board rows → reservations → activation flag written last by a *different component*). A failure or offline gap between steps strands reservations pointing at a layout no device is showing; every switch has a visible inconsistent window on other devices. |
| E3 | **High** | A confirmed switch **silently skips blocked moves** (`console.warn`, still returns `ok:true`) — the operator approved a diff that partially applied; the skipped party lands on the wrong tile or in NOT ON THIS MAP with no explanation. |
| E4 | **High** | Deleting the active dining map bypasses the entire guarded switch flow — `deleteMap` just repoints `activeDiningMapId`; seated parties re-resolve instantly with no diff, no conflict check, no board-state move. |
| E5 | **High** | `renameTable` checks label uniqueness against table labels but not merge *members* — renaming a table to "T2" next to a "T2-3" merge silently shadows it; every slot-2 reservation then resolves to the wrong table. Nothing prevents two tiles claiming the same `boardId`. |
| E6 | **High** | Layout-switch planning only sees the **active session of the current day** — switching layout during lunch neither moves nor conflict-checks tonight's dinner bookings (direct intersection with your Lunch/Dinner concern). |
| E7 | Medium | Editor UX: no collision/overlap detection, `+ TABLE` stamps every new table at the same spot, magnet snap invisible until finger lift, walls immutable after placement, geometry edits during a test service silently discarded. |

### Recommended direction
1. **Split the blob** (E1): one row per map (`floor_map:<id>`), plus a tiny pointer row for `activeDiningMapId` — this alone makes two-admin editing safe-ish and shrinks every write. Add an `updated_at` CAS like the board rows. At minimum: bound offline replay age for the maps key and drop it on adoption conflicts.
2. **Make layout switch one transaction-shaped operation** (E2/E3): recompute the plan at confirm time, apply board+reservations+activation through a single store call, and *report* blocked moves in the dialog instead of `console.warn`.
3. Route active-map deletion through the same guarded switch flow (E4); make `renameTable` member-aware and validate `boardId` claims cross-table (E5); feed the planner both sessions + near-future dates (E6).
4. Then invest in editor ergonomics (E7): undo stack over the pure-op layer (it's already pure — an op log is cheap), overlap warnings, spawn-position offsets.

---

## 7. Concern #4b/4c — Floor Map: switching people & connectivity

### How it works today
Moves/swaps are modeled as blank+copy of two independent board rows (`moveTableRows`/`swapTableRows`) plus a reservation repoint, reconciled across devices by a three-way seat-level fold + server CAS. Terrace flow is a `visit_state` machine inside `reservations.data`. Floor SET strips are one shared blob. The single-table move path is well-hardened by the invariants suite — the gaps are groups, concurrency, and everything that *isn't* a board row.

### What's wrong (worst first)

| # | Severity | Finding |
|---|----------|---------|
| F1 | **Critical · verified** | **Moving/swapping a combined (tableGroup) booking makes the party vanish** from board, kitchen tickets and floor. Verified: `moveTableRows` remaps the group only on the two touched rows; the other members keep the stale group, so *no* row satisfies the primary filter `id === Math.min(...tableGroup)` (DisplayBoard.jsx:776) — the card, the kitchen ticket, and the tile resolution all drop. Mid-service this deletes a live kitchen ticket while food is cooking. The invariants suite deliberately restricts move ops to single-table bookings, so it can't catch it. Direction-dependent (moving to a lower id accidentally works), which makes it feel random. |
| F2 | **Critical** | Move-vs-edit interleave: because a move is two independent row writes, a concurrent order/fire on the source table is either **silently erased by the CAS fold** (double-cook risk: a lost fire mark reads as unfired) or stranded as an invisible **ghost table** — content but no identity, renders nowhere, CLEAR gated off, reconcile refuses to touch it (the safety rails then protect the corpse). Mechanism consistent with the fold semantics; full scenario not independently re-executed. |
| F3 | **High** | Move/swap is non-atomic across the two board rows + reservation repoint, and the failure rollback restores click-time snapshots — reverting any edit (e.g. an adopted kitchen fire) that landed during the await window. |
| F4 | **High · verified (mechanism)** | Floor SET strips and `reservations.data` are whole-blob LWW across devices: two waiters tapping SET within a sync window lose one strip on every device including the kitchen; a terrace move-in racing a planner edit reverts the party to terrace state. No fold exists for reservations — `foldTable` is board-only. |
| F5 | Medium | Chair-identity residue: SwapPicker still assumes seat ids 1..n (broken by the chair-identity model the last commit introduced); concurrent dining drags can duplicate-then-drop a guest; move/swap doesn't carry tile-scoped state (SET strip stays on the old tile, chair placements silently lost). |
| F6 | Medium | Terrace flow: `arriving` is one-way with no undo; CHANGE TABLE leaves a phantom SET on the old tile; session flip hides live terrace parties (tiles read free while lunch guests still sit there); two offline devices can seat different parties on the same table (occupancy check is local-only). |

### Connectivity stack (the "whole connectivity" concern)

| # | Severity | Finding |
|---|----------|---------|
| C1 | **Critical · verified** | The offline END SERVICE hole (S1/A1). The fix is small and known: the RPC already accepts `p_expected_started_at`/`p_expected_date`; PowerSync tracks `previousValues` (`trackPrevious` is on) — `finishServicePayload` just needs to derive and pass them, and treat `{superseded:true}` as complete-without-apply. |
| C2 | **High** | Fallback-path durability: all retry queues are RAM-only and the live board has no local cache outside demo mode — a reload during an outage silently loses every edit since the drop. The fallback exists precisely for degraded situations where this is likely. |
| C3 | **High** | One permanently-failing op (RLS-rejected write, bad date string) on a NEVER_DROP table **wedges the device's entire upload queue forever** — device keeps accepting input, nothing uploads, only signal is a field in Admin→System. The designed recovery (`clearLocalAndResync`) has no UI. |
| C4 | Medium | Watch readers aren't serialized (stale board state can apply last); retained writes can cross workspaces on account switch; PUT ops upload with null ancestor (full overwrite of concurrent server row); fallback realtime DELETE events for catalogs never arrive; multiple spots compare other devices' wall clocks against local `Date.now()`. |

### Recommended direction (floor live + connectivity, in order)
1. **Ship the C1 guard fix immediately** — smallest change, biggest risk retired.
2. **Group-aware move/swap** (F1): either block CHANGE TABLE for grouped tables with a clear message (one-line guard, ships today), then reuse `applyLayoutSwitchToTables` — which already implements the correct whole-group mapping — for real group moves. Add a multi-member-group op to the invariants suite with a "every reservation renders exactly one primary card" assertion.
3. **Model moves as operations, not two states** (F2/F3): stamp source-blank + destination-copy with a shared `moveId` so the fold can rebase concurrent source edits onto the destination instead of erasing them; minimum viable version: detect the ghost shape (content, no identity) and surface a "GHOST — recover/clear" card instead of hiding it.
4. **Extend merge protection beyond the board** (F4/E1): per-key folds or CAS for `floor_status_v1`, `floor_maps_v1`, and (at least field-level merge for) `reservations.data`. The board rows got CAS precisely because of this bug class — the same class is now live in four other keys.
5. **Fallback durability** (C2): persist retry queues + board cache to localStorage keyed by workspace; **queue health** (C3): skip-and-park poison ops for NEVER_DROP tables into a visible "unsynced changes" tray, and wire `clearLocalAndResync` into Admin→System.

---

## 8. Architecture — what makes all of this hard to fix

- `App.jsx`: ~5,060 lines, ~177 hooks (51 useState / 36 useEffect / 48 useRef), ~23 mutable refs acting as cross-effect protocols, three drifting copies of the settings-adoption dispatch table, and every domain handler branching on storage mode inline. The SYNC_UPGRADE_PLAN's step A1 ("pull sync out of App.jsx") was never executed; PowerSync was added *alongside* the fallback rather than behind one seam.
- Notable latent defects found here: `menuCoursesDirtyRef` never clears on leaving Admin (one keystroke in the course editor and the device stops adopting menu updates for the whole session — another device 86'es a dish and this device keeps selling it); moving/swapping a seated party from the **Reservations screen** strands live table state (the carry-over is gated on service/display mode — same defect class as the 04.07 incident); role enforcement weaknesses ("client-side only" per one analyst vs. RLS-backed per docs — worth an explicit audit pass).

**Incremental decomposition path** (no rewrite; each step behind the existing harness tests):
1. Extract the **service lifecycle** (date/session/startedAt/auto-end/adoption) into a store module — it's the most self-contained and the most incident-prone cluster, and it unblocks the lunch/dinner rework.
2. Extract **sync adoption** (the three duplicated dispatch tables) into one settings-adoption module.
3. Extract the **floor map state** (maps blob split from §6 naturally produces a `floorMapStore`).
4. Only then consider view-level splits (service/kitchen/admin scenes) — they're mechanical after state moves out.

---

## 9. Prioritized action plan

**P0 — data-loss class (do first, small diffs):**
1. Pass the identity guard through `finishServicePayload` (C1/S1/A1) + connector test for "finish uploaded after service moved on".
2. Block (then properly support) group moves/swaps (F1).
3. Stale-date banner → re-date heal, not destructive date change; hard-warn on mid-service date changes (S2).
4. Single-write picker confirm (S3).
5. RPC blanks configured ids, not 1..10 (S6).

**P1 — safety & trust:**
6. Restrictions key unification + kitchen-entry preservation + allergy-over-preference substitution (R1–R4).
7. Ghost-table detection card (F2 minimum fix).
8. ArchivePanel `mergeTableGroups` + insights corrections (A2/A4).
9. Poison-op parking + resync UI (C3).

**P2 — structural:**
10. Lunch→dinner as a real lifecycle operation (S4) — after P0 items land.
11. Floor maps blob split + CAS; folds for floor status & reservations (E1/F4).
12. Archive retention/sync windowing (A3).
13. Fallback queue persistence (C2).
14. Service-lifecycle extraction from App.jsx (§8 step 1).

**P3 — polish:** editor undo/collision UX (E7), session badge as first-class control (S8), terrace flow undo (F6), archive purge friction (A8).

---
## Appendix — Complete findings register

All 114 findings from the deep analysis, per subsystem, ranked by severity. Evidence columns cite `file:line`.


### service-switch (16 findings)


**SERVICE-SWITCH-1 · CRITICAL · data-integrity** — Offline END SERVICE uploads an UNGUARDED finish — a stale device wipes the next service for the whole restaurant


finishServiceLocally checks the expected service identity only against the LOCAL SQLite DB at commit time (writes.js:244-258). When the device is offline that local DB is stale by definition. On reconnect the connector recognizes the queued finish transaction and collapses it into archive_and_finish_service — but finishServicePayload never includes p_expected_started_at/p_expected_date (SupabaseConnector.js:192-198, 316-321), so the RPC runs with guarded=false and clears service_date + blanks board rows UNCONDITIONALLY (migration 20260712000000 lines 34, 47-73, 86-90). Failure scenario: waiter iPad B drops offline during dinner D1; staff end D1 and start D2 on iPad A; B (still showing D1) taps END SERVICE — its local guard passes because its local DB still holds D1 — then B reconnects: the upload archives D1 AND wipes D2's live board and lifecycle for every device, with no archive of D2. This is exactly the wipe class the 11.07 migrations were built to stop; the writes.js comment (writes.js:237-239) claims 'the server-side guard is the backstop' but the backstop is never engaged on this path. The harness only tests the stale-END-refused scenario on the fallback path (appHarness.test.jsx:566-571), not the sqlite-primary offline replay.


*Evidence:* `src/powersync/SupabaseConnector.js:163-199,316-321; src/powersync/writes.js:237-258; supabase/migrations/20260712000000_identityless_end_guard.sql:34,47-73,86-90`


*Suggested fix:* Carry the expected identity through the local finish transaction (e.g. persist expected {startedAt,date} in a sidecar row or encode it in the blanked service_date op's previousValues) and pass p_expected_started_at/p_expected_date in finishServicePayload; treat a superseded response as complete-without-apply and surface it on the device.


**SERVICE-SWITCH-2 · CRITICAL · data-integrity** — Changing the service date mid-service destroys the live board with no archive — and the past-date warning banner invites exactly that tap


persistServiceDate on a genuine day A→day B switch flags an intentional clear and blanks the whole board (App.jsx:2469-2472); the blanks then persist through the autosave (mass-blank guard deliberately bypassed via intentionalBoardClearRef, App.jsx:2998-3009) and propagate to every device. Nothing archives service A first — the only archiving paths are archiveAndClearAll and autoEndStaleService. Failure scenario: a live service is running under yesterday's date (the mislabel the red banner exists for); the banner says 'TAP TO SET TODAY' (App.jsx:4313-4314); the waiter taps it, picks today, confirms 'START DINNER ›' — the entire live board (seats, drinks, kitchen log) is blanked store-wide, unarchived and unrecoverable. The auto-end heal path proves the correct recovery is re-date-WITHOUT-clear (App.jsx:2223-2251), but the banner routes users to the destructive path instead.


*Evidence:* `src/App.jsx:2463-2472,2998-3009,4299-4317; src/components/reservations/ServiceDatePicker.jsx:195-205; contrast src/App.jsx:2223-2251`


*Suggested fix:* Make the banner tap run the same re-date-forward heal (no clear), and make a picker-driven date change over a board with service content either archive first or hard-warn ('N seated tables will be cleared unarchived').


**SERVICE-SWITCH-3 · HIGH · race-condition** — Picker confirm mid-service runs two racing writes to service_date — the shared identity/date can silently revert


onConfirm calls persistServiceSession(session) then awaits persistServiceDate(date) (App.jsx:4411-4413; same pattern in ReservationManager.jsx:637-643). persistServiceSession fires an unawaited read-then-write: it reads the live blob, then writes {...base, session} (App.jsx:2574-2582). persistServiceDate synchronously enqueues the full new blob {date, chosenOn, session, startedAt:NEW} (App.jsx:2440-2444). The stateStore queue is latest-value-wins per key (stateStore.js:102-112), and the IIFE's write is enqueued LAST (after its read resolves) — so whenever the read returned the PRE-change blob, the final store state is {...OLD date/chosenOn/startedAt, session:new}, silently reverting the date change (or just the fresh startedAt) while the local device keeps the new values. Consequences: on a date change, the switching device is yanked back to the old date by its own echo via adoptServiceLifecycle ('changed the date and it snapped back'); on a same-date session flip, the store keeps the OLD startedAt while the device holds the NEW one, so this device's next END SERVICE is refused with the false alert 'This service was already ended on another device' (App.jsx:1975-1977, 1995). First start is safe only because persistServiceSession returns early when no date is live (App.jsx:2566-2567).


*Evidence:* `src/App.jsx:4411-4413,2556-2583,2431-2451; src/components/reservations/ReservationManager.jsx:637-643; src/lib/stateStore.js:102-112`


*Suggested fix:* Make persistServiceDate accept the session and do ONE write; drop the separate persistServiceSession call from both confirm handlers (keep it only for a genuine session-only toggle, serialized after any pending date write).


**SERVICE-SWITCH-4 · HIGH · architecture** — Lunch→dinner is not a lifecycle event: lunch is never archived, open lunch tables get filed under DINNER, unseated lunch reservations vanish


There is no end-lunch/start-dinner operation. Confirming the picker on the same date only flips the shared session filter and mints a new startedAt (App.jsx:2431-2451) — no archive, no clear. Effects mid-switch: (a) the lunch service gets NO archive entry unless staff separately ran END SERVICE first; (b) still-seated lunch tables are sacrosanct to the reconcile (reconcile.js:53) so they ride into dinner and are eventually archived under the '… – DINNER' label with serviceSession:'dinner' (App.jsx:2004,2016,2020) — lunch covers are misfiled in the archive/insights; (c) not-yet-arrived lunch reservations are dropped from the board as reservation ghosts (reconcile.js:64-71) with no record of no-shows; (d) each re-confirm mints a fresh startedAt even for a no-op re-pick, so any device that is briefly offline during the switch keeps the old stamp and gets one false 'already ended on another device' refusal at end time (App.jsx:2437-2439,1975-1977). Menus are unaffected (menu_courses are session-agnostic). The intended correct flow — END SERVICE (archive lunch), then re-enter and start dinner — is nowhere signposted; the picker's 'START DINNER ›' button looks like the switch.


*Evidence:* `src/App.jsx:2431-2474,2004,2016-2020; src/utils/reconcile.js:52-71; src/components/reservations/ServiceDatePicker.jsx:195-205`


*Suggested fix:* Add a first-class 'End lunch & start dinner' action that archives the lunch service (with its label) and starts a fresh dinner instance; when the picker is confirmed over a live service with a different session, offer archive-first instead of silent relabeling.


**SERVICE-SWITCH-5 · HIGH · race-condition** — A device with a future-skewed clock or different timezone can auto-end or re-date the live service for every device


currentServiceDay is computed from the DEVICE's local clock/timezone (serviceDay.js:9-19) but its verdicts WRITE shared state. The boot path runs autoEndStaleService for any device opening the workspace, in any mode (App.jsx:3981-3999). Failure scenarios: the owner opens the app from a timezone ahead (e.g. UTC+9 vs the restaurant) during dinner — their currentServiceDay is tomorrow, so the live service date reads stale; if the board was touched recently their device 're-dates it forward' to TOMORROW's date and every tablet adopts it (App.jsx:2223-2248 + adoption 2515-2532), making tonight's reservations (keyed r.date === serviceDate, App.jsx:2840-2845) vanish from every board and the archive file under the wrong day; if the board has been quiet ~30+ minutes, isLiveServiceActivity is false on that device and it ARCHIVES AND CLEARS the live dinner mid-service for the whole restaurant (App.jsx:2253-2308) — the 04.07 incident class reopened through clock skew. A tablet with a mis-set clock does the same without anyone traveling.


*Evidence:* `src/utils/serviceDay.js:9-23,73-76; src/App.jsx:3981-3999,2197-2313,2515-2532`


*Suggested fix:* Anchor staleness decisions to server time (PowerSync/Supabase clock) or require the auto-end/heal writer to confirm against server-stamped updated_at; at minimum gate boot-time auto-end behind the same in-service-mode condition as the interval tick.


**SERVICE-SWITCH-6 · HIGH · bug** — Auto-end and re-date heal stamp the DEVICE's local session, mislabeling archives and flipping every device's live session filter


The boot stale-date path calls autoEndStaleService BEFORE adopting the persisted session (session adoption only happens in the non-stale branch, App.jsx:3986,3997-3999 vs 4017-4019), and autoEndStaleService reads activeServiceSession / activeServiceSessionRef — the device's local default 'dinner' (App.jsx:2260,2268,2272 for the archive label/state; 2244-2248 for the heal write). Failure scenarios: (a) an abandoned LUNCH service is auto-ended next morning by a kitchen tablet whose local session default is dinner → archived as 'DD. MM. YYYY – DINNER' with serviceSession:'dinner' — permanently misfiled (owner concern #2/#1); (b) a live LUNCH running under a rolled-over date is 're-dated forward' by a freshly-booted device that hasn't adopted the lunch session → the heal writes session:'dinner' into the shared blob, all devices adopt it (App.jsx:2498-2501), and the live lunch's reservations vanish from every board mid-service.


*Evidence:* `src/App.jsx:3981-3999 vs 4017-4019; src/App.jsx:2244-2248,2260,2268,2272; adoption src/App.jsx:2498-2501`


*Suggested fix:* Pass the persisted state's own session (state.session) into autoEndStaleService and the heal write; only fall back to the device default when the stored blob has none.


**SERVICE-SWITCH-7 · HIGH · data-integrity** — Server RPC blanks only tables 1..10 — configured tables above id 10 survive the end and resurrect as ghosts


archive_and_finish_service blanks generate_series(1,10) (migrations 20260711090000:89-93 and 20260712000000:86-90), but restaurant config supports up to 60 tables with ids 1..999 (restaurantConfig.js:4-6) and the client carefully computes the configured id set (App.jsx:1913-1916; makeBlankServiceRows honors it, serviceLifecycleStore.js:3-12). On the fallback end, rows for ids >10 are never blanked server-side; on the sqlite-primary end, the connector collapse recognizes blank ops for ids up to 999 (SupabaseConnector.js:182-183) but then calls the RPC — which blanks only 1..10 — and completes the transaction, permanently discarding the queued blanks for the higher ids. Failure scenario: any workspace configured beyond ids 1..10 (the whole point of the restaurant-config feature) ends a service; tables 11+ keep last night's data in Postgres, sync back down, and greet the next service as ghost tables on every device. Latent for Milka's default 1..10 set but armed the day the floor grows.


*Evidence:* `supabase/migrations/20260712000000_identityless_end_guard.sql:86-90; src/config/restaurantConfig.js:4-6; src/powersync/SupabaseConnector.js:177-199,316-321; src/lib/serviceLifecycleStore.js:39-49 (RPC path ignores tableIds)`


*Suggested fix:* Add a p_table_ids int[] parameter to archive_and_finish_service (defaulting to the workspace's existing service_tables rows, not 1..10) and pass the configured set from both finishServiceStore and finishServicePayload.


**SERVICE-SWITCH-8 · MEDIUM · race-condition** — Lifecycle ordering guard mixes client clocks — a skewed device permanently drops start/end events


adoptServiceLifecycle rejects any event whose row updated_at is <= the last seen (App.jsx:2490-2493), but the timestamps come from heterogeneous clocks: fallback writes stamp updated_at with the writer's client clock (stateStore.js:41), the RPC stamps clock_timestamp() (server), and four call sites advance the guard with the ADOPTING device's own 'now' (App.jsx:2030, 2172, 2299, 4212). Failure scenario: a kitchen display on the fallback path resubscribes after a Wi-Fi blip and stamps its ref with local now; its clock is 90s fast; FOH starts the service 30s later — the realtime event's updated_at is older than the ref, so the kitchen silently drops it and idles on 'NO ACTIVE SERVICE' until the next socket bounce. The same skew makes one tablet ignore another's end-of-service.


*Evidence:* `src/App.jsx:2486-2493,2030,2172,2299,4206-4213; src/lib/stateStore.js:41`


*Suggested fix:* Never advance the guard with a locally-minted timestamp — pass the row's real updated_at on the resubscribe/read paths; or replace the timestamp guard with a monotonic version counter written inside the blob.


**SERVICE-SWITCH-9 · MEDIUM · bug** — After midnight the picker defaults to and highlights the WRONG service day


The service-day clock deliberately rolls at 06:00 (serviceDay.js:13-19), but ServiceDatePicker computes todayStr from the calendar date (ServiceDatePicker.jsx:8-13) and App passes defaultDate={toLocalDateISO()} (App.jsx:4408). A service started between 00:00 and 06:00 (delayed dinner, NYE, or the picker reopened after a crash mid-service) defaults to the NEXT calendar day, marked green as 'today', while chosenOn is stamped with currentServiceDay() = the previous day (App.jsx:2436) — so the started service is instantly a 'future-dated' one: tonight's reservations (dated yesterday) never template, and the auto-end for it fires only a full day late. No banner warns about future dates (the warning only covers past dates, App.jsx:4299).


*Evidence:* `src/components/reservations/ServiceDatePicker.jsx:8-13,97,116; src/App.jsx:4408,2436,4299`


*Suggested fix:* Default and highlight currentServiceDay() in the picker, and show a confirmation when the chosen date differs from the current service day in either direction.


**SERVICE-SWITCH-10 · MEDIUM · ux** — No guard or warning for a future-dated service — a mis-tap files tonight under tomorrow and every device silently joins it


isStaleServiceDate only flags PAST dates (serviceDay.js:22-23), so resolveServiceEntry happily JOINs a future-dated service (serviceDay.js:89-91) and the loud red warning banner renders only for past dates (App.jsx:4299-4317). The picker's 7-day grid puts tomorrow one tap from today with only a subtle highlight difference (ServiceDatePicker.jsx:93-132). Failure scenario: hostess fat-fingers tomorrow at 17:55, taps START DINNER; the board shows zero reservations (all dated today), staff seat walk-in-style all night, the archive files under tomorrow's date, and every other device silently joins the wrong-dated service with no visual cue anywhere — the exact 10.06 incident class, mirrored into the future where the safety net has no coverage.


*Evidence:* `src/utils/serviceDay.js:22-23,89-91; src/App.jsx:4299-4317; src/components/reservations/ServiceDatePicker.jsx:93-132`


*Suggested fix:* Extend the warning banner (and resolveServiceEntry join messaging) to future dates, and require an explicit confirm when starting a service on any date != currentServiceDay().


**SERVICE-SWITCH-11 · MEDIUM · bug** — Offline service start on the fallback path fails silently, then starts itself later


persistServiceDate returns early without setting any local state when saveStateKey reports failure (App.jsx:2440-2445), but the picker's onConfirm ignores the result: it closes the picker and enters service mode anyway (App.jsx:4413-4419, bypassing changeMode's serviceDate check by calling setMode directly). Meanwhile the stateStore RETAINS the failed value and retries on backoff/'online' (stateStore.js:88-99,116-124). Failure scenario on a PowerSync-outage day (direct-Supabase fallback): Wi-Fi blips at 18:00, waiter taps START DINNER — no error appears, the app lands in Service mode with NO service date (no reservations templated, no ADD RES button, END SERVICE archives under a fallback date), and minutes later when connectivity returns the retained write silently starts the service server-side and the device snaps into it via realtime. ReservationManager's onSetServiceDate ignores the result the same way (ReservationManager.jsx:642).


*Evidence:* `src/App.jsx:2440-2445,4411-4423; src/lib/stateStore.js:88-99,116-124; src/components/reservations/ReservationManager.jsx:642`


*Suggested fix:* Check persistServiceDate's result in both confirm handlers: keep the picker open with an inline 'couldn't reach the server — retrying' state, and don't enter service mode until the start lands (or clearly mark the pending state).


**SERVICE-SWITCH-12 · MEDIUM · bug** — Boot-time auto-end of an abandoned night is refused once and never retried until the next reload


At boot, a stale persisted service triggers autoEndStaleService BEFORE the device adopts the store's startedAt (App.jsx:3997-3999 runs before 4009-4013 can apply). The guarded pre-check compares the device's localStorage stamp (possibly from an older service, App.jsx:670-672) against the store's; a mismatch returns superseded and the auto-end aborts, merely adopting the correct stamp (App.jsx:2285-2291,1975-1977). Nothing retries: the interval tick is gated on serviceDate + service/display mode (App.jsx:4069-4077) and local serviceDate was already dropped as stale at init (App.jsx:630-640). Failure scenario: the only device that started last night's service is dead/reset; the kitchen tablet boots next morning with a mismatched stamp — the refused auto-end leaves the whole night unarchived and the stale lifecycle blob live until someone reloads the app (second boot succeeds because the stamp was adopted) or starts a new service over it, in which case the night is never archived at all (persistServiceDate overwrites the blob with no archive).


*Evidence:* `src/App.jsx:3981-3999,4009-4013,2285-2291,1968-1980,4069-4081,630-640,670-672`


*Suggested fix:* In the boot stale branch, adopt state.startedAt into serviceStartedAtRef before calling autoEndStaleService (the store blob is right there), and/or retry the auto-end once after a superseded adoption.


**SERVICE-SWITCH-13 · MEDIUM · race-condition** — Concurrent service starts/switches on two devices are last-write-wins with no conflict surfacing


service_date writes are plain upserts (stateStore.js:35-44; writes.js:82-88) with none of the CAS protection board rows get (serviceTableCas.js:14-53). Two devices starting different services near-simultaneously (e.g. hostess starts LUNCH on the tablet while the manager starts DINNER from ReservationManager, or two offline sqlite-primary devices start different sessions and reconnect) resolve by upload order: the loser's start is silently replaced, its board templating for the losing session may already have autosaved, and the losing device only converges after the echo. No device is told a collision happened. Bounded by adoption (both eventually agree) but mid-window each device runs reconcile+autosave against a different session filter, producing transient wrong-session board writes that the other side then has to fold away.


*Evidence:* `src/lib/stateStore.js:35-44; src/powersync/writes.js:82-88; contrast src/lib/serviceTableCas.js:14-53; adoption src/App.jsx:2486-2550`


*Suggested fix:* Version the lifecycle blob (expected-updated_at CAS like save_service_table_if_current) and surface a 'another device just started SESSION X' prompt to the loser instead of silent replacement.


**SERVICE-SWITCH-14 · MEDIUM · ux** — Session switch is barely discoverable and overloaded: the session badge isn't tappable and 'START DINNER ›' means three different things


Mid-service, the only route to the lunch/dinner switch is tapping the tiny 9px DATE text in the readout strip (its affordance is a desktop-only title tooltip, App.jsx:4744-4746) — the session badge next to it is a non-interactive span (App.jsx:4756-4760). The picker's single confirm button reads 'START {SESSION} ›' (ServiceDatePicker.jsx:196-205) whether the action will (a) start a brand-new service, (b) silently relabel the live service's session/identity in place (same date), or (c) blank the entire live board unarchived (different date). A busy waiter cannot tell which of the three they are about to trigger, and the destructive case looks identical to the harmless one. The kitchen (display) mode has no switch surface at all — correct, but it means FOH must know the one tappable label.


*Evidence:* `src/App.jsx:4743-4760; src/components/reservations/ServiceDatePicker.jsx:195-206; src/App.jsx:2463-2472`


*Suggested fix:* Make the session badge tappable, rename the confirm per consequence ('SWITCH TO DINNER', 'CHANGE DATE — CLEARS BOARD'), and show what will happen to the current board inside the picker when a service is live.


**SERVICE-SWITCH-15 · LOW · architecture** — resolveReservationSession fallback heuristic duplicated in four places


The session classifier (explicit service_session, else resTime < '15:00' → lunch) is implemented independently in tableHelpers.resolveReservationSession (the tested one), inline in App's nextReservationForTable, in ReservationManager (twice), and in ServiceBreakdown. A future change to the cutoff or the session values will drift: a reservation could count as lunch for the board reconcile but dinner for the weekly print or breakdown, silently splitting one booking across sessions in different surfaces.


*Evidence:* `src/utils/tableHelpers.js:164-168; src/App.jsx:1346-1349; src/components/reservations/ReservationManager.jsx:49-54,109-114; src/components/ServiceBreakdown.jsx:119-122`


*Suggested fix:* Import the single tableHelpers implementation everywhere; the copies are byte-for-byte the same logic today, so the change is mechanical.


**SERVICE-SWITCH-16 · LOW · architecture** — INVARIANTS/drills encode the fixed ten-table assumption the code has outgrown


Invariant L3 promises 'all ten board clears' and drill F verifies 'ten blank service_tables rows' (docs), while makeBlankServiceRows defaults to 1..10 when no config is available (serviceLifecycleStore.js:4-6) and the RPC hardcodes 1..10. The documentation will pass its own checklist while the >10-table bug above ships; the drill as written cannot catch it.


*Evidence:* `docs/INVARIANTS.md:55; docs/SERVICE_DRILLS.md:117; src/lib/serviceLifecycleStore.js:3-12`


*Suggested fix:* Reword L3/drill F to 'every configured table row' and add a harness case with a configured id > 10 ending a service in both storage modes.


### archive (18 findings)


**ARCHIVE-1 · CRITICAL · race-condition** — Offline-queued end-service replays as an UNGUARDED server RPC and wipes a newer live service


On a sqlite-primary device, ending a service passes the identity check against the LOCAL DB only (writes.js:244-258). The resulting CRUD batch is later recognized by the connector and collapsed into the `archive_and_finish_service` RPC — but `finishServicePayload` builds the payload WITHOUT `p_expected_started_at` / `p_expected_date`, so server-side `guarded = false` and the RPC unconditionally clears `service_date` and blanks every `service_tables` row. Failure scenario: kitchen iPad in a Wi-Fi dead spot taps END SERVICE at the end of lunch (local check passes — it never saw anything newer); meanwhile the other iPad also ends lunch and later STARTS dinner; when the kitchen iPad reconnects mid-dinner, its queued finish uploads, calls the unguarded RPC, and blanks the live dinner board for every device in the restaurant. This is exactly the wipe class the 11.07 identity guard was built for, resurrected through the upload queue; the comment at writes.js:237-239 claims 'the CAS upload path bounds the local one', but the collapsed-finish path bypasses CAS entirely.


*Evidence:* `src/powersync/SupabaseConnector.js:163-199 (payload built without expected params), :316-322 (RPC call); src/powersync/writes.js:240-259 (guard is local-only); schema.sql:1005-1032 (guarded only when p_expected_* non-null, else unconditional clear)`


*Suggested fix:* Persist the `expected` identity inside the local finish transaction (e.g. stash startedAt/date in the blanked service_date setting op or a dedicated marker row) and have finishServicePayload forward it as p_expected_started_at/p_expected_date; a superseded result should drop the board-blank ops but still insert the archive.


**ARCHIVE-2 · HIGH · bug** — Admin ArchivePanel double-counts covers and shows ghost rows for multi-table parties


ArchivePanel sums `t.guests` over the RAW archived table list and renders one TableSummaryCard per raw table. The reconcile stamps the FULL reservation guest count on EVERY member of a table group (documented at archiveInsights.js:13-18 and tableHelpers.js:319-324), so a 6-top on T02+T03 reads as 12 guests and renders two cards (the secondary full of blank placeholder seats). ArchiveModal fixed this with mergeTableGroups (ArchiveModal.jsx:231-233); the admin panel never did. The owner auditing a night in Admin sees inflated guest totals and phantom tables — precisely the numbers she'd use to sanity-check the service switch and archive.


*Evidence:* `src/components/admin/ArchivePanel.jsx:112 (raw sum), :118, :131-133 (raw per-table render), :162 (trash count); contrast src/components/modals/ArchiveModal.jsx:231-237`


*Suggested fix:* Run entry tables through mergeTableGroups(entry.state.tables, celebrationKeysFromCourses(entry.state.menuCourses)) exactly as ArchiveModal does, and sum `_groupGuests`.


**ARCHIVE-3 · HIGH · performance** — Archive grows without bound and every historical blob syncs to every device forever


The sync rule ships ALL service_archive rows — including soft-deleted ones — to every device with no date cutoff, and nothing ever prunes the table (no TTL, no auto-purge of 'Recently Deleted', no server-side retention). Each `state` blob is a full board snapshot (all seats, drinks, kitchen logs, plus the entire menuCourses catalog with every restriction variant — easily 100KB+). At two services/day that is ~700 blobs/year downloaded to every iPad and the old kitchen display. Worse, the sqlite-primary read path (`readServiceArchive`) SELECTs the whole table and JSON-parses every row on every Archive open just to slice the top 60/30, so the modal gets slower every single week of operation until it visibly hangs mid-service on the weakest device.


*Evidence:* `powersync/sync-rules.yaml:65-70 (unfiltered bucket); src/powersync/reads.js:213-226 (full-table read + parse, then slice); src/lib/archiveStore.js:19-20 (fallback select("*") of 60 full blobs); schema.sql:144-152 (no retention mechanism)`


*Suggested fix:* Add a date/limit filter to the sync bucket (e.g. last 90 days, deleted_at IS NULL), add LIMIT to the local SQL instead of slicing in JS, and add a server-side retention job (or at minimum auto-purge trash after 30 days); provide an export before any purge.


**ARCHIVE-4 · MEDIUM · bug** — Insights count no-show reservations as covers


The archive deliberately keeps tables that were only RESERVED (`resName`/`resTime`, never arrived) so the record is complete — but archiveEntryStats then adds their `guests` to `covers` and counts them in `tableCount` unconditionally. A night with three 4-top no-shows inflates covers by 12 in the Insights badges ('covers', 'avg covers / service') and the per-service rows, so the owner's core volume metric is systematically wrong on any night with cancellations left on the board. aggregateInsights and the modal display propagate the same numbers.


*Evidence:* `src/App.jsx:2005 and :2255 (archive filter includes resName/resTime-only tables); src/utils/archiveInsights.js:56-57 (covers += tableGuests for every table), :48 (tableCount); rendered at src/components/modals/ArchiveModal.jsx:346-347`


*Suggested fix:* Count covers only for tables with `arrivedAt` (or `active`), and surface no-shows as their own stat — that's genuinely useful data the archive already holds.


**ARCHIVE-5 · MEDIUM · bug** — Pairing-uptake percentage uses inconsistent denominators for grouped vs ungrouped tables


For grouped parties, mergeTableGroups keeps only seats with content (`seatHasContent` filter), so guests who ordered nothing vanish from the seat count; for ungrouped tables every seat (seats array length == guest count) is counted. archiveEntryStats then computes `paired/seats` over this mix, so pairing uptake is inflated for multi-table parties and the aggregate `pairingPct` badge is biased upward in a way that varies with how many parties were grouped that night — the number is not comparable across services.


*Evidence:* `src/utils/tableHelpers.js:315-317 (content-only seats for groups); src/utils/archiveInsights.js:58-61 (counts every seat), :126 (pairingPct)`


*Suggested fix:* Use guest counts (tableGuests) as the pairing denominator, or count all seats of group members instead of content-filtered ones.


**ARCHIVE-6 · MEDIUM · bug** — Out-of-menu-order fires poison the monotonic-minutes math and silently discard timing samples


Fire stamps are HH:MM strings collected in MENU order, not chronological order (courses.filter(c => c.firedAt) walks the visible-course list). toMonotonicMinutes treats any backwards step as a midnight crossing and adds +24h. A kitchen that fires course 3 before course 2 (or corrects a mis-fire) produces a fake +1440-minute jump: the surrounding gaps exceed the 180-min cutoff and are dropped, and the table's duration exceeds the 720-min cutoff and is dropped — so the busiest, messiest nights (exactly the ones worth analyzing) contribute the fewest samples to medianGap, courseGaps, slowestCourses, durations, and the archive-seeded cadence prediction.


*Evidence:* `src/utils/fireCadence.js:11-22 (wrap heuristic), :26-37; src/utils/archiveInsights.js:68-84 (menu-order stamps, g > 180 and dur > 720 filters), :137-155 (history seeding inherits the same loss)`


*Suggested fix:* Sort fired stamps chronologically within a plausible service window before computing gaps (or store full ISO timestamps in kitchenLog instead of HH:MM).


**ARCHIVE-7 · MEDIUM · bug** — Rollover auto-end runs a stale closure: wrong LUNCH/DINNER label and stale menu snapshot


The 60-second auto-end interval captures `autoEndStaleService` from the render when its effect last ran, and its deps are only [supabase, serviceDate, serviceDateChosenOn, mode]. `activeServiceSession`, `menuCourses`, `cocktails/spirits/beers` are read from that stale closure. Concrete: service started at lunch (effect binds with session='lunch'), staff flip the switch to dinner mid-afternoon (no dep changes), everyone forgets to end and the board rolls over — the auto-end archives the DINNER service labeled '… – LUNCH' with the lunch-era menu snapshot, and the deterministic-id fallback seed (`${staleDate}|${session}`) uses the wrong session too. Directly corrupts the owner's concern #1↔#2 boundary (which session a night was filed under).


*Evidence:* `src/App.jsx:4069-4081 (effect deps exclude session/menu), :2260, :2268, :2272 (closure reads of activeServiceSession/menuCourses/cocktails); contrast the ref discipline used elsewhere (App.jsx:661-672)`


*Suggested fix:* Read activeServiceSessionRef.current / fetch courses inside autoEndStaleService (it already refetches menu when empty), or include the session in the effect deps.


**ARCHIVE-8 · MEDIUM · data-integrity** — Archive filter drops tables whose only content is drinks/bottles — narrower than the app's own 'has service content' definition


Both archive paths keep only tables matching `active || arrivedAt || resName || resTime`. The codebase's canonical content test, tableHasServiceContent (used by CLEAR ALL's warning and the mass-blank guard), additionally counts kitchenLog, kitchenArchived, bottleWines, and any seat with drinks/extras. A walk-in table where a waiter logged aperitifs or a bottle without tapping seated/arrival is silently EXCLUDED from the archive and then blanked by the same transaction — the exact 'night's drinks input' the auto-end comment promises to preserve (App.jsx:2192-2196) is lost with no warning.


*Evidence:* `src/App.jsx:2005 (manual filter), :2253-2256 (auto filter); src/utils/tableHelpers.js:218-226 (tableHasServiceContent counts seat/bottle content the filter ignores)`


*Suggested fix:* Use tableHasServiceContent (minus celebration-seeded extras) as the archive inclusion predicate.


**ARCHIVE-9 · MEDIUM · race-condition** — Two devices ending with divergent identity file duplicate archives; simultaneous same-id ends silently discard one snapshot


Dedup identity is hash(workspaceId, startedAt) with a fallback seed of `date|session` when startedAt is absent (App.jsx:2014-2017, 2266-2269). If one device holds the startedAt stamp and another (adopted from a legacy identity-less state, App.jsx:2506-2513) holds null, they derive DIFFERENT ids for the same service → two archive rows, and because both read fetchSameDayArchives before either insert landed, both get the same base label — indistinguishable duplicates. Conversely, when two devices race with the SAME id, `on conflict (id) do nothing` (and the local probe-skip at writes.js:207-217) keeps whichever snapshot uploads first and silently discards the other — the surviving record's content is nondeterministic and may be the LESS complete device's view, since each device archives its own in-memory board (App.jsx:1998) rather than the store's.


*Evidence:* `src/App.jsx:2014-2017, 1998, 2005; src/utils/archiveIdentity.js:28-30; schema.sql:1049 (do nothing); src/powersync/writes.js:207-217 (probe-skip)`


*Suggested fix:* On id conflict, merge instead of dropping (e.g. `on conflict (id) do update set state = ... where more tables`), or at least prefer the snapshot with more tables/later created_at; archive from store rows (fetchBoardRows) on the manual path like the auto path already does.


**ARCHIVE-10 · MEDIUM · race-condition** — A kitchen-role device's archive delete permanently wedges its PowerSync upload queue


RLS allows kitchen accounts to READ archives but not UPDATE/DELETE them. On a sqlite-primary device the soft-delete writes locally without any role check and succeeds in the UI; the upload then fails with 42501, which isPermanentError matches — but service_archive is in NEVER_DROP_TABLES, so the connector rethrows instead of skipping, and PowerSync retries the same transaction forever. Every subsequent write from that device (board saves, fires) queues behind the poisoned op: one tap on 'delete' in the archive by a kitchen-credentialed display silently halts ALL uploads from that device for the rest of service.


*Evidence:* `schema.sql:871-877 (update/delete = admin/service only); src/powersync/writes.js:277-283 (unchecked local write); src/powersync/SupabaseConnector.js:82-84 (NEVER_DROP includes service_archive), :327-334 (permanent error on NEVER_DROP table → throw → infinite retry)`


*Suggested fix:* Gate archive mutations on role in the UI/store seam, and treat 401/403-class RLS denials on NEVER_DROP tables as surfaced-but-skippable (alert + drop) rather than queue-blocking.


**ARCHIVE-11 · MEDIUM · ux** — Archive load failure is indistinguishable from an empty archive


Both ArchiveModal and ArchivePanel swallow fetch errors into `setEntries([])` and then render 'No archived services yet'. On a fallback (network-read) device with flaky Wi-Fi, the owner opens the archive and is told there are no archived services — reads as total data loss and will trigger panic (or worse, a re-archive attempt) mid-service.


*Evidence:* `src/components/modals/ArchiveModal.jsx:42-45 (catch → empty + same empty-state at :212); src/components/admin/ArchivePanel.jsx:23-26, :96`


*Suggested fix:* Track error state separately and render 'Couldn't load the archive — retry' with a retry button.


**ARCHIVE-12 · MEDIUM · ux** — Two taps destroy the entire archive history; trash is unbounded and never auto-expires


DELETE ALL soft-deletes every active entry (any service-role user, one confirm), and EMPTY TRASH then hard-deletes ALL soft-deleted rows — including ones deleted seconds ago and rows beyond the 30 shown in the UI. 'Recently Deleted' implies an auto-expiring safety net but nothing ever purges or expires it, and there is no export path before purge — so the only copy of years of guest history (guest memory, insights, cadence seeds) can be irreversibly destroyed in two confirms during a stressful service.


*Evidence:* `src/components/modals/ArchiveModal.jsx:64-78 (deleteAll), :94-105 (emptyTrash); src/lib/archiveStore.js:53-78 (unbounded update/delete); src/lib/archiveStore.js:20 (trash view capped at 30 while purge is unbounded); no retention anywhere in schema.sql`


*Suggested fix:* Restrict EMPTY TRASH to admin, purge only entries older than N days, and offer a JSON/CSV export before destructive operations.


**ARCHIVE-13 · MEDIUM · missing-feature** — Archive is effectively unqueryable beyond the last 60 services; guest memory only sees ~20 services back


Every surface is hard-capped: ArchiveModal/ArchivePanel list 60 active + 30 trash with no pagination or search; Insights aggregate at most those 60; GuestMemory scans only the 20 most recent archives (≈10-14 days at two services/day) with a 5-minute module cache — a regular guest returning after a month is reported as new, undermining the feature's whole promise. There is no export, no date-range filter, and no way to answer 'show me last summer' even though the data is all synced locally. Older rows exist but are unreachable through any UI.


*Evidence:* `src/lib/archiveStore.js:19-20 (60/30 caps); src/powersync/reads.js:220-224 (same caps); src/components/reservations/GuestMemory.jsx:14 (ARCHIVE_LIMIT = 20), :13 (5-min cache); src/components/modals/ArchiveModal.jsx:339 ('last N services' label reflects the cap, not history)`


*Suggested fix:* Add date-range paging to fetchArchive, raise GuestMemory's scan depth (it can query the local DB by name cheaply), and add a CSV/JSON export.


**ARCHIVE-14 · LOW · bug** — Archived services are rendered against TODAY's extras catalog instead of their own


ArchiveModal correctly derives optionalPairings from the ENTRY's own menuCourses, but passes the LIVE `optionalExtras` (today's dishes prop) to every archived TableSummaryCard; ArchivePanel does the same. After the menu changes, an old service's seat extras resolve against the wrong catalog — labels missing or wrong on historical records, quietly eroding trust in the archive.


*Evidence:* `src/components/modals/ArchiveModal.jsx:232 (entry-scoped pairings) vs :260 (live optionalExtras prop from :17); src/components/admin/ArchivePanel.jsx:10, :132`


*Suggested fix:* Derive extras from entry.state.menuCourses the same way optionalPairingsFromCourses already does for pairings.


**ARCHIVE-15 · LOW · data-integrity** — A genuine second service on the same day+session is silently dropped when both lack a startedAt (contradicts the 'always save' doctrine)


archiveDedup.js's header promises an archive is NEVER silently skipped as a duplicate — the label layer adds ' · n' instead. But the identity layer defeats this for legacy/degraded services: two identity-less services on the same day+session hash to the SAME fallback id (`date|session`), and `on conflict do nothing` / the local probe-skip drops the second night's archive entirely, ' · 2' label and all. The code itself documents the collision risk (App.jsx:2506-2513, 4003-4008) but only mitigates the adoption paths, not the insert.


*Evidence:* `src/utils/archiveDedup.js:1-6 (doctrine); src/App.jsx:2014-2017, :2266-2269 (shared fallback seed); schema.sql:1049; src/powersync/writes.js:207-217`


*Suggested fix:* Salt the fallback seed with the computed label suffix (which already distinguishes the second service), or fall back to a random id when startedAt is absent AND a same-id row already exists.


**ARCHIVE-16 · LOW · ux** — Archive UI inside Test Service silently no-ops but pretends to succeed


The archive can be opened during a sandbox test service (header button is always wired). Mutations are correctly blocked by the sandbox backstop (attempt() returns {ok:true} without writing), but the modal then updates its local state as if the delete/restore/purge happened — entries visibly move to trash or disappear, and reappear after reload. The ARCHIVE & CLEAR button also runs the REAL archiveAndClearAll (only the store write is backstopped), producing a confusing 'already ended on another device' alert or a mode exit plus removal of the real service's localStorage identity stamps (App.jsx:1950-1954) mid-sandbox. Staff practicing in test mode learn wrong lessons about what the archive buttons do.


*Evidence:* `src/lib/archiveStore.js:26-36 (sandbox fake-ok); src/components/modals/ArchiveModal.jsx:56-58 (optimistic state update); src/App.jsx:4494/4592/4995 (onArchiveAndClear bound to archiveAndClearAll, which has no sandboxRef check — only endService at :2052-2055 routes to endTestService)`


*Suggested fix:* In sandbox, render the archive read-only with a banner, and route the modal's ARCHIVE & CLEAR through endService.


**ARCHIVE-17 · LOW · ux** — Stale error-help text tells the owner to open anon policies


Delete failures in ArchiveModal append 'You may need to enable UPDATE on the service_archive table in Supabase (Policies → anon → UPDATE)' — advice from the pre-tenancy era. The current schema is authenticated + role-based (schema.sql:865-877); following this instruction would open the archive to anonymous writes, and it misdiagnoses the actual common cause (kitchen role lacking update rights).


*Evidence:* `src/components/modals/ArchiveModal.jsx:54, :71; schema.sql:160-170 (pre-tenancy policies explicitly dropped)`


*Suggested fix:* Replace with a role-aware message ('this account's role cannot delete archives').


**ARCHIVE-18 · LOW · bug** — Label ' · n' counter ignores trashed rows, so restore can create identical labels


nextArchiveLabel counts only non-deleted same-slot rows (fetchSameDayArchives filters deleted_at IS NULL). Sequence: service filed as 'X · 2', someone trashes it, a third service on the same day+session files as 'X · 2' again, then the first is restored — two visually identical 'X · 2' entries with different content, defeating the suffix's entire purpose of keeping doubles legible.


*Evidence:* `src/utils/archiveDedup.js:22-26 (count-based suffix); src/App.jsx:1874-1885 (deleted rows excluded from the input set); src/powersync/reads.js:202-208 (same on the local path)`


*Suggested fix:* Include trashed rows in the suffix-counting query, or pick max(existing n)+1 instead of count+1.


### restrictions (15 findings)


**RESTRICTIONS-1 · CRITICAL · data-integrity** — Boot-order race nulls gluten/dairy/nut/shellfish course variants on a fresh device


DEFAULT_DIETARY_KEYS uses long keys (gluten_free, dairy_free, nut_free, shellfish_free) while the runtime restriction list and RESTRICTION_COLUMN_MAP use short keys (gluten, dairy, nut, shellfish). supabaseRowToCourse maps course rows using the LIVE DIETARY_KEYS at fetch-resolution time: RESTRICTION_COLUMN_MAP['gluten_free'] is undefined, so restrictions.gluten_free = null and the row's real gluten_free DB column is never read. On a device with no cached restrictions (first login, cleared storage), the menu fetch (App.jsx:4084-4111) races the service_settings restrictions load (App.jsx:3322-3356); if the menu wins, every mapped course loses all four allergy variants, the broken mapping is written into the localStorage menu cache (writeLocalMenuCourses, App.jsx:4097), and until a later successful re-fetch the printed menu gives a celiac guest the ORIGINAL dish and the kitchen ticket shows no GF/dairy/nut/shellfish mod lines — with zero warning. The seat chip still shows the label, but the derived safety outputs are silently wrong.


*Evidence:* `src/constants/dietary.js:1-18 vs 20-37; src/utils/menuUtils.js:159-176; src/utils/menuCourseMapper.js:10-14; src/App.jsx:3322-3356, 4084-4111, 3839`


*Suggested fix:* Make DEFAULT_DIETARY_KEYS identical to DEFAULT_RESTRICTIONS keys; additionally make supabaseRowToCourse read both key forms (it should union RESTRICTION_COLUMN_MAP values regardless of DIETARY_KEYS), and re-map/re-fetch courses after setRestrictionsCache runs.


**RESTRICTIONS-2 · CRITICAL · data-integrity** — Kitchen-added allergies are silently wiped by any reservation edit (and by the reconcile for terrace tickets)


addKitchenRestr writes {note, pos, kitchenAdded:true} to TABLE state only (KitchenBoard.jsx:123-129); nothing syncs it back to the reservation. Any later edit of the reservation — a rename, time change, pax fix by a waiter who never saw the kitchen's entry — fires syncStartedTablesFromReservation → startedTablePatchFromReservation, which rebuilds table.restrictions purely from the reservation's entries (mergeRestrictionPositions returns only entries derived from `next`), deleting the kitchen-added nut allergy from the live ticket. Worse: for a table that is NOT 'started' (a terrace party's ticket is live on the kitchen board while the dining table is inactive — KitchenBoard.jsx:1198-1204), the board↔reservations reconcile effect re-templates the table on EVERY reservations/state change (App.jsx:2834-2846, reconcile.js:91), so a kitchen-added restriction there can vanish within seconds with no user action at all.


*Evidence:* `src/components/kitchen/KitchenBoard.jsx:123-129; src/utils/tableHelpers.js:346-357, 381-385; src/App.jsx:2595-2608, 2834-2846; src/utils/reconcile.js:87-95`


*Suggested fix:* Preserve entries flagged kitchenAdded when rebuilding restrictions from a reservation (union instead of replace), or write kitchen additions through to the reservation row.


**RESTRICTIONS-3 · HIGH · bug** — Only one substitution applied per course, with lifestyle preferences outranking allergies


applyCourseRestriction and getCourseMod walk RESTRICTION_PRIORITY_KEYS and stop at the FIRST matching variant (break/return). The order is vegan, veg, pescetarian, THEN gluten, dairy, nut, shellfish — a preference outranks an allergy. Concrete failure: guest is vegan + nut-allergic; the course has both a vegan variant (containing nuts, e.g. a nut roast) and a nut-free variant. The printed menu and the kitchen ticket's mod line both show only the vegan variant; the nut allergy is silently not applied to any course. The kitchen's only remaining defense is the tiny seat chip listing both labels. There is no multi-restriction intersection, no cross-contamination data (row.hazards is mapped at menuCourseMapper.js:37 but consumed nowhere), and no severity distinction anywhere downstream — 'allergy' vs 'dietary' is purely a UI grouping.


*Evidence:* `src/utils/menuUtils.js:153-157, 189-212 (break at 211), 271-299; src/utils/menuGenerator.js:491; src/utils/menuCourseMapper.js:37`


*Suggested fix:* Rank allergy-group keys above dietary/lifestyle, and when a seat has multiple keys either apply all matching variants' notes or flag an explicit 'MULTI — CHECK' mod instead of silently picking one.


**RESTRICTIONS-4 · HIGH · bug** — Admin-added custom restrictions never match course variants; deleting+re-adding a built-in permanently severs it


The admin can add a custom restriction (RestrictionsPanel), and CourseEditorPanel then offers it for per-course variants (it iterates live DIETARY_KEYS, CourseEditorPanel.jsx:80-82) which round-trip to the DB via restrictions_si.__en_* (menuCourseMapper.js:74-89). But applyCourseRestriction and getCourseMod iterate the HARDCODED RESTRICTION_PRIORITY_KEYS list, so a configured variant for any custom key is never applied to a menu, never produces a ticket mod, and never fills an allergy-sheet cell — configured safety data silently inert. Same trap for built-ins: deleting 'Gluten Free' and re-adding it mints key 'gluten_free' (slug of label, RestrictionsPanel.jsx:8-18,47), which is in neither RESTRICTION_PRIORITY_KEYS nor RESTRICTION_COLUMN_MAP — from then on gluten guests get zero substitutions while everything looks configured.


*Evidence:* `src/utils/menuUtils.js:153-157, 189, 271; src/components/admin/RestrictionsPanel.jsx:8-18, 43-51; src/components/admin/CourseEditorPanel.jsx:80-82; src/utils/menuCourseMapper.js:74-89`


*Suggested fix:* Derive the priority/matching key list from the live DIETARY_KEYS (allergy group first) instead of a frozen constant; block or warn on re-slugging a deleted built-in key.


**RESTRICTIONS-5 · HIGH · race-condition** — Cross-device concurrent restriction edits lose one side (whole-field fold), plus two remaining render-captured whole-array writes


table.restrictions is folded as a single top-level field: if local differs from ancestor, LOCAL wins wholesale (foldTable.js:51-53). Two-device scenario (the normal setup): waiter's iPad assigns a pos in Detail while the kitchen screen adds a shellfish allergy via the quick drawer → whichever device folds first overwrites the array and the other device's added ALLERGY entry is dropped. KitchenBoard's functional updates (KitchenBoard.jsx:119-132) fixed only the same-device race; Detail.jsx:596 and DisplayBoard.jsx:60 still write whole arrays computed from render-captured state, so even same-device staleness (sync echo landing between render and tap) reverts concurrent changes. Also index-based targeting (assigningRestrIdx, removeKitchenRestr(origIdx), DisplayBoard assignTo) can pin a pos or delete the WRONG entry if the array was reordered/changed by a remote edit between render and tap.


*Evidence:* `src/utils/foldTable.js:46-56; src/components/kitchen/KitchenBoard.jsx:119-132, 190-196, 503-512; src/components/service/Detail.jsx:596-598; src/components/service/DisplayBoard.jsx:57-62`


*Suggested fix:* Fold restrictions per-entry (match on note+pos or a stable entry id) like seats are folded; give entries stable ids and target edits by id, not index.


**RESTRICTIONS-6 · HIGH · bug** — A restriction can be pinned to a nonexistent seat and then disappears from every kitchen surface


Seat ids are not always 1..N — a dining-map chair drag legitimately yields ids like {1,2,3,5,6} for 5 guests (makeSeats, tableHelpers.js:65-97). Detail's position chips are generated as 1..max(guests, mapSeatCap) regardless of the real seat ids (Detail.jsx:593), so a waiter can tap P4 when no seat 4 exists (and cannot reach the real P6 from the board view where mapSeatCap is null — App.jsx:4895-4913 passes no mapSeatCap). A restriction with pos=4 then matches NO seat chip (KitchenBoard.jsx:582 filters r.pos===s.id), is excluded from the UNASSIGNED strip (608-609 filters !r.pos), and is skipped entirely by courseRestrictionModCounts (assigned loop iterates seats; unassigned loop requires pos==null — menuUtils.js:344-355). The allergy exists in data but is invisible on the live ticket, the floor map and the mod counts.


*Evidence:* `src/components/service/Detail.jsx:593; src/utils/tableHelpers.js:65-97; src/components/kitchen/KitchenBoard.jsx:582, 608-609; src/utils/menuUtils.js:340-357; src/App.jsx:4895-4913`


*Suggested fix:* Render position chips from the table's actual seat ids (as KitchenBoard does), and make courseRestrictionModCounts/the UNASSIGNED strip treat a pos with no matching seat as unassigned rather than dropping it.


**RESTRICTIONS-7 · MEDIUM · data-integrity** — Combined-table (tableGroup) views duplicate restrictions and attach them to the wrong merged seat


The reconcile stamps the FULL reservation restriction set onto EVERY member table of a group (reconcile.js:27-31, 87-95; same in syncStartedTablesFromReservation App.jsx:2599-2607). mergeTableGroups then flatMaps members' restrictions (tableHelpers.js:327) — so one vegan on a two-table party appears twice — while merged seats are renumbered 1..n after dropping empty seats (311-317) WITHOUT remapping restriction pos. SummaryModal/TableSummaryCard and the archive views then match r.pos===mergedSeat.id (TableSummaryCard.jsx:29, SummaryModal.jsx:37): the allergy renders duplicated and/or on a different guest than it was pinned to. GuestMemory escapes only because archiveInsights dedupes note strings (archiveInsights.js:184).


*Evidence:* `src/utils/tableHelpers.js:311-317, 327; src/utils/reconcile.js:27-31, 87-95; src/components/modals/TableSummaryCard.jsx:29; src/components/modals/SummaryModal.jsx:37; src/utils/archiveInsights.js:184`


*Suggested fix:* In mergeTableGroups, dedupe the restriction set across members and remap pos through the same old-id→new-id mapping used for seats.


**RESTRICTIONS-8 · MEDIUM · bug** — Custom restriction 'detail' text never reaches the live kitchen ticket or service Detail


ResvForm captures a free-text detail for custom restrictions ('lard, spread, stocks ok') at ResvForm.jsx:523-536. It renders on the weekly sheets and the pre-service printed tickets (weeklyPrintGenerator.js:504-516; ReservationManager.jsx:92-102, 215-226) but the LIVE kitchen ticket shows only the note (seat chips KitchenBoard.jsx:582-600, unassigned strip 626), Detail shows only restrLabel (Detail.jsx:587), and the floor views only a 3-letter code. Mid-service, the one place the cook looks has 'NO PORK' without the crucial elaboration the guest gave.


*Evidence:* `src/components/reservations/ResvForm.jsx:523-536; src/components/kitchen/KitchenBoard.jsx:582-600, 626; src/components/service/Detail.jsx:587; src/utils/weeklyPrintGenerator.js:504-516`


*Suggested fix:* Append `(detail)` to the note wherever restrLabel/raw note is rendered for entries with no matching def.


**RESTRICTIONS-9 · MEDIUM · missing-feature** — No FOH path to record an allergy for a seated walk-in


Service's table Detail view only lists existing restrictions and assigns positions — there is no add UI (Detail.jsx:577-613 renders 'none' for an empty list). ResvForm requires a reservation; the only live add path is the KITCHEN screen's quick drawer / editable preview (KitchenBoard.jsx:452-472, 500-575). A waiter seating a walk-in with a shellfish allergy must either fabricate a reservation, walk to the kitchen display, or bury it in free-text notes (which produce no course mods and no red flags). For an allergy-centric product this is the most common mid-service entry path and it's missing.


*Evidence:* `src/components/service/Detail.jsx:577-613; src/components/kitchen/KitchenBoard.jsx:452-472; src/components/floor/FloorInspector.jsx (no restriction entry UI)`


*Suggested fix:* Add the same restriction picker the kitchen drawer has to Detail's [RESTRICTIONS] block.


**RESTRICTIONS-10 · MEDIUM · ux** — Restriction chips only increment — no toggle-off, no cap at guest count


Every tap on a restriction chip appends another entry ({pos:null, note}) (ResvForm.jsx:481; ReservationModal.jsx:272). A hurried waiter double-tapping to 'select' registers 2 vegan guests; deselection requires spotting the small × in a separate chip list below (ResvForm.jsx:548-565). Nothing caps entries at the guest count, so a 2-top can carry 5 gluten entries; the kitchen ticket then shows an inflated '5× GF' headcount and the weekly sheet prints '5x gluten free'.


*Evidence:* `src/components/reservations/ResvForm.jsx:479-491, 548-565; src/components/reservations/ReservationModal.jsx:268-292; src/utils/menuUtils.js:352-355`


*Suggested fix:* Long-press or a −/+ stepper per chip; warn when entries exceed guests.


**RESTRICTIONS-11 · MEDIUM · bug** — Printed allergy sheet can disagree with the live ticket and shows blank cells for custom restrictions


The weekly allergy sheet and pre-service kitchen tickets compute mods from RESERVATION data (allergyBaseCell ReservationManager.jsx:154-184; weeklyPrintGenerator.js:355-392, 553-585), but seat positions assigned during service live only on the TABLE state (Detail/DisplayBoard/KitchenBoard write table.restrictions; nothing writes pos back to the reservation). A guest with gluten+dairy assigned to one seat resolves as ONE combined mod on the live ticket (courseRestrictionModCounts groups per seat) but as TWO separate mods on the sheet (each unassigned entry resolved alone) — the paper the kitchen prepped from and the screen during service state different counts. Additionally, a custom restriction ('NO RABBIT') produces getCourseMod=null for every course, so its column shows the header line but all course cells blank/white — visually identical to 'no modification needed anywhere', a dangerous default for a hand-written allergy.


*Evidence:* `src/components/reservations/ReservationManager.jsx:154-184; src/utils/weeklyPrintGenerator.js:355-392, 553-585; src/utils/menuUtils.js:260-302, 340-357`


*Suggested fix:* Write pos assignments back to the reservation row, and render custom-key columns with a visible 'MANUAL — see note' marker in every course cell instead of blank.


**RESTRICTIONS-12 · MEDIUM · ux** — Unassigned restriction substitutes the dish on EVERY printed seat menu


resolveSeatRestrictionKeys deliberately broadcasts pos:null entries to all seats (documented at menuUtils.js:306-318) and generateMenuHTML applies the substitution per seat (menuGenerator.js:152, 491). Practical effect: menus are usually printed from the reservation before seats are assigned, so one vegetarian in a 6-top means all six printed menus show the vegetarian dish — five guests read the wrong menu, and staff cannot tell from the print which menu was actually varied.


*Evidence:* `src/utils/menuUtils.js:306-318; src/utils/menuGenerator.js:152, 491`


*Suggested fix:* At print time, warn when unassigned restrictions exist and/or print one varied menu + N standard menus instead of N varied ones.


**RESTRICTIONS-13 · MEDIUM · data-integrity** — Deleting a restriction from the admin list silently destroys course variant data on next course save


courseToSupabaseRow rebuilds restrictions_si (SI variants, kitchen notes, custom-key EN variants) by iterating the CURRENT live DIETARY_KEYS (menuCourseMapper.js:78-89) and writes it wholesale. After an admin removes e.g. 'nut' from the list, the next save of ANY course (unrelated edit) drops that course's nut_si variant and nut kitchen note permanently; the nut_free column also stops being written (128-131). Restoring the restriction later does not restore the notes. Two devices with different cached lists write differently shaped rows.


*Evidence:* `src/utils/menuCourseMapper.js:74-89, 128-131; src/components/admin/RestrictionsPanel.jsx:38-41, 76-79`


*Suggested fix:* Preserve unknown keys in restrictions_si on write instead of rebuilding from the live key list.


**RESTRICTIONS-14 · LOW · bug** — Admin ticket-preview generator misrepresents restriction logic (hardcoded '1× GF mod', raw keys)


kitchenTicketGenerator (admin kt_* template preview) prints a hardcoded '1× GF mod' on every course whenever ANY assigned restriction exists (renderCourses, line 212-214) and renders raw keys ('gluten') instead of labels on seat chips (line 160, 172, 181). An admin tuning the ticket template sees behavior the real KitchenTicket never produces, and may toggle showRestrictions believing it controls something it doesn't.


*Evidence:* `src/utils/kitchenTicketGenerator.js:150-243 (esp. 212-214, 172, 181)`


*Suggested fix:* Drive the preview through courseRestrictionModCounts/restrLabel with the sample data.


**RESTRICTIONS-15 · LOW · architecture** — GuestMemory and unassigned prints surface raw keys; ReservationModal is divergent dead code


GuestMemory renders archived restriction notes verbatim ('no_garlic_onion, gluten') because archiveInsights extracts raw note strings (archiveInsights.js:184) and GuestMemory.jsx:95-97 joins them unmapped. Separately, ReservationModal.jsx is imported nowhere but maintains a second reservation-entry implementation with an incompatible menuType convention ('Long'/'Short' capitalized vs 'long'/'short' checked everywhere with ===, e.g. ReservationManager.jsx:212, 888 — 'Short' would print as LONG MENU on the allergy header) and no custom-restriction/detail support; if ever rewired it would silently corrupt menuType-dependent restriction output.


*Evidence:* `src/components/reservations/GuestMemory.jsx:95-97; src/utils/archiveInsights.js:184; src/components/reservations/ReservationModal.jsx:147-148, 342 (no imports repo-wide); src/components/reservations/ReservationManager.jsx:212, 888`


*Suggested fix:* Map keys through restrCompact in GuestMemory; delete ReservationModal.jsx.


### floor-editor (17 findings)


**FLOOR-EDITOR-1 · CRITICAL · data-integrity** — floor_maps_v1 is whole-blob last-writer-wins with unconditional upsert and offline replay — concurrent or stale-device edits silently destroy each other's maps


Every editor gesture writes the ENTIRE maps blob (all maps, all tables, sheet, activeDiningMapId). The server write is a blind upsert with no expected-updated_at check, and lib/stateStore retains the latest failed value per key and replays it on the browser 'online' event with no staleness bound. Failure scenario A (two admins): owner edits LAYOUT A on the desktop while a manager tweaks TERRACE on an iPad; each device's write replaces the whole blob, so whichever write lands last erases the other admin's edits entirely — different maps do not merge, and neither device shows any conflict. Failure scenario B (offline replay): an iPad edits the map, loses Wi-Fi, the blob is retained in the queue; hours later — after the owner has redesigned the floor on another device — the iPad reconnects and its 'online' replay overwrites the redesign with the stale blob. dropPendingStateKey is called for FLOOR_STATUS_KEY on service end (App.jsx:2523,2542) but NEVER for FLOOR_MAPS_KEY, so a stale maps blob can replay indefinitely. The same LWW applies to floor_status_v1 strips.


*Evidence:* `src/lib/stateStore.js:35-44 (unconditional upsert), :59-125 (latest-value-wins retained retry + online replay); src/App.jsx:3481-3486 (whole-blob save per edit), :3541-3550 (adoptFloorMaps JSON replace); src/App.jsx:2523,2542 (dropPendingStateKey only for FLOOR_STATUS_KEY)`


*Suggested fix:* Add a compare-and-set on updated_at (like serviceTableCas for board rows) or per-map rows instead of one blob; at minimum bound the offline replay age for FLOOR_MAPS_KEY and surface a conflict banner when an adoption discards local unsynced edits.


**FLOOR-EDITOR-2 · HIGH · race-condition** — Layout switch (publish) is non-atomic across three persistence domains — a mid-switch failure or offline gap strands reservations on a layout no device is showing


CONFIRM SWITCH does: (1) move live board state via setTables + board autosave (service_tables rows), (2) persist repointed reservations (persistReservationRows), and only then (3) FloorPanel writes activeDiningMapId as a separate queued settings write. If the device dies, reloads, or the settings write sits in the retry queue between (2) and (3), every device keeps rendering the OLD active layout while reservations already point at the NEW layout's slot pairs — parties show as NEEDS TABLE / on wrong tiles mid pre-service. Other devices also observe (1)/(2) seconds before (3), a visible inconsistent window on every switch. There is no rollback of the reservations batch if the activation write never lands.


*Evidence:* `src/App.jsx:1453-1493 (tables moved locally at :1474, reservations persisted at :1481, no activation write); src/components/admin/FloorPanel.jsx:51-57 (onUpdateFloorMaps activation only after the awaited batch); src/lib/stateStore.js:81-113 (activation write can be queued/retried independently)`


*Suggested fix:* Persist activeDiningMapId and the reservation batch in one transaction (settings write first with a pending flag, or fold activation into the reservations RPC), and reconcile on boot if reservations disagree with the active map.


**FLOOR-EDITOR-3 · HIGH · bug** — A confirmed layout switch silently skips 'blocked' moves — operator-approved diff is partially applied with only a console.warn


applyLayoutSwitchRows blocks any move whose destination slot holds live content that is not itself moving (e.g. a walk-in seated after the confirm dialog was opened). Blocked rows are dropped with console.warn only; the function still returns { ok: true } and FloorPanel activates the layout. The operator confirmed a diff that said 'NOVAK T6 → T6-7' but NOVAK's reservation and board state silently stayed on the old slot — under the new active map that slot may be claimed by a different tile or unresolvable, so NOVAK renders on the wrong tile or in the NOT ON THIS MAP list with no explanation of why the promised move didn't happen. The plan is also computed once at requestSwitch time (FloorPanel.jsx:39) and never recomputed while the dialog sits open, widening the window.


*Evidence:* `src/App.jsx:1459-1465 (blocked rows → console.warn, filtered out), :1492 (returns ok:true despite blocks); src/components/admin/FloorPanel.jsx:35-63 (no blocked-row feedback, stale pendingSwitch.rows)`


*Suggested fix:* Return blocked rows in the result and show them in the panel before/after activation; re-plan on confirm against current board + reservations and re-prompt if the diff changed.


**FLOOR-EDITOR-4 · HIGH · bug** — Deleting the active dining map bypasses the entire guarded layout-switch flow


The ACTIVE LAYOUT toggle enforces planLayoutSwitch → conflict/NEEDS TABLE blocking → reservation repoint → live-board-state move. But DELETE MAP on the currently active dining map just repoints activeDiningMapId to the first surviving dining map inside the pure deleteMap op — no diff, no conflict check, no reservation re-resolution, no applyLayoutSwitchToTables. Mid-service this instantly changes which tiles claim which board slots on every device: seated parties can land on differently-merged tiles, resolve to nothing (NEEDS TABLE), or collide, and their live kitchen state never moves because the switch machinery never ran. The only guard is the generic two-step CONFIRM and a generic 'LIVE SERVICE ON THE BOARD' warning chip.


*Evidence:* `src/utils/floorMaps.js:877-886 (deleteMap silently reassigns activeDiningMapId); src/components/floor/FloorInspector.jsx:320-327 (delete path calls onUpdate directly); contrast src/components/admin/FloorPanel.jsx:35-63 (guarded switch)`


*Suggested fix:* Refuse to delete the active dining map (require switching first), or route the implicit activation through the same plan/confirm/apply pipeline.


**FLOOR-EDITOR-5 · HIGH · bug** — renameTable can shadow a merge's member label — reservations silently resolve to the wrong table


addTable deliberately treats merge members as taken ('a plain T2 next to the T2-3 merge would win the exact-match resolution … and silently shadow the merge', floorMaps.js:463-469), but renameTable only checks uniqueness against existing table LABELS, not members. Renaming any table to 'T2' in a map containing the T2-3 merge succeeds; from then on resolveReservationTable's exact-label rule routes every slot-2 reservation to the renamed table instead of the merge — wrong seats, wrong SET tile, wrong seat-count cap for the restriction selector. Similarly, nothing anywhere prevents two tables in one map from claiming overlapping boardIds (setTableBoardIds has no cross-table check; the inspector only surfaces conflicts among TONIGHT'S reservations), so two tiles can silently read the same board slot and both render the same party.


*Evidence:* `src/utils/floorMaps.js:430-437 (rename checks labels only) vs :465-469 (addTable's member-aware taken()); :174-181 (exact match wins); :572-577 (setTableBoardIds unchecked); src/components/floor/FloorInspector.jsx:91-93 (conflicts only vs tonight's reservations)`


*Suggested fix:* Make renameTable reject labels that are members of another table's merge, and validate/flag overlapping slot claims structurally in the SLOTS row, not only via tonight's reservation plan.


**FLOOR-EDITOR-6 · HIGH · bug** — Layout-switch planning only sees the active session of the current service day — dinner and future-date reservations are never re-resolved or conflict-checked


FloorPanel receives reservations = serviceReservations, which App filters to r.date === serviceDate AND the ACTIVE service session (lunch OR dinner). planLayoutSwitch even keys conflicts per session (suggesting multi-session input was intended), but it is only ever fed one session. Switching the layout during lunch therefore neither moves nor conflict-checks tonight's dinner bookings, and no future date is ever checked: a dinner reservation on T5 survives an A→B switch untouched and only surfaces as NEEDS TABLE when dinner service starts — exactly the mid-service scramble the confirm flow exists to prevent. This directly intersects the owner's Lunch/Dinner-switch concern.


*Evidence:* `src/App.jsx:1421-1425 (session+date filter), :4690 (floorReservations={serviceReservations}); src/components/admin/AdminLayout.jsx:508; src/components/admin/FloorPanel.jsx:39; src/utils/floorMaps.js:246-253 (per-session conflict keying)`


*Suggested fix:* Feed planLayoutSwitch both sessions of the service day (and optionally upcoming days), grouping the diff by session so a lunch-time switch shows and resolves dinner impacts too.


**FLOOR-EDITOR-7 · MEDIUM · bug** — Renaming an unlinked table silently moves its board-slot claim via the label fallback


For tables without explicit boardIds, the claim is parsed from the label (T4 → slot 4). Renaming such a table 'T4' → 'T5' is a one-tap, confirm-free edit that atomically repoints the tile from board slot 4 to slot 5: the party seated on board 4 vanishes from the floor map (only the NOT ON THIS MAP banner remains) and the tile now shows whatever is on board 5, on every device, mid-service. The inspector's red LIVE warning renders only beside DELETE (FloorInspector.jsx:290-292); the LABEL field carries no such warning even when a live party sits on the implied slot. The dashed 'via label' chips exist but require reading the SLOTS row to notice.


*Evidence:* `src/utils/floorMaps.js:191-203 (label fallback), src/components/floor/FloorInspector.jsx:195-209 (rename UI, no live-party guard), :247-281 (dashed via-label chips), FloorView.jsx:523-543 (NOT ON THIS MAP fallback)`


*Suggested fix:* When a rename changes the effective boardIdsOf() and a live party occupies the old claim, show the same LIVE warning / require confirm, or auto-materialize the previous implicit claim as explicit boardIds before renaming.


**FLOOR-EDITOR-8 · MEDIUM · race-condition** — confirmSwitch and all inspector writes use render/closure-scope blobs — a whole-blob write after an await clobbers concurrent edits


App's own comment (App.jsx:3466-3472) says writers must derive from the ref via an updater because a value write 'silently erases' interleaved changes — but every floor-editor caller passes a value computed from the floorMaps prop, and FloorPanel.confirmSwitch is worst: it awaits the network reservation batch (seconds on restaurant Wi-Fi), then writes { ...floorMaps, activeDiningMapId } from the closure captured at click time. Any geometry edit or remote adoption that landed during the await is erased by that whole-blob write. Same pattern in the MOVE_SINGLE_TAP checkbox (FloorPanel.jsx:140-143).


*Evidence:* `src/components/admin/FloorPanel.jsx:42-57 (await then stale spread), :140-143; src/App.jsx:3481-3482 (updater supported but unused by these callers), :3466-3472 (comment documenting the hazard)`


*Suggested fix:* Call onUpdateFloorMaps with an updater (prev => ({ ...prev, activeDiningMapId })) everywhere the write isn't a pure function of the immediately-rendered blob.


**FLOOR-EDITOR-9 · MEDIUM · data-integrity** — Silent fallback to seed defaults when the boot read fails — the next edit overwrites the real maps with defaults


floorMapsState initializes to sanitizeFloorMaps(null) (= the three seed maps). The boot read retries 4 times then swallows the error (.catch(() => {})). On a flaky link (or before PowerSync's first sync in fallback mode) the admin panel shows LAYOUT A/B seeds with no indication they are placeholders; if the admin makes ANY edit, updateFloorMaps persists the defaults-derived blob — queued offline, replayed on reconnect — replacing the restaurant's entire customized map set. The realtime/watch adoption would eventually heal the display, but a pre-heal edit wins the write race.


*Evidence:* `src/App.jsx:584 (defaults init), :3443-3464 (read with silent catch), :196-206 (withRetry 4 attempts); src/lib/stateStore.js:102-125 (retained replay)`


*Suggested fix:* Track hydration for floor_maps_v1 (like floorStatusHydratedRef) and block/watermark the editor until the store copy (or a definitive 'row absent') has been seen.


**FLOOR-EDITOR-10 · MEDIUM · bug** — Geometry edits made during a TEST SERVICE are silently discarded


In sandbox mode saveStateKey no-ops (returns ok:true) so nothing persists, but updateFloorMaps still updates local state, so the editor behaves as if edits saved. floorMaps is NOT in the sandbox snapshot (floorStatus is), and endTestService re-reads FLOOR_MAPS_KEY and adopts the store copy after zeroing the echo-guard refs — so an admin who opens Admin → Floor during a test service and rearranges the room watches the work vanish on exit (or on reload), with no warning at any point.


*Evidence:* `src/lib/stateStore.js:104-106 (sandbox no-op), src/App.jsx:2070-2090 (snapshot has floorStatus, no floorMaps), :2163-2174 (refs reset + FLOOR_MAPS_KEY re-adopt on exit)`


*Suggested fix:* Either block the geometry editor in sandbox mode (banner: 'edits don't persist during a test service') or snapshot/restore floorMaps like floorStatus.


**FLOOR-EDITOR-11 · MEDIUM · architecture** — No undo, no draft/publish — every gesture is instantly live on every device; recovery from a bad edit of a customized map is impossible


Each drag release, stepper tap, and delete commits the whole blob and syncs to FOH floor views and the kitchen minimap within seconds — an admin 'trying something' rearranges the room under the waiters' fingers mid-service. There is no undo stack; RESET TO DEFAULTS exists only for the three seed map ids (hasDefaultGeometry) and restores FACTORY geometry, wiping all customization on that map — for a user-created 'LAYOUT C' there is no recovery at all after a mis-drag storm or accidental table delete (two-step confirm is the only guard, and it times out in 3.2s). The FLOOR_FIRST_PLAN frames editing as 'an admin concern' but provides no isolation between editing and live service.


*Evidence:* `src/components/floor/FloorEditor.jsx:213-214 (commit per gesture through onUpdateFloorMaps); src/App.jsx:3481-3486 (immediate persist), :3855-3858/4195-4198 (live adoption everywhere); src/utils/floorMaps.js:888-900 (reset = seeds only); src/components/floor/FloorInspector.jsx:50-63 (3.2s confirm), :328-332 (reset gated on seed ids)`


*Suggested fix:* Keep an in-editor undo ring (the ops are already pure state→state), and/or edit a working copy published explicitly — the activeDiningMapId switch machinery already provides the publish seam.


**FLOOR-EDITOR-12 · MEDIUM · ux** — No overlap/collision detection; + TABLE stamps every new table at the same fixed spot


moveTable only clamps to the canvas and magnets to edges — tables can fully overlap each other, walls, zones, and planters with no visual warning, and the chair-clearance magnet is advisory (±1.5 units) not enforced. addTable always places at (44,40): tapping + TABLE twice stacks T-next exactly on top of the previous new table — the seat count in the inspector changes but the second table is invisible under the first, and the top one takes all pointer events; an admin building a room from scratch hits this on the second table. duplicateTable offsets only +3,+3, mostly covering its source.


*Evidence:* `src/utils/floorMaps.js:369-407 (clamp+magnet only, no overlap test), :465-476 (fixed 44,40), :448-459 (+3/+3 duplicate)`


*Suggested fix:* Reject or highlight drops that overlap another table's rect (+chair band), and cascade the addTable spawn point / offset duplicates until clear.


**FLOOR-EDITOR-13 · MEDIUM · race-condition** — 60s echo guard compares writer-device wall clocks against local Date.now() — clock skew makes devices reject fresh remote edits


updated_at on service_settings rows is stamped by the WRITING device (writes.js writeSetting and the stateStore fallback upsert both use new Date().toISOString()), while adoptFloorMaps/adoptFloorStatus compare that foreign timestamp against this device's local Date.now() write stamp. Restaurant iPads are routinely minutes off. If device B's clock runs 3 minutes behind, every edit it publishes looks 'older' than any write device A made in the last 60s, so A drops B's genuinely newer blob as a stale echo; both devices keep diverging views until the window lapses, and the final state is whichever write hit the server last — compounding the LWW loss above. The same skew affects SET strips during service.


*Evidence:* `src/powersync/writes.js:82-90 (client-stamped updated_at); src/lib/stateStore.js:40-41; src/App.jsx:3531-3550 (cross-clock comparison in both adopt functions)`


*Suggested fix:* Stamp updated_at server-side (default now() / trigger) or carry a per-device write id and drop only true self-echoes instead of timestamp-older blobs.


**FLOOR-EDITOR-14 · LOW · bug** — Stored board-slot claims outside the configured chip range are invisible and uneditable


setTableBoardIds sanitizes to 1..999, but the SLOTS row renders chips only for configured table ids (fallback 1..10). A claim like 99 (from an older config with more tables, a since-removed table id, or another device) is not rendered as a chip, and the 'UNLINKED' hint only appears when boardIds is empty — so a stray claim can neither be seen nor cleared from the UI while it still wins over the label fallback and silently makes the tile read a nonexistent slot.


*Evidence:* `src/utils/floorMaps.js:572-577 (accepts 1..999); src/components/floor/FloorInspector.jsx:113-116 (slotOptions from configured ids), :247-281 (only chip-listed ids togglable; hint gated on empty boardIds)`


*Suggested fix:* Render out-of-range claims as removable warning chips.


**FLOOR-EDITOR-15 · LOW · ux** — Walls are immutable after placement and ortho-only; deleting one destroys its doors


The wall inspector offers only SOLID/DASHED/DELETE — no vertex move, no extend, no reposition; the WALL tool force-snaps every point to the dominant axis of the previous point, so diagonal or curved room outlines are impossible. Fixing a slightly-wrong wall means DELETE WALL, which by design also deletes every opening on it (doors carefully positioned/configured), then redrawing everything. For tracing a real room this makes iteration expensive on an iPad.


*Evidence:* `src/components/floor/FloorEditor.jsx:104-114 (unconditional ortho lock); src/components/floor/FloorInspector.jsx:187-192 (wall ops); src/utils/floorMaps.js:692-697 (deleteWall cascades openings)`


*Suggested fix:* Add wall drag/vertex edit (openings reference seg index + t, which survive translation), or at least re-anchor orphaned openings instead of deleting them.


**FLOOR-EDITOR-16 · LOW · data-integrity** — sanitizeFloorMaps keeps maps whole with no per-table validation — corrupt geometry or duplicate labels pass sanitize and degrade every device


The sanitizer only requires map.id and Array.isArray(map.tables); table entries with missing/NaN x/y/w/h or duplicate labels survive intact (deliberately, to preserve unknown keys). A corrupted blob — from a partial write, a manual DB edit, or a future schema change — renders NaN SVG coordinates for the broken table on every device, and duplicate labels break patchTable (only the first is ever editable) plus React's per-label keys in the renderer. Because adoption replaces state wholesale, one bad write poisons all devices simultaneously.


*Evidence:* `src/utils/floorMaps.js:140-157 (shape check only), :360-366 (patchTable by label, first match); src/components/floor/FloorMap.jsx:458-513 (key={t.label}, raw coords into SVG)`


*Suggested fix:* Coerce/validate numeric geometry and de-duplicate labels in sanitizeFloorMaps while still passing unknown keys through.


**FLOOR-EDITOR-17 · LOW · ux** — Magnet snap is invisible during drag — table jumps after finger lift; geometry-version banner is acknowledged blob-wide by one map's reset


Two polish items: (1) the live drag preview tracks the pointer exactly, but the commit applies unit snap PLUS the ±1.5-unit edge/chair-clearance magnet, so the table visibly jumps up to ~1.5 units after release with no preview of where it will land. (2) resetMapToDefaults stamps the whole blob's geometryVersion current after resetting ONE map, so the 'NEW DEFAULT GEOMETRY AVAILABLE' banner disappears even when other seed maps still carry old geometry (the code comment concedes it is 'not a per-map ledger').


*Evidence:* `src/components/floor/FloorMap.jsx:460-467 (unsnapped preview) vs src/utils/floorMaps.js:399-407 (magnet on commit); src/utils/floorMaps.js:893-900 (blob-wide version stamp); src/components/floor/FloorEditor.jsx:168-176 (single banner)`


*Suggested fix:* Apply moveTable to the preview position on each move sample (it is pure and cheap), and track lagging geometry per map id.


### floor-live (16 findings)


**FLOOR-LIVE-1 · CRITICAL · bug** — Moving or swapping a combined booking (tableGroup) makes the party vanish from board, kitchen tickets and floor


Detail → CHANGE TABLE is offered for any started/reserved table with no group check (Detail.jsx:75-76). onMoveTable moves ONE row: moveTableRows/swapTableRows remap tableGroup only on the two touched rows; the other group members keep the stale group. Move group [2,3]'s primary T2 to free T5: destination row gets tableGroup [5,3] (min=3 ≠ its id 5) and T3's row still says [2,3] (min=2 ≠ 3) — NO row satisfies the primary filter id===min(tableGroup), so the card disappears from DisplayBoard, from App's visibleTables, from KitchenBoard's ticket list (three separate copies of the same filter), and FloorView's boardTableOf resolves the tile to the wrong/orphaned row; even the NOT-ON-THIS-MAP rescue banner applies the same primary filter and misses it. Mid-service this deletes the live kitchen ticket while food is cooking. The reservation itself stays consistent (repointReservation remaps table_id+group), which is why invariants I1/I2 don't catch it — and boardInvariants.test.js deliberately restricts move/swap ops to single-table bookings, claiming 'matching the UI', which is false. Bug is direction-dependent: moving primary to an id LOWER than every member accidentally works.


*Evidence:* `src/components/service/Detail.jsx:75-76,166-178; src/App.jsx:4915-4982; src/utils/tableHelpers.js:523-527,553-574; src/components/service/DisplayBoard.jsx:776-777; src/App.jsx:4864-4867; src/components/kitchen/KitchenBoard.jsx:1204,1213,1229; src/components/floor/FloorView.jsx:115-123,291-297; src/__tests__/boardInvariants.test.js:176-196`


*Suggested fix:* Make move/swap group-aware: either block CHANGE TABLE for grouped tables with a clear message, or move the WHOLE group atomically (the tested applyLayoutSwitchToTables in tableHelpers.js:604-657 already implements exactly this mapping — reuse it for single-group moves). Add a multi-member-group op to the boardInvariants suite with a rendered-primary assertion (every non-cleared reservation renders exactly one primary card).


**FLOOR-LIVE-2 · CRITICAL · race-condition** — Sync interleave: moving a party while another device edits the same table erases or strands the edit (order/fire loss, ghost table)


A move is a transfer, but it is written as two independent rows (source→blank, destination→copy) that each merge per-field. Device A moves T3→T7 while device B adds an order to T3 (or the kitchen fires a course on T3). (a) If B's write reached the store first, A's source-blank goes through saveServiceTableWithCas which folds A's blank (mine, differing from ancestor everywhere) against B's ordered row — mine wins per field/seat, so B's order is silently erased server-side; T7 holds the pre-order copy; B then adopts the blank cleanly (local==confirmed). The order/fire never reaches the destination and no device warns. A lost kitchenLog fire mark means the course reads unfired → double-cook risk. (b) If B's edit is still unsaved when A's blank echo arrives, adoptRemoteTables folds them: result is a blank table carrying ONE seat with the full old-party payload — tableHasServiceContent true but no active/resName, so it renders NOWHERE (board filters on active||resName||resTime), the CLEAR TABLE button is gated off (Detail.jsx:180), reconcile refuses to template the next booking onto it (reconcile.js:55 sacrosanct rule), and B's pending autosave propagates the ghost to every device. The safety rails (I4, mass-blank guard) then actively protect the corpse; only CLEAR ALL/END SERVICE heals it. (c) Same fold shape after swapTableRows leaves one seat of party X inside party Y's now-visible table — wrong guest gets X's pairing/extras. No test covers move-vs-edit interleave (appHarnessKitchenFloor only tests the same-party double-seat merge).


*Evidence:* `src/utils/tableHelpers.js:553-562; src/lib/serviceTableCas.js:29-52; src/utils/foldTable.js:17-57; src/App.jsx:1116-1148 (fold+re-queue at 1140), 2975-3022; src/components/service/Detail.jsx:180; src/utils/reconcile.js:55; src/components/service/DisplayBoard.jsx:777; src/__tests__/appHarnessKitchenFloor.test.jsx:184-229`


*Suggested fix:* Model the move as an operation, not two states: stamp the source blank and destination copy with a shared moveId, and teach the CAS/fold path that a source-blank with moveId must REBASE concurrent source edits onto the destination row (or reject the move with retry) instead of folding them into the blank. Minimum viable fix: after fold, if a blanked table still holds seat content but no identity fields, surface it (board card 'GHOST — recover/clear') instead of hiding it.


**FLOOR-LIVE-3 · HIGH · data-integrity** — Move/swap is not atomic across the two board rows and the reservation repoint; failure rollback clobbers interim edits


The board rows ride the debounced autosave (row-by-row on the fallback path), the reservation repoint is a separate persistReservationRows call awaited AFTER setTables. Orderings observable by other devices: source blanked but destination not yet written (party gone remotely; if the moving device dies, the reservation points at a blank T7 and the reconcile templates it fresh — kitchenLog/orders lost); reservation repointed before board rows land (reconcile on another device sees the stale shape — mitigated but only for the seated case by I5). On persist failure the handler restores originalTables/originalReservations snapshots captured at click time — any edit that landed on ANY table during the await window (e.g. a kitchen fire adopted meanwhile) is reverted and the restore re-queues those rows to the store.


*Evidence:* `src/App.jsx:4918-4919 (snapshots), 4957-4978 (await + restore), 763-828 (fallback per-row loop), 848-909 (flush derives rows from current state); src/App.jsx:2975-3022 (autosave debounce)`


*Suggested fix:* Write both board rows and the reservation rows in one transaction on the sqlite-primary path (single writeServiceTables+writeReservations txn) and one PostgREST RPC on the fallback; on failure, roll back only the moved table ids, not whole-board snapshots.


**FLOOR-LIVE-4 · MEDIUM · race-condition** — Floor SET strips are one whole-blob LWW row — concurrent strip writes from two devices erase each other


floor_status_v1 is a single service_settings row replaced wholesale on every toggle. The updater-ref pattern fixes same-device races only; cross-device, FOH setting T5 SET while the kitchen UNSETs T9 (or the strip-follows-courseReady watcher fires) within the sync window means the last writer's blob wins and the other device's strip change silently reverts. The adoption echo-guard compares wall clocks across devices (acknowledged clock-skew hole). Consequence: a hands-ready SET marker disappears, or a phantom SET survives and is bulk-forwarded by SEND SET → KITCHEN (FloorView sendableIds derives from strips).


*Evidence:* `src/App.jsx:3514-3521 (whole-blob save), 3531-3540 (wall-clock echo guard), 2902-2926 (watcher also writes the blob); src/lib/stateStore.js:35-44 (upsert); src/components/floor/FloorView.jsx:310-317`


*Suggested fix:* Store strips per-tile (composite key rows) or merge per-label on write like the board fold; at minimum fold incoming blob with local pending toggles instead of replace.


**FLOOR-LIVE-5 · MEDIUM · race-condition** — reservations.data is whole-blob LWW across devices — terrace-flow transitions and double-assigns race


Terrace transitions rewrite the whole data blob. Cross-device: kitchen assigns a walk-in to terrace while FOH edits/clears the same booking → one write silently overwrites the other (the per-id write queue serializes only one device). Two devices assigning DIFFERENT parties to the same tile while offline both succeed; terraceOccupancy is last-wins per label, so the losing party becomes invisible: not shown on the tile (other party wins occ), not 'stranded' (label exists on the map), excluded from the assign picker (visit_state=terrace), with only the board card's passive ON TERRACE badge remaining; recovery is non-obvious (SEAT the table). Additionally persistVisitData treats failure as fire-and-forget: persistReservationRow resolves {ok:false} so the .catch never fires and the UI shows success on a failed transition (sqlite path has no retry for it).


*Evidence:* `src/App.jsx:1359-1367 (persistVisitData), 994-1012 (queue is per-device); src/utils/floorMaps.js:1022-1029 (last-wins); src/components/floor/FloorView.jsx:281-285 (stranded misses this case), 305-306 (picker excludes); src/utils/terraceFlow.js:51-61`


*Suggested fix:* On adopt, detect two 'terrace' reservations sharing terrace_table and surface a conflict banner (auto-strand the newer one); check ok from persistVisitData and toast failures.


**FLOOR-LIVE-6 · MEDIUM · bug** — SET → KITCHEN overwrites an unconfirmed order-delta alert; the delta is unrecoverable because kitchenSent already advanced


kitchenAlert is a single slot. DisplayBoard's Send writes an alert carrying only the NEW items and immediately advances kitchenSent. If SET → KITCHEN (floor or terrace sheet) runs seconds later — before the kitchen confirms — sendSetToKitchen replaces that alert with a course-only alert (seats: []). The 'what's new' notification is permanently lost: the next Send diffs against the already-advanced kitchenSent, so those items never re-announce. The kitchen ticket still shows the orders, but the line's attention cue for late additions is gone.


*Evidence:* `src/App.jsx:2398-2428 (kitchenAlert overwrite at 2414-2422); src/components/service/DisplayBoard.jsx:713-734 (delta + baseline advance); src/components/kitchen/KitchenBoard.jsx:1326-1334 (single unconfirmed alert per table)`


*Suggested fix:* Merge instead of replace: keep alert.seats from an unconfirmed prior alert when attaching a course banner, or make kitchenAlert a small array drained by the kitchen.


**FLOOR-LIVE-7 · MEDIUM · bug** — SwapPicker still assumes seat ids are 1..n — broken by the chair-identity model the last commit introduced


After a dining-map drag, seat ids are chairs and may be non-contiguous ([1,2,3,5,6] — exactly the shape commit 6dbced2 made durable). The board Detail's SwapPicker enumerates Array.from({length: totalSeats}) → offers P1..P5: it lists a phantom P4 (choosing it renames a real guest to P4, silently changing their kitchen plate position — the very teleport the commit fixed, now re-enterable by hand) and omits the real P6 entirely (that guest can't be swapped from the board). This is the main residual gap from the 'Chair-identity seats survive the sync echo' fix: the persistence layer was fixed but board-side seat pickers weren't audited.


*Evidence:* `src/components/service/SwapPicker.jsx:18; src/components/service/Detail.jsx:365; src/utils/tableHelpers.js:65-97,508-515; commit 6dbced2`


*Suggested fix:* Enumerate actual seat ids: others = table.seats.map(s=>s.id).filter(id=>id!==seatId).


**FLOOR-LIVE-8 · MEDIUM · race-condition** — Residual chair-identity races: concurrent dining drags can duplicate then drop a guest; shrink always drops the highest chair's guest


(a) materializeFloorPositions runs lazily on the dragging device, so two devices dragging the same table concurrently hold different id models (A: [1,2,3,5,6]; B: [1,2,3,4,5] + floorPositions). foldSeats matches by id: the union can yield 6 seats for 5 guests (one guest present under two ids), then sanitizeTable's shrink rule (ex.length>=n → slice off highest ids) drops the chair-6 guest's payload while keeping the duplicate. (b) The shrink rule itself is wrong under chair identity: correcting a 6-pax booking to 5 always deletes the chair-6 guest's orders even when a different guest left (acknowledged as 'existing rule' in code). (c) DisplayBoard's ▲/▼ reorder reimplements the swap by INDEX into current state using render-time indices — an echo re-sorting seats between render and tap swaps the wrong pair, bypassing the tested swapSeatData.


*Evidence:* `src/utils/tableHelpers.js:80-97 (shrink), 457-478; src/utils/foldTable.js:24-43; src/components/service/DisplayBoard.jsx:296-312; src/App.jsx:2380-2387`


*Suggested fix:* (a) materialize on adopt as well (normalize both sides to chair-identity before folding); (b) on shrink, prefer dropping content-empty seats before contentful ones; (c) route the board reorder through swapSeatData.


**FLOOR-LIVE-9 · MEDIUM · bug** — Move/swap does not carry tile-scoped state: SET strip stays on the old tile, chair placements silently reset at the destination


Board move copies seats verbatim, but floorPositions are keyed 'mapId:label' of the OLD tile and floor strips are keyed by tile label. After CHANGE TABLE mid-service: the destination tile shows no SET even though courseReady travelled (waiter can't tell the table was announced — the amber-ring/alreadySent logic still excludes it from SEND, adding confusion); every custom chair placement the waiter arranged reverts to seat-id defaults on the new tile while stale keys linger on the seats (a later party moving onto the old tile can inherit nothing, but the SAME party moving back inherits obsolete chairs). Only tile RENAME has follow-through (renameFloorPositionsKey); moves/swaps have none.


*Evidence:* `src/utils/tableHelpers.js:403-409,553-574,580-592; src/utils/floorMaps.js:946-960; src/App.jsx:2902-2926 (source strip cleared only as a side effect of courseReady vanishing)`


*Suggested fix:* In onMoveTable, remap floorPositions keys and floor strips from the source tile's key to the destination tile's key (both are derivable via resolveReservationTable).


**FLOOR-LIVE-10 · MEDIUM · bug** — Ad-hoc combined bookings on separate tiles: covers double-counted, and kitchen drags edit a row no ticket reads


For a group whose members map to separate tiles (e.g. [4,5] combined in ResvForm on a layout without a merged tile), FloorView resolves BOTH tiles to the primary row → both show occupied with the FULL group pax, and mapTicker sums per tile: a 4-top reads COVERS 8. KitchenFloorView's dining branch never resolves the group at all (tables.find(id===boardIdsOf(t)[0])): the secondary tile shows the secondary row's duplicated full-count seats, and an identity chair-drag there writes seats/restrictions on the SECONDARY row — which the kitchen ticket (rendered from the primary) never reads, so the kitchen's own drag visibly does nothing on the ticket and diverges from FOH (which writes the primary).


*Evidence:* `src/components/floor/FloorView.jsx:115-123,216-226; src/utils/floorMaps.js:1008-1017; src/components/kitchen/KitchenFloorView.jsx:160-176,204-219; src/utils/reconcile.js:88-97 (full guests templated on every member)`


*Suggested fix:* Resolve group primary in KitchenFloorView's dining branch (copy FloorView.boardTableOf), and de-duplicate group members in the ticker (count a group's covers once).


**FLOOR-LIVE-11 · MEDIUM · ux** — 'arriving' is a one-way state with no undo; the terrace tile frees while guests may still be sitting on it


MOVE TO {dining} immediately puts the party in 'arriving' and derives the terrace tile as free (occupancy = visit_state==='terrace'). A mis-tap has no reverse: assignTerrace refuses 'arriving', the party leaves both assign pickers, and the only path is MARK SEATED (falsely stamping the dining table) then TERRACE → re-assign. Meanwhile the freed tile is offered to the next party while the first is physically still outside — a real double-seat window during a busy handover. The auto fire-to-clear (is_last_bite) triggers this transition with no human in the loop, on whichever device observes the fire first.


*Evidence:* `src/utils/terraceFlow.js:51-53,85-92; src/components/floor/FloorView.jsx:305-306; src/App.jsx:1395-1412,2936-2966`


*Suggested fix:* Add an UNDO on the arriving tile/banner (arriving → terrace restoring terrace_table, which is deliberately kept as history in the blob already).


**FLOOR-LIVE-12 · MEDIUM · ux** — Terrace CHANGE TABLE leaves the old tile's SET strip as a phantom SET


assignTerraceTable deliberately preserves SET strips for the ASSIGN case ('set for bites'), but the same function serves re-assign (CHANGE TABLE): the vacated tile keeps its SET strip while reading free, on FOH and kitchen maps alike, until someone finds the free-tile sheet's UNSET escape hatch. During service that's a false 'ready' signal on an un-prepped tile and a wasted trip.


*Evidence:* `src/App.jsx:1369-1376; src/components/floor/FloorView.jsx:399-409 (escape hatch); src/__tests__/floorView.smoke.test.jsx:234-243 (state acknowledged as reachable)`


*Suggested fix:* In assignTerraceTable, when data.terrace_table changes from a previous label, clear the old label's strip (clearTerraceStrip already exists).


**FLOOR-LIVE-13 · MEDIUM · bug** — Session flip hides live terrace parties — tiles read free while lunch guests still occupy them


All terrace occupancy derives from serviceReservations, which is filtered to the ACTIVE session. Flipping lunch→dinner while a lunch party is still visit_state='terrace' removes them from occ: their tile renders free (assignable → physical double-book), their board decoration disappears, and none of the rescue surfaces (stranded banner, pickers) can see them until the session is flipped back. Intersects the owner's Lunch/Dinner-switch concern directly.


*Evidence:* `src/App.jsx:1421-1425; src/utils/floorMaps.js:1022-1029; src/components/floor/FloorView.jsx:175,281-285`


*Suggested fix:* Compute terrace occupancy from ALL of today's reservations with an open visit (visit_state terrace/arriving), not just the active session, or block the session switch while open visits exist.


**FLOOR-LIVE-14 · MEDIUM · race-condition** — moveTableState's occupancy check is local-only — two offline devices can seat/move different parties onto the same table


The destination-occupied refusal reads tablesRef.current; there is no server-side reservation of the slot. Device A (offline) moves party X to free T7 while device B seats walk-in Y on T7. On reconnect the CAS folds the two T7 rows seat-by-seat: interleaved seats/fields of two different parties on one visible table (top-level identity from one, edited seats from the other), which each device's pending autosave then propagates. The harness only tests the SAME-party convergence case.


*Evidence:* `src/App.jsx:1514-1527 (local check), 4920-4926; src/lib/serviceTableCas.js:38-40; src/__tests__/appHarnessKitchenFloor.test.jsx:184-229`


*Suggested fix:* Detect identity conflicts in the fold (both sides changed resName/active vs ancestor) and refuse to merge seats across different identities — keep theirs whole and re-surface mine as a conflict banner.


**FLOOR-LIVE-15 · LOW · ux** — FloorMap has no pointercancel handling — a cancelled drag locks map scrolling and eats the next tap


gestureRef is cleared only in pointerup handlers. On iOS a system-gesture/palm pointercancel mid chair-drag leaves gestureRef set: the non-passive touchmove blocker then preventDefault()s every touch on the SVG (map scroll dead) until another gesture completes, the dragged chair renders stuck at its last position (seatDrag never cleared), and a stale swallowTapRef can consume the next legitimate table tap (silently ignoring a SET toggle mid-rush).


*Evidence:* `src/components/floor/FloorMap.jsx:232-238 (blocker keyed on gestureRef), 216-222 (swallowTapRef), 295-322,377-396 (no onPointerCancel anywhere in the file)`


*Suggested fix:* Add onPointerCancel/lostpointercapture handlers that reset gestureRef, drag states and swallowTapRef.


**FLOOR-LIVE-16 · LOW · ux** — Chair-swap drop targeting uses a fixed 5-map-unit radius — wrong-chair swaps on dense tables renumber kitchen plate positions


The drop resolves to the nearest chair within 5 units of the 100-unit-wide map; adjacent chairs on small/round tables sit ~3 units apart, so a sloppy tablet drop can select the neighbour. On dining maps this is an identity swap: P-numbers and restriction positions renumber and the kitchen plates by the wrong chair. The toast is the only feedback and is easy to miss mid-service; there is no undo other than dragging back.


*Evidence:* `src/components/floor/FloorMap.jsx:313-321; src/components/floor/FloorView.jsx:255-274; src/App.jsx:2380-2387`


*Suggested fix:* Scale the hit radius to the table's chair spacing and highlight the candidate target chair during the drag.


### connectivity (15 findings)


**CONNECTIVITY-1 · CRITICAL · data-integrity** — Queued offline end-of-service uploads WITHOUT the identity guard and wipes a newer live service


finishServicePayload collapses the end-of-service transaction into archive_and_finish_service but passes only workspace + archive fields — never p_expected_started_at / p_expected_date (SupabaseConnector.js:192-198), so the RPC runs its legacy UNCONDITIONAL branch (schema.sql:594 'not guarded'): it blanks service_date and ALL service_tables rows regardless of which service the store currently holds. The local guard in finishServiceLocally (writes.js:244-258) only checks the LOCAL SQLite service_date, which an offline device never updated. Failure scenario: tablet B loses wifi near the end of lunch; the waiter taps Archive & Clear on B (serviceEndSuperseded's pre-check also passes offline — App.jsx:1979 'store unreachable → proceed'); the local guard passes because B's local DB still holds lunch; dinner is then started on tablet A; B reconnects, PowerSync uploads the queued finish, the RPC blanks dinner's entire live board and clears service_date for every device — dinner ends restaurant-wide mid-service. The comment at writes.js:236-239 claims 'the server-side guard…is the backstop' but the primary upload path never invokes it, even though the expected identity is recoverable from the service_settings op's previousValues (trackPrevious is on: AppSchema.js:32).


*Evidence:* `src/powersync/SupabaseConnector.js:163-199,312-321; src/powersync/writes.js:236-274; schema.sql:589-606; src/lib/serviceLifecycleStore.js:39-49 (fallback passes the guard params, connector does not); src/App.jsx:1968-1980`


*Suggested fix:* Derive p_expected_started_at/p_expected_date from the service_settings op's previousValues.state inside finishServicePayload and pass them to the RPC; treat {superseded:true} as success (complete the transaction, discard). Add a connector test for a finish uploaded after the server's service_date moved on.


**CONNECTIVITY-2 · HIGH · data-integrity** — Floor status / floor maps / kitchen order / restaurant config are whole-blob last-write-wins — concurrent edits silently lost


All shared operational settings are single jsonb blobs with zero conflict control at the store: locally serialized latest-wins queues only protect against a device racing ITSELF. Cross-device, the connector uploads PUT→upsert / PATCH→plain UPDATE (SupabaseConnector.js:284-295) and the fallback upserts wholesale (stateStore.js:40-43). Failure scenario (floor_status_v1, both waiters mid-service): waiter A taps SET on terrace table KV at t0; waiter B taps SET on GH at t0+2s before A's blob synced to B; B's blob (containing GH but not KV) lands last → A's SET marker disappears on every device including the kitchen screen, with no error anywhere. Identically for floor_maps_v1: two admins editing the floor-map editor concurrently lose one editor's ENTIRE map set (updateFloorMaps writes the whole sanitized blob — App.jsx:3481-3508). The board rows got CAS+fold precisely because of this bug class; the floor blobs — a stated owner concern — did not.


*Evidence:* `src/lib/stateStore.js:35-44,59-113; src/powersync/SupabaseConnector.js:284-295; src/App.jsx:3481-3522 (whole-blob writers), 3531-3550 (adopt with only a 60s own-echo guard, no merge)`


*Suggested fix:* Split floor_status_v1 into per-map-or-per-label rows (its natural granularity is one strip), or apply the same ancestor-fold + CAS contract the board rows use to these blobs.


**CONNECTIVITY-3 · HIGH · data-integrity** — reservations.data is one LWW jsonb blob — concurrent terrace-flow transitions and edits clobber each other across devices


A reservation's entire operational state (visit_state, terrace_table, tableGroup, restrictions, clearedFromBoard, guest details) lives in one data blob. Upload is a plain UPDATE/upsert of the whole blob (SupabaseConnector.js:284-292; writes.js:107-111 sets data wholesale). The writeQueue serialization (App.jsx:994-1012) only orders ONE device's writes. Failure scenario: waiter A moves a party in from the terrace (visit_state dining, moved_at stamped) while waiter B, seconds behind on sync, edits the same booking's guest count from the planner — B's blob overwrites A's transition: the party reverts to 'terrace' state, the terrace table shows occupied again, the ASSIGN PARTY picker withholds the freed table, and the kitchen ticket state desyncs. No fold exists for reservations anywhere (foldTable is board-only).


*Evidence:* `src/powersync/SupabaseConnector.js:284-292; src/powersync/writes.js:94-121; src/App.jsx:994-1055; src/utils/foldTable.js (board-shape only)`


*Suggested fix:* Give reservation rows the same ancestor-diff merge the board rows have (previousValues is available on the primary path by enabling trackPrevious on reservations), or at minimum CAS on updated_at with a retry-merge for the visit_state/terrace fields.


**CONNECTIVITY-4 · HIGH · data-integrity** — Fallback path durability: all write queues are RAM-only and the live board has no local cache — reload during an outage silently loses edits


On the direct-Supabase fallback (PowerSync outage, init failure, or the 4s boot-deadline path), retained-for-retry values live only in memory: stateStore queues (stateStore.js:59), writeQueue reservations (writeQueue.js:17), and pendingBoardWritesRef (App.jsx:687). The live board itself is persisted to localStorage ONLY in demo mode (App.jsx:2977 writeLocalDemoBoard when !supabase). Failure scenario: wifi drops mid-service on a fallback device; the waiter keeps tapping (fired courses, drinks, floor SETs) — every write is retained-for-retry; the iPad PWA is then killed/reloaded (memory pressure, accidental swipe); ALL unpersisted board edits, reservation transitions and floor strips are gone with no indication; the next server load repaints the pre-outage state. The sqlite-primary path survives this (ps_crud is durable), but the fallback exists precisely for the degraded situations where reloads are most likely.


*Evidence:* `src/lib/writeQueue.js:16-91; src/lib/stateStore.js:59-125; src/App.jsx:687,2975-2977 (board persisted locally only when !supabase), 3626-3670`


*Suggested fix:* Persist the fallback queues and a board snapshot to per-workspace localStorage (the confirmed-baseline fold logic already makes replay-after-reload safe — it is exactly how adoptRemoteTables re-queues divergent rows).


**CONNECTIVITY-5 · HIGH · bug** — A single permanently-failing op on a NEVER_DROP table wedges the device's entire upload queue forever, with no recovery path wired


For service_tables/service_settings/reservations/service_archive, permanent Postgres errors (RLS 42501, constraint 22/23-class, PGRST schema-cache) rethrow instead of skipping (SupabaseConnector.js:328-334), so PowerSync retries the same transaction with backoff forever and every later write queues behind it. Realistic triggers: a service-role device writing any settings id outside its RLS whitelist (schema.sql:892-938 — e.g. course_quick_notes/kitchen_ticket_order via saveStateKey at App.jsx:3384,3391 if reached from a non-admin surface), or a reservation INSERT whose date string Postgres rejects (writeReservationInTransaction accepts any string, writes.js:115-119). The device keeps accepting input, local state looks fine, nothing uploads again; the only signal is streamError in the admin SYSTEM panel. The designed recovery primitive clearLocalAndResync (system.js:95-100) has NO production caller — recovery requires devtools or reinstalling the PWA, and either discards the whole queue.


*Evidence:* `src/powersync/SupabaseConnector.js:82-95,324-346; schema.sql:892-938; src/powersync/system.js:95-100 (grep: only tests/harness reference clearLocalAndResync)`


*Suggested fix:* Distinguish RLS/validation permanents from outage permanents: park unuploadable NEVER_DROP ops in a dead-letter table surfaced in the SYSTEM panel instead of blocking the queue, and wire clearLocalAndResync (with a pending-op count warning) into admin SYSTEM.


**CONNECTIVITY-6 · MEDIUM · data-integrity** — Offline re-edits of manual beverages duplicate the whole category on reconnect; partial upload retry also duplicates inserts


replaceManualBeverages deletes by filter and re-inserts fresh placeholder uuids each save (writes.js:308-323). Two offline saves queue: tx1 inserts placeholders A,B; tx2 deletes those placeholders and inserts A',B'. On upload, tx1's inserts create real server rows (SupabaseConnector.js:264-269 strips the id), but tx2's DELETE ops carry local-only uuid ids and are skipped as permanent (SupabaseConnector.js:236-238) — the server ends with A,B,A',B' and every device shows the category doubled; no local action can remove the ghosts except another online edit. Separately, a transient failure midway through the insert loop retries the WHOLE transaction: already-applied inserts run again (plain .insert, server-generated identity, no conflict target) — duplicates from a single flaky upload.


*Evidence:* `src/powersync/writes.js:308-323; src/powersync/SupabaseConnector.js:232-238,259-270,324-346`


*Suggested fix:* Make beverage rows client-keyed (uuid PK like reservations) so replace-all is expressible as idempotent upserts + real deletes, or route the replace through a single RPC like replace_synced_catalog.


**CONNECTIVITY-7 · MEDIUM · race-condition** — Watch readers are not serialized — overlapping async reads can apply stale board state last


watch.js binds onResult: () => { void run(); } with no in-flight guard or sequence check (watch.js:43-57). Two rapid table-change notifications start two concurrent readServiceTables(); if the first read resolves after the second (SQLite contention during a big checkpoint download), adoptRemoteTables receives the OLDER snapshot last. For tables whose local state matches the confirmed baseline, the stale rows are adopted and the confirmed baseline is moved BACK (App.jsx:1144-1147); the 60s echo guard only protects rows this device itself wrote recently (App.jsx:1111-1115). The board then shows another waiter's tap reverted until the next change re-fires the watch — on a quiet table that can be minutes.


*Evidence:* `src/powersync/watch.js:40-62; src/App.jsx:1101-1151`


*Suggested fix:* Serialize each watch's read-apply pipeline (single-flight with trailing rerun, like flushBoardWrites) or stamp reads with a monotonic sequence and drop out-of-order results.


**CONNECTIVITY-8 · MEDIUM · data-integrity** — Retained writes cross workspaces: queues are keyed without tenant, and workspace is resolved at flush time


stateStore queues key on the settings id alone (stateStore.js:59) and writeStateKeyOnce resolves the workspace when the retry finally fires (stateStore.js:35-44 via scopedFrom/getWorkspaceId, writes.js:30-34). A floor_status_v1 or service_date blob retained during workspace A (offline blip) that flushes after the user switches to workspace B is written INTO B — cross-tenant corruption (B's floor strips replaced by A's; a service_date write could re-open a service in the wrong restaurant). Related: DELETE ops for reservations/beverages/service_archive have no trackPrevious (AppSchema.js:35-45,126-151), so workspaceForOp falls back to the ACTIVE workspace (SupabaseConnector.js:140-146); a delete queued in A and uploaded while B is active matches nothing and is silently lost — the reservation resurrects on every device.


*Evidence:* `src/lib/stateStore.js:35-44,59-113; src/powersync/writes.js:30-34; src/powersync/SupabaseConnector.js:140-146; src/powersync/AppSchema.js:35-45,140-151; src/lib/supabaseClient.js:82-86`


*Suggested fix:* Key the in-memory queues by `${workspaceId}|${id}` and capture the workspace at save() time; enable trackPrevious on reservations/service_archive/beverages so deletes carry their own workspace.


**CONNECTIVITY-9 · MEDIUM · race-condition** — PUT ops upload with a null ancestor and bypass the merge — full overwrite of a concurrent server row; non-collapsed finishes replay unguarded and non-atomically


applyServiceTableWrite passes ancestor = op.previousValues?.data; for an INSERT (PUT) op previousValues is absent, and saveServiceTableWithCas then computes merged = foldTable(null, mine, theirs) which returns `mine` whole (foldTable.js:47) — the CAS commits a total overwrite of whatever another device put in that row. Scenario: two devices each locally create the row for a newly-configured table (or a row deleted-and-recreated while one was offline) — the second uploader erases the first's live seats despite the CAS machinery. Related edge: if the end-of-service batch fails the strict pattern match in finishServicePayload (any DELETE in the same transaction, table_id > 999 [MAX_TABLE_ID is exactly 999], mixed workspaces), it silently degrades to per-op replay — the service_date {} PATCH becomes an unguarded plain UPDATE and the end is no longer atomic on Postgres (the exact half-ended states the collapse exists to prevent).


*Evidence:* `src/powersync/SupabaseConnector.js:206-223,163-199; src/lib/serviceTableCas.js:38; src/utils/foldTable.js:46-47; src/config/restaurantConfig.js:5`


*Suggested fix:* When previousValues is absent, treat the CURRENT server row as the fold input rather than overwriting (fold(current, mine, current) or refuse-and-refetch); log loudly when a finish batch fails the collapse pattern instead of degrading silently.


**CONNECTIVITY-10 · MEDIUM · performance** — Extended-offline reconnect replays every 50ms-debounced autosave transaction as sequential SELECT+RPC round-trips


The autosave queues a write per changed table on a 50ms debounce (App.jsx:3018-3019); each becomes a separate local transaction, and PowerSync uploads transactions one at a time. Every queued service_tables op costs a SELECT of the current row plus the CAS RPC, with up to 4 internal retries (SupabaseConnector.js:206-223, serviceTableCas.js:29-51). A full offline dinner service easily accumulates thousands of transactions; on reconnect the catch-up is a serial stream of thousands of HTTP round-trips over restaurant wifi — minutes of lag during which other devices watch stale intermediate states trickle in, and any transient failure restarts the current transaction. There is no coalescing of successive writes to the same table.


*Evidence:* `src/App.jsx:3011-3019; src/powersync/SupabaseConnector.js:206-223,312-347; src/lib/serviceTableCas.js:29-52`


*Suggested fix:* Lengthen the debounce when the stream is down (writes are already instant locally), or coalesce per-table ops at upload time: for consecutive transactions touching only service_tables, fold them client-side and upload one CAS per table.


**CONNECTIVITY-11 · MEDIUM · data-integrity** — Account switch on a shared tablet silently discards the previous account's un-uploaded queue


clearIfUserChanged calls db.disconnectAndClear() before connect whenever the signed-in Supabase user differs from the last synced one (system.js:23-37) — this drops ps_crud including any writes the previous user queued while offline. Scenario: floor wifi down late in service; waiter logs out (or the manager logs in with their own account on the same tablet) — every un-uploaded tap from the earlier session is deleted without warning or confirmation. The clear is correct for tenant isolation, but it fires without checking for pending CRUD.


*Evidence:* `src/powersync/system.js:23-37; src/__tests__/powersyncSystem.test.js:5-21`


*Suggested fix:* Before clearing, check db for pending CRUD (getNextCrudTransaction / ps_crud count); if non-empty, block the switch with an explicit 'unsynced changes from <user> will be lost' confirmation, or attempt one drain first.


**CONNECTIVITY-12 · MEDIUM · bug** — Fallback realtime DELETE events for wines/beverages/menu_courses never arrive (workspace filter vs PK-only replica identity)


All five fallback channels bind with filter workspace_id=eq.<ws> (App.jsx:4126). Supabase DELETE payloads carry only the replica-identity columns; replica identity full is set ONLY for reservations (schema.sql:639-642). Wines/beverages/menu_courses/service_tables/service_settings DELETE events therefore fail the filter server-side and are never delivered, so the onChange→reload never fires. Scenario (fallback population): admin deletes a wine or an entire menu course; every other fallback device keeps showing it until the socket happens to resubscribe or the app reloads — the 60s board poll does not cover these tables at all (their loads are realtime-driven only, App.jsx:4227-4255).


*Evidence:* `src/App.jsx:4125-4255; schema.sql:639-642; src/hooks/useRealtimeTable.js:42-47`


*Suggested fix:* Set replica identity full on the other published tables (they are already in the powersync publication), or drop the filter and check workspace_id client-side in onChange.


**CONNECTIVITY-13 · LOW · race-condition** — Stale-echo suppression compares local Date.now() against other devices' clock stamps


adoptRemoteTables (App.jsx:1111-1115), adoptFloorStatus/adoptFloorMaps (App.jsx:3533-3545) compare incoming row updated_at (written by another device's clock, or this one's) against this device's Date.now()-based write stamps. An iPad whose clock drifts more than the sync latency causes either suppressed genuine updates (up to the 60s window) or flicker the guard was built to prevent. All updated_at stamps in the system are client clocks (writes.js:75,88,159; App.jsx:869); only the CAS equality check is skew-immune.


*Evidence:* `src/App.jsx:1106-1115,3528-3545; src/powersync/writes.js:73-89`


*Suggested fix:* Bound the suppression by comparing incoming updated_at against the LAST ADOPTED row timestamp per table (monotonic per store row) instead of the local wall clock.


**CONNECTIVITY-14 · LOW · bug** — reviveRow JSON-parses ANY text column that starts with '{' or '[' — type corruption for JSON-looking user text


reads.js reviveRow applies JSON.parse to every string column whose first char is { or [ (reads.js:70-80). A guest name, archive label, or note that is coincidentally valid JSON (e.g. a party entered as '[4]' or '{vip}'... '[4]' parses to an array) changes type on the sqlite-primary read path only — diverging from the fallback path (PostgREST returns text columns as strings) and from what was written, and can render as garbage or crash a .trim()/.toLowerCase() caller.


*Evidence:* `src/powersync/reads.js:66-80 (applied to all columns in readReservations/readServiceTables/readServiceArchive rows)`


*Suggested fix:* Whitelist the actual jsonb columns per table (the connector already has JSON_COLUMNS — reuse it) instead of sniffing every column.


**CONNECTIVITY-15 · LOW · ux** — saveStateKey reports success when no workspace is active; archive-history read bypasses the store seam


saveStateKey returns {ok:true} and writes nothing when getWorkspaceId() is null (stateStore.js:103) — a caller racing workspace application believes its setting persisted (silent drop, no retention, unlike every other failure mode in the same module which retains + retries). Separately, the fire-cadence history loader queries service_archive via scopedFrom directly even when sqlite-primary (App.jsx:4262-4274): an offline-booted primary device silently gets no cadence history although the archive rows are sitting in local SQLite; it is also the kind of direct call the seam-discipline rules exist to prevent.


*Evidence:* `src/lib/stateStore.js:102-113; src/App.jsx:4262-4274; docs/ARCHITECTURE.md:91-96`


*Suggested fix:* Return {ok:false, error:'no workspace'} (or queue keyed by pending-workspace) from saveStateKey; route the history read through the archive seam so it hits readServiceArchive when primary.


### app-architecture (17 findings)


**APP-ARCHITECTURE-1 · HIGH · race-condition** — Session/date picker double-write race can corrupt the shared service identity


ServiceDatePicker's onConfirm calls persistServiceSession(session) synchronously and then awaits persistServiceDate(date). persistServiceSession fires an un-awaited async IIFE that READS the live service_date blob, then re-writes it whole ({...base, session}). persistServiceDate meanwhile writes a fresh blob and ALWAYS mints a new startedAt (App.jsx:2439) even when the date is unchanged. Because the session write's read usually resolves after persistServiceDate's write has been enqueued, its stale base (old date/old startedAt) lands LAST in the stateStore latest-wins queue and clobbers the new identity in the store. Concrete: mid-day the owner taps the READOUT date chip (App.jsx:4744-4746 invites 'Click to change service date / session') to flip lunch→dinner; devices end up holding a startedAt the store no longer carries — every guarded END SERVICE is then refused ('already ended on another device') and the archive's deterministic id can collide with the earlier service, silently dropping the dinner archive (the exact failure class described at App.jsx:2506-2513). Also note the session-only toggle path never ends the lunch service at all: seated lunch tables stay on the board and get archived under the DINNER label at night.


*Evidence:* `App.jsx:4411-4413 (onConfirm ordering), App.jsx:2556-2583 (read-merge-write persistServiceSession), App.jsx:2431-2445 (persistServiceDate mints startedAt), src/lib/stateStore.js:102-113 (latest-wins queue), App.jsx:2506-2513 (consequences of identity mismatch)`


*Suggested fix:* Make service_date writes single-writer: fold session changes into persistServiceDate's payload when both change in one confirm, and have persistServiceSession await/serialize against any in-flight date write (or compute its base from the value just written, not a re-read). Longer term give Lunch→Dinner an explicit switchSession() lifecycle operation that ends+archives the lunch service.


**APP-ARCHITECTURE-2 · HIGH · bug** — Moving or swapping a seated party from the Reservations screen strands live table state


Both upsertReservation's auto-move guard and swapReservations gate the live-board carry-over on `mode === "service" || mode === "display"`. The Reservation Manager runs under mode === "reservation" and is explicitly reachable mid-service (Admin and Service roles). If staff edit a seated party's table there (or use ResvForm's SWAP, which the code comment says is its caller), the reservation repoints but the seats/orders/kitchenLog stay on the old table. The reconcile effect also only runs in service/display modes, so nothing heals until someone re-enters the board — and even then reconcile never touches started tables, leaving the live state orphaned on the old table while the new table templates as reserved: one party appears twice, kitchen progress attached to the wrong table. This is the same defect class as the 04.07 'table switches duplicating one guest' incident the INVARIANTS doc was written for, surviving through a different entry door.


*Evidence:* `App.jsx:2633-2634 (upsertReservation mode gate), App.jsx:1553 (swapReservations mode gate), App.jsx:1544-1545 (comment: called from ResvForm's SWAP), App.jsx:2838-2839 (reconcile gated to service/display), docs/INVARIANTS.md:8-10`


*Suggested fix:* Key the live-state carry on `date === serviceDate` (plus a started-source check) regardless of which mode issued the edit; the mode check adds nothing the date check doesn't already cover. Add a harness scenario driving the move through ReservationManager.


**APP-ARCHITECTURE-3 · HIGH · bug** — menuCoursesDirtyRef is never cleared on leaving Admin — device permanently stops adopting menu updates


The flag's own doc-comment says 'the flag clears on save or when leaving admin', but grep shows it is set true on every editor keystroke (AdminLayout onUpdateMenuCourses) and cleared ONLY inside saveMenuCourses' success paths. There is no clear on mode change anywhere. An admin who types one character in the course editor and exits without saving leaves the flag true for the rest of the session: both the SQLite watch handler and the fallback loader then skip every incoming menu_courses update. Mid-service consequence: another device 86'es a dish (is_active toggle) or fixes a course, and this device's kitchen/service views keep firing from the stale menu all night; the stale-courseReady self-healer also judges against the stale list.


*Evidence:* `App.jsx:343-350 (comment claiming clear-on-leave), App.jsx:4640 (set true), App.jsx:1694,1702,1734 (only clears — all in save paths), App.jsx:3841-3843 and 4098-4100 (adoption suppressed)`


*Suggested fix:* Clear the flag (and re-pull courses) in changeMode/enterMode when leaving admin, or better: give CourseEditorPanel its own draft state so the live menuCourses list is never the edit buffer.


**APP-ARCHITECTURE-4 · MEDIUM · race-condition** — Floor SET/DIRTY markers are one whole-blob LWW row — concurrent taps on two devices lose one


floor_status_v1 is a single settings blob {mapId:{label:status}} rewritten wholesale by updateFloorStatus. The updater-from-ref pattern only fixes same-device races; across devices there is no fold. During a rush, waiter A SETs T1 while waiter B SETs T2 within replication latency: whichever blob lands second was computed without the other's marker, so one SET vanishes (or a DIRTY clear resurrects). The 60s echo window in adoptFloorStatus makes it worse: after B's own write, B rejects incoming blobs older than its write timestamp for 60s, so A's marker may not even paint on B until a full minute later. The board solved exactly this with per-table rows + seat-level folding; the floor never got the same treatment. Same structure applies to floor_maps_v1 (two admins editing the map concurrently lose one edit set).


*Evidence:* `App.jsx:3514-3522 (whole-blob write), App.jsx:3531-3540 (60s echo rejection), App.jsx:3481-3508 (floor maps same pattern), REWORK_NOTES.md:58-60 (fold guarantee exists only for board rows)`


*Suggested fix:* Fold incoming floor blobs against a confirmed ancestor per mapId:label (a 30-line analogue of foldTable), or split markers into per-table settings ids (floor_status_v1:<mapId>:<label>) so the stateStore queues serialize naturally.


**APP-ARCHITECTURE-5 · MEDIUM · race-condition** — Resubscribe/catch-up adoption fabricates 'now' timestamps, letting clock skew suppress real lifecycle events


adoptServiceLifecycle orders events by rowUpdatedAt and permanently records the max in serviceLifecycleTsRef, dropping anything <= it. But the realtime onResubscribe catch-up and the sandbox-exit re-read pass `new Date().toISOString()` (device clock) instead of the row's real updated_at. Scenario: kitchen display's clock runs 45s fast; its socket blips and resubscribes, stamping serviceLifecycleTsRef with fake-now; FOH ends the service 20s later — the end event's server updated_at is older than fake-now, so the adoption is dropped as a 'stale echo' and the kitchen keeps showing a dead service until the next reconnect or reload (precisely the 08.07 'phone showed a dead service all night' class this adoption was built to fix). Floor status/maps adoptions get the same fabricated stamps.


*Evidence:* `App.jsx:2490-2494 (ordering guard), App.jsx:4211-4219 (fabricated timestamps on resubscribe), App.jsx:2172-2174 (sandbox exit), App.jsx:2030 (archive path too)`


*Suggested fix:* Have readStateKey return {state, updated_at} (the fallback select already fetches it in readStatePrefix) and pass the genuine row stamp; treat catch-up reads with unknown stamps as 'compare content, not time'.


**APP-ARCHITECTURE-6 · MEDIUM · data-integrity** — Role enforcement is client-side only; docs contradict each other about the security boundary


roles.js gates which surfaces render, and App re-checks canAccessMode/canAdmin on mode change and in clearAll/saveRestaurantConfiguration — all in the browser. README states 'the role column is retained for future role work but is not enforced during polishing: every explicit workspace member currently has full restaurant owner/admin access', while ARCHITECTURE.md claims 'Supabase Row Level Security is the actual authorization boundary' and that roles are enforced by Postgres policies. If README is current, a Kitchen-role login can issue any admin write (CLEAR ALL board rows, rewrite restaurant config, delete archives) with devtools or a modified client — the canAdmin checks at App.jsx:1852 and 912 are theater. At minimum one of the two documents is wrong, which is itself dangerous for an owner making rollout decisions.


*Evidence:* `README.md:42-44 vs docs/ARCHITECTURE.md:21,77-81; src/auth/roles.js:25-44 (UI-only mode map); App.jsx:1852-1855, 912 (client-side canAdmin guards)`


*Suggested fix:* Verify the actual RLS policies; if role-differentiated policies exist, fix README; if not, add role checks to the write policies for destructive paths (service_archive delete, service_settings restaurant_config, CLEAR ALL) before onboarding non-admin staff logins.


**APP-ARCHITECTURE-7 · MEDIUM · bug** — Detail view crashes if the selected table is removed from configuration by another device


selTable = displayTables.find(t => t.id === sel) can be undefined: nothing clears `sel` when the table set shrinks. adoptRestaurantConfiguration (fired live from watch/realtime when another admin saves the restaurant config) drops retired empty tables via reconcileConfiguredTables. If a waiter has Detail open on such a table (e.g. viewing a just-cleared table the admin retires), App renders <Detail table={undefined}> and Detail.jsx:23 dereferences table.seats -> TypeError -> ErrorBoundary recovery screen mid-service on that tablet.


*Evidence:* `App.jsx:1166 (selTable may be undefined), App.jsx:4895-4896 (passed unguarded), App.jsx:749-755 + src/config/restaurantConfig.js:69-78 (live removal path), src/components/service/Detail.jsx:23 (unguarded deref)`


*Suggested fix:* In App: if (sel != null && !selTable) { setSel(null); } before rendering Detail, or render the board with a toast when selTable is missing.


**APP-ARCHITECTURE-8 · MEDIUM · race-condition** — Stale-device END-SERVICE protection is only proven on the fallback path; sqlite-primary pre-check reads local truth


serviceEndSuperseded reads service_date via readStateKey, which on the sqlite-primary path reads the device's OWN SQLite — a device that slept offline through 'D1 ended, D2 started' sees its stale local copy, passes the pre-check, and finishServiceStore's expected-identity check also runs against local data. Whether the eventual PowerSync UPLOAD of the finish (board blanks + lifecycle clear) is identity-checked server-side is not visible from App, and the harness scenario 'stale END cannot clear a newer service' is explicitly fallback-only — the sqlite-primary variant of the exact wipe class the whole guard system exists for is untested. If the upload applies blindly, a stale tablet reconnecting after tapping END could still blank the new service's rows.


*Evidence:* `App.jsx:1968-1980 (pre-check via readStateKey), src/lib/stateStore.js:23-26 (readStateKey reads local SQLite when primary), src/__tests__/appHarness.test.jsx:566-599 (describe limited to psMode:false), docs/INVARIANTS.md L3 row`


*Suggested fix:* Add the sqlite-primary stale-END scenario to the harness (device offline, remote service replaced, drainUploads after reconnect) and, if it fails, route the finish upload through the identity-checked Postgres function on the connector side.


**APP-ARCHITECTURE-9 · MEDIUM · race-condition** — Fallback multi-row board writes are per-row sequential — group operations can half-commit


On the direct-Supabase path persistBoardRows loops rows one at a time through saveServiceTableWithCas. A grouped operation (seating a combined T2-T3, layout switch moving several tables, CLEAR TABLE on a group) that fails midway leaves the store — and every other device — showing a half-applied group (one table seated, its partner not) until the retry heartbeat converges it. The code recognizes this exact hazard for reservations ('Multi-row reservation operations must commit as one PostgREST statement... can leave both parties assigned to the same table', App.jsx:1034-1036) but the board writer never got the same treatment. The SQLite-primary path is transactional locally, so this only bites during PowerSync outages — exactly when the network is already flaky and partial failures are most likely.


*Evidence:* `App.jsx:778-808 (per-row loop with CAS), App.jsx:1034-1047 (the reservation seam that does batch atomically), App.jsx:896 (failed ids re-queued, confirming partial-failure handling exists rather than atomicity)`


*Suggested fix:* Batch fallback board rows into one upsert when no CAS ancestor conflict is expected, or at minimum write group members in a single PostgREST call and only advance confirmed baselines when the whole group lands.


**APP-ARCHITECTURE-10 · MEDIUM · data-integrity** — Archive snapshots the local render state, not the store — replication-lag edits are missing from the filed record


archiveAndClearAll builds the archive from boardStateRef.current (this device's React state) while persistServiceEnd clears the STORE. Kitchen fires or seat/drink edits made on another device in the last seconds before END — not yet streamed to the ending device — are cleared from the store but absent from the archive: permanently lost, since the clear is flagged intentional and the archive is the only surviving record. Related narrowing: only tables with active/arrivedAt/resName/resTime are archived (App.jsx:2005), so a walk-in party cleared off the board mid-service leaves no archive trace of what they consumed. The archive is also the input to archive insights and fire-cadence history, so gaps compound.


*Evidence:* `App.jsx:1998-2005 (snapshot + filter), App.jsx:2023-2028 (store-side end uses the snapshot), docs/ARCHITECTURE.md:50-60 (archive is the durable record)`


*Suggested fix:* Have finishServiceStore build the archive from the rows it reads inside its own transaction (it already locks and reads the identity), or at least fetchBoardRows() and merge freshest rows into the snapshot before filing — autoEndStaleService already does exactly this (App.jsx:2204).


**APP-ARCHITECTURE-11 · MEDIUM · data-integrity** — Restrictions live in a mutated module array — non-reactive, and its default keys disagree with the dietary key list


setRestrictionsCache splices the admin-edited list into the exported RESTRICTIONS/DIETARY_KEYS arrays so 'importers see the current values without prop drilling'. Two defects: (1) mutation is invisible to React — after an admin edits restrictions, any mounted view keeps rendering old labels/emoji until an unrelated re-render; a service tablet that never re-renders the relevant branch shows stale restriction chips. (2) DEFAULT_DIETARY_KEYS uses keys like gluten_free/dairy_free/nut_free/shellfish_free while DEFAULT_RESTRICTIONS (the list actually used to stamp seats) uses gluten/dairy/nut/shellfish. The cache-set effect only runs when supabase && workspaceId && psResolved (App.jsx:3323), so in local-only mode — and during the boot window before the effect runs — DIETARY_KEYS and RESTRICTIONS disagree about the key vocabulary, so any consumer enumerating via DIETARY_KEYS fails to match seat restrictions stamped from RESTRICTIONS. For an owner whose #3 concern is dietary handling, a silent key-vocabulary drift is exactly the wrong place for fuzziness.


*Evidence:* `src/constants/dietary.js:1-18 vs 20-37 (key mismatch), dietary.js:45-56 (in-place splice), App.jsx:3317-3329 (cache set only under supabase gate), App.jsx:576-579`


*Suggested fix:* Unify the key vocabulary in one source (derive DIETARY_KEYS from DEFAULT_RESTRICTIONS), and replace the splice cache with a context or a useSyncExternalStore-backed module so restriction edits repaint live.


**APP-ARCHITECTURE-12 · MEDIUM · architecture** — The intentional-clear protocol is a single shared one-shot boolean consumed by whichever autosave pass runs first


intentionalBoardClearRef is set by five unrelated flows (CLEAR ALL, layout switch, service end, sandbox start, day switch) and reset unconditionally at the top of every autosave pass ('consumed once per autosave pass', App.jsx:3009) — even a pass with no mass-blank consumes it. Correctness therefore depends on the flagged setTables landing in the very next autosave pass with no interleaved pass from a watch adoption or unrelated edit. Today the synchronous set-flag-then-setTables pattern usually batches correctly, but any future async gap between flagging and blanking (an await inserted before setTables, a second device's adoption re-render) silently converts a legitimate clear into a guard refusal that RESTORES blanked tables while their destinations are already filled — duplicating a party, the exact failure the layout-switch comment describes (App.jsx:1466-1471). This is the highest-leverage fragility for anyone modifying the service switch, archive, or floor flows, since all of them blank multiple tables.


*Evidence:* `App.jsx:703-706 (flag doc), App.jsx:2998-3009 (guard + unconditional consume), App.jsx:1471, 1866, 1931, 2101, 2470 (five setters), docs/INVARIANTS.md L2 ('app-level, no isolated test yet' for the refusal branch)`


*Suggested fix:* Replace the boolean with a set of expected-blank table ids stamped at flag time (like intentionalBoardBlankRef already does for single rows) so consumption is row-scoped and pass-order-independent; add the guard-refusal branch test INVARIANTS.md admits is missing.


**APP-ARCHITECTURE-13 · MEDIUM · performance** — Monolithic render loop with per-render localStorage parsing and whole-board JSON stringification


Every tap re-renders the entire 5,000-line component. Measurable waste on the hot path: (1) readLocalBeverages() runs at the top of App on EVERY render — a JSON.parse of the full beverage catalog per keystroke/tap (App.jsx:322); (2) tablesJson re-stringifies the whole board on every board change and is used as an effect dep, and boardJson (line 1059) is computed but never used anywhere — a dead full-state stringify; (3) the autosave pass re-stringifies every table twice (sanitize+stringify at 2982-2983) and rebuilds the whole Map baseline (3015) per pass; (4) a 60s heartbeat re-render in service mode (485-489) plus every sync-status flip re-renders whichever heavy view is mounted (KitchenBoard is 1,550 lines). On the aging tablets this app targets (the docs repeatedly reference a 720px kitchen panel and old iPads), this is felt as mid-rush sluggishness, and it grows linearly with configured tables (cap now 60, restaurantConfig.js:6).


*Evidence:* `App.jsx:322 (per-render parse), App.jsx:1058-1059 (boardJson dead memo — no other reference in file), App.jsx:2982-2983,3015 (double stringify per pass), App.jsx:485-489 (heartbeat), src/config/restaurantConfig.js:6 (MAX 60 tables)`


*Suggested fix:* Move readLocalBeverages into the useState initializers that already consume it; delete boardJson; memoize sanitized-JSON per table keyed by reference identity. The real fix is the store extraction (see architecture) so views subscribe to slices.


**APP-ARCHITECTURE-14 · MEDIUM · architecture** — Settings adoption/dispatch logic exists in three drifting copies


The id-dispatch for service_settings rows (kitchen_ticket_order, service_date, floor_status_v1, floor_maps_v1, restaurant_config_v1) is duplicated in the PowerSync watch handler, the realtime onChange, and the onResubscribe catch-up, plus a fourth partial copy on sandbox exit. They have already drifted: the resubscribe copy fabricates timestamps (separate finding), and any new shared settings key must be added in three places or one transport silently misses it (the kind of gap that produced the 11.07 'SET markers only synced on reload' incident the comments describe at App.jsx:3524-3527). Similarly ArchiveModal is mounted in three mode branches with inconsistent props — the kitchen copy omits optionalPairings (4590-4591) while the service copy passes it (4996), so the kitchen's archive view silently lacks pairing data.


*Evidence:* `App.jsx:3845-3863 (watch), 4186-4201 (realtime), 4206-4223 (resubscribe), 2172-2175 (sandbox exit), 4491-4501 vs 4588-4600 vs 4993-5005 (three ArchiveModal mounts, kitchen missing optionalPairings)`


*Suggested fix:* Extract one applySettingsRow(id, state, updatedAt) function used by all transports, and mount shared modals once at the App root outside the mode if-chain.


**APP-ARCHITECTURE-15 · LOW · ux** — END SERVICE can hang indefinitely with zero feedback if a board flush wedges


persistServiceEnd spins `while (flushingBoardRef.current) await sleep(50)` with no timeout; the flush's supabase calls have no request timeout, so a dead TCP connection (tablet roams APs mid-END) can hold the flag for minutes. Meanwhile archivingRef.current stays true, so every further END SERVICE tap is silently swallowed (archiveAndClearAll returns at line 1987 with no alert, no spinner). To a waiter this reads as 'END SERVICE is broken', inviting the CLEAR ALL misuse path the confirm dialog warns about.


*Evidence:* `App.jsx:1904-1905 (unbounded wait), App.jsx:1986-1987 (silent re-entry swallow), App.jsx:1594-1596 (only the wine sync ever uses AbortController — board writes have no timeout)`


*Suggested fix:* Bound the wait (e.g. 15s then proceed — the store-side identity check is the real backstop), and show a busy state on the END button while archivingRef is held.


**APP-ARCHITECTURE-16 · LOW · ux** — Blocking native confirm()/alert() dialogs guard every destructive flow


CLEAR TABLE, CLEAR ALL, and Archive & Clear all rely on window.confirm, and error surfaces are window.alert (ten call sites). On iPad standalone PWAs these render as generic browser dialogs that block the whole app, lose the app's visual language for its most dangerous actions, and cannot distinguish severity (CLEAR ALL's carefully-worded warning renders identically to a routine confirm). Test code stubs window.confirm = () => true (appHarness.test.jsx:82), so no test can ever exercise a user declining.


*Evidence:* `App.jsx:1296, 1865, 1988 (confirms), App.jsx:1327, 1489, 2649, 2666, 4975, 1995, 2032, 2036 (alerts), src/__tests__/appHarness.test.jsx:82`


*Suggested fix:* Replace with the existing CenteredModal for destructive confirms (typed confirmation for CLEAR ALL with live tables), which also makes decline paths testable.


**APP-ARCHITECTURE-17 · LOW · bug** — Auto-end archives under a stale session label when the session changed after the effect closed over it


autoEndStaleService reads activeServiceSession from the render closure (not activeServiceSessionRef) for both the archive label and state. The rollover effect's deps are [supabase, serviceDate, serviceDateChosenOn, mode] — a session change alone does not recreate the interval, so an overnight auto-end fired from a tick whose closure predates a lunch→dinner adoption files the archive under the old session label, splitting or mislabeling the day's records that Archive insights and dedup key on.


*Evidence:* `App.jsx:2260, 2268, 2272 (closure reads), App.jsx:4069-4081 (effect deps omit session), App.jsx:665-666 (the ref that exists for exactly this and is unused here)`


*Suggested fix:* Use activeServiceSessionRef.current inside autoEndStaleService, consistent with every other fire-and-forget path in the file.
