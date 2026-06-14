import { describe, it, expect } from "vitest";
import { mergeTable } from "../utils/tableMerge.js";
import { blankTable, makeSeats, sanitizeTable } from "../utils/tableHelpers.js";

// A seated 2-top, no orders yet — the common ancestor.
const base = () => sanitizeTable({
  ...blankTable(5), active: true, arrivedAt: "20:00", guests: 2, resName: "Smith",
  seats: makeSeats(2),
});

const withSeat = (tbl, seatId, patch) => sanitizeTable({
  ...tbl,
  seats: tbl.seats.map((s) => s.id === seatId ? { ...s, ...patch } : s),
});

describe("mergeTable — 3-way concurrent-edit merge", () => {
  it("keeps both edits when two devices change DIFFERENT seats of the same table", () => {
    const ancestor = base();
    const mine   = withSeat(ancestor, 1, { pairing: "Wine", glasses: [{ name: "Rebula" }] });
    const theirs = withSeat(ancestor, 2, { water: "Sparkling" });
    const merged = mergeTable(ancestor, mine, theirs);
    expect(merged.seats.find((s) => s.id === 1).pairing).toBe("Wine");
    expect(merged.seats.find((s) => s.id === 1).glasses).toEqual([{ name: "Rebula" }]);
    expect(merged.seats.find((s) => s.id === 2).water).toBe("Sparkling");
  });

  it("takes the remote value for a field this device did not touch", () => {
    const ancestor = base();
    const mine   = withSeat(ancestor, 1, { pairing: "Wine" }); // I only touched seat 1's pairing
    const theirs = sanitizeTable({ ...ancestor, pace: "Slow", notes: "VIP" }); // they set pace + notes
    const merged = mergeTable(ancestor, mine, theirs);
    expect(merged.pace).toBe("Slow");
    expect(merged.notes).toBe("VIP");
    expect(merged.seats.find((s) => s.id === 1).pairing).toBe("Wine");
  });

  it("merges the kitchen log per course: kitchen fires while service adds a drink", () => {
    const ancestor = base();
    const mine   = withSeat(ancestor, 1, { glasses: [{ name: "GV" }] });        // service: drink on seat 1
    const theirs = sanitizeTable({ ...ancestor, kitchenLog: { amuse: { firedAt: "20:30" } } }); // kitchen fires
    const merged = mergeTable(ancestor, mine, theirs);
    expect(merged.kitchenLog.amuse).toEqual({ firedAt: "20:30" });
    expect(merged.seats.find((s) => s.id === 1).glasses).toEqual([{ name: "GV" }]);
  });

  it("my change wins over a concurrent remote change to the SAME field", () => {
    const ancestor = base();
    const mine   = sanitizeTable({ ...ancestor, pace: "Fast" });
    const theirs = sanitizeTable({ ...ancestor, pace: "Slow" });
    expect(mergeTable(ancestor, mine, theirs).pace).toBe("Fast");
  });

  it("a guest-count increase keeps the new seat and its data", () => {
    const ancestor = base();
    const grown = sanitizeTable({ ...ancestor, guests: 3 });
    const mine = withSeat(grown, 3, { pairing: "Non-Alc" });
    const theirs = base(); // remote still has 2
    const merged = mergeTable(ancestor, mine, theirs);
    expect(merged.guests).toBe(3);
    expect(merged.seats).toHaveLength(3);
    expect(merged.seats.find((s) => s.id === 3).pairing).toBe("Non-Alc");
  });

  it("no local change → result equals the remote state (clean fast path)", () => {
    const ancestor = base();
    const theirs = withSeat(ancestor, 2, { water: "Still" });
    const merged = mergeTable(ancestor, ancestor, theirs);
    expect(JSON.stringify(merged)).toBe(JSON.stringify(sanitizeTable(theirs)));
  });
});
