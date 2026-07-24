// Schedule + availability resolution tests.
//
// Proves the two rules the restaurant asked for explicitly:
//   1. Lunch appears only on the weekdays where it is enabled.
//   2. Date-specific exceptions override the normal weekly schedule.
//
// Vitest, matching the suites already in src/__tests__/.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEEKLY_SERVICES,
  normalizeReservationConfig,
  normalizeWeeklyServices,
  partyLimitsFor,
  publicConfigOf,
  renderMessage,
} from "../config.js";
import { generateSlots, resolveServicesForDate } from "../availability.js";

// July 2026: 20th Mon, 21st Tue, 22nd Wed, 25th Sat, 26th Sun.
const MONDAY = "2026-07-20";
const TUESDAY = "2026-07-21";
const WEDNESDAY = "2026-07-22";
const SATURDAY = "2026-07-25";

const services = normalizeWeeklyServices(DEFAULT_WEEKLY_SERVICES);
const namesFor = (date, exceptions = [], options) =>
  resolveServicesForDate(date, services, exceptions, options).map((item) => item.service).sort();

describe("weekly service schedule", () => {
  it("offers no service at all on a closed weekday", () => {
    expect(namesFor(MONDAY)).toEqual([]);
  });

  it("offers lunch only on the weekdays where lunch is enabled", () => {
    expect(namesFor(TUESDAY)).toEqual(["dinner", "lunch"]);
    expect(namesFor(WEDNESDAY)).toEqual(["dinner", "lunch"]);
    // Saturday serves dinner only — the spec's exact case.
    expect(namesFor(SATURDAY)).toEqual(["dinner"]);
  });

  it("keeps each weekday's own hours", () => {
    const tuesday = resolveServicesForDate(TUESDAY, services, []).find((item) => item.service === "dinner");
    const saturday = resolveServicesForDate(SATURDAY, services, []).find((item) => item.service === "dinner");
    expect(tuesday.last).toBe("19:30");
    expect(saturday.last).toBe("20:00");
  });

  it("generates the bookable times a guest actually sees", () => {
    expect(generateSlots("18:00", "19:30", 30)).toEqual(["18:00", "18:30", "19:00", "19:30"]);
    expect(generateSlots("18:00", "19:00", 15)).toEqual(["18:00", "18:15", "18:30", "18:45", "19:00"]);
  });
});

describe("date-specific exceptions override the weekly schedule", () => {
  it("a closure removes every service that day", () => {
    expect(namesFor(SATURDAY, [{ date: SATURDAY, kind: "closed" }])).toEqual([]);
  });

  it("a private event removes every service that day", () => {
    expect(namesFor(SATURDAY, [{ date: SATURDAY, kind: "private_event", label: "Wedding" }])).toEqual([]);
  });

  it("adds lunch to one exceptional date", () => {
    expect(namesFor(SATURDAY, [{ date: SATURDAY, kind: "service_override", service: "lunch", mode: "on" }]))
      .toEqual(["dinner", "lunch"]);
  });

  it("removes lunch from a single date without touching the weekday rule", () => {
    const exceptions = [{ date: WEDNESDAY, kind: "service_override", service: "lunch", mode: "off" }];
    expect(namesFor(WEDNESDAY, exceptions)).toEqual(["dinner"]);
    // The following Wednesday is unaffected.
    expect(namesFor("2026-07-29", exceptions)).toEqual(["dinner", "lunch"]);
  });

  it("changes the hours for one date only", () => {
    const exceptions = [{ date: SATURDAY, kind: "service_override", service: "dinner", first: "17:00", last: "18:00" }];
    const resolved = resolveServicesForDate(SATURDAY, services, exceptions).find((item) => item.service === "dinner");
    expect([resolved.first, resolved.last]).toEqual(["17:00", "18:00"]);
    expect(namesFor(SATURDAY)).toEqual(["dinner"]);
  });

  it("stops online bookings for a date while staff keep booking access", () => {
    const exceptions = [{ date: SATURDAY, kind: "service_override", service: "dinner", onlineOff: true }];
    expect(namesFor(SATURDAY, exceptions, { publicOnly: true })).toEqual([]);
    expect(namesFor(SATURDAY, exceptions)).toEqual(["dinner"]);
  });

  it("a weekday closed to online booking is invisible to guests, visible to staff", () => {
    const staffOnly = normalizeWeeklyServices([
      { service: "dinner", weekday: 6, enabled: true, first: "18:00", last: "19:30", interval: 30, onlineEnabled: false },
    ]);
    expect(resolveServicesForDate(SATURDAY, staffOnly, [], { publicOnly: true })).toEqual([]);
    expect(resolveServicesForDate(SATURDAY, staffOnly, []).map((item) => item.service)).toEqual(["dinner"]);
  });
});

describe("configuration compatibility", () => {
  it("loads a row saved before experiences, messages, team and combos existed", () => {
    const legacy = normalizeReservationConfig({ restaurantName: "Milka", online: { maxPax: 8 } });
    expect(legacy.online.maxPax).toBe(8);
    expect(legacy.online.leadMinutes).toBe(30);
    expect(legacy.experiences.length).toBeGreaterThan(0);
    expect(legacy.messages.confirm.en).toContain("{ref}");
    expect(legacy.combos.length).toBeGreaterThan(0);
    expect(legacy.team).toEqual([]);
    expect(legacy.walkIns.enabled).toBe(true);
  });

  it("respects a deliberately emptied curated list", () => {
    expect(normalizeReservationConfig({ combos: [] }).combos).toEqual([]);
    expect(normalizeReservationConfig({ experiences: [] }).experiences).toEqual([]);
  });

  it("prefers per-service party limits over the global online limits", () => {
    const config = normalizeReservationConfig({ online: { maxPax: 6, minPax: 1 } });
    expect(partyLimitsFor({ maxPax: 10, minPax: 4 }, config)).toEqual({ minPax: 4, maxPax: 10 });
    expect(partyLimitsFor({}, config)).toEqual({ minPax: 1, maxPax: 6 });
  });

  it("never leaks staff-only configuration to the public page", () => {
    const publicConfig = publicConfigOf(normalizeReservationConfig({}));
    expect(publicConfig.tables).toBeUndefined();
    expect(publicConfig.pacing).toBeUndefined();
    expect(publicConfig.team).toBeUndefined();
    expect(publicConfig.experiences[0].key).toBeTruthy();
  });

  it("fills guest message placeholders and leaves unknown ones visible", () => {
    expect(renderMessage("Hello {name}, {pax} at {time}.", { name: "Ana", pax: 2, time: "19:00" }))
      .toBe("Hello Ana, 2 at 19:00.");
    expect(renderMessage("Ref {ref} {nope}", { ref: "MK-1" })).toBe("Ref MK-1 {nope}");
  });
});
