import { describe, it, expect } from "vitest";
import {
  buildDefaultFloorMaps, sanitizeFloorMaps, getActiveDiningMap, getTerraceMap,
  findMapTable, resolveReservationTable, boardIdsOf, mapSeatCountForBoardTable,
  planLayoutSwitch, applyLayoutSwitchRow, seatDisplayPoints, assignSeatNumbers,
  terraceOccupancy, sanitizeTerraceState, isTerraceDirty, setTerraceDirty,
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
