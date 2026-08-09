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
});

const seatOf = (table, seatId) => {
  const key = String(seatId);
  if (!table.seats[key]) {
    table.seats[key] = {
      water: "—", pairing: "",
      drinks: Object.fromEntries(DRINK_CATEGORIES.map((category) => [category, {}])),
      extras: [], options: [],
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

/** Fold a service's events (server order) into per-table projections. */
export function foldServiceEvents(events) {
  const tables = new Map();
  for (const event of Array.isArray(events) ? events : []) {
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
  || seat.options.length > 0;

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
  seats: Object.fromEntries(
    Object.entries(projection.seats)
      .filter(([, seat]) => seatHasContent(seat))
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([seatId, seat]) => [seatId, {
        water: seat.water, pairing: seat.pairing,
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
    && Object.keys(c.bottles).length === 0 && Object.keys(c.seats).length === 0;
};

/**
 * Compare the fold of a service's events against its card board. Returns
 * { compared, matches, divergent: [{ tableId, fromLog, fromBoard }] } over
 * every table either side knows about (blank == absent).
 */
export function compareFoldToBoard(foldedTables, cardTables) {
  const board = new Map(
    (Array.isArray(cardTables) ? cardTables : [])
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
    if (logJson !== boardJson) divergent.push({ tableId, fromLog: logJson, fromBoard: boardJson });
  }
  return { compared, matches: compared - divergent.length, divergent };
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
  const { compared, matches, divergent } = compareFoldToBoard(foldServiceEvents(list), cardTables);
  return {
    story,
    parity: { events: list.length, compared, matches, divergentTables: divergent.map((d) => d.tableId) },
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
    case "course_fired": return line(`FIRE ${payload.courseKey} (${payload.firedAt ?? "?"})`);
    case "course_unfired": return line(`un-fire ${payload.courseKey}`);
    default: return line(String(event?.type || "event"));
  }
}
