import { describe, it, expect } from "vitest";
import { kitchenSnapshot, kitchenDelta, hasKitchenUpdate } from "../utils/kitchenAlerts.js";

// Minimal optional-extra defs (beetroot, cheese) and a passthrough pairing fn
const EXTRAS = [
  { key: "beetroot", id: "beetroot", name: "Beetroot" },
  { key: "cheese", id: "cheese", name: "Cheese" },
];
const seat = (id, over = {}) => ({ id, gender: null, pairing: "—", extras: {}, ...over });
const ordered = (extra = {}) => ({ ordered: true, ...extra });

describe("kitchenSnapshot", () => {
  it("captures pairing and ordered extras per seat", () => {
    const seats = [
      seat(1, { pairing: "Wine", extras: { beetroot: ordered() } }),
      seat(2, { pairing: "—", extras: {} }),
    ];
    const snap = kitchenSnapshot(seats, EXTRAS, []);
    expect(snap[1].pairing).toBe("Wine");
    expect(snap[1].extras.map((e) => e.key)).toEqual(["beetroot"]);
    expect(snap[2].pairing).toBe(null); // "—" normalises to null
    expect(snap[2].extras).toEqual([]);
  });

  it("ignores extras that aren't ordered", () => {
    const snap = kitchenSnapshot([seat(1, { extras: { beetroot: { ordered: false } } })], EXTRAS, []);
    expect(snap[1].extras).toEqual([]);
  });
});

describe("kitchenDelta", () => {
  it("returns everything on the first send (empty baseline)", () => {
    const cur = kitchenSnapshot([seat(1, { pairing: "Wine", extras: { beetroot: ordered() } })], EXTRAS, []);
    const delta = kitchenDelta(cur, {});
    expect(delta).toHaveLength(1);
    expect(delta[0].pairing).toBe("Wine");
    expect(delta[0].extras.map((e) => e.key)).toEqual(["beetroot"]);
  });

  it("sends nothing when nothing changed", () => {
    const cur = kitchenSnapshot([seat(1, { pairing: "Wine", extras: { beetroot: ordered() } })], EXTRAS, []);
    expect(kitchenDelta(cur, cur)).toEqual([]);
    expect(hasKitchenUpdate(cur, cur)).toBe(false);
  });

  it("sends only the newly added extra, not the previously sent one", () => {
    const base = kitchenSnapshot([seat(1, { pairing: "Wine", extras: { beetroot: ordered() } })], EXTRAS, []);
    const next = kitchenSnapshot([seat(1, { pairing: "Wine", extras: { beetroot: ordered(), cheese: ordered() } })], EXTRAS, []);
    const delta = kitchenDelta(next, base);
    expect(delta).toHaveLength(1);
    // beetroot was already acknowledged → only cheese is new
    expect(delta[0].extras.map((e) => e.key)).toEqual(["cheese"]);
    // pairing unchanged → omitted so the overlay doesn't re-announce it
    expect(delta[0].pairing).toBe(null);
  });

  it("flags a pairing change without repeating already-sent extras", () => {
    const base = kitchenSnapshot([seat(1, { pairing: "Wine", extras: { beetroot: ordered() } })], EXTRAS, []);
    const next = kitchenSnapshot([seat(1, { pairing: "Non-Alc", extras: { beetroot: ordered() } })], EXTRAS, []);
    const delta = kitchenDelta(next, base);
    expect(delta).toHaveLength(1);
    expect(delta[0].pairing).toBe("Non-Alc");
    expect(delta[0].extras).toEqual([]); // beetroot already known
  });

  it("only includes the seat that changed", () => {
    const base = kitchenSnapshot([
      seat(1, { extras: { beetroot: ordered() } }),
      seat(2, { extras: {} }),
    ], EXTRAS, []);
    const next = kitchenSnapshot([
      seat(1, { extras: { beetroot: ordered() } }),
      seat(2, { extras: { cheese: ordered() } }),
    ], EXTRAS, []);
    const delta = kitchenDelta(next, base);
    expect(delta.map((s) => s.id)).toEqual([2]);
  });

  it("treats a missing baseline (null) as nothing-sent-yet", () => {
    const cur = kitchenSnapshot([seat(1, { extras: { beetroot: ordered() } })], EXTRAS, []);
    expect(hasKitchenUpdate(cur, null ?? {})).toBe(true);
  });
});
