// Left / right hand on a seat — set beside Mr/Mrs on the board card, carried
// through the seat sanitiser, and marked LH on the floor map's chair pill.
import { describe, it, expect } from "vitest";
import { makeSeats } from "../utils/tableHelpers.js";

describe("seat hand", () => {
  it("keeps L / R and drops anything else", () => {
    const seats = makeSeats(3, [{ id: 1, hand: "L" }, { id: 2, hand: "R" }, { id: 3, hand: "left" }]);
    expect(seats.map(s => s.hand)).toEqual(["L", "R", null]);
  });

  it("defaults to null on a fresh seat", () => {
    expect(makeSeats(1)[0].hand).toBeNull();
  });
});
