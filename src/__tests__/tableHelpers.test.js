import { describe, it, expect } from "vitest";
import { makeSeats, blankTable, sanitizeTable, fmt, parseHHMM, mergeTableGroups, tableGroupLabel } from "../utils/tableHelpers.js";

describe("makeSeats", () => {
  it("creates n seats with default values", () => {
    const seats = makeSeats(3);
    expect(seats).toHaveLength(3);
    expect(seats[0]).toEqual({ id: 1, gender: null, pairingSharedWith: null, water: "—", aperitifs: [], glasses: [], cocktails: [], spirits: [], beers: [], pairing: "", extras: {}, optionalPairings: {} });
  });

  it("ids start at 1 and increment", () => {
    const seats = makeSeats(4);
    expect(seats.map(s => s.id)).toEqual([1, 2, 3, 4]);
  });

  it("carries over existing seat values from the ex array", () => {
    const ex = [{ water: "XC", glasses: ["g1"], cocktails: [], spirits: [], beers: [], pairing: "Wine", extras: { cake: true }, optionalPairings: { crayfish: { ordered: true, mode: "alco" } } }];
    const seats = makeSeats(2, ex);
    expect(seats[0].water).toBe("XC");
    expect(seats[0].glasses).toEqual(["g1"]);
    expect(seats[0].pairing).toBe("Wine");
    expect(seats[0].extras).toEqual({ cake: true });
    expect(seats[0].optionalPairings).toEqual({ crayfish: { ordered: true, mode: "alco" } });
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

describe("mergeTableGroups", () => {
  const makeTbl = (id, overrides = {}) => ({
    ...blankTable(id),
    ...overrides,
  });
  const seatWith = (id, pairing = "Wine") => ({
    id, gender: null, pairingSharedWith: null, water: "—",
    aperitifs: [], glasses: [], cocktails: [], spirits: [], beers: [],
    pairing, extras: {}, optionalPairings: {},
  });

  it("returns a single row per explicit tableGroup, with the primary id only", () => {
    const tables = [
      makeTbl(2, { resName: "Stasik", resTime: "18:30", tableGroup: [2, 3], seats: [seatWith(1), seatWith(2)] }),
      makeTbl(3, { resName: "Stasik", resTime: "18:30", tableGroup: [2, 3], seats: makeSeats(4) }),
      makeTbl(5, { resName: "Other", resTime: "19:00", seats: [seatWith(1)] }),
    ];
    const merged = mergeTableGroups(tables);
    expect(merged.map(t => t.id)).toEqual([2, 5]);
    expect(merged[0].tableGroup).toEqual([2, 3]);
  });

  it("renumbers seats sequentially when merging across group members", () => {
    const tables = [
      makeTbl(2, { resName: "S", resTime: "18:30", tableGroup: [2, 3], seats: [seatWith(1, "Wine"), seatWith(2, "Non-Alc")] }),
      makeTbl(3, { resName: "S", resTime: "18:30", tableGroup: [2, 3], seats: [seatWith(1, "Premium")] }),
    ];
    const merged = mergeTableGroups(tables);
    expect(merged[0].seats.map(s => s.id)).toEqual([1, 2, 3]);
    expect(merged[0].seats.map(s => s.pairing)).toEqual(["Wine", "Non-Alc", "Premium"]);
  });

  it("drops empty placeholder seats from secondaries", () => {
    const tables = [
      makeTbl(2, { resName: "S", resTime: "18:30", tableGroup: [2, 3], seats: [seatWith(1, "Wine"), seatWith(2, "Wine")] }),
      makeTbl(3, { resName: "S", resTime: "18:30", tableGroup: [2, 3], seats: makeSeats(4) }), // all blank
    ];
    const merged = mergeTableGroups(tables);
    // The four blank placeholders on T03 must not become rows on the merged view.
    expect(merged[0].seats).toHaveLength(2);
  });

  it("auto-groups tables that share resName + resTime when tableGroup is missing", () => {
    const tables = [
      makeTbl(2, { resName: "Stasik", resTime: "18:30", seats: [seatWith(1)] }),
      makeTbl(3, { resName: "Stasik", resTime: "18:30", seats: [] }),
    ];
    const merged = mergeTableGroups(tables);
    expect(merged.map(t => t.id)).toEqual([2]);
    expect(merged[0].tableGroup).toEqual([2, 3]);
  });

  it("leaves single-table rows unchanged", () => {
    const tables = [makeTbl(4, { resName: "X", resTime: "19:00", seats: [seatWith(1)] })];
    const merged = mergeTableGroups(tables);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe(4);
    expect(merged[0].tableGroup).toEqual([]);
  });

  it("concatenates kitchen logs, bottle wines and restrictions across the group", () => {
    const tables = [
      makeTbl(2, {
        resName: "S", resTime: "18:30", tableGroup: [2, 3],
        seats: [seatWith(1)],
        kitchenLog: { course_a: { firedAt: "18:40" } },
        bottleWines: [{ name: "Bottle A" }],
        restrictions: [{ pos: 1, note: "veg" }],
      }),
      makeTbl(3, {
        resName: "S", resTime: "18:30", tableGroup: [2, 3],
        seats: [seatWith(1)],
        kitchenLog: { course_b: { firedAt: "18:50" } },
        bottleWines: [{ name: "Bottle B" }],
        restrictions: [{ pos: 1, note: "glut" }],
      }),
    ];
    const merged = mergeTableGroups(tables);
    expect(Object.keys(merged[0].kitchenLog)).toEqual(expect.arrayContaining(["course_a", "course_b"]));
    expect(merged[0].bottleWines.map(b => b.name)).toEqual(["Bottle A", "Bottle B"]);
    expect(merged[0].restrictions).toHaveLength(2);
  });
});

describe("tableGroupLabel", () => {
  it("returns padded single-table id when no group", () => {
    expect(tableGroupLabel({ id: 4 })).toBe("04");
  });
  it("returns hyphen-joined group ids when in a group", () => {
    expect(tableGroupLabel({ id: 2, tableGroup: [2, 3] })).toBe("02-03");
  });
  it("sorts group ids ascending regardless of input order", () => {
    expect(tableGroupLabel({ id: 5, tableGroup: [5, 2] })).toBe("02-05");
  });
});
