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
```

## The invariants

### Data-flow discipline

| # | Rule | Enforced by |
|---|------|-------------|
| D1 | Every read/write of workspace data goes through a store seam (`lib/stateStore`, `lib/archiveStore`, App's `persistBoardRows` / `persistReservationRow` / `persistArchiveEntry` / `fetchBoardRows`, `powersync/writes\|reads`). Direct `scopedFrom(...)` / `supabase.from(...)` calls exist only on a curated allowlist (seam fallback branches, auth bootstrap). | `seamDiscipline.test.js` — static scan of `src/`, fails on any new direct call site **and** on stale allowlist entries. This is the test that would have caught the PR #44 primary bug (a direct reservation update inside `onMoveTable` that the SQLite watch reverted every tick). |
| D2 | Writes to Supabase from the sync engine replicate the legacy conflict targets exactly (composite keys per table, jsonb parsing, 0/1→boolean, alias mapping); transient errors rethrow, permanent errors complete. | `supabaseConnector.test.js` |
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
| L1 | Auto-end never wipes a LIVE service: if the most recent seated-table activity belongs to the current service day, the service is re-dated forward, not archived. Only a genuinely abandoned board (last touch on a past service day) auto-ends. | `serviceDay.test.js` (`isLiveServiceActivity`) |
| L2 | Autosave refuses to persist a blank of 2+ previously-contentful tables unless the clear is flagged intentional (CLEAR ALL / Archive&Clear / auto-end / day-switch). | mass-blank guard in App's autosave (`intentionalBoardClearRef`) — **app-level, no isolated unit test yet**; covered by the §4-item-5 integration harness when built |
| L3 | Every destructive path archives first — data is recoverable after any wipe. | by construction (`archiveAndClear*`, auto-end archive step); drill E in `docs/SERVICE_DRILLS.md` |
| L4 | Concurrent edits to different seats of the same table both survive (per-seat fold). Same-seat edits are last-write-wins (known limit). | `foldTable.test.js` |

### Output contracts

| # | Rule | Enforced by |
|---|------|-------------|
| O1 | Kitchen ticket / weekly print / menu generator output shapes are locked. | `generatorSnapshots.test.js` |
| O2 | The five manual service drills (two-device propagation, airplane reconcile, offline archive, stale-date open, master fallback) describe the end-to-end contract on real hardware. | `docs/SERVICE_DRILLS.md` — **manual**, never yet run on real tablets; run before the next big cut |

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
