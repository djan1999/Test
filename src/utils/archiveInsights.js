// ── Archive intelligence ─────────────────────────────────────────────
// Pure functions over `service_archive` rows ({ date, label, state }).
// Each state snapshot carries the night's tables (seats, kitchenLog fire
// timestamps, pairings, restrictions) and the menu courses that were live —
// everything needed to answer "how do our services actually run?" without
// any new data entry.
//
// The kitchen's fire timestamps live on the TABLE (`kitchenLog`), so every
// scan here reads them from there and treats the menu as naming/ordering
// context only (see firedCoursesForTable). Entries whose menu context is thin
// — an auto-ended service filed without a snapshot, a course retired since the
// night, an optional dish whose "ordered" marker never made it into the
// snapshot — therefore keep their timings instead of silently reporting none.
// Callers may pass `{ menuCourses }` as a fallback (the live menu) to name
// courses an entry can no longer name for itself.

import { getVisibleCoursesForTable } from "./courseProgress.js";
import { fireGapsForTable, median, toMonotonicMinutes } from "./fireCadence.js";
import { mergeTableGroups, parseHHMM } from "./tableHelpers.js";
import { celebrationKeysFromCourses } from "./menuUtils.js";

// A party seated across several tables (a "group") has the full reservation
// guest count stamped on EVERY member table, and each member carries its own
// seats. Counting raw archived tables therefore double-counts covers, seats
// and fire timelines. mergeTableGroups() collapses each group to one primary
// row (with combined seats/kitchenLog and a correct `_groupGuests`), exactly
// as the archive screen already does — so every scan here runs on it first.
// Judged against the entry's own menu where it has one (see menuFor):
// birthday-seeded celebration extras must not make a secondary table's blank
// seats count as covers.
const partyTables = (entry, menuCourses) => mergeTableGroups(
  entry?.state?.tables || [],
  celebrationKeysFromCourses(menuCourses || []),
);
const tableGuests = (t) => Number(t?._groupGuests ?? t?.guests) || 0;

// The menu context for one entry: its own snapshot when it has one, otherwise
// the caller's fallback (the live menu). A service ended by the rollover
// auto-end — or by the store's single-live trigger — is filed with no
// snapshot at all, and reading `state.menuCourses` alone left every scan here
// with no courses for that night.
const menuFor = (entry, fallback) => {
  const own = entry?.state?.menuCourses;
  if (Array.isArray(own) && own.length > 0) return own;
  return Array.isArray(fallback) ? fallback : [];
};

// Best available display name for a course key: the table's own kitchen
// override first, then the menu row (retired courses still carry their name),
// then the raw key.
const courseNameFor = (key, table, menuCourses) => {
  const override = table?.kitchenCourseNotes?.[key]?.name;
  if (override) return String(override);
  const row = (menuCourses || []).find((c) => c?.course_key === key);
  return row?.menu?.name || row?.menu_si?.name || String(key);
};

/**
 * The courses one archived table has fire data for: { key, name, firedAt }.
 *
 * Menu-derived visibility comes first — it carries the display names and the
 * menu order. Every OTHER key the kitchen logged a fire against is appended,
 * because a logged fire is hard evidence the course was cooked and must not be
 * discarded for lacking menu context. Three real cases produced exactly that:
 * a course retired since the night (is_active = false hides it), an
 * optional/celebration dish that fired without an "ordered" marker in the
 * snapshot, and an entry carrying no menu snapshot at all. Each silently
 * erased that course's timings — and with them the night's gaps and duration.
 */
export function firedCoursesForTable(table, menuCourses) {
  const visible = getVisibleCoursesForTable(table, menuCourses || []);
  const log = table?.kitchenLog || {};
  const known = new Set(visible.map((c) => c.key));
  const extras = [];
  for (const key of Object.keys(log)) {
    if (known.has(key) || !log[key]?.firedAt) continue;
    extras.push({ key, name: courseNameFor(key, table, menuCourses), firedAt: log[key].firedAt });
  }
  return extras.length > 0 ? [...visible, ...extras] : visible;
}

// A party that actually SAT: arrival/kitchen markers, or seats carrying real
// service content (pairings/drinks — staff served them even if nobody tapped
// "seat"). The archive also files never-arrived reservations (a templated
// resName/resTime row with blank seats) — a no-show must not count as covers
// or dilute the pairing percentage.
const seatHasContent = (s) => seatHasPairing(s)
  || ["aperitifs", "glasses", "cocktails", "spirits", "beers"]
    .some((k) => (s?.[k] || []).filter(Boolean).length > 0);
const tableWasSeated = (t) => Boolean(
  t && (t.active || t.arrivedAt
    || (t.kitchenLog && Object.keys(t.kitchenLog).length > 0)
    || t.kitchenArchived
    || (t.bottleWines || []).length > 0
    || (t.seats || []).some(seatHasContent)),
);

const normName = (v) => String(v || "").trim().toLowerCase();
const normMenuKey = (v) => String(v || "").trim().toLowerCase() || "*";

/** Seats with a real pairing choice (Wine / Non-Alc / Premium / …, not "—"). */
const seatHasPairing = (seat) => {
  const p = String(seat?.pairing || "").trim();
  return Boolean(p && p !== "—");
};

/**
 * Stats for one archived service. `fallbackMenuCourses` (the live menu) names
 * courses for entries filed without a menu snapshot.
 * Returns { date, label, covers, tableCount, gaps, medianGap, seats, paired,
 *           durations, courseGaps: Map<name, number[]> }.
 */
export function archiveEntryStats(entry, { menuCourses: fallbackMenuCourses = null } = {}) {
  const menuCourses = menuFor(entry, fallbackMenuCourses);
  const tables = partyTables(entry, menuCourses);
  const stats = {
    date: entry?.date || null,
    label: entry?.label || "",
    covers: 0,
    tableCount: tables.length,
    gaps: [],
    seats: 0,
    paired: 0,
    durations: [],
    courseGaps: new Map(),
  };

  for (const t of tables) {
    // No-shows (templated reservation, nobody arrived) are filed in the
    // archive too — they are not covers, and their blank templated seats
    // must not dilute the pairing percentage.
    if (!tableWasSeated(t)) continue;
    stats.covers += tableGuests(t);
    // Pairing uptake counts GUESTS: a merged group's primary row carries the
    // concatenated member seats, including blank placeholder seats that
    // represent nobody — capping at the party size keeps the denominator
    // honest (paired can never exceed the people at the table).
    const guestCount = tableGuests(t);
    const seatList = t?.seats || [];
    const pairedSeats = seatList.filter(seatHasPairing).length;
    stats.seats += guestCount > 0 ? guestCount : seatList.length;
    stats.paired += guestCount > 0 ? Math.min(pairedSeats, guestCount) : pairedSeats;

    const courses = firedCoursesForTable(t, menuCourses);
    stats.gaps.push(...fireGapsForTable(t, courses));

    // Per-course gap attribution: the wait that *ended* when course X fired
    // belongs to course X — that's the course the kitchen took that long on.
    // Walked in CHRONOLOGICAL order: courses can fire out of menu order, and
    // walking menu order attributed nonsense gaps (or discarded the samples).
    const fired = courses.filter(c => c.firedAt);
    const stamps = [];
    if (t?.arrivedAt) stamps.push({ name: null, at: t.arrivedAt });
    fired.forEach(c => stamps.push({ name: c.name, at: c.firedAt }));
    // Drop unparseable stamps FIRST so names stay aligned with their minutes
    // (toMonotonicMinutes silently skips stamps it can't parse).
    const valid = stamps.filter(x => parseHHMM(x.at) != null);
    const mins = toMonotonicMinutes(valid.map(x => x.at));
    const timeline = valid
      .map((x, i) => ({ name: x.name, min: mins[i] }))
      .sort((a, b) => a.min - b.min);
    for (let i = 1; i < timeline.length; i++) {
      const g = timeline[i].min - timeline[i - 1].min;
      if (g < 0 || g > 180) continue;
      const name = timeline[i].name;
      if (!name) continue;
      if (!stats.courseGaps.has(name)) stats.courseGaps.set(name, []);
      stats.courseGaps.get(name).push(g);
    }
    if (timeline.length >= 2 && t?.arrivedAt) {
      const dur = timeline[timeline.length - 1].min - timeline[0].min;
      if (dur > 0 && dur <= 12 * 60) stats.durations.push(dur);
    }
  }

  stats.medianGap = median(stats.gaps);
  return stats;
}

/**
 * Aggregate insights across archived services (newest first or any order).
 * `menuCourses` (the live menu) is the naming fallback for entries filed
 * without a menu snapshot. Returns null when there is nothing to aggregate.
 */
export function aggregateInsights(entries, { menuCourses = null } = {}) {
  const perEntry = (entries || []).map((entry) => archiveEntryStats(entry, { menuCourses }))
    .filter(e => e.tableCount > 0 || e.covers > 0);
  if (perEntry.length === 0) return null;

  const allGaps = perEntry.flatMap(e => e.gaps);
  const allDurations = perEntry.flatMap(e => e.durations);
  const seats = perEntry.reduce((a, e) => a + e.seats, 0);
  const paired = perEntry.reduce((a, e) => a + e.paired, 0);
  const totalCovers = perEntry.reduce((a, e) => a + e.covers, 0);

  // Slowest courses: median gap per course name, ≥3 samples so one bad
  // night doesn't crown a scapegoat.
  const courseGaps = new Map();
  for (const e of perEntry) {
    for (const [name, gaps] of e.courseGaps) {
      if (!courseGaps.has(name)) courseGaps.set(name, []);
      courseGaps.get(name).push(...gaps);
    }
  }
  const slowestCourses = [...courseGaps.entries()]
    .filter(([, gaps]) => gaps.length >= 3)
    .map(([name, gaps]) => ({ name, medianGap: Math.round(median(gaps)), samples: gaps.length }))
    .sort((a, b) => b.medianGap - a.medianGap);

  return {
    services: perEntry.length,
    totalCovers,
    avgCovers: Math.round(totalCovers / perEntry.length),
    medianGap: allGaps.length ? Math.round(median(allGaps)) : null,
    medianDuration: allDurations.length ? Math.round(median(allDurations)) : null,
    pairingPct: seats > 0 ? Math.round((paired / seats) * 100) : null,
    pairingSeats: seats,
    slowestCourses,
    perEntry,
  };
}

/**
 * Historical fire gaps grouped by menu type (lowercased), plus "*" for all.
 * Used to seed tonight's cadence prediction before the room has any rhythm.
 * Gaps come from the tables' own fire log, so a night filed without a menu
 * snapshot still teaches the prediction its rhythm.
 */
export function historyGapsByMenuType(entries, { menuCourses: fallbackMenuCourses = null } = {}) {
  const out = { "*": [] };
  for (const entry of entries || []) {
    const menuCourses = menuFor(entry, fallbackMenuCourses);
    const tables = partyTables(entry, menuCourses);
    for (const t of tables) {
      const courses = firedCoursesForTable(t, menuCourses);
      const gaps = fireGapsForTable(t, courses);
      if (gaps.length === 0) continue;
      out["*"].push(...gaps);
      const key = normMenuKey(t?.menuType);
      if (key !== "*") {
        if (!out[key]) out[key] = [];
        out[key].push(...gaps);
      }
    }
  }
  return out;
}

/** Pick the gap pool for a table's menu type, falling back to the overall pool. */
export function gapsForMenuType(gapsByMenuType, menuType) {
  if (!gapsByMenuType) return [];
  const key = normMenuKey(menuType);
  const own = key !== "*" ? gapsByMenuType[key] : null;
  if (own && own.length >= 3) return own;
  return gapsByMenuType["*"] || [];
}

/**
 * Guest memory: find what a returning guest had on previous visits.
 * Scans archived tables for reservation names containing `name`
 * (case-insensitive, needs ≥3 chars). Newest first, up to `limit` visits.
 *
 * Each match: { date, label, name, guests, menuType, pairings: string[],
 *               restrictions: string[], birthday, drinks: number }.
 */
export function findGuestHistory(name, entries, { limit = 5, menuCourses = null } = {}) {
  const q = normName(name);
  if (q.length < 3) return [];
  const matches = [];
  for (const entry of entries || []) {
    for (const t of partyTables(entry, menuFor(entry, menuCourses))) {
      const resName = normName(t?.resName);
      if (!resName || !resName.includes(q)) continue;
      const pairings = [...new Set((t.seats || []).map(s => String(s?.pairing || "").trim())
        .filter(p => p && p !== "—"))];
      const restrictions = [...new Set((t.restrictions || []).map(r => String(r?.note || "").trim())
        .filter(Boolean))];
      const drinks = (t.seats || []).reduce((a, s) =>
        a + ["aperitifs", "glasses", "cocktails", "spirits", "beers"]
          .reduce((b, k) => b + ((s?.[k] || []).filter(Boolean).length), 0), 0)
        + (t.bottleWines || []).length;
      matches.push({
        date: entry?.date || null,
        label: entry?.label || "",
        name: t.resName,
        guests: tableGuests(t),
        menuType: t?.menuType || "",
        pairings,
        restrictions,
        birthday: !!t?.birthday,
        drinks,
      });
      if (matches.length >= limit) return matches;
    }
  }
  return matches;
}
