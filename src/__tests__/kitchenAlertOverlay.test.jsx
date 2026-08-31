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
});
