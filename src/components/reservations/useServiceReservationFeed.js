// Loop 1's reader — the one place Service learns about reservation_bookings.
//
// Deliberately small and deliberately dumb: it polls the reservation store for
// the window Service already loads, hands back the bookings, and does nothing
// else. It holds no board state, writes nothing, and cannot fail loudly — if
// the reservation store is unreachable, Service carries on with the legacy
// rows it already has, which is exactly what it did before this loop existed.
//
// It is a POLL, not a subscription, on purpose. A live channel between the
// reservation store and the service board is the coupling the Service Boundary
// Contract exists to prevent; a periodic read cannot put a reservation write
// inside a service transaction.

import { useEffect, useRef, useState } from "react";
import { loadStaffState } from "../../reservations-lab/reservationClient.js";

/** How often to re-read. A reservation taken by telephone should reach the
 *  board within a minute; anything faster is polling the room, not the book. */
const POLL_MS = 60_000;

export function useServiceReservationFeed({ enabled, credentials, from, to }) {
  const [bookings, setBookings] = useState([]);
  const failures = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setBookings((current) => (current.length ? [] : current));
      return undefined;
    }

    let live = true;
    let timer = null;

    const read = async () => {
      try {
        const payload = await loadStaffState(credentials);
        if (!live) return;
        failures.current = 0;
        const rows = (payload?.state?.bookings || []).filter((booking) => (
          Boolean(booking?.date)
          && (!from || booking.date >= from)
          && (!to || booking.date <= to)
        ));
        // Identity matters downstream: the projection bails out on an
        // unchanged list, so an unchanged read must not look like a change.
        setBookings((current) => (
          JSON.stringify(current) === JSON.stringify(rows) ? current : rows
        ));
      } catch {
        // Silent by design. Service must never be interrupted because the
        // reservation store is having a bad minute; the board it already has
        // is still correct, just not newly enriched.
        failures.current += 1;
      } finally {
        if (live) {
          // Back off after repeated failures rather than hammering a store
          // that is plainly down.
          const delay = POLL_MS * Math.min(8, 2 ** Math.min(failures.current, 3));
          timer = window.setTimeout(read, delay);
        }
      }
    };

    read();
    return () => {
      live = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [enabled, credentials, from, to]);

  return bookings;
}

export default useServiceReservationFeed;
