// ── Reservation → board reconcile (pure) ─────────────────────────────────────
// Templates blank/reserved tables from the day's reservations: fills name,
// time, menu, guest count and seats, and clears tables whose reservation went
// away. It is STRICTLY non-destructive to live service: a table holding any
// staff-entered work (tableHasServiceContent) is never rebuilt or blanked —
// running this against a momentarily-stale board is what once wiped a whole
// service. Pure so the rule is locked down by tests, not buried in a setState.

import {
  blankTable, sanitizeTable, makeSeats,
  reservationDescriptiveFields, tableHasServiceContent, mergeRestrictionPositions,
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

  // Guests already LIVE on the board (a table holding service content). A
  // single-table reservation whose guest is already seated must NOT be
  // re-templated onto a different blank table: that is the "switched guest
  // duplicated onto their old table" bug — the board move landed before the
  // reservation's table_id caught up, so the stale reservation still points at
  // the vacated table. Trust the seated board over a lagging reservation.
  const resvKey = (name, time) => `${String(name || "").trim().toLowerCase()}|${String(time || "")}`;
  const seatedGuests = new Set();
  for (const t of prevTables || []) {
    // celebrationKeys are ignored in the content check: the reconcile seeds
    // those extras itself from the reservation's birthday flag, and counting
    // them froze every birthday table after its first template (see
    // tableHasServiceContent).
    if (tableHasServiceContent(t, celebrationKeys) && (t.resName || t.resTime)) {
      seatedGuests.add(resvKey(t.resName, t.resTime));
    }
  }

  let changed = false;
  const next = (prevTables || []).map((t) => {
    if (tableHasServiceContent(t, celebrationKeys)) return t; // live STAFF work is sacrosanct

    const owner = byTable.get(t.id);
    if (owner && owner.group.length <= 1 && seatedGuests.has(resvKey(owner.d.resName, owner.d.resTime))) {
      // This booking's guest is already seated elsewhere — don't duplicate them
      // onto this (vacated) table. Keep it blank.
      const blank = blankTable(t.id);
      if (eq(t, blank)) return t;
      changed = true;
      return blank;
    }
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
      // Preserve per-seat restriction positions assigned on the board.
      restrictions: mergeRestrictionPositions(t.restrictions, d.restrictions),
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
