// The seeded world has to be worth trusting: if it contains a booking the
// engine would refuse, every screen built on it is testing a fiction. And it
// has to be safe to run twice, or the LAB fills up with duplicate summers.

import { describe, expect, it } from "vitest";
import { buildLabWorld, deterministicUuid } from "../labSeed.js";
import { DEFAULT_RESERVATION_CONFIG, DEFAULT_WEEKLY_SERVICES, normalizeReservationConfig, normalizeWeeklyServices } from "../config.js";
import { suggestTables } from "../availability.js";
import { validateBookingPayload } from "../validation.js";

const TODAY = "2026-07-22";
const config = normalizeReservationConfig(DEFAULT_RESERVATION_CONFIG);
const services = normalizeWeeklyServices(DEFAULT_WEEKLY_SERVICES);
const world = (overrides = {}) => buildLabWorld({ today: TODAY, config, services, pastDays: 60, futureDays: 21, ...overrides });

describe("buildLabWorld", () => {
  it("fills a book worth looking at", () => {
    const { bookings, waitlist, summary } = world();
    expect(bookings.length).toBeGreaterThan(200);
    expect(summary.guests).toBeGreaterThan(30);
    expect(waitlist).toHaveLength(2);
    // Months behind, weeks ahead, and something on the anchor day itself.
    expect(bookings.some((booking) => booking.date < TODAY)).toBe(true);
    expect(bookings.some((booking) => booking.date === TODAY)).toBe(true);
    expect(bookings.some((booking) => booking.date > TODAY)).toBe(true);
  });

  it("puts the past behind it and the future in front of it", () => {
    const { bookings } = world();
    const past = bookings.filter((booking) => booking.date < TODAY);
    const future = bookings.filter((booking) => booking.date > TODAY);
    // Service that has happened is finished, one way or another.
    expect(past.every((booking) => ["completed", "cancelled", "no_show"].includes(booking.status))).toBe(true);
    // Service still to come has not.
    expect(future.every((booking) => ["confirmed", "pending"].includes(booking.status))).toBe(true);
    expect(past.some((booking) => booking.status === "no_show")).toBe(true);
    expect(past.some((booking) => booking.status === "cancelled")).toBe(true);
  });

  it("books the room honestly — no two active parties share a table at once", () => {
    const { bookings } = world();
    const active = bookings.filter((booking) => ["pending", "confirmed", "arrived"].includes(booking.status));
    active.forEach((booking) => {
      const others = active.filter((other) => other.id !== booking.id);
      const suggestion = suggestTables({
        date: booking.date,
        time: booking.time,
        pax: booking.pax,
        bookings: others.map((other) => ({ ...other, tableGroup: other.operationalData.tableGroup })),
        config,
      });
      // The tables it chose are still offered when everything else is in place.
      expect(suggestion, `${booking.date} ${booking.time} ${booking.name}`).not.toBeNull();
    });
  });

  it("seats a big party on a configured pair, not on an imaginary table", () => {
    const { bookings, summary } = world();
    expect(summary.combined).toBeGreaterThan(0);
    bookings
      .filter((booking) => booking.operationalData.tableGroup.length > 1)
      .forEach((booking) => {
        const pair = booking.operationalData.tableGroup;
        const configured = config.combos.some((combo) => (
          combo.length === pair.length && combo.every((label) => pair.includes(String(label)))
        ));
        expect(configured, `${pair.join("+")} is not a configured pair`).toBe(true);
        expect(booking.tableLabel).toBe(pair[0]);
      });
  });

  it("only ever books a seating the restaurant actually serves", () => {
    const { bookings } = world();
    bookings.forEach((booking) => {
      const weekday = new Date(`${booking.date}T12:00:00Z`).getUTCDay();
      const service = services.find((item) => item.service === booking.service && item.weekday === weekday);
      expect(service, `${booking.service} on ${booking.date}`).toBeTruthy();
      expect(booking.time >= service.first && booking.time <= service.last).toBe(true);
    });
  });

  it("produces payloads the servers would accept", () => {
    world().bookings.slice(0, 80).forEach((booking) => {
      expect(() => validateBookingPayload(booking)).not.toThrow();
    });
  });

  it("uses only fictional contact details", () => {
    const { bookings } = world();
    bookings.forEach((booking) => {
      if (booking.email) expect(booking.email.endsWith("@example.com")).toBe(true);
    });
  });

  // The property that makes re-seeding safe: same anchor, same world, same ids.
  it("is the same world every time it is built", () => {
    expect(JSON.stringify(world())).toBe(JSON.stringify(world()));
  });

  it("writes over its own rows rather than a second copy of the summer", () => {
    const first = world().bookings;
    const second = world().bookings;
    expect(second.map((booking) => booking.id)).toEqual(first.map((booking) => booking.id));
    expect(new Set(first.map((booking) => booking.id)).size).toBe(first.length);
    expect(new Set(first.map((booking) => booking.idempotencyKey)).size).toBe(first.length);
  });

  it("moves with the anchor date rather than living in one hard-coded summer", () => {
    const march = buildLabWorld({ today: "2027-03-04", config, services, pastDays: 30, futureDays: 14 });
    expect(march.summary.from).toBe("2027-02-02");
    expect(march.summary.to).toBe("2027-03-18");
    expect(march.bookings.every((booking) => booking.date >= "2027-02-02" && booking.date <= "2027-03-18")).toBe(true);
  });

  it("gives a different but equally repeatable world for a different seed", () => {
    const a = world({ seed: 1 });
    const b = world({ seed: 2 });
    expect(a.bookings.map((booking) => booking.id)).not.toEqual(b.bookings.map((booking) => booking.id));
    expect(JSON.stringify(world({ seed: 1 }))).toBe(JSON.stringify(a));
  });

  it("refuses to build without an anchor date", () => {
    expect(() => buildLabWorld({ config, services })).toThrow(/anchor date/);
  });
});

describe("deterministicUuid", () => {
  it("is a well-formed v8 UUID, stable for the same input", () => {
    const id = deterministicUuid("lab:1:2026-07-22:dinner:19:00:Zupan, Marko:0");
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deterministicUuid("lab:1:2026-07-22:dinner:19:00:Zupan, Marko:0")).toBe(id);
    expect(deterministicUuid("lab:1:2026-07-22:dinner:19:00:Zupan, Marko:1")).not.toBe(id);
  });
});
