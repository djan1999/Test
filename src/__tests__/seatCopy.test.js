import { describe, it, expect } from "vitest";
import { copySeatOrderToAll, otherSeatsHaveOrders } from "../utils/seatCopy.js";

const seat = (id, extra = {}) => ({
  id, gender: null, hand: null, celebrating: false, pairingSharedWith: null, water: "—", pairing: "",
  pourMode: null, aperitifs: [], digestivos: [], glasses: [], cocktails: [], spirits: [], beers: [],
  extras: {}, optionalPairings: {}, floorPositions: {}, ...extra,
});

describe("SAME FOR ALL", () => {
  const p1 = seat(1, {
    gender: "Mrs", hand: "L", celebrating: true,
    water: "XC", pairing: "Wine",
    aperitifs: [{ name: "Harmonie", producer: "Nakada-Park" }],
    extras: { beetroot: { ordered: true, pairing: "Wine", sharedWith: [2] } },
    optionalPairings: { cheese_wine: { ordered: true } },
    floorPositions: { "dining_a:T4": 1 },
    pairingSharedWith: [2],
  });
  const seats = [p1, seat(2, { gender: "Mr", hand: "R", floorPositions: { "dining_a:T4": 2 } }), seat(3)];

  it("copies the order onto every other chair", () => {
    const next = copySeatOrderToAll(seats, 1);
    for (const s of next.slice(1)) {
      expect(s.water).toBe("XC");
      expect(s.pairing).toBe("Wine");
      expect(s.aperitifs).toEqual([{ name: "Harmonie", producer: "Nakada-Park" }]);
      expect(s.extras.beetroot.ordered).toBe(true);
      expect(s.optionalPairings.cheese_wine.ordered).toBe(true);
    }
    // copies, not shared references — editing P2's aperitif must not edit P1's
    expect(next[1].aperitifs[0]).not.toBe(p1.aperitifs[0]);
  });

  it("leaves the person and the chair alone: gender, hand, birthday, position, shares", () => {
    const [, p2, p3] = copySeatOrderToAll(seats, 1);
    expect(p2).toMatchObject({ id: 2, gender: "Mr", hand: "R", celebrating: false, floorPositions: { "dining_a:T4": 2 } });
    expect(p3).toMatchObject({ id: 3, gender: null, hand: null, celebrating: false, floorPositions: {} });
    // a share names specific chairs — copied, P3 would "split with P2"
    expect(p2.pairingSharedWith).toBeNull();
    expect(p3.extras.beetroot.sharedWith).toBeUndefined();
  });

  it("leaves the source seat untouched", () => {
    expect(copySeatOrderToAll(seats, 1)[0]).toBe(p1);
  });

  it("knows when it would overwrite something", () => {
    expect(otherSeatsHaveOrders(seats, 1)).toBe(false); // gender/hand alone are not an order
    expect(otherSeatsHaveOrders([p1, seat(2, { water: "OW" })], 1)).toBe(true);
  });
});
