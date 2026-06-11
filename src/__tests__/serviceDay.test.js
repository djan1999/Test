import { describe, it, expect } from "vitest";
import {
  currentServiceDay,
  isStaleServiceDate,
  isDeliberatelyPastDate,
} from "../utils/serviceDay.js";

describe("currentServiceDay", () => {
  it("stays on the previous calendar date until the rollover hour", () => {
    // 02:30 — dinner service still running past midnight
    expect(currentServiceDay(new Date("2026-06-11T02:30:00"))).toBe("2026-06-10");
    // 06:00 and later — service day has rolled over
    expect(currentServiceDay(new Date("2026-06-11T06:00:00"))).toBe("2026-06-11");
    expect(currentServiceDay(new Date("2026-06-11T19:00:00"))).toBe("2026-06-11");
  });
});

describe("isStaleServiceDate", () => {
  it("flags only dates before the current service day", () => {
    expect(isStaleServiceDate("2026-06-10", "2026-06-11")).toBe(true);
    expect(isStaleServiceDate("2026-06-11", "2026-06-11")).toBe(false);
    expect(isStaleServiceDate("2026-06-12", "2026-06-11")).toBe(false);
    expect(isStaleServiceDate(null, "2026-06-11")).toBe(false);
    expect(isStaleServiceDate("", "2026-06-11")).toBe(false);
  });
});

describe("isDeliberatelyPastDate", () => {
  // Regression: picking a past date in the service date picker (demo /
  // reviewing an earlier day) used to trigger the rollover auto-end, which
  // archived + wiped the board and kicked the user out of service mode.
  it("is true when the date was already past at the moment it was chosen", () => {
    expect(isDeliberatelyPastDate("2026-06-08", "2026-06-11")).toBe(true);
  });

  it("is false for a service that genuinely rolled over while running", () => {
    // chosen for "today", then the service day advanced past it overnight
    expect(isDeliberatelyPastDate("2026-06-10", "2026-06-10")).toBe(false);
  });

  it("is false for current or future dates", () => {
    expect(isDeliberatelyPastDate("2026-06-11", "2026-06-11")).toBe(false);
    expect(isDeliberatelyPastDate("2026-06-12", "2026-06-11")).toBe(false);
  });

  it("is false when no chosenOn was recorded (legacy persisted dates)", () => {
    expect(isDeliberatelyPastDate("2026-06-08", null)).toBe(false);
    expect(isDeliberatelyPastDate("2026-06-08", "")).toBe(false);
  });

  it("a deliberately-past date is stale but exempt from auto-end", () => {
    const date = "2026-06-08", today = "2026-06-11", chosenOn = "2026-06-11";
    // This is the exact condition the auto-end effect checks:
    const shouldAutoEnd = isStaleServiceDate(date, today) && !isDeliberatelyPastDate(date, chosenOn);
    expect(shouldAutoEnd).toBe(false);
  });
});
