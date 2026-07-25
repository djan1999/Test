// Loops 1 and 2, driven end to end over a seeded restaurant.
//
// These are the two connections I could not exercise by hand: they only run
// inside a real service, against a real Supabase. So this harness stands in for
// the service — it seeds a book, projects it onto a board, seats parties, ends
// the service into an archive shaped exactly as src/App.jsx writes one, and
// folds the result back into guest history.
//
// It is the closest thing to switching the flags on that can be run offline,
// and it is written so a failure points at which loop broke rather than just
// "something is wrong".

import { describe, expect, it } from "vitest";
import { buildLabWorld } from "../domain/reservations/labSeed.js";
import { projectBookingsForService } from "../domain/reservations/serviceProjection.js";
import { foldVisitsIntoGuests, guestKeyOf, visitsFromArchive } from "../domain/reservations/guestHistory.js";
import {
  DEFAULT_RESERVATION_CONFIG,
  DEFAULT_WEEKLY_SERVICES,
  normalizeReservationConfig,
  normalizeWeeklyServices,
} from "../domain/reservations/config.js";
import { reservationDescriptiveFields, sanitizeTable } from "../utils/tableHelpers.js";

const TODAY = "2026-07-22"; // a Wednesday — lunch and dinner both served
const config = normalizeReservationConfig(DEFAULT_RESERVATION_CONFIG);
const services = normalizeWeeklyServices(DEFAULT_WEEKLY_SERVICES);

const world = buildLabWorld({ today: TODAY, config, services, pastDays: 45, futureDays: 21 });

const ACTIVE = new Set(["pending", "confirmed", "arrived"]);
const active = world.bookings.filter((booking) => ACTIVE.has(booking.status));

/** The busiest evening still to come — a harness that runs against a night with
 *  two covers in it proves very little. */
const busiestEvening = [...active
  .filter((booking) => booking.service === "dinner")
  .reduce((byDate, booking) => byDate.set(booking.date, (byDate.get(booking.date) || 0) + 1), new Map())]
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];

const SERVICE_DATE = busiestEvening[0];
const tonight = active.filter((booking) => booking.date === SERVICE_DATE && booking.service === "dinner");

/** The board Service would build from a projected row, via the app's own
 *  helper — so the harness cannot pass by inventing a friendlier board. */
function boardTableFor(row) {
  const ids = row.data.tableGroup?.length ? row.data.tableGroup : [row.table_id];
  return sanitizeTable({
    id: ids[0],
    guests: row.data.guests,
    tableGroup: ids.length > 1 ? ids : [],
    ...reservationDescriptiveFields(row.data),
  });
}

describe("Loop 1 end to end", () => {
  it("puts tonight's book on the board in the shape Service reads", () => {
    const { rows, added } = projectBookingsForService([], world.bookings, { from: SERVICE_DATE, to: SERVICE_DATE });
    expect(added).toBe(rows.length);
    expect(rows.length).toBeGreaterThan(0);

    rows.forEach((row) => {
      expect(row).toHaveProperty("date", SERVICE_DATE);
      expect(typeof row.table_id).toBe("number");
      expect(row.data.resName).toBeTruthy();
      expect(row.data.resTime).toMatch(/^\d{2}:\d{2}$/);
      expect(row.data.guests).toBeGreaterThan(0);
      // The board reads table_id as a number and tableGroup as numbers.
      (row.data.tableGroup || []).forEach((id) => expect(typeof id).toBe("number"));
    });
  });

  it("builds a board table from every projected row without losing the party", () => {
    const { rows } = projectBookingsForService([], tonight);
    rows.forEach((row) => {
      const table = boardTableFor(row);
      expect(table.resName).toBe(row.data.resName);
      expect(table.resTime).toBe(row.data.resTime);
      expect(table.seats.length).toBe(row.data.guests);
    });
  });

  // The whole point of Loop 1's design. A party is seated, then the host edits
  // the booking; the edit must reach the board and the seating must survive it.
  it("survives a full evening of seating, moving and editing", () => {
    let rows = projectBookingsForService([], tonight).rows;
    expect(rows.length).toBeGreaterThan(2);

    // 19:00 arrives: the first two parties are seated, one goes to the terrace.
    rows = rows.map((row, index) => {
      if (index === 0) return { ...row, data: { ...row.data, visit_state: "dining" } };
      if (index === 1) {
        return { ...row, data: { ...row.data, visit_state: "terrace", terrace_table: "A3", terrace_map_id: "terrace_a" } };
      }
      return row;
    });
    const seatedIds = [rows[0].id, rows[1].id];

    // The host now renames the first party and adds a note to the second.
    const edited = tonight.map((booking) => (
      booking.id === seatedIds[0]
        ? { ...booking, name: "Renamed, Party" }
        : (booking.id === seatedIds[1] ? { ...booking, notes: "Cake at 21:00" } : booking)
    ));
    const after = projectBookingsForService(rows, edited);

    expect(after.changed).toBe(true);
    const first = after.rows.find((row) => row.id === seatedIds[0]);
    const second = after.rows.find((row) => row.id === seatedIds[1]);
    expect(first.data.resName).toBe("Renamed, Party");
    expect(second.data.notes).toBe("Cake at 21:00");
    // …and the live service is exactly where the floor left it.
    expect(first.data.visit_state).toBe("dining");
    expect(second.data.visit_state).toBe("terrace");
    expect(second.data.terrace_table).toBe("A3");
    expect(second.data.terrace_map_id).toBe("terrace_a");
  });

  it("cannot be made to wipe a seated party by cancelling them", () => {
    const live = projectBookingsForService([], tonight).rows
      .map((row, index) => (index === 0 ? { ...row, data: { ...row.data, visit_state: "dining" } } : row));
    const cancelledEverything = tonight.map((booking) => ({ ...booking, status: "cancelled" }));

    const after = projectBookingsForService(live, cancelledEverything);
    // Only the party who is actually here is left standing.
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].data.visit_state).toBe("dining");
    expect(after.withdrawn).toBe(live.length - 1);
  });

  it("is free to run on every poll of a quiet evening", () => {
    const first = projectBookingsForService([], tonight);
    let rows = first.rows;
    for (let poll = 0; poll < 20; poll += 1) {
      const next = projectBookingsForService(rows, tonight);
      expect(next.changed).toBe(false);
      expect(next.rows).toBe(rows);
      rows = next.rows;
    }
  });
});

describe("Loop 2 end to end", () => {
  /** An archive in exactly the shape src/App.jsx files one: the active tables
   *  at service end, the session, and the shared startedAt stamp. */
  function endService(rows, { arrived, id = "svc-1", date = SERVICE_DATE }) {
    const tables = rows.map((row, index) => {
      const table = boardTableFor(row);
      if (!arrived.includes(index)) return table;
      return {
        ...table,
        active: true,
        arrivedAt: `${date}T${row.data.resTime}:00Z`,
        kitchenLog: { amuse: { firedAt: "19:20" }, fish: { firedAt: "19:55" }, main: { firedAt: "20:35" } },
      };
    });
    return {
      id,
      date,
      label: `${date} – DINNER`,
      state: {
        tables: tables.filter((table) => table.active || table.arrivedAt || table.resName || table.resTime),
        serviceSession: "dinner",
        startedAt: `${date}T17:00:00Z`,
      },
    };
  }

  const rows = projectBookingsForService([], tonight).rows;
  const arrived = [0, 1, 2];
  const archive = endService(rows, { arrived });

  it("records a visit for everyone who sat, and nobody who did not", () => {
    const visits = visitsFromArchive(archive, tonight);
    expect(visits).toHaveLength(arrived.length);
    visits.forEach((visit) => {
      expect(visit.bookingId).toBeTruthy();
      expect(visit.guestKey).toBeTruthy();
      expect(visit.date).toBe(SERVICE_DATE);
      expect(visit.service).toBe("dinner");
      expect(visit.tables.length).toBeGreaterThan(0);
      expect(visit.covers).toBeGreaterThan(0);
      expect(visit.courses.map((course) => course.course)).toEqual(["amuse", "fish", "main"]);
    });
  });

  it("ties each visit back to the booking it came from, through the board", () => {
    const visits = visitsFromArchive(archive, tonight);
    visits.forEach((visit) => {
      const booking = tonight.find((item) => item.id === visit.bookingId);
      expect(booking, "every visit resolves to a real booking").toBeTruthy();
      expect(visit.name).toBe(booking.name);
      expect(visit.time).toBe(booking.time);
      expect(visit.experience).toBe(booking.experience);
    });
  });

  it("writes the evening into guest history, and writes it once", () => {
    const visits = visitsFromArchive(archive, tonight);
    const guests = visits.map((visit) => ({ name_key: visit.guestKey, name: visit.name, visits: [] }));

    const first = foldVisitsIntoGuests(guests, visits);
    expect(first.updated).toBe(visits.length);
    expect(first.skipped).toBe(0);
    first.guests.forEach((guest) => {
      expect(guest.visits).toHaveLength(1);
      expect(guest.visit_count).toBe(1);
      expect(guest.last_visit).toBe(SERVICE_DATE);
    });

    // The service is archived again — a second tablet, or a retry.
    const second = foldVisitsIntoGuests(first.guests, visitsFromArchive(archive, tonight));
    second.guests.forEach((guest) => {
      expect(guest.visits).toHaveLength(1);
      expect(guest.visit_count).toBe(1);
    });
  });

  it("counts a returning guest's second evening as a second visit", () => {
    const visits = visitsFromArchive(archive, tonight);
    const guests = visits.map((visit) => ({ name_key: visit.guestKey, name: visit.name, visits: [] }));
    const july = foldVisitsIntoGuests(guests, visits);

    // The same parties come back a fortnight later — a different service.
    const later = "2026-09-09";
    const laterBookings = tonight.map((booking) => ({ ...booking, id: `${booking.id}-2`, date: later }));
    const laterRows = projectBookingsForService([], laterBookings, { from: later, to: later }).rows;
    const laterVisits = visitsFromArchive(
      endService(laterRows, { arrived, id: "svc-2", date: later }),
      laterBookings,
    );
    const august = foldVisitsIntoGuests(july.guests, laterVisits);

    august.guests.forEach((guest) => {
      expect(guest.visits).toHaveLength(2);
      expect(guest.visit_count).toBe(2);
      expect(guest.last_visit).toBe(later);
      // The two visits are distinguishable, which is the point of having them.
      expect(new Set(guest.visits.map((visit) => visit.serviceInstanceId)).size).toBe(2);
    });
  });

  it("carries a joined party's whole table group into their history", () => {
    // An active one: a completed booking is no longer an expectation, so Loop 1
    // never puts it on a board and there would be nothing to archive.
    const joined = active.find((booking) => booking.operationalData.tableGroup.length > 1);
    expect(joined, "the seeded world must contain a joined party").toBeTruthy();

    const joinedRows = projectBookingsForService([], [joined], { from: joined.date, to: joined.date }).rows;
    const visits = visitsFromArchive(
      endService(joinedRows, { arrived: [0], id: "svc-joined", date: joined.date }),
      [joined],
    );
    expect(visits).toHaveLength(1);
    expect(visits[0].tables.length).toBeGreaterThan(1);
    expect(visits[0].covers).toBe(joined.pax);
  });

  it("says nothing about a service where nobody arrived", () => {
    const emptyNight = endService(rows, { arrived: [] });
    expect(visitsFromArchive(emptyNight, tonight)).toEqual([]);
  });

  it("invents no guest for a walk-in Service typed straight onto the board", () => {
    const walkIn = {
      id: "svc-walkin",
      date: SERVICE_DATE,
      label: `${SERVICE_DATE} – DINNER`,
      state: {
        serviceSession: "dinner",
        startedAt: `${SERVICE_DATE}T17:00:00Z`,
        tables: [sanitizeTable({ id: 9, guests: 2, resName: "Walk-in", resTime: "20:30", active: true, arrivedAt: `${SERVICE_DATE}T20:30:00Z` })],
      },
    };
    const visits = visitsFromArchive(walkIn, tonight);
    expect(visits).toHaveLength(1);
    expect(visits[0].bookingId).toBeNull();

    const { guests, updated, skipped } = foldVisitsIntoGuests([], visits);
    expect(guests).toEqual([]);
    expect(updated).toBe(0);
    expect(skipped).toBe(1);
  });
});

describe("both loops together", () => {
  it("carries a booking from the book, onto the board, and back into history", () => {
    const booking = tonight[0];
    const guestKey = guestKeyOf(booking);

    // 1 — Loop 1 puts it on the board.
    const board = projectBookingsForService([], [booking]).rows;
    expect(board).toHaveLength(1);
    expect(board[0].data.resName).toBe(booking.name);

    // 2 — the party arrives and the kitchen works through the menu.
    const seated = {
      ...boardTableFor(board[0]),
      active: true,
      arrivedAt: `${SERVICE_DATE}T${booking.time}:00Z`,
      kitchenLog: { amuse: { firedAt: "19:15" }, main: { firedAt: "20:20" } },
    };

    // 3 — Loop 2 folds the finished service into the guest's record.
    const visits = visitsFromArchive(
      { id: "svc-round-trip", date: SERVICE_DATE, label: "x", state: { tables: [seated], serviceSession: "dinner", startedAt: `${SERVICE_DATE}T17:00:00Z` } },
      [booking],
    );
    const { guests } = foldVisitsIntoGuests([{ name_key: guestKey, name: booking.name, visits: [] }], visits);

    const [visit] = guests[0].visits;
    expect(visit.bookingId).toBe(booking.id);
    expect(visit.covers).toBe(booking.pax);
    expect(visit.menuType).toBe(booking.operationalData.menuType);
    expect(visit.courses).toHaveLength(2);
    expect(guests[0].visit_count).toBe(1);
  });
});
