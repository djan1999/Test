// ── The optional-dish controls, as one state machine ─────────────────────────
// Cheese and beetroot answer three questions about a chair — ordered, shared,
// paired — and two surfaces ask them: the board card's quick access and the
// floor map's dock. These pin the cycles themselves, so the two can only
// disagree by importing something else.

import { describe, it, expect } from "vitest";
import {
  extraOf,
  linkedPairingFor,
  shareMates,
  shareTag,
  shareGroups,
  extraMates,
  pairingMates,
  withExtraToggled,
  withExtraShareToggled,
  withExtraShareCleared,
  withPairingShareToggled,
  withSharedPairing,
  extraPairingStates,
  extraPairingState,
  withExtraPairingCycled,
  EXTRA_PAIRING_LABEL,
} from "../utils/seatExtras.js";

const BEET = { key: "beetroot", id: "beetroot", name: "Beetroot", pairings: ["—"] };
const LINKED = { key: "beet_pairing", extraKey: "beetroot", hasAlco: true, hasNonAlco: true };
const seat = (id, extras = {}, optionalPairings = {}) => ({ id, extras, optionalPairings });
const on = (over = {}) => ({ beetroot: { ordered: true, pairing: "—", ...over } });

describe("reading an extra off a seat", () => {
  it("falls back to the dish's own default when the seat says nothing", () => {
    expect(extraOf(seat(1), BEET)).toEqual({ ordered: false, pairing: "—" });
  });

  it("still finds a record stored under the dish id rather than its key", () => {
    // Older rows were keyed by id. Ignoring them read as "nobody ordered it".
    const legacy = { id: 1, extras: { beetroot: { ordered: true, pairing: "Wine" } } };
    expect(extraOf(legacy, { key: "nope", id: "beetroot" }).ordered).toBe(true);
  });

  it("matches a linked pairing by key or by id, and nothing else", () => {
    expect(linkedPairingFor(BEET, [LINKED])).toBe(LINKED);
    expect(linkedPairingFor({ key: "cheese" }, [LINKED])).toBeNull();
    expect(linkedPairingFor(BEET, [])).toBeNull();
    expect(linkedPairingFor(BEET, [{ key: "x" }])).toBeNull();
  });
});

describe("reading a share", () => {
  it("reads the old single-id shape and the group shape alike", () => {
    expect(shareMates(null)).toEqual([]);
    expect(shareMates(2)).toEqual([2]);
    expect(shareMates([3, 2, 3])).toEqual([2, 3]);
    expect(extraMates(seat(1, on({ sharedWith: 2 })), BEET)).toEqual([2]);
    expect(pairingMates({ id: 1, pairingSharedWith: [4, 3] })).toEqual([3, 4]);
  });

  it("tags a chair with every partner, not just one", () => {
    expect(shareTag(null)).toBe("");
    expect(shareTag(2)).toBe("½ P2");
    expect(shareTag([2, 3])).toBe("⅓ P2+P3");
  });

  it("splits chairs into groups, keeping a partner the list does not carry", () => {
    expect(shareGroups([
      { id: 1, mates: [2] }, { id: 2, mates: [1] }, { id: 3, mates: null },
    ])).toEqual([[1, 2], [3]]);
    // A one-sided legacy pair still lands in one group.
    expect(shareGroups([{ id: 1, mates: 2 }, { id: 2, mates: null }])).toEqual([[1, 2]]);
    // The kitchen popup only carries chairs that changed.
    expect(shareGroups([{ id: 3, mates: [4] }])).toEqual([[3, 4]]);
  });
});

describe("ordering and sharing a dish", () => {
  const seats = [seat(1), seat(2), seat(3)];

  it("the dish button is plain on/off — it never lands on a partner", () => {
    const once = withExtraToggled(seats, 1, BEET);
    expect(once[0].extras.beetroot).toMatchObject({ ordered: true, sharedWith: null });
    expect(once[1].extras).toEqual({});
    const twice = withExtraToggled(once, 1, BEET);
    expect(twice[0].extras.beetroot.ordered).toBe(false);
  });

  it("picking a chair gives it the other half, both sides naming each other", () => {
    const next = withExtraShareToggled([seat(1, on()), seat(2), seat(3)], 1, BEET, 2);
    expect(next[0].extras.beetroot).toMatchObject({ ordered: true, sharedWith: [2] });
    expect(next[1].extras.beetroot).toMatchObject({ ordered: true, sharedWith: [1] });
    expect(next[2].extras).toEqual({});
  });

  it("sharing turns the dish on for the chair doing the sharing", () => {
    const next = withExtraShareToggled(seats, 1, BEET, 2);
    expect(next[0].extras.beetroot).toMatchObject({ ordered: true, sharedWith: [2] });
  });

  it("three chairs can split one plate", () => {
    let next = withExtraShareToggled([seat(1, on()), seat(2), seat(3)], 1, BEET, 2);
    next = withExtraShareToggled(next, 1, BEET, 3);
    expect(next.map((s) => s.extras.beetroot.sharedWith)).toEqual([[2, 3], [1, 3], [1, 2]]);
    expect(next.every((s) => s.extras.beetroot.ordered)).toBe(true);
  });

  it("un-picking a chair releases it and leaves the rest splitting", () => {
    let next = withExtraShareToggled([seat(1, on()), seat(2), seat(3)], 1, BEET, 2);
    next = withExtraShareToggled(next, 1, BEET, 3);
    next = withExtraShareToggled(next, 1, BEET, 2);
    // P2 only had it because it was splitting.
    expect(next[1].extras.beetroot).toMatchObject({ ordered: false, sharedWith: null });
    expect(next[0].extras.beetroot.sharedWith).toEqual([3]);
    expect(next[2].extras.beetroot.sharedWith).toEqual([1]);
  });

  it("a chair picked from another share leaves that one", () => {
    // P1+P2 split one, P3+P4 another; P1 pulls P3 in.
    const start = [
      seat(1, on({ sharedWith: [2] })), seat(2, on({ sharedWith: [1] })),
      seat(3, on({ sharedWith: [4] })), seat(4, on({ sharedWith: [3] })),
    ];
    const next = withExtraShareToggled(start, 1, BEET, 3);
    expect(next[0].extras.beetroot.sharedWith).toEqual([2, 3]);
    expect(next[2].extras.beetroot.sharedWith).toEqual([1, 2]);
    // P4 keeps its plate, now on its own.
    expect(next[3].extras.beetroot).toMatchObject({ ordered: true, sharedWith: null });
  });

  it("switching a sharer off leaves the others splitting", () => {
    const start = [
      seat(1, on({ sharedWith: [2, 3] })), seat(2, on({ sharedWith: [1, 3] })), seat(3, on({ sharedWith: [1, 2] })),
    ];
    const next = withExtraToggled(start, 1, BEET);
    expect(next[0].extras.beetroot).toMatchObject({ ordered: false, sharedWith: null });
    expect(next[1].extras.beetroot).toMatchObject({ ordered: true, sharedWith: [3] });
    expect(next[2].extras.beetroot).toMatchObject({ ordered: true, sharedWith: [2] });
  });

  it("clearing a share releases every chair it named", () => {
    const start = [seat(1, on({ sharedWith: [2] })), seat(2, on({ sharedWith: [1] }))];
    const next = withExtraShareCleared(start, 1, BEET);
    expect(next[0].extras.beetroot).toMatchObject({ ordered: true, sharedWith: null });
    expect(next[1].extras.beetroot.ordered).toBe(false);
  });

  it("reads a legacy single-id share when re-picking", () => {
    const start = [seat(1, on({ sharedWith: 2 })), seat(2, on({ sharedWith: 1 })), seat(3)];
    const next = withExtraShareToggled(start, 1, BEET, 3);
    expect(next[0].extras.beetroot.sharedWith).toEqual([2, 3]);
    expect(next[1].extras.beetroot.sharedWith).toEqual([1, 3]);
  });

  it("never touches a partner's own pairing choice", () => {
    // The "beetroot pairing disappears when I touch share" bug: P2 chose the
    // wine for themselves, and linking a share wiped it.
    const start = [
      seat(1, on()),
      seat(2, on(), { beet_pairing: { ordered: true, mode: "alco" } }),
    ];
    const next = withExtraShareToggled(start, 1, BEET, 2);
    expect(next[1].optionalPairings.beet_pairing).toEqual({ ordered: true, mode: "alco" });
  });

  it("leaves the table alone for a seat or a dish it cannot find", () => {
    expect(withExtraShareToggled(seats, 99, BEET, 2)).toBe(seats);
    expect(withExtraShareToggled(seats, 1, BEET, 99)).toBe(seats);
    expect(withExtraShareToggled(seats, 1, {}, 2)).toBe(seats);
    expect(withExtraToggled(seats, 99, BEET)).toBe(seats);
  });
});

describe("sharing a pairing", () => {
  const p = (id, pairing = "", over = {}) => ({ id, pairing, pourMode: null, pairingSharedWith: null, ...over });

  it("does nothing until there is a pairing to split", () => {
    const seats = [p(1), p(2)];
    expect(withPairingShareToggled(seats, 1, 2)).toBe(seats);
  });

  it("a chair picked takes the pairing and drops its pour mode", () => {
    const next = withPairingShareToggled([p(1, "Wine"), p(2, "", { pourMode: "btg" }), p(3)], 1, 2);
    expect(next[0].pairingSharedWith).toEqual([2]);
    expect(next[1]).toMatchObject({ pairing: "Wine", pourMode: null, pairingSharedWith: [1] });
    expect(next[2].pairingSharedWith).toBeNull();
  });

  it("a chair un-picked keeps what it was poured", () => {
    let next = withPairingShareToggled([p(1, "Wine"), p(2), p(3)], 1, 2);
    next = withPairingShareToggled(next, 1, 2);
    expect(next[0].pairingSharedWith).toBeNull();
    expect(next[1]).toMatchObject({ pairing: "Wine", pairingSharedWith: null });
  });

  it("changing the pairing carries the whole share with it", () => {
    const start = [p(1, "Wine", { pairingSharedWith: [2] }), p(2, "Wine", { pairingSharedWith: [1] }), p(3, "Wine")];
    const next = withSharedPairing(start, 1, (s) => ({ ...s, pairing: "Non-Alc" }));
    expect(next.map((s) => s.pairing)).toEqual(["Non-Alc", "Non-Alc", "Wine"]);
  });

  it("clearing the pairing ends the share", () => {
    const start = [p(1, "Wine", { pairingSharedWith: [2] }), p(2, "Wine", { pairingSharedWith: [1] })];
    const next = withSharedPairing(start, 1, (s) => ({ ...s, pairing: "" }));
    expect(next[0].pairingSharedWith).toBeNull();
    expect(next[1]).toMatchObject({ pairing: "Wine", pairingSharedWith: null });
  });
});

describe("the linked pairing cycle", () => {
  it("offers only the modes this pairing actually pours", () => {
    expect(extraPairingStates(LINKED)).toEqual(["off", "on", "alco", "nonalc"]);
    expect(extraPairingStates({ hasAlco: true })).toEqual(["off", "on", "alco"]);
    expect(extraPairingStates(null)).toEqual(["off", "on"]);
  });

  it("reads an unordered dish as off, however the pairing row looks", () => {
    const stale = seat(1, {}, { beet_pairing: { ordered: true, mode: "alco" } });
    expect(extraPairingState(stale, BEET, LINKED)).toBe("off");
  });

  it("reads the dish with no drink beside it as plain on", () => {
    expect(extraPairingState(seat(1, on()), BEET, LINKED)).toBe("on");
  });

  it("reads each poured mode back", () => {
    const alco = seat(1, on(), { beet_pairing: { ordered: true, mode: "alco" } });
    const na = seat(1, on(), { beet_pairing: { ordered: true, mode: "nonalc" } });
    expect(extraPairingState(alco, BEET, LINKED)).toBe("alco");
    expect(extraPairingState(na, BEET, LINKED)).toBe("nonalc");
  });

  it("scrolls off → on → wine → n/a → off, ordering and cancelling the dish with it", () => {
    let seats = [seat(1), seat(2)];
    const tap = () => { seats = withExtraPairingCycled(seats, 1, BEET, LINKED); };
    const state = () => extraPairingState(seats[0], BEET, LINKED);

    tap(); expect(state()).toBe("on");
    expect(seats[0].extras.beetroot.ordered).toBe(true);
    tap(); expect(state()).toBe("alco");
    expect(seats[0].optionalPairings.beet_pairing).toMatchObject({ ordered: true, mode: "alco" });
    tap(); expect(state()).toBe("nonalc");
    tap(); expect(state()).toBe("off");
    expect(seats[0].extras.beetroot.ordered).toBe(false);
    expect(seats[0].optionalPairings.beet_pairing).toMatchObject({ ordered: false, mode: null });
  });

  it("touches only the seat it was tapped on", () => {
    const next = withExtraPairingCycled([seat(1), seat(2)], 1, BEET, LINKED);
    expect(next[1].extras).toEqual({});
  });

  it("has a word for every state it can be in", () => {
    extraPairingStates(LINKED).forEach(s => expect(EXTRA_PAIRING_LABEL[s]).toBeTruthy());
  });
});
