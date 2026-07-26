// A restaurant opens the book by the month: December goes on sale in
// September, January is shut for the annual closure. Neither of those is a
// number of days, and both have to hold on the server — the guest page asking
// the same function is what stops it offering a date the server refuses.

import { describe, expect, it } from "vitest";
import { availabilityForRequest, isDateBookable, monthState } from "../availability.js";
import { DEFAULT_RESERVATION_CONFIG, DEFAULT_WEEKLY_SERVICES, publicConfigOf } from "../config.js";

const TODAY = "2026-07-26";
const win = (months = {}) => ({ ...DEFAULT_RESERVATION_CONFIG, online: { ...DEFAULT_RESERVATION_CONFIG.online, windowDays: 90, months } });

describe("months decided by hand", () => {
  it("a month nobody touched still follows the rolling window", () => {
    expect(isDateBookable("2026-09-24", { config: win(), today: TODAY })).toBe(true);
    expect(isDateBookable("2026-12-24", { config: win(), today: TODAY })).toBe(false);
    expect(monthState("2026-12", { config: win(), today: TODAY })).toBe("outside_window");
  });

  it("OPEN puts a month on sale beyond the window", () => {
    const config = win({ "2026-12": true });
    expect(isDateBookable("2026-12-24", { config, today: TODAY })).toBe(true);
    expect(monthState("2026-12", { config, today: TODAY })).toBe("open");
    // Opening December does not open November alongside it.
    expect(isDateBookable("2026-11-15", { config, today: TODAY })).toBe(false);
  });

  it("CLOSED shuts a month sitting inside the window", () => {
    const config = win({ "2026-08": false });
    expect(isDateBookable("2026-08-15", { config, today: TODAY })).toBe(false);
    expect(monthState("2026-08", { config, today: TODAY })).toBe("closed_month");
    // Its neighbours are untouched.
    expect(isDateBookable("2026-09-15", { config, today: TODAY })).toBe(true);
  });

  it("never opens the past, whatever the month says", () => {
    const config = win({ "2026-07": true });
    expect(isDateBookable("2026-07-25", { config, today: TODAY })).toBe(false);
    expect(isDateBookable("2026-07-26", { config, today: TODAY })).toBe(true);
  });

  it("forgetting this screen can never close the book", () => {
    // No entries at all behaves exactly as it did before the feature existed.
    expect(isDateBookable("2026-08-15", { config: win(), today: TODAY })).toBe(true);
  });
});

describe("the server enforces it, not the browser", () => {
  const request = (date, months) => availabilityForRequest({
    date,
    pax: 2,
    services: DEFAULT_WEEKLY_SERVICES,
    exceptions: [],
    bookings: [],
    config: win(months),
    publicOnly: true,
    now: { date: TODAY, minutes: 600 },
  });

  it("refuses a hand-made request for a closed month", () => {
    const result = request("2026-08-15", { "2026-08": false });
    expect(result.outsideWindow).toBe(true);
    expect(result.services).toEqual([]);
  });

  it("serves a month opened beyond the rolling window", () => {
    expect(request("2026-12-24", { "2026-12": true }).outsideWindow).toBe(false);
    expect(request("2026-12-24", {}).outsideWindow).toBe(true);
  });
});

describe("the guest page is told which months are decided", () => {
  it("publicConfigOf carries the months, and still no inventory or pacing", () => {
    const publicConfig = publicConfigOf(win({ "2026-12": true, "2027-01": false }));
    expect(publicConfig.months).toEqual({ "2026-12": true, "2027-01": false });
    expect(publicConfig.tables).toBeUndefined();
    expect(publicConfig.pacing).toBeUndefined();
  });
});
