/**
 * Pure table-data helpers: seat factories, sanitization, time formatting.
 * No React or browser dependencies — safe to import in tests and serverless code.
 */

export const makeSeats = (n, ex = []) =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    gender:            ex[i]?.gender            ?? null,
    pairingSharedWith: ex[i]?.pairingSharedWith ?? null,
    water:             ex[i]?.water             ?? "—",
    aperitifs: ex[i]?.aperitifs ?? [],
    glasses:   ex[i]?.glasses   ?? [],
    cocktails: ex[i]?.cocktails ?? [],
    spirits:   ex[i]?.spirits   ?? [],
    beers:     ex[i]?.beers     ?? [],
    pairing:   ex[i]?.pairing   ?? "",
    extras:    ex[i]?.extras    ?? {},
    // Preserve ordered, mode (alco/nonalc override) and label (custom drink name).
    optionalPairings: Object.fromEntries(
      Object.entries(ex[i]?.optionalPairings || {}).map(([k, v]) => [k, {
        ordered: !!v?.ordered,
        ...(v?.mode  != null ? { mode:  v.mode  } : {}),
        ...(v?.label != null ? { label: v.label } : {}),
      }])
    ),
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
  rooms: [],
  arrivedAt: null,
  menuType: "",
  pace: "",
  bottleWines: [],
  restrictions: [],
  birthday: false,
  cakeNote: "",
  notes: "",
  lang: "en",
  seats: makeSeats(2),
  kitchenLog: {},
  tableGroup: [],
  kitchenAlert: null,
  // Snapshot of the orders the kitchen last acknowledged (see utils/kitchenAlerts).
  // Lets a Send carry only what's new instead of the whole order again.
  kitchenSent: null,
  // Service's "table is set for the next course" signal ({key,index,name,at}).
  // Raised from the sheet view, shown on the kitchen ticket, cleared when the
  // kitchen fires that course.
  courseReady: null,
});

export const initTables = Array.from({ length: 10 }, (_, i) => blankTable(i + 1));

// Descriptive (label-level) table fields derived from a reservation's data
// blob. These are safe to apply even to a table where service has already
// started — they never touch seats, orders, kitchen log, or grouping. Used by
// both the board↔reservations reconcile and the live-table sync that runs when
// a reservation is edited mid-service (e.g. switching a seated table to the
// SHORT menu must reach the kitchen board, which reads table.menuType).
export const reservationDescriptiveFields = (d = {}) => ({
  resName:            d.resName || "",
  resTime:            d.resTime || "",
  menuType:           d.menuType || "",
  lang:               d.lang || "en",
  guestType:          d.guestType || "",
  room:               (Array.isArray(d.rooms) && d.rooms.length ? d.rooms[0] : d.room) || "",
  rooms:              Array.isArray(d.rooms) && d.rooms.length ? d.rooms.filter(Boolean) : (d.room ? [d.room] : []),
  birthday:           !!d.birthday,
  cakeNote:           d.birthday ? (d.cakeNote || "") : "",
  restrictions:       d.restrictions || [],
  notes:              d.notes || "",
  kitchenCourseNotes: d.kitchenCourseNotes || {},
});

// Which service a reservation belongs to. Explicit session wins; legacy rows
// without one fall back to the time heuristic (before 15:00 → lunch).
export const resolveReservationSession = (d = {}) => {
  const sess = d.service_session;
  if (sess === "lunch" || sess === "dinner") return sess;
  return ((d.resTime || "") && d.resTime < "15:00") ? "lunch" : "dinner";
};

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
  tableGroup: Array.isArray(t.tableGroup) ? t.tableGroup : [],
  rooms: Array.isArray(t.rooms) ? t.rooms.filter(Boolean) : (t.room ? [t.room] : []),
});

// Two seats are "real" if they hold any guest-facing data. Used by mergeTableGroups
// below to discard empty placeholder seats from secondary tables when collapsing
// a multi-table reservation into a single display row.
const seatHasContent = (s) => {
  if (!s) return false;
  if (s.gender || (s.water && s.water !== "—") || (s.pairing && s.pairing !== "—" && s.pairing !== "")) return true;
  if ((s.aperitifs || []).length || (s.glasses || []).length || (s.cocktails || []).length
      || (s.spirits || []).length || (s.beers || []).length) return true;
  if (Object.values(s.extras || {}).some(e => e?.ordered)) return true;
  if (Object.values(s.optionalPairings || {}).some(p => p?.ordered)) return true;
  return false;
};

// True when a table holds STAFF-ENTERED service data — seated/arrived, kitchen
// activity, a table-level bottle, or any seat with water/pairing/drinks/extras.
// The board↔reservations reconcile must never blank or rebuild such a table:
// doing so against a momentarily-stale local view is how a whole live service
// got wiped mid-shift and propagated to every device via the autosave.
// Reservation-derived fields (resName, resTime, restrictions) deliberately do
// NOT count, so a reserved-but-unstarted table can still be updated or
// ghost-cleared from the planner.
export const tableHasServiceContent = (t) => {
  if (!t) return false;
  if (t.active || t.arrivedAt || t.kitchenArchived) return true;
  if (t.kitchenLog && Object.keys(t.kitchenLog).length > 0) return true;
  if (Array.isArray(t.bottleWines) && t.bottleWines.length > 0) return true;
  return (t.seats || []).some(seatHasContent);
};

const sameReservationKey = (t) => {
  const n = String(t?.resName || "").trim().toLowerCase();
  const r = String(t?.resTime || "").trim();
  return (n || r) ? `${n}|${r}` : null;
};

// Collapse multi-table reservations into a single virtual table per group.
// Detection order: explicit `tableGroup` array on the table; fallback to
// matching resName+resTime across two or more tables. Seats from secondary
// tables are appended with offset ids so each guest has a unique label
// (P1..P_n). Restrictions, kitchen logs and bottle wines are merged.
//
// Pass the full table list as it came from state or archive. Returns a list
// in the original order, with only one entry per detected group (the primary,
// lowest-id member), each carrying:
//   - `tableGroup`: full sorted list of member ids (always set on grouped rows)
//   - `seats`: concatenated, renumbered seats from all members
//   - `_groupGuests`: total guest count across the group (callers prefer this
//     over `guests` for display since each member's `guests` is independent)
export const mergeTableGroups = (tables = []) => {
  if (!Array.isArray(tables) || tables.length === 0) return [];
  // Build group ids: prefer explicit tableGroup, else fall back to resName|resTime
  const byPrimary = new Map(); // primaryId -> sorted member-id list
  const idToPrimary = new Map(); // memberId -> primaryId
  const autoBuckets = new Map(); // key -> member ids[]
  for (const t of tables) {
    const ids = Array.isArray(t.tableGroup) && t.tableGroup.length > 1
      ? [...new Set(t.tableGroup.map(Number))].sort((a, b) => a - b)
      : null;
    if (ids) {
      const primary = ids[0];
      byPrimary.set(primary, ids);
      ids.forEach(id => idToPrimary.set(id, primary));
    }
  }
  for (const t of tables) {
    if (idToPrimary.has(t.id)) continue;
    const k = sameReservationKey(t);
    if (!k) continue;
    autoBuckets.set(k, [...(autoBuckets.get(k) || []), t.id]);
  }
  autoBuckets.forEach(ids => {
    if (ids.length < 2) return;
    const sorted = [...ids].sort((a, b) => a - b);
    const primary = sorted[0];
    byPrimary.set(primary, sorted);
    sorted.forEach(id => idToPrimary.set(id, primary));
  });

  const tableById = new Map(tables.map(t => [t.id, t]));
  const out = [];
  for (const t of tables) {
    const primary = idToPrimary.get(t.id);
    if (primary != null && primary !== t.id) continue; // skip secondaries
    if (primary == null) { out.push(t); continue; }
    const members = byPrimary.get(primary).map(id => tableById.get(id)).filter(Boolean);
    let nextSeatId = 1;
    const mergedSeats = [];
    let contentSeatCount = 0;
    for (const m of members) {
      const memberSeats = (m.seats || []).filter(seatHasContent);
      contentSeatCount += memberSeats.length;
      memberSeats.forEach(s => { mergedSeats.push({ ...s, id: nextSeatId++ }); });
    }
    // The reconcile pass sets `guests` to the full reservation count on every
    // member of the group, so summing across members would double-count
    // (e.g. T02+T03 with 4 guests would report 8). Use the primary's value
    // directly and fall back to actual content-seat count only if it's missing.
    const primaryTable = tableById.get(primary);
    const reservationGuests = Number(primaryTable?.guests) || 0;
    const mergedKitchenLog = Object.assign({}, ...members.map(m => m.kitchenLog || {}));
    const mergedBottles = members.flatMap(m => m.bottleWines || []);
    const mergedRestrictions = members.flatMap(m => m.restrictions || []);
    out.push({
      ...t,
      tableGroup: byPrimary.get(primary),
      seats: mergedSeats.length ? mergedSeats : (t.seats || []),
      kitchenLog: mergedKitchenLog,
      bottleWines: mergedBottles,
      restrictions: mergedRestrictions,
      _groupGuests: reservationGuests || contentSeatCount || 0,
    });
  }
  return out;
};

// Render a "T02-03" label from a table that may belong to a group.
export const tableGroupLabel = (t) => {
  const g = Array.isArray(t?.tableGroup) && t.tableGroup.length > 1
    ? [...t.tableGroup].sort((a, b) => a - b)
    : null;
  if (!g) return String(t?.id ?? "").padStart(2, "0");
  return g.map(id => String(id).padStart(2, "0")).join("-");
};
