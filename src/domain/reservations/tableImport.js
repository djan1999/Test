// Loop 3 — dining room → reservations. A copy, taken on demand. Never a
// dependency.
//
// Reservations must not invent tables: the floor map is the truth about what
// exists. But availability must not read the live floor either — a layout
// switched mid-service would silently change what could be booked next month,
// and a floor read that fails would take /book down with it. So the floor is
// COPIED into reservation_config.tables when somebody asks for it, and the
// copy is what the engine uses.
//
// The import is a proposal, not an application. It returns the tables it would
// write, the joins it found, and a plain-language list of what would change,
// so the Admin panel can show it before anything is saved — the same
// "what will change?" contract every other reservation setting has.
//
// Read-only in the other direction, absolutely: nothing here writes a floor
// map, a board table or any live-service state.

import { normalizeReservationConfig } from "./config.js";

/** Board slots are integers, reservation tables are labels: 4 → "T04". */
export function labelForBoardId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? `T${String(id).padStart(2, "0")}` : null;
}

const labelBoardIds = (label) => {
  const match = /^T?(\d+)(?:-(\d+))?$/.exec(String(label || "").trim().toUpperCase());
  if (!match) return [];
  const first = Number(match[1]);
  const last = match[2] == null ? first : Number(match[2]);
  if (last < first || last - first > 11) return [];
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
};

/** Board slots a map table claims. Explicit `boardIds` win; otherwise the
 *  label is read ("T4" → 4, "T2-3" → 2 and 3), exactly as floorMaps.js does. */
export function boardIdsOfMapTable(mapTable) {
  return Array.isArray(mapTable?.boardIds) && mapTable.boardIds.length
    ? mapTable.boardIds.map(Number).filter(Number.isFinite)
    : labelBoardIds(mapTable?.label);
}

/**
 * Read a dining map into a reservation table list.
 *
 * A map table with `members` is a merge — two real tables pushed together. It
 * becomes a joinable PAIR, not a table of its own: the reservation engine is
 * what decides when to join them, and inventing a permanent 6-top that only
 * exists when the floor is rearranged would overstate the room.
 *
 * Seat counts come from the map's own seat geometry, which is what the room
 * actually holds. A table with no seats drawn is skipped rather than guessed.
 *
 * @param {object} map    a dining map from floor_maps_v1
 * @param {object} [current] the reservation config being edited — its seat
 *                           overrides and removals are respected, so a manual
 *                           "this one is never bookable" survives a re-import
 * @returns {{ tables: Array, combos: Array, changes: Array, skipped: Array }}
 */
export function tablesFromDiningMap(map, current = null) {
  const config = current ? normalizeReservationConfig(current) : null;
  const existing = new Map((config?.tables || []).map((table) => [String(table.id).toUpperCase(), table]));
  const excluded = new Set(
    (config?.tableImport?.excluded || []).map((id) => String(id).toUpperCase()),
  );

  const tables = [];
  const combos = [];
  const skipped = [];

  (map?.tables || []).forEach((mapTable) => {
    const members = Array.isArray(mapTable.members) ? mapTable.members.filter(Boolean) : [];
    if (members.length > 1) {
      // A merge on the floor plan is a join the room can make, not a table.
      const pair = members
        .map((label) => labelForBoardId(labelBoardIds(label)[0]))
        .filter(Boolean);
      if (pair.length > 1) combos.push([...new Set(pair)]);
      return;
    }

    const [boardId] = boardIdsOfMapTable(mapTable);
    const id = labelForBoardId(boardId);
    if (!id) {
      skipped.push({ label: mapTable.label, reason: "no board slot" });
      return;
    }
    if (excluded.has(id)) {
      skipped.push({ label: id, reason: "marked not bookable" });
      return;
    }
    const seats = Array.isArray(mapTable.seats) ? mapTable.seats.length : 0;
    if (!seats) {
      skipped.push({ label: id, reason: "no seats drawn" });
      return;
    }
    tables.push({ id, seats });
  });

  tables.sort((a, b) => a.id.localeCompare(b.id));
  // Only pairs whose tables both survived the import can be joined.
  const bookable = new Set(tables.map((table) => table.id));
  const usableCombos = combos
    .map((pair) => pair.filter((label) => bookable.has(label)))
    .filter((pair) => pair.length > 1);

  return {
    tables,
    combos: dedupePairs([...(config?.combos || []).map((pair) => pair.map(String)), ...usableCombos], bookable),
    changes: describeImport(config, tables, usableCombos),
    skipped,
  };
}

function dedupePairs(pairs, bookable) {
  const seen = new Set();
  return pairs
    .map((pair) => pair.map((label) => String(label).toUpperCase()))
    .filter((pair) => pair.length > 1 && pair.every((label) => bookable.has(label)))
    .filter((pair) => {
      const key = [...pair].sort().join("+");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** What the restaurant would be agreeing to. Named in covers and table
 *  numbers, because "3 tables changed" tells a manager nothing. */
function describeImport(config, tables, combos) {
  if (!config) return [];
  const before = new Map((config.tables || []).map((table) => [String(table.id).toUpperCase(), Number(table.seats)]));
  const after = new Map(tables.map((table) => [table.id, table.seats]));
  const changes = [];

  after.forEach((seats, id) => {
    if (!before.has(id)) {
      changes.push({ label: `${id} becomes bookable`, from: "—", to: `${seats} seats` });
    } else if (before.get(id) !== seats) {
      changes.push({ label: `${id} seats`, from: `${before.get(id)}`, to: `${seats}` });
    }
  });
  before.forEach((seats, id) => {
    if (!after.has(id)) {
      changes.push({
        label: `${id} is no longer in the dining room`,
        from: `${seats} seats`,
        to: "removed",
        warning: "Bookings already on this table keep it — availability stops offering it.",
      });
    }
  });

  const knownCombos = new Set((config.combos || []).map((pair) => [...pair.map(String)].sort().join("+")));
  combos.forEach((pair) => {
    const key = [...pair].sort().join("+");
    if (!knownCombos.has(key)) {
      changes.push({ label: `${pair.join(" + ")} can be joined`, from: "—", to: "joinable" });
    }
  });

  const coversBefore = [...before.values()].reduce((total, seats) => total + seats, 0);
  const coversAfter = [...after.values()].reduce((total, seats) => total + seats, 0);
  if (coversBefore !== coversAfter) {
    changes.push({
      label: "Bookable seats in the room",
      from: `${coversBefore}`,
      to: `${coversAfter}`,
      warning: coversAfter < coversBefore
        ? "The room seats fewer people than the reservation settings assumed."
        : undefined,
    });
  }
  return changes;
}
