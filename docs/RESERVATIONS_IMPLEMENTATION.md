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

The future `serviceBridge` remains unimplemented and OFF.

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

Email, SMS, deposits, PowerSync and the Service bridge are intentionally not
connected in the LAB.
