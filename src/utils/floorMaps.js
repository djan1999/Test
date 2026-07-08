// Floor maps: the spatial model behind the terrace flow and the kitchen
// floor view. Maps live in the `floor_maps_v1` service_settings row (written
// through lib/stateStore — the PowerSync seam — never directly).
//
// The dining board itself stays the fixed 10-slot service_tables grid; a map
// "logical table" points at the board slot(s) it occupies via `boardIds`.
// Merges are explicit (`members`), and boardIds are explicit PER TABLE rather
// than derived from members: in Layout B the physical T6+T7 rectangles form
// the T6-7 merge while a round two-top stands at the T7 position still called
// T7 — so the merge claims board slot 6 only and the round table claims 7.
// Deriving claims from member labels would make those two tables collide on
// slot 7. Seed data (incl. seat numbering) is transcribed from Djan's house
// diagrams; `confirm: true` marks the numberings his diagrams left unmarked.
import { reservationTableIds, resolveReservationSession } from "./tableHelpers.js";

export const FLOOR_MAPS_KEY = "floor_maps_v1";
export const TERRACE_STATE_KEY = "terrace_state_v1"; // deprecated — read-through migration only
export const FLOOR_STATUS_KEY = "floor_status_v1";

// Canvas extent in map units — the one coordinate system every consumer
// (renderer, editor clamps, seat projection) shares.
export const MAP_W = 100;
export const MAP_H = 92;

// Bumped whenever the seed geometry below changes. Stored blobs carry the
// version they were seeded/reset from; older blobs are NEVER auto-overwritten
// — EDIT mode shows a RESET banner instead (the geometry-trap fix).
// v3: seed sheets (walls / doors / zones / planters).
export const GEOMETRY_VERSION = 3;

const COMPASS_DEG = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

// Rect seat from a compass corner/edge: side + offset along that side.
const rs = (no, side, offset = 0.5, extra) => ({ no, side, offset, ...(extra || {}) });
// Round seat at a compass point (angle in degrees, 0 = N, clockwise).
const cs = (no, compass, extra) => ({ no, angle: COMPASS_DEG[compass], ...(extra || {}) });

const CORNER = {
  SW: ["S", 0.22], NW: ["N", 0.22], NE: ["N", 0.78], SE: ["S", 0.78],
};
// Merge 4-top seat from a corner name (two seats per long side).
const ms = (no, corner, extra) => rs(no, CORNER[corner][0], CORNER[corner][1], extra);

const CONFIRM = { confirm: true }; // numbering unmarked on the diagrams — CONFIRM WITH DJAN

// The architecture is data, not hardcoded SVG: each map carries a `sheet` of
// walls (polylines, closed = room), openings cut into wall segments (doors
// with leaf + swing arc, or plain passages), hatched zones and planters.
export const emptySheet = () => ({ walls: [], openings: [], zones: [], planters: [] });

const DINING_SHEET = () => ({
  walls: [{ id: "w1", pts: [[2, 2], [98, 2], [98, 90], [2, 90]], closed: true, dashed: false }],
  openings: [{ id: "o1", wallId: "w1", seg: 0, t: 0.64, width: 10, kind: "door", swing: 1, hinge: 1 }],
  zones: [{ id: "z1", x: 2, y: 82, w: 96, h: 8, label: "PASS / KITCHEN" }],
  planters: [],
});
const TERRACE_SHEET = () => ({
  walls: [{ id: "w1", pts: [[2, 2], [98, 2], [98, 90], [2, 90]], closed: true, dashed: true }],
  openings: [{ id: "o1", wallId: "w1", seg: 3, t: 0.85, width: 13, kind: "door", swing: 1, hinge: 1 }],
  zones: [],
  planters: [{ id: "p1", x: 13, y: 85, r: 3 }, { id: "p2", x: 34, y: 85, r: 3 }, { id: "p3", x: 55, y: 85, r: 3 }],
});

export function buildDefaultFloorMaps() {
  return {
    geometryVersion: GEOMETRY_VERSION,
    maps: [
      {
        id: "dining_a",
        kind: "dining",
        name: "LAYOUT A",
        sheet: DINING_SHEET(),
        tables: [
          { label: "T1", shape: "rect", x: 8, y: 8, w: 12, h: 9, boardIds: [1],
            seats: [rs(1, "W"), rs(2, "E")] },
          { label: "T2-3", shape: "rect", x: 30, y: 8, w: 24, h: 10, boardIds: [2, 3],
            members: ["T2", "T3"],
            seats: [ms(1, "SW"), ms(2, "NW"), ms(3, "NE"), ms(4, "SE")] },
          { label: "T4", shape: "rect", x: 68, y: 8, w: 12, h: 9, boardIds: [4],
            seats: [rs(1, "W"), rs(2, "E")] },
          { label: "T5", shape: "round", x: 8, y: 38, w: 11, h: 11, boardIds: [5],
            seats: [cs(1, "NW"), cs(2, "NE")] },
          { label: "T6", shape: "rect", x: 32, y: 38, w: 12, h: 9, boardIds: [6],
            seats: [rs(1, "N"), rs(2, "S")] },
          { label: "T7", shape: "rect", x: 52, y: 38, w: 12, h: 9, boardIds: [7],
            seats: [rs(1, "N", 0.5, CONFIRM), rs(2, "S", 0.5, CONFIRM)] },
          { label: "T8", shape: "rect", x: 8, y: 68, w: 12, h: 9, boardIds: [8],
            seats: [rs(1, "W", 0.5, CONFIRM), rs(2, "E", 0.5, CONFIRM)] },
          { label: "T9", shape: "round", x: 34, y: 68, w: 11, h: 11, boardIds: [9],
            seats: [cs(1, "E"), cs(2, "W")] },
          { label: "T10", shape: "round", x: 58, y: 68, w: 11, h: 11, boardIds: [10],
            seats: [cs(1, "E"), cs(2, "W")] },
        ],
      },
      {
        id: "dining_b",
        kind: "dining",
        name: "LAYOUT B",
        sheet: DINING_SHEET(),
        tables: [
          { label: "T1", shape: "rect", x: 8, y: 8, w: 12, h: 9, boardIds: [1],
            seats: [rs(1, "W"), rs(2, "E")] },
          { label: "T2-3", shape: "rect", x: 30, y: 8, w: 24, h: 10, boardIds: [2, 3],
            members: ["T2", "T3"],
            seats: [ms(1, "SW"), ms(2, "NW"), ms(3, "NE"), ms(4, "SE")] },
          { label: "T4", shape: "rect", x: 68, y: 8, w: 12, h: 9, boardIds: [4],
            seats: [rs(1, "W"), rs(2, "E")] },
          // Physical T6+T7 pushed together; claims slot 6 only (7 belongs to
          // the round two-top standing at the old T7 position, still "T7").
          { label: "T6-7", shape: "rect", x: 30, y: 38, w: 26, h: 9, boardIds: [6],
            members: ["T6", "T7"],
            seats: [ms(1, "NW"), ms(2, "NE"), ms(3, "SE"), ms(4, "SW")] },
          { label: "T7", shape: "round", x: 64, y: 38, w: 10, h: 10, boardIds: [7],
            seats: [cs(1, "N", CONFIRM), cs(2, "S", CONFIRM)] },
          { label: "T8", shape: "rect", x: 8, y: 68, w: 12, h: 9, boardIds: [8],
            seats: [rs(1, "W", 0.5, CONFIRM), rs(2, "E", 0.5, CONFIRM)] },
          { label: "T9", shape: "round", x: 34, y: 68, w: 11, h: 11, boardIds: [9],
            seats: [cs(1, "NE"), cs(2, "SE"), cs(3, "W")] },
          { label: "T10", shape: "round", x: 58, y: 68, w: 11, h: 11, boardIds: [10],
            seats: [cs(1, "E"), cs(2, "W")] },
        ],
      },
      {
        id: "terrace_main",
        kind: "terrace",
        name: "TERRACE",
        sheet: TERRACE_SHEET(),
        tables: [21, 22, 23, 24, 25, 26].map((n, i) => ({
          label: `T${n}`, shape: "rect",
          x: 8 + (i % 3) * 26, y: 18 + Math.floor(i / 3) * 36, w: 14, h: 10,
          seats: [rs(1, "W"), rs(2, "E")],
        })),
      },
    ],
    activeDiningMapId: "dining_a",
    config: { moveSingleTap: false }, // MOVE_SINGLE_TAP: MOVE skips the arriving confirm
  };
}

// Stored state → valid state (defaults + backfill), never throws on junk.
export function sanitizeFloorMaps(state) {
  const def = buildDefaultFloorMaps();
  if (!state || typeof state !== "object" || !Array.isArray(state.maps) || !state.maps.length) return def;
  const maps = state.maps.filter((m) => m && m.id && Array.isArray(m.tables));
  if (!maps.length) return def;
  const activeDiningMapId = maps.some((m) => m.id === state.activeDiningMapId && m.kind === "dining")
    ? state.activeDiningMapId
    : (maps.find((m) => m.kind === "dining") || maps[0]).id;
  return {
    // Version 1 ≡ pre-version blobs (the terrace-flow seeds). Per-map keys the
    // sanitizer doesn't know (e.g. the Phase-2 `sheet` reservation) survive
    // because maps are kept whole, never rebuilt field-by-field.
    geometryVersion: Number.isInteger(state.geometryVersion) ? state.geometryVersion : 1,
    maps,
    activeDiningMapId,
    config: { moveSingleTap: false, ...(state.config || {}) },
  };
}

export const getActiveDiningMap = (state) =>
  state.maps.find((m) => m.id === state.activeDiningMapId && m.kind === "dining") ||
  state.maps.find((m) => m.kind === "dining") || null;

export const getTerraceMap = (state, mapId) =>
  (mapId && state.maps.find((m) => m.id === mapId && m.kind === "terrace")) ||
  state.maps.find((m) => m.kind === "terrace") || null;

export const findMapTable = (map, label) =>
  (map?.tables || []).find((t) => t.label === label) || null;

// ── reservation ↔ active-layout resolution ─────────────────────────────────
// Board slots are integers; map labels are `T${n}` (merges use `members`).
// Order per spec: exact label match beats member match ("res T7 in Layout B →
// the round T7, never the merge"); no match → NEEDS TABLE.
export function resolveReservationTable(map, tableId) {
  const label = `T${Number(tableId)}`;
  const exact = (map?.tables || []).find((t) => t.label === label);
  if (exact) return { table: exact, match: "exact" };
  const member = (map?.tables || []).find((t) => Array.isArray(t.members) && t.members.includes(label));
  if (member) return { table: member, match: "member" };
  return { table: null, match: null };
}

export const boardIdsOf = (mapTable) =>
  Array.isArray(mapTable?.boardIds) && mapTable.boardIds.length
    ? mapTable.boardIds.map(Number)
    : [];

// Seat count for the board table a party is assigned to, under a given map —
// caps the restriction seat selector ("T9 offers 3 seats under Layout B,
// only 2 under Layout A"). Unresolved tables → null (caller keeps today's
// guest-count cap).
export function mapSeatCountForBoardTable(map, tableId) {
  const { table } = resolveReservationTable(map, tableId);
  return table ? (table.seats || []).length : null;
}

// ── layout switch planning ──────────────────────────────────────────────────
// Re-resolve every reservation of the service against the next map and return
// the confirm diff: moves, conflicts (overlapping claims within one session),
// NEEDS TABLE rows. Nothing is applied here — the caller shows the diff first.
const sameIds = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export function planLayoutSwitch(nextMap, reservations) {
  const rows = (reservations || []).map((r) => {
    const from = reservationTableIds(r.data, r.table_id).slice().sort((a, b) => a - b);
    const { table, match } = resolveReservationTable(nextMap, r.table_id);
    const to = table ? boardIdsOf(table).slice().sort((a, b) => a - b) : null;
    return {
      id: r.id,
      name: r.data?.resName || "",
      session: resolveReservationSession(r.data),
      from,
      to,
      label: table ? table.label : null,
      match,
      status: !to ? "needs_table" : sameIds(from, to) ? "unchanged" : "move",
    };
  });
  // Two parties in the same session claiming an overlapping slot set is a
  // conflict the switch cannot silently apply.
  const claimed = new Map(); // `${session}:${slot}` → row
  for (const row of rows) {
    if (!row.to) continue;
    for (const slot of row.to) {
      const key = `${row.session}:${slot}`;
      const other = claimed.get(key);
      if (other) { row.status = "conflict"; other.status = "conflict"; }
      else claimed.set(key, row);
    }
  }
  return rows;
}

// One planned row → the next { table_id, data } for that reservation.
// Only 'move' rows are applied; conflicts/needs_table stay untouched.
export function applyLayoutSwitchRow(row, reservation) {
  if (!row || row.status !== "move" || !row.to) return null;
  return {
    ...reservation,
    table_id: row.to[0],
    data: { ...(reservation.data || {}), tableGroup: row.to.length > 1 ? row.to : [] },
  };
}

// ── seat geometry (kept here so it is pure + testable; FloorMap.jsx renders) ─
// Returns one point per seat ON the table outline, in map units. `out` is the
// unit outward normal so the renderer can offset chair marks off the edge.
//
// Rect seats sharing a side are ALWAYS evenly distributed along it — the
// stored offset only decides their ORDER (and where a drag re-inserts a
// seat). Chairs come out perfectly symmetric by construction: one seat sits
// centered, two sit at the quarter points, three at sixths, and so on.
// Round seats keep their stored compass angles (15°-snapped by moveSeat) —
// clustering two chairs on the north face is intentional placement there.
export function seatDisplayPoints(table) {
  const { x, y, w, h } = table;
  const seats = table.seats || [];

  const bySide = { N: [], S: [], W: [], E: [] };
  seats.forEach((s, i) => {
    if (s.angle == null) bySide[bySide[s.side] ? s.side : "E"].push({ s, i });
  });
  const evenOffset = new Map(); // seat array index → distributed offset
  for (const side of Object.keys(bySide)) {
    const row = bySide[side].sort((a, b) => ((a.s.offset ?? 0.5) - (b.s.offset ?? 0.5)) || (a.i - b.i));
    row.forEach((e, rank) => evenOffset.set(e.i, (rank + 0.5) / row.length));
  }

  return seats.map((s, i) => {
    if (s.angle != null) {
      const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) / 2;
      const rad = (s.angle * Math.PI) / 180;
      const ox = Math.sin(rad), oy = -Math.cos(rad);
      return { no: s.no, confirm: !!s.confirm, x: cx + r * ox, y: cy + r * oy, out: { x: ox, y: oy } };
    }
    const t = evenOffset.get(i) ?? 0.5;
    switch (s.side) {
      case "N": return { no: s.no, confirm: !!s.confirm, x: x + t * w, y, out: { x: 0, y: -1 } };
      case "S": return { no: s.no, confirm: !!s.confirm, x: x + t * w, y: y + h, out: { x: 0, y: 1 } };
      case "W": return { no: s.no, confirm: !!s.confirm, x, y: y + t * h, out: { x: -1, y: 0 } };
      case "E": default: return { no: s.no, confirm: !!s.confirm, x: x + w, y: y + t * h, out: { x: 1, y: 0 } };
    }
  });
}

// ── SEATS mode renumbering ───────────────────────────────────────────────────
// Tap chair marks in sequence to number them; numbers commit only when every
// seat has been tapped (tapping the first chair again restarts — the caller
// resets its sequence). Partial sequences return a preview with untapped
// seats blanked so the editor shows progress honestly.
export function assignSeatNumbers(seats, tappedIndices) {
  const order = [];
  for (const i of tappedIndices || []) {
    if (Number.isInteger(i) && i >= 0 && i < (seats || []).length && !order.includes(i)) order.push(i);
  }
  const complete = order.length === (seats || []).length && order.length > 0;
  const next = (seats || []).map((s, i) => {
    const at = order.indexOf(i);
    if (at === -1) return complete ? s : { ...s, no: null };
    const { confirm, ...rest } = s;
    return { ...rest, no: at + 1 }; // an explicit renumber clears the CONFIRM marker
  });
  return { seats: next, complete };
}

// ── geometry editor ops ─────────────────────────────────────────────────────
// Every mutation the floor editor can make, as a pure (state → state)
// function. Invalid input returns the SAME state object so callers can skip
// a persist with a cheap identity check. All writes still flow through
// updateFloorMaps → stateStore; nothing here touches storage.

const patchMaps = (state, mapId, fn) => {
  const map = state.maps.find((m) => m.id === mapId);
  if (!map) return state;
  const next = fn(map);
  return next === map ? state : { ...state, maps: state.maps.map((m) => (m.id === mapId ? next : m)) };
};

const patchTable = (state, mapId, label, fn) =>
  patchMaps(state, mapId, (map) => {
    const table = map.tables.find((t) => t.label === label);
    if (!table) return map;
    const next = fn(table, map);
    return next === table ? map : { ...map, tables: map.tables.map((t) => (t.label === label ? next : t)) };
  });

const snapUnit = (v) => Math.round(Number(v) || 0);
const clampTablePos = (t) => ({
  ...t,
  x: Math.min(Math.max(t.x, 0), MAP_W - t.w),
  y: Math.min(Math.max(t.y, 0), MAP_H - t.h),
});

// Magnetic alignment: a dropped table pulls its edges level with any other
// table's edges within reach, per axis — "exactly the same" placement without
// pixel-precise dragging. Edges only (not centers), so positions stay on the
// integer grid. Besides edge-alignment, it also offers CHAIR-CLEARANCE stops:
// positions exactly one chair band (7 units) off a neighbour's edge, so two
// tables dropped near each other land with room for both tables' chairs
// instead of overlapping them.
const MAGNET = 1.5;
// Wide enough for two FACING chair rows with stacked note pills (each ~5
// units deep) plus a sliver of aisle.
const CHAIR_CLEARANCE = 11;
const magnetAxis = (pos, size, others) => {
  let best = null;
  for (const o of others) {
    for (const target of [o.p, o.p + o.s, o.p - CHAIR_CLEARANCE, o.p + o.s + CHAIR_CLEARANCE]) {
      for (const mine of [0, size]) {
        const d = target - (pos + mine);
        if (Math.abs(d) <= MAGNET && (best == null || Math.abs(d) < Math.abs(best))) best = d;
      }
    }
  }
  return best == null ? pos : pos + best;
};

export const moveTable = (state, mapId, label, x, y) =>
  patchTable(state, mapId, label, (t, map) => {
    const others = map.tables.filter((o) => o.label !== label);
    return clampTablePos({
      ...t,
      x: magnetAxis(snapUnit(x), t.w, others.map((o) => ({ p: o.x, s: o.w }))),
      y: magnetAxis(snapUnit(y), t.h, others.map((o) => ({ p: o.y, s: o.h }))),
    });
  });

const MIN_SIDE = 4;
export const resizeTable = (state, mapId, label, w, h) =>
  patchTable(state, mapId, label, (t) => clampTablePos({
    ...t,
    w: Math.min(Math.max(snapUnit(w), MIN_SIDE), MAP_W),
    h: Math.min(Math.max(snapUnit(h), MIN_SIDE), MAP_H),
  }));

// Rotate = swap w/h (the mockup's ⟳). Position re-clamps so a rotation near
// an edge can't push the table off the sheet.
export const rotateTable = (state, mapId, label) =>
  patchTable(state, mapId, label, (t) => clampTablePos({ ...t, w: t.h, h: t.w }));

export const setTableShape = (state, mapId, label, shape) =>
  shape === "rect" || shape === "round"
    ? patchTable(state, mapId, label, (t) => ({ ...t, shape }))
    : state;

// Labels are the identity every other structure points at (statuses, merge
// members, the renumber flow) — a rename must stay non-empty and unique in
// its map. Strips keyed by the old label simply orphan (sanitizer-tolerated).
export function renameTable(state, mapId, label, nextLabel) {
  const clean = String(nextLabel || "").trim().toUpperCase();
  if (!clean || clean === label) return state;
  return patchMaps(state, mapId, (map) =>
    map.tables.some((t) => t.label === clean)
      ? map
      : { ...map, tables: map.tables.map((t) => (t.label === label ? { ...t, label: clean } : t)) });
}

const uniqueLabel = (map, base) => {
  let candidate = base;
  while (map.tables.some((t) => t.label === candidate)) candidate += "'";
  return candidate;
};

// Duplicate keeps geometry + seats but DROPS boardIds/members: a copy that
// inherited slot claims would collide with its source in the same map, and
// merges are explicit by design. Djan re-claims slots via the inspector.
export const duplicateTable = (state, mapId, label) =>
  patchMaps(state, mapId, (map) => {
    const src = map.tables.find((t) => t.label === label);
    if (!src) return map;
    const { boardIds, members, ...rest } = src;
    const copy = clampTablePos({
      ...rest,
      label: uniqueLabel(map, src.label),
      x: src.x + 3, y: src.y + 3,
      seats: (src.seats || []).map((s) => ({ ...s })),
    });
    return { ...map, tables: [...map.tables, copy] };
  });

// New tables take the first free T-number. "Free" also excludes merge
// members: a plain T2 next to the T2-3 merge would win the exact-match
// resolution for reservations on slot 2 and silently shadow the merge.
export const addTable = (state, mapId) =>
  patchMaps(state, mapId, (map) => {
    const taken = (label) =>
      map.tables.some((t) => t.label === label || (Array.isArray(t.members) && t.members.includes(label)));
    let n = 1;
    while (taken(`T${n}`)) n++;
    const t = clampTablePos({
      label: `T${n}`, shape: "rect", x: 44, y: 40, w: 12, h: 9,
      seats: [{ no: 1, side: "W", offset: 0.5 }, { no: 2, side: "E", offset: 0.5 }],
    });
    return { ...map, tables: [...map.tables, t] };
  });

export const deleteTable = (state, mapId, label) =>
  patchMaps(state, mapId, (map) =>
    map.tables.some((t) => t.label === label)
      ? { ...map, tables: map.tables.filter((t) => t.label !== label) }
      : map);

// ── seat editor ops ─────────────────────────────────────────────────────────

// New seats land on a rotating default edge/angle and take the next number —
// explicitly placed, so no CONFIRM marker. Djan drags them into place.
const SEAT_SIDES = ["N", "S", "W", "E"];
export const addSeat = (state, mapId, label) =>
  patchTable(state, mapId, label, (t) => {
    const seats = t.seats || [];
    const no = seats.length + 1;
    const seat = t.shape === "round"
      ? { no, angle: (seats.length * 90) % 360 }
      : { no, side: SEAT_SIDES[seats.length % SEAT_SIDES.length], offset: 0.5 };
    return { ...t, seats: [...seats, seat] };
  });

// Removing a seat compacts the numbering (1..n in the surviving seats' order)
// so the restriction selector's cap and the house numbers stay contiguous.
export const removeSeat = (state, mapId, label, index) =>
  patchTable(state, mapId, label, (t) => {
    const seats = t.seats || [];
    const at = index == null ? seats.length - 1 : index;
    if (at < 0 || at >= seats.length) return t;
    const kept = seats.filter((_, i) => i !== at);
    const order = kept.map((s, i) => ({ s, i })).sort((a, b) => (a.s.no ?? 99) - (b.s.no ?? 99));
    const renumbered = kept.slice();
    order.forEach(({ i }, rank) => { renumbered[i] = { ...kept[i], no: rank + 1 }; });
    return { ...t, seats: renumbered };
  });

// Drag a seat along the table outline. Rect: nearest side + offset along it;
// round: compass angle (0 = N, clockwise — the inverse of seatDisplayPoints).
// Number and CONFIRM marker travel with the seat — moving is not renumbering.
//
// Magnetic: offsets pull onto the canonical house stops (0.22 corner / 0.5
// middle / 0.78 corner) and otherwise land on a 0.05 grid; round-table angles
// land on 15° steps (compass points are multiples). Identical seat layouts
// across tables without pixel-precise dragging.
const SEAT_STOPS = [0.22, 0.5, 0.78];
const magnetOffset = (raw) => {
  for (const stop of SEAT_STOPS) {
    if (Math.abs(raw - stop) <= 0.06) return stop;
  }
  return Math.round(raw * 20) / 20;
};

export const moveSeat = (state, mapId, label, index, point) =>
  patchTable(state, mapId, label, (t) => {
    const seats = t.seats || [];
    const seat = seats[index];
    if (!seat || !point) return t;
    const [px, py] = [Number(point.x), Number(point.y)];
    if (!Number.isFinite(px) || !Number.isFinite(py)) return t;
    let placed;
    if (t.shape === "round") {
      const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
      const angle = (Math.atan2(px - cx, -(py - cy)) * 180 / Math.PI + 360) % 360;
      const { side, offset, ...rest } = seat;
      placed = { ...rest, angle: Math.round(angle / 15) * 15 % 360 };
    } else {
      const fx = Math.min(Math.max((px - t.x) / t.w, 0), 1);
      const fy = Math.min(Math.max((py - t.y) / t.h, 0), 1);
      const edges = [
        { side: "N", d: Math.abs(py - t.y), offset: fx },
        { side: "S", d: Math.abs(py - (t.y + t.h)), offset: fx },
        { side: "W", d: Math.abs(px - t.x), offset: fy },
        { side: "E", d: Math.abs(px - (t.x + t.w)), offset: fy },
      ].sort((a, b) => a.d - b.d);
      const { angle, ...rest } = seat;
      placed = { ...rest, side: edges[0].side, offset: magnetOffset(edges[0].offset) };
    }
    return { ...t, seats: seats.map((s, i) => (i === index ? placed : s)) };
  });

// ── merge editor ops ────────────────────────────────────────────────────────
// members = which physical tables form this logical table; boardIds = which
// board slots it claims. Claims stay EXPLICIT per table, never derived from
// members — see the Layout-B T6-7/T7 note at the top of this file.

export const setTableMembers = (state, mapId, label, members) =>
  patchTable(state, mapId, label, (t) => {
    const clean = [...new Set((members || []).map((m) => String(m).trim().toUpperCase()).filter(Boolean))];
    if (clean.length < 2) { const { members: _drop, ...rest } = t; return rest; }
    return { ...t, members: clean };
  });

export const setTableBoardIds = (state, mapId, label, boardIds) =>
  patchTable(state, mapId, label, (t) => ({
    ...t,
    boardIds: [...new Set((boardIds || []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 10))]
      .sort((a, b) => a - b),
  }));

// ── SHEET layer: walls / doors / zones / planters ───────────────────────────
// Pure geometry + editor ops for the architecture layer. Walls are polylines
// (closed = a room); openings are cut INTO a wall segment (position t along
// the segment, width in map units) and render as a door leaf + swing arc or
// as a plain passage with jamb ticks. Zones are hatched stamps, planters are
// circles. Everything lives under each map's `sheet` key.

const arr = (x) => (Array.isArray(x) ? x : []);
// Tolerant accessor — stored sheets may be absent or partial.
export const sheetOf = (map) => {
  const s = (map && typeof map.sheet === "object" && map.sheet) || {};
  return { walls: arr(s.walls), openings: arr(s.openings), zones: arr(s.zones), planters: arr(s.planters) };
};

const patchSheet = (state, mapId, fn) =>
  patchMaps(state, mapId, (m) => {
    const sheet = fn(sheetOf(m));
    return sheet ? { ...m, sheet } : m;
  });

const nextSheetId = (items, prefix) => {
  let n = 1;
  for (const it of items) {
    const m = String(it.id || "").match(new RegExp(`^${prefix}(\\d+)$`));
    if (m) n = Math.max(n, Number(m[1]) + 1);
  }
  return `${prefix}${n}`;
};

const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export const wallSegments = (wall) => {
  const pts = arr(wall?.pts);
  const out = [];
  const m = wall?.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < m; i++) out.push({ p1: pts[i], p2: pts[(i + 1) % pts.length], i });
  return out;
};

// Closest point on a segment → { d, t, pt }.
export function nearestOnSegment(p, p1, p2) {
  const vx = p2[0] - p1[0], vy = p2[1] - p1[1];
  const L2 = vx * vx + vy * vy || 1;
  let t = ((p[0] - p1[0]) * vx + (p[1] - p1[1]) * vy) / L2;
  t = Math.max(0, Math.min(1, t));
  const pt = [p1[0] + vx * t, p1[1] + vy * t];
  return { d: dist(p, pt), t, pt };
}

// Everything the renderer needs for one opening: gap endpoints A/B, hinge
// point, leaf end, arc sweep, center, and the segment's unit normal.
export function doorGeometry(o, walls) {
  const wall = arr(walls).find((w) => w.id === o.wallId);
  if (!wall) return null;
  const seg = wallSegments(wall)[o.seg];
  if (!seg) return null;
  const { p1, p2 } = seg;
  const L = dist(p1, p2);
  if (!L) return null;
  const dir = [(p2[0] - p1[0]) / L, (p2[1] - p1[1]) / L];
  const n0 = [-dir[1], dir[0]];
  const nrm = [n0[0] * (o.swing || 1), n0[1] * (o.swing || 1)];
  const gs = o.t * L - o.width / 2, ge = o.t * L + o.width / 2;
  const A = [p1[0] + dir[0] * gs, p1[1] + dir[1] * gs];
  const B = [p1[0] + dir[0] * ge, p1[1] + dir[1] * ge];
  const h = o.hinge ? B : A;
  const j = o.hinge ? A : B;
  const leafEnd = [h[0] + nrm[0] * o.width, h[1] + nrm[1] * o.width];
  const cross = (j[0] - h[0]) * (leafEnd[1] - h[1]) - (j[1] - h[1]) * (leafEnd[0] - h[0]);
  return { A, B, h, j, leafEnd, sweep: cross < 0 ? 0 : 1, center: [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], n0 };
}

// One wall segment minus its openings → the solid runs to draw, as [a, b]
// distances along the segment.
export function segmentRuns(wall, segIndex, openings, segLength) {
  const ops = arr(openings)
    .filter((o) => o.wallId === wall.id && o.seg === segIndex)
    .sort((a, b) => a.t - b.t);
  let cur = 0;
  const runs = [];
  for (const o of ops) {
    const gs = Math.max(0, o.t * segLength - o.width / 2);
    const ge = Math.min(segLength, o.t * segLength + o.width / 2);
    runs.push([cur, gs]);
    cur = ge;
  }
  runs.push([cur, segLength]);
  return runs.filter(([a, b]) => b - a > 0.3);
}

const snapPt = ([x, y]) => [
  Math.min(Math.max(snapUnit(x), 0), MAP_W),
  Math.min(Math.max(snapUnit(y), 0), MAP_H),
];

export const addWall = (state, mapId, pts, closed) =>
  patchSheet(state, mapId, (sheet) => {
    const clean = arr(pts).map(snapPt);
    if (clean.length < (closed ? 3 : 2)) return null;
    return {
      ...sheet,
      walls: [...sheet.walls, { id: nextSheetId(sheet.walls, "w"), pts: clean, closed: !!closed, dashed: false }],
    };
  });

export const setWallDashed = (state, mapId, wallId, dashed) =>
  patchSheet(state, mapId, (sheet) => ({
    ...sheet,
    walls: sheet.walls.map((w) => (w.id === wallId ? { ...w, dashed: !!dashed } : w)),
  }));

// Deleting a wall takes its openings with it — an opening without its wall
// is unrenderable.
export const deleteWall = (state, mapId, wallId) =>
  patchSheet(state, mapId, (sheet) => ({
    ...sheet,
    walls: sheet.walls.filter((w) => w.id !== wallId),
    openings: sheet.openings.filter((o) => o.wallId !== wallId),
  }));

const DOOR_MIN = 6, DOOR_MAX = 30, DOOR_DEFAULT = 10;
const clampDoorT = (t, width, L) => {
  const margin = (width / 2 + 1) / L;
  return Math.min(Math.max(t, margin), 1 - margin);
};

// Cut an opening into the wall segment nearest the tapped point (within 6
// units). Same-state return = "tap closer to a wall".
export const addDoorAt = (state, mapId, point) =>
  patchSheet(state, mapId, (sheet) => {
    const p = [point.x, point.y];
    let best = null;
    for (const w of sheet.walls) {
      for (const { p1, p2, i } of wallSegments(w)) {
        const r = nearestOnSegment(p, p1, p2);
        if (r.d < 6 && (!best || r.d < best.d)) best = { ...r, wallId: w.id, seg: i, L: dist(p1, p2) };
      }
    }
    if (!best || best.L < DOOR_MIN + 2) return null;
    const width = Math.min(DOOR_DEFAULT, best.L - 2);
    return {
      ...sheet,
      openings: [...sheet.openings, {
        id: nextSheetId(sheet.openings, "o"),
        wallId: best.wallId, seg: best.seg,
        t: clampDoorT(best.t, width, best.L),
        width, kind: "door", swing: 1, hinge: 1,
      }],
    };
  });

export const patchOpening = (state, mapId, id, patch) =>
  patchSheet(state, mapId, (sheet) => ({
    ...sheet,
    openings: sheet.openings.map((o) => {
      if (o.id !== id) return o;
      const next = { ...o, ...patch };
      next.width = Math.min(Math.max(Number(next.width) || DOOR_DEFAULT, DOOR_MIN), DOOR_MAX);
      next.kind = next.kind === "pass" ? "pass" : "door";
      next.swing = next.swing === -1 ? -1 : 1;
      next.hinge = next.hinge ? 1 : 0;
      const wall = sheet.walls.find((w) => w.id === next.wallId);
      const seg = wall && wallSegments(wall)[next.seg];
      if (seg) next.t = clampDoorT(next.t, next.width, dist(seg.p1, seg.p2));
      return next;
    }),
  }));

export const deleteOpening = (state, mapId, id) =>
  patchSheet(state, mapId, (sheet) => ({ ...sheet, openings: sheet.openings.filter((o) => o.id !== id) }));

export const addZoneAt = (state, mapId, point) =>
  patchSheet(state, mapId, (sheet) => ({
    ...sheet,
    zones: [...sheet.zones, {
      id: nextSheetId(sheet.zones, "z"),
      x: snapPt([point.x - 13, 0])[0], y: snapPt([0, point.y - 8])[1],
      w: 26, h: 16, label: "ZONE",
    }],
  }));

export const patchZone = (state, mapId, id, patch) =>
  patchSheet(state, mapId, (sheet) => ({
    ...sheet,
    zones: sheet.zones.map((z) => {
      if (z.id !== id) return z;
      const next = { ...z, ...patch };
      if (patch.label != null) next.label = String(patch.label).trim().toUpperCase();
      next.w = Math.min(Math.max(snapUnit(next.w), 8), MAP_W);
      next.h = Math.min(Math.max(snapUnit(next.h), 5), MAP_H);
      next.x = Math.min(Math.max(snapUnit(next.x), 0), MAP_W - next.w);
      next.y = Math.min(Math.max(snapUnit(next.y), 0), MAP_H - next.h);
      return next;
    }),
  }));

export const deleteZone = (state, mapId, id) =>
  patchSheet(state, mapId, (sheet) => ({ ...sheet, zones: sheet.zones.filter((z) => z.id !== id) }));

export const addPlanterAt = (state, mapId, point) =>
  patchSheet(state, mapId, (sheet) => {
    const [x, y] = snapPt([point.x, point.y]);
    return { ...sheet, planters: [...sheet.planters, { id: nextSheetId(sheet.planters, "p"), x, y, r: 3 }] };
  });

export const patchPlanter = (state, mapId, id, patch) =>
  patchSheet(state, mapId, (sheet) => ({
    ...sheet,
    planters: sheet.planters.map((p) => {
      if (p.id !== id) return p;
      const next = { ...p, ...patch };
      next.r = Math.min(Math.max(Number(next.r) || 3, 1.5), 8);
      const [x, y] = snapPt([next.x, next.y]);
      return { ...next, x, y };
    }),
  }));

export const deletePlanter = (state, mapId, id) =>
  patchSheet(state, mapId, (sheet) => ({ ...sheet, planters: sheet.planters.filter((p) => p.id !== id) }));

// MOVE-tool tap → what did it land on. Doors win (small, on walls), then
// planters, zones, walls — the mockup's precedence.
export function hitTestSheet(sheet, point) {
  const p = [point.x, point.y];
  for (const o of sheet.openings) {
    const g = doorGeometry(o, sheet.walls);
    if (g && dist(p, g.center) < 5) return { kind: "door", id: o.id };
  }
  for (const pl of sheet.planters) {
    if (dist(p, [pl.x, pl.y]) < pl.r + 1.5) return { kind: "planter", id: pl.id };
  }
  for (const z of sheet.zones) {
    if (p[0] >= z.x && p[0] <= z.x + z.w && p[1] >= z.y && p[1] <= z.y + z.h) return { kind: "zone", id: z.id };
  }
  for (const w of sheet.walls) {
    for (const { p1, p2 } of wallSegments(w)) {
      if (nearestOnSegment(p, p1, p2).d < 2) return { kind: "wall", id: w.id };
    }
  }
  return null;
}

// ── map ops ─────────────────────────────────────────────────────────────────

const uniqueMapId = (state, base) => {
  let id = base, n = 2;
  while (state.maps.some((m) => m.id === id)) id = `${base}_${n++}`;
  return id;
};
const uniqueMapName = (state, base) => {
  let name = base, n = 2;
  while (state.maps.some((m) => m.name === name)) name = `${base} ${n++}`;
  return name;
};

export function addMap(state, kind) {
  const k = kind === "terrace" ? "terrace" : "dining";
  return {
    ...state,
    maps: [...state.maps, {
      id: uniqueMapId(state, `${k}_new`),
      kind: k,
      name: uniqueMapName(state, k === "terrace" ? "NEW TERRACE" : "NEW LAYOUT"),
      tables: [],
      sheet: emptySheet(),
    }],
  };
}

export function renameMap(state, mapId, name) {
  const clean = String(name || "").trim().toUpperCase();
  if (!clean) return state;
  return patchMaps(state, mapId, (m) => ({ ...m, name: clean }));
}

// Duplicating a dining layout is how "LAYOUT C" nights are created: deep copy
// of every table (seats included) under a fresh id + "<NAME> COPY".
export function duplicateMap(state, mapId) {
  const src = state.maps.find((m) => m.id === mapId);
  if (!src) return state;
  const srcSheet = sheetOf(src);
  const copy = {
    ...src,
    id: uniqueMapId(state, `${src.id}_copy`),
    name: uniqueMapName(state, `${src.name} COPY`),
    tables: src.tables.map((t) => ({ ...t, seats: (t.seats || []).map((s) => ({ ...s })) })),
    sheet: {
      walls: srcSheet.walls.map((w) => ({ ...w, pts: w.pts.map((p) => [...p]) })),
      openings: srcSheet.openings.map((o) => ({ ...o })),
      zones: srcSheet.zones.map((z) => ({ ...z })),
      planters: srcSheet.planters.map((p) => ({ ...p })),
    },
  };
  return { ...state, maps: [...state.maps, copy] };
}

// Guards: the last map of a kind is undeletable (the room can't vanish);
// deleting the active dining map falls back to another dining map.
export function deleteMap(state, mapId) {
  const map = state.maps.find((m) => m.id === mapId);
  if (!map) return state;
  if (state.maps.filter((m) => m.kind === map.kind).length <= 1) return state;
  const maps = state.maps.filter((m) => m.id !== mapId);
  const activeDiningMapId = state.activeDiningMapId === mapId
    ? maps.find((m) => m.kind === "dining").id
    : state.activeDiningMapId;
  return { ...state, maps, activeDiningMapId };
}

export const hasDefaultGeometry = (mapId) =>
  buildDefaultFloorMaps().maps.some((m) => m.id === mapId);

// RESET TO DEFAULTS: replaces ONLY this map's tables + sheet from the seed,
// keeping every other map (including user-created ones) intact. Stamps the
// blob's geometryVersion current — the banner is a nudge toward the newest
// seeds, not a per-map ledger, so one conscious reset acknowledges them.
export function resetMapToDefaults(state, mapId) {
  const seed = buildDefaultFloorMaps().maps.find((m) => m.id === mapId);
  if (!seed) return state;
  const next = patchMaps(state, mapId, (m) => ({ ...m, tables: seed.tables, sheet: seed.sheet || emptySheet() }));
  return next === state ? state : { ...next, geometryVersion: GEOMETRY_VERSION };
}

// ── floor status (SET / DIRTY strips) ───────────────────────────────────────
// One settings row for every map's hands-call strips:
//   floor_status_v1 = { [mapId]: { [label]: 'SET' | 'DIRTY' } }
// Keyed per map per spec — dining layouts don't share strips across a switch
// (layout switches are pre-service). The strip cycle is — → DIRTY → SET → —.

const STATUS_VALUES = ["SET", "DIRTY"];

export function sanitizeFloorStatus(state) {
  if (!state || typeof state !== "object") return {};
  const out = {};
  for (const [mapId, byLabel] of Object.entries(state)) {
    if (!byLabel || typeof byLabel !== "object") continue;
    const clean = {};
    for (const [label, val] of Object.entries(byLabel)) {
      if (STATUS_VALUES.includes(val)) clean[label] = val;
    }
    if (Object.keys(clean).length) out[mapId] = clean;
  }
  return out;
}

export const floorStatusOf = (status, mapId, label) =>
  STATUS_VALUES.includes(status?.[mapId]?.[label]) ? status[mapId][label] : null;

export function setFloorStatus(status, mapId, label, val) {
  if (!mapId || !label) return sanitizeFloorStatus(status);
  const clean = sanitizeFloorStatus(status);
  const byLabel = { ...(clean[mapId] || {}) };
  if (val) byLabel[label] = val; else delete byLabel[label];
  if (Object.keys(byLabel).length) return { ...clean, [mapId]: byLabel };
  const { [mapId]: _drop, ...rest } = clean;
  return rest;
}

// Tap = SET toggle. DIRTY is never set by hand (per Djan) — it only arrives
// automatically when a terrace party vacates a table — and a tap on a DIRTY
// table clears it (the terrace sheet's MARK CLEAN).
export function cycleFloorStatus(status, mapId, label) {
  const cur = floorStatusOf(status, mapId, label);
  return setFloorStatus(status, mapId, label, cur ? null : "SET");
}

// One-time read-through of the deprecated terrace_state_v1 row: its DIRTY
// labels fold into the terrace map's bucket, but only while that bucket is
// still empty — once floor_status_v1 carries terrace strips, the old row
// (which stale devices may still write) is never read again.
export function migrateTerraceState(status, terraceState, terraceMapId) {
  const clean = sanitizeFloorStatus(status);
  if (!terraceMapId || clean[terraceMapId]) return clean;
  const labels = Object.keys(sanitizeTerraceState(terraceState).dirty);
  if (!labels.length) return clean;
  return { ...clean, [terraceMapId]: Object.fromEntries(labels.map((l) => [l, "DIRTY"])) };
}

// ── ticker counts ───────────────────────────────────────────────────────────
// Pure aggregation for the strip above the canvas: COVERS · SEATED · RES ·
// SET n · DIRTY n. `entries` is the visible map's per-table presentation
// (status, pax, strip) — derivation stays with the caller, counting here.
export function mapTicker(entries) {
  const t = { covers: 0, seated: 0, reserved: 0, set: 0, dirty: 0 };
  for (const e of entries || []) {
    if (!e) continue;
    if (e.status === "occupied") { t.seated++; t.covers += Number(e.pax) || 0; }
    if (e.status === "reserved" || e.status === "arriving") t.reserved++;
    if (e.strip === "SET") t.set++;
    if (e.strip === "DIRTY") t.dirty++;
  }
  return t;
}

// ── terrace occupancy + DIRTY state ─────────────────────────────────────────
// Terrace tables never enter service_tables (its table_id CHECK is 1..10);
// occupancy is derived from the day's reservations. DIRTY strips now live in
// floor_status_v1 (above); the terrace_state_v1 helpers below survive only
// for the read-through migration and for stale devices still writing it.
export function terraceOccupancy(reservations) {
  const byLabel = {};
  for (const r of reservations || []) {
    const d = r.data || {};
    if ((d.visit_state || "booked") === "terrace" && d.terrace_table) byLabel[d.terrace_table] = r;
  }
  return byLabel;
}

export function sanitizeTerraceState(state) {
  return { dirty: state && typeof state.dirty === "object" && state.dirty ? state.dirty : {} };
}

export const isTerraceDirty = (terraceState, label) => !!terraceState?.dirty?.[label];

export function setTerraceDirty(terraceState, label, dirty) {
  const next = { ...(terraceState?.dirty || {}) };
  if (dirty) next[label] = true; else delete next[label];
  return { ...sanitizeTerraceState(terraceState), dirty: next };
}
