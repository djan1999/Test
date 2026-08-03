// ── Table sheet state (pure) ──────────────────────────────────────────────────
// The badge line at the top of the table side sheet, and the two alarm clocks
// the operator actually reads across a room: "this party is late" and "nothing
// has left the pass for this table in a while".
//
// Everything here derives from the live board row plus the terrace-flow visit
// decoration App already computes; nothing is persisted. Pure so the badge
// precedence and the alarm arithmetic are pinned by tests instead of being
// re-derived inside a render.

import { parseHHMM } from "./tableHelpers.js";

// Minutes past the booked time before the DELAYED badge starts blinking. It
// appears the moment a party is late; the blink is the escalation.
export const ARRIVAL_DELAY_ALARM_MIN = 10;

// Minutes since the table's last fire before COURSES turns red. A table that
// has been sitting this long between courses is the one to walk to next.
export const LAST_FIRE_ALARM_MIN = 25;

const MIN_PER_DAY = 24 * 60;

/** Minutes since midnight for a Date (defaults to now). */
export const minutesOfDay = (d = new Date()) => d.getHours() * 60 + d.getMinutes();

// Difference in minutes between two minutes-of-day values on one service
// night. A gap that looks like it went backwards by more than 12h is the
// service crossing midnight, not a negative gap (same rule as fireCadence).
const elapsedSince = (fromMin, nowMin) => {
  if (fromMin == null || nowMin == null) return null;
  let d = nowMin - fromMin;
  if (d < -12 * 60) d += MIN_PER_DAY;
  return d;
};

/**
 * How many minutes past its booked time a party is, or null when the question
 * doesn't apply (already seated, walk-in with no booked time, still early).
 */
export function arrivalDelayMinutes(table, nowMin = minutesOfDay()) {
  if (!table || table.active || table.arrivedAt) return null;
  const booked = parseHHMM(table.resTime);
  const late = elapsedSince(booked, nowMin);
  return late != null && late > 0 ? late : null;
}

/**
 * The sheet's state badge.
 *
 * Precedence runs from the most transient, most actionable state down to the
 * most settled one: a party still outside (TERRACE) outranks the fact that its
 * table is also SET, which outranks the table merely being LIVE. `visit` is
 * App's terrace-flow decoration (`table._visit`).
 *
 * @returns {{ key: string, label: string, at: string|null }}
 */
export function tableBadgeState(table, { visit = null } = {}) {
  const v = visit?.visit || table?._visit?.visit || null;
  if (v === "terrace") {
    return { key: "terrace", label: "TERRACE", at: visit?.terraceLabel || table?._visit?.terraceLabel || null };
  }
  if (table?.courseReady) return { key: "set", label: "SET", at: table.courseReady.at || null };
  if (table?.active) return { key: "live", label: "LIVE", at: table.arrivedAt || null };
  if (table?.resName || table?.resTime) return { key: "reserved", label: "RESERVED", at: table?.resTime || null };
  return { key: "cleared", label: "CLEARED", at: table?.clearedAt || null };
}

/**
 * Fire progress for the COURSES panel header: where the table is in its menu
 * and how long the pass has been quiet.
 *
 * @param {object} table    board row (for arrivedAt — the clock starts at the
 *                          seat, not at the first fire)
 * @param {object[]} courses  visible courses (getVisibleCoursesForTable shape)
 * @returns {{ firedCount, total, nextIndex, lastFiredAt, minsSinceFire, alarm }}
 */
export function courseFireState(table, courses = [], nowMin = minutesOfDay()) {
  const list = Array.isArray(courses) ? courses : [];
  const fired = list.filter(c => c.firedAt);
  const total = list.length;
  // Latest stamp by clock time, not by menu position: the kitchen fires out of
  // order often enough that "the last course in the list that has a time" is
  // the wrong answer for "how long since anything left the pass".
  const lastFiredAt = fired
    .map(c => c.firedAt)
    .filter(Boolean)
    .sort((a, b) => (parseHHMM(a) ?? 0) - (parseHHMM(b) ?? 0))
    .pop() || null;

  const sinceRef = lastFiredAt || table?.arrivedAt || null;
  const minsSinceFire = elapsedSince(parseHHMM(sinceRef), nowMin);
  const nextIdx = list.findIndex(c => !c.firedAt);

  return {
    firedCount: fired.length,
    total,
    // 1-based menu position of the course the table is waiting on; equals
    // total when the menu is complete so the header reads n/n.
    nextIndex: nextIdx >= 0 ? list[nextIdx].index : total,
    lastFiredAt,
    minsSinceFire: minsSinceFire != null && minsSinceFire >= 0 ? minsSinceFire : null,
    alarm: minsSinceFire != null && minsSinceFire >= LAST_FIRE_ALARM_MIN,
  };
}

/**
 * Which sheet actions are legal for this table right now. The action grid
 * renders only what comes back true — an operator must never be able to tap
 * a transition the state machine will silently refuse.
 */
export function sheetActionAvailability(table, { visit = null, isGrouped = false } = {}) {
  const v = visit?.visit || table?._visit?.visit || null;
  const seated = !!table?.active;
  const booked = !!(table?.resName || table?.resTime);
  const live = seated || booked || !!table?.arrivedAt;
  return {
    // MARK SEATED is the sheet's single primary action, so it is deliberately
    // absent from the grid; it disappears the moment the party is seated.
    // SET / UNSET are likewise absent — they live in the COURSES panel, which
    // is where the operator is already looking at what would be set.
    markSeated: !seated && (booked || v === "terrace"),
    // A partial move of a combined booking desyncs the other members'
    // tableGroup and the party vanishes from the board (see App.moveTableState).
    moveTable: live && !isGrouped,
    swapTable: live && !isGrouped,
    joinTable: live && !isGrouped,
    splitTable: isGrouped,
    ticket: live,
    clearTable: live,
    // EDIT RESERVATION — the booking facts (name, covers, sitting, menu,
    // language, room, cake). Offered wherever there IS a booking to correct;
    // a blank table has nothing to edit and gets the button hidden rather
    // than a form full of empty fields.
    editBooking: live,
  };
}
