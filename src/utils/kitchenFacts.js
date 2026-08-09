// Derive kitchen FACTS from a table's before/after at the autosave choke
// point (Phase 1 of docs/EVENT_LOG_PLAN.md). The autosave diff runs only for
// LOCAL gestures — adoptions advance the baselines directly — so what changed
// here is what someone on THIS device actually did.
//
// Pure and dependency-free: { type, tableId, payload } descriptors, no I/O.

const logOf = (table) => {
  const log = table && typeof table === "object" ? table.kitchenLog : null;
  return log && typeof log === "object" && !Array.isArray(log) ? log : {};
};

/**
 * Facts that turn `prevTable` into `nextTable`, kitchen-wise:
 *  • course_fired   — a course key appeared, or its firedAt changed (a re-fire
 *    is a new fact; the old fire stays true in the log forever)
 *  • course_unfired — a course key disappeared (un-fire, CLEAR, unseat: the
 *    board no longer holds that fire — also a fact)
 */
export function kitchenFactsFromDiff(prevTable, nextTable) {
  const before = logOf(prevTable);
  const after = logOf(nextTable);
  const tableId = Number(nextTable?.id ?? prevTable?.id);
  if (!Number.isFinite(tableId)) return [];
  const facts = [];
  for (const [courseKey, entry] of Object.entries(after)) {
    const firedAt = entry?.firedAt ?? null;
    if (firedAt == null) continue; // an un-fired placeholder is not a fire
    const prevFiredAt = before[courseKey]?.firedAt ?? null;
    if (prevFiredAt !== firedAt) {
      facts.push({ type: "course_fired", tableId, payload: { courseKey, firedAt } });
    }
  }
  for (const [courseKey, entry] of Object.entries(before)) {
    const hadFire = (entry?.firedAt ?? null) != null;
    const stillThere = (after[courseKey]?.firedAt ?? null) != null;
    if (hadFire && !stillThere) {
      facts.push({ type: "course_unfired", tableId, payload: { courseKey, wasFiredAt: entry.firedAt } });
    }
  }
  return facts;
}
