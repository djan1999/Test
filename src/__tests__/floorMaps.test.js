import { describe, it, expect } from "vitest";
import {
  buildDefaultFloorMaps, sanitizeFloorMaps, getActiveDiningMap, getTerraceMap,
  findMapTable, resolveReservationTable, boardIdsOf, mapSeatCountForBoardTable,
  planLayoutSwitch, applyLayoutSwitchRow, seatDisplayPoints, assignSeatNumbers,
  terraceOccupancy, sanitizeTerraceState, isTerraceDirty, setTerraceDirty,
  GEOMETRY_VERSION, MAP_W, MAP_H,
  moveTable, resizeTable, rotateTable, setTableShape, renameTable,
  duplicateTable, addTable, deleteTable,
  addSeat, removeSeat, moveSeat,
  setTableMembers, setTableBoardIds,
  addMap, renameMap, duplicateMap, deleteMap, hasDefaultGeometry, resetMapToDefaults,
  sanitizeFloorStatus, floorStatusOf, setFloorStatus, cycleFloorStatus,
  migrateTerraceState, mapTicker,
  sheetOf, doorGeometry, hitTestSheet,
  addWall, setWallDashed, deleteWall, addDoorAt, patchOpening, deleteOpening,
  addZoneAt, patchZone, deleteZone, addPlanterAt, patchPlanter, deletePlanter,
} from "../utils/floorMaps.js";

const state = buildDefaultFloorMaps();
const mapA = state.maps.find((m) => m.id === "dining_a");
const mapB = state.maps.find((m) => m.id === "dining_b");

const res = (id, tableId, data = {}) => ({ id, table_id: tableId, data });

describe("seed maps (house diagrams appendix)", () => {
  it("Layout A: T2-3 merged, T5 present, T6 and T7 separate", () => {
    expect(findMapTable(mapA, "T2-3").members).toEqual(["T2", "T3"]);
    expect(findMapTable(mapA, "T5")).toBeTruthy();
    expect(findMapTable(mapA, "T6").members).toBeUndefined();
    expect(findMapTable(mapA, "T7").shape).toBe("rect");
    expect(findMapTable(mapA, "T6-7")).toBeNull();
  });

  it("Layout B: T2-3 AND T6-7 merged, round T7, no T5", () => {
    expect(findMapTable(mapB, "T6-7").members).toEqual(["T6", "T7"]);
    expect(findMapTable(mapB, "T7").shape).toBe("round");
    expect(findMapTable(mapB, "T5")).toBeNull();
  });

  it("board-slot claims never overlap within a map (T6-7 merge leaves slot 7 to the round T7)", () => {
    for (const map of [mapA, mapB]) {
      const claimed = map.tables.flatMap((t) => boardIdsOf(t));
      expect(new Set(claimed).size).toBe(claimed.length);
    }
    expect(boardIdsOf(findMapTable(mapB, "T6-7"))).toEqual([6]);
    expect(boardIdsOf(findMapTable(mapB, "T7"))).toEqual([7]);
    expect(boardIdsOf(findMapTable(mapB, "T2-3"))).toEqual([2, 3]);
  });

  it("acceptance 14 — seat numbering matches the diagrams: T2-3, T6-7, T10", () => {
    // T2-3: 1=SW 2=NW 3=NE 4=SE (both layouts)
    const t23 = findMapTable(mapA, "T2-3").seats;
    expect(t23.map((s) => [s.no, s.side, s.offset < 0.5 ? "w" : "e"])).toEqual([
      [1, "S", "w"], [2, "N", "w"], [3, "N", "e"], [4, "S", "e"],
    ]);
    // T6-7 (Layout B): 1=NW 2=NE 3=SE 4=SW
    const t67 = findMapTable(mapB, "T6-7").seats;
    expect(t67.map((s) => [s.no, s.side, s.offset < 0.5 ? "w" : "e"])).toEqual([
      [1, "N", "w"], [2, "N", "e"], [3, "S", "e"], [4, "S", "w"],
    ]);
    // T10: 1=E 2=W (round → angles)
    const t10 = findMapTable(mapB, "T10").seats;
    expect(t10.map((s) => [s.no, s.angle])).toEqual([[1, 90], [2, 270]]);
  });

  it("unmarked numberings from the diagrams carry the CONFIRM marker", () => {
    expect(findMapTable(mapA, "T7").seats.every((s) => s.confirm)).toBe(true);
    expect(findMapTable(mapA, "T8").seats.every((s) => s.confirm)).toBe(true);
    expect(findMapTable(mapB, "T7").seats.every((s) => s.confirm)).toBe(true);
    expect(findMapTable(mapA, "T4").seats.some((s) => s.confirm)).toBe(false);
  });
});

describe("sanitizeFloorMaps", () => {
  it("junk / empty → defaults", () => {
    expect(sanitizeFloorMaps(null).maps.length).toBe(3);
    expect(sanitizeFloorMaps({ maps: [] }).activeDiningMapId).toBe("dining_a");
    expect(sanitizeFloorMaps("garbage").config.moveSingleTap).toBe(false);
  });

  it("keeps a valid stored state and backfills config", () => {
    const stored = { maps: state.maps, activeDiningMapId: "dining_b" };
    const s = sanitizeFloorMaps(stored);
    expect(s.activeDiningMapId).toBe("dining_b");
    expect(s.config.moveSingleTap).toBe(false);
  });

  it("invalid activeDiningMapId falls back to a dining map", () => {
    const s = sanitizeFloorMaps({ maps: state.maps, activeDiningMapId: "terrace_main" });
    expect(getActiveDiningMap(s).kind).toBe("dining");
  });
});

describe("reservation ↔ layout resolution (acceptance 11)", () => {
  it("exact label match wins over member match: res T7 in Layout B → the round T7", () => {
    const { table, match } = resolveReservationTable(mapB, 7);
    expect(match).toBe("exact");
    expect(table.shape).toBe("round");
    expect(boardIdsOf(table)).toEqual([7]);
  });

  it("member match: res T6 in Layout B → T6-7", () => {
    const { table, match } = resolveReservationTable(mapB, 6);
    expect(match).toBe("member");
    expect(table.label).toBe("T6-7");
  });

  it("unresolved: res T5 in Layout B → NEEDS TABLE", () => {
    expect(resolveReservationTable(mapB, 5)).toEqual({ table: null, match: null });
  });
});

describe("mapSeatCountForBoardTable (acceptance 13)", () => {
  it("T9 offers 3 seats under Layout B and only 2 under Layout A", () => {
    expect(mapSeatCountForBoardTable(mapB, 9)).toBe(3);
    expect(mapSeatCountForBoardTable(mapA, 9)).toBe(2);
  });
  it("merged table caps at the merge's seat count; unresolved → null", () => {
    expect(mapSeatCountForBoardTable(mapB, 6)).toBe(4);
    expect(mapSeatCountForBoardTable(mapB, 5)).toBeNull();
  });
});

describe("planLayoutSwitch (acceptance 12)", () => {
  it("A→B: T6 re-resolves onto T6-7 (same slot → unchanged), T5 flags NEEDS TABLE, T2 gains the merge group", () => {
    const rows = planLayoutSwitch(mapB, [
      res("a", 6, { resName: "NOVAK" }),
      res("b", 5, { resName: "KOS" }),
      res("c", 7, { resName: "ZUPAN" }),
      res("d", 2, { resName: "HRIBAR" }),
    ]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    // slot claim stays [6]; the merge is presentational, no reservation write
    expect(byId.a).toMatchObject({ status: "unchanged", from: [6], to: [6], label: "T6-7" });
    expect(byId.b).toMatchObject({ status: "needs_table", to: null });
    expect(byId.c).toMatchObject({ status: "unchanged", to: [7] });
    // T2-3 claims both slots → res on T2 alone becomes a move onto the pair
    expect(byId.d).toMatchObject({ status: "move", from: [2], to: [2, 3] });
  });

  it("a combined booking dissolving back to singles is a move", () => {
    const rows = planLayoutSwitch(mapA, [res("a", 6, { tableGroup: [6, 7] })]);
    expect(rows[0]).toMatchObject({ status: "move", from: [6, 7], to: [6] });
  });

  it("overlapping claims within one session are conflicts; across sessions they are not", () => {
    const clash = planLayoutSwitch(mapB, [
      res("a", 6, { service_session: "dinner" }),
      res("b", 6, { service_session: "dinner", tableGroup: [6, 7] }),
    ]);
    expect(clash.every((r) => r.status === "conflict")).toBe(true);
    const fine = planLayoutSwitch(mapB, [
      res("a", 6, { service_session: "lunch" }),
      res("b", 6, { service_session: "dinner" }),
    ]);
    expect(fine.every((r) => r.status === "unchanged")).toBe(true);
  });

  it("applyLayoutSwitchRow applies only moves and writes table_id + tableGroup", () => {
    const rows = planLayoutSwitch(mapB, [res("a", 2, { resName: "X" })]);
    expect(rows[0].status).toBe("move"); // T2 → T2-3 [2,3]
    const next = applyLayoutSwitchRow(rows[0], res("a", 2, { resName: "X" }));
    expect(next.table_id).toBe(2);
    expect(next.data.tableGroup).toEqual([2, 3]);
    expect(applyLayoutSwitchRow({ status: "conflict" }, res("a", 2))).toBeNull();
    expect(applyLayoutSwitchRow({ status: "needs_table" }, res("a", 2))).toBeNull();
  });
});

describe("seatDisplayPoints", () => {
  it("rect seats land on the named edge with an outward normal", () => {
    const pts = seatDisplayPoints({ x: 10, y: 20, w: 10, h: 6, seats: [{ no: 1, side: "W", offset: 0.5 }, { no: 2, side: "E", offset: 0.5 }] });
    expect(pts[0]).toMatchObject({ no: 1, x: 10, y: 23, out: { x: -1, y: 0 } });
    expect(pts[1]).toMatchObject({ no: 2, x: 20, y: 23, out: { x: 1, y: 0 } });
  });
  it("round seats land on the circle at the compass angle", () => {
    const pts = seatDisplayPoints({ x: 0, y: 0, w: 10, h: 10, seats: [{ no: 1, angle: 90 }, { no: 2, angle: 270 }] });
    expect(pts[0].x).toBeCloseTo(10); expect(pts[0].y).toBeCloseTo(5); // E
    expect(pts[1].x).toBeCloseTo(0);  expect(pts[1].y).toBeCloseTo(5); // W
  });
});

describe("assignSeatNumbers (SEATS mode)", () => {
  const seats = [
    { no: 1, side: "N", offset: 0.5, confirm: true },
    { no: 2, side: "S", offset: 0.5, confirm: true },
  ];
  it("partial sequence previews with untapped seats blanked", () => {
    const { seats: prev, complete } = assignSeatNumbers(seats, [1]);
    expect(complete).toBe(false);
    expect(prev[1].no).toBe(1);
    expect(prev[0].no).toBeNull();
  });
  it("full sequence commits 1..n in tap order and clears the CONFIRM marker", () => {
    const { seats: next, complete } = assignSeatNumbers(seats, [1, 0]);
    expect(complete).toBe(true);
    expect(next.map((s) => s.no)).toEqual([2, 1]);
    expect(next.some((s) => s.confirm)).toBe(false);
  });
  it("ignores duplicate and out-of-range taps", () => {
    const { complete } = assignSeatNumbers(seats, [0, 0, 9]);
    expect(complete).toBe(false);
  });
});

describe("terrace occupancy + DIRTY state", () => {
  it("occupancy derives only from terrace-state reservations with a table", () => {
    const occ = terraceOccupancy([
      res("a", 4, { visit_state: "terrace", terrace_table: "T23", resName: "NOVAK" }),
      res("b", 5, { visit_state: "arriving", terrace_table: "T24" }), // moved → freed
      res("c", 6, { visit_state: "terrace", terrace_table: null }),   // cleared
      res("d", 7, {}),                                                 // legacy row
    ]);
    expect(Object.keys(occ)).toEqual(["T23"]);
    expect(occ.T23.data.resName).toBe("NOVAK");
  });

  it("dirty flags set/clear per label and survive junk state", () => {
    let ts = sanitizeTerraceState(null);
    ts = setTerraceDirty(ts, "T23", true);
    expect(isTerraceDirty(ts, "T23")).toBe(true);
    ts = setTerraceDirty(ts, "T23", false);
    expect(isTerraceDirty(ts, "T23")).toBe(false);
    expect(sanitizeTerraceState("junk").dirty).toEqual({});
  });
});

/* ── floor-first correction: geometry editor + status helpers ─────────────── */

describe("geometry version (the unfreeze)", () => {
  it("defaults carry the current version; pre-version blobs sanitize to 1", () => {
    expect(buildDefaultFloorMaps().geometryVersion).toBe(GEOMETRY_VERSION);
    const stored = { maps: state.maps, activeDiningMapId: "dining_a" };
    expect(sanitizeFloorMaps(stored).geometryVersion).toBe(1);
    expect(sanitizeFloorMaps({ ...stored, geometryVersion: 2 }).geometryVersion).toBe(2);
  });

  it("resetMapToDefaults replaces only that map's tables and stamps the version", () => {
    let s = sanitizeFloorMaps({ ...buildDefaultFloorMaps(), geometryVersion: 1 });
    s = moveTable(s, "dining_a", "T1", 50, 50);
    s = moveTable(s, "dining_b", "T1", 60, 60);
    const reset = resetMapToDefaults(s, "dining_a");
    expect(findMapTable(reset.maps.find((m) => m.id === "dining_a"), "T1").x).toBe(8);
    expect(findMapTable(reset.maps.find((m) => m.id === "dining_b"), "T1").x).toBe(60); // untouched
    expect(reset.geometryVersion).toBe(GEOMETRY_VERSION);
  });

  it("no seed for user-created maps → no reset, state identity kept", () => {
    const s = addMap(state, "dining");
    const newId = s.maps[s.maps.length - 1].id;
    expect(hasDefaultGeometry(newId)).toBe(false);
    expect(resetMapToDefaults(s, newId)).toBe(s);
  });
});

describe("table ops", () => {
  it("moveTable snaps to the unit grid and clamps to the canvas", () => {
    // x 33 is already edge-aligned (T1's right edge 45 = T9's right edge),
    // so the magnet holds it there rather than pulling toward T6
    const s = moveTable(state, "dining_a", "T1", 33.4, -5);
    const t = findMapTable(getActiveDiningMap(s), "T1");
    expect([t.x, t.y]).toEqual([33, 0]);
    const far = findMapTable(getActiveDiningMap(moveTable(state, "dining_a", "T1", 999, 999)), "T1");
    expect([far.x, far.y]).toEqual([MAP_W - t.w, MAP_H - t.h]);
  });

  it("magnetic drop: a near-miss lands edge-level with the neighbour", () => {
    // T1 (h9) dropped at y=9.6 → snap 10, bottom edge 19 pulls level with
    // T2-3's bottom edge 18 → y 9; x 50 has no edge in reach and stays put
    const s = moveTable(state, "dining_a", "T1", 50, 9.6);
    const t = findMapTable(getActiveDiningMap(s), "T1");
    expect([t.x, t.y]).toEqual([50, 9]);
  });

  it("resizeTable enforces minimums; rotateTable swaps w/h and re-clamps", () => {
    const small = findMapTable(getActiveDiningMap(resizeTable(state, "dining_a", "T1", 1, 1)), "T1");
    expect([small.w, small.h]).toEqual([4, 4]);
    const rot = findMapTable(getActiveDiningMap(rotateTable(state, "dining_a", "T1")), "T1");
    expect([rot.w, rot.h]).toEqual([9, 12]);
  });

  it("renameTable uppercases, rejects empty and duplicate labels", () => {
    const ok = renameTable(state, "dining_a", "T1", " t99 ");
    expect(findMapTable(getActiveDiningMap(ok), "T99")).toBeTruthy();
    expect(renameTable(state, "dining_a", "T1", "T4")).toBe(state);
    expect(renameTable(state, "dining_a", "T1", "  ")).toBe(state);
  });

  it("duplicateTable copies geometry+seats but drops boardIds/members (no claim collisions)", () => {
    const s = duplicateTable(state, "dining_a", "T2-3");
    const copy = findMapTable(getActiveDiningMap(s), "T2-3'");
    expect(copy).toBeTruthy();
    expect(copy.seats.length).toBe(4);
    expect(copy.boardIds).toBeUndefined();
    expect(copy.members).toBeUndefined();
  });

  it("addTable takes the first free T-number with two default seats; deleteTable removes", () => {
    const s = addTable(state, "dining_b"); // T1..T4,T6..T10 exist → T5 free
    const t = findMapTable(s.maps.find((m) => m.id === "dining_b"), "T5");
    expect(t).toBeTruthy();
    expect(t.seats.length).toBe(2);
    const gone = deleteTable(s, "dining_b", "T5");
    expect(findMapTable(gone.maps.find((m) => m.id === "dining_b"), "T5")).toBeNull();
  });

  it("ops on unknown map/label return the same state object", () => {
    expect(moveTable(state, "nope", "T1", 1, 1)).toBe(state);
    expect(deleteTable(state, "dining_a", "T77")).toBe(state);
  });
});

describe("seat ops", () => {
  it("addSeat appends the next number (no CONFIRM); removeSeat compacts numbering", () => {
    let s = addSeat(state, "dining_a", "T8"); // 2 → 3 seats
    let t = findMapTable(getActiveDiningMap(s), "T8");
    expect(t.seats.length).toBe(3);
    expect(t.seats[2].no).toBe(3);
    expect(t.seats[2].confirm).toBeUndefined();
    s = removeSeat(s, "dining_a", "T8", 0); // drop seat no 1 → renumber to 1..2
    t = findMapTable(getActiveDiningMap(s), "T8");
    expect(t.seats.map((x) => x.no).sort()).toEqual([1, 2]);
  });

  it("moveSeat on a rect projects onto the nearest side; offsets magnet onto the house stops", () => {
    // T8 at x8 y68 w12 h9 — a point just above the top edge, ~1/4 along it:
    // raw offset 0.25 pulls onto the canonical corner stop 0.22
    const s = moveSeat(state, "dining_a", "T8", 0, { x: 11, y: 67 });
    const seat = findMapTable(getActiveDiningMap(s), "T8").seats[0];
    expect(seat.side).toBe("N");
    expect(seat.offset).toBe(0.22);
    expect(seat.no).toBe(1);           // number travels with the seat
    expect(seat.confirm).toBe(true);   // moving is not renumbering
    // away from the stops, offsets land on the 0.05 grid
    const mid = moveSeat(state, "dining_a", "T8", 0, { x: 12.2, y: 67 });
    expect(findMapTable(getActiveDiningMap(mid), "T8").seats[0].offset).toBe(0.35);
  });

  it("moveSeat on a round table converts to the compass angle on 15° steps", () => {
    // T5 at x8 y38 w11 h11 → center (13.5, 43.5); point a hair off due E
    const s = moveSeat(state, "dining_a", "T5", 0, { x: 20, y: 43 });
    const seat = findMapTable(getActiveDiningMap(s), "T5").seats[0];
    expect(seat.angle).toBe(90);
    expect(seat.side).toBeUndefined();
  });
});

describe("merge ops", () => {
  it("setTableMembers keeps ≥2 distinct labels, else drops the merge", () => {
    const s = setTableMembers(state, "dining_a", "T6", ["t6", "T7", "T7"]);
    expect(findMapTable(getActiveDiningMap(s), "T6").members).toEqual(["T6", "T7"]);
    const solo = setTableMembers(s, "dining_a", "T6", ["T6"]);
    expect(findMapTable(getActiveDiningMap(solo), "T6").members).toBeUndefined();
  });

  it("setTableBoardIds sanitizes to sorted unique ints 1..10", () => {
    const s = setTableBoardIds(state, "dining_a", "T6", [7, "6", 6, 99, 0]);
    expect(findMapTable(getActiveDiningMap(s), "T6").boardIds).toEqual([6, 7]);
  });
});

describe("map ops", () => {
  it("addMap creates an empty map of the kind with unique id + name", () => {
    const s = addMap(addMap(state, "dining"), "dining");
    const added = s.maps.filter((m) => m.name.startsWith("NEW LAYOUT"));
    expect(added.length).toBe(2);
    expect(new Set(added.map((m) => m.id)).size).toBe(2);
    expect(added[0].tables).toEqual([]);
  });

  it("duplicateMap deep-copies tables under '<NAME> COPY' (the LAYOUT C path)", () => {
    const s = duplicateMap(state, "dining_a");
    const copy = s.maps.find((m) => m.name === "LAYOUT A COPY");
    expect(copy.tables.length).toBe(mapA.tables.length);
    expect(copy.tables[0]).not.toBe(mapA.tables[0]); // deep, not shared
    const moved = moveTable(s, copy.id, "T1", 50, 50);
    expect(findMapTable(getActiveDiningMap(moved), "T1").x).toBe(8); // source untouched
  });

  it("deleteMap: last-of-kind is undeletable; deleting the active dining map falls back", () => {
    expect(deleteMap(state, "terrace_main")).toBe(state); // only terrace map
    const s = deleteMap(state, "dining_a");
    expect(s.maps.some((m) => m.id === "dining_a")).toBe(false);
    expect(s.activeDiningMapId).toBe("dining_b");
    expect(deleteMap(s, "dining_b")).toBe(s); // now the last dining map
  });

  it("renameMap uppercases and rejects empty", () => {
    expect(renameMap(state, "dining_a", "layout c").maps[0].name).toBe("LAYOUT C");
    expect(renameMap(state, "dining_a", " ")).toBe(state);
  });
});

describe("floor status (SET/DIRTY strips)", () => {
  it("tap toggles SET; a tap on auto-DIRTY clears it (MARK CLEAN); empty buckets prune", () => {
    let st = {};
    st = cycleFloorStatus(st, "dining_a", "T3");
    expect(floorStatusOf(st, "dining_a", "T3")).toBe("SET");
    st = cycleFloorStatus(st, "dining_a", "T3");
    expect(floorStatusOf(st, "dining_a", "T3")).toBeNull();
    expect(st).toEqual({});
    // DIRTY is only ever set automatically (terrace vacate) — a tap clears it
    st = setFloorStatus({}, "terrace_main", "T23", "DIRTY");
    st = cycleFloorStatus(st, "terrace_main", "T23");
    expect(floorStatusOf(st, "terrace_main", "T23")).toBeNull();
  });

  it("sanitize drops junk values and junk shapes; setFloorStatus guards ids", () => {
    expect(sanitizeFloorStatus({ m1: { T1: "SET", T2: "WET" }, m2: "junk", m3: {} }))
      .toEqual({ m1: { T1: "SET" } });
    expect(sanitizeFloorStatus(null)).toEqual({});
    expect(setFloorStatus({ m1: { T1: "SET" } }, null, "T1", "DIRTY")).toEqual({ m1: { T1: "SET" } });
  });

  it("statuses are keyed per map — layouts don't share strips", () => {
    const st = setFloorStatus({}, "dining_a", "T3", "DIRTY");
    expect(floorStatusOf(st, "dining_b", "T3")).toBeNull();
  });

  it("migrateTerraceState folds legacy dirty labels once, never over live strips", () => {
    const legacy = { dirty: { T23: true, T25: true } };
    expect(migrateTerraceState({}, legacy, "terrace_main"))
      .toEqual({ terrace_main: { T23: "DIRTY", T25: "DIRTY" } });
    const live = { terrace_main: { T22: "SET" } };
    expect(migrateTerraceState(live, legacy, "terrace_main")).toEqual(live);
    expect(migrateTerraceState({}, legacy, null)).toEqual({});
    expect(migrateTerraceState({}, null, "terrace_main")).toEqual({});
  });
});

describe("mapTicker", () => {
  it("counts covers/seated/reserved/set/dirty from the visible map's entries", () => {
    expect(mapTicker([
      { status: "occupied", pax: 2, strip: "SET" },
      { status: "occupied", pax: 4 },
      { status: "reserved" },
      { status: "arriving" },
      { status: "free", strip: "DIRTY" },
      null,
    ])).toEqual({ covers: 6, seated: 2, reserved: 2, set: 1, dirty: 1 });
    expect(mapTicker(undefined)).toEqual({ covers: 0, seated: 0, reserved: 0, set: 0, dirty: 0 });
  });
});

/* ── SHEET layer: walls / doors / zones / planters ────────────────────────── */

describe("sheet layer (architecture)", () => {
  const freshState = () => buildDefaultFloorMaps();
  const sheetIn = (s, mapId = "dining_a") => sheetOf(s.maps.find((m) => m.id === mapId));

  it("seeds carry sheets and the sanitizer keeps them (maps stay whole)", () => {
    const s = freshState();
    expect(sheetIn(s).walls.length).toBe(1);
    expect(sheetIn(s).zones[0].label).toBe("PASS / KITCHEN");
    expect(sheetIn(s, "terrace_main").planters.length).toBe(3);
    const round = sanitizeFloorMaps(JSON.parse(JSON.stringify(s)));
    expect(sheetIn(round).openings.length).toBe(1);
    expect(sheetOf({ id: "x", tables: [] })).toEqual({ walls: [], openings: [], zones: [], planters: [] });
  });

  it("addWall snaps points and needs 2 (open) / 3 (closed); deleteWall drops its openings", () => {
    let s = addWall(freshState(), "dining_a", [[10.4, 10.6], [40.2, 10.6]], false);
    const wall = sheetIn(s).walls[1];
    expect(wall.pts).toEqual([[10, 11], [40, 11]]);
    expect(wall.closed).toBe(false);
    expect(addWall(s, "dining_a", [[1, 1], [2, 2]], true)).toBe(s); // closed needs 3
    // the seed wall carries the seed door — deleting it removes both
    s = deleteWall(s, "dining_a", "w1");
    expect(sheetIn(s).walls.map((w) => w.id)).toEqual(["w2"]);
    expect(sheetIn(s).openings).toEqual([]);
  });

  it("addDoorAt cuts into the nearest wall; far taps are a same-state no-op", () => {
    const s = freshState();
    const next = addDoorAt(s, "dining_a", { x: 30, y: 3 }); // near the top wall
    const doors = sheetIn(next).openings;
    expect(doors.length).toBe(2);
    expect(doors[1]).toMatchObject({ wallId: "w1", seg: 0, kind: "door" });
    expect(addDoorAt(s, "dining_a", { x: 50, y: 46 })).toBe(s); // mid-room, no wall
  });

  it("patchOpening clamps width and keeps the gap inside its segment", () => {
    const s = freshState();
    const wide = patchOpening(s, "dining_a", "o1", { width: 999 });
    const o = sheetIn(wide).openings[0];
    expect(o.width).toBe(30);
    // top segment is 96 long — a 30-wide gap at t=0.64 still fits with margin
    expect(o.t * 96 - o.width / 2).toBeGreaterThan(0);
    expect(patchOpening(s, "dining_a", "o1", { kind: "junk" }).maps[0].sheet.openings[0].kind).toBe("door");
    expect(sheetIn(deleteOpening(s, "dining_a", "o1")).openings).toEqual([]);
  });

  it("doorGeometry puts the gap on the segment with leaf + sweep", () => {
    const s = sheetIn(freshState());
    const g = doorGeometry(s.openings[0], s.walls);
    expect(g.center[1]).toBe(2); // on the top wall
    expect(Math.hypot(g.B[0] - g.A[0], g.B[1] - g.A[1])).toBeCloseTo(s.openings[0].width, 5);
    expect(doorGeometry({ ...s.openings[0], wallId: "nope" }, s.walls)).toBeNull();
  });

  it("zones and planters stamp, patch (clamped), drag-target and delete", () => {
    let s = addZoneAt(freshState(), "dining_a", { x: 50, y: 40 });
    const z = sheetIn(s).zones[1];
    expect(z).toMatchObject({ w: 26, h: 16, label: "ZONE" });
    s = patchZone(s, "dining_a", z.id, { label: "bar", w: 4, x: 999 });
    const z2 = sheetIn(s).zones[1];
    expect(z2.label).toBe("BAR");
    expect(z2.w).toBe(8);            // min width
    expect(z2.x).toBe(MAP_W - z2.w); // clamped on canvas
    expect(sheetIn(deleteZone(s, "dining_a", z.id)).zones.length).toBe(1);

    let t = addPlanterAt(freshState(), "terrace_main", { x: 70.4, y: 20.6 });
    const p = sheetIn(t, "terrace_main").planters[3];
    expect([p.x, p.y, p.r]).toEqual([70, 21, 3]);
    t = patchPlanter(t, "terrace_main", p.id, { r: 99 });
    expect(sheetIn(t, "terrace_main").planters[3].r).toBe(8);
    expect(sheetIn(deletePlanter(t, "terrace_main", p.id), "terrace_main").planters.length).toBe(3);
  });

  it("hitTestSheet precedence: door > planter > zone > wall > nothing", () => {
    const sheet = sheetIn(freshState());
    const g = doorGeometry(sheet.openings[0], sheet.walls);
    expect(hitTestSheet(sheet, { x: g.center[0], y: g.center[1] })).toEqual({ kind: "door", id: "o1" });
    expect(hitTestSheet(sheet, { x: 50, y: 85 })).toEqual({ kind: "zone", id: "z1" }); // inside PASS / KITCHEN
    expect(hitTestSheet(sheet, { x: 30, y: 2.5 })).toEqual({ kind: "wall", id: "w1" });
    expect(hitTestSheet(sheet, { x: 50, y: 40 })).toBeNull();
    const terrace = sheetIn(freshState(), "terrace_main");
    expect(hitTestSheet(terrace, { x: 13, y: 85 })).toEqual({ kind: "planter", id: "p1" });
  });

  it("duplicateMap deep-copies the sheet; reset restores tables AND sheet", () => {
    let s = duplicateMap(freshState(), "dining_a");
    const copyId = s.maps[s.maps.length - 1].id;
    s = deleteWall(s, copyId, "w1");
    expect(sheetIn(s).walls.length).toBe(1); // source untouched
    let m = deleteWall(freshState(), "dining_a", "w1");
    m = resetMapToDefaults(m, "dining_a");
    expect(sheetIn(m).walls.length).toBe(1);
    expect(sheetIn(m).openings.length).toBe(1);
  });
});
