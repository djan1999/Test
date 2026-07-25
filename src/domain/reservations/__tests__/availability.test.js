// Tests for table suggestion, swapping and the reasons a time is unavailable.

import { describe, expect, it } from "vitest";
import { normalizeReservationConfig, normalizeWeeklyServices } from "../config.js";
import {
  UNAVAILABLE_REASONS,
  evaluateAvailability,
  suggestTables,
  swapCandidates,
  walkInsAllowed,
} from "../availability.js";

const TUESDAY = "2026-07-21";
const SATURDAY = "2026-07-25";

const config = normalizeReservationConfig({
  tables: [
    { id: "T01", seats: 2 },
    { id: "T02", seats: 2 },
    { id: "T05", seats: 4 },
  ],
  combos: [["T01", "T02"]],
  pacing: { coversPerSlot: 8, coversPerService: 20 },
  durations: { small: 120, medium: 150, large: 180, buffer: 15 },
  online: { maxPax: 6, minPax: 1, leadMinutes: 30 },
});

const booking = (id, time, pax, tables, status = "confirmed") => ({
  id, date: TUESDAY, time, pax, status, service: "dinner",
  tableLabel: tables[0], tableGroup: tables.length > 1 ? tables : undefined,
});

describe("suggestTables", () => {
  it("takes the smallest table that fits rather than the first that fits", () => {
    expect(suggestTables({ date: TUESDAY, time: "19:00", pax: 2, bookings: [], config }))
      .toEqual({ tables: ["T01"], combined: false });
  });

  it("falls back to a configured joinable pair when no single table fits", () => {
    const result = suggestTables({ date: TUESDAY, time: "19:00", pax: 4, bookings: [booking("a", "19:00", 4, ["T05"])], config });
    expect(result).toEqual({ tables: ["T01", "T02"], combined: true });
  });

  it("will not join tables that are not configured as a pair", () => {
    const narrow = normalizeReservationConfig({ ...config, combos: [] });
    expect(suggestTables({ date: TUESDAY, time: "19:00", pax: 4, bookings: [booking("a", "19:00", 4, ["T05"])], config: narrow }))
      .toBeNull();
  });

  it("treats every table of a combined party as occupied", () => {
    const bookings = [booking("a", "19:00", 4, ["T01", "T02"])];
    expect(suggestTables({ date: TUESDAY, time: "19:00", pax: 2, bookings, config }))
      .toEqual({ tables: ["T05"], combined: false });
  });

  it("frees a table again once the turn plus reset time has passed", () => {
    const bookings = [booking("a", "18:00", 2, ["T01"])]; // 120 + 15 → free from 20:15
    expect(suggestTables({ date: TUESDAY, time: "20:15", pax: 2, bookings, config }).tables).toContain("T01");
    expect(suggestTables({ date: TUESDAY, time: "20:00", pax: 2, bookings, config }).tables).not.toContain("T01");
  });

  it("ignores cancelled and no-show bookings", () => {
    const bookings = [booking("a", "19:00", 2, ["T01"], "cancelled"), booking("b", "19:00", 2, ["T02"], "no_show")];
    expect(suggestTables({ date: TUESDAY, time: "19:00", pax: 2, bookings, config }).tables).toEqual(["T01"]);
  });

  it("ignores the reservation being edited", () => {
    const bookings = [booking("a", "19:00", 2, ["T01"])];
    expect(suggestTables({ date: TUESDAY, time: "19:00", pax: 2, bookings, config, excludeId: "a" }).tables).toEqual(["T01"]);
  });
});

describe("swapCandidates", () => {
  const bookings = [booking("a", "19:00", 2, ["T01"]), booking("b", "19:00", 4, ["T05"])];

  it("marks a free table free and names the party holding a busy one", () => {
    const rows = swapCandidates({ date: TUESDAY, time: "19:00", pax: 2, bookings, config, reservationId: "a" });
    const byTable = Object.fromEntries(rows.map((row) => [row.table, row]));
    expect(byTable.T02.free).toBe(true);
    expect(byTable.T02.occupant).toBeNull();
    expect(byTable.T05.free).toBe(false);
    expect(byTable.T05.occupant.id).toBe("b");
  });

  it("does not report the edited reservation as its own occupant", () => {
    const rows = swapCandidates({ date: TUESDAY, time: "19:00", pax: 2, bookings, config, reservationId: "a" });
    expect(rows.find((row) => row.table === "T01").occupant).toBeNull();
  });

  it("omits tables too small for the party", () => {
    const rows = swapCandidates({ date: TUESDAY, time: "19:00", pax: 4, bookings, config, reservationId: "b" });
    expect(rows.map((row) => row.table)).toEqual(["T05"]);
  });
});

describe("evaluateAvailability reasons", () => {
  const services = normalizeWeeklyServices([
    { service: "dinner", weekday: 2, enabled: true, first: "18:00", last: "19:00", interval: 30, onlineEnabled: true },
    { service: "dinner", weekday: 6, enabled: true, first: "18:00", last: "18:30", interval: 30, minPax: 4, walkInsEnabled: false },
  ]);
  const evaluate = (extra) => evaluateAvailability({ date: TUESDAY, pax: 2, services, bookings: [], config, ...extra })[0];

  it("every reason has guest-facing wording", () => {
    Object.keys(UNAVAILABLE_REASONS).forEach((key) => {
      expect(typeof UNAVAILABLE_REASONS[key]).toBe("string");
      expect(UNAVAILABLE_REASONS[key].length).toBeGreaterThan(8);
    });
  });

  it("offers the whole service when the day is empty", () => {
    expect(evaluate().slots.every((slot) => slot.ok)).toBe(true);
  });

  it("refuses a sitting that would pass the per-sitting cap, but not the rest", () => {
    const bookings = [booking("a", "18:00", 7, ["T05"])];
    const slots = Object.fromEntries(evaluate({ bookings }).slots.map((slot) => [slot.time, slot]));
    expect(slots["18:00"].reason).toBe("sitting_full");
    expect(slots["19:00"].ok).toBe(true);
  });

  it("refuses the whole service past the service cap", () => {
    const bookings = [booking("a", "18:00", 8, ["T05"]), booking("b", "18:30", 8, ["T01"]), booking("c", "19:00", 4, ["T02"])];
    expect(evaluate({ bookings }).slots.every((slot) => slot.reason === "service_full")).toBe(true);
  });

  it("honours a date capacity override ahead of the standing cap", () => {
    const result = evaluateAvailability({
      date: TUESDAY, pax: 4, services, bookings: [booking("a", "18:00", 2, ["T01"])], config,
      exceptions: [{ date: TUESDAY, kind: "capacity_override", capacity: 4 }],
    })[0];
    expect(result.slots.every((slot) => slot.reason === "day_full")).toBe(true);
  });

  it("applies the lead time only to today", () => {
    const today = evaluate({ isToday: true, nowMinutes: 18 * 60 });
    expect(today.slots.find((slot) => slot.time === "18:00").reason).toBe("too_late");
    expect(today.slots.find((slot) => slot.time === "19:00").ok).toBe(true);
    expect(evaluate({ nowMinutes: 18 * 60 }).slots.every((slot) => slot.ok)).toBe(true);
  });

  it("reports party-size limits from the service, not just the global rule", () => {
    const saturday = evaluateAvailability({ date: SATURDAY, pax: 2, services, bookings: [], config })[0];
    expect(saturday.minPax).toBe(4);
    expect(saturday.slots.every((slot) => slot.reason === "party_too_small")).toBe(true);
  });

  it("refuses an experience that is not served at that service", () => {
    const narrow = normalizeReservationConfig({
      ...config,
      experiences: [{ key: "lunch_only", title: "Lunch tasting", services: ["lunch"], active: true }],
    });
    const result = evaluateAvailability({ date: TUESDAY, pax: 2, services, bookings: [], config: narrow, experience: "lunch_only" })[0];
    expect(result.offersExperience).toBe(false);
    expect(result.slots.every((slot) => slot.reason === "not_offered")).toBe(true);
  });

  it("says no_table when the room is free but nothing fits the party", () => {
    const result = evaluateAvailability({ date: TUESDAY, pax: 6, services, bookings: [], config })[0];
    expect(result.slots.every((slot) => slot.reason === "no_table")).toBe(true);
  });

  it("carries the assigned tables so the caller need not re-run the search", () => {
    const slot = evaluate({ pax: 4 }).slots[0];
    expect(slot.tables.length).toBeGreaterThan(0);
    expect(slot.tableLabel).toBe(slot.tables[0]);
  });
});

describe("walk-ins", () => {
  const services = normalizeWeeklyServices([
    { service: "dinner", weekday: 2, enabled: true, first: "18:00", last: "19:00", interval: 30 },
    { service: "dinner", weekday: 6, enabled: true, first: "18:00", last: "19:00", interval: 30, walkInsEnabled: false },
  ]);

  it("allows walk-ins on a normal evening", () => {
    expect(walkInsAllowed({ date: TUESDAY, services, config })).toBe(true);
  });

  it("respects a weekday with walk-ins switched off", () => {
    expect(walkInsAllowed({ date: SATURDAY, services, config })).toBe(false);
  });

  it("respects the restaurant-wide switch", () => {
    const noWalkIns = normalizeReservationConfig({ ...config, walkIns: { enabled: false } });
    expect(walkInsAllowed({ date: TUESDAY, services, config: noWalkIns })).toBe(false);
  });

  it("allows no walk-ins on a closed date", () => {
    expect(walkInsAllowed({ date: TUESDAY, services, config, exceptions: [{ date: TUESDAY, kind: "closed" }] })).toBe(false);
  });
});

// A guest following their manage link to move an existing booking must not be
// blocked by the table they already hold. The callers express that by removing
// the booking from the set before evaluating (getAvailability's
// `excludeBookingId`), so what is pinned here is the behaviour they rely on:
// the same evening reads as full or as free depending only on whether the
// guest's own row is in the list.
describe("a guest's own booking must not block their own move", () => {
  const single = normalizeReservationConfig({
    tables: [{ id: "T01", seats: 2 }, { id: "T05", seats: 4 }],
    combos: [],
    pacing: { coversPerSlot: 8, coversPerService: 20 },
    durations: { small: 120, medium: 150, large: 180, buffer: 15 },
  });
  const services = normalizeWeeklyServices([
    { service: "dinner", weekday: 2, enabled: true, first: "18:00", last: "19:00", interval: 30, onlineEnabled: true },
  ]);
  const own = { ...booking("own", "18:00", 4, ["T05"]), service: "dinner" };
  const evaluate = (bookings) => evaluateAvailability({
    date: TUESDAY, pax: 4, services, bookings, config: single, publicOnly: true,
  })[0].slots.find((slot) => slot.time === "18:00");

  it("reports no table while their own booking is counted", () => {
    expect(evaluate([own]).ok).toBe(false);
    expect(evaluate([own]).reason).toBe("no_table");
  });

  it("offers the same sitting once their own booking is excluded", () => {
    const slot = evaluate([]);
    expect(slot.ok).toBe(true);
    expect(slot.tables).toContain("T05");
  });
});
