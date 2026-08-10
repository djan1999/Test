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
  } else if (before.active && after.active) {
    if ((Number(before.guests) || 0) !== (Number(after.guests) || 0)) {
      facts.push({
        type: "party_resized", tableId,
        payload: { from: Number(before.guests) || 0, to: Number(after.guests) || 0 },
      });
    }
    if ((before.resName || "") !== (after.resName || "")) {
      // Only the NEW name travels, under the erasure-covered `resName` key —
      // the previous name already lives in the earlier party_seated (or
      // party_renamed) fact, each covered by the same erasure match. The
      // `dedupe` fingerprint carries the full transition for the deduper
      // ONLY (never uploaded): without it, rename→remote-rename→rename-back
      // produced a payload identical to this device's last party fact and a
      // real change was absorbed (caught by the multi-device property).
      facts.push({
        type: "party_renamed", tableId,
        payload: { resName: after.resName || "" },
        dedupe: `${before.resName || ""}→${after.resName || ""}`,
      });
    }
    if ((before.arrivedAt ?? null) !== (after.arrivedAt ?? null)) {
      facts.push({
        type: "party_arrival_set", tableId,
        payload: { from: before.arrivedAt ?? null, to: after.arrivedAt ?? null },
      });
    }
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
      if (added.length === 0 && removed.length === 0) continue;
      // SNAPSHOT fact, not a delta: `drinks` is the seat's full multiset for
      // this category after the gesture. Idempotent by construction — folding
      // it twice, or replaying it after an absorbed duplicate, lands on the
      // same state. `added`/`removed` ride along purely for the story view.
      facts.push({
        type: "seat_drinks_set", tableId,
        payload: {
          seatId, category,
          drinks: Object.fromEntries(countByName(a[category])),
          added, removed,
        },
      });
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

  // ── bottles (table-level) — same snapshot semantics as seat drinks ─────────
  const bottles = multisetDelta(before.bottleWines, after.bottleWines);
  if (bottles.added.length > 0 || bottles.removed.length > 0) {
    facts.push({
      type: "table_bottles_set", tableId,
      payload: {
        bottles: Object.fromEntries(countByName(after.bottleWines)),
        added: bottles.added, removed: bottles.removed,
      },
    });
  }

  return facts;
}

// Which ASPECT of board state a fact mutates. The deduper compares each fact
// against the LAST fact emitted for its aspect: identical means "the adopt-
// fold re-diff re-surfaced a transition already recorded" (absorb), different
// means genuine state change (always emit). Because every fact is an
// idempotent aspect-level set, this cannot lose state in either direction:
// an absorbed fact is byte-identical to the aspect's latest — a no-op under
// the fold — and any real change differs from the latest by definition.
// (The previous identity+window design could silently suppress a genuine
// A→B→A→B repeat and undercount a two-of-the-same-drink gesture.)
const aspectKeyOf = (serviceId, fact) => {
  const p = fact.payload || {};
  const base = `${serviceId}|${fact.tableId}`;
  switch (fact.type) {
    case "party_seated": case "party_unseated": case "party_resized":
    case "party_renamed": case "party_arrival_set":
      return `${base}|party`;
    case "seat_water_set": return `${base}|water|${p.seatId}`;
    case "seat_pairing_set": return `${base}|pairing|${p.seatId}`;
    case "seat_drinks_set": return `${base}|drinks|${p.seatId}|${p.category}`;
    case "table_bottles_set": return `${base}|bottles`;
    case "extra_ordered": case "extra_unordered":
      return `${base}|extra|${p.seatId}|${p.key}`;
    case "option_ordered": case "option_unordered":
      return `${base}|option|${p.seatId}|${p.key}`;
    case "course_fired": case "course_unfired":
      return `${base}|course|${p.courseKey}`;
    default: // unknown future types: identity semantics (safe, never colliding)
      return `${base}|raw|${fact.type}|${JSON.stringify(p)}`;
  }
};

/**
 * Aspect-keyed dedup for adopt-fold re-diffs. Absorbs a fact only when it is
 * byte-identical (type + payload + transition fingerprint) to the LAST fact
 * emitted for the same aspect within the window — the re-diff signature. A
 * genuine repeat with any intervening change on THIS device always differs
 * from its aspect's latest fact and always records.
 *
 * The window is deliberately SHORT: echoes re-surface within seconds, and a
 * narrow window is what bounds the one residual blind spot — a transition
 * this device re-performs identically after ANOTHER device inverted it (its
 * own deduper never saw the remote fact). Inside the window that retrace is
 * absorbed; the board is untouched (the log is not the source of truth), the
 * watchdog reports the divergence, and any later fact on the aspect heals
 * the log. Phase 4's flip requires adoption-aware clearing before the fold
 * can BE the board (docs/EVENT_LOG_PLAN.md).
 */
export function createFactDeduper({ windowMs = 10000, now = () => Date.now() } = {}) {
  const seen = new Map(); // aspect key → { value, at }, insertion-ordered oldest-first
  return function shouldEmit(serviceId, fact) {
    const key = aspectKeyOf(serviceId, fact);
    const value = `${fact.type}|${fact.dedupe ?? ""}|${JSON.stringify(fact.payload)}`;
    const at = now();
    for (const [oldKey, entry] of seen) {
      if (at - entry.at > windowMs) seen.delete(oldKey);
      else break; // everything after is newer
    }
    const last = seen.get(key);
    if (last && last.value === value && at - last.at <= windowMs) return false;
    seen.delete(key); // re-insert at the tail so pruning stays oldest-first
    seen.set(key, { value, at });
    return true;
  };
}
