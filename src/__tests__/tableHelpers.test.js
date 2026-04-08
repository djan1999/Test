import { describe, it, expect } from "vitest";
import { makeSeats, blankTable, sanitizeTable, fmt, parseHHMM } from "../utils/tableHelpers.js";

describe("makeSeats", () => {
  it("creates n seats with default values", () => {
    const seats = makeSeats(3);
    expect(seats).toHaveLength(3);
    expect(seats[0]).toEqual({ id: 1, water: "—", aperitifs: [], glasses: [], cocktails: [], spirits: [], beers: [], pairing: "", extras: {} });
  });

  it("ids start at 1 and increment", () => {
    const seats = makeSeats(4);
    expect(seats.map(s => s.id)).toEqual([1, 2, 3, 4]);
  });

  it("carries over existing seat values from the ex array", () => {
    const ex = [{ water: "XC", glasses: ["g1"], cocktails: [], spirits: [], beers: [], pairing: "Wine", extras: { cake: true } }];
    const seats = makeSeats(2, ex);
    expect(seats[0].water).toBe("XC");
    expect(seats[0].glasses).toEqual(["g1"]);
    expect(seats[0].pairing).toBe("Wine");
    expect(seats[0].extras).toEqual({ cake: true });
  });

  it("uses defaults for seats beyond the ex array length", () => {
    const ex = [{ water: "OW", glasses: [], cocktails: [], spirits: [], beers: [], pairing: "", extras: {} }];
    const seats = makeSeats(3, ex);
    expect(seats[1].water).toBe("—");
    expect(seats[2].water).toBe("—");
  });

  it("returns empty array for n=0", () => {
    expect(makeSeats(0)).toEqual([]);
  });
});

describe("blankTable", () => {
  it("creates a table with the given id", () => {
    const t = blankTable(5);
    expect(t.id).toBe(5);
  });

  it("starts inactive with 2 guests", () => {
    const t = blankTable(1);
    expect(t.active).toBe(false);
    expect(t.guests).toBe(2);
  });

  it("has 2 default seats", () => {
    const t = blankTable(1);
    expect(t.seats).toHaveLength(2);
  });

  it("has empty restrictions array", () => {
    expect(blankTable(1).restrictions).toEqual([]);
  });
});

describe("sanitizeTable", () => {
  it("fills in missing fields from blankTable", () => {
    const t = sanitizeTable({ id: 3, active: true, guests: 4 });
    expect(t.id).toBe(3);
    expect(t.active).toBe(true);
    expect(t.guests).toBe(4);
    expect(t.seats).toHaveLength(4);
    expect(t.restrictions).toEqual([]);
    expect(t.kitchenLog).toEqual({});
  });

  it("converts legacy bottleWine (singular) to bottleWines array", () => {
    const t = sanitizeTable({ id: 1, guests: 2, bottleWine: "Chardonnay" });
    expect(t.bottleWines).toEqual(["Chardonnay"]);
  });

  it("keeps bottleWines array as-is", () => {
    const t = sanitizeTable({ id: 1, guests: 2, bottleWines: ["A", "B"] });
    expect(t.bottleWines).toEqual(["A", "B"]);
  });

  it("resets non-array restrictions to empty array", () => {
    const t = sanitizeTable({ id: 1, guests: 2, restrictions: null });
    expect(t.restrictions).toEqual([]);
  });

  it("resets non-object kitchenLog to empty object", () => {
    const t = sanitizeTable({ id: 1, guests: 2, kitchenLog: "bad" });
    expect(t.kitchenLog).toEqual({});
  });

  it("resets non-object courseOverrides to empty object", () => {
    const t = sanitizeTable({ id: 1, guests: 2, courseOverrides: null });
    expect(t.courseOverrides).toEqual({});
  });

  it("resets non-array tableGroup to empty array", () => {
    const t = sanitizeTable({ id: 1, guests: 2, tableGroup: "bad" });
    expect(t.tableGroup).toEqual([]);
  });

  it("uses guests count to determine seat count", () => {
    const t = sanitizeTable({ id: 1, guests: 6 });
    expect(t.seats).toHaveLength(6);
  });
});

describe("fmt", () => {
  it("formats hours and minutes with leading zeros", () => {
    const d = new Date(2024, 0, 1, 9, 5);
    expect(fmt(d)).toBe("09:05");
  });

  it("formats double-digit times correctly", () => {
    const d = new Date(2024, 0, 1, 18, 30);
    expect(fmt(d)).toBe("18:30");
  });
});

describe("parseHHMM", () => {
  it("converts HH:MM string to minutes since midnight", () => {
    expect(parseHHMM("18:30")).toBe(18 * 60 + 30);
  });

  it("returns null for empty string", () => {
    expect(parseHHMM("")).toBeNull();
    expect(parseHHMM(null)).toBeNull();
  });

  it("returns null for invalid format", () => {
    expect(parseHHMM("not-a-time")).toBeNull();
  });

  it("handles midnight", () => {
    expect(parseHHMM("00:00")).toBe(0);
  });
});
