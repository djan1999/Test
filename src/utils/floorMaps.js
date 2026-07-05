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
export const TERRACE_STATE_KEY = "terrace_state_v1";

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

export function buildDefaultFloorMaps() {
  return {
    maps: [
      {
        id: "dining_a",
        kind: "dining",
        name: "LAYOUT A",
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
export function seatDisplayPoints(table) {
  const { x, y, w, h } = table;
  return (table.seats || []).map((s) => {
    if (s.angle != null) {
      const cx = x + w / 2, cy = y + h / 2, r = Math.min(w, h) / 2;
      const rad = (s.angle * Math.PI) / 180;
      const ox = Math.sin(rad), oy = -Math.cos(rad);
      return { no: s.no, confirm: !!s.confirm, x: cx + r * ox, y: cy + r * oy, out: { x: ox, y: oy } };
    }
    const t = s.offset ?? 0.5;
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

// ── terrace occupancy + DIRTY state ─────────────────────────────────────────
// Terrace tables never enter service_tables (its table_id CHECK is 1..10);
// occupancy is derived from the day's reservations, DIRTY strips live in the
// `terrace_state_v1` settings row.
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
