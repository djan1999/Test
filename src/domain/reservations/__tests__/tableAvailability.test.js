// A host reads this panel with a guest on the telephone. Every table stays on
// screen and every "no" carries a reason they can say out loud.

import { describe, expect, it } from "vitest";
import { tableAvailabilityAt } from "../availability.js";
import { DEFAULT_RESERVATION_CONFIG } from "../config.js";

const DATE = "2026-07-21";
const config = DEFAULT_RESERVATION_CONFIG;

const booking = (overrides = {}) => ({
  id: "b1",
  date: DATE,
  time: "19:00",
  pax: 2,
  status: "confirmed",
  name: "Novak",
  tableLabel: "T01",
  operationalData: { tableGroup: ["T01"] },
  tableGroup: ["T01"],
  ...overrides,
});

describe("tableAvailabilityAt", () => {
  it("returns every configured table, never a filtered subset", () => {
    const verdicts = tableAvailabilityAt({ date: DATE, time: "19:00", pax: 2, bookings: [booking()], config });
    expect(verdicts).toHaveLength(DEFAULT_RESERVATION_CONFIG.tables.length);
    expect(verdicts.map((v) => v.id)).toContain("T01");
  });

  it("says to pick a time before it claims to know occupancy", () => {
    const verdicts = tableAvailabilityAt({ date: DATE, time: "", pax: 2, bookings: [booking()], config });
    expect(verdicts.every((v) => v.reason === "pick_time" && v.ok === false)).toBe(true);
    // Seats are knowable without a time; occupancy is not.
    expect(verdicts.find((v) => v.id === "T08").seats).toBe(8);
  });

  it("names the party holding a table, so the host can say it out loud", () => {
    const verdicts = tableAvailabilityAt({ date: DATE, time: "19:00", pax: 2, bookings: [booking()], config });
    const taken = verdicts.find((v) => v.id === "T01");
    expect(taken.ok).toBe(false);
    expect(taken.reason).toBe("taken");
    expect(taken.takenBy).toEqual({ name: "Novak", time: "19:00" });
  });

  it("holds EVERY table of a joined party, not just the first", () => {
    const joined = booking({ tableLabel: "T01", tableGroup: ["T01", "T02"], pax: 4 });
    const verdicts = tableAvailabilityAt({ date: DATE, time: "19:00", pax: 2, bookings: [joined], config });
    expect(verdicts.find((v) => v.id === "T01").ok).toBe(false);
    expect(verdicts.find((v) => v.id === "T02").ok).toBe(false);
  });

  it("marks a table too small rather than hiding it", () => {
    const verdicts = tableAvailabilityAt({ date: DATE, time: "19:00", pax: 6, bookings: [], config });
    const small = verdicts.find((v) => v.id === "T01");
    expect(small).toMatchObject({ ok: false, reason: "too_small", seats: 2 });
    expect(verdicts.find((v) => v.id === "T08").ok).toBe(true);
  });

  it("frees the guest's own table when they are changing their own booking", () => {
    const held = tableAvailabilityAt({ date: DATE, time: "19:00", pax: 2, bookings: [booking()], config });
    expect(held.find((v) => v.id === "T01").ok).toBe(false);

    const own = tableAvailabilityAt({
      date: DATE, time: "19:00", pax: 2, bookings: [booking()], config, excludeId: "b1",
    });
    expect(own.find((v) => v.id === "T01").ok).toBe(true);
  });

  it("ignores cancelled and no-show parties — they are not sitting anywhere", () => {
    for (const status of ["cancelled", "no_show"]) {
      const verdicts = tableAvailabilityAt({
        date: DATE, time: "19:00", pax: 2, bookings: [booking({ status })], config,
      });
      expect(verdicts.find((v) => v.id === "T01").ok).toBe(true);
    }
  });

  it("leaves a table free for a sitting that does not overlap", () => {
    const verdicts = tableAvailabilityAt({ date: DATE, time: "22:30", pax: 2, bookings: [booking()], config });
    expect(verdicts.find((v) => v.id === "T01").ok).toBe(true);
  });
});
