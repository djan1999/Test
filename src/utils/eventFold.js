// THE FOLD (docs/EVENT_LOG_PLAN.md, Phases 3–4): turn the logbook's facts
// back into board state. Pure and dependency-free — the same reducer runs in
// tests (replay parity), in the SYSTEM panel's parity checker, and eventually
// as the board's source of truth when Phase 4 flips.
//
// The fold consumes events in SERVER ORDER (the log's `id` sequence — never
// client clocks) and is deliberately forgiving: removing a drink that isn't
// there, or touching a seat that never appeared, is a no-op. An append-only
// log replayed through a total, no-throw reducer cannot crash a device.

const DRINK_CATEGORIES = ["aperitifs", "glasses", "cocktails", "spirits", "beers"];

const blankProjection = (tableId) => ({
  id: tableId,
  active: false,
  resName: "",
  guests: 0,
  arrivedAt: null,
  fires: {},          // courseKey → firedAt
  seats: {},          // seatId → { water, pairing, drinks: {category: {name: n}}, extras: [], options: [] }
  bottles: {},        // name → count
  restrictions: [],   // [{ note, pos, detail, kitchenAdded }] — ALLERGY data
  serviceState: blankServiceState(),  // the kitchen's operational flags
  notes: blankNotes(),                // staff-entered prose
});

const blankServiceState = () => ({
  courseReady: null, kitchenSent: null, kitchenAlert: null,
  kitchenArchived: false, pace: null,
});
const serviceStateFrom = (raw) => ({
  courseReady: raw?.courseReady ?? null,
  kitchenSent: raw?.kitchenSent ?? null,
  kitchenAlert: raw?.kitchenAlert ?? null,
  kitchenArchived: !!raw?.kitchenArchived,
  pace: raw?.pace ?? null,
});
const blankNotes = () => ({ notes: "", kitchenCourseNotes: {} });
const notesFrom = (raw) => ({
  notes: raw?.notes == null ? "" : String(raw.notes),
  kitchenCourseNotes: raw?.kitchenCourseNotes && typeof raw.kitchenCourseNotes === "object"
    ? raw.kitchenCourseNotes : {},
});

// Restrictions, normalised identically on both sides of the comparison. This
// is safety data: a fold that silently dropped it would take a nut allergy off
// a live table, which is why it had to join the taxonomy before Phase 4.
const restrictionsFrom = (raw) =>
  (Array.isArray(raw) ? raw : [])
    .filter((r) => r && r.note)
    .map((r) => ({
      note: String(r.note),
      pos: r.pos == null ? null : Number(r.pos),
      detail: r.detail == null ? "" : String(r.detail),
      kitchenAdded: !!r.kitchenAdded,
    }))
    .sort((a, b) => String(a.note).localeCompare(String(b.note))
      || (a.pos ?? -1) - (b.pos ?? -1)
      || String(a.detail).localeCompare(String(b.detail)));

const seatOf = (table, seatId) => {
  const key = String(seatId);
  if (!table.seats[key]) {
    table.seats[key] = {
      water: "—", pairing: "",
      drinks: Object.fromEntries(DRINK_CATEGORIES.map((category) => [category, {}])),
      extras: [], options: [], gender: null,
    };
  }
  return table.seats[key];
};

const bump = (counts, name, delta) => {
  const next = (counts[name] || 0) + delta;
  if (next > 0) counts[name] = next;
  else delete counts[name];
};

// A snapshot payload's {name: count} map, coerced defensively (junk counts
// never crash the fold; only positive integers survive).
const countsFrom = (raw) => {
  const counts = {};
  for (const [name, n] of Object.entries(raw && typeof raw === "object" ? raw : {})) {
    const count = Math.floor(Number(n));
    if (count > 0) counts[name] = count;
  }
  return counts;
};

const addKey = (list, key) => { if (!list.includes(key)) list.push(key); };
const dropKey = (list, key) => {
  const at = list.indexOf(key);
  if (at >= 0) list.splice(at, 1);
};

/**
 * CAUSAL ORDER (docs/EVENT_LOG_PLAN.md — write-path unification, second half).
 *
 * Arrival order (the log's `id`) is NOT the order things happened: a device
 * that was offline drains its queue late, so an hour-old gesture lands with the
 * newest ids and — folded naively — clobbers state that superseded it. Measured
 * on real 3-device data (10.08): 3 of 104 facts arrived out of order, worst
 * queue lag 107s. Folding by arrival is therefore wrong for exactly the case
 * Phase 4 must survive.
 *
 * So order by WHEN THE GESTURE HAPPENED (`client_ts`), which is the same
 * authority the board itself already trusts (its rows converge by client-
 * stamped `updated_at`), with two safeguards:
 *   • clamped to `recorded_at` — a fact cannot have happened after the server
 *     wrote it, so a device whose clock runs fast cannot jump the queue;
 *   • ties, and facts with no usable stamp, fall back to arrival order (the
 *     preceding fact's key is carried forward), so ordering is total, stable,
 *     and degrades exactly to today's behaviour.
 *
 * This revises principle 4 ("the server orders") for the FOLD specifically:
 * the server still assigns identity and breaks ties, but a stale drain must
 * not outrank the state that replaced it.
 */
export function orderServiceEvents(events) {
  const list = Array.isArray(events) ? events : [];
  let carry = -Infinity;
  return list
    .map((event, index) => {
      const gesture = Date.parse(event?.client_ts || "");
      const recorded = Date.parse(event?.recorded_at || "");
      let key = carry;
      if (Number.isFinite(gesture)) {
        key = Number.isFinite(recorded) ? Math.min(gesture, recorded) : gesture;
        carry = key;
      }
      return { event, index, key };
    })
    .sort((a, b) => (a.key - b.key) || (a.index - b.index))
    .map((entry) => entry.event);
}

/** Fold a service's events into per-table projections, in CAUSAL order. */
export function foldServiceEvents(events) {
  const tables = new Map();
  for (const event of orderServiceEvents(events)) {
    const tableId = Number(event?.table_id);
    const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
    if (!Number.isFinite(tableId)) continue;
    if (!tables.has(tableId)) tables.set(tableId, blankProjection(tableId));
    const table = tables.get(tableId);
    switch (event.type) {
      case "party_seated":
        table.active = true;
        table.resName = String(payload.resName || "");
        table.guests = Number(payload.guests) || 0;
        table.arrivedAt = payload.arrivedAt ?? null;
        break;
      case "party_unseated":
        // The card system blanks an unseated table; later removal facts from
        // the same gesture then no-op harmlessly against the fresh blank.
        tables.set(tableId, blankProjection(tableId));
        break;
      case "party_resized":
        table.guests = Number(payload.to) || 0;
        break;
      case "party_renamed":
        table.resName = String(payload.resName || "");
        break;
      case "party_arrival_set":
        table.arrivedAt = payload.to ?? null;
        break;
      case "seat_water_set":
        seatOf(table, payload.seatId).water = payload.to ?? "—";
        break;
      case "seat_pairing_set":
        seatOf(table, payload.seatId).pairing = payload.to ?? "";
        break;
      case "seat_drinks_set":
        // Snapshot fact: the seat's full multiset for one category. Applying
        // it twice is a no-op — dedup absorption can never corrupt it.
        if (DRINK_CATEGORIES.includes(payload.category)) {
          seatOf(table, payload.seatId).drinks[payload.category] = countsFrom(payload.drinks);
        }
        break;
      case "table_bottles_set":
        table.bottles = countsFrom(payload.bottles);
        break;
      case "table_restrictions_set":
        table.restrictions = restrictionsFrom(payload.restrictions);
        break;
      case "table_service_state_set":
        table.serviceState = serviceStateFrom(payload);
        break;
      case "table_notes_set":
        table.notes = notesFrom(payload);
        break;
      case "seat_gender_set":
        seatOf(table, payload.seatId).gender = payload.to ?? null;
        break;
      // Legacy delta facts (recorded before snapshots, 09.08) still fold:
      case "drink_added":
        if (DRINK_CATEGORIES.includes(payload.category)) {
          bump(seatOf(table, payload.seatId).drinks[payload.category], String(payload.name), +1);
        }
        break;
      case "drink_removed":
        if (DRINK_CATEGORIES.includes(payload.category)) {
          bump(seatOf(table, payload.seatId).drinks[payload.category], String(payload.name), -1);
        }
        break;
      case "extra_ordered":
        addKey(seatOf(table, payload.seatId).extras, String(payload.key));
        break;
      case "extra_unordered":
        dropKey(seatOf(table, payload.seatId).extras, String(payload.key));
        break;
      case "option_ordered":
        addKey(seatOf(table, payload.seatId).options, String(payload.key));
        break;
      case "option_unordered":
        dropKey(seatOf(table, payload.seatId).options, String(payload.key));
        break;
      case "bottle_added":
        bump(table.bottles, String(payload.name), +1);
        break;
      case "bottle_removed":
        bump(table.bottles, String(payload.name), -1);
        break;
      case "course_fired":
        if (payload.courseKey != null) table.fires[String(payload.courseKey)] = payload.firedAt ?? null;
        break;
      case "course_unfired":
        delete table.fires[String(payload.courseKey)];
        break;
      default:
        break; // unknown future event types fold as no-ops, never crashes
    }
  }
  return tables;
}

// ── the comparable projection of a CARD table ────────────────────────────────
// The full board state the log carries — including the descriptive fields
// (resName, arrivedAt), which joined the log on 09.08 via party_renamed /
// party_arrival_set. Parity is full-fidelity: a wiped name is divergence.

const seatHasContent = (seat) =>
  (seat.water && seat.water !== "—")
  || (seat.pairing && seat.pairing !== "")
  || DRINK_CATEGORIES.some((category) => Object.keys(seat.drinks[category]).length > 0)
  || seat.extras.length > 0
  || seat.options.length > 0
  || seat.gender != null;

const namesOf = (list) => (Array.isArray(list) ? list : [])
  .map((entry) => (typeof entry === "string" ? entry : entry?.name ?? JSON.stringify(entry)));

/** Project a card table into the same comparable shape the fold produces. */
export function boardProjection(table) {
  const projection = blankProjection(Number(table?.id));
  if (!table || typeof table !== "object") return projection;
  projection.active = !!table.active;
  projection.resName = String(table.resName || "");
  projection.guests = Number(table.guests) || 0;
  projection.arrivedAt = table.arrivedAt ?? null;
  const log = table.kitchenLog && typeof table.kitchenLog === "object" ? table.kitchenLog : {};
  for (const [courseKey, entry] of Object.entries(log)) {
    if ((entry?.firedAt ?? null) != null) projection.fires[courseKey] = entry.firedAt;
  }
  for (const seat of Array.isArray(table.seats) ? table.seats : []) {
    const folded = seatOf(projection, seat.id);
    folded.water = seat.water ?? "—";
    folded.pairing = seat.pairing ?? "";
    folded.gender = seat.gender ?? null;
    for (const category of DRINK_CATEGORIES) {
      for (const name of namesOf(seat[category])) bump(folded.drinks[category], name, +1);
    }
    for (const [key, value] of Object.entries(seat.extras && typeof seat.extras === "object" ? seat.extras : {})) {
      if (value?.ordered) addKey(folded.extras, key);
    }
    for (const [key, value] of Object.entries(seat.optionalPairings && typeof seat.optionalPairings === "object" ? seat.optionalPairings : {})) {
      if (value?.ordered) addKey(folded.options, key);
    }
  }
  for (const name of namesOf(table.bottleWines)) bump(projection.bottles, name, +1);
  projection.restrictions = restrictionsFrom(table.restrictions);
  projection.serviceState = serviceStateFrom(table);
  projection.notes = notesFrom(table);
  return projection;
}

// Canonical comparable form: content-bearing seats only, sorted keys, and
// party fields zeroed when inactive — so scaffold differences (empty seats,
// blank tables) can never read as divergence.
const canonical = (projection) => ({
  active: projection.active,
  resName: projection.active ? String(projection.resName || "") : "",
  guests: projection.active ? projection.guests : 0,
  arrivedAt: projection.active ? (projection.arrivedAt ?? null) : null,
  fires: Object.fromEntries(Object.entries(projection.fires).sort()),
  bottles: Object.fromEntries(Object.entries(projection.bottles).sort()),
  restrictions: restrictionsFrom(projection.restrictions),
  serviceState: serviceStateFrom(projection.serviceState),
  notes: notesFrom(projection.notes),
  seats: Object.fromEntries(
    Object.entries(projection.seats)
      .filter(([, seat]) => seatHasContent(seat))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([seatId, seat]) => [seatId, {
        water: seat.water, pairing: seat.pairing, gender: seat.gender ?? null,
        drinks: Object.fromEntries(
          DRINK_CATEGORIES.filter((category) => Object.keys(seat.drinks[category]).length > 0)
            .map((category) => [category, Object.fromEntries(Object.entries(seat.drinks[category]).sort())]),
        ),
        extras: [...seat.extras].sort(),
        options: [...seat.options].sort(),
      }]),
  ),
});

const isBlank = (projection) => {
  const c = canonical(projection);
  return !c.active && Object.keys(c.fires).length === 0
    && Object.keys(c.bottles).length === 0 && Object.keys(c.seats).length === 0
    && c.restrictions.length === 0
    && c.notes.notes === "" && Object.keys(c.notes.kitchenCourseNotes).length === 0;
};

// ── the two KINDS of divergence ──────────────────────────────────────────────
// The whole point of parity is to catch a WIPE — a service losing content. But
// two devices editing the SAME field of the SAME seat while one is offline is
// not a wipe: the board's compare-and-swap and the log's server-order fold pick
// different winners of a genuine tie, and BOTH sides keep a coherent, worked
// seat. Calling that "divergence" cries wolf on every busy night. So we split:
//
//   • "content-loss"      — a whole active party, or a content-bearing seat,
//                           exists on ONE side and is entirely GONE on the
//                           other. THIS is the wipe signature. It must never
//                           happen, and it is the real Phase-4 gate.
//   • "concurrent-tiebreak" — same party state, same set of worked seats on
//                           both sides; only field VALUES differ (which water,
//                           which drink won the tie). Benign, expected until
//                           the write paths unify (docs/EVENT_LOG_PLAN.md).
const contentSeatKeys = (c) => new Set(Object.keys(c.seats));
export function classifyTableDivergence(fromLog, fromBoard) {
  const a = canonical(fromLog);
  const b = canonical(fromBoard);
  // A whole party present on one side and gone on the other — the wipe.
  if (a.active !== b.active) return "content-loss";
  // A worked seat on one side entirely absent on the other — also the wipe.
  const sa = contentSeatKeys(a);
  const sb = contentSeatKeys(b);
  for (const k of sa) if (!sb.has(k)) return "content-loss";
  for (const k of sb) if (!sa.has(k)) return "content-loss";
  // A whole fired course or a bottle present on one side, gone on the other:
  // treat wholesale kitchen/cellar loss as content-loss too, value diffs as tie.
  const firesA = new Set(Object.keys(a.fires));
  const firesB = new Set(Object.keys(b.fires));
  for (const k of firesA) if (!firesB.has(k)) return "content-loss";
  for (const k of firesB) if (!firesA.has(k)) return "content-loss";
  const bottlesA = new Set(Object.keys(a.bottles));
  const bottlesB = new Set(Object.keys(b.bottles));
  for (const k of bottlesA) if (!bottlesB.has(k)) return "content-loss";
  for (const k of bottlesB) if (!bottlesA.has(k)) return "content-loss";
  // A dietary restriction present on one side and GONE on the other is the
  // wipe signature at its most dangerous — an allergy that stopped being
  // visible. Never a tiebreak, whatever else agrees.
  const notesA = new Set(a.restrictions.map((r) => `${r.note}#${r.pos}`));
  const notesB = new Set(b.restrictions.map((r) => `${r.note}#${r.pos}`));
  for (const k of notesA) if (!notesB.has(k)) return "content-loss";
  for (const k of notesB) if (!notesA.has(k)) return "content-loss";
  // Staff-typed prose is work: a note on one side and gone on the other is
  // content-loss. Differing TEXT of a note both sides hold is a tiebreak.
  if ((a.notes.notes === "") !== (b.notes.notes === "")) return "content-loss";
  const ckA = Object.keys(a.notes.kitchenCourseNotes);
  const ckB = Object.keys(b.notes.kitchenCourseNotes);
  for (const k of ckA) if (!ckB.includes(k)) return "content-loss";
  for (const k of ckB) if (!ckA.includes(k)) return "content-loss";
  // Same structure on both sides — only which value won a tie differs.
  return "concurrent-tiebreak";
}

/**
 * Compare the fold of a service's events against its card board. Returns
 * { compared, matches, divergent, contentLoss, tiebreaks } over every table
 * either side knows about (blank == absent). Each `divergent` entry carries a
 * `kind` ("content-loss" | "concurrent-tiebreak"); `contentLoss` and
 * `tiebreaks` are the table-id lists split by that kind. Content-loss is the
 * wipe alarm; a tiebreak means both sides kept a coherent worked seat.
 */
export function compareFoldToBoard(foldedTables, cardTables) {
  const board = new Map(
    (Array.isArray(cardTables) ? cardTables : [])
      .filter((table) => table && typeof table === "object" && Number.isFinite(Number(table.id)))
      .map((table) => [Number(table.id), boardProjection(table)]),
  );
  const ids = [...new Set([...foldedTables.keys(), ...board.keys()])].sort((a, b) => a - b);
  const divergent = [];
  let compared = 0;
  for (const tableId of ids) {
    const fromLog = foldedTables.get(tableId) || blankProjection(tableId);
    const fromBoard = board.get(tableId) || blankProjection(tableId);
    if (isBlank(fromLog) && isBlank(fromBoard)) continue;
    compared += 1;
    const logJson = JSON.stringify(canonical(fromLog));
    const boardJson = JSON.stringify(canonical(fromBoard));
    if (logJson !== boardJson) {
      const kind = classifyTableDivergence(fromLog, fromBoard);
      divergent.push({ tableId, kind, fromLog: logJson, fromBoard: boardJson });
    }
  }
  return {
    compared,
    matches: compared - divergent.length,
    divergent,
    contentLoss: divergent.filter((d) => d.kind === "content-loss").map((d) => d.tableId),
    tiebreaks: divergent.filter((d) => d.kind === "concurrent-tiebreak").map((d) => d.tableId),
  };
}

// ── the story ────────────────────────────────────────────────────────────────
// One fact, one human sentence — the SYSTEM panel's night-in-writing.

const hhmm = (ts) => {
  const at = ts ? new Date(ts) : null;
  return at && Number.isFinite(at.getTime())
    ? `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`
    : "--:--";
};

/**
 * The archived night, reported from the log: the story in sentences plus the
 * fold's parity against the archived board rows. `parity` is null when the
 * log holds no facts for the night (the logbook was not running — the night
 * is not graded, never falsely red).
 */
export function serviceNightReport(events, cardTables) {
  const list = Array.isArray(events) ? events : [];
  const story = list.map((event, index) => ({
    id: event?.id ?? index,
    device: String(event?.device_id || "").slice(0, 8),
    line: describeServiceEvent(event),
  }));
  if (list.length === 0) return { story, parity: null };
  const { compared, matches, divergent, contentLoss, tiebreaks } = compareFoldToBoard(foldServiceEvents(list), cardTables);
  return {
    story,
    parity: {
      events: list.length, compared, matches,
      divergentTables: divergent.map((d) => d.tableId),
      contentLoss, tiebreaks,
    },
  };
}

export function describeServiceEvent(event) {
  const payload = event?.payload || {};
  const table = event?.table_id != null ? `T${String(event.table_id).padStart(2, "0")}` : "?";
  const when = hhmm(event?.client_ts || event?.recorded_at);
  const seatBit = payload.seatId != null ? ` (P${payload.seatId})` : "";
  const line = (text) => `${when} · ${table} — ${text}`;
  switch (event?.type) {
    case "party_seated": return line(`${payload.resName || "walk-in"}, party of ${payload.guests ?? "?"} seated`);
    case "party_unseated": return line(`${payload.resName || "party"} left`);
    case "party_resized": return line(`party resized ${payload.from ?? "?"} → ${payload.to ?? "?"}`);
    case "party_renamed": return line(`renamed to ${payload.resName || "walk-in"}`);
    case "party_arrival_set": return line(`arrival ${payload.from ?? "—"} → ${payload.to ?? "—"}`);
    case "seat_water_set": return line(`water ${payload.to ?? "—"}${seatBit}`);
    case "seat_pairing_set": return line(`pairing ${payload.to || "cleared"}${seatBit}`);
    case "seat_drinks_set": {
      const bits = [
        ...(Array.isArray(payload.added) ? payload.added : []).map((name) => `+ ${name}`),
        ...(Array.isArray(payload.removed) ? payload.removed : []).map((name) => `− ${name}`),
      ];
      return line(`${bits.join(", ") || "drinks set"}${seatBit}`);
    }
    case "table_bottles_set": {
      const bits = [
        ...(Array.isArray(payload.added) ? payload.added : []).map((name) => `+ ${name}`),
        ...(Array.isArray(payload.removed) ? payload.removed : []).map((name) => `− ${name}`),
      ];
      return line(`bottles: ${bits.join(", ") || "set"}`);
    }
    case "drink_added": return line(`+ ${payload.name}${seatBit}`);
    case "drink_removed": return line(`− ${payload.name}${seatBit}`);
    case "bottle_added": return line(`bottle: ${payload.name}`);
    case "bottle_removed": return line(`bottle removed: ${payload.name}`);
    case "extra_ordered": return line(`extra ${payload.key}${seatBit}`);
    case "extra_unordered": return line(`extra ${payload.key} cancelled${seatBit}`);
    case "option_ordered": return line(`optional ${payload.key}${seatBit}`);
    case "option_unordered": return line(`optional ${payload.key} cancelled${seatBit}`);
    case "table_restrictions_set": {
      const list = Array.isArray(payload.restrictions) ? payload.restrictions : [];
      return line(list.length
        ? `restrictions: ${list.map((r) => `${r.note}${r.pos != null ? ` (P${r.pos})` : ""}`).join(", ")}`
        : "restrictions cleared");
    }
    case "course_fired": return line(`FIRE ${payload.courseKey} (${payload.firedAt ?? "?"})`);
    case "course_unfired": return line(`un-fire ${payload.courseKey}`);
    default: return line(String(event?.type || "event"));
  }
}
