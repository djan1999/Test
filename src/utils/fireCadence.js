// ── Fire cadence intelligence ─────────────────────────────────
// Derives a table's course rhythm from tonight's fire timestamps and
// extrapolates when the next course is due. Pure functions over the
// visible-courses shape returned by getVisibleCoursesForTable().

import { parseHHMM } from "./tableHelpers.js";

// Normalize an ordered list of HH:MM stamps into monotonically increasing
// minute values, adding 24h whenever a step goes backwards (a dinner service
// legitimately crosses midnight).
export function toMonotonicMinutes(stamps) {
  const out = [];
  let prev = null;
  for (const s of stamps) {
    let m = parseHHMM(s);
    if (m == null) continue;
    while (prev != null && m < prev) m += 24 * 60;
    out.push(m);
    prev = m;
  }
  return out;
}

// Fire intervals for one table tonight: arrival → first fire, then each
// fire → fire gap. Gaps over 3h are discarded as stale/garbage data.
export function fireGapsForTable(table, courses) {
  const stamps = [];
  if (table?.arrivedAt) stamps.push(table.arrivedAt);
  (courses || []).forEach(c => { if (c.firedAt) stamps.push(c.firedAt); });
  const mins = toMonotonicMinutes(stamps);
  const gaps = [];
  for (let i = 1; i < mins.length; i++) {
    const g = mins[i] - mins[i - 1];
    if (g >= 0 && g <= 180) gaps.push(g);
  }
  return gaps;
}

export function median(arr) {
  if (!arr || arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Predict when the table's next course is due.
 *
 * Cadence source, in order of trust:
 *   1. median of the table's own intervals (needs ≥ 2 — its actual rhythm)
 *   2. median of the room's pooled intervals tonight (needs ≥ 3)
 *   3. the table's single interval, if that's all there is
 * No usable data → null (never guess from thin air).
 *
 * Returns { dueInMin, cadenceMin, basis } or null when there is nothing
 * fired yet, the menu is complete, or no cadence can be derived.
 * dueInMin < 0 means the course is overdue by that many minutes.
 */
export function estimateNextFire({ table, courses, roomGaps = [], now = new Date() }) {
  const fired = (courses || []).filter(c => c.firedAt);
  if (fired.length === 0 || fired.length === (courses || []).length) return null;

  const ownGaps = fireGapsForTable(table, courses);
  let cadence = null, basis = null;
  if (ownGaps.length >= 2)      { cadence = median(ownGaps);  basis = "table"; }
  else if (roomGaps.length >= 3){ cadence = median(roomGaps); basis = "room"; }
  else if (ownGaps.length === 1){ cadence = ownGaps[0];       basis = "table"; }
  if (cadence == null) return null;

  const stamps = [];
  if (table?.arrivedAt) stamps.push(table.arrivedAt);
  fired.forEach(c => stamps.push(c.firedAt));
  const lastFireMin = toMonotonicMinutes(stamps).pop();
  if (lastFireMin == null) return null;

  let nowMin = now.getHours() * 60 + now.getMinutes();
  while (nowMin < lastFireMin) nowMin += 24 * 60;
  const sinceLast = nowMin - lastFireMin;

  return {
    dueInMin: Math.round(cadence - sinceLast),
    cadenceMin: Math.round(cadence),
    basis,
  };
}
