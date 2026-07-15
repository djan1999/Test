import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { DisplayBoardCard } from "../components/service/DisplayBoard.jsx";

// The card footer (Details / Send / Unseat) must never hide behind
// seats.length: a seated table whose guest count was never set has NO seat
// rows, and that is exactly the state that needs the Unseat escape hatch —
// gating on seats locked table 2-3 out of Unseat mid-service (15.07).
describe("DisplayBoardCard Unseat (the escape hatch survives a seatless table)", () => {
  const seatedTable = (extra = {}) => ({
    id: 2, active: true, resName: "MERGE PARTY", resTime: "19:00",
    guests: 0, seats: [], restrictions: [], tableGroup: [2, 3], ...extra,
  });

  it("a SEATED table with zero seat rows still offers Unseat", () => {
    const onUnseat = vi.fn();
    const { getByText } = render(<DisplayBoardCard t={seatedTable()} onUnseat={onUnseat} />);
    fireEvent.click(getByText("Unseat"));
    expect(onUnseat).toHaveBeenCalledWith(2);
  });

  it("a seated table WITH seats keeps offering Unseat (no regression)", () => {
    const onUnseat = vi.fn();
    const { getByText } = render(
      <DisplayBoardCard
        t={seatedTable({ guests: 2, seats: [{ id: 1 }, { id: 2 }] })}
        onUnseat={onUnseat}
      />,
    );
    fireEvent.click(getByText("Unseat"));
    expect(onUnseat).toHaveBeenCalledWith(2);
  });

  it("an unseated table shows no Unseat", () => {
    const { queryByText } = render(
      <DisplayBoardCard t={seatedTable({ active: false })} onUnseat={vi.fn()} />,
    );
    expect(queryByText("Unseat")).toBeNull();
  });
});
