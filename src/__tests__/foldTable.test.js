import { describe, it, expect } from "vitest";
import { foldTable } from "../utils/foldTable.js";

const seat = (id, over = {}) => ({
  id, water: "—", pairing: "—", aperitifs: [], glasses: [], cocktails: [],
  spirits: [], beers: [], extras: {}, optionalPairings: {}, ...over,
});

const table = (over = {}) => ({
  id: 3, guests: 4, active: true, arrivedAt: "18:30", resName: "Kovač",
  notes: "", menuType: "long",
  seats: [seat(1), seat(2), seat(3), seat(4)],
  ...over,
});

describe("foldTable — two waiters, one table", () => {
  it("edits to DIFFERENT seats both survive", () => {
    const ancestor = table();
    const mine = table({ seats: [seat(1, { water: "Sparkling" }), seat(2), seat(3), seat(4)] });
    const theirs = table({ seats: [seat(1), seat(2, { pairing: "Wine" }), seat(3), seat(4)] });
    const folded = foldTable(ancestor, mine, theirs);
    expect(folded.seats[0].water).toBe("Sparkling"); // my edit kept
    expect(folded.seats[1].pairing).toBe("Wine");    // their edit adopted
  });

  it("a genuine same-seat conflict resolves to the local edit", () => {
    const ancestor = table();
    const mine = table({ seats: [seat(1, { water: "Sparkling" }), seat(2), seat(3), seat(4)] });
    const theirs = table({ seats: [seat(1, { water: "Still" }), seat(2), seat(3), seat(4)] });
    const folded = foldTable(ancestor, mine, theirs);
    expect(folded.seats[0].water).toBe("Sparkling");
  });

  it("top-level fields fold independently of seats", () => {
    const ancestor = table();
    const mine = table({ notes: "VIP" });
    const theirs = table({ menuType: "short" });
    const folded = foldTable(ancestor, mine, theirs);
    expect(folded.notes).toBe("VIP");
    expect(folded.menuType).toBe("short");
  });

  it("their added seat (guest joined) survives my unrelated edit", () => {
    const ancestor = table({ guests: 4 });
    const mine = table({ guests: 4, seats: [seat(1, { water: "Sparkling" }), seat(2), seat(3), seat(4)] });
    const theirs = table({ guests: 5, seats: [seat(1), seat(2), seat(3), seat(4), seat(5, { water: "Still" })] });
    const folded = foldTable(ancestor, mine, theirs);
    expect(folded.guests).toBe(5);
    expect(folded.seats).toHaveLength(5);
    expect(folded.seats[0].water).toBe("Sparkling");
    expect(folded.seats[4].water).toBe("Still");
  });

  it("my seat removal (guest count reduced) wins over their untouched copy", () => {
    const ancestor = table({ guests: 4 });
    const mine = table({ guests: 3, seats: [seat(1), seat(2), seat(3)] });
    const theirs = table({ guests: 4, seats: [seat(1), seat(2), seat(3), seat(4)] });
    const folded = foldTable(ancestor, mine, theirs);
    expect(folded.guests).toBe(3);
    expect(folded.seats).toHaveLength(3);
  });

  it("their seat removal is adopted when I never touched that seat", () => {
    const ancestor = table({ guests: 4 });
    const mine = table({ guests: 4, seats: [seat(1, { water: "Sparkling" }), seat(2), seat(3), seat(4)] });
    const theirs = table({ guests: 3, seats: [seat(1), seat(2), seat(3)] });
    const folded = foldTable(ancestor, mine, theirs);
    expect(folded.seats).toHaveLength(3);
    expect(folded.seats[0].water).toBe("Sparkling");
  });

  it("with no ancestor, local edits are kept whole (no unsafe fold)", () => {
    const mine = table({ notes: "mine" });
    const theirs = table({ notes: "theirs" });
    expect(foldTable(null, mine, theirs)).toBe(mine);
  });
});
