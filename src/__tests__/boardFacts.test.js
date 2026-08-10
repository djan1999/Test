// The logbook's full write side (Phase 3's facts, pulled forward): a night's
// story derived from before/after diffs. Pure-function pins.

import { describe, it, expect } from "vitest";
import { boardFactsFromDiff, createFactDeduper } from "../utils/boardFacts.js";

const seat = (id, over = {}) => ({
  id, water: "—", pairing: "", aperitifs: [], glasses: [], cocktails: [],
  spirits: [], beers: [], extras: {}, optionalPairings: {}, ...over,
});
const table = (over = {}) => ({ id: 3, active: false, resName: "", guests: 2, seats: [], bottleWines: [], kitchenLog: {}, ...over });

const types = (facts) => facts.map((fact) => fact.type);

describe("boardFactsFromDiff — seating", () => {
  it("arrival is a party_seated fact naming the party (erasure covers payload.resName)", () => {
    const facts = boardFactsFromDiff(
      table({ resName: "Anna" }),
      table({ active: true, resName: "Anna", guests: 4, arrivedAt: "19:42" }),
    );
    expect(facts).toEqual([
      { type: "party_seated", tableId: 3, payload: { resName: "Anna", guests: 4, arrivedAt: "19:42" } },
    ]);
  });

  it("departure is party_unseated; a resize while seated is party_resized", () => {
    expect(boardFactsFromDiff(
      table({ active: true, resName: "Anna", guests: 4 }),
      table({ resName: "Anna", guests: 4 }),
    )).toEqual([
      { type: "party_unseated", tableId: 3, payload: { resName: "Anna", guests: 4 } },
    ]);
    expect(types(boardFactsFromDiff(
      table({ active: true, guests: 2 }),
      table({ active: true, guests: 4 }),
    ))).toEqual(["party_resized"]);
  });

  it("a rename mid-service carries ONLY the new name, under the erasure-covered key", () => {
    expect(boardFactsFromDiff(
      table({ active: true, resName: "Anna" }),
      table({ active: true, resName: "Bruno" }),
    )).toEqual([
      // `dedupe` is deduper-local transition identity — it is NOT part of the
      // payload and never uploads, so erasure coverage stays exactly resName.
      { type: "party_renamed", tableId: 3, payload: { resName: "Bruno" }, dedupe: "Anna→Bruno" },
    ]);
  });

  it("an arrival-time change is a fact; seating and unseating never double-emit them", () => {
    expect(boardFactsFromDiff(
      table({ active: true, arrivedAt: "19:00" }),
      table({ active: true, arrivedAt: "19:30" }),
    )).toEqual([
      { type: "party_arrival_set", tableId: 3, payload: { from: "19:00", to: "19:30" } },
    ]);
    // Seating carries name+arrival inside party_seated — no separate facts.
    expect(types(boardFactsFromDiff(
      table(),
      table({ active: true, resName: "Anna", arrivedAt: "19:00" }),
    ))).toEqual(["party_seated"]);
    // Unseating blanks name+arrival as part of party_unseated — no separate facts.
    expect(types(boardFactsFromDiff(
      table({ active: true, resName: "Anna", arrivedAt: "19:00" }),
      table(),
    ))).toEqual(["party_unseated"]);
  });

  it("resize + rename + re-time in one diff are three independent facts", () => {
    expect(types(boardFactsFromDiff(
      table({ active: true, resName: "Anna", guests: 2, arrivedAt: "19:00" }),
      table({ active: true, resName: "Bruno", guests: 4, arrivedAt: "19:30" }),
    )).sort()).toEqual(["party_arrival_set", "party_renamed", "party_resized"]);
  });
});

describe("boardFactsFromDiff — seats and drinks", () => {
  it("water and pairing transitions carry from/to", () => {
    const facts = boardFactsFromDiff(
      table({ seats: [seat(1)] }),
      table({ seats: [seat(1, { water: "STILL", pairing: "WINE PAIRING" })] }),
    );
    expect(facts).toEqual([
      { type: "seat_water_set", tableId: 3, payload: { seatId: 1, from: "—", to: "STILL" } },
      { type: "seat_pairing_set", tableId: 3, payload: { seatId: 1, from: "", to: "WINE PAIRING" } },
    ]);
  });

  it("drinks are SNAPSHOT facts: the full multiset travels, deltas only decorate the story", () => {
    const facts = boardFactsFromDiff(
      table({ seats: [seat(2, { cocktails: [{ name: "Negroni" }] })] }),
      table({ seats: [seat(2, { cocktails: [{ name: "Negroni" }, { name: "Negroni" }], spirits: [] })] }),
    );
    expect(facts).toEqual([
      {
        type: "seat_drinks_set", tableId: 3,
        payload: { seatId: 2, category: "cocktails", drinks: { Negroni: 2 }, added: ["Negroni"], removed: [] },
      },
    ]);
    const removals = boardFactsFromDiff(
      table({ seats: [seat(2, { beers: [{ name: "Union" }] })] }),
      table({ seats: [seat(2)] }),
    );
    expect(removals).toEqual([
      {
        type: "seat_drinks_set", tableId: 3,
        payload: { seatId: 2, category: "beers", drinks: {}, added: [], removed: ["Union"] },
      },
    ]);
  });

  it("two of the same drink in ONE gesture is one snapshot carrying both — nothing to undercount", () => {
    const facts = boardFactsFromDiff(
      table({ seats: [seat(1)] }),
      table({ seats: [seat(1, { cocktails: [{ name: "Negroni" }, { name: "Negroni" }] })] }),
    );
    expect(facts).toEqual([
      {
        type: "seat_drinks_set", tableId: 3,
        payload: { seatId: 1, category: "cocktails", drinks: { Negroni: 2 }, added: ["Negroni", "Negroni"], removed: [] },
      },
    ]);
  });

  it("extras and optional pairings record their ordered flips", () => {
    const facts = boardFactsFromDiff(
      table({ seats: [seat(1, { extras: { cake: { ordered: false } }, optionalPairings: { op1: { ordered: true } } })] }),
      table({ seats: [seat(1, { extras: { cake: { ordered: true } }, optionalPairings: { op1: { ordered: false } } })] }),
    );
    expect(facts).toEqual([
      { type: "extra_ordered", tableId: 3, payload: { seatId: 1, key: "cake" } },
      { type: "option_unordered", tableId: 3, payload: { seatId: 1, key: "op1" } },
    ]);
  });

  it("bottles are a table-level snapshot fact", () => {
    expect(boardFactsFromDiff(
      table({ bottleWines: [] }),
      table({ bottleWines: [{ name: "Rebula 2019" }] }),
    )).toEqual([
      {
        type: "table_bottles_set", tableId: 3,
        payload: { bottles: { "Rebula 2019": 1 }, added: ["Rebula 2019"], removed: [] },
      },
    ]);
  });

  it("kitchen fires still ride along (Phase 1 unchanged)", () => {
    expect(types(boardFactsFromDiff(
      table({ active: true, kitchenLog: {} }),
      table({ active: true, kitchenLog: { c2: { firedAt: "19:55" } } }),
    ))).toEqual(["course_fired"]);
  });

  it("no change, no facts — and malformed tables never throw", () => {
    expect(boardFactsFromDiff(table(), table())).toEqual([]);
    expect(boardFactsFromDiff(null, { id: "x" })).toEqual([]);
    expect(boardFactsFromDiff({ id: 3, seats: "junk" }, table())).toEqual([]);
  });
});

describe("createFactDeduper (aspect-keyed)", () => {
  const fact = { type: "seat_water_set", tableId: 3, payload: { seatId: 1, from: "—", to: "STILL" } };

  it("absorbs an identical fact inside the window (the adopt-fold re-diff)", () => {
    let clock = 1000;
    const shouldEmit = createFactDeduper({ windowMs: 60000, now: () => clock });
    expect(shouldEmit("svc", fact)).toBe(true);
    clock += 500; // the fold bounce, moments later
    expect(shouldEmit("svc", fact)).toBe(false);
  });

  it("a genuine repeat INSIDE the window records when state changed in between (A→B→A→B)", () => {
    // The old identity+window design absorbed the fourth fact here — the log
    // silently ended on the wrong water. Aspect-keyed dedup compares against
    // the aspect's LAST fact, so any real state change always records.
    let clock = 1000;
    const shouldEmit = createFactDeduper({ windowMs: 60000, now: () => clock });
    const toSparkling = { type: "seat_water_set", tableId: 3, payload: { seatId: 1, from: "STILL", to: "SPARKLING" } };
    const toStill = { type: "seat_water_set", tableId: 3, payload: { seatId: 1, from: "SPARKLING", to: "STILL" } };
    expect(shouldEmit("svc", toSparkling)).toBe(true);
    clock += 5000;
    expect(shouldEmit("svc", toStill)).toBe(true);
    clock += 5000;
    expect(shouldEmit("svc", toSparkling)).toBe(true); // inside the window, but the aspect moved on
    clock += 500;
    expect(shouldEmit("svc", toSparkling)).toBe(false); // the re-diff of it still absorbs
  });

  it("a genuine later repeat records again, and different aspects never collide", () => {
    let clock = 1000;
    const shouldEmit = createFactDeduper({ windowMs: 60000, now: () => clock });
    expect(shouldEmit("svc", fact)).toBe(true);
    clock += 61000; // next round of the same transition, well past the window
    expect(shouldEmit("svc", fact)).toBe(true);
    expect(shouldEmit("svc", { ...fact, payload: { ...fact.payload, seatId: 2 } })).toBe(true);
    expect(shouldEmit("other-svc", fact)).toBe(true);
  });

  it("seat/unseat/re-seat of the same party all record (one shared party aspect)", () => {
    let clock = 1000;
    const shouldEmit = createFactDeduper({ windowMs: 60000, now: () => clock });
    const seated = { type: "party_seated", tableId: 3, payload: { resName: "Anna", guests: 2, arrivedAt: "19:00" } };
    const unseated = { type: "party_unseated", tableId: 3, payload: { resName: "Anna", guests: 2 } };
    expect(shouldEmit("svc", seated)).toBe(true);
    clock += 3000;
    expect(shouldEmit("svc", unseated)).toBe(true);
    clock += 3000;
    expect(shouldEmit("svc", seated)).toBe(true); // identical to the FIRST fact, but the aspect moved on
  });

  it("prunes expired keys so a long service cannot grow it unbounded", () => {
    let clock = 0;
    const shouldEmit = createFactDeduper({ windowMs: 100, now: () => clock });
    for (let i = 0; i < 500; i += 1) {
      clock += 10;
      shouldEmit("svc", { ...fact, payload: { seatId: i } });
    }
    // Everything older than the window has been swept on the way — re-emitting
    // an early key is allowed again, proving it was pruned, not remembered.
    expect(shouldEmit("svc", { ...fact, payload: { seatId: 0 } })).toBe(true);
  });
});
