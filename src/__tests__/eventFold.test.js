// THE FOLD's contract (docs/EVENT_LOG_PLAN.md, Phases 3–4), pinned without
// waiting for a restaurant: REPLAY PARITY. Random service nights are played
// against card tables; every step's facts come from the REAL production
// deriver (boardFactsFromDiff), the facts are folded by the REAL production
// reducer (foldServiceEvents), and the fold must equal the final board's
// comparable projection — every table, every seat, every drink, every fire.
// This is the property the Phase-4 flip stands on.

import { describe, it, expect } from "vitest";
import { boardFactsFromDiff, createFactDeduper } from "../utils/boardFacts.js";
import {
  foldServiceEvents, boardProjection, compareFoldToBoard, describeServiceEvent, serviceNightReport,
} from "../utils/eventFold.js";

// Deterministic LCG so a failure names its seed and replays exactly.
const rng = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
};
const pick = (random, list) => list[Math.floor(random() * list.length)];

const NAMES = ["Anna", "Bruno", "Cilka", "Davor"];
const DRINKS = ["Negroni", "Union", "Dry Martini", "Brut Nature"];
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

// Apply one random gesture to a card table, the way the app's updaters do
// (seats kept on resize, truncation drops the tail). Returns the next table.
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
    case "unseat":
      return blankCard(next.id);
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
      s[category].push({ name }, { name });
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

describe("REPLAY PARITY — fold(dedup(facts(night))) === board(night)", () => {
  it("holds across 300 random nights through the FULL pipeline: deriver, deduper (with adopt-fold re-diff noise), reducer", () => {
    for (let seedIndex = 0; seedIndex < 300; seedIndex += 1) {
      const random = rng(1000 + seedIndex * 7919);
      const tableIds = [1, 2, 3];
      const cards = new Map(tableIds.map((id) => [id, blankCard(id)]));
      const events = [];
      // The production deduper runs in the loop, on a jittered clock, so
      // genuine repeats land INSIDE its window all the time — exactly the
      // regime where the old identity+window design silently lost facts.
      let clockMs = 0;
      const shouldEmit = createFactDeduper({ now: () => clockMs });
      const emit = (before, after) => {
        for (const fact of boardFactsFromDiff(before, after)) {
          if (!shouldEmit("svc", fact)) continue;
          events.push({ type: fact.type, table_id: fact.tableId, payload: fact.payload });
        }
      };
      const steps = 10 + Math.floor(random() * 40);
      for (let step = 0; step < steps; step += 1) {
        clockMs += Math.floor(random() * 30000);
        const tableId = pick(random, tableIds);
        const before = cards.get(tableId);
        const after = applyRandomGesture(random, before);
        emit(before, after);
        cards.set(tableId, after);
        // Adopt-fold re-diff: the same transition re-surfaces moments later.
        // The deduper must absorb it — and even if it ever did not, snapshot
        // facts make the replay harmless. Either way parity must hold.
        if (random() < 0.35) {
          clockMs += 1 + Math.floor(random() * 3000);
          emit(before, after);
        }
      }
      const folded = foldServiceEvents(events);
      const { compared, divergent } = compareFoldToBoard(folded, [...cards.values()]);
      expect(
        divergent,
        `seed ${1000 + seedIndex * 7919}: ${divergent.map((d) => `T${d.tableId}\n log:${d.fromLog}\n brd:${d.fromBoard}`).join("\n")}`,
      ).toEqual([]);
      void compared;
    }
  });
});

describe("compareFoldToBoard", () => {
  it("detects a genuine divergence and names the table", () => {
    const card = { ...blankCard(3), active: true, guests: 2, seats: [{ ...blankSeat(1), water: "STILL" }] };
    const events = [
      { type: "party_seated", table_id: 3, payload: { resName: "Anna", guests: 2, arrivedAt: "19:00" } },
      { type: "seat_water_set", table_id: 3, payload: { seatId: 1, from: "—", to: "SPARKLING" } }, // board says STILL
    ];
    const result = compareFoldToBoard(foldServiceEvents(events), [card]);
    expect(result.divergent.map((d) => d.tableId)).toEqual([3]);
    expect(result.compared).toBe(1);
  });

  it("blank tables and empty scaffolds are never divergence", () => {
    const result = compareFoldToBoard(foldServiceEvents([]), [blankCard(1), blankCard(2)]);
    expect(result).toEqual({ compared: 0, matches: 0, divergent: [], contentLoss: [], tiebreaks: [] });
  });

  it("descriptive fields are full-fidelity: a rename that never reached the log is divergence", () => {
    const card = { ...blankCard(3), active: true, guests: 2, resName: "Renamed Later", arrivedAt: "21:00", seats: [] };
    const seatedOnly = [
      { type: "party_seated", table_id: 3, payload: { resName: "Anna", guests: 2, arrivedAt: "19:00" } },
    ];
    expect(compareFoldToBoard(foldServiceEvents(seatedOnly), [card]).divergent.map((d) => d.tableId)).toEqual([3]);
    const withFacts = [
      ...seatedOnly,
      { type: "party_renamed", table_id: 3, payload: { resName: "Renamed Later" } },
      { type: "party_arrival_set", table_id: 3, payload: { from: "19:00", to: "21:00" } },
    ];
    expect(compareFoldToBoard(foldServiceEvents(withFacts), [card]).divergent).toEqual([]);
  });
});

describe("restrictions — the ALLERGY data the fold must carry", () => {
  // Measured against the real 12.08 service: every table carried
  // `restrictions` (Seanna Markham's "pescetarian" at P1), and the log had
  // never recorded them. A flip in that state would have taken allergies off
  // a live board — which is why they had to join the taxonomy first.
  const seanna = { pos: 1, note: "pescetarian", kitchenAdded: true };

  it("a restriction appearing is a fact, and the fold rebuilds it", () => {
    const before = { ...blankCard(6), active: true, resName: "Seanna Markham", guests: 2 };
    const after = { ...before, restrictions: [seanna] };
    const facts = boardFactsFromDiff(before, after);
    expect(facts).toEqual([{
      type: "table_restrictions_set", tableId: 6,
      // resName rides along so the DB's guest erasure (which matches
      // payload->>'resName' and blanks restrictions in the same pass) covers it.
      payload: {
        resName: "Seanna Markham",
        restrictions: [{ note: "pescetarian", pos: 1, detail: "", kitchenAdded: true }],
      },
    }]);
    const folded = foldServiceEvents(facts.map((f) => ({ type: f.type, table_id: f.tableId, payload: f.payload })));
    expect(folded.get(6).restrictions).toEqual([{ note: "pescetarian", pos: 1, detail: "", kitchenAdded: true }]);
  });

  it("PARITY now compares restrictions — a board allergy missing from the log is CONTENT LOSS", () => {
    const board = {
      ...blankCard(6), active: true, resName: "Seanna Markham", guests: 2,
      seats: [blankSeat(1), blankSeat(2)], restrictions: [seanna],
    };
    const logWithout = [
      { type: "party_seated", table_id: 6, payload: { resName: "Seanna Markham", guests: 2 } },
    ];
    const missed = compareFoldToBoard(foldServiceEvents(logWithout), [board]);
    expect(missed.contentLoss).toEqual([6]);   // an allergy is never a tiebreak
    expect(missed.tiebreaks).toEqual([]);

    const logWith = [
      ...logWithout,
      { type: "table_restrictions_set", table_id: 6, payload: { resName: "Seanna Markham", restrictions: [seanna] } },
    ];
    expect(compareFoldToBoard(foldServiceEvents(logWith), [board]).divergent).toEqual([]);
  });

  it("re-ordering the same restrictions is not a change (no fact churn)", () => {
    const a = { ...blankCard(2), active: true, restrictions: [{ note: "nuts", pos: 1 }, { note: "gluten", pos: 2 }] };
    const b = { ...a, restrictions: [{ note: "gluten", pos: 2 }, { note: "nuts", pos: 1 }] };
    expect(boardFactsFromDiff(a, b)).toEqual([]);
  });

  it("clearing a restriction records it, and the fold clears too", () => {
    const withR = { ...blankCard(6), active: true, restrictions: [seanna] };
    const without = { ...withR, restrictions: [] };
    const facts = boardFactsFromDiff(withR, without);
    expect(facts[0]).toMatchObject({ type: "table_restrictions_set", payload: { restrictions: [] } });
  });
});

describe("kitchen state, staff notes and seat genders — the rest of the coverage gap", () => {
  const asEvents = (facts) => facts.map((f) => ({ type: f.type, table_id: f.tableId, payload: f.payload }));

  it("the SET banner, sent/alert/archived flags and pace round-trip through the log", () => {
    const before = { ...blankCard(4), active: true, guests: 2 };
    const after = {
      ...before,
      courseReady: { key: "c2", index: 2, name: "Kaviar" },
      kitchenSent: true, kitchenAlert: "late", kitchenArchived: true, pace: "slow",
    };
    const facts = boardFactsFromDiff(before, after);
    expect(facts.map((f) => f.type)).toEqual(["table_service_state_set"]);
    const folded = foldServiceEvents(asEvents(facts));
    expect(folded.get(4).serviceState).toEqual({
      courseReady: { key: "c2", index: 2, name: "Kaviar" },
      kitchenSent: true, kitchenAlert: "late", kitchenArchived: true, pace: "slow",
    });
    // Folded from the table's WHOLE history (seating included), the log
    // rebuilds the board exactly — that is what parity has to mean.
    const whole = asEvents(boardFactsFromDiff(blankCard(4), after));
    expect(compareFoldToBoard(foldServiceEvents(whole), [after]).divergent).toEqual([]);
  });

  it("staff notes round-trip, and a note the log never saw is CONTENT LOSS", () => {
    const board = {
      ...blankCard(5), active: true, guests: 2, seats: [blankSeat(1)],
      notes: "birthday cake at dessert",
      kitchenCourseNotes: { c3: "no butter" },
    };
    const bare = [{ type: "party_seated", table_id: 5, payload: { resName: "", guests: 2 } }];
    const missed = compareFoldToBoard(foldServiceEvents(bare), [board]);
    expect(missed.contentLoss).toEqual([5]);   // typed work is never a tiebreak
    expect(missed.tiebreaks).toEqual([]);

    const withNotes = [...bare, ...asEvents(boardFactsFromDiff({ ...board, notes: "", kitchenCourseNotes: {} }, board))];
    expect(compareFoldToBoard(foldServiceEvents(withNotes), [board]).divergent).toEqual([]);
  });

  it("seat gender is recorded per seat and rebuilt", () => {
    const before = { ...blankCard(6), active: true, guests: 2, seats: [blankSeat(1), blankSeat(2)] };
    const after = { ...before, seats: [{ ...blankSeat(1), gender: "Mrs" }, blankSeat(2)] };
    const facts = boardFactsFromDiff(before, after);
    expect(facts).toEqual([{ type: "seat_gender_set", tableId: 6, payload: { seatId: 1, to: "Mrs" } }]);
    const folded = foldServiceEvents(asEvents(facts));
    expect(folded.get(6).seats["1"].gender).toBe("Mrs");
    const whole = asEvents(boardFactsFromDiff(blankCard(6), after));
    expect(compareFoldToBoard(foldServiceEvents(whole), [after]).divergent).toEqual([]);
  });

  it("no change in any of them emits nothing (no fact churn on every autosave)", () => {
    const t = {
      ...blankCard(7), active: true, guests: 2, notes: "x",
      kitchenCourseNotes: { c1: "y" }, pace: "fast", kitchenArchived: true,
      seats: [{ ...blankSeat(1), gender: "Mr" }],
    };
    expect(boardFactsFromDiff(t, { ...t })).toEqual([]);
  });
});

describe("content-loss vs concurrent-tiebreak — the wipe/scribble distinction", () => {
  // The real 09/10.08 three-device conflict on table 7 seat 1: the board's
  // compare-and-swap crowned water XC + aperitif "Le Terroir"; the log's
  // server-order fold crowns water XW + aperitif "So Fresh". BOTH sides keep a
  // coherent, worked seat 1 — nobody lost a table. That is a TIEBREAK.
  it("classifies the real seat-1 conflict as a concurrent-tiebreak, never content-loss", () => {
    const board = {
      ...blankCard(7), active: true, resName: "gay", guests: 2,
      seats: [{ ...blankSeat(1), water: "XC", pairing: "Wine", aperitifs: [{ name: "Le Terroir" }] }, blankSeat(2)],
    };
    const events = [
      { type: "party_seated", table_id: 7, payload: { resName: "gay", guests: 2, arrivedAt: "12:08" } },
      { type: "seat_water_set", table_id: 7, payload: { seatId: 1, to: "XW" } },
      { type: "seat_pairing_set", table_id: 7, payload: { seatId: 1, to: "Wine" } },
      { type: "seat_drinks_set", table_id: 7, payload: { seatId: 1, category: "aperitifs", drinks: { "So Fresh": 1 } } },
    ];
    const result = compareFoldToBoard(foldServiceEvents(events), [board]);
    expect(result.contentLoss).toEqual([]);      // NOTHING lost
    expect(result.tiebreaks).toEqual([7]);        // just a contested value
    expect(result.divergent[0].kind).toBe("concurrent-tiebreak");
  });

  it("classifies a wiped table (worked in log, blank on board) as CONTENT LOSS", () => {
    const events = [
      { type: "party_seated", table_id: 5, payload: { resName: "Anna", guests: 2, arrivedAt: "19:00" } },
      { type: "seat_water_set", table_id: 5, payload: { seatId: 1, to: "STILL" } },
    ];
    const board = [blankCard(5)]; // the board lost the party entirely — the wipe
    const result = compareFoldToBoard(foldServiceEvents(events), board);
    expect(result.contentLoss).toEqual([5]);
    expect(result.tiebreaks).toEqual([]);
    expect(result.divergent[0].kind).toBe("content-loss");
  });

  it("a worked seat vanishing while the party stays is still CONTENT LOSS", () => {
    // Same active party on both sides, but the board dropped seat 2's content.
    const board = {
      ...blankCard(4), active: true, resName: "Bruno", guests: 2,
      seats: [{ ...blankSeat(1), water: "STILL" }, blankSeat(2)],
    };
    const events = [
      { type: "party_seated", table_id: 4, payload: { resName: "Bruno", guests: 2 } },
      { type: "seat_water_set", table_id: 4, payload: { seatId: 1, to: "STILL" } },
      { type: "seat_drinks_set", table_id: 4, payload: { seatId: 2, category: "beers", drinks: { Union: 1 } } },
    ];
    const result = compareFoldToBoard(foldServiceEvents(events), [board]);
    expect(result.contentLoss).toEqual([4]); // seat 2 worked in log, absent on board
    expect(result.tiebreaks).toEqual([]);
  });
});

describe("foldServiceEvents resilience", () => {
  it("unknown event types, junk payloads and missing tables fold as no-ops", () => {
    const folded = foldServiceEvents([
      { type: "from_the_future", table_id: 1, payload: { anything: true } },
      { type: "drink_removed", table_id: 1, payload: { seatId: 9, category: "cocktails", name: "Ghost" } },
      { type: "course_unfired", table_id: 2, payload: { courseKey: "never-fired" } },
      { type: "drink_added", table_id: 1, payload: { seatId: 1, category: "not-a-category", name: "X" } },
      { type: "seat_drinks_set", table_id: 1, payload: { seatId: 1, category: "cocktails", drinks: { Bad: "NaN", Neg: -3 } } },
      { type: "table_bottles_set", table_id: 2, payload: { bottles: "junk" } },
      null,
      { type: "party_seated", payload: {} }, // no table
    ]);
    expect(compareFoldToBoard(folded, []).divergent).toEqual([]);
  });

  it("legacy delta facts recorded before snapshots (09.08) still fold correctly", () => {
    const card = {
      ...blankCard(1), active: true, resName: "Anna", guests: 2,
      seats: [{ ...blankSeat(1), cocktails: [{ name: "Negroni" }] }],
    };
    const events = [
      { type: "party_seated", table_id: 1, payload: { resName: "Anna", guests: 2, arrivedAt: null } },
      { type: "drink_added", table_id: 1, payload: { seatId: 1, category: "cocktails", name: "Negroni" } },
      { type: "drink_added", table_id: 1, payload: { seatId: 1, category: "cocktails", name: "Union" } },
      { type: "drink_removed", table_id: 1, payload: { seatId: 1, category: "cocktails", name: "Union" } },
      { type: "bottle_added", table_id: 1, payload: { name: "Rebula 2019" } },
      { type: "bottle_removed", table_id: 1, payload: { name: "Rebula 2019" } },
    ];
    expect(compareFoldToBoard(foldServiceEvents(events), [card]).divergent).toEqual([]);
  });
});

describe("serviceNightReport — the archived night from the log", () => {
  it("tells the story and grades the night against the archived board", () => {
    const events = [
      { id: 11, device_id: "device-aa-bb", type: "party_seated", table_id: 1, client_ts: "2026-08-09T19:00:00", payload: { resName: "Anna", guests: 2, arrivedAt: "19:00" } },
      { id: 12, device_id: "device-aa-bb", type: "course_fired", table_id: 1, payload: { courseKey: "c1", firedAt: "19:20" } },
    ];
    const board = [{
      ...blankCard(1), active: true, resName: "Anna", guests: 2, arrivedAt: "19:00",
      kitchenLog: { c1: { firedAt: "19:20" } },
    }];
    const report = serviceNightReport(events, board);
    expect(report.story).toHaveLength(2);
    expect(report.story[0]).toMatchObject({ id: 11, device: "device-a" });
    expect(report.story[0].line).toContain("Anna, party of 2 seated");
    expect(report.parity).toEqual({ events: 2, compared: 1, matches: 1, divergentTables: [], contentLoss: [], tiebreaks: [] });
  });

  it("a night the logbook did not record is NOT graded (parity null, never falsely red)", () => {
    const board = [{ ...blankCard(1), active: true, resName: "Anna", guests: 4, seats: [] }];
    expect(serviceNightReport([], board)).toEqual({ story: [], parity: null });
  });

  it("a divergent night names its tables", () => {
    const events = [
      { id: 1, type: "party_seated", table_id: 2, payload: { resName: "Bruno", guests: 3 } },
    ];
    const board = [{ ...blankCard(2), active: true, resName: "Bruno", guests: 5, seats: [] }];
    expect(serviceNightReport(events, board).parity.divergentTables).toEqual([2]);
  });
});

describe("describeServiceEvent", () => {
  it("tells the night in sentences", () => {
    expect(describeServiceEvent({
      type: "party_seated", table_id: 3, client_ts: "2026-08-09T19:42:00",
      payload: { resName: "Anna", guests: 4 },
    })).toContain("Anna, party of 4 seated");
    expect(describeServiceEvent({
      type: "course_fired", table_id: 3, payload: { courseKey: "c2", firedAt: "19:55" },
    })).toContain("FIRE c2");
  });
});
