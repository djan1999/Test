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
});
