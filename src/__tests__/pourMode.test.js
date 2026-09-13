import { describe, it, expect } from "vitest";
import {
  POUR_MODES,
  POUR_MODE_LABEL,
  normalizePourMode,
  seatHasPairing,
  seatPourMode,
  pourModeLabel,
  withPourMode,
  withPairing,
} from "../utils/pourMode.js";
import { makeSeats } from "../utils/tableHelpers.js";
import { kitchenSnapshot, kitchenDelta, mergeKitchenAlert } from "../utils/kitchenAlerts.js";

describe("normalizePourMode", () => {
  it("accepts the two real modes, in any casing or padding", () => {
    expect(normalizePourMode("btg")).toBe("btg");
    expect(normalizePourMode("BTB")).toBe("btb");
    expect(normalizePourMode("  Btg ")).toBe("btg");
  });

  it("translates the development spelling rather than dropping the choice", () => {
    // "btv" was by-the-bottle before the floor corrected it to BTB. A seat set
    // on a preview build must not silently read as "no drink".
    expect(normalizePourMode("btv")).toBe("btb");
    expect(normalizePourMode("BTV")).toBe("btb");
    expect(seatPourMode({ pairing: "", pourMode: "btv" })).toBe("btb");
    expect(pourModeLabel({ pairing: "", pourMode: "btv" })).toBe("BTB");
  });

  it("treats the old and new bottle spellings as the same mode, so a tap turns it off", () => {
    const off = withPourMode({ id: 1, pairing: "", pourMode: "btv" }, "btb");
    expect(off.pourMode).toBeNull();
  });

  it("rejects everything else rather than inventing a mode", () => {
    for (const junk of [null, undefined, "", "—", "wine", "bt", 1, {}]) {
      expect(normalizePourMode(junk)).toBeNull();
    }
  });

  it("exposes exactly the two modes the UI renders", () => {
    expect(POUR_MODES).toEqual(["btg", "btb"]);
    expect(POUR_MODES.every((m) => POUR_MODE_LABEL[m])).toBe(true);
  });
});

describe("pairing and pour mode are exclusive", () => {
  it("treats a dash or an empty string as no pairing at all", () => {
    expect(seatHasPairing({ pairing: "" })).toBe(false);
    expect(seatHasPairing({ pairing: "—" })).toBe(false);
    expect(seatHasPairing({ pairing: "Wine" })).toBe(true);
  });

  it("hides a pour mode that somehow sits beside a pairing", () => {
    // A row written before the rule existed, or merged from an older tablet:
    // the ticket must never read "Wine · BTG" for one chair.
    const contradictory = { pairing: "Wine", pourMode: "btg" };
    expect(seatPourMode(contradictory)).toBeNull();
    expect(pourModeLabel(contradictory)).toBe("");
  });

  it("shows the pour mode for an unpaired seat", () => {
    expect(seatPourMode({ pairing: "", pourMode: "btb" })).toBe("btb");
    expect(pourModeLabel({ pairing: "—", pourMode: "btg" })).toBe("BTG");
  });

  it("choosing BTG drops the pairing it replaces", () => {
    const next = withPourMode({ id: 1, pairing: "Our Story", pourMode: null }, "btg");
    expect(next.pourMode).toBe("btg");
    expect(next.pairing).toBe("");
  });

  it("tapping the same mode twice turns it off and leaves the pairing empty", () => {
    const on = withPourMode({ id: 1, pairing: "", pourMode: null }, "btb");
    const off = withPourMode(on, "btb");
    expect(off.pourMode).toBeNull();
    expect(off.pairing).toBe("");
  });

  it("switching BTG to BTB replaces rather than stacks", () => {
    const next = withPourMode(withPourMode({ id: 1 }, "btg"), "btb");
    expect(next.pourMode).toBe("btb");
  });

  it("refuses to act on a mode it does not know, so a pairing cannot be blanked by accident", () => {
    const seat = { id: 1, pairing: "Wine", pourMode: null };
    expect(withPourMode(seat, "sparkling")).toBe(seat);
    expect(withPourMode(seat, null)).toBe(seat);
  });

  it("choosing a real pairing clears the pour mode", () => {
    const next = withPairing({ id: 1, pairing: "", pourMode: "btg" }, "Wine");
    expect(next.pairing).toBe("Wine");
    expect(next.pourMode).toBeNull();
  });

  it("clearing a pairing back to none leaves the pour mode alone", () => {
    // "No pairing" is not a statement about how the guest drinks instead, so
    // cycling past the end of the pairing list must not wipe a BTB someone set.
    const next = withPairing({ id: 1, pairing: "Wine", pourMode: "btb" }, "—");
    expect(next.pairing).toBe("");
    expect(next.pourMode).toBe("btb");
  });
});

describe("the seat factory carries the pour mode", () => {
  it("defaults to no mode", () => {
    expect(makeSeats(1)[0].pourMode).toBeNull();
  });

  it("keeps a stored mode and drops a junk one", () => {
    expect(makeSeats(2, [{ pourMode: "btb" }, { pourMode: "nonsense" }])
      .map((s) => s.pourMode)).toEqual(["btb", null]);
  });
});

describe("the kitchen hears about BTG / BTB", () => {
  const snap = (seat) => kitchenSnapshot([{ id: 1, extras: {}, ...seat }]);

  it("carries the mode on the snapshot", () => {
    expect(snap({ pairing: "", pourMode: "btg" })[1].pourMode).toBe("btg");
  });

  it("sends a delta when an unpaired seat starts drinking by the glass", () => {
    const before = snap({ pairing: "", pourMode: null });
    const after = snap({ pairing: "", pourMode: "btg" });
    const delta = kitchenDelta(after, before);
    expect(delta).toHaveLength(1);
    expect(delta[0].pourMode).toBe("btg");
    expect(delta[0].pairingChanged).toBe(true);
  });

  it("sends a delta when the guest switches from the glass to the bottle", () => {
    const delta = kitchenDelta(snap({ pourMode: "btb" }), snap({ pourMode: "btg" }));
    expect(delta.map((s) => s.pourMode)).toEqual(["btb"]);
  });

  it("sends nothing when the pour mode has not moved", () => {
    const same = snap({ pairing: "", pourMode: "btg" });
    expect(kitchenDelta(same, same)).toEqual([]);
  });

  it("never reports a pour mode for a seat that took a pairing", () => {
    const delta = kitchenDelta(snap({ pairing: "Wine", pourMode: "btg" }), snap({ pairing: "", pourMode: "btg" }));
    expect(delta[0].pairing).toBe("Wine");
    expect(delta[0].pourMode).toBeNull();
  });

  it("keeps a pending popup's pour mode when a later SET alert says nothing about it", () => {
    const pending = {
      seats: [{ id: 1, pourMode: "btg", pairing: null, pairingChanged: true, extras: [] }],
      confirmed: false,
    };
    const merged = mergeKitchenAlert(pending, { course: { index: 4, name: "Buchtel" }, seats: [] });
    expect(merged.seats[0].pourMode).toBe("btg");
    expect(merged.course.name).toBe("Buchtel");
  });
});
