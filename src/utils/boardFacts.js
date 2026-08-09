// The logbook's Phase-3 write side (docs/EVENT_LOG_PLAN.md), pulled forward:
// derive a night's FACTS — seating, waters, pairings, drinks, bottles, extras,
// plus the kitchen facts of Phase 1 — from a table's before/after at the
// autosave choke point. Local gestures only reach that diff (adoptions
// advance the baselines past it), so what changed here is what someone on
// THIS device actually did.
//
// Pure and dependency-free: { type, tableId, payload } descriptors, no I/O.
// A move surfaces as party_unseated(source) + party_seated(destination) until
// gesture seams carry true intent (Phase 3 proper).

import { kitchenFactsFromDiff } from "./kitchenFacts.js";

const seatsOf = (table) => (Array.isArray(table?.seats) ? table.seats : []);
const namesOf = (list) => (Array.isArray(list) ? list : [])
  .map((entry) => (typeof entry === "string" ? entry : entry?.name ?? JSON.stringify(entry)));

// Multiset difference by display name: two Negronis are two drinks.
const countByName = (list) => {
  const counts = new Map();
  for (const name of namesOf(list)) counts.set(name, (counts.get(name) || 0) + 1);
  return counts;
};
const multisetDelta = (beforeList, afterList) => {
  const before = countByName(beforeList);
  const after = countByName(afterList);
  const added = [];
  const removed = [];
  for (const [name, n] of after) {
    for (let i = (before.get(name) || 0); i < n; i += 1) added.push(name);
  }
  for (const [name, n] of before) {
    for (let i = (after.get(name) || 0); i < n; i += 1) removed.push(name);
  }
  return { added, removed };
};

const DRINK_CATEGORIES = ["aperitifs", "glasses", "cocktails", "spirits", "beers"];

const orderedKeys = (map) => new Set(
  Object.entries(map && typeof map === "object" ? map : {})
    .filter(([, v]) => v?.ordered)
    .map(([k]) => k),
);

/**
 * All facts that turn `prevTable` into `nextTable`. Payloads deliberately use
 * the key `resName` where a party is named, so the database-side guest
 * erasure (which redacts payload.resName matches) covers them.
 */
export function boardFactsFromDiff(prevTable, nextTable) {
  const tableId = Number(nextTable?.id ?? prevTable?.id);
  if (!Number.isFinite(tableId)) return [];
  const facts = [...kitchenFactsFromDiff(prevTable, nextTable)];
  const before = prevTable && typeof prevTable === "object" ? prevTable : {};
  const after = nextTable && typeof nextTable === "object" ? nextTable : {};

  // ── seating ────────────────────────────────────────────────────────────────
  if (!before.active && after.active) {
    facts.push({
      type: "party_seated", tableId,
      payload: {
        resName: after.resName || "",
        guests: Number(after.guests) || 0,
        arrivedAt: after.arrivedAt ?? null,
      },
    });
  } else if (before.active && !after.active) {
    facts.push({
      type: "party_unseated", tableId,
      payload: { resName: before.resName || "", guests: Number(before.guests) || 0 },
    });
  } else if (before.active && after.active
      && (Number(before.guests) || 0) !== (Number(after.guests) || 0)) {
    facts.push({
      type: "party_resized", tableId,
      payload: { from: Number(before.guests) || 0, to: Number(after.guests) || 0 },
    });
  }

  // ── per-seat: waters, pairings, drinks, extras, options ────────────────────
  const beforeSeats = new Map(seatsOf(before).map((seat) => [Number(seat.id), seat]));
  const afterSeats = new Map(seatsOf(after).map((seat) => [Number(seat.id), seat]));
  const seatIds = [...new Set([...beforeSeats.keys(), ...afterSeats.keys()])].sort((a, b) => a - b);
  for (const seatId of seatIds) {
    const b = beforeSeats.get(seatId) || {};
    const a = afterSeats.get(seatId) || {};
    const bWater = b.water ?? "—";
    const aWater = a.water ?? "—";
    if (bWater !== aWater) {
      facts.push({ type: "seat_water_set", tableId, payload: { seatId, from: bWater, to: aWater } });
    }
    const bPairing = b.pairing ?? "";
    const aPairing = a.pairing ?? "";
    if (bPairing !== aPairing) {
      facts.push({ type: "seat_pairing_set", tableId, payload: { seatId, from: bPairing, to: aPairing } });
    }
    for (const category of DRINK_CATEGORIES) {
      const { added, removed } = multisetDelta(b[category], a[category]);
      for (const name of added) {
        facts.push({ type: "drink_added", tableId, payload: { seatId, category, name } });
      }
      for (const name of removed) {
        facts.push({ type: "drink_removed", tableId, payload: { seatId, category, name } });
      }
    }
    const bExtras = orderedKeys(b.extras);
    const aExtras = orderedKeys(a.extras);
    for (const key of aExtras) if (!bExtras.has(key)) {
      facts.push({ type: "extra_ordered", tableId, payload: { seatId, key } });
    }
    for (const key of bExtras) if (!aExtras.has(key)) {
      facts.push({ type: "extra_unordered", tableId, payload: { seatId, key } });
    }
    const bOptions = orderedKeys(b.optionalPairings);
    const aOptions = orderedKeys(a.optionalPairings);
    for (const key of aOptions) if (!bOptions.has(key)) {
      facts.push({ type: "option_ordered", tableId, payload: { seatId, key } });
    }
    for (const key of bOptions) if (!aOptions.has(key)) {
      facts.push({ type: "option_unordered", tableId, payload: { seatId, key } });
    }
  }

  // ── bottles (table-level) ──────────────────────────────────────────────────
  const bottles = multisetDelta(before.bottleWines, after.bottleWines);
  for (const name of bottles.added) {
    facts.push({ type: "bottle_added", tableId, payload: { name } });
  }
  for (const name of bottles.removed) {
    facts.push({ type: "bottle_removed", tableId, payload: { name } });
  }

  return facts;
}

/**
 * Windowed dedup for adopt-fold re-diffs: a fold can re-surface a transition
 * this device already recorded moments earlier, so an IDENTICAL fact within
 * the window is absorbed. A genuine later repeat (STILL → SPARKLING → STILL
 * again next round) is outside the window and records again.
 */
export function createFactDeduper({ windowMs = 60000, now = () => Date.now() } = {}) {
  const seen = new Map(); // key → last emit ms, insertion-ordered oldest-first
  return function shouldEmit(serviceId, fact) {
    const key = `${serviceId}|${fact.tableId}|${fact.type}|${JSON.stringify(fact.payload)}`;
    const at = now();
    for (const [oldKey, ts] of seen) {
      if (at - ts > windowMs) seen.delete(oldKey);
      else break; // everything after is newer
    }
    if (seen.has(key) && at - seen.get(key) <= windowMs) return false;
    seen.delete(key); // re-insert at the tail so pruning stays oldest-first
    seen.set(key, at);
    return true;
  };
}
