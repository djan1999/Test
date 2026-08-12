# The Logbook — event-log migration charter

> ## STATUS (verified against the code on 2026-08-11)
>
> | | |
> |---|---|
> | Live board source of truth | **`service_tables` — the card engine.** Unchanged. |
> | `service_events` | **Dual-written.** Append-only; nothing on a user path awaits it. |
> | Fold (`foldServiceEvents`) | **Diagnostics only** — parity checks, watchdog, Time Machine story view, archived-night reports. It does not render, seed or repair the board. |
> | Phase 4 (the flip) | **NOT DONE.** No cutover has occurred. |
> | Phase-4 deletions (CAS, `foldTable`, echo suppression, mass-blank guard, worked-content shield) | **NOT STARTED — all still live and load-bearing.** |
>
> The ✅ marks below record *delivered pieces of the migration*, not a
> completed migration. Phase 4's own list is explicit that what remains is
> EVIDENCE: three real green nights (zero content-loss) plus the two-week
> soak. Until those land and are recorded here, treat every card-path defence
> as required, and read a green parity badge as "the log agrees", never as
> "the log is now the board".

Decision (Djan, 09.08.2026, after the 08.08 wipe): the target architecture is
an **append-only event log**. Every gesture in the restaurant becomes one
small immutable fact; every screen derives its state by folding the facts.
A wipe becomes *inexpressible* — the log has no operation that means
"replace this table," so the worst any buggy device can do is append a
wrong, visible, attributable, undoable line.

This is a strangler migration, not a rewrite. The card system (service_tables
documents + CAS + folds) keeps running and keeps its defenses — the database
history, the worked-content shield, the write gates — while the log grows
underneath it, domain by domain. At every step the app works exactly as
before; each phase only moves one domain's *source of truth*. Nothing is cut
over until the log has proven itself carrying the same facts in production.

## Principles (the "safe by default" contract)

1. **Append is the only verb.** Clients hold INSERT and SELECT on the log —
   never UPDATE or DELETE. Immutability is enforced by Postgres (grants +
   guard trigger), not by client discipline.
2. **Every event is attributable.** Device id, actor, client timestamp, and a
   server-assigned sequence on every line.
3. **Idempotent by identity.** Events carry a client-minted uuid; replaying an
   offline queue can never double-append (unique index, ignore-duplicates).
4. **The server orders, clients propose.** Fold order is the server sequence
   (`id`), never client clocks.
5. **Facts, not diffs of documents.** An event says what happened in domain
   language (`course_fired`), not which JSON keys changed.
6. **Retention rides the service.** A service's events cascade away with a
   deliberate archive purge, and guest erasure covers event payloads —
   the privacy contract holds in the log exactly as it does in history.
7. **Every fact is an idempotent aspect-level set.** A fact carries the full
   new state of the one aspect it touches (a seat's drink multiset, a
   water choice, a party), never a bare delta — so replaying a fact twice,
   or absorbing a duplicated one, is provably a no-op. Dedup can therefore
   only ever absorb a byte-identical repeat of an aspect's LATEST fact
   (the adopt-fold re-diff signature); any genuine state change on the
   emitting device differs from the latest by definition and always
   records. Correctness never depends on dedup being right.
   The cross-device race this once had (a device re-performing a transition
   identically after ANOTHER device inverted it, found by the multi-device
   property on 10.08) is now closed STRUCTURALLY: on adopting a remote
   change to a table, a device forgets its echo-memory for that table
   (`forgetTable`, called from `adoptRemoteTables`), so the next local
   gesture always records — proven with the clock frozen, where the window
   offers zero protection. Two independent backstops remain by design: the
   10s window absorbs same-device echoes (they arrive in 1–3s), and rename
   facts carry a transition fingerprint (deduper-local, never uploaded).
   Even in the impossible event all three failed, absorption is log-only:
   the board is untouched (the log is not yet the source of truth), the
   watchdog reports it, and any later fact on the aspect heals the log.

## Phases

### Phase 1 — the log exists and records (THIS phase)
- `service_events` table: append-only, RLS'd, idempotent, attributed,
  published to realtime; pgTAP contract for immutability and idempotency.
- Client seam `lib/eventLog.js`: appendServiceEvent with a persisted offline
  queue, drained on heartbeat/online; fire-and-forget, zero impact on the
  card path when the log is unreachable.
- First domain dual-written: **kitchen fires** (`course_fired` /
  `course_unfired`) — derived at the autosave choke point from the same
  per-table diff that queues card writes, so only local gestures emit
  (adoptions bypass that diff by construction).
- SYSTEM panel shows the live service's event count — visible proof of life.
- Exit criteria: a full real service where the kitchen-fire events in the log
  match the night's kitchenLog exactly (SQL check in this doc, below).

### Phase 2 — read paths consume the log where it is already better
- ✅ The Time Machine picker lists moments by events, not by row versions:
  the SYSTEM panel's story view (`describeServiceEvent`) shows the night's
  last moments in sentences, each with a "⟲ TO BEFORE" restore that rewinds
  the whole board to just before that fact (delivered 09.08).
- ✅ The Archive reads the log: every ended service-entity entry offers
  "The night, as written" — the full story in sentences, device-attributed,
  with a parity badge grading the fold against the archived board rows
  (`serviceNightReport`). A pre-logbook night reads "was not recording",
  never falsely red (delivered 09.08). This is the insights-parity
  measure: three green archived nights = the Phase-2/3 read-side exit.
- Archive kitchen timings & cadence aggregation stays snapshot-derived for
  now — switching its source to `course_fired` events is gated on the
  parity badges above running green on real nights.
- No writes change.

### Phase 3 — seats and drinks become events
- Gesture seams (seat/water/pairing/drink add+remove) emit domain events
  alongside card writes. The dual-write diff shrinks as gesture seams take
  over intent capture.
- ✅ The reducer exists and is pinned in CI: `utils/eventFold.js`
  (`foldServiceEvents` + `compareFoldToBoard`) with the REPLAY PARITY
  property test — 150 seeded random nights, production deriver ∘ production
  reducer == final board (delivered 09.08).
- ✅ The same reducer is measurable against reality: the SYSTEM panel's
  CHECK PARITY folds the live service's whole log and compares it with the
  live board, recording any divergence in device diagnostics (delivered
  09.08).
- ✅ Parity distinguishes a WIPE from a SCRIBBLE-FIGHT (10.08): a
  CONTENT-LOSS (a party or worked seat present on one side and gone on the
  other) is the wipe alarm and the real Phase-4 gate; a CONCURRENT-TIEBREAK
  (both sides keep a coherent worked seat, only a contended field value
  differs) is expected until the write paths unify and is reported, not
  alarmed. `compareFoldToBoard` returns `{contentLoss, tiebreaks}`; the
  watchdog, the end-of-night recorder, CHECK PARITY, and the archived-night
  badge all alarm on content-loss only. "Green night" now means "no data
  lost", which is the property the flip actually needs.
- ✅ The evidence collects itself: every service end (manual AND rollover
  auto-end) files an end-of-night parity verdict automatically
  (`lib/parityRecord.js` → settings store, newest-first, capped), shown in
  SYSTEM → Logbook → "End-of-night parity record". Nobody has to remember
  to press the button (delivered 09.08). A red entry means "investigate",
  not "data lost" — another device's undrained fact queue reads as
  divergence until it uploads.
- ✅ THE WATCHDOG: during live service every device silently re-folds the
  whole log every ~6 minutes and compares it with its board. It abstains
  while offline (queued facts would guarantee a false red) and requires
  the SAME tables divergent on two consecutive sweeps before filing a
  "watchdog" entry + diagnostic — once per divergence signature. Detection
  is fully automatic; RECOVERY stays a deliberate human act through the
  Time Machine, because auto-restoring on a false positive would itself
  be a wipe vector (delivered 09.08).
- ✅ Bulletproofing the pipeline (09.08): parity reads paginate to
  exhaustion (a long night can never be silently truncated; a safety-cap
  hit is a recorded diagnostic), the offline queue holds several full
  nights (2000) and records a diagnostic if it ever overflows, and the
  replay-parity property in CI now runs the FULL pipeline — deriver ∘
  deduper (with simulated adopt-fold re-diff noise and a jittered clock)
  ∘ reducer.
- Exit: replaying a service's events through the reducer reproduces the final
  board byte-for-byte — the CI property test PLUS three consecutive green
  end-of-night parity entries from real services, and drills D1–D3 on real
  tablets in the Demo workspace.

### Phase 4 — the fold flips
- Board state on every device = reducer(events), materialized locally;
  service_tables becomes a *derived snapshot* the server maintains for
  export/legacy readers.
- ✅ RECONCILIATION FACTS (10.08) — the first half of write-path
  unification. Root cause of the real divergence: an adoption moves a
  device's baseline straight to the store's truth, so that transition never
  reaches the autosave diff and was never logged ("adoptions advance the
  baselines directly and never reach this diff"). The device's own losing
  value therefore stayed at the tail of the log while the board had already
  settled elsewhere. Now, whenever adopted truth CONTRADICTS a fact this
  device itself recorded (`deduper.contradicts`), the device appends the
  correction — so the log's last word on an aspect is the board's converged
  answer. Aspects this device never touched stay silent (their author owns
  those facts; re-logging them would be noise). Pinned with the real seat-1
  numbers: the tiebreak goes to zero. This also heals the stale-drain case
  (an offline device's late `party_unseated` is corrected once that device
  adopts the re-seated board).
- ✅ CAUSAL ORDERING (10.08) — the second half. Arrival order (`id`) is not
  the order things happened: measured on the real 3-device night, 3 of 104
  facts arrived out of order, worst queue lag 107s. Folded by arrival, an
  hour-old gesture from a reconnecting tablet outranks the state that
  superseded it — the Phase-4 wipe. `orderServiceEvents` now sorts by
  gesture time (`client_ts`), CLAMPED to `recorded_at` so a fast clock
  cannot jump the queue, with arrival order as a stable tiebreak and a
  carry-forward key so unstamped facts keep their position (ordering is
  total and degrades exactly to the old behaviour). Verified against
  PRODUCTION data: table 7 seat 1 — board `XC`, old arrival-order fold
  `XW`, causal-order fold `XC` ✅. The stale-late-drain case flips from
  "detected as divergence" to "ordered correctly, no divergence"; the
  multi-device property (200 nights × 3 devices) now buffers facts and
  lands them with real server-arrival stamps, so arrival order is genuinely
  scrambled and parity still holds.
  This deliberately revises principle 4 FOR THE FOLD: the server still
  assigns identity and breaks ties, but a stale drain must not outrank the
  state that replaced it. The board already trusts client-stamped
  `updated_at` for its own convergence, so the fold now trusts the same
  authority — which is what makes the two agree.
- ✅ THE BOOTSTRAP (10.08) — the prerequisite the data made undeniable. A
  service that began before the logbook (or on an older build) has board
  rows and NO facts, so the fold returns an EMPTY board: measured on real
  data, Hotel Milka's services carry 8, 4 and 4 seated tables against zero
  facts, meaning a flip would itself have wiped them. The first up-to-date
  device that sees a worked board with an empty server-side log now seeds
  the log with the facts that rebuild exactly what is on the board
  (`seedFactsFromBoard`, once per service, skipped when any history
  exists). Pinned over 100 random worked boards — a seeded log folds back
  to its board exactly — plus a concurrent double-seed converging and an
  untouched board seeding nothing.
- ❌ NOT EVIDENCE ONLY — corrected 12.08. Measured against the first real
  full service (183 facts, 5 tables, 3 devices, 7h): the fold rebuilds only
  the fields the taxonomy carries, and a live table row also holds
  `restrictions` (ALLERGIES), `kitchenCourseNotes`, `notes`, `cakeNote`,
  `birthday`, `guestType`, `room`/`rooms`, `lang`, `menuType`, `pace`,
  `resTime`, `tableGroup`, `kitchenSent`, `kitchenAlert`, `kitchenArchived`,
  `courseReady`, `reference`, `source`, and per seat `gender`,
  `floorPositions`, `pairingSharedWith`. Flipping the source of truth in
  that state would DELETE them from a live board — a worse incident than
  the one this migration exists to abolish. A green parity verdict means
  "every field the log carries matches", NOT "the log can rebuild the
  board"; that limit must be stated wherever a green badge is shown.
  THE REAL REMAINING WORK is taxonomy coverage, and it is Phase 3, not
  Phase 4. Delivered 12.08: `table_restrictions_set` (ALLERGIES),
  `table_service_state_set` (courseReady/kitchenSent/kitchenAlert/
  kitchenArchived/pace), `table_notes_set` (notes + kitchenCourseNotes),
  `seat_gender_set`. Parity compares all of them, and a missing
  restriction OR a missing note is CONTENT-LOSS, never a tiebreak —
  staff-typed work and allergy data are exactly what a wipe destroys.
  STILL UNCOVERED, and therefore still blocking the flip: seat
  `floorPositions` and `pairingSharedWith`; and the reservation-derived
  metadata (`resTime`, `guestType`, `room`, `rooms`, `lang`, `menuType`,
  `birthday`, `cakeNote`, `reference`, `source`, `tableGroup`) — for which
  the open design question is whether the fold should carry them at all or
  re-derive them from the reservation row, which is not being replaced.
- Remaining before the flip, AFTER coverage is complete: three real green nights (zero
  content-loss) and the two-week soak in Phase 4's own exit criteria. As of
  10.08 the Demo record holds three green verdicts, but all are small
  (3, 3, 19 facts) and none is a full service; the 104-fact three-device
  night ended without filing (ended from a stale tab). Original diagnosis
  follows.
  When two devices edit the SAME field of the same seat while one is offline,
  the board's compare-and-swap and the log's server-order fold crown
  DIFFERENT winners of the tie (real case: table 7 seat 1 — board kept water
  XC + aperitif "Le Terroir", the fold crowns XW + "So Fresh"). Both keep a
  coherent worked seat — no content is lost — but the two source-of-truth
  candidates disagree, so the fold cannot BE the board until they resolve
  ties identically. This is now measured, not feared: parity splits a
  CONTENT-LOSS (a party/seat that vanished — the wipe, must be zero) from a
  CONCURRENT-TIEBREAK (this case — benign pre-flip). The Phase-4 gate is
  **zero content-loss** across three real nights; tiebreaks are expected and
  will be driven to zero by unifying the write paths (making the board adopt
  the log's canonical server order, or vice versa).
  (Adoption-aware dedup, the other prerequisite this list once named, was
  delivered 10.08 — see principle 7.)
- The CAS, foldTable, echo suppression, mass-blank guard, and the shield
  become dead code and are deleted — each deletion is its own PR with the
  invariant list updated.
- Exit: two full weeks of production on the log with zero shield firings and
  zero divergence reports; then the card write path is removed.

### Phase gates
No phase starts until the previous phase's exit criteria are met **on real
tablets during real service**, and every phase must leave `npm run check`
green and the drills in `docs/SERVICE_DRILLS.md` passing. The database
history + Time Machine stay in force through the entire migration — a rework
mistake can cost at most minutes, never a night.

## Phase 1 verification query (run after a real service)

```sql
-- Fires the log recorded for a service vs. fires the final board holds.
select e.table_id, e.payload->>'courseKey' as course, e.payload->>'firedAt' as fired_at
  from public.service_events e
 where e.service_id = :service_id and e.type = 'course_fired'
 order by e.id;

select t.table_id, k.key as course, k.value->>'firedAt' as fired_at
  from public.service_tables t,
       jsonb_each(t.data->'kitchenLog') k
 where t.service_id = :service_id
 order by t.table_id;
-- Every (table, course) pair in the second result must appear in the first
-- (the first may hold MORE — un-fired then re-fired courses are two facts).
```

## Event taxonomy (grows per phase; Phase 1 in bold)

| domain | events |
|---|---|
| kitchen | **course_fired**, **course_unfired** |
| seating | **party_seated**, **party_unseated**, **party_resized**, **party_renamed**, **party_arrival_set** (a move surfaces as unseated+seated until gesture seams carry `party_moved` intent; a rename carries ONLY the new name, under the erasure-covered `resName` key — the old name lives in the prior seated/renamed fact) |
| dietary | **table_restrictions_set** (snapshot of the table's restrictions; carries `resName` so the existing guest erasure — which matches `payload->>'resName'` and blanks `restrictions` in the same pass — covers it with no new erasure path). A restriction present on one side and gone on the other is classified CONTENT-LOSS, never a tiebreak: it is an allergy that stopped being visible. |
| drinks | **seat_water_set**, **seat_pairing_set**, **seat_drinks_set** (snapshot: the seat's full per-category multiset; `added`/`removed` decorate the story), **table_bottles_set** (same, table-level), **extra_ordered/unordered**, **option_ordered/unordered**. Legacy delta facts `drink_added/removed`, `bottle_added/removed` (recorded 08–09.08) still fold. |
| lifecycle (P3) | already event-shaped in `services`; folded into the same stream at P4 |

Phase 3's WRITE side was pulled forward on 09.08 (bold above): dual-writing
more domains carries the same zero-risk profile as Phase 1 — fire-and-forget,
nothing reads the log — and the fold flip needs full-night coverage anyway.
Phase 2/3 READ cutovers remain gated on the exit criteria.

Parity became FULL-FIDELITY later on 09.08: party_renamed /
party_arrival_set joined the log and the comparison stopped excluding
descriptive fields — a wiped or drifted party name now reads as divergence.
(Erasure symmetry holds: after a guest erasure both the board and the fold
rebuild to "[erased]", so an erased night still compares green.) One
transitional caveat: renames recorded by a pre-09.08 build have no fact, so
the first night spanning the deploy can show an explainable red.
