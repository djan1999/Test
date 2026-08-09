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

  it("drinks are a multiset: a second Negroni is a second fact, removals are facts too", () => {
    const facts = boardFactsFromDiff(
      table({ seats: [seat(2, { cocktails: [{ name: "Negroni" }] })] }),
      table({ seats: [seat(2, { cocktails: [{ name: "Negroni" }, { name: "Negroni" }], spirits: [] })] }),
    );
    expect(facts).toEqual([
      { type: "drink_added", tableId: 3, payload: { seatId: 2, category: "cocktails", name: "Negroni" } },
    ]);
    const removals = boardFactsFromDiff(
      table({ seats: [seat(2, { beers: [{ name: "Union" }] })] }),
      table({ seats: [seat(2)] }),
    );
    expect(removals).toEqual([
      { type: "drink_removed", tableId: 3, payload: { seatId: 2, category: "beers", name: "Union" } },
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

  it("bottles are table-level facts", () => {
    expect(boardFactsFromDiff(
      table({ bottleWines: [] }),
      table({ bottleWines: [{ name: "Rebula 2019" }] }),
    )).toEqual([
      { type: "bottle_added", tableId: 3, payload: { name: "Rebula 2019" } },
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

describe("createFactDeduper", () => {
  const fact = { type: "seat_water_set", tableId: 3, payload: { seatId: 1, from: "—", to: "STILL" } };

  it("absorbs an identical fact inside the window (the adopt-fold re-diff)", () => {
    let clock = 1000;
    const shouldEmit = createFactDeduper({ windowMs: 60000, now: () => clock });
    expect(shouldEmit("svc", fact)).toBe(true);
    clock += 500; // the fold bounce, moments later
    expect(shouldEmit("svc", fact)).toBe(false);
  });

  it("a genuine later repeat records again, and different facts never collide", () => {
    let clock = 1000;
    const shouldEmit = createFactDeduper({ windowMs: 60000, now: () => clock });
    expect(shouldEmit("svc", fact)).toBe(true);
    clock += 61000; // next round of the same transition, well past the window
    expect(shouldEmit("svc", fact)).toBe(true);
    expect(shouldEmit("svc", { ...fact, payload: { ...fact.payload, seatId: 2 } })).toBe(true);
    expect(shouldEmit("other-svc", fact)).toBe(true);
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
