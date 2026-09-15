// ── The optional-dish controls, as one state machine ─────────────────────────
// Cheese and beetroot answer three questions about a chair — ordered, shared,
// paired — and two surfaces ask them: the board card's quick access and the
// floor map's dock. These pin the cycles themselves, so the two can only
// disagree by importing something else.

import { describe, it, expect } from "vitest";
import {
  extraOf,
  linkedPairingFor,
  extraShareStates,
  extraShareState,
  nextExtraShareState,
  extraShareLabel,
  withExtraShareCycled,
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

describe("the share cycle", () => {
  const seats = [seat(1), seat(2), seat(3)];

  it("scrolls off → on → every other chair → off", () => {
    expect(extraShareStates(1, seats)).toEqual(["off", "on", 2, 3]);
  });

  it("reads a seat's current place in that cycle", () => {
    expect(extraShareState(seat(1), BEET)).toBe("off");
    expect(extraShareState(seat(1, on()), BEET)).toBe("on");
    expect(extraShareState(seat(1, on({ sharedWith: 2 })), BEET)).toBe(2);
  });

  it("wraps back to off past the last chair", () => {
    const shared3 = [seat(1, on({ sharedWith: 3 })), seat(2), seat(3)];
    expect(nextExtraShareState(shared3[0], shared3, BEET)).toBe("off");
  });

  it("labels a share by the chair it names", () => {
    expect(extraShareLabel("off")).toBe("off");
    expect(extraShareLabel("on")).toBe("on");
    expect(extraShareLabel(2)).toBe("½P2");
  });

  it("orders the dish on the first tap", () => {
    const next = withExtraShareCycled(seats, 1, BEET);
    expect(next[0].extras.beetroot).toMatchObject({ ordered: true, sharedWith: null });
    expect(next[1].extras).toEqual({});
  });

  it("gives the partner the other half when a share is named", () => {
    const next = withExtraShareCycled([seat(1, on()), seat(2), seat(3)], 1, BEET);
    expect(next[0].extras.beetroot.sharedWith).toBe(2);
    expect(next[1].extras.beetroot).toMatchObject({ ordered: true, sharedWith: 1 });
  });

  it("releases the chair a share used to name when it moves on", () => {
    const start = [
      seat(1, on({ sharedWith: 2 })),
      seat(2, on({ sharedWith: 1 })),
      seat(3),
    ];
    const next = withExtraShareCycled(start, 1, BEET);
    expect(next[0].extras.beetroot.sharedWith).toBe(3);
    // P2 was only ordered because P1 was splitting with it.
    expect(next[1].extras.beetroot).toMatchObject({ ordered: false, sharedWith: null });
    expect(next[2].extras.beetroot).toMatchObject({ ordered: true, sharedWith: 1 });
  });

  it("releases the partner when the whole thing is cancelled", () => {
    const start = [seat(1, on({ sharedWith: 2 })), seat(2, on({ sharedWith: 1 }))];
    const next = withExtraShareCycled(start, 1, BEET);   // only P2 to offer → off
    expect(next[0].extras.beetroot.ordered).toBe(false);
    expect(next[1].extras.beetroot.ordered).toBe(false);
  });

  it("never touches a partner's own pairing choice", () => {
    // The "beetroot pairing disappears when I touch share" bug: P2 chose the
    // wine for themselves, and linking a share wiped it.
    const start = [
      seat(1, on()),
      seat(2, on(), { beet_pairing: { ordered: true, mode: "alco" } }),
    ];
    const next = withExtraShareCycled(start, 1, BEET);
    expect(next[1].optionalPairings.beet_pairing).toEqual({ ordered: true, mode: "alco" });
  });

  it("leaves the table alone for a seat or a dish it cannot find", () => {
    expect(withExtraShareCycled(seats, 99, BEET)).toBe(seats);
    expect(withExtraShareCycled(seats, 1, {})).toBe(seats);
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
