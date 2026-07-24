# Reservations V2 — Claude Code Opus handoff

## Non-negotiable boundary

- Work only on `codex/reservations-v2`.
- Do not merge to `main`.
- Do not deploy to the live restaurant Vercel project.
- Do not touch production Supabase project `cvljktjmksfibuyphdln`.
- Staging/LAB Supabase is `yxczzelkajqlpdnvdzed`.
- The isolated Vercel project is `milka-reservations-lab`.
- Do not edit `service_tables`, `service_settings`, floor maps, courses, KDS,
  the service clock, or `powersync/sync-rules.yaml`.
- `reservation_bookings` is the only authoritative reservation source.
- The old `reservations` table is now only a trigger-maintained compatibility
  read model for existing Service/Floor/Kitchen consumers.

## User outcome

Completely replace the old Reservation Manager with the new modern reservation
workspace, while preserving and reconnecting every old reservation function.
The existing Milka Admin gets one Reservations section and no second PIN. The
public `/book` page, staff workspace, calendar, waitlist, guest profiles,
planning/print, Admin, and Service compatibility projection must all use the
same authoritative bookings.

## Completed and committed

1. `fd35771 feat(reservations): expand config and availability domain`
   - Package domain config/availability installed.
   - Lunch is per-weekday and date exceptions override the weekly schedule.
   - Domain suite passed.

2. `169ced3 feat(reservations): add authoritative booking bridge`
   - Additive staging-only schema/function migrations.
   - `operational_data` preserves all restaurant-specific fields.
   - Atomic save/delete/swap RPCs.
   - Trigger projects active bookings into legacy-shaped `reservations`.
   - Scratch rollback and staging SQL E2E passed.

3. `903f78e feat(reservations): route staff writes to booking authority`
   - Staff API and Edge Function write `reservation_bookings`.
   - Compatibility adapter and tests.
   - Atomic reservation Admin configuration RPC.
   - SQL `saveConfig` round-trip verified in staging and audit row confirmed.
   - Domain suite: 43 tests green.

4. `d37f214 feat(reservations): integrate settings into existing admin`
   - Claude Design's revised Reservations Admin panel installed.
   - Registered as one entry in the existing `AdminLayout`.
   - Uses existing Milka session authorization; standalone LAB code still works.
   - No second Reservations PIN in Admin.
   - Build passed; targeted Admin/role/domain tests: 55 green.

## Staging database state

Applied only to `yxczzelkajqlpdnvdzed`:

- `reservation_replacement_schema`
- `reservation_replacement_functions`
- `reservation_replacement_function_hardening`
- `reservation_projection_contact_fields`
- `reservation_admin_atomic_save`

The atomic Admin settings function was also exercised inside a rolled-back
transaction. A durable no-op `saveConfig` verification incremented LAB config
version from 1 to 2 and wrote one audit row with actor
`CODEX STAGING CHECK`; this is harmless test metadata.

## Current uncommitted WIP

Intentionally hand this state forward:

- `src/App.jsx`
  - `?admin=reservations` opens Admin and selects Reservations.
- `src/main.jsx`
- `src/reservations-lab/adminRedirect.js`
  - `/reservations/admin` redirects to `/?admin=reservations`.
- `src/components/reservations/ReservationWorkspace.jsx`
  - Latest Claude Design UI copied in.
  - A thin `ResvForm` compatibility correction was started but is incomplete.
- `src/components/reservations/PublicBookingPage.jsx`
  - Latest Claude Design public UI copied in, not wired yet.

Do not stage these unrelated timestamp/line-ending-only working-tree entries:

- `src/reservations-lab/ReservationsLab.css`
- `src/reservations-lab/ReservationsLabApp.jsx`
- `src/reservations-lab/StaffWorkspace.jsx`

Their content matched `HEAD` before this handoff.

The latest UI package is:

`C:\Users\djanm\Downloads\Restaurant reservation management system.zip`

Last observed: 2026-07-24 23:44:57, 43,504 bytes. It deliberately contains
UI-only files and its `app/DROP-IN.md` is the current design contract.

## First task: finish the ResvForm adapter

`ResvForm.jsx` actually consumes and returns the legacy form shape:

```js
{ id, date, table_id, data: { resName, resTime, guests, service_session, ... } }
```

The new workspace consumes canonical bookings. Use the already-added:

```js
bookingToLegacyReservation
legacyReservationToBooking
```

from `src/domain/reservations/bookingAdapter.js`.

Work already started in the untracked workspace:

- Imports the two adapter functions.
- Converts `initial` and `reservations` passed to `ResvForm`.
- Adapts `onSwapReservations(aId, bId)` to the workspace object form.
- Added a stable notice timer cleanup.

Still required:

- Replace the current `onSave` body with
  `legacyReservationToBooking(draft, existingBookingDefaults)`.
- Change walk-in source from invalid `walkin` to `walk_in`.
- `GuestMemory` takes prop `name`, not `guestName`.
- `ResvForm` ignores `onDelete`; expose delete from the booking record/detail
  with confirmation so old delete parity remains.
- Confirm table IDs convert cleanly between numeric Service IDs and `T01`
  canonical labels.

## Second task: connect the workspace

The new UI expects canonical props and handlers. Add a thin connected container
or make `ReservationWorkspace.jsx` load through
`src/reservations-lab/reservationClient.js` using the current Milka
`accessToken` + `workspaceId`.

Required handlers:

- create/update → `createBooking` / `updateBooking`
- delete → `deleteBooking`
- transition → `transition`
- assign → `assignTables`
- swap → `swapTables`
- waitlist convert/remove

Attach status events from `staffState.events` to each booking so the Record
history is real.

Then change the one lazy import in `App.jsx`:

```js
./components/reservations/ReservationManager.jsx
```

to:

```js
./components/reservations/ReservationWorkspace.jsx
```

Pass the session token/workspace ID and keep existing Service mutation code out
of the reservation component.

## Third task: rewire old reservation write seams

The replacement is incomplete until every old App reservation write lands in
`reservation_bookings`.

Primary seams in `src/App.jsx`:

- `persistReservationRow` around line 1078
- `persistReservationRows` around line 1121
- `upsertReservation` around line 2791
- new insert path around line 2860
- `deleteReservation` around line 2890

Behind `VITE_RESERVATIONS_V2_ENABLED`, route these through staff actions:

- `saveLegacyReservation`
- `saveLegacyReservations`
- `deleteBooking`

Keep existing optimistic/local state behavior. Do not introduce any
reservation call that mutates Service state. The database trigger updates the
old `reservations` projection for existing readers.

## Planning/print parity

Wire the new Planning & Print buttons to the existing unchanged generators:

- `ServiceBreakdown.jsx`
- `weeklyPrintGenerator.js`
- `kitchenTicketGenerator.js`
- existing allergy output

Do not restyle or rewrite those generators.

## Public booking page

Use the new `PublicBookingPage.jsx` as presentation only. Pass:

- `loadPublicConfig`
- `loadPublicAvailability`
- `submitPublicBooking`
- `submitPublicWaitlist`

from `reservationClient.js`.

Wire its named `ManageBooking` export to existing manage/cancel calls. Never
move availability math into the browser.

Check the new component's `testMode` promise: test mode must validate without
writing. If the API does not yet expose that, implement it server-side or keep
the control disabled with honest copy.

## Edge Function and HTTP verification

`supabase/functions/reservations-lab/index.ts` contains the latest code and
parse-checked successfully, but the last deployment attempt via CLI failed
only because no CLI access token was present. Deploy it to staging using the
Supabase connector with `verify_jwt=false`; the function has its own LAB-code
or Milka-session authorization.

After deployment, verify over HTTP:

1. `staffState` using a current Milka session or LAB code.
2. `saveConfig` with identical config plus a distinct audit change.
3. Reload `staffState`; version increments and audit entry appears.
4. Create/edit/assign/swap/delete a disposable booking.
5. Confirm the legacy projection follows each change.

## Verification and delivery

- Run the complete Vitest suite.
- Run `npm run build`.
- Browser-test desktop, tablet, and phone widths.
- Test Admin schedule editing, including lunch only on chosen weekdays.
- Test staff create/edit/table group/swap/cancel/delete.
- Test `/book` → availability → confirmation → manage/cancel.
- Test waitlist fallback.
- Test booking appears in Day Book and compatibility projection.
- Check Supabase security/performance advisors.
- Commit each remaining slice independently.
- Push only `codex/reservations-v2`.
- Deploy only `milka-reservations-lab`.
- Never open or merge a live/main PR.
