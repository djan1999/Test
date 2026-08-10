// ADVERSARIAL PROOFS for the logbook pipeline (docs/EVENT_LOG_PLAN.md).
// Where eventFold.test.js proves the happy property, this file attacks it:
// dedup transparency, multi-device interleaving, causality violations, and
// junk-input fuzzing. Every suite here simulates hundreds of hostile nights.

import { describe, it, expect } from "vitest";
import { boardFactsFromDiff, createFactDeduper } from "../utils/boardFacts.js";
import { foldServiceEvents, compareFoldToBoard } from "../utils/eventFold.js";

const rng = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
};
const pick = (random, list) => list[Math.floor(random() * list.length)];

const NAMES = ["Anna", "Bruno", "Cilka", "Davor", "Ema"];
const DRINKS = ["Negroni", "Union", "Dry Martini", "Brut Nature", "Spritz"];
const CATEGORIES = ["aperitifs", "glasses", "cocktails", "spirits", "beers"];
const WATERS = ["STILL", "SPARKLING", "TAP", "—"];
const PAIRINGS = ["WINE PAIRING", "NA PAIRING", ""];
const COURSES = ["c1", "c2", "c3", "c4", "c5"];
const BOTTLES = ["Rebula 2019", "Modri Pinot", "Zelen"];
const EXTRAS = ["cake", "cheese"];

const blankSeat = (id) => ({
  id, water: "—", pairing: "", aperitifs: [], glasses: [], cocktails: [],
  spirits: [], beers: [], extras: {}, optionalPairings: {},
});
const blankCard = (id) => ({
  id, active: false, resName: "", guests: 2, arrivedAt: null,
  seats: [], kitchenLog: {}, bottleWines: [],
});
const clone = (value) => JSON.parse(JSON.stringify(value));

// The same gesture engine the parity property uses (kept in sync by hand —
// both operate on plain card tables through the public deriver).
function applyRandomGesture(random, card) {
  const next = clone(card);
  const gestures = [];
  if (!next.active) gestures.push("seat");
  if (next.active) gestures.push("unseat", "resize", "rename", "retime", "water", "pairing", "drinkAdd", "drinkAddDouble", "fire", "extra", "option", "bottleAdd");
  if (next.active && next.seats.some((seat) => CATEGORIES.some((category) => seat[category].length))) gestures.push("drinkRemove");
  if (Object.keys(next.kitchenLog).length) gestures.push("unfire");
  if (next.bottleWines.length) gestures.push("bottleRemove");
  const gesture = pick(random, gestures);
  const seat = () => pick(random, next.seats);
  switch (gesture) {
    case "seat": {
      const guests = 2 + Math.floor(random() * 4);
      next.active = true;
      next.resName = pick(random, NAMES);
      next.guests = guests;
      next.arrivedAt = `19:${String(Math.floor(random() * 60)).padStart(2, "0")}`;
      next.seats = Array.from({ length: guests }, (_, i) => blankSeat(i + 1));
      break;
    }
    case "unseat": return blankCard(next.id);
    case "resize": {
      const guests = 2 + Math.floor(random() * 5);
      next.guests = guests;
      next.seats = Array.from({ length: guests }, (_, i) => next.seats[i] || blankSeat(i + 1));
      break;
    }
    case "rename": next.resName = pick(random, NAMES); break;
    case "retime": next.arrivedAt = `20:${String(Math.floor(random() * 60)).padStart(2, "0")}`; break;
    case "water": seat().water = pick(random, WATERS); break;
    case "pairing": seat().pairing = pick(random, PAIRINGS); break;
    case "drinkAdd": seat()[pick(random, CATEGORIES)].push({ name: pick(random, DRINKS) }); break;
    case "drinkAddDouble": {
      const s = seat();
      const category = pick(random, CATEGORIES);
      const name = pick(random, DRINKS);
      s[category].push({ name }, { name }); // two of the same in ONE gesture
      break;
    }
    case "drinkRemove": {
      const candidates = next.seats.flatMap((s) =>
        CATEGORIES.filter((category) => s[category].length).map((category) => ({ s, category })));
      const target = pick(random, candidates);
      target.s[target.category].splice(Math.floor(random() * target.s[target.category].length), 1);
      break;
    }
    case "fire": next.kitchenLog[pick(random, COURSES)] = { firedAt: `20:${String(Math.floor(random() * 60)).padStart(2, "0")}` }; break;
    case "unfire": delete next.kitchenLog[pick(random, Object.keys(next.kitchenLog))]; break;
    case "extra": {
      const s = seat();
      const key = pick(random, EXTRAS);
      s.extras[key] = { ordered: !s.extras[key]?.ordered };
      break;
    }
    case "option": {
      const s = seat();
      s.optionalPairings.op1 = { ordered: !s.optionalPairings.op1?.ordered };
      break;
    }
    case "bottleAdd": next.bottleWines.push({ name: pick(random, BOTTLES) }); break;
    case "bottleRemove": next.bottleWines.splice(Math.floor(random() * next.bottleWines.length), 1); break;
    default: break;
  }
  return next;
}

const asEvent = (fact) => ({ type: fact.type, table_id: fact.tableId, payload: fact.payload });

// ── DEDUP TRANSPARENCY ───────────────────────────────────────────────────────
// The theorem the aspect-keyed deduper stands on: for any derived stream —
// WITH adopt-fold re-diff noise injected — the deduped stream and the raw
// undeduped stream fold to the same board. Absorption can only ever drop
// facts whose application is a no-op; if this ever fails, dedup is deleting
// state and must be ripped out.
describe("ADVERSARIAL — dedup transparency: fold(dedup(s)) === fold(s), 200 hostile nights", () => {
  it("holds with re-diff noise on a jittered clock", () => {
    for (let seedIndex = 0; seedIndex < 200; seedIndex += 1) {
      const random = rng(50000 + seedIndex * 104729);
      const tableIds = [1, 2, 3, 4];
      const cards = new Map(tableIds.map((id) => [id, blankCard(id)]));
      let clockMs = 0;
      const shouldEmit = createFactDeduper({ now: () => clockMs });
      const deduped = [];
      const raw = [];
      const steps = 10 + Math.floor(random() * 50);
      for (let step = 0; step < steps; step += 1) {
        clockMs += Math.floor(random() * 20000);
        const tableId = pick(random, tableIds);
        const before = cards.get(tableId);
        const after = applyRandomGesture(random, before);
        const emitOnce = () => {
          for (const fact of boardFactsFromDiff(before, after)) {
            raw.push(asEvent(fact));
            if (shouldEmit("svc", fact)) deduped.push(asEvent(fact));
          }
        };
        emitOnce();
        cards.set(tableId, after);
        if (random() < 0.5) { clockMs += 1 + Math.floor(random() * 2000); emitOnce(); } // re-diff echo
        if (random() < 0.15) { clockMs += 1; emitOnce(); } // double echo
      }
      const board = [...cards.values()];
      const viaDedup = compareFoldToBoard(foldServiceEvents(deduped), board);
      const viaRaw = compareFoldToBoard(foldServiceEvents(raw), board);
      expect(viaDedup.divergent, `seed ${50000 + seedIndex * 104729} (deduped)`).toEqual([]);
      expect(viaRaw.divergent, `seed ${50000 + seedIndex * 104729} (raw echoes, undeduped)`).toEqual([]);
    }
  });
});

// ── MULTI-DEVICE NIGHTS ──────────────────────────────────────────────────────
// K devices work the same board, each with its OWN deduper and its OWN upload
// buffer. Buffers flush into the server stream at random times — so facts
// from different tables interleave arbitrarily. The one physical constraint
// is causality per table: a device gestures on a table only after the facts
// it saw there have reached the server (it adopted that state). Under that
// constraint, replay parity must hold no matter how the flushes interleave.
describe("ADVERSARIAL — multi-device interleaved nights, 200 seeds × 3 devices", () => {
  it("replay parity survives arbitrary cross-table interleaving of device uploads", () => {
    for (let seedIndex = 0; seedIndex < 200; seedIndex += 1) {
      const random = rng(90000 + seedIndex * 15485863);
      const tableIds = [1, 2, 3, 4, 5];
      const cards = new Map(tableIds.map((id) => [id, blankCard(id)]));
      const deviceCount = 3;
      let clockMs = 0;
      const devices = Array.from({ length: deviceCount }, () => ({
        shouldEmit: createFactDeduper({ now: () => clockMs }),
        buffer: [], // [{tableId, event}]
      }));
      const server = [];
      const flushDeviceTable = (device, tableId) => {
        const keep = [];
        for (const item of device.buffer) {
          if (item.tableId === tableId) server.push(item.event);
          else keep.push(item);
        }
        device.buffer = keep;
      };
      const flushDevice = (device) => {
        for (const item of device.buffer) server.push(item.event);
        device.buffer = [];
      };
      const steps = 15 + Math.floor(random() * 60);
      const lastDeviceOnTable = new Map();
      for (let step = 0; step < steps; step += 1) {
        // Realistic timing only — NO artificial handoff delay. The old
        // version added 11s whenever a device changed to keep the race
        // outside the window; adoption-aware clearing removes that need, so
        // this now proves parity under back-to-back cross-device handoffs.
        clockMs += Math.floor(random() * 8000);
        const device = pick(random, devices);
        const tableId = pick(random, tableIds);
        // Causality: everything already recorded about this table (by anyone)
        // reached the server before this device acts on the state it adopted.
        for (const other of devices) flushDeviceTable(other, tableId);
        // Adoption-aware dedup: taking over a table another device last
        // touched clears this device's echo-memory for it (as adoptRemoteTables
        // does in production).
        if (lastDeviceOnTable.get(tableId) && lastDeviceOnTable.get(tableId) !== device) {
          device.shouldEmit.forgetTable("svc", tableId);
        }
        lastDeviceOnTable.set(tableId, device);
        const before = cards.get(tableId);
        const after = applyRandomGesture(random, before);
        for (const fact of boardFactsFromDiff(before, after)) {
          if (device.shouldEmit("svc", fact)) device.buffer.push({ tableId, event: asEvent(fact) });
        }
        cards.set(tableId, after);
        // Random unrelated flushes — cross-table interleaving is unconstrained.
        for (const other of devices) if (random() < 0.3) flushDevice(other);
      }
      for (const device of devices) flushDevice(device);
      const { divergent } = compareFoldToBoard(foldServiceEvents(server), [...cards.values()]);
      expect(divergent, `seed ${90000 + seedIndex * 15485863}`).toEqual([]);
    }
  });

  it("cross-device rename inversion INSIDE the window still records (the caught bug, pinned)", () => {
    // The multi-device property caught this live: A renames to Cilka, B
    // renames to Ema, A renames BACK to Cilka seconds later. A's deduper
    // never saw B's fact, so A's second fact was byte-identical to its last
    // party fact and a real change was absorbed. The transition fingerprint
    // (Anna→Cilka vs Ema→Cilka) makes the two facts distinct.
    let clock = 0;
    const dedupA = createFactDeduper({ now: () => clock });
    const dedupB = createFactDeduper({ now: () => clock });
    const server = [];
    const card = (resName) => ({ ...blankCard(1), active: true, resName, guests: 2, arrivedAt: "19:00", seats: [] });
    const emit = (dedup, before, after) => {
      for (const fact of boardFactsFromDiff(before, after)) {
        if (dedup("svc", fact)) server.push(asEvent(fact));
      }
    };
    emit(dedupA, blankCard(1), card("Anna"));   // A seats Anna
    clock += 2000;
    emit(dedupA, card("Anna"), card("Cilka"));  // A renames → Cilka
    clock += 2000;
    emit(dedupB, card("Cilka"), card("Ema"));   // B renames → Ema (A adopts silently)
    clock += 2000;
    emit(dedupA, card("Ema"), card("Cilka"));   // A renames back → Cilka, inside the window
    const { divergent } = compareFoldToBoard(foldServiceEvents(server), [card("Cilka")]);
    expect(divergent).toEqual([]);
  });

  it("ADOPTION-AWARE dedup closes the cross-device race with ZERO elapsed time", () => {
    // The residual limit made structural: even with the clock frozen (window
    // gives no protection at all), a device that ADOPTS a remote change to a
    // table forgets its echo-memory for it — so re-performing a value it
    // itself last emitted still records. This is the invert-and-redo bug with
    // the window removed as a defense; only forgetTable can save it.
    const clock = 0; // frozen — the window can never help here
    const dedupA = createFactDeduper({ now: () => clock });
    const dedupB = createFactDeduper({ now: () => clock });
    const server = [];
    const card = (resName) => ({ ...blankCard(1), active: true, resName, guests: 2, arrivedAt: "19:00", seats: [] });
    const emit = (dedup, before, after) => {
      for (const fact of boardFactsFromDiff(before, after)) {
        if (dedup("svc", fact)) server.push(asEvent(fact));
      }
    };
    emit(dedupA, blankCard(1), card("Anna"));   // A seats Anna
    emit(dedupA, card("Anna"), card("Cilka"));  // A → Cilka
    emit(dedupB, card("Cilka"), card("Ema"));   // B → Ema
    dedupA.forgetTable("svc", 1);               // A ADOPTS B's change (the new step)
    emit(dedupA, card("Ema"), card("Cilka"));   // A → Cilka again, clock still 0
    const { divergent } = compareFoldToBoard(foldServiceEvents(server), [card("Cilka")]);
    expect(divergent).toEqual([]);
  });

  it("forgetTable is surgical: only the adopted table's aspects are cleared", () => {
    const clock = 0;
    const dedup = createFactDeduper({ now: () => clock });
    const waterFact = (tableId, seatId) => ({ type: "seat_water_set", tableId, payload: { seatId, from: "—", to: "STILL" } });
    expect(dedup("svc", waterFact(1, 1))).toBe(true);
    expect(dedup("svc", waterFact(2, 1))).toBe(true);
    expect(dedup("svc", waterFact(1, 1))).toBe(false); // echo of T1 absorbed
    dedup.forgetTable("svc", 1);
    expect(dedup("svc", waterFact(1, 1))).toBe(true);  // T1 memory cleared → records
    expect(dedup("svc", waterFact(2, 1))).toBe(false); // T2 memory intact → still absorbed
    dedup.forgetTable("other-svc", 1);                 // wrong service is a no-op
    expect(dedup("svc", waterFact(2, 1))).toBe(false);
  });

  it("RECONCILIATION closes the real seat-1 tiebreak: the log converges on the board", () => {
    // The 10.08 Demo divergence, reproduced exactly. Device B's board write
    // lands LAST (board settles on XC) but device A's fact reaches the log last
    // (log tail says XW) — the fact queue is decoupled from the board write, so
    // the two orderings invert. Before reconciliation the fold ends on XW while
    // the board holds XC: a concurrent-tiebreak. Now, when A adopts the board's
    // XC and that CONTRADICTS the fact A itself recorded, A appends the
    // correction — and the log's last word becomes the board's answer.
    const clock = 0; // frozen: no timing help whatsoever
    const dedupA = createFactDeduper({ now: () => clock });
    const server = [];
    const seatCard = (water) => ({
      ...blankCard(7), active: true, resName: "gay", guests: 2,
      seats: [{ ...blankSeat(1), water }, blankSeat(2)],
    });
    const emit = (dedup, before, after) => {
      for (const fact of boardFactsFromDiff(before, after)) {
        if (dedup("svc", fact)) server.push(asEvent(fact));
      }
    };
    // A works the seat: seats the party, sets water XW. Its facts reach the log.
    emit(dedupA, blankCard(7), seatCard("—"));
    emit(dedupA, seatCard("—"), seatCard("XW"));
    // Meanwhile B set XC; B's board write won the store. A now ADOPTS XC.
    const adopted = seatCard("XC");
    const priorBaseline = seatCard("XW"); // A's baseline before the adoption
    const reconciliations = boardFactsFromDiff(priorBaseline, adopted)
      .filter((fact) => dedupA.contradicts("svc", fact));
    // A had logged water XW for this aspect; the adopted truth is XC → correct it.
    expect(reconciliations.map((f) => f.type)).toEqual(["seat_water_set"]);
    for (const fact of reconciliations) {
      if (dedupA("svc", fact)) server.push(asEvent(fact));
    }
    const result = compareFoldToBoard(foldServiceEvents(server), [adopted]);
    expect(result.contentLoss).toEqual([]);
    expect(result.tiebreaks).toEqual([]);   // the tiebreak is GONE
    expect(result.divergent).toEqual([]);   // full parity on a contested seat
  });

  it("reconciliation stays quiet for aspects this device never touched (no duplicate noise)", () => {
    // A never set seat 2's water; B did. When A adopts B's change there is
    // nothing to correct — B's own fact already tells that story.
    const clock = 0;
    const dedupA = createFactDeduper({ now: () => clock });
    const card = (w1, w2) => ({
      ...blankCard(7), active: true, resName: "gay", guests: 2,
      seats: [{ ...blankSeat(1), water: w1 }, { ...blankSeat(2), water: w2 }],
    });
    // A only ever touches seat 1.
    for (const fact of boardFactsFromDiff(blankCard(7), card("XW", "—"))) dedupA("svc", fact);
    // The store arrives with B's seat-2 water AND A's own seat-1 value intact.
    const adopted = card("XW", "OC");
    const reconciliations = boardFactsFromDiff(card("XW", "—"), adopted)
      .filter((fact) => dedupA.contradicts("svc", fact));
    expect(reconciliations).toEqual([]); // silent — B owns seat 2's story
  });

  it("a causality-VIOLATING late drain is detected as divergence, never silent", () => {
    // Device 1 unseats Anna but its upload wedges; device 2 then seats Bruno
    // at the same table. Device 1's stale unseat drains LAST. The fold blanks
    // the table while the board holds Bruno — the exact wound the parity
    // checker and watchdog exist to expose. This pins DETECTION; Phase 4's
    // fold-as-truth needs causal ordering before this can ever be the board.
    const events = [
      { type: "party_seated", table_id: 7, payload: { resName: "Anna", guests: 2, arrivedAt: "19:00" } },
      { type: "party_seated", table_id: 7, payload: { resName: "Bruno", guests: 4, arrivedAt: "21:00" } },
      { type: "party_unseated", table_id: 7, payload: { resName: "Anna", guests: 2 } }, // stale, drained late
    ];
    const board = [{ ...blankCard(7), active: true, resName: "Bruno", guests: 4, arrivedAt: "21:00", seats: [] }];
    const { divergent } = compareFoldToBoard(foldServiceEvents(events), board);
    expect(divergent.map((d) => d.tableId)).toEqual([7]);
  });
});

// ── THE FUZZER ───────────────────────────────────────────────────────────────
// 200 rounds of garbage: real event types with junk payloads, unknown types,
// malformed tables, nulls, NaN, nested trash. The reducer and comparator are
// total functions — they must never throw, on anything, ever. A crash while
// folding is a device down mid-service; this is the no-crash contract of L11.
describe("ADVERSARIAL — fuzzing the fold: 200 rounds of junk never throw", () => {
  const TYPES = [
    "party_seated", "party_unseated", "party_resized", "party_renamed", "party_arrival_set",
    "seat_water_set", "seat_pairing_set", "seat_drinks_set", "table_bottles_set",
    "extra_ordered", "extra_unordered", "option_ordered", "option_unordered",
    "course_fired", "course_unfired", "drink_added", "drink_removed",
    "bottle_added", "bottle_removed", "from_the_future", "", null, undefined, 42,
  ];
  const junkScalar = (random) => pick(random, [
    null, undefined, 0, -1, 3.14, NaN, Infinity, "", "x", "—", true, false, [], {},
    { a: { b: { c: [1, 2, { d: null }] } } }, [[[]]], "🍷", -0,
  ]);
  const junkPayload = (random) => {
    const payload = {};
    const keys = ["seatId", "category", "name", "drinks", "bottles", "added", "removed",
      "courseKey", "firedAt", "resName", "guests", "arrivedAt", "from", "to", "key", "junk"];
    const count = Math.floor(random() * 6);
    for (let i = 0; i < count; i += 1) payload[pick(random, keys)] = junkScalar(random);
    return pick(random, [payload, null, undefined, [], "not-an-object", 7]);
  };

  it("foldServiceEvents and compareFoldToBoard survive everything", () => {
    for (let round = 0; round < 200; round += 1) {
      const random = rng(777000 + round * 2654435761);
      const events = Array.from({ length: 100 }, () => pick(random, [
        {
          type: pick(random, TYPES),
          table_id: pick(random, [1, 2, "3", null, undefined, NaN, 9.5, -1, "junk"]),
          payload: junkPayload(random),
        },
        null, undefined, "not-an-event", 42, [],
      ]));
      const boards = pick(random, [
        [], null, undefined, "junk",
        [null, { id: 1 }, { id: NaN, seats: "junk", kitchenLog: 7, bottleWines: { a: 1 } }, blankCard(2)],
      ]);
      expect(() => {
        const folded = foldServiceEvents(events);
        compareFoldToBoard(folded, boards);
      }, `fuzz round ${round}`).not.toThrow();
    }
  });
});
