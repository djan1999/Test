// ── Board write guard ────────────────────────────────────────────────────────
// Last line of defence against the "lost the whole service" wipe. Whatever the
// trigger (a stale reconcile, a bad merge, a future regression), the damage can
// only spread if a blanked table row is PUSHED to Supabase over the good data —
// from there realtime carries it to every device. This planner refuses to
// persist a *mass* destructive blank: 2+ tables going from holding live service
// data to empty in a single save tick, unless those tables were explicitly
// emptied by the user (clear/archive — passed in `intentionalEmpty`).
//
// It fails SAFE: a blocked table keeps its previous baseline (so it stays dirty
// and the next remote merge restores it) and the caller restores it locally.
// The worst case is a legitimate-but-unmarked mass clear not sticking — the
// opposite of data loss. Single-table clears are never blocked.

import { tableHasServiceContent } from "./tableHelpers.js";

const jsonHasContent = (json) => {
  try { return tableHasServiceContent(JSON.parse(json)); } catch { return false; }
};

/**
 * @param {string[]} prevJson  - last persisted sanitized-table JSON, by index
 * @param {object[]} nextTables - current table objects, index-aligned with prevJson
 * @param {string[]} nextJson  - sanitized-table JSON of nextTables, by index
 * @param {Set<number>} intentionalEmpty - table ids the user explicitly emptied
 * @param {number} blockThreshold - min simultaneous unexplained blanks to block
 * @returns {{ writes: object[], baseline: string[], blocked: number[] }}
 */
export function planBoardWrites({
  prevJson = [], nextTables = [], nextJson = [],
  intentionalEmpty = new Set(), blockThreshold = 2,
}) {
  const changed = [];
  nextTables.forEach((table, idx) => {
    if (nextJson[idx] === prevJson[idx]) return; // untouched
    const destructive =
      jsonHasContent(prevJson[idx]) &&
      !tableHasServiceContent(table) &&
      !intentionalEmpty.has(Number(table?.id));
    changed.push({ table, idx, destructive });
  });

  const suspicious = changed.filter(c => c.destructive);
  const block = suspicious.length >= blockThreshold;

  const writes = [];
  const baseline = [...prevJson];
  const blocked = [];
  for (const c of changed) {
    if (block && c.destructive) {
      // Don't persist the blank; leave baseline[idx] = prevJson[idx] so the row
      // stays dirty and a later remote merge can restore the good state.
      blocked.push(Number(c.table.id));
      continue;
    }
    writes.push(c.table);
    baseline[c.idx] = nextJson[c.idx];
  }
  return { writes, baseline, blocked };
}
