import { describe, it, expect } from "vitest";
import {
  currentServiceDay,
  isStaleServiceDate,
  isDeliberatelyPastDate,
  isActivePastReview,
  serviceDayForActivity,
  isLiveServiceActivity,
} from "../utils/serviceDay.js";

// (resolveServiceEntry and shouldClearBoardOnDateChange are GONE with the
// service-entity model: joining reads the live `services` row, and a date
// switch starts a new namespace — no wipe decision exists to test. Their
// replacements are pinned in serviceLifecycle.test.js.)

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

describe("serviceDayForActivity (heal an orphaned, date-less service)", () => {
  // Regression for the 19.06 incident: a service ran with service_date left
  // blank, so the rollover auto-end (keyed entirely on service_date) never
  // saw it and the night was never archived. Recovery re-derives the day from
  // the board's own latest activity timestamp.
  it("derives the service day from a daytime activity timestamp", () => {
    expect(serviceDayForActivity(new Date("2026-06-19T19:51:00").getTime())).toBe("2026-06-19");
  });

  it("files a past-midnight service under the day it started (before rollover)", () => {
    // 01:30 the night of the 19th still belongs to the 19.06 service.
    expect(serviceDayForActivity(new Date("2026-06-20T01:30:00").getTime())).toBe("2026-06-19");
    // …and only rolls to the new day once past the 06:00 cutoff.
    expect(serviceDayForActivity(new Date("2026-06-20T06:00:00").getTime())).toBe("2026-06-20");
  });

  it("returns null when there is no activity to anchor on (empty board)", () => {
    expect(serviceDayForActivity(NaN)).toBe(null);
    expect(serviceDayForActivity(-Infinity)).toBe(null);
    expect(serviceDayForActivity(undefined)).toBe(null);
  });

  it("a stale orphan re-attached this way is NOT exempt from auto-end", () => {
    // Heal sets chosenOn === the derived day, so a service that already rolled
    // over is auto-endable on the same pass (date === chosenOn ⇒ not a
    // deliberate past-date review).
    const day = serviceDayForActivity(new Date("2026-06-19T19:51:00").getTime());
    const today = "2026-06-20";
    const shouldAutoEnd =
      isStaleServiceDate(day, today) && !isActivePastReview(day, day, today);
    expect(shouldAutoEnd).toBe(true);
  });
});

describe("isLiveServiceActivity (don't wipe a live service under a stale date)", () => {
  // Regression for the 04.07 incident: a live dinner running under yesterday's
  // date (03.07) was archived + cleared mid-service when a tablet opened and the
  // stale-date auto-end fired. Any board still being touched within the current
  // service day is LIVE and must be re-dated forward, never wiped.
  it("treats activity within the current service day as LIVE (must not wipe)", () => {
    const now = new Date("2026-07-04T19:45:00"); // 19:45 local on the 4th
    const justNow = new Date("2026-07-04T19:41:00").getTime();
    expect(isLiveServiceActivity(justNow, now)).toBe(true);
  });

  it("a service that crossed midnight is still live before the 06:00 rollover", () => {
    const now = new Date("2026-07-05T01:30:00");
    const lateEdit = new Date("2026-07-05T01:20:00").getTime();
    expect(isLiveServiceActivity(lateEdit, now)).toBe(true);
  });

  it("treats last night's activity (past service day) as NOT live → auto-end proceeds", () => {
    // Opening at 09:58 on the 4th, board last touched during the 3rd's dinner.
    const now = new Date("2026-07-04T09:58:00");
    const lastNight = new Date("2026-07-03T22:30:00").getTime();
    expect(isLiveServiceActivity(lastNight, now)).toBe(false);
  });

  it("returns false when there is no activity to anchor on", () => {
    expect(isLiveServiceActivity(-Infinity)).toBe(false);
    expect(isLiveServiceActivity(NaN)).toBe(false);
  });
});

describe("isActivePastReview", () => {
  // Regression for the 10.06 incident: a past date picked on the 12th
  // (chosenOn=12) kept pinning every later service to the 10th because the
  // exemption never expired. The exemption must end once we roll past chosenOn.
  it("exempts a past-date review only while it is still that service day", () => {
    // Chosen on the 12th, viewing the 10th, and it is still the 12th → active.
    expect(isActivePastReview("2026-06-10", "2026-06-12", "2026-06-12")).toBe(true);
  });

  it("stops exempting once the clock rolls past the day it was chosen", () => {
    // Same selection, but now it is the 13th → abandoned, no longer exempt.
    expect(isActivePastReview("2026-06-10", "2026-06-12", "2026-06-13")).toBe(false);
  });

  it("is false for a normally-started service (date === chosenOn)", () => {
    expect(isActivePastReview("2026-06-12", "2026-06-12", "2026-06-12")).toBe(false);
  });

  it("drives release: an abandoned past-date review is dropped on a new day", () => {
    const date = "2026-06-10", chosenOn = "2026-06-12", today = "2026-06-13";
    const keep = isStaleServiceDate(date, today) && isActivePastReview(date, chosenOn, today);
    expect(keep).toBe(false); // → released / prompts for today
  });
});
