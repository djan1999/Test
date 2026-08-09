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
  if (next.active) gestures.push("unseat", "resize", "rename", "retime", "water", "pairing", "drinkAdd", "fire", "extra", "option", "bottleAdd");
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
  it("holds across 150 random nights through the FULL pipeline: deriver, deduper (with adopt-fold re-diff noise), reducer", () => {
    for (let seedIndex = 0; seedIndex < 150; seedIndex += 1) {
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
    expect(result).toEqual({ compared: 0, matches: 0, divergent: [] });
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
    expect(report.parity).toEqual({ events: 2, compared: 1, matches: 1, divergentTables: [] });
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
