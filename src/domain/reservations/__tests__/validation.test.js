// /book and the waitlist are unauthenticated writes. Before this module every
// guest-supplied string reached the database unbounded — a note of ten thousand
// characters was accepted, stored, and then printed onto the kitchen ticket and
// the service breakdown for a real evening.

import { describe, expect, it } from "vitest";
import { LIMITS, validateBookingPayload, validateWaitlistEntry } from "../validation.js";

const valid = (overrides = {}) => ({
  date: "2026-07-22",
  time: "19:00",
  service: "dinner",
  name: "Zupan, Marko",
  pax: 4,
  ...overrides,
});

const times = (length) => "x".repeat(length);

describe("validateBookingPayload", () => {
  it("accepts an ordinary booking", () => {
    expect(validateBookingPayload(valid())).toBe(true);
  });

  it("accepts a long but human note, and refuses a robot's", () => {
    expect(validateBookingPayload(valid({ notes: times(LIMITS.notes) }))).toBe(true);
    expect(() => validateBookingPayload(valid({ notes: times(LIMITS.notes + 1) })))
      .toThrow(/Note is too long/);
  });

  it("names the field it is refusing, in words a guest can act on", () => {
    expect(() => validateBookingPayload(valid({ name: times(LIMITS.name + 1) })))
      .toThrow(`Guest name is too long (maximum ${LIMITS.name} characters).`);
    expect(() => validateBookingPayload(valid({ phone: times(LIMITS.phone + 1) })))
      .toThrow(/Telephone number is too long/);
  });

  it("tells a length refusal apart from a rejection", () => {
    try {
      validateBookingPayload(valid({ notes: times(LIMITS.notes + 1) }));
      throw new Error("should have refused");
    } catch (error) {
      expect(error.code).toBe("too_long");
      expect(error.statusCode).toBe(400);
    }
  });

  it("bounds the number of dietary notes as well as their length", () => {
    const many = Array.from({ length: LIMITS.allergies + 1 }, () => ({ pos: 1, note: "gluten" }));
    expect(() => validateBookingPayload(valid({ allergies: many }))).toThrow(/Too many dietary notes/);

    const long = [{ pos: 1, note: times(LIMITS.allergyNote + 1) }];
    expect(() => validateBookingPayload(valid({ allergies: long }))).toThrow(/too long/);
  });

  it("takes a restriction as a bare string or as the object the ticket reads", () => {
    expect(validateBookingPayload(valid({ allergies: ["gluten", { pos: 2, key: "dairy" }] }))).toBe(true);
  });

  it("refuses an email that is not one, and accepts one that is", () => {
    expect(validateBookingPayload(valid({ email: "marko@example.com" }))).toBe(true);
    expect(validateBookingPayload(valid({ email: "" }))).toBe(true);
    expect(() => validateBookingPayload(valid({ email: "marko" }))).toThrow(/does not look right/);
    expect(() => validateBookingPayload(valid({ email: "marko@example" }))).toThrow(/does not look right/);
  });

  it("still enforces the rules it always had", () => {
    expect(() => validateBookingPayload(valid({ date: "22-07-2026" }))).toThrow(/valid date/);
    expect(() => validateBookingPayload(valid({ time: "7pm" }))).toThrow(/valid time/);
    expect(() => validateBookingPayload(valid({ service: "Dinner Service" }))).toThrow(/valid service/);
    expect(() => validateBookingPayload(valid({ name: "  " }))).toThrow(/name is required/);
    expect(() => validateBookingPayload(valid({ pax: 0 }))).toThrow(/between 1 and 30/);
    expect(() => validateBookingPayload(valid({ pax: 2.5 }))).toThrow(/between 1 and 30/);
  });

  it("refuses a dietary list that is not a list at all", () => {
    expect(() => validateBookingPayload(valid({ allergies: "gluten" }))).toThrow(/must be a list/);
  });
});

describe("validateWaitlistEntry", () => {
  it("accepts a party that gave only what the form asks for", () => {
    expect(validateWaitlistEntry({ date: "2026-07-22", name: "Novak", pax: 2 })).toBe(true);
  });

  it("holds the waitlist to the same bounds as the booking form", () => {
    const entry = { date: "2026-07-22", name: "Novak", pax: 2 };
    expect(() => validateWaitlistEntry({ ...entry, notes: times(LIMITS.notes + 1) })).toThrow(/Note is too long/);
    expect(() => validateWaitlistEntry({ ...entry, name: times(LIMITS.name + 1) })).toThrow(/too long/);
    expect(() => validateWaitlistEntry({ ...entry, window: times(LIMITS.waitlistWindow + 1) })).toThrow(/Time window is too long/);
    expect(() => validateWaitlistEntry({ ...entry, email: "not-an-address" })).toThrow(/does not look right/);
  });

  it("checks an optional time and service only when they were given", () => {
    const entry = { date: "2026-07-22", name: "Novak", pax: 2 };
    expect(validateWaitlistEntry(entry)).toBe(true);
    expect(validateWaitlistEntry({ ...entry, time: "19:00", service: "dinner" })).toBe(true);
    expect(() => validateWaitlistEntry({ ...entry, time: "sevenish" })).toThrow(/valid time/);
    expect(() => validateWaitlistEntry({ ...entry, service: "DINNER" })).toThrow(/valid service/);
  });

  it("still requires the three things the restaurant cannot do without", () => {
    expect(() => validateWaitlistEntry({ name: "Novak", pax: 2 })).toThrow(/valid date/);
    expect(() => validateWaitlistEntry({ date: "2026-07-22", pax: 2 })).toThrow(/name is required/);
    expect(() => validateWaitlistEntry({ date: "2026-07-22", name: "Novak" })).toThrow(/between 1 and 30/);
  });
});
