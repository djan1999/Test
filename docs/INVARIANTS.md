# Board & Sync Invariants

The rules the service board must never break, each mapped to the test that
enforces it. **Run this list as a checklist against any change touching sync,
the board, or reservations** — if a change can plausibly violate a rule and no
test below would catch it, add the test before merging.

Born out of the 04.07.2026 incidents (live board wiped mid-service by a
stale-dated auto-end; table switches duplicating one guest and hiding
another). Every rule here is one that was actually violated in production or
was one step away from it.

## How to run

```
npm test                      # everything (vitest)
npx vitest run src/__tests__/seamDiscipline.test.js src/__tests__/boardInvariants.test.js
npx vitest run src/__tests__/appHarness.test.jsx   # whole-app scenarios, both storage modes
```

`appHarness.test.jsx` renders the real App against an in-memory two-store
backend (`__tests__/harness/fakeBackend.js` — a fake Supabase and a fake
on-device SQLite with connector mirroring, watch re-fires, sync-down, and
offline switches) and drives join / switch / stale-date / overnight /
offline→reconnect through the actual UI in BOTH storage modes.

## The invariants

### Data-flow discipline

| # | Rule | Enforced by |
|---|------|-------------|
| D1 | Every read/write of workspace data goes through a store seam (`lib/stateStore`, `lib/archiveStore`, `lib/serviceLifecycleStore`, the shared board CAS, reservation seams, or `powersync/writes\|reads`). Direct `scopedFrom(...)` / `supabase.from(...)` calls exist only on a curated allowlist. | `seamDiscipline.test.js` — static scan of `src/`, fails on any new direct call site **and** on stale allowlist entries. Behaviourally re-verified by `appHarness.test.jsx`. |
| D4 | Local-first on SQLite-primary: a write is durable in the on-device DB before any server echo, and the watch tick never reverts it. | `appHarness.test.jsx` (switch + offline scenarios, sqlite-primary mode) |
| D2 | Sync uploads preserve composite keys, JSON/boolean types and workspace aliases. Deployment/schema errors remain queued; deterministic ownership, authorization, data and constraint verdicts are recorded in device diagnostics and completed so one rejected op cannot wedge the queue. | `supabaseConnector.test.js` |
| D3 | Local SQLite writes are UPDATE-then-INSERT so nulls travel via PATCH. | `powersyncWrites.test.js` |

### Board ↔ reservations

| # | Rule | Enforced by |
|---|------|-------------|
| I1 | `table_id ∈ reservationTableIds(data, table_id)` for every reservation — the primary id is always inside its own occupancy set; `tableGroup` never dangles at an old id after a move or swap. | `boardInvariants.test.js` (random sequences over the real `repointReservation` / `moveTableRows` / `swapTableRows`); `tableHelpers.test.js` |
| I2 | Move/swap repoints are bijections: no reservation lost, no two reservations sharing a primary table, occupancy claims disjoint. | `boardInvariants.test.js` |
| I3 | `reconcileTables` is idempotent — a second pass over its own output returns the same array unchanged. | `boardInvariants.test.js` |
| I4 | Live tables are sacrosanct: a table holding staff-entered service content (`tableHasServiceContent`) is never rebuilt, re-templated, or blanked by the reconcile. | `boardInvariants.test.js`; `reconcile.test.js` |
| I5 | No single-booking guest on two tables after a reconcile — even when the board moved and the reservation row is stale (lagging watch / other device). The reconcile trusts the seated board over a lagging reservation. | `boardInvariants.test.js` (random `staleMove` op + directed 04.07 replay); `reconcile.test.js` |
| I6 | A single-member `tableGroup` is never honoured as a group — occupancy falls back to `table_id` (a corrupted group can't mark a phantom table busy). | `tableHelpers.test.js` (`reservationTableIds`) |

### Service lifecycle

| # | Rule | Enforced by |
|---|------|-------------|
| L1 | Auto-end never wipes a LIVE service: if the most recent seated-table activity belongs to the current service day, the service is re-dated forward, not archived. Only a genuinely abandoned board (last touch on a past service day) auto-ends. | `serviceDay.test.js` (`isLiveServiceActivity`); `appHarness.test.jsx` (whole-app stale-date scenario, both storage modes) |
| L2 | Autosave refuses to persist a blank of 2+ previously-contentful tables unless the clear is flagged intentional (CLEAR ALL / Archive&Clear / auto-end / day-switch). | mass-blank guard in App's autosave (`intentionalBoardClearRef`) — **app-level, no isolated test yet** (the harness exercises the flagged-clear path via auto-end, not the guard's refusal branch) |
| L3 | Ending a service changes only that service entity from `live` to `ended`; its namespaced table rows remain intact and become the archive. No blank-row or shared-pointer clear is part of the lifecycle. | `serviceEntity.test.js`; `serviceLifecycle.test.js`; `powersyncWrites.test.js`; `supabaseConnector.test.js`; `appHarness.test.jsx`; drill F in `docs/SERVICE_DRILLS.md` |
| L5 | A second device joining a live service just drops in — never a "start" prompt, never a board rebuild. | `appHarness.test.jsx` (join scenario); `serviceDay.test.js` (`resolveServiceEntry`) |
| L6 | Offline edits are never silently dropped: fallback autosave retries then re-queues for the next flush; SQLite-primary writes land locally and upload after reconnect. | `appHarness.test.jsx` (offline→reconnect scenario, both modes) |
| L7 | An archived service keeps its KITCHEN TIMINGS. Both end paths (manual and the rollover auto-end) file the menu with the entry, and the archive scans read every `kitchenLog` fire even when the menu context is gone — an entry filed without a snapshot, or a course retired/left unordered since that night. | `archiveInsights.test.js` (thin menu context); `appHarness.test.jsx` (rollover files the menu, both modes) |
| L4 | Concurrent edits to different seats of the same table both survive. The upload connector folds against the tracked ancestor and commits with a server compare-and-swap; same-seat edits remain last-write-wins. | `foldTable.test.js`; `supabaseConnector.test.js` |
| L8 | A device only acts on board truth for the EXACT service it has loaded: the reconcile/autosave stay locked until that service's own board read lands (a pre-join or stale-scope read never counts), and the boot splash holds until the live-service picture is server-confirmed. | `appHarness.test.jsx` (un-synced mirror + slow-link join scenarios); `serviceLifecycle.test.js` (blind-start guard); `powerSyncWatch.test.js` (scoped board payload) |
| L9 | The DATABASE refuses a worked-content wipe and records board versions within a bounded window. `private.assert_worked_content_shield` rejects a skeleton over worked content unless the writer's synced ancestor held it (`allow_clear` attestation); since 13.08 the same refusal ALSO runs as a `BEFORE UPDATE` trigger on `service_tables` itself (`private.enforce_worked_content_shield`) — the save RPCs and the Time Machine vouch for each write the assert examined via a transaction-local single-use setting, and every other path (direct client writes, admin tooling, superuser typos) faces the strict rule, so **there is no write path around the shield** (proven by a live assault on production, 13.08: a direct skeleton-over-worked UPDATE as the database's own admin connection was refused 23514). `service_tables_history` is written by a definer trigger no client can skip, and `restore_service_board` rewinds a service's board to any **retained** moment (SYSTEM → Board Time Machine) — fired for real against the 12.08 dinner service inside a rolled-back transaction: all 5 tables rebuilt byte-for-byte to their 18:00 recorded state. **The window is capped by version count, not by age, and can be deliberately emptied:** the same trigger prunes each `(workspace, service, table)` key to its newest **48** versions, but only on a write to that key — a service that has ended and gone quiet keeps its remaining versions indefinitely, since nothing ages out on a schedule. They go away only via guest erasure (which deletes the versions still carrying an erased party) or an Admin service purge (the `service_id` FK cascades that service's whole history away). The invariant is "the database, not the client, decides what a write may destroy, and recent state stays recoverable" — NOT "no board state can ever be lost". | `supabase/tests/board_history.sql` (pgTAP — run with `supabase test db`); `serviceTableCas.test.js` (attestation values, predicate lockstep); the whole vitest suite runs against the shield-emulating fake backend, proving no legitimate flow trips it |
| L10 | The logbook is append-only, database-enforced: clients hold INSERT+SELECT on `service_events`, never UPDATE/DELETE; every fact is device-attributed, idempotent by client-minted id, composite-FK'd to its own workspace's service, and covered by guest erasure + export. Appending is fire-and-forget — a dead log can never affect service. | `supabase/tests/service_events.sql` (pgTAP); `eventLog.test.js`; `kitchenFacts.test.js` |
| L11 | REPLAY PARITY: folding a service's facts (production deriver `boardFactsFromDiff` ∘ production deduper `createFactDeduper` ∘ production reducer `foldServiceEvents`, server order) reproduces the board's comparable projection — every table, seat, drink, and fire, and the party's name and arrival time (full-fidelity: a wiped name is divergence). Every fact is an idempotent aspect-level SET, and the deduper absorbs only a byte-identical repeat of an aspect's latest fact — so correctness never depends on dedup being right, and parity reads paginate to exhaustion so a long night can never be silently truncated. The reducer is total and no-throw: unknown event types, junk payloads and missing tables fold as no-ops, so replaying an append-only log can never crash a device. Parity splits divergence into CONTENT-LOSS (a party/seat present on one side, gone on the other — the wipe signature, must be zero) and CONCURRENT-TIEBREAK (both sides keep a coherent worked seat, only a contended field value differs — benign until the write paths unify); every alarm path (watchdog, end-of-night recorder, CHECK PARITY, archived-night badge) fires on content-loss only. A service with board content but no history is SEEDED from its board (`seedFactsFromBoard`) so the fold can never rebuild it empty — the flip must not be the wipe. The fold applies facts in CAUSAL order — gesture time (`client_ts`) clamped to server arrival (`recorded_at`), tiebroken by arrival id — so a stale fact drained late by a reconnecting device sorts into history instead of clobbering the state that superseded it (verified against production: T7 seat 1 folds to the board's value under causal order, not under arrival order). Adoptions additionally emit RECONCILIATION facts when the store's truth contradicts a fact this device itself recorded, so the log's last word on an aspect converges on the board's answer (`eventFoldAdversarial.test.js` pins the real 10.08 seat-1 case going to zero tiebreaks, and pins that untouched aspects stay silent). The Phase-4 source-of-truth flip this property was built to gate was CANCELLED by owner decision on 12.08.2026 (`docs/EVENT_LOG_PLAN.md`, STATUS close-out) — the property remains load-bearing as the nightly independent audit of the card engine, nothing more. | `eventFold.test.js` (300-seeded-night FULL-pipeline property incl. re-diff noise + resilience + legacy-fact compat); `eventFoldAdversarial.test.js` (dedup transparency over 200 hostile nights ×2 streams, 200 multi-device interleaved nights, cross-device rename-inversion regression, causality-violation detection, 200-round junk fuzzer — the fold and comparator are total functions); `boardFacts.test.js` (aspect-keyed dedup: A→B→A→B inside the window all record; `forgetTable` is surgical); adoption-aware clearing proven to close the cross-device race with the clock frozen (`eventFoldAdversarial.test.js`); live measurement via SYSTEM → Logbook → CHECK PARITY and the mid-service watchdog (every ~6 min, two-sweep confirmation, offline abstention); automatic end-of-night verdicts filed by every service end — `parityRecord.test.js` pins that the recorder can never affect ending a service. Production DB assaulted directly (rolled-back probe, 10.08): client UPDATE/DELETE/actor-spoof all 42501, erasure redacts both name-carrying fact shapes with zero residue |

### Output contracts

| # | Rule | Enforced by |
|---|------|-------------|
| O1 | Kitchen ticket / weekly print / menu generator output shapes are locked. | `generatorSnapshots.test.js` |
| O2 | The six core manual drills cover two-device propagation, offline reconciliation, cold start, catalogue preservation and atomic service ending; the additional outage drill verifies the direct fallback. | `docs/SERVICE_DRILLS.md` — **manual**, never yet run on real tablets; run before the next big cut |

## When you change something

1. Touching move/swap/reconcile/repoint logic → run `boardInvariants.test.js`;
   if you add a new transform, route it through `utils/tableHelpers.js` /
   `utils/reconcile.js` so the invariants exercise the real code, not a copy.
2. Adding any DB call → the seam test will tell you if it bypasses; don't
   silence it by editing the allowlist unless the call is genuinely a seam's
   own fallback branch, and say why in the allowlist comment.
3. Touching auto-end / service date / rollover → `serviceDay.test.js`, and
   check L1–L3 by hand against your change.
4. Anything touching what devices see live → drills A & B on Demo before
   shipping to the restaurant.
