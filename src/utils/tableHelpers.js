/**
 * Pure table-data helpers: seat factories, sanitization, time formatting.
 * No React or browser dependencies — safe to import in tests and serverless code.
 */

const normSeat = (id, e) => ({
  id,
  gender:            e?.gender            ?? null,
  pairingSharedWith: e?.pairingSharedWith ?? null,
  water:             e?.water             ?? "—",
  aperitifs: e?.aperitifs ?? [],
  glasses:   e?.glasses   ?? [],
  cocktails: e?.cocktails ?? [],
  spirits:   e?.spirits   ?? [],
  beers:     e?.beers     ?? [],
  pairing:   e?.pairing   ?? "",
  extras:    e?.extras    ?? {},
  // A guest's P-number is their stable service identity. Physical chair
  // placement is map/table-specific, so moving P2 to chair 6 on the terrace
  // must not turn the guest into P6 (or hide them on a two-chair dining map).
  floorPositions: Object.fromEntries(
    Object.entries(e?.floorPositions || {}).flatMap(([key, value]) => {
      const chair = Number(value);
      return key && Number.isFinite(chair) && chair >= 1 ? [[key, chair]] : [];
    })
  ),
  // Preserve ordered, mode (alco/nonalc override) and label (custom drink name).
  optionalPairings: Object.fromEntries(
    Object.entries(e?.optionalPairings || {}).map(([k, v]) => [k, {
      ordered: !!v?.ordered,
      ...(v?.mode  != null ? { mode:  v.mode  } : {}),
      ...(v?.label != null ? { label: v.label } : {}),
    }])
  ),
});

const keepFloorPositionsUnique = (seats) => {
  const keys = new Set(seats.flatMap((seat) => Object.keys(seat.floorPositions || {})));
  if (!keys.size) return seats;
  let next = seats;
  for (const key of keys) {
    const claimed = new Set();
    const chairByGuest = new Map();
    const explicit = next.filter((seat) => Object.prototype.hasOwnProperty.call(seat.floorPositions || {}, key));
    const implicit = next.filter((seat) => !Object.prototype.hasOwnProperty.call(seat.floorPositions || {}, key));
    for (const seat of [...explicit, ...implicit]) {
      let chair = Number(seat.floorPositions?.[key] ?? seat.id);
      if (claimed.has(chair)) {
        chair = 1;
        while (claimed.has(chair)) chair++;
      }
      claimed.add(chair);
      chairByGuest.set(seat.id, chair);
    }
    next = next.map((seat) => {
      const chair = chairByGuest.get(seat.id);
      const wasExplicit = Object.prototype.hasOwnProperty.call(seat.floorPositions || {}, key);
      if (!wasExplicit && chair === Number(seat.id)) return seat;
      return { ...seat, floorPositions: { ...(seat.floorPositions || {}), [key]: chair } };
    });
  }
  return next;
};

export const makeSeats = (n, ex = []) => {
  // Physical chair placement lives in floorPositions; on DINING maps a chair
  // drag goes further and makes the P-number the chair itself
  // (materializeFloorPositions + swapSeatData). So a valid id set is NOT
  // always 1..n: five guests on a six-chair merge seated at chairs 1,2,3,5,6
  // hold exactly those P-numbers. When the seat count already matches the
  // guest count, the ids are the live model and MUST survive verbatim —
  // sanitizeTable runs this on every sync echo, and the old "fold ids > n
  // into the first free slot" recovery kept teleporting the chair-6 guest
  // back to chair 4 a minute after every drag (the sync round-trip).
  const ids = ex.map((e) => Number(e?.id));
  const idBased = ex.length > 0
    && ids.every((v) => Number.isFinite(v) && v >= 1)
    && new Set(ids).size === ex.length;
  if (!idBased) return keepFloorPositionsUnique(Array.from({ length: n }, (_, i) => normSeat(i + 1, ex[i])));
  const sorted = [...ex].sort((a, b) => Number(a.id) - Number(b.id));
  // Shrinking drops the highest P-numbers (existing rule).
  if (ex.length >= n) {
    return keepFloorPositionsUnique(sorted.slice(0, n).map((e) => normSeat(Number(e.id), e)));
  }
  // Growing adds blank guests on the lowest free P-numbers, so a booking
  // corrected from 5 to 6 pax fills the one empty chair instead of renaming
  // anyone who already moved.
  const taken = new Set(ids);
  const added = [];
  for (let id = 1; added.length < n - ex.length; id++) {
    if (!taken.has(id)) added.push(normSeat(id));
  }
  return keepFloorPositionsUnique(
    [...sorted.map((e) => normSeat(Number(e.id), e)), ...added]
      .sort((a, b) => Number(a.id) - Number(b.id))
  );
};

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
const seatHasContent = (s, ignoreExtraKeys = null) => {
  if (!s) return false;
  // Array.isArray, NOT truthiness: point-free callers (tables.filter(
  // tableHasServiceContent)) receive filter's INDEX as the second argument,
  // and (1).includes crashed the whole app ("n.includes is not a function").
  const ignore = Array.isArray(ignoreExtraKeys) ? ignoreExtraKeys : null;
  if (s.gender || (s.water && s.water !== "—") || (s.pairing && s.pairing !== "—" && s.pairing !== "")) return true;
  if ((s.aperitifs || []).length || (s.glasses || []).length || (s.cocktails || []).length
      || (s.spirits || []).length || (s.beers || []).length) return true;
  if (Object.entries(s.extras || {}).some(([k, e]) => e?.ordered
      && !(ignore && ignore.includes(k)))) return true;
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
//
// `ignoreExtraKeys` (the reconcile passes its celebrationKeys): ordered extras
// under these keys don't count as content. The reconcile itself SEEDS the
// celebration extras from the reservation's birthday flag — counting them
// froze every birthday booking's table after its first template, so a later
// combine/move/delete could never re-template it (the 09.07 "tables aren't
// properly combined" bug). They're fully reservation-derived and re-seeded on
// every template, so nothing staff entered is at risk.
export const tableHasServiceContent = (t, ignoreExtraKeys = null) => {
  if (!t) return false;
  // Guard point-free usage (filter/some pass index as the 2nd arg).
  const ignore = Array.isArray(ignoreExtraKeys) ? ignoreExtraKeys : null;
  if (t.active || t.arrivedAt || t.kitchenArchived) return true;
  if (t.kitchenLog && Object.keys(t.kitchenLog).length > 0) return true;
  if (Array.isArray(t.bottleWines) && t.bottleWines.length > 0) return true;
  return (t.seats || []).some((s) => seatHasContent(s, ignore));
};

// Indices of tables an autosave pass would BLANK that previously HELD service
// content — the input to App's mass-blank guard (refuse a blank of 2+ such
// tables unless a legitimate whole-board clear flagged it). Pure so the
// refusal logic is testable: the branch is unreachable through honest UI
// vectors (reconcile shields contentful tables, adoption advances the diff
// baseline, every legit clear sets the flag) — which is exactly why it needs
// unit coverage rather than an end-to-end drive.
// `prevJsonList` entries are sanitized-table JSON; unparseable/missing prev
// is treated as "held no content" (a blank of it is not a loss).
export const massBlankedIndices = (prevJsonList, nextTables, nextJsonList) => {
  const out = [];
  (nextTables || []).forEach((table, idx) => {
    if (nextJsonList[idx] === prevJsonList[idx]) return; // untouched
    let prevHadContent = false;
    try { prevHadContent = tableHasServiceContent(JSON.parse(prevJsonList[idx])); } catch { /* no content */ }
    if (prevHadContent && !tableHasServiceContent(sanitizeTable(table))) out.push(idx);
  });
  return out;
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
//
// `ignoreExtraKeys` (celebration dish keys, e.g. cake): those extras are
// SEEDED onto every seat of every group member by the birthday flag, so they
// must not make a secondary table's placeholder seats count as "real" —
// a 4-guest birthday party on T02-03 showed 8 seat rows in the archive
// (P5-P8 empty) because each of T03's blanks carried the seeded cake.
export const mergeTableGroups = (tables = [], ignoreExtraKeys = null) => {
  if (!Array.isArray(tables) || tables.length === 0) return [];
  const ignore = Array.isArray(ignoreExtraKeys) && ignoreExtraKeys.length ? ignoreExtraKeys : null;
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
      const memberSeats = (m.seats || []).filter(s => seatHasContent(s, ignore));
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

// Re-applying a reservation's dietary restrictions to the board must not wipe
// the per-SEAT position a server assigned during service (the "vegetarian → P1
// reset itself after a few seconds" bug). Keep the reservation's restriction
// SET, but carry each board-assigned `pos` onto a matching (same note)
// reservation restriction that doesn't already specify one.
export const mergeRestrictionPositions = (prev = [], next = []) => {
  const posByNote = {};
  (Array.isArray(prev) ? prev : []).forEach((r) => {
    if (r && r.pos != null) (posByNote[r.note] = posByNote[r.note] || []).push(r.pos);
  });
  return (Array.isArray(next) ? next : []).map((r) => {
    if (!r || r.pos != null) return r;
    const q = posByNote[r.note];
    if (q && q.length) return { ...r, pos: q.shift() };
    return r;
  });
};

// Patch for a STARTED table when its reservation is edited mid-service.
// Descriptive fields always follow (name, menuType, notes…); the GUEST COUNT
// now follows too — a booking corrected from 2 to 4 pax must resize the live
// table (it used to stay frozen, so the kitchen ticket and floor pax read the
// old size all night). Seats resize through makeSeats: per-P data survives by
// id, growing adds blanks, shrinking drops the highest P's. A restriction
// pinned to a dropped position falls back to UNASSIGNED (pos null) so it
// resurfaces on the kitchen ticket instead of silently vanishing. Seats/guests
// are only included when the count actually changed — live seat state is
// never rebuilt for a rename.
export const startedTablePatchFromReservation = (t, d = {}) => {
  const guests = Number(d.guests) > 0 ? Number(d.guests) : Number(t?.guests) || 0;
  const resized = guests > 0 && guests !== (Number(t?.guests) || 0);
  const seats = resized ? makeSeats(guests, t?.seats || []) : (t?.seats || []);
  // Valid restriction positions are the ACTUAL P-numbers, not 1..guests: a
  // dining-map drag makes P = chair, so P6 is a real guest on a 5-pax table
  // with six chairs — the old `pos > guests` rule silently unpinned that
  // guest's allergy on any mid-service reservation edit. No known seats
  // (never the case for a started table) keeps the old range rule.
  const validPos = seats.length
    ? new Set(seats.map((s) => Number(s.id)))
    : new Set(Array.from({ length: guests }, (_, i) => i + 1));
  const merged = mergeRestrictionPositions(t?.restrictions, d.restrictions);
  return {
    ...reservationDescriptiveFields(d),
    restrictions: merged.map((r) =>
      (r && r.pos != null && !validPos.has(Number(r.pos))) ? { ...r, pos: null } : r),
    ...(resized ? { guests, seats } : {}),
  };
};

// The set of table ids a reservation occupies. A `tableGroup` is only honoured
// as a real combined booking when it has 2+ members (matching the reconcile
// rule); a stray single-member group is ignored in favour of `table_id`. This
// keeps occupancy/conflict checks consistent with how the board is built — so a
// reservation with a corrupted single-member group can't mark a phantom table
// as occupied (e.g. a table you already moved away from still showing busy).
export const reservationTableIds = (data, tableId) => {
  const grp = Array.isArray(data?.tableGroup) ? data.tableGroup.map(Number) : [];
  return grp.length > 1 ? grp : [Number(tableId)];
};

// A physical chair assignment is scoped to one concrete floor-map table.
// The same P2 can sit at chair 6 on terrace T23 and chair 2 on dining T9.
export const floorPositionKey = (mapId, tableLabel) =>
  `${String(mapId || "").trim()}:${String(tableLabel || "").trim()}`;

export const seatFloorPosition = (seat, positionKey) => {
  const assigned = Number(seat?.floorPositions?.[positionKey]);
  return Number.isFinite(assigned) && assigned >= 1 ? assigned : Number(seat?.id);
};

// Project guest-linked restrictions onto the physical chairs drawn by a
// particular floor table. The stored restriction.pos stays the stable guest
// id, so it continues to follow that guest everywhere else in the app.
export const restrictionsAtFloorPositions = (seats = [], restrictions = [], positionKey) => {
  const chairByGuest = new Map(
    (seats || []).map((seat) => [Number(seat.id), seatFloorPosition(seat, positionKey)])
  );
  return (restrictions || []).map((restriction) => {
    if (restriction?.pos == null) return restriction;
    const chair = chairByGuest.get(Number(restriction.pos));
    return chair == null ? restriction : { ...restriction, pos: chair };
  });
};

// Move the guest occupying physical chair A to chair B for one floor table.
// Occupied targets swap; empty targets simply receive the guest. Guest ids,
// restrictions and all service data remain P1..P{guest count}.
export const moveSeatOnFloor = (table, aChair, bChair, positionKey) => {
  const a = Number(aChair), b = Number(bChair);
  if (!table || !positionKey || !Number.isFinite(a) || !Number.isFinite(b) || a === b) return table;
  const seats = table.seats || [];
  const source = seats.find((seat) => seatFloorPosition(seat, positionKey) === a);
  if (!source) return table;
  const target = seats.find((seat) => seatFloorPosition(seat, positionKey) === b);
  return {
    ...table,
    seats: seats.map((seat) => {
      if (seat.id === source.id) {
        return { ...seat, floorPositions: { ...(seat.floorPositions || {}), [positionKey]: b } };
      }
      if (target && seat.id === target.id) {
        return { ...seat, floorPositions: { ...(seat.floorPositions || {}), [positionKey]: a } };
      }
      return seat;
    }),
  };
};

// A DINING-map drag is a real seat change — the kitchen plates by chair, so
// chair, P-number and restriction position must agree after the move. Fold any
// per-map chair overrides this table accumulated (from the older cosmetic
// drags) into the seat identities: every guest's P becomes the chair they sit
// at on this map, restriction positions follow, and the map's overrides drop.
// After this, chair numbers ARE seat ids, so swapSeatData on chair numbers is
// exact. A corrupted mapping (two guests projected onto one chair) leaves the
// identities untouched rather than minting duplicate P-numbers.
export const materializeFloorPositions = (table, positionKey) => {
  const seats = table?.seats || [];
  if (!seats.length || !positionKey) return table;
  const chairs = seats.map((seat) => seatFloorPosition(seat, positionKey));
  if (!seats.some((seat, i) => Number(seat.id) !== chairs[i])) return table;
  if (new Set(chairs).size !== chairs.length) return table;
  const chairOfGuest = new Map(seats.map((seat, i) => [Number(seat.id), chairs[i]]));
  return {
    ...table,
    seats: seats
      .map((seat, i) => {
        const { [positionKey]: _folded, ...rest } = seat.floorPositions || {};
        return { ...seat, id: chairs[i], floorPositions: rest };
      })
      .sort((x, y) => Number(x.id) - Number(y.id)),
    restrictions: (table.restrictions || []).map((r) => {
      if (r?.pos == null) return r;
      const chair = chairOfGuest.get(Number(r.pos));
      return chair == null ? r : { ...r, pos: chair };
    }),
  };
};

// Rearrange seat POSITIONS on one table. Both positions occupied → the guests
// trade places (payloads exchange ids). Target position EMPTY → the guest
// simply moves there, taking the new position number, and their old position
// frees up. Either way each guest's positional restrictions follow them
// (swapping only the seat objects left "P2 · GLU" pointing at whoever just
// moved INTO P2). Dragging from an empty position is a no-op. Extracted pure
// from App's swapSeats so the floor's drag gesture and the board's SwapPicker
// exercise one tested transform.
export const swapSeatData = (t, aId, bId) => {
  const a = Number(aId), b = Number(bId);
  const sA = (t.seats || []).find((s) => Number(s.id) === a);
  const sB = (t.seats || []).find((s) => Number(s.id) === b);
  if (!sA) return t; // nobody sits at the source — nothing to move
  if (sB) {
    return {
      ...t,
      seats: t.seats.map((s) =>
        Number(s.id) === a ? { ...sB, id: s.id }
          : Number(s.id) === b ? { ...sA, id: s.id }
          : s),
      restrictions: (t.restrictions || []).map((r) =>
        Number(r.pos) === a ? { ...r, pos: sB.id }
          : Number(r.pos) === b ? { ...r, pos: sA.id }
          : r),
    };
  }
  // MOVE to an empty chair — the guest becomes P{b}; kept sorted so seat
  // chips and pickers keep reading in position order.
  return {
    ...t,
    seats: t.seats
      .map((s) => (Number(s.id) === a ? { ...s, id: b } : s))
      .sort((x, y) => Number(x.id) - Number(y.id)),
    restrictions: (t.restrictions || []).map((r) =>
      Number(r.pos) === a ? { ...r, pos: b } : r),
  };
};

// Remap the ids inside a table's `tableGroup` when its live state moves or
// swaps between table ids (swap fromId↔toId). Without this a moved table keeps
// a tableGroup pointing at its OLD id, so the board's primary-table filter
// (`id === min(tableGroup)`) drops it and the table vanishes from the board
// mid-service — the "moved table disappears" bug.
export const remapTableGroup = (group, fromId, toId) => {
  if (!Array.isArray(group) || group.length === 0) return [];
  const a = Number(fromId), b = Number(toId);
  return group.map((id) => (Number(id) === a ? b : Number(id) === b ? a : Number(id)));
};

// Repoint a reservation when the live table state it owns moves or swaps
// between two table ids (swap semantics: fromId↔toId, any other id untouched).
// Returns the next { table_id, data } with `data.tableGroup` remapped alongside
// the primary id — repointing only `table_id` leaves the group pointing at the
// OLD table, a table_id↔tableGroup desync that made reservationTableIds and
// the reconcile disagree about where the booking sits (one guest duplicated
// onto two tables, the other hidden). Extracted pure from App's onMoveTable /
// swapReservations so the board invariants suite exercises the REAL transform,
// not a test-local copy.
export const repointReservation = (resv, fromId, toId) => {
  const a = Number(fromId), b = Number(toId);
  const tid = Number(resv?.table_id);
  const table_id = tid === a ? b : tid === b ? a : tid;
  const g = Array.isArray(resv?.data?.tableGroup) ? resv.data.tableGroup : [];
  const data = g.length ? { ...resv.data, tableGroup: remapTableGroup(g, a, b) } : resv?.data;
  return { table_id, data };
};

// True when a table id participates in any multi-member tableGroup on the
// board — as a grouped row itself or listed inside another row's group.
// Move/swap must refuse such tables: moveTableRows/swapTableRows remap the
// group only on the two touched rows, so a partial group move desyncs the
// remaining members' lists and NO row satisfies the board's primary filter
// (id === min(tableGroup)) — the party stops rendering on the board, the
// kitchen tickets and the floor.
export const tableIsGroupMember = (tables, id) => {
  const n = Number(id);
  return (tables || []).some(t =>
    Array.isArray(t?.tableGroup) && t.tableGroup.length > 1
    && (Number(t.id) === n || t.tableGroup.some(m => Number(m) === n)));
};

// Pure list transforms behind App's moveTableState / swapTableState setTables
// updaters. Kept here (not inline in the updater) so the invariants suite can
// drive the exact production board transition. Both look the source rows up in
// the list they're given, so calling them inside `setTables(prev => …)` always
// moves the freshest state. Unknown ids return the list unchanged — the App
// wrappers have already validated and returned { ok:false } by then.
export const moveTableRows = (tables, fromId, toId) => {
  const a = Number(fromId), b = Number(toId);
  const src = (tables || []).find(t => t.id === a);
  if (!src || !(tables || []).some(t => t.id === b)) return tables;
  return tables.map(t => {
    if (t.id === a) return blankTable(t.id);
    if (t.id === b) return { ...src, id: t.id, tableGroup: remapTableGroup(src.tableGroup, a, b) };
    return t;
  });
};

export const swapTableRows = (tables, aId, bId) => {
  const a = Number(aId), b = Number(bId);
  const ta = (tables || []).find(t => t.id === a);
  const tb = (tables || []).find(t => t.id === b);
  if (!ta || !tb) return tables;
  return tables.map(t => {
    if (t.id === a) return { ...tb, id: t.id, tableGroup: remapTableGroup(tb.tableGroup, a, b) };
    if (t.id === b) return { ...ta, id: t.id, tableGroup: remapTableGroup(ta.tableGroup, a, b) };
    return t;
  });
};

// Rename follow-through for the seats: per-map chair assignments key on
// "mapId:label" (floorPositionKey) — a table rename orphaned every guest's
// chair on that table (assignments silently reverted to seat-id defaults,
// 15.07 audit). Move the entries to the new key.
export const renameFloorPositionsKey = (tables, fromKey, toKey) =>
  (tables || []).map((t) => {
    if (!fromKey || !toKey || fromKey === toKey) return t;
    if (!(t.seats || []).some((s) => s?.floorPositions && fromKey in s.floorPositions)) return t;
    return {
      ...t,
      seats: t.seats.map((s) => {
        if (!s?.floorPositions || !(fromKey in s.floorPositions)) return s;
        const { [fromKey]: chair, ...rest } = s.floorPositions;
        return { ...s, floorPositions: { ...rest, [toKey]: chair } };
      }),
    };
  });

// A layout switch repoints reservations to new board slots — the LIVE board
// state (active, arrivedAt, kitchenLog, seat orders) must move with them or
// the party strands invisibly: the reservation says T12, the service sits on
// T9, and the new map's tile reads free while the kitchen keeps firing from
// the old slot (15.07 audit). Slots pair by sorted order; the whole switch
// applies as ONE atomic mapping so crossing moves (two parties trading
// slots) can't clobber each other. A row whose destination holds live
// content that is NOT itself moving away is BLOCKED — returned so the
// caller skips its reservation repoint too (blocking cascades: content that
// stays keeps blocking rows that wanted its slot).
export const applyLayoutSwitchToTables = (tables, rows) => {
  const byId = new Map((tables || []).map((t) => [Number(t.id), t]));
  const hasContent = (t) => !!(t && (t.active || t.arrivedAt || t.resName || t.resTime
    || (t.kitchenLog && Object.keys(t.kitchenLog).length > 0) || t.kitchenArchived));
  const candidates = (rows || [])
    .filter((r) => r?.status === "move" && Array.isArray(r.from) && Array.isArray(r.to) && r.to.length)
    .map((r) => ({ row: r, from: r.from.map(Number), to: r.to.map(Number) }))
    .filter(({ from, to }) => from.join(",") !== to.join(","));
  if (!candidates.length) return { tables, blocked: [] };

  // Fixed-point blocking: start with every row accepted; a row is blocked
  // when any destination slot is missing from the board or holds content
  // that no accepted row is moving away. Blocking a row makes its content a
  // "stayer", which can block further rows — iterate until stable.
  let ok = candidates;
  for (;;) {
    const sources = new Set(ok.flatMap(({ from }) => from));
    const next = ok.filter(({ from, to }) => to.every((dst) => {
      if (!byId.has(dst)) return false; // slot not on this board — nowhere to host the state
      if (from.includes(dst)) return true; // shuffling within the own group
      return !(hasContent(byId.get(dst)) && !sources.has(dst));
    }));
    if (next.length === ok.length) { ok = next; break; }
    ok = next;
  }
  const blocked = candidates.filter((c) => !ok.includes(c)).map((c) => c.row);
  if (!ok.length) return { tables, blocked };

  const destOf = new Map();  // newId → oldId whose state arrives
  const vacated = new Set(); // oldIds whose state leaves (blank unless refilled)
  const slotMap = new Map(); // oldId → newId, for tableGroup remapping
  for (const { from, to } of ok) {
    const n = Math.min(from.length, to.length);
    for (let i = 0; i < n; i++) {
      slotMap.set(from[i], to[i]);
      if (from[i] !== to[i]) { destOf.set(to[i], from[i]); vacated.add(from[i]); }
    }
    for (let i = n; i < from.length; i++) vacated.add(from[i]); // group shrank
  }
  const nextTables = (tables || []).map((t) => {
    const id = Number(t.id);
    const srcId = destOf.get(id);
    if (srcId != null) {
      const src = byId.get(srcId);
      const group = (src.tableGroup || [])
        .map((g) => slotMap.get(Number(g)) ?? null)
        .filter((g) => g != null);
      return { ...src, id: t.id, tableGroup: group.length > 1 ? group : [] };
    }
    if (vacated.has(id)) return blankTable(t.id);
    return t;
  });
  return { tables: nextTables, blocked };
};

// Render a "T02-03" label from a table that may belong to a group.
export const tableGroupLabel = (t) => {
  if (t?.displayGroupLabel) return t.displayGroupLabel;
  if (t?.displayLabel) return t.displayLabel;
  const g = Array.isArray(t?.tableGroup) && t.tableGroup.length > 1
    ? [...t.tableGroup].sort((a, b) => a - b)
    : null;
  if (!g) return String(t?.id ?? "").padStart(2, "0");
  return g.map(id => String(id).padStart(2, "0")).join("-");
};
