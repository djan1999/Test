# The Logbook — event-log migration charter

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
- Archive kitchen timings & cadence insights read from `course_fired` events
  (today they re-derive from kitchenLog snapshots).
- The Time Machine picker lists moments by events, not by row versions.
- No writes change. Exit: insights parity for three services.

### Phase 3 — seats and drinks become events
- Gesture seams (seat/water/pairing/drink add+remove) emit domain events
  alongside card writes. The dual-write diff shrinks as gesture seams take
  over intent capture.
- Exit: replaying a service's events through the reducer reproduces the final
  board byte-for-byte (automated nightly comparison, and drills D1–D3 on real
  tablets in the Demo workspace).

### Phase 4 — the fold flips
- Board state on every device = reducer(events), materialized locally;
  service_tables becomes a *derived snapshot* the server maintains for
  export/legacy readers.
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
| seating (P3) | party_seated, party_unseated, party_moved, table_cleared |
| drinks (P3) | seat_water_set, seat_pairing_set, drink_added, drink_removed, bottle_added |
| lifecycle (P3) | already event-shaped in `services`; folded into the same stream at P4 |
