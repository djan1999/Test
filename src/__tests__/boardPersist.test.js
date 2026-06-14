import { describe, it, expect } from "vitest";
import { planBoardWrites } from "../utils/boardPersist.js";
import { blankTable, makeSeats, sanitizeTable } from "../utils/tableHelpers.js";

const J = (t) => JSON.stringify(sanitizeTable(t));

// A table holding live service work (seated + a drink on a seat).
const liveTable = (id) => ({
  ...blankTable(id), active: true, arrivedAt: "20:10",
  seats: makeSeats(2).map((s, i) => i === 0 ? { ...s, pairing: "Wine", glasses: [{ name: "Rebula" }] } : s),
});

describe("planBoardWrites — board wipe guard", () => {
  it("blocks a mass wipe: 2+ live tables blanked in one tick with no explicit clear", () => {
    const prev = [liveTable(1), liveTable(2), blankTable(3)];
    const next = [blankTable(1), blankTable(2), blankTable(3)]; // tables 1&2 wiped
    const plan = planBoardWrites({
      prevJson: prev.map(J), nextTables: next, nextJson: next.map(J),
      intentionalEmpty: new Set(),
    });
    expect(plan.blocked.sort()).toEqual([1, 2]);
    expect(plan.writes).toHaveLength(0);
    // baseline keeps the wiped tables dirty (= their previous good JSON)
    expect(plan.baseline[0]).toBe(J(prev[0]));
    expect(plan.baseline[1]).toBe(J(prev[1]));
  });

  it("allows the same mass clear when the user explicitly emptied them (clear all / archive)", () => {
    const prev = [liveTable(1), liveTable(2)];
    const next = [blankTable(1), blankTable(2)];
    const plan = planBoardWrites({
      prevJson: prev.map(J), nextTables: next, nextJson: next.map(J),
      intentionalEmpty: new Set([1, 2]),
    });
    expect(plan.blocked).toHaveLength(0);
    expect(plan.writes.map(t => t.id).sort()).toEqual([1, 2]);
  });

  it("never blocks a single-table clear (not catastrophic, likely a real clear)", () => {
    const prev = [liveTable(1), liveTable(2)];
    const next = [blankTable(1), liveTable(2)]; // only table 1 cleared
    const plan = planBoardWrites({
      prevJson: prev.map(J), nextTables: next, nextJson: next.map(J),
      intentionalEmpty: new Set(),
    });
    expect(plan.blocked).toHaveLength(0);
    expect(plan.writes.map(t => t.id)).toEqual([1]);
  });

  it("does not treat reservation metadata as live content (a reserved table can still update)", () => {
    // prev: two tables carrying only reservation metadata (name/time), no seats entered
    const reservedA = { ...blankTable(1), resName: "Smith", resTime: "19:00" };
    const reservedB = { ...blankTable(2), resName: "Jones", resTime: "19:30" };
    const prev = [reservedA, reservedB];
    const next = [blankTable(1), blankTable(2)]; // ghost-cleared after reservations deleted
    const plan = planBoardWrites({
      prevJson: prev.map(J), nextTables: next, nextJson: next.map(J),
      intentionalEmpty: new Set(),
    });
    // Not destructive (no staff content was lost) → allowed, no block.
    expect(plan.blocked).toHaveLength(0);
    expect(plan.writes.map(t => t.id).sort()).toEqual([1, 2]);
  });

  it("passes through normal edits (adding a drink) untouched", () => {
    const prev = [liveTable(1)];
    const edited = { ...liveTable(1) };
    edited.seats = edited.seats.map((s, i) => i === 1 ? { ...s, water: "Sparkling" } : s);
    const plan = planBoardWrites({
      prevJson: prev.map(J), nextTables: [edited], nextJson: [J(edited)],
      intentionalEmpty: new Set(),
    });
    expect(plan.blocked).toHaveLength(0);
    expect(plan.writes).toHaveLength(1);
    expect(plan.baseline[0]).toBe(J(edited));
  });
});
