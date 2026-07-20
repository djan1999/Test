/**
 * foldTable — fold a locally-edited table together with a newer copy of the
 * same table from the store, using the last-synced ancestor to tell who
 * touched what.
 *
 * Granularity: top-level fields, restriction entries, kitchen-log entries,
 * and individual seat fields (matched by seat id). For
 * each unit, the LOCAL version wins only where it actually differs from the
 * ancestor; everything the local user didn't touch adopts the incoming value.
 * So two waiters editing DIFFERENT seats of the same table both keep their
 * work, and a genuine same-seat conflict resolves to the local edit — which
 * the pending autosave then writes, converging every device via row-level
 * last-write-wins.
 *
 * Pure and dependency-free. Callers are expected to sanitize the result.
 */

import { tableHasServiceContent } from "./tableHelpers.js";

const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const asObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

const choose = (ancestor, mine, theirs) =>
  eq(mine, ancestor) ? theirs : mine;

// Merge object-shaped documents one property at a time. This is used for
// kitchenLog (one key per course) and the map-like fields inside a seat, so a
// sommelier changing P1's pairing cannot erase a waiter's P1 water choice.
function foldObject(ancestor, mine, theirs) {
  const a = asObject(ancestor);
  const m = asObject(mine);
  const t = asObject(theirs);
  const out = {};
  for (const key of new Set([...Object.keys(a), ...Object.keys(t), ...Object.keys(m)])) {
    const value = choose(a[key], m[key], t[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function foldSeat(ancestor, mine, theirs) {
  const out = {};
  for (const key of new Set([
    ...Object.keys(ancestor || {}), ...Object.keys(theirs || {}), ...Object.keys(mine || {}),
  ])) {
    if (["extras", "optionalPairings", "floorPositions"].includes(key)) {
      out[key] = foldObject(ancestor?.[key], mine?.[key], theirs?.[key]);
    } else {
      const value = choose(ancestor?.[key], mine?.[key], theirs?.[key]);
      if (value !== undefined) out[key] = value;
    }
  }
  out.id = mine?.id ?? theirs?.id;
  return out;
}

function foldSeats(ancestorSeats, mineSeats, theirsSeats) {
  const byId = (list) => new Map((Array.isArray(list) ? list : []).map((s) => [s.id, s]));
  const anc = byId(ancestorSeats);
  const mine = byId(mineSeats);
  const theirs = byId(theirsSeats);
  const ids = [...new Set([...theirs.keys(), ...mine.keys()])].sort((a, b) => a - b);

  const out = [];
  for (const id of ids) {
    const m = mine.get(id);
    const a = anc.get(id);
    const t = theirs.get(id);
    if (m && t) {
      // With an ancestor, independent fields on the SAME seat can be folded.
      // Without one, retain the previous conservative local-wins behavior.
      out.push(a ? foldSeat(a, m, t) : m);
    } else if (t && !m) {
      // Seat only in theirs: if the ancestor had it, the local user removed it
      // (guest count reduced) — the removal wins. Otherwise theirs added it.
      if (!a) out.push(t);
    } else if (m && !t) {
      // Seat only in mine: if it's an untouched ancestor seat, theirs removed
      // it — adopt the removal. A locally-edited or locally-added seat stays.
      if (!a || !eq(m, a)) out.push(m);
    }
  }
  return out;
}

const restrictionEntries = (list) => {
  const counts = new Map();
  return (Array.isArray(list) ? list : []).map((entry) => {
    const note = String(entry?.note || "");
    const ordinal = counts.get(note) || 0;
    counts.set(note, ordinal + 1);
    return [`${note}\u0000${ordinal}`, entry];
  });
};

// Restrictions are a multiset: two gluten entries can represent two guests.
// Match each note by occurrence, then merge fields (position, detail,
// kitchenAdded) independently. New entries from either device are unioned.
function foldRestrictions(ancestor, mine, theirs) {
  const aEntries = restrictionEntries(ancestor);
  const mEntries = restrictionEntries(mine);
  const tEntries = restrictionEntries(theirs);
  const a = new Map(aEntries);
  const m = new Map(mEntries);
  const t = new Map(tEntries);
  const order = [...new Set([
    ...aEntries.map(([key]) => key),
    ...mEntries.map(([key]) => key),
    ...tEntries.map(([key]) => key),
  ])];
  const out = [];

  for (const key of order) {
    const base = a.get(key);
    const local = m.get(key);
    const remote = t.get(key);
    if (base && local && remote) {
      out.push(foldObject(base, local, remote));
    } else if (base && local && !remote) {
      // Remote deletion wins only when local left the entry untouched.
      if (!eq(local, base)) out.push(local);
    } else if (base && !local && remote) {
      // Local deletion wins only when remote left the entry untouched.
      if (!eq(remote, base)) out.push(remote);
    } else if (!base && local && remote) {
      out.push(local);
      if (!eq(local, remote)) out.push(remote); // two distinct additions: preserve both
    } else if (local) out.push(local);
    else if (remote) out.push(remote);
  }
  return out;
}

const partyKey = (table) => {
  const name = String(table?.resName || "").trim().toLowerCase();
  const time = String(table?.resTime || "").trim();
  const group = Array.isArray(table?.tableGroup)
    ? table.tableGroup.map(Number).filter(Number.isFinite).sort((a, b) => a - b).join(",")
    : "";
  return (name || time || group) ? `${name}|${time}|${group}` : "";
};

// Conflicts where guessing would destroy operational data. `concurrent-clear`
// covers CLEAR/MOVE blanking a source while another device fires or edits it.
// `destination-occupied` covers a table that was free in our ancestor but was
// claimed by another party before our MOVE/START arrived.
export function unsafeTableTransitionConflict(ancestor, mine, theirs) {
  if (!ancestor || eq(mine, theirs) || eq(theirs, ancestor)) return null;
  const baseHadService = tableHasServiceContent(ancestor);
  const mineHasService = tableHasServiceContent(mine);
  const theirsHasService = tableHasServiceContent(theirs);
  if (baseHadService && !mineHasService) return "concurrent-clear";

  const aParty = partyKey(ancestor);
  const mParty = partyKey(mine);
  const tParty = partyKey(theirs);
  if (mParty && tParty && mParty !== tParty && mParty !== aParty && tParty !== aParty) {
    return "destination-occupied";
  }
  if (!baseHadService && mineHasService && theirsHasService
      && (!mParty || !tParty || mParty !== tParty)) {
    return "destination-occupied";
  }
  return null;
}

export function foldTableWithMeta(ancestor, mine, theirs) {
  if (!ancestor) return { data: mine, conflict: null };
  const conflict = unsafeTableTransitionConflict(ancestor, mine, theirs);
  if (conflict) return { data: theirs, conflict };

  const out = {};
  const keys = new Set([...Object.keys(theirs || {}), ...Object.keys(mine || {})]);
  keys.delete("seats");
  keys.delete("restrictions");
  keys.delete("kitchenLog");
  for (const k of keys) out[k] = choose(ancestor?.[k], mine?.[k], theirs?.[k]);
  out.seats = foldSeats(ancestor?.seats, mine?.seats, theirs?.seats);
  out.restrictions = foldRestrictions(
    ancestor?.restrictions,
    mine?.restrictions,
    theirs?.restrictions,
  );
  out.kitchenLog = foldObject(ancestor?.kitchenLog, mine?.kitchenLog, theirs?.kitchenLog);
  out.id = mine?.id ?? theirs?.id;
  return { data: out, conflict: null };
}

export function foldTable(ancestor, mine, theirs) {
  return foldTableWithMeta(ancestor, mine, theirs).data;
}
