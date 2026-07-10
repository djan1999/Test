import { describe, it, expect } from "vitest";
import {
  makeSeats, blankTable, sanitizeTable, fmt, parseHHMM, mergeTableGroups, tableGroupLabel,
  reservationDescriptiveFields, resolveReservationSession, tableHasServiceContent,
  remapTableGroup, reservationTableIds, mergeRestrictionPositions, swapSeatData,
  moveSeatOnFloor, seatFloorPosition, restrictionsAtFloorPositions,
  startedTablePatchFromReservation,
} from "../utils/tableHelpers.js";

describe("startedTablePatchFromReservation (mid-service reservation edits reach the live table)", () => {
  const startedTable = () => ({
    id: 1, active: true, guests: 2, arrivedAt: "19:00",
    seats: [
      { ...makeSeats(2)[0], water: "XC", pairing: "Wine" },
      { ...makeSeats(2)[1], water: "OW" },
    ],
    restrictions: [{ note: "gluten", pos: 2 }],
  });

  it("guest count change resizes the live table — existing P data survives", () => {
    const patch = startedTablePatchFromReservation(startedTable(), { resName: "N", guests: 4 });
    expect(patch.guests).toBe(4);
    expect(patch.seats).toHaveLength(4);
    expect(patch.seats[0].water).toBe("XC"); // P1's live orders kept
    expect(patch.seats[0].pairing).toBe("Wine");
    expect(patch.seats[1].water).toBe("OW");
  });

  it("shrinking drops the highest P's; a restriction pinned there goes UNASSIGNED, not lost", () => {
    const patch = startedTablePatchFromReservation(startedTable(), {
      resName: "N", guests: 1, restrictions: [{ note: "gluten", pos: null }],
    });
    expect(patch.guests).toBe(1);
    expect(patch.seats).toHaveLength(1);
    expect(patch.seats[0].water).toBe("XC");
    // gluten was pinned to P2 (kept via mergeRestrictionPositions) but P2 no
    // longer exists -> it resurfaces unassigned instead of vanishing.
    expect(patch.restrictions).toEqual([{ note: "gluten", pos: null }]);
  });

  it("unchanged guest count never rebuilds live seats (a rename is just a rename)", () => {
    const patch = startedTablePatchFromReservation(startedTable(), { resName: "Renamed", guests: 2 });
    expect(patch.resName).toBe("Renamed");
    expect("seats" in patch).toBe(false);
    expect("guests" in patch).toBe(false);
  });

  it("missing/invalid reservation guests leaves the table size alone", () => {
    const patch = startedTablePatchFromReservation(startedTable(), { resName: "N" });
    expect("seats" in patch).toBe(false);
    expect("guests" in patch).toBe(false);
  });

  it("server-assigned restriction positions survive the edit (merge semantics kept)", () => {
    const patch = startedTablePatchFromReservation(startedTable(), {
      resName: "N", guests: 2, restrictions: [{ note: "gluten", pos: null }],
    });
    expect(patch.restrictions).toEqual([{ note: "gluten", pos: 2 }]);
  });
});

describe("floor chair placement (guest ids stay stable)", () => {
  const key = "terrace:T23";
  const table = () => ({
    id: 1,
    guests: 2,
    seats: [
      { id: 1, water: "XC", floorPositions: {} },
      { id: 2, water: "OW", floorPositions: {} },
    ],
    restrictions: [{ note: "gluten", pos: 2 }],
  });

  it("moves P2 to empty chair 6 without creating P6", () => {
    const next = moveSeatOnFloor(table(), 2, 6, key);
    expect(next.seats.map((seat) => seat.id)).toEqual([1, 2]);
    expect(seatFloorPosition(next.seats[1], key)).toBe(6);
    expect(next.restrictions).toEqual([{ note: "gluten", pos: 2 }]);
    expect(restrictionsAtFloorPositions(next.seats, next.restrictions, key))
      .toEqual([{ note: "gluten", pos: 6 }]);
  });

  it("swaps occupied physical chairs while keeping guest labels", () => {
    const moved = moveSeatOnFloor(table(), 2, 6, key);
    const next = moveSeatOnFloor(moved, 1, 6, key);
    expect(next.seats.map((seat) => seat.id)).toEqual([1, 2]);
    expect(seatFloorPosition(next.seats[0], key)).toBe(6);
    expect(seatFloorPosition(next.seats[1], key)).toBe(1);
  });

  it("keeps chair assignments isolated per floor table", () => {
    const next = moveSeatOnFloor(table(), 2, 6, key);
    expect(seatFloorPosition(next.seats[1], "dining:T9")).toBe(2);
  });
});

describe("swapSeatData (guests trade places — payloads AND restrictions follow)", () => {
  const table = () => ({
    id: 1,
    seats: [
      { id: 1, water: "XC", pairing: "Wine", gender: "Mrs" },
      { id: 2, water: "OW", pairing: "Non-Alc", gender: "Mr" },
      { id: 3, water: "—", pairing: "" },
    ],
    restrictions: [
      { note: "gluten", pos: 1 },
      { note: "nuts", pos: 3 },
      { note: "vegan", pos: null }, // table-wide — untouched by a swap
    ],
  });

  it("swaps the two seat payloads in place, ids stay positional", () => {
    const next = swapSeatData(table(), 1, 2);
    expect(next.seats[0]).toEqual({ id: 1, water: "OW", pairing: "Non-Alc", gender: "Mr" });
    expect(next.seats[1]).toEqual({ id: 2, water: "XC", pairing: "Wine", gender: "Mrs" });
    expect(next.seats[2]).toEqual(table().seats[2]); // bystander untouched
  });

  it("positional restrictions travel WITH their guest", () => {
    const next = swapSeatData(table(), 1, 2);
    // the gluten guest moved from P1 to P2
    expect(next.restrictions.find((r) => r.note === "gluten").pos).toBe(2);
    expect(next.restrictions.find((r) => r.note === "nuts").pos).toBe(3);
    expect(next.restrictions.find((r) => r.note === "vegan").pos).toBeNull();
  });

  it("swapping two restricted guests exchanges their positions", () => {
    const next = swapSeatData(table(), 1, 3);
    expect(next.restrictions.find((r) => r.note === "gluten").pos).toBe(3);
    expect(next.restrictions.find((r) => r.note === "nuts").pos).toBe(1);
  });

  it("dropping on an EMPTY position MOVES the guest there — restrictions follow, order stays sorted", () => {
    const next = swapSeatData(table(), 1, 6);
    expect(next.seats.map((s) => Number(s.id))).toEqual([2, 3, 6]); // P1 became P6
    expect(next.seats.find((s) => Number(s.id) === 6)).toEqual({ id: 6, water: "XC", pairing: "Wine", gender: "Mrs" });
    expect(next.seats.some((s) => Number(s.id) === 1)).toBe(false); // old chair freed
    expect(next.restrictions.find((r) => r.note === "gluten").pos).toBe(6);
    expect(next.restrictions.find((r) => r.note === "nuts").pos).toBe(3);
  });

  it("dragging FROM an empty position is a no-op (nobody to move)", () => {
    const t = table();
    expect(swapSeatData(t, 9, 1)).toBe(t);
  });
});

describe("mergeRestrictionPositions (seat assignments survive reconcile)", () => {
  it("carries a board-assigned seat position onto the matching reservation restriction", () => {
    const prev = [{ note: "vegetarian", pos: 1 }, { note: "vegetarian", pos: 2 }];
    const next = [{ note: "vegetarian", pos: null }, { note: "vegetarian", pos: null }];
    expect(mergeRestrictionPositions(prev, next)).toEqual([
      { note: "vegetarian", pos: 1 },
      { note: "vegetarian", pos: 2 },
    ]);
  });

  it("keeps a position the reservation itself already specifies", () => {
    const prev = [{ note: "vegan", pos: 2 }];
    const next = [{ note: "vegan", pos: 1 }];
    expect(mergeRestrictionPositions(prev, next)).toEqual([{ note: "vegan", pos: 1 }]);
  });

  it("follows the reservation SET — drops removed, leaves added unassigned", () => {
    const prev = [{ note: "vegetarian", pos: 1 }];
    const next = [{ note: "gluten_free", pos: null }];
    expect(mergeRestrictionPositions(prev, next)).toEqual([{ note: "gluten_free", pos: null }]);
  });

  it("is safe with empty / missing inputs", () => {
    expect(mergeRestrictionPositions(undefined, undefined)).toEqual([]);
    expect(mergeRestrictionPositions([{ note: "x", pos: 1 }], [])).toEqual([]);
  });
});

describe("reservationTableIds (occupancy consistent with the board build)", () => {
  it("uses table_id for a normal single-table reservation", () => {
    expect(reservationTableIds({ tableGroup: [4] }, 4)).toEqual([4]);
    expect(reservationTableIds({}, 7)).toEqual([7]);
  });

  it("honours a real multi-table group", () => {
    expect(reservationTableIds({ tableGroup: [2, 3] }, 2)).toEqual([2, 3]);
  });

  it("IGNORES a corrupted single-member group pointing at the wrong table", () => {
    // Regression: Sandra is on T4 but her group was corrupted to [6]. Occupancy
    // must follow table_id (4), not the stray group — otherwise T6 (or a table
    // she was moved away from) shows phantom-occupied.
    expect(reservationTableIds({ tableGroup: [6] }, 4)).toEqual([4]);
    expect(reservationTableIds({ tableGroup: [6] }, 4)).not.toContain(6);
  });
});

describe("remapTableGroup (moved/swapped tables stay visible on the board)", () => {
  // The board renders only the "primary" of a group: id === min(tableGroup).
  const isPrimary = (t) => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup);

  it("retargets a single-table group so the moved table is still its own primary", () => {
    // Before: a reconciled single table T3 carries tableGroup [3].
    // Move its live state to T5. Without remap the moved table would carry [3],
    // and isPrimary({id:5, tableGroup:[3]}) === false → it vanishes.
    const moved = { id: 5, active: true, tableGroup: remapTableGroup([3], 3, 5) };
    expect(moved.tableGroup).toEqual([5]);
    expect(isPrimary(moved)).toBe(true);
  });

  it("swaps the ids for two grouped tables exchanged in place", () => {
    expect(remapTableGroup([2], 2, 7)).toEqual([7]); // T2's content now at T7
    expect(remapTableGroup([7], 2, 7)).toEqual([2]); // T7's content now at T2
  });

  it("keeps other members of a real multi-table group intact", () => {
    // Group [2,3] with T2 moved to T8 → [8,3].
    expect(remapTableGroup([2, 3], 2, 8).sort((a, b) => a - b)).toEqual([3, 8]);
  });

  it("returns [] for an empty/absent group (walk-in seated on a blank table)", () => {
    expect(remapTableGroup([], 3, 5)).toEqual([]);
    expect(remapTableGroup(undefined, 3, 5)).toEqual([]);
  });
});

describe("tableHasServiceContent (reconcile protection)", () => {
  it("is false for a blank table and a reservation-only table", () => {
    expect(tableHasServiceContent(blankTable(1))).toBe(false);
    // Reserved but not started: only reservation-derived metadata → NOT protected
    // (so the planner can still update or ghost-clear it).
    const reserved = { ...blankTable(2), resName: "Smith", resTime: "19:00",
      restrictions: [{ note: "gluten_free" }], seats: makeSeats(2) };
    expect(tableHasServiceContent(reserved)).toBe(false);
  });

  it("is true once staff enter anything during service", () => {
    expect(tableHasServiceContent({ ...blankTable(1), active: true })).toBe(true);
    expect(tableHasServiceContent({ ...blankTable(1), arrivedAt: "20:10" })).toBe(true);
    expect(tableHasServiceContent({ ...blankTable(1), kitchenLog: { c1: { firedAt: "20:30" } } })).toBe(true);
    expect(tableHasServiceContent({ ...blankTable(1), bottleWines: [{ name: "Movia" }] })).toBe(true);
  });

  it("is true when a seat has water/pairing/drinks even before SEAT is pressed", () => {
    const withWater = { ...blankTable(1), seats: makeSeats(2).map((s, i) => i === 0 ? { ...s, water: "Still" } : s) };
    expect(tableHasServiceContent(withWater)).toBe(true);
    const withGlass = { ...blankTable(1), seats: makeSeats(2).map((s, i) => i === 0 ? { ...s, glasses: [{ name: "Rebula" }] } : s) };
    expect(tableHasServiceContent(withGlass)).toBe(true);
    const withPairing = { ...blankTable(1), seats: makeSeats(2).map((s, i) => i === 0 ? { ...s, pairing: "Wine" } : s) };
    expect(tableHasServiceContent(withPairing)).toBe(true);
  });
});

describe("reservationDescriptiveFields", () => {
  it("maps reservation data to table label fields (menuType included)", () => {
    const fields = reservationDescriptiveFields({
      resName: "Smith", resTime: "12:30", menuType: "short", lang: "si",
      guestType: "hotel", rooms: ["12", "14"], birthday: true, cakeNote: "40th",
      restrictions: ["gluten_free"], notes: "window seat",
      kitchenCourseNotes: { sour_soup: { name: "No chili" } },
    });
    expect(fields.menuType).toBe("short");
    expect(fields.resName).toBe("Smith");
    expect(fields.room).toBe("12");
    expect(fields.rooms).toEqual(["12", "14"]);
    expect(fields.birthday).toBe(true);
    expect(fields.cakeNote).toBe("40th");
    expect(fields.kitchenCourseNotes).toEqual({ sour_soup: { name: "No chili" } });
  });

  it("never includes live-service fields (seats, guests, kitchenLog, tableGroup)", () => {
    const fields = reservationDescriptiveFields({ menuType: "short", guests: 6, seats: [{ id: 1 }] });
    expect(fields).not.toHaveProperty("seats");
    expect(fields).not.toHaveProperty("guests");
    expect(fields).not.toHaveProperty("kitchenLog");
    expect(fields).not.toHaveProperty("tableGroup");
    expect(fields).not.toHaveProperty("arrivedAt");
    expect(fields).not.toHaveProperty("active");
  });

  it("clears cakeNote when birthday is off and defaults everything safely", () => {
    const fields = reservationDescriptiveFields({ cakeNote: "stale", room: "3" });
    expect(fields.cakeNote).toBe("");
    expect(fields.menuType).toBe("");
    expect(fields.lang).toBe("en");
    expect(fields.rooms).toEqual(["3"]);
    expect(reservationDescriptiveFields().restrictions).toEqual([]);
  });
});

describe("resolveReservationSession", () => {
  it("uses the explicit session when present", () => {
    expect(resolveReservationSession({ service_session: "lunch", resTime: "19:00" })).toBe("lunch");
    expect(resolveReservationSession({ service_session: "dinner", resTime: "12:00" })).toBe("dinner");
  });

  it("falls back to the time heuristic for legacy rows", () => {
    expect(resolveReservationSession({ resTime: "12:30" })).toBe("lunch");
    expect(resolveReservationSession({ resTime: "19:00" })).toBe("dinner");
    expect(resolveReservationSession({ resTime: "" })).toBe("dinner");
    expect(resolveReservationSession({})).toBe("dinner");
  });
});

describe("makeSeats", () => {
  it("creates n seats with default values", () => {
    const seats = makeSeats(3);
    expect(seats).toHaveLength(3);
    expect(seats[0]).toEqual({ id: 1, gender: null, pairingSharedWith: null, water: "—", aperitifs: [], glasses: [], cocktails: [], spirits: [], beers: [], pairing: "", extras: {}, floorPositions: {}, optionalPairings: {} });
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

  it("migrates an old out-of-range positional id back into the missing guest slot", () => {
    const seats = makeSeats(2, [
      { id: 1, water: "XC" },
      { id: 6, water: "OW", pairing: "Wine" },
    ]);
    expect(seats.map((seat) => seat.id)).toEqual([1, 2]);
    expect(seats[1].water).toBe("OW");
    expect(seats[1].pairing).toBe("Wine");
  });

  it("keeps physical chairs unique when guest count grows into an occupied chair number", () => {
    const key = "terrace:T23";
    const seats = makeSeats(6, [
      { id: 1, floorPositions: {} },
      { id: 2, floorPositions: { [key]: 6 } },
    ]);
    expect(seatFloorPosition(seats[1], key)).toBe(6);
    expect(seatFloorPosition(seats[5], key)).toBe(2);
    expect(new Set(seats.map((seat) => seatFloorPosition(seat, key))).size).toBe(6);
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

  it("birthday-seeded celebration extras don't turn secondary blanks into seat rows", () => {
    // The reconcile stamps cake { ordered: true } on EVERY seat of EVERY
    // group member of a birthday reservation — a 4-guest party on T02-03
    // showed 8 archive rows (P5-P8 empty) because T03's placeholders carried
    // the seeded cake and passed the content check.
    const withCake = (s) => ({ ...s, extras: { cake: { ordered: true, pairing: "—" } } });
    const tables = [
      makeTbl(2, {
        resName: "Finn", resTime: "18:00", guests: 4, birthday: true, tableGroup: [2, 3],
        seats: [seatWith(1), seatWith(2), seatWith(3), seatWith(4)].map(withCake),
      }),
      makeTbl(3, {
        resName: "Finn", resTime: "18:00", guests: 4, birthday: true, tableGroup: [2, 3],
        seats: makeSeats(4).map(withCake), // blanks + seeded cake only
      }),
    ];
    const merged = mergeTableGroups(tables, ["cake"]);
    expect(merged[0].seats).toHaveLength(4); // the real guests, not 8
    expect(merged[0]._groupGuests).toBe(4);
    // …and the real guests' seeded cake still travels with them.
    expect(merged[0].seats.every(s => s.extras?.cake?.ordered)).toBe(true);
  });

  it("does not double-count guests across group members (reconcile sets the same count on each)", () => {
    // Regression: the service-board reconcile assigns the full reservation
    // guest count to every member of a multi-table group. A previous version
    // of mergeTableGroups summed `m.guests` across members, so a 4-guest
    // T02+T03 reservation was reported as 8 in the archive summary.
    const tables = [
      makeTbl(2, { resName: "S", resTime: "18:30", tableGroup: [2, 3], guests: 4, seats: [seatWith(1), seatWith(2), seatWith(3), seatWith(4)] }),
      makeTbl(3, { resName: "S", resTime: "18:30", tableGroup: [2, 3], guests: 4, seats: makeSeats(4) }),
    ];
    const merged = mergeTableGroups(tables);
    expect(merged).toHaveLength(1);
    expect(merged[0]._groupGuests).toBe(4);
  });

  it("falls back to content-seat count when the primary has no guests value", () => {
    const tables = [
      makeTbl(2, { resName: "S", resTime: "18:30", tableGroup: [2, 3], guests: 0, seats: [seatWith(1), seatWith(2)] }),
      makeTbl(3, { resName: "S", resTime: "18:30", tableGroup: [2, 3], guests: 0, seats: [seatWith(1)] }),
    ];
    const merged = mergeTableGroups(tables);
    expect(merged[0]._groupGuests).toBe(3);
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
