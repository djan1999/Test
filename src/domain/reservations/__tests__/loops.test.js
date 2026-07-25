// The three connections between Reservations and Service (DROP-IN.md).
//
// Each has a different safety profile, and each has one failure that would be
// catastrophic and silent: Loop 1 overwriting a live table, Loop 2 double-
// counting a re-archived service, Loop 3 making availability depend on a floor
// read. The tests below are written around those three, not around the happy
// path.

import { describe, expect, it } from "vitest";
import {
  PROJECTED_STATUSES,
  SERVICE_OWNED_KEYS,
  holdsLiveService,
  projectBookingsForService,
} from "../serviceProjection.js";
import { foldVisitsIntoGuests, guestKeyOf, visitKey, visitsFromArchive } from "../guestHistory.js";
import { boardIdsOfMapTable, labelForBoardId, tablesFromDiningMap } from "../tableImport.js";
import { normalizeReservationConfig } from "../config.js";

const DATE = "2026-07-22";

const booking = (overrides = {}) => ({
  id: "b1",
  date: DATE,
  service: "dinner",
  time: "19:00",
  pax: 4,
  status: "confirmed",
  name: "Zupan, Marko",
  phone: "+386 41 000 000",
  email: "marko@example.com",
  language: "sl",
  source: "web",
  ref: "MK-1",
  tableLabel: "T05",
  experience: "grand_tasting",
  occasion: "",
  notes: "",
  allergies: [],
  accessibility: [],
  consentNews: false,
  operationalData: { tableGroup: ["T05"], restrictions: [], menuType: "long" },
  ...overrides,
});

describe("Loop 1 — reservations project into Service", () => {
  it("adds a booking Service has never seen, in the shape Service reads", () => {
    const { rows, added } = projectBookingsForService([], [booking()]);
    expect(added).toBe(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "b1", date: DATE, table_id: 5 });
    expect(rows[0].data).toMatchObject({
      resName: "Zupan, Marko", resTime: "19:00", guests: 4, service_session: "dinner", tableGroup: [5],
    });
  });

  // The one that matters. A host edits the booking while the party is on the
  // terrace; if the projection wrote the whole row back, the terrace assignment
  // would vanish from every device.
  it("never overwrites a service-owned key on a live row", () => {
    const live = {
      id: "b1",
      date: DATE,
      table_id: 5,
      data: {
        resName: "Zupan, M.",
        visit_state: "terrace",
        terrace_table: "A3",
        terrace_map_id: "terrace_a",
        moved_at: "2026-07-22T19:12:00Z",
      },
    };
    const { rows, refreshed } = projectBookingsForService([live], [booking({ name: "Zupan, Marko" })]);
    expect(refreshed).toBe(1);
    // Reservation-owned field refreshed…
    expect(rows[0].data.resName).toBe("Zupan, Marko");
    // …every service-owned field byte-for-byte.
    SERVICE_OWNED_KEYS.filter((key) => key in live.data).forEach((key) => {
      expect(rows[0].data[key]).toBe(live.data[key]);
    });
  });

  it("does not resurrect a service-owned key the live row never had", () => {
    const live = { id: "b1", date: DATE, table_id: 5, data: { resName: "Zupan" } };
    const { rows } = projectBookingsForService([live], [booking()]);
    expect("visit_state" in rows[0].data).toBe(false);
  });

  it("withdraws a cancelled booking that has not been seated", () => {
    const live = { id: "b1", date: DATE, table_id: 5, data: { resName: "Zupan", visit_state: "booked" } };
    const { rows, withdrawn } = projectBookingsForService([live], [booking({ status: "cancelled" })]);
    expect(withdrawn).toBe(1);
    expect(rows).toHaveLength(0);
  });

  it("keeps a cancelled booking whose party is already dining", () => {
    const live = { id: "b1", date: DATE, table_id: 5, data: { resName: "Zupan", visit_state: "dining" } };
    const { rows, withdrawn } = projectBookingsForService([live], [booking({ status: "cancelled" })]);
    expect(withdrawn).toBe(0);
    expect(rows[0]).toBe(live); // returned untouched, not rebuilt
  });

  it("leaves rows Service created itself completely alone", () => {
    const walkIn = { id: "legacy-1", date: DATE, table_id: 2, data: { resName: "Walk-in" } };
    const { rows } = projectBookingsForService([walkIn], [booking()]);
    expect(rows.find((row) => row.id === "legacy-1")).toBe(walkIn);
  });

  it("ignores bookings outside the window Service loaded", () => {
    const { rows, added } = projectBookingsForService(
      [],
      [booking(), booking({ id: "b2", date: "2027-01-01" })],
      { from: "2026-07-01", to: "2026-07-31" },
    );
    expect(added).toBe(1);
    expect(rows.map((row) => row.id)).toEqual(["b1"]);
  });

  // Re-projecting on every poll must be free. If it rebuilt the list each
  // time, the board↔reservations reconcile would read a change that never
  // happened — and that reconcile is what once wiped a live service.
  it("hands back the very same list when nothing moved", () => {
    const first = projectBookingsForService([], [booking()]);
    const second = projectBookingsForService(first.rows, [booking()]);
    expect(second.changed).toBe(false);
    expect(second.rows).toBe(first.rows);
    expect(second.rows[0]).toBe(first.rows[0]);
  });

  it("reports a change only when a reservation-owned field really moved", () => {
    const first = projectBookingsForService([], [booking()]);
    const renamed = projectBookingsForService(first.rows, [booking({ name: "Zupan, M." })]);
    expect(renamed.changed).toBe(true);
    expect(renamed.refreshed).toBe(1);
    expect(renamed.rows[0].data.resName).toBe("Zupan, M.");
  });

  it("shows only the statuses that are still an expectation", () => {
    expect([...PROJECTED_STATUSES].sort()).toEqual(["arrived", "confirmed", "pending"]);
    expect(holdsLiveService({ data: { clearedFromBoard: true } })).toBe(true);
    expect(holdsLiveService({ data: { visit_state: "booked" } })).toBe(false);
    expect(holdsLiveService({})).toBe(false);
  });
});

describe("Loop 2 — the archive writes guest history", () => {
  const archive = (tables, overrides = {}) => ({
    id: "svc-instance-1",
    date: DATE,
    label: "22.07.2026 – DINNER",
    state: { serviceSession: "dinner", startedAt: "2026-07-22T17:00:00Z", tables, ...overrides },
  });
  const seated = (overrides = {}) => ({
    id: 5,
    active: true,
    arrivedAt: "2026-07-22T19:05:00Z",
    guests: 4,
    resName: "Zupan, Marko",
    resTime: "19:00",
    menuType: "long",
    restrictions: [{ pos: 2, key: "gluten" }],
    kitchenLog: { amuse: { firedAt: "19:20" }, main: { firedAt: "20:10" } },
    tableGroup: [],
    ...overrides,
  });

  it("records what the party was actually served, tied to their booking", () => {
    const [visit] = visitsFromArchive(archive([seated()]), [booking()]);
    expect(visit).toMatchObject({
      bookingId: "b1",
      guestKey: guestKeyOf(booking()),
      date: DATE,
      service: "dinner",
      tables: [5],
      covers: 4,
      menuType: "long",
      experience: "grand_tasting",
      restrictions: ["gluten"],
    });
    expect(visit.courses.map((course) => course.course)).toEqual(["amuse", "main"]);
  });

  it("does not record a table that was templated but never used", () => {
    const noShow = seated({ active: false, arrivedAt: null });
    expect(visitsFromArchive(archive([noShow]), [booking()])).toEqual([]);
  });

  it("counts a joined party once, not once per table", () => {
    const visits = visitsFromArchive(
      archive([seated({ id: 1, tableGroup: [1, 2] }), seated({ id: 2, tableGroup: [1, 2] })]),
      [booking()],
    );
    expect(visits).toHaveLength(1);
    expect(visits[0].tables).toEqual([1, 2]);
  });

  it("matches through a differently punctuated name", () => {
    expect(visitKey("Zupan, Marko", "19:00")).toBe(visitKey("zupan marko", "19:00"));
    const [visit] = visitsFromArchive(archive([seated({ resName: "zupan  marko" })]), [booking()]);
    expect(visit.bookingId).toBe("b1");
  });

  // The idempotency guarantee. Re-archiving the same service must not give the
  // guest a second dinner they never ate.
  it("is idempotent when a service is archived twice", () => {
    const guests = [{ name_key: guestKeyOf(booking()), name: "Zupan, Marko", visits: [] }];
    const first = foldVisitsIntoGuests(guests, visitsFromArchive(archive([seated()]), [booking()]));
    const second = foldVisitsIntoGuests(first.guests, visitsFromArchive(archive([seated()]), [booking()]));

    expect(first.guests[0].visits).toHaveLength(1);
    expect(second.guests[0].visits).toHaveLength(1);
    expect(second.guests[0].visit_count).toBe(1);
    expect(second.guests[0].last_visit).toBe(DATE);
  });

  it("replaces the earlier document when a service is re-archived with more detail", () => {
    const guests = [{ name_key: guestKeyOf(booking()), name: "Zupan, Marko", visits: [] }];
    const first = foldVisitsIntoGuests(guests, visitsFromArchive(archive([seated({ kitchenLog: {} })]), [booking()]));
    expect(first.guests[0].visits[0].courses).toEqual([]);

    const second = foldVisitsIntoGuests(first.guests, visitsFromArchive(archive([seated()]), [booking()]));
    expect(second.guests[0].visits).toHaveLength(1);
    expect(second.guests[0].visits[0].courses).toHaveLength(2);
  });

  it("counts a second, genuinely different service as a second visit", () => {
    const guests = [{ name_key: guestKeyOf(booking()), name: "Zupan, Marko", visits: [] }];
    const july = foldVisitsIntoGuests(guests, visitsFromArchive(archive([seated()]), [booking()]));
    const august = foldVisitsIntoGuests(july.guests, visitsFromArchive(
      { ...archive([seated()]), id: "svc-instance-2", date: "2026-08-01" },
      [booking({ date: "2026-08-01" })],
    ));
    expect(august.guests[0].visits).toHaveLength(2);
    expect(august.guests[0].last_visit).toBe("2026-08-01");
  });

  it("invents no guest for a party it cannot identify", () => {
    const walkIn = visitsFromArchive(archive([seated({ resName: "Walk-in", resTime: "" })]), []);
    const { guests, skipped, updated } = foldVisitsIntoGuests([], walkIn);
    expect(guests).toEqual([]);
    expect(updated).toBe(0);
    expect(skipped).toBe(1);
  });
});

describe("Loop 3 — the dining room is copied into the reservation table list", () => {
  const map = {
    id: "dining_a",
    kind: "dining",
    tables: [
      { label: "T1", seats: [{ no: 1 }, { no: 2 }] },
      { label: "T2", seats: [{ no: 1 }, { no: 2 }] },
      { label: "T3", seats: [{ no: 1 }, { no: 2 }, { no: 3 }, { no: 4 }] },
      { label: "T2-3", members: ["T2", "T3"], seats: [{ no: 1 }] },
      { label: "BAR", seats: [{ no: 1 }] },
      { label: "T9", seats: [] },
    ],
  };

  it("reads seats from the room, not from a guess", () => {
    const { tables } = tablesFromDiningMap(map);
    expect(tables).toEqual([
      { id: "T01", seats: 2 },
      { id: "T02", seats: 2 },
      { id: "T03", seats: 4 },
    ]);
  });

  it("turns a floor merge into a joinable pair, not into a table of its own", () => {
    const { tables, combos } = tablesFromDiningMap(map);
    expect(tables.map((table) => table.id)).not.toContain("T02-03");
    expect(combos).toContainEqual(["T02", "T03"]);
  });

  it("skips what it cannot honestly import, and says why", () => {
    const { skipped } = tablesFromDiningMap(map);
    expect(skipped).toContainEqual({ label: "BAR", reason: "no board slot" });
    expect(skipped).toContainEqual({ label: "T09", reason: "no seats drawn" });
  });

  it("respects a table the restaurant marked as never bookable", () => {
    const current = normalizeReservationConfig({ tables: [], combos: [], tableImport: { excluded: ["T03"] } });
    const { tables, skipped } = tablesFromDiningMap(map, current);
    expect(tables.map((table) => table.id)).toEqual(["T01", "T02"]);
    expect(skipped).toContainEqual({ label: "T03", reason: "marked not bookable" });
  });

  it("drops a join whose table did not survive the import", () => {
    const current = normalizeReservationConfig({ tables: [], combos: [], tableImport: { excluded: ["T03"] } });
    expect(tablesFromDiningMap(map, current).combos).toEqual([]);
  });

  it("names what the restaurant would be agreeing to before anything is saved", () => {
    const current = normalizeReservationConfig({
      tables: [{ id: "T01", seats: 4 }, { id: "T07", seats: 6 }],
      combos: [],
    });
    const { changes } = tablesFromDiningMap(map, current);
    const byLabel = Object.fromEntries(changes.map((change) => [change.label, change]));

    expect(byLabel["T01 seats"]).toMatchObject({ from: "4", to: "2" });
    expect(byLabel["T02 becomes bookable"]).toMatchObject({ to: "2 seats" });
    expect(byLabel["T07 is no longer in the dining room"].warning).toMatch(/Bookings already on this table keep it/);
    expect(byLabel["T02 + T03 can be joined"]).toBeTruthy();
    expect(byLabel["Bookable seats in the room"]).toMatchObject({ from: "10", to: "8" });
    expect(byLabel["Bookable seats in the room"].warning).toMatch(/fewer people/);
  });

  it("reads board slots the way the floor map does", () => {
    expect(labelForBoardId(4)).toBe("T04");
    expect(boardIdsOfMapTable({ label: "T2-3" })).toEqual([2, 3]);
    expect(boardIdsOfMapTable({ label: "T4'", boardIds: [4] })).toEqual([4]);
    expect(boardIdsOfMapTable({ label: "BAR" })).toEqual([]);
  });
});
