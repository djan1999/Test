// ── Every CONFIRM stays reachable, however many alerts arrive ────────────────
// A busy service once sent enough SETs at the kitchen that the alert overlay
// overflowed the screen: the cards — overflow:hidden flex children of a
// fixed-height centered column — shrank into each other, and the overflow
// spilled past BOTH viewport edges, where above the top edge is beyond
// scrollTop 0 and can never be scrolled to. The stack looked crushed and the
// upper CONFIRM buttons could not be pressed at all.
//
// The fix separates the scroller from the centering: the dialog scrolls from
// the top like any list, an inner auto-margin column does the centering while
// everything fits, and each card refuses to shrink. jsdom does no layout, so
// these pin that contract rather than the pixels.

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { KitchenAlertOverlay } from "../components/kitchen/KitchenBoard.jsx";

const alertFor = (tableId) => ({
  tableId,
  alert: {
    timestamp: Date.now(),
    tableName: `GUEST ${tableId}`,
    course: { index: 3, name: "Trout Belly" },
    seats: [{ id: 1, pairing: "Wine" }, { id: 2, pairing: "Non-Alc" }],
  },
});

describe("KitchenAlertOverlay — a flood of alerts stays confirmable", () => {
  it("renders one card per alert, none allowed to shrink into its neighbours", () => {
    const many = Array.from({ length: 9 }, (_, i) => alertFor(i + 1));
    const { getAllByText } = render(<KitchenAlertOverlay alerts={many} onConfirm={vi.fn()} />);
    const confirms = getAllByText("CONFIRM");
    expect(confirms).toHaveLength(9);
    for (const btn of confirms) {
      // button → footer row → the card itself
      const card = btn.parentElement.parentElement;
      expect(card.style.flexShrink).toBe("0");
    }
  });

  it("scrolls from the top: the dialog never center-justifies its own overflow", () => {
    const many = Array.from({ length: 9 }, (_, i) => alertFor(i + 1));
    const { getByRole } = render(<KitchenAlertOverlay alerts={many} onConfirm={vi.fn()} />);
    const dialog = getByRole("dialog");
    expect(dialog.style.overflowY).toBe("auto");
    // justify-content:center on the scroller is what pushed cards past the
    // unreachable top edge — the centering belongs to the inner column's
    // auto margins instead.
    expect(dialog.style.justifyContent).toBe("");
    const inner = dialog.firstElementChild;
    expect(inner.style.margin).toBe("auto");
  });

  it("an extra sent for a restricted seat shows the modification on its chip", () => {
    const alert = {
      tableId: 8,
      alert: {
        timestamp: Date.now(),
        seats: [{
          id: 1, gender: null, pairing: null, pairingSharedWith: null,
          extras: [{ key: "beetroot", name: "Beetroot", pairing: null, sharedWith: null, restriction: "NO HAZELNUT OIL" }],
        }],
      },
    };
    const { getByText } = render(<KitchenAlertOverlay alerts={[alert]} onConfirm={vi.fn()} />);
    expect(getByText("BEETROOT")).toBeInTheDocument();
    expect(getByText("P1 · NO HAZELNUT OIL")).toBeInTheDocument();
  });

  it("a SET for a course a guest's dietary changes shows the modification per chair", () => {
    const alert = {
      tableId: 6,
      alert: {
        timestamp: Date.now(),
        seats: [],
        course: { index: 5, name: "Squash", restrictions: [{ pos: 2, mod: "POTATO CRACKLINGS" }], unassignedRestrictions: [] },
      },
    };
    const { getByText } = render(<KitchenAlertOverlay alerts={[alert]} onConfirm={vi.fn()} />);
    expect(getByText("RESTRICTION")).toBeInTheDocument();
    expect(getByText("P2 · POTATO CRACKLINGS")).toBeInTheDocument();
  });

  it("never prints the guest's name on the popup (GDPR — the pass faces the room)", () => {
    const { queryByText, getByText } = render(<KitchenAlertOverlay alerts={[alertFor(4)]} onConfirm={vi.fn()} />);
    expect(getByText("T4")).toBeInTheDocument();
    expect(queryByText(/GUEST 4/)).toBeNull();
  });

  it("each card's CONFIRM clears its own table", () => {
    const onConfirm = vi.fn();
    const { getAllByText } = render(
      <KitchenAlertOverlay alerts={[alertFor(4), alertFor(11)]} onConfirm={onConfirm} />
    );
    const confirms = getAllByText("CONFIRM");
    fireEvent.click(confirms[0]);
    fireEvent.click(confirms[1]);
    expect(onConfirm).toHaveBeenNthCalledWith(1, 4);
    expect(onConfirm).toHaveBeenNthCalledWith(2, 11);
  });

  it("names exactly who splits a dish, one chip per plate", () => {
    const ex = (sharedWith, pairing = null) => [{ key: "beetroot", name: "Beetroot", pairing, sharedWith, restriction: null }];
    const alert = {
      tableId: 3,
      alert: {
        timestamp: Date.now(),
        seats: [
          { id: 1, extras: ex([2]) },
          { id: 2, extras: ex([1]) },
          { id: 3, extras: ex(null) },
        ],
      },
    };
    const { getByText, queryByText } = render(<KitchenAlertOverlay alerts={[alert]} onConfirm={vi.fn()} />);
    expect(getByText(/P1 \+ P2 SHARE/)).toBeInTheDocument();
    expect(getByText("P3")).toBeInTheDocument();
    // No anonymous "SHARE" badge that leaves the pass guessing.
    expect(queryByText("SHARE")).toBeNull();
  });

  it("keeps a three-way share and a legacy one-id share readable", () => {
    const alert = {
      tableId: 5,
      alert: {
        timestamp: Date.now(),
        seats: [
          { id: 1, extras: [{ key: "cheese", name: "Cheese", sharedWith: [2, 3] }] },
          { id: 2, extras: [{ key: "cheese", name: "Cheese", sharedWith: [1, 3] }] },
          { id: 3, extras: [{ key: "cheese", name: "Cheese", sharedWith: [1, 2] }] },
          { id: 4, extras: [{ key: "beetroot", name: "Beetroot", sharedWith: 5 }] },
        ],
      },
    };
    const { getByText } = render(<KitchenAlertOverlay alerts={[alert]} onConfirm={vi.fn()} />);
    expect(getByText(/P1 \+ P2 \+ P3 SHARE/)).toBeInTheDocument();
    // P5 did not change, so it is not in the delta — but it is still named.
    expect(getByText(/P4 \+ P5 SHARE/)).toBeInTheDocument();
  });

  it("names who splits a pairing", () => {
    const alert = {
      tableId: 7,
      alert: {
        timestamp: Date.now(),
        seats: [
          { id: 1, pairing: "Wine", pairingSharedWith: [2] },
          { id: 2, pairing: "Wine", pairingSharedWith: [1] },
          { id: 3, pairing: "Wine", pairingSharedWith: null },
        ],
      },
    };
    const { getByText } = render(<KitchenAlertOverlay alerts={[alert]} onConfirm={vi.fn()} />);
    expect(getByText("P1 + P2 Wine SHARE")).toBeInTheDocument();
    expect(getByText("P3 Wine")).toBeInTheDocument();
  });
});
