// The logbook's first domain (Phase 1, docs/EVENT_LOG_PLAN.md): kitchen FACTS
// derived from the autosave's before/after diff. Pure-function pins.

import { describe, it, expect } from "vitest";
import { kitchenFactsFromDiff, kitchenFactKey } from "../utils/kitchenFacts.js";

const table = (id, kitchenLog) => ({ id, kitchenLog });

describe("kitchenFactsFromDiff", () => {
  it("a new fire is a course_fired fact", () => {
    const facts = kitchenFactsFromDiff(
      table(3, {}),
      table(3, { c2: { firedAt: "19:55" } }),
    );
    expect(facts).toEqual([
      { type: "course_fired", tableId: 3, payload: { courseKey: "c2", firedAt: "19:55" } },
    ]);
  });

  it("a re-fire (changed firedAt) is a NEW fact — the old fire stays true forever", () => {
    const facts = kitchenFactsFromDiff(
      table(3, { c2: { firedAt: "19:55" } }),
      table(3, { c2: { firedAt: "20:10" } }),
    );
    expect(facts).toEqual([
      { type: "course_fired", tableId: 3, payload: { courseKey: "c2", firedAt: "20:10" } },
    ]);
  });

  it("a disappeared fire is a course_unfired fact (un-fire, CLEAR, unseat)", () => {
    const facts = kitchenFactsFromDiff(
      table(3, { c1: { firedAt: "19:10" }, c2: { firedAt: "19:55" } }),
      table(3, { c1: { firedAt: "19:10" } }),
    );
    expect(facts).toEqual([
      { type: "course_unfired", tableId: 3, payload: { courseKey: "c2", wasFiredAt: "19:55" } },
    ]);
  });

  it("an unrelated change emits nothing", () => {
    expect(kitchenFactsFromDiff(
      { id: 3, notes: "a", kitchenLog: { c1: { firedAt: "19:10" } } },
      { id: 3, notes: "b", kitchenLog: { c1: { firedAt: "19:10" } } },
    )).toEqual([]);
  });

  it("a fresh table (no previous row) emits its fires", () => {
    const facts = kitchenFactsFromDiff(null, table(7, { c1: { firedAt: "19:10" } }));
    expect(facts).toEqual([
      { type: "course_fired", tableId: 7, payload: { courseKey: "c1", firedAt: "19:10" } },
    ]);
  });

  it("un-fired placeholders (no firedAt) are not fires in either direction", () => {
    expect(kitchenFactsFromDiff(
      table(3, { c1: {} }),
      table(3, { c1: {}, c2: { note: "held" } }),
    )).toEqual([]);
  });

  it("malformed logs are treated as empty, never thrown on", () => {
    expect(kitchenFactsFromDiff({ id: 3, kitchenLog: "garbage" }, table(3, {}))).toEqual([]);
    expect(kitchenFactsFromDiff(undefined, { id: "x" })).toEqual([]);
  });
});

describe("kitchenFactKey", () => {
  it("one key per transition — an adopt-fold re-diff of the same fire dedupes", () => {
    const fire = { type: "course_fired", tableId: 3, payload: { courseKey: "c2", firedAt: "19:55" } };
    expect(kitchenFactKey("svc-1", fire)).toBe(kitchenFactKey("svc-1", { ...fire }));
    // …but a re-fire at a new time, an un-fire, another table, or another
    // service are all DIFFERENT facts.
    expect(kitchenFactKey("svc-1", fire)).not.toBe(
      kitchenFactKey("svc-1", { ...fire, payload: { courseKey: "c2", firedAt: "20:10" } }),
    );
    expect(kitchenFactKey("svc-1", fire)).not.toBe(
      kitchenFactKey("svc-1", { type: "course_unfired", tableId: 3, payload: { courseKey: "c2", wasFiredAt: "19:55" } }),
    );
    expect(kitchenFactKey("svc-1", fire)).not.toBe(kitchenFactKey("svc-2", fire));
  });
});
