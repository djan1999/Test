// ── Archive intelligence ─────────────────────────────────────────────
// Pure functions over `service_archive` rows ({ date, label, state }).
// Each state snapshot carries the night's tables (seats, kitchenLog fire
// timestamps, pairings, restrictions) and the menu courses that were live —
// everything needed to answer "how do our services actually run?" without
// any new data entry.

import { getVisibleCoursesForTable } from "./courseProgress.js";
import { fireGapsForTable, median, toMonotonicMinutes } from "./fireCadence.js";

const normName = (v) => String(v || "").trim().toLowerCase();
const normMenuKey = (v) => String(v || "").trim().toLowerCase() || "*";

/** Seats with a real pairing choice (Wine / Non-Alc / Premium / …, not "—"). */
const seatHasPairing = (seat) => {
  const p = String(seat?.pairing || "").trim();
  return Boolean(p && p !== "—");
};

/**
 * Stats for one archived service.
 * Returns { date, label, covers, tableCount, gaps, medianGap, seats, paired,
 *           durations, courseGaps: Map<name, number[]> }.
 */
export function archiveEntryStats(entry) {
  const tables = entry?.state?.tables || [];
  const menuCourses = entry?.state?.menuCourses || [];
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
    stats.covers += Number(t?.guests) || 0;
    for (const s of t?.seats || []) {
      stats.seats += 1;
      if (seatHasPairing(s)) stats.paired += 1;
    }

    const courses = getVisibleCoursesForTable(t, menuCourses);
    stats.gaps.push(...fireGapsForTable(t, courses));

    // Per-course gap attribution: the wait that *ended* when course X fired
    // belongs to course X — that's the course the kitchen took that long on.
    const fired = courses.filter(c => c.firedAt);
    const stamps = [];
    if (t?.arrivedAt) stamps.push({ name: null, at: t.arrivedAt });
    fired.forEach(c => stamps.push({ name: c.name, at: c.firedAt }));
    const mins = toMonotonicMinutes(stamps.map(x => x.at));
    for (let i = 1; i < mins.length && i < stamps.length; i++) {
      const g = mins[i] - mins[i - 1];
      if (g < 0 || g > 180) continue;
      const name = stamps[i].name;
      if (!name) continue;
      if (!stats.courseGaps.has(name)) stats.courseGaps.set(name, []);
      stats.courseGaps.get(name).push(g);
    }
    if (mins.length >= 2 && t?.arrivedAt) {
      const dur = mins[mins.length - 1] - mins[0];
      if (dur > 0 && dur <= 12 * 60) stats.durations.push(dur);
    }
  }

  stats.medianGap = median(stats.gaps);
  return stats;
}

/**
 * Aggregate insights across archived services (newest first or any order).
 * Returns null when there is nothing to aggregate.
 */
export function aggregateInsights(entries) {
  const perEntry = (entries || []).map(archiveEntryStats)
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
 */
export function historyGapsByMenuType(entries) {
  const out = { "*": [] };
  for (const entry of entries || []) {
    const tables = entry?.state?.tables || [];
    const menuCourses = entry?.state?.menuCourses || [];
    for (const t of tables) {
      const courses = getVisibleCoursesForTable(t, menuCourses);
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
export function findGuestHistory(name, entries, { limit = 5 } = {}) {
  const q = normName(name);
  if (q.length < 3) return [];
  const matches = [];
  for (const entry of entries || []) {
    for (const t of entry?.state?.tables || []) {
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
        guests: Number(t?.guests) || 0,
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
