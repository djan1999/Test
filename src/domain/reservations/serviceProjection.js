// Loop 1 — reservations → Service. One direction, read-only, forward.
//
// Service builds its board from `reservations` rows shaped
// `{ id, date, table_id, data }`. The canonical reservation store is now
// `reservation_bookings`, which Service does not know. This module projects
// bookings into the legacy shape so the board sees them, and — the part that
// matters — states precisely what it will NOT touch.
//
// The rule, from HANDOFF.md §Service Boundary Contract: reservations state the
// expectation; Service owns what actually happens. From the moment a party is
// seated, the live row is Service's. So:
//
//   · a booking with no legacy row is ADDED, projected whole;
//   · a booking whose legacy row already exists has only its RESERVATION-owned
//     fields refreshed — every service-owned key on that row is carried over
//     byte-for-byte, never rewritten, never defaulted;
//   · a legacy row with no booking is returned untouched (pre-v2 rows, walk-ins
//     Service created itself);
//   · a booking that is no longer active is withdrawn from the board, unless
//     its row already holds live service — a cancellation typed at the host
//     stand must not wipe a party that is sitting there eating.
//
// Nothing here writes. It returns a new list; the caller decides what to do
// with it.

import { bookingToLegacyReservation } from "./bookingAdapter.js";

/** Keys on `reservations.data` that belong to the live service, not to the
 *  reservation. Mirrors utils/terraceFlow.js FLOW_KEYS plus the board-clear
 *  flag; a projection must preserve every one of them verbatim. */
export const SERVICE_OWNED_KEYS = [
  "visit_state",
  "terrace_table",
  "terrace_map_id",
  "moved_at",
  "clearedFromBoard",
];

/** Statuses Service should see on the board. A completed, cancelled or
 *  no-show party is not an expectation any more. */
export const PROJECTED_STATUSES = new Set(["pending", "confirmed", "arrived"]);

/** True when the live row has moved past "expected" — the party is on the
 *  terrace, dining, or has been deliberately cleared off the board. Such a row
 *  is Service's and is never withdrawn by a reservation-side change. */
export function holdsLiveService(row) {
  const data = row?.data;
  if (!data || typeof data !== "object") return false;
  if (data.clearedFromBoard) return true;
  const state = String(data.visit_state || "booked");
  return state !== "booked";
}

const sameRow = (a, b) => (
  a.date === b.date
  && a.table_id === b.table_id
  && JSON.stringify(a.data ?? null) === JSON.stringify(b.data ?? null)
);

function serviceOwnedOf(data) {
  const out = {};
  SERVICE_OWNED_KEYS.forEach((key) => {
    if (data && Object.prototype.hasOwnProperty.call(data, key)) out[key] = data[key];
  });
  return out;
}

/**
 * Merge the reservation store's bookings into the list Service reads.
 *
 * @param {Array}  legacyRows  rows exactly as Service loaded them
 * @param {Array}  bookings    reservation_bookings, in the v2 model
 * @param {object} [options]
 * @param {string} [options.from] inclusive ISO date — bookings before it are ignored
 * @param {string} [options.to]   inclusive ISO date — bookings after it are ignored
 * @returns {{ rows: Array, changed: boolean, added: number, refreshed: number, withdrawn: number }}
 */
export function projectBookingsForService(legacyRows, bookings, { from = null, to = null } = {}) {
  const rows = Array.isArray(legacyRows) ? legacyRows : [];
  const inWindow = (booking) => (
    Boolean(booking?.date)
    && (!from || booking.date >= from)
    && (!to || booking.date <= to)
  );
  const byId = new Map(
    (Array.isArray(bookings) ? bookings : [])
      .filter(inWindow)
      .map((booking) => [String(booking.id), booking]),
  );

  let added = 0;
  let refreshed = 0;
  let withdrawn = 0;

  const kept = rows.flatMap((row) => {
    const booking = byId.get(String(row.id));
    if (!booking) return [row]; // Service's own row, or a booking outside the window
    byId.delete(String(row.id));

    if (!PROJECTED_STATUSES.has(booking.status)) {
      // Cancelled at the host stand while the party is already on the terrace:
      // Service keeps the row. It is the only record that they are here.
      if (holdsLiveService(row)) return [row];
      withdrawn += 1;
      return [];
    }

    const projected = bookingToLegacyReservation(booking);
    const next = {
      ...row,
      date: projected.date,
      table_id: projected.table_id,
      data: {
        ...projected.data,
        // Service-owned keys are carried over LAST so nothing in the projection
        // can overwrite them — not even by writing the same value back.
        ...serviceOwnedOf(row.data),
      },
    };
    // An unchanged row is returned BY REFERENCE. React state is compared by
    // identity, and a projection that rebuilt every row on every poll would
    // re-render the whole board — and, worse, look like a change to the
    // board↔reservations reconcile.
    if (sameRow(row, next)) return [row];
    refreshed += 1;
    return [next];
  });

  const fresh = [...byId.values()]
    .filter((booking) => PROJECTED_STATUSES.has(booking.status))
    .map((booking) => {
      added += 1;
      return bookingToLegacyReservation(booking);
    });

  const changed = Boolean(added || refreshed || withdrawn);
  // Nothing moved: hand the caller its own list back, so a state setter can
  // bail out on identity instead of re-rendering.
  return {
    rows: changed ? [...kept, ...fresh] : rows,
    changed,
    added,
    refreshed,
    withdrawn,
  };
}
