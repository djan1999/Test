import { describe, it, expect } from "vitest";
import { reconcileTables } from "../utils/reconcile.js";
import { blankTable, sanitizeTable, makeSeats } from "../utils/tableHelpers.js";

const board = (overrides = {}) => Array.from({ length: 4 }, (_, i) => {
  const id = i + 1;
  return sanitizeTable(overrides[id] ? { ...blankTable(id), ...overrides[id] } : blankTable(id));
});

const resv = (table_id, data) => ({ table_id, data });

describe("reconcileTables — non-destructive reservation templating", () => {
  it("templates a blank table from its reservation (name, time, guests, seats)", () => {
    const prev = board();
    const next = reconcileTables(prev, [resv(1, { resName: "Smith", resTime: "19:00", guests: 4 })]);
    const t1 = next.find((t) => t.id === 1);
    expect(t1.resName).toBe("Smith");
    expect(t1.resTime).toBe("19:00");
    expect(t1.guests).toBe(4);
    expect(t1.seats).toHaveLength(4);
  });

  it("preserves board-assigned restriction seat positions across a reconcile", () => {
    // Reserved (not yet seated) table where a server assigned vegetarian to P1/P2.
    // The reservation carries the same two veg restrictions but no positions.
    const prev = board({
      1: { resName: "Smith", resTime: "19:00", guests: 2,
           restrictions: [{ note: "vegetarian", pos: 1 }, { note: "vegetarian", pos: 2 }] },
    });
    const next = reconcileTables(prev, [resv(1, {
      resName: "Smith", resTime: "19:00", guests: 2,
      restrictions: [{ note: "vegetarian", pos: null }, { note: "vegetarian", pos: null }],
    })]);
    const t1 = next.find((t) => t.id === 1);
    expect(t1.restrictions).toEqual([
      { note: "vegetarian", pos: 1 },
      { note: "vegetarian", pos: 2 },
    ]);
  });

  it("NEVER rebuilds a table that holds live service work", () => {
    const prev = board({
      2: { active: true, arrivedAt: "20:10", guests: 2,
           seats: makeSeats(2).map((s, i) => i === 0 ? { ...s, pairing: "Wine", glasses: [{ name: "GV" }] } : s) },
    });
    // a reservation now claims table 2 with different guests — must be ignored
    const next = reconcileTables(prev, [resv(2, { resName: "Other", guests: 6 })]);
    const t2 = next.find((t) => t.id === 2);
    expect(t2.active).toBe(true);
    expect(t2.guests).toBe(2);
    expect(t2.seats.find((s) => s.id === 1).glasses).toEqual([{ name: "GV" }]);
  });

  it("ghost-clears a reserved-but-unstarted table whose reservation went away", () => {
    const prev = board({ 3: { resName: "Gone", resTime: "19:30" } });
    const next = reconcileTables(prev, []); // no reservations
    expect(next.find((t) => t.id === 3).resName).toBe("");
  });

  it("HOTFIX REGRESSION: tableHasServiceContent survives point-free filter/some (index as 2nd arg)", async () => {
    const { tableHasServiceContent, blankTable: blank } = await import("../utils/tableHelpers.js");
    const tables = [
      { ...blank(1), seats: [{ id: 1, extras: { cake: { ordered: true } } }] },
      { ...blank(2), seats: [{ id: 1, extras: { cake: { ordered: true } } }] },
      { ...blank(3) },
    ];
    // filter passes (element, INDEX, array) — index 1+ landed in
    // ignoreExtraKeys and (1).includes crashed the app on 09.07.
    expect(() => tables.filter(tableHasServiceContent)).not.toThrow();
    expect(tables.filter(tableHasServiceContent)).toHaveLength(2);
  });

  it("REGRESSION (09.07): its own cake seeding never freezes a birthday table — a later combine re-templates it", () => {
    const celebration = ["cake"];
    // First template: solo birthday booking on T3 → every seat gains an
    // ordered celebration extra (seeded by the reconcile itself).
    const solo = reconcileTables(board(), [resv(3, {
      resName: "Kat", resTime: "18:30", guests: 4, birthday: true, tableGroup: [],
    })], celebration);
    expect(solo.find((t) => t.id === 3).seats.every((s) => s.extras?.cake?.ordered)).toBe(true);

    // The booking now combines onto T2+T3. Before the fix, T3 counted its own
    // seeded cake extras as staff work, froze, and kept the stale solo card.
    const combined = reconcileTables(solo, [resv(2, {
      resName: "Kat", resTime: "18:30", guests: 4, birthday: true, tableGroup: [2, 3],
    })], celebration);
    expect(combined.find((t) => t.id === 2).tableGroup).toEqual([2, 3]);
    expect(combined.find((t) => t.id === 3).tableGroup).toEqual([2, 3]);
    // The cake still fires: seeding survives the re-template.
    expect(combined.find((t) => t.id === 3).seats.every((s) => s.extras?.cake?.ordered)).toBe(true);

    // A seat with REAL staff work keeps freezing the table, cake or not.
    const withDrinks = combined.map((t) => (t.id === 2
      ? { ...t, seats: t.seats.map((s, i) => (i === 0 ? { ...s, glasses: [{ name: "GV" }] } : s)) }
      : t));
    const after = reconcileTables(withDrinks, [resv(2, {
      resName: "Kat", resTime: "18:30", guests: 2, birthday: true, tableGroup: [2],
    })], celebration);
    expect(after.find((t) => t.id === 2).guests).toBe(4); // untouched — staff drinks protect it
  });

  it("does NOT clear an unowned table that holds service work (no reservation)", () => {
    const prev = board({
      4: { seats: makeSeats(2).map((s, i) => i === 0 ? { ...s, water: "Sparkling" } : s) },
    });
    const next = reconcileTables(prev, []); // no reservation owns table 4
    expect(next.find((t) => t.id === 4).seats.find((s) => s.id === 1).water).toBe("Sparkling");
  });

  it("returns the same array reference when nothing changes (no needless re-render)", () => {
    const prev = board();
    expect(reconcileTables(prev, [])).toBe(prev);
  });

  it("stamps the full group onto every member of a multi-table reservation", () => {
    const prev = board();
    const next = reconcileTables(prev, [resv(1, { resName: "Party", guests: 6, tableGroup: [1, 2] })]);
    expect(next.find((t) => t.id === 1).tableGroup).toEqual([1, 2]);
    expect(next.find((t) => t.id === 2).tableGroup).toEqual([1, 2]);
  });

  it("seeds birthday extras on reconciled seats when celebration keys are given", () => {
    const prev = board();
    const next = reconcileTables(prev, [resv(1, { resName: "Bday", guests: 2, birthday: true })], ["cake"]);
    const seat = next.find((t) => t.id === 1).seats[0];
    expect(seat.extras.cake.ordered).toBe(true);
  });

  // Regression for the 04.07 duplication: a guest switched from T4 to T2 was
  // seated live on T2, but the stale reservation still pointed at T4, so
  // reconcile re-templated T4 and the guest showed on BOTH tables.
  it("does NOT re-template a vacated table for a guest already seated elsewhere", () => {
    const prev = board({
      2: { active: true, arrivedAt: "19:43", resName: "Ilya Ulyanov", resTime: "19:00", guests: 2,
           seats: makeSeats(2).map((s, i) => i === 0 ? { ...s, pairing: "Wine" } : s) },
    });
    // The reservation still points at the vacated table 4 (table_id lagged the move).
    const next = reconcileTables(prev, [resv(4, { resName: "Ilya Ulyanov", resTime: "19:00", guests: 2 })]);
    // T4 must stay blank — Ilya is already live on T2, not duplicated onto T4.
    expect(next.find((t) => t.id === 4).resName).toBe("");
    // T2 (the live seat) is untouched.
    expect(next.find((t) => t.id === 2).resName).toBe("Ilya Ulyanov");
    expect(next.find((t) => t.id === 2).seats.find((s) => s.id === 1).pairing).toBe("Wine");
  });

  it("still templates a genuinely different guest onto a free table", () => {
    // A guest seated on T2 must not suppress a DIFFERENT booking on T1.
    const prev = board({
      2: { active: true, arrivedAt: "19:43", resName: "Ilya Ulyanov", resTime: "19:00", guests: 2 },
    });
    const next = reconcileTables(prev, [
      resv(2, { resName: "Ilya Ulyanov", resTime: "19:00", guests: 2 }),
      resv(1, { resName: "Mary Brooks Smith", resTime: "19:30", guests: 2 }),
    ]);
    expect(next.find((t) => t.id === 1).resName).toBe("Mary Brooks Smith");
  });

  it("a multi-table group still seats every member even if one is already live", () => {
    // A real 2-table party (group length > 1) is exempt from the anti-duplicate
    // rule — the same name legitimately appears on all its tables.
    const prev = board({
      1: { active: true, arrivedAt: "19:43", resName: "Party", resTime: "19:00", guests: 6, tableGroup: [1, 2] },
    });
    const next = reconcileTables(prev, [resv(1, { resName: "Party", resTime: "19:00", guests: 6, tableGroup: [1, 2] })]);
    expect(next.find((t) => t.id === 2).resName).toBe("Party");
  });
});
