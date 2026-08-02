import { describe, it, expect } from "vitest";
import {
  ARRIVAL_DELAY_ALARM_MIN,
  LAST_FIRE_ALARM_MIN,
  arrivalDelayMinutes,
  courseFireState,
  sheetActionAvailability,
  tableBadgeState,
} from "../utils/tableSheetState.js";

const at = (h, m) => h * 60 + m;

describe("tableBadgeState", () => {
  it("reads a plain booking as RESERVED and a blank row as CLEARED", () => {
    expect(tableBadgeState({ resName: "Weber", resTime: "20:30" }).label).toBe("RESERVED");
    expect(tableBadgeState({}).label).toBe("CLEARED");
  });

  it("prefers the transient party states over the settled ones", () => {
    // A party walking in from the terrace is ARRIVING even though its table is
    // also set and already active — that is the state the operator must act on.
    const table = { active: true, courseReady: { at: "20:40" }, arrivedAt: "20:05" };
    expect(tableBadgeState(table, { visit: { visit: "arriving" } }).label).toBe("ARRIVING");
    expect(tableBadgeState(table, { visit: { visit: "terrace", terraceLabel: "TR3" } }))
      .toEqual({ key: "terrace", label: "TERRACE", at: "TR3" });
    expect(tableBadgeState(table)).toEqual({ key: "set", label: "SET", at: "20:40" });
    expect(tableBadgeState({ active: true, arrivedAt: "20:05" }))
      .toEqual({ key: "live", label: "LIVE", at: "20:05" });
  });
});

describe("arrivalDelayMinutes", () => {
  it("counts only a booked, unseated party that is genuinely late", () => {
    expect(arrivalDelayMinutes({ resTime: "20:00" }, at(20, 14))).toBe(14);
    expect(arrivalDelayMinutes({ resTime: "20:00" }, at(19, 55))).toBeNull();
    expect(arrivalDelayMinutes({ resTime: "20:00", active: true }, at(20, 30))).toBeNull();
    expect(arrivalDelayMinutes({ resTime: "20:00", arrivedAt: "20:02" }, at(20, 30))).toBeNull();
    expect(arrivalDelayMinutes({}, at(20, 30))).toBeNull();
  });

  it("does not read a service that crossed midnight as a whole day late", () => {
    expect(arrivalDelayMinutes({ resTime: "23:45" }, at(0, 10))).toBe(25);
  });

  it("crosses the blink threshold at the documented value", () => {
    expect(arrivalDelayMinutes({ resTime: "20:00" }, at(20, ARRIVAL_DELAY_ALARM_MIN)))
      .toBe(ARRIVAL_DELAY_ALARM_MIN);
  });
});

describe("courseFireState", () => {
  const courses = [
    { index: 1, key: "amuse", firedAt: "19:00" },
    { index: 2, key: "starter", firedAt: "19:20" },
    { index: 3, key: "main", firedAt: null },
    { index: 4, key: "dessert", firedAt: null },
  ];

  it("reports the course the table is waiting on and how long the pass has been quiet", () => {
    const s = courseFireState({ arrivedAt: "18:45" }, courses, at(19, 32));
    expect(s.firedCount).toBe(2);
    expect(s.total).toBe(4);
    expect(s.nextIndex).toBe(3);
    expect(s.lastFiredAt).toBe("19:20");
    expect(s.minsSinceFire).toBe(12);
    expect(s.alarm).toBe(false);
  });

  it("raises the alarm once the gap passes the threshold", () => {
    const s = courseFireState({}, courses, at(19, 20 + LAST_FIRE_ALARM_MIN));
    expect(s.minsSinceFire).toBe(LAST_FIRE_ALARM_MIN);
    expect(s.alarm).toBe(true);
  });

  it("falls back to the seat time before anything has been fired", () => {
    const unfired = courses.map(c => ({ ...c, firedAt: null }));
    const s = courseFireState({ arrivedAt: "19:00" }, unfired, at(19, 18));
    expect(s.lastFiredAt).toBeNull();
    expect(s.minsSinceFire).toBe(18);
    expect(s.nextIndex).toBe(1);
  });

  it("takes the latest stamp by the clock, not by menu position", () => {
    // The kitchen fires out of menu order often enough that the last course in
    // the list holding a time is the wrong answer for "how long has it been".
    const outOfOrder = [
      { index: 1, key: "a", firedAt: "19:40" },
      { index: 2, key: "b", firedAt: "19:10" },
    ];
    expect(courseFireState({}, outOfOrder, at(19, 45)).lastFiredAt).toBe("19:40");
  });

  it("reads the menu as complete once every course has a time", () => {
    const all = courses.map(c => ({ ...c, firedAt: "19:50" }));
    const s = courseFireState({}, all, at(19, 55));
    expect(s.nextIndex).toBe(4);
    expect(s.firedCount).toBe(4);
  });
});

describe("sheetActionAvailability", () => {
  it("offers MARK SEATED to a booked party and withdraws it once seated", () => {
    expect(sheetActionAvailability({ resName: "Weber", resTime: "20:00" }).markSeated).toBe(true);
    expect(sheetActionAvailability({ active: true }).markSeated).toBe(false);
  });

  it("only offers MARK ARRIVING from the terrace, the one state the flow allows", () => {
    expect(sheetActionAvailability({ resName: "W" }, { visit: { visit: "terrace" } }).markArriving).toBe(true);
    expect(sheetActionAvailability({ active: true }).markArriving).toBe(false);
    expect(sheetActionAvailability({ active: true }, { visit: { visit: "arriving" } }).markArriving).toBe(false);
  });

  it("says nothing about setting — that lives in the COURSES panel", () => {
    // Setting a course is offered next to the course list, where the operator
    // can see WHICH course would be set. The grid never carried that context.
    const a = sheetActionAvailability({ active: true, courseReady: { key: "main" } });
    expect(a.setKitchen).toBeUndefined();
    expect(a.unsetKitchen).toBeUndefined();
  });

  it("hides MOVE / SWAP / JOIN on a combined booking and offers SPLIT instead", () => {
    const grouped = sheetActionAvailability({ active: true }, { isGrouped: true });
    expect(grouped.moveTable).toBe(false);
    expect(grouped.swapTable).toBe(false);
    expect(grouped.joinTable).toBe(false);
    expect(grouped.splitTable).toBe(true);

    const single = sheetActionAvailability({ active: true });
    expect(single.moveTable).toBe(true);
    expect(single.splitTable).toBe(false);
  });

  it("offers nothing destructive on a table with no party at all", () => {
    const blank = sheetActionAvailability({});
    expect(blank.clearTable).toBe(false);
    expect(blank.ticket).toBe(false);
    expect(blank.markSeated).toBe(false);
  });
});
