// ── Reservation → board reconcile (pure) ─────────────────────────────────────
// Templates blank/reserved tables from the day's reservations: fills name,
// time, menu, guest count and seats, and clears tables whose reservation went
// away. It is STRICTLY non-destructive to live service: a table holding any
// staff-entered work (tableHasServiceContent) is never rebuilt or blanked —
// running this against a momentarily-stale board is what once wiped a whole
// service. Pure so the rule is locked down by tests, not buried in a setState.

import {
  blankTable, sanitizeTable, makeSeats,
  reservationDescriptiveFields, tableHasServiceContent,
} from "./tableHelpers.js";

const eq = (a, b) => JSON.stringify(sanitizeTable(a)) === JSON.stringify(sanitizeTable(b));

/**
 * @param {object[]} prevTables   current board tables
 * @param {object[]} reservationRows reservation rows ({ table_id, data }) for the active date+session
 * @param {string[]} celebrationKeys optional-extra keys seeded from the birthday flag
 * @returns the next tables array, or `prevTables` unchanged when nothing moved
 */
export function reconcileTables(prevTables, reservationRows, celebrationKeys = []) {
  // table id → the reservation that owns it (first claim wins)
  const byTable = new Map();
  for (const row of reservationRows || []) {
    const d = row.data || {};
    const group = (d.tableGroup?.length > 1 ? d.tableGroup : [row.table_id]).map(Number);
    for (const tid of group) {
      if (!byTable.has(tid)) byTable.set(tid, { d, group });
    }
  }

  let changed = false;
  const next = (prevTables || []).map((t) => {
    if (tableHasServiceContent(t)) return t; // live service is sacrosanct

    const owner = byTable.get(t.id);
    if (!owner) {
      // No reservation maps here — drop a pure reservation ghost (it has no
      // service content, guarded above) back to blank.
      const blank = blankTable(t.id);
      if (eq(t, blank)) return t;
      changed = true;
      return blank;
    }

    const { d, group } = owner;
    const rawSeats = makeSeats(d.guests || 2, t.seats);
    const reconciledSeats = (celebrationKeys && celebrationKeys.length > 0)
      ? rawSeats.map((s) => ({
          ...s,
          extras: {
            ...s.extras,
            ...Object.fromEntries(
              celebrationKeys.map((k) => [k, { ordered: !!d.birthday, pairing: s.extras?.[k]?.pairing || "—" }]),
            ),
          },
        }))
      : rawSeats;

    const updated = {
      ...t,
      ...reservationDescriptiveFields(d),
      guests: d.guests || 2,
      tableGroup: group,
      seats: reconciledSeats,
    };
    if (eq(updated, t)) return t;
    changed = true;
    return updated;
  });

  return changed ? next : prevTables;
}
