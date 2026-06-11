import { describe, it, expect } from "vitest";
import {
  toMonotonicMinutes,
  fireGapsForTable,
  median,
  estimateNextFire,
} from "../utils/fireCadence.js";

const at = hhmm => {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date("2026-06-11T00:00:00");
  d.setHours(h, m);
  return d;
};

const course = (i, firedAt = null) => ({ index: i, key: `c${i}`, name: `C${i}`, firedAt });

describe("toMonotonicMinutes", () => {
  it("converts and keeps ordering across midnight", () => {
    expect(toMonotonicMinutes(["23:50", "00:10", "00:40"])).toEqual([1430, 1450, 1480]);
  });
  it("skips unparseable stamps", () => {
    expect(toMonotonicMinutes(["19:00", null, "bogus", "19:30"])).toEqual([1140, 1170]);
  });
});

describe("fireGapsForTable", () => {
  it("includes arrival→first-fire and fire→fire intervals", () => {
    const table = { arrivedAt: "19:00" };
    const courses = [course(1, "19:20"), course(2, "19:45"), course(3)];
    expect(fireGapsForTable(table, courses)).toEqual([20, 25]);
  });
  it("discards gaps over 3h as stale data", () => {
    const table = { arrivedAt: "12:00" };
    expect(fireGapsForTable(table, [course(1, "19:00")])).toEqual([]);
  });
});

describe("median", () => {
  it("handles odd, even and empty inputs", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(2.5);
    expect(median([])).toBe(null);
  });
});

describe("estimateNextFire", () => {
  const table = { arrivedAt: "19:00" };

  it("uses the table's own rhythm when it has history", () => {
    // gaps 20 and 24 → cadence 22; last fire 19:44, now 19:50 → due in 16
    const courses = [course(1, "19:20"), course(2, "19:44"), course(3)];
    const est = estimateNextFire({ table, courses, now: at("19:50") });
    expect(est).toEqual({ dueInMin: 16, cadenceMin: 22, basis: "table" });
  });

  it("flags an overdue course with a negative dueInMin", () => {
    const courses = [course(1, "19:20"), course(2, "19:44"), course(3)];
    const est = estimateNextFire({ table, courses, now: at("20:15") });
    expect(est.dueInMin).toBe(-9);
  });

  it("falls back to the room's pooled cadence with thin own history", () => {
    // own gap (arrival→fire) exists but only one — room pool wins at ≥3
    const courses = [course(1, "19:20"), course(2)];
    const est = estimateNextFire({ table, courses, roomGaps: [15, 18, 21], now: at("19:30") });
    expect(est).toEqual({ dueInMin: 8, cadenceMin: 18, basis: "room" });
  });

  it("uses the single own interval when the room is silent too", () => {
    const courses = [course(1, "19:20"), course(2)];
    const est = estimateNextFire({ table, courses, roomGaps: [], now: at("19:25") });
    expect(est).toEqual({ dueInMin: 15, cadenceMin: 20, basis: "table" });
  });

  it("returns null with nothing fired or menu complete", () => {
    expect(estimateNextFire({ table, courses: [course(1)], now: at("19:30") })).toBe(null);
    expect(estimateNextFire({ table, courses: [course(1, "19:20")], now: at("19:30") })).toBe(null);
  });

  it("handles a service crossing midnight", () => {
    const t = { arrivedAt: "23:30" };
    const courses = [course(1, "23:50"), course(2, "00:10"), course(3)];
    const est = estimateNextFire({ table: t, courses, now: at("00:20") });
    expect(est).toEqual({ dueInMin: 10, cadenceMin: 20, basis: "table" });
  });
});
