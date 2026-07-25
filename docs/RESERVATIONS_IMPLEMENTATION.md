# Reservations LAB implementation

This implementation lives only on `codex/reservations-v2` and uses:

- Vercel project `milka-reservations-lab`;
- Supabase branch `reservations-v2-staging`;
- workspace slug `milka-reservations-lab`;
- `VITE_DISABLE_POWERSYNC=true`;
- reservation-owned database tables prefixed with `reservation_`.

## Routes

- `/reservations` — staff Day Book, Calendar, Waitlist, Guests and Admin.
- `/reservations/admin` — opens the same isolated workspace.
- `/book` — public, mobile-first guest booking.
- `/book/manage/:token` — hashed-token guest management link.

The existing `/` route and `src/App.jsx` Service orchestration are not used by
these routes. The only shared app entry change is route selection in
`src/main.jsx`. Existing Service, Kitchen, KDS, floor, courses, PowerSync and
`service_settings` code is untouched.

## LAB access

Staff actions require the LAB access code on every request. The Supabase Edge
Function compares its SHA-256 digest to `reservation_lab_auth`; plaintext is
never stored in Postgres. The code is kept in browser session storage after a
successful unlock. Public booking actions do not expose staff data, table
identifiers, capacity rules, other guests or internal notes.

Only fictional guest data may be entered during LAB testing.

## Reservation data boundary

The LAB deliberately uses `reservation_bookings`, not the existing operational
`reservations` table. This prevents a test booking from appearing on the live
Service board even if a future developer accidentally points a Service reader
at the same staging workspace.

### The three connections to Service

The bridge to Service is no longer a single future switch. It is three separate
connections with three different safety profiles, each behind its own flag and
each off by default. Turning one on never requires or affects another; all three
additionally require `VITE_RESERVATIONS_V2_ENABLED`.

**Loop 1 — reservations → Service** (`VITE_RESERVATIONS_LOOP1_ENABLED`).
`src/domain/reservations/serviceProjection.js` projects bookings into the legacy
row shape the board reads. Forward only. A booking with no row is added; a
booking whose row exists has only its *reservation-owned* fields refreshed, with
every service-owned key (`visit_state`, `terrace_table`, `terrace_map_id`,
`moved_at`, `clearedFromBoard`) carried over byte-for-byte. A row Service made
itself is returned untouched. A cancellation withdraws a party from the board
unless they are already on the terrace or dining, in which case the live row
stays — it is the only record that they are here. An unchanged poll returns the
caller's own array by reference, so the board↔reservations reconcile never sees a
change that did not happen.

The reader (`components/reservations/useServiceReservationFeed.js`) is a
once-a-minute poll, deliberately not a subscription: a live channel could put a
reservation write inside the service transaction, which is the coupling this
boundary exists to prevent.

**Loop 2 — Service → guest history** (`VITE_RESERVATIONS_LOOP2_ENABLED`).
`src/domain/reservations/guestHistory.js` reads the archive that has just been
filed and produces one visit per party that actually sat: table, covers, menu,
courses fired, restrictions as they stood at the pass. A table templated and
never used produces nothing — a no-show is not a visit. A joined party is one
visit, not one per table. The fold is idempotent on (party, service instance),
so re-archiving a service replaces its own row rather than giving a guest a
dinner they never ate. It runs after the board is clear, unawaited: guest
history is never worth holding up the end of a service. Stored in
`reservation_guests.visits`; the server action is `recordVisits`.

**Loop 3 — dining room → reservations** (`VITE_RESERVATIONS_LOOP3_ENABLED`).
`src/domain/reservations/tableImport.js` reads the active floor plan **once, on
request**, from Admin › Reservations › Tables. Seats come from the map's own
geometry; a floor merge becomes a joinable *pair*, not a table that only exists
when the room is rearranged; anything it cannot import honestly is skipped and
named. It shows what would change before applying, and applies only to the draft
— the manager still saves. The floor plan is never written, and availability
never reads it.

Guardrails that must survive: reservation writes never touch `service_tables`,
`service_settings`, floor maps, courses or the service clock; Loop 2 runs after
service end, from the archive, and is idempotent; Loop 3 is a copy, never a live
dependency.

## One copy of every rule

Three rule sets were once written twice — in `src/domain/reservations/` for the
app and the Vercel route, and again by hand inside the Supabase edge function.
They had already drifted: the edge copy of the availability engine knew nothing
about joinable tables and read a joined party as holding only its first table,
which would have handed the second to the next booking.

There is now one copy of each, and the edge function imports it:

| Rule set | Source | Entry point |
| --- | --- | --- |
| Availability | `domain/reservations/availability.js` | `availabilityForRequest()` |
| Payload limits | `domain/reservations/validation.js` | `validateBookingPayload()`, `validateWaitlistEntry()` |
| Lifecycle | `domain/reservations/lifecycle.js` | `assertReservationTransition()` |

The Supabase bundler cannot reach `../../src`, so `npm run sync:edge-domain`
copies the domain modules into `supabase/functions/_shared/reservations/`.
`src/__tests__/edgeDomainSync.test.js` fails the suite if the copies drift, so a
rule cannot be changed on one server and not the other.

## What a stranger may write

`/book` and the waitlist are unauthenticated. Every guest-supplied string is
bounded by `domain/reservations/validation.js` — name 120, telephone 40, email
200 and it must look like an address, note 1000, forty dietary entries of 200
characters each. It refuses rather than truncates, and names the field it is
refusing. The public form carries the same numbers as `maxLength` so a guest is
stopped as they type.

The manage link is a random 24-byte token stored only as a SHA-256 hash. It is
also the *only* way to exclude a booking from an availability listing — the
route derives the exclusion from the token and never accepts a raw booking id,
so nobody can free a table they do not hold. Its expiry moves with the booking,
so a guest who changes to a later date keeps their link.

## Filling the LAB, and exercising the loops

An empty Day Book tells you nothing. `npm run sync:edge-domain` aside, the two
things that make this branch testable are:

**Seeding.** `domain/reservations/labSeed.js` builds a restaurant's worth of
fictional service — about three months finished, a full evening today, four
weeks ahead; regulars on their own cadences, a few no-shows, parties of eight on
two tables pushed together. It is deterministic and date-relative, so the same
day always produces the same world (a second run overwrites its own rows rather
than filing a second summer) and seeding in March gives you March.

The button lives in Admin › Reservations › Overview and appears only with
`VITE_RESERVATIONS_LAB_TOOLS_ENABLED=true`. The server refuses regardless unless
`RESERVATIONS_LAB_SEED_ENABLED=true` **and** the workspace slug is
`milka-reservations-lab`, so it cannot reach a real book. Every contact detail
is in a reserved-for-fiction range.

**The loop harness.** Loops 1 and 2 only run inside a real service against a
real Supabase, so `src/__tests__/reservationLoops.integration.test.js` stands in
for one: it seeds a book, projects it onto a board, seats parties, ends the
service into an archive shaped exactly as `src/App.jsx` writes one, and folds
the result back into guest history — including the re-archive that must change
nothing. It is the closest thing to switching the flags on that runs offline.

## Access

The edge function decides whether an action needs staff access from a list of
the actions a **guest** may take; everything else needs staff, including
anything added tomorrow. It used to be the other way round — a list of actions
that needed access — and `recordVisits` shipped outside it and was briefly
callable by anyone. `src/__tests__/edgeAuthGate.test.js` fails if that inverts.

## Current functional scope

- Day Book works for any selected date; Today is a shortcut only.
- List and reservation-timeline views use the same records.
- Calendar opens a selected date in Day Book.
- Lunch and Dinner schedules are independent per weekday.
- Date exceptions support closure, private event, service on/off, online pause,
  changed hours and capacity override.
- Public booking uses the same schedule and availability engine.
- Public waitlist fallback appears when no suitable time is available.
- Staff can create, edit, confirm, arrive, complete, cancel and no-show
  reservations with an append-only status history.
- Guest profiles are built from reservation contact details.
- Admin includes weekly schedules, booking limits, exceptions, privacy and
  audit history.
- Guest manage links use random tokens stored only as SHA-256 hashes.
- The public page says which kind of "no" a closed time is — "no table of the
  right size" rather than a bare "Full" — naming a capacity or a table size,
  never another guest.

Email, SMS, deposits and PowerSync are intentionally not connected in the LAB.
The three Service connections above are implemented but ship dark: every flag
defaults to false, and with all three off no reservation code runs during a
service, exactly as before.
