/**
 * Pure table-data helpers: seat factories, sanitization, time formatting.
 * No React or browser dependencies — safe to import in tests and serverless code.
 */

export const makeSeats = (n, ex = []) =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    water:     ex[i]?.water     ?? "—",
    glasses:   ex[i]?.glasses   ?? [],
    cocktails: ex[i]?.cocktails ?? [],
    spirits:   ex[i]?.spirits   ?? [],
    beers:     ex[i]?.beers     ?? [],
    pairing:   ex[i]?.pairing   ?? "",
    extras:    ex[i]?.extras    ?? {},
  }));

export const fmt = d =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

export const parseHHMM = s => {
  if (!s) return null;
  const [h, m] = s.split(":").map(Number);
  return isNaN(h) || isNaN(m) ? null : h * 60 + m;
};

export const blankTable = id => ({
  id,
  active: false,
  guests: 2,
  resName: "",
  resTime: "",
  guestType: "",
  room: "",
  arrivedAt: null,
  menuType: "",
  pace: "",
  bottleWines: [],
  restrictions: [],
  birthday: false,
  notes: "",
  lang: "en",
  seats: makeSeats(2),
  kitchenLog: {},
  tableGroup: [],
  kitchenAlert: null,
});

export const initTables = Array.from({ length: 10 }, (_, i) => blankTable(i + 1));

export const sanitizeTable = t => ({
  ...blankTable(t.id ?? 0),
  ...t,
  bottleWines: Array.isArray(t.bottleWines) ? t.bottleWines : (t.bottleWine ? [t.bottleWine] : []),
  seats: makeSeats(
    t.guests ?? 2,
    Array.isArray(t.seats) ? t.seats : []
  ),
  restrictions: Array.isArray(t.restrictions) ? t.restrictions : [],
  kitchenLog: t.kitchenLog && typeof t.kitchenLog === "object" ? t.kitchenLog : {},
  courseOverrides: t.courseOverrides && typeof t.courseOverrides === "object" ? t.courseOverrides : {},
  tableGroup: Array.isArray(t.tableGroup) ? t.tableGroup : [],
});
