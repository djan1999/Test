import { describe, it, expect } from "vitest";
import {
  currentServiceDay,
  isStaleServiceDate,
  isDeliberatelyPastDate,
  isActivePastReview,
  shouldClearBoardOnDateChange,
  resolveServiceEntry,
  serviceDayForActivity,
} from "../utils/serviceDay.js";

describe("resolveServiceEntry (join a live service vs start a new one)", () => {
  it("JOINs a current live service (second device / re-login just sees it)", () => {
    const r = resolveServiceEntry({ date: "2026-06-13", chosenOn: "2026-06-13" }, "2026-06-13");
    expect(r).toEqual({ action: "join", date: "2026-06-13", chosenOn: "2026-06-13", session: null, startedAt: null });
  });

  it("passes the shared session + instance id through on a join", () => {
    const r = resolveServiceEntry(
      { date: "2026-06-13", chosenOn: "2026-06-13", session: "lunch", startedAt: "2026-06-13T11:00:00.000Z" },
      "2026-06-13",
    );
    expect(r).toEqual({
      action: "join", date: "2026-06-13", chosenOn: "2026-06-13",
      session: "lunch", startedAt: "2026-06-13T11:00:00.000Z",
    });
  });

  it("ignores a bogus session value (keeps null so the device falls back)", () => {
    const r = resolveServiceEntry({ date: "2026-06-13", chosenOn: "2026-06-13", session: "brunch" }, "2026-06-13");
    expect(r.session).toBeNull();
  });

  it("STARTs when there is no persisted service", () => {
    expect(resolveServiceEntry({}, "2026-06-13").action).toBe("start");
    expect(resolveServiceEntry(null, "2026-06-13").action).toBe("start");
  });

  it("STARTs (does not join) when the persisted service is stale/rolled over", () => {
    const r = resolveServiceEntry({ date: "2026-06-10", chosenOn: "2026-06-10" }, "2026-06-13");
    expect(r.action).toBe("start");
  });

  it("JOINs a deliberately-past service still being reviewed on its chosen day", () => {
    const r = resolveServiceEntry({ date: "2026-06-10", chosenOn: "2026-06-13" }, "2026-06-13");
    expect(r.action).toBe("join");
    expect(r.date).toBe("2026-06-10");
  });
});

describe("shouldClearBoardOnDateChange", () => {
  // Regression for "opened the board on the laptop and it wiped the tablet":
  // a device joining the live service has no previous date, so the old
  // `next !== prev` check wiped the shared board.
  it("does NOT clear when a fresh device joins (no previous date)", () => {
    expect(shouldClearBoardOnDateChange(null, "2026-06-13")).toBe(false);
    expect(shouldClearBoardOnDateChange("", "2026-06-13")).toBe(false);
  });

  it("does NOT clear when re-picking the same day", () => {
    expect(shouldClearBoardOnDateChange("2026-06-13", "2026-06-13")).toBe(false);
  });

  it("clears only on a genuine switch between two different known days", () => {
    expect(shouldClearBoardOnDateChange("2026-06-12", "2026-06-13")).toBe(true);
  });

  it("does not clear when releasing the date (next null, e.g. after archive)", () => {
    expect(shouldClearBoardOnDateChange("2026-06-13", null)).toBe(false);
  });
});

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
