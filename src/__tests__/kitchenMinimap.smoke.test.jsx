import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import KitchenMinimap from "../components/kitchen/KitchenMinimap.jsx";
import { buildDefaultFloorMaps } from "../utils/floorMaps.js";

const floorMaps = buildDefaultFloorMaps();

describe("KitchenMinimap", () => {
  // The remembered-room preference lives in localStorage; isolate each case.
  beforeEach(() => { try { localStorage.clear(); } catch {} });

  it("renders the active dining layout through the floor map, with guest labels", () => {
    const { container, queryByText, getAllByText } = render(
      <KitchenMinimap floorMaps={floorMaps} tables={[]} focusedTableId={null} />
    );
    expect(queryByText("T1")).toBeTruthy(); // dining tile
    expect(queryByText("T5")).toBeTruthy(); // dining only
    // every chair carries its P-label even when the room is empty
    expect(getAllByText(/^P\d+$/).length).toBeGreaterThan(0);
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("marks a focused dining table occupied and labels its live guests", () => {
    const table = { id: 8, active: true, seats: [{ id: 1 }, { id: 2 }] };
    const { queryByText, getAllByText } = render(
      <KitchenMinimap floorMaps={floorMaps} tables={[table]} focusedTableId={8} />
    );
    expect(queryByText("T8")).toBeTruthy();
    expect(getAllByText("P1").length).toBeGreaterThanOrEqual(1);
    expect(getAllByText("P2").length).toBeGreaterThanOrEqual(1);
  });

  it("follows a terrace party onto the terrace map and names the tile after its dining table", () => {
    const table = { id: 8, _visit: { visit: "terrace", terraceLabel: "T21" }, seats: [{ id: 1 }] };
    const { queryByText } = render(
      <KitchenMinimap floorMaps={floorMaps} tables={[table]} focusedTableId={8} />
    );
    // the occupied tile borrows the party's DINING label; its own name drops
    expect(queryByText("T8")).toBeTruthy();
    expect(queryByText("T21")).toBeFalsy();
    expect(queryByText("T22")).toBeTruthy(); // empty tiles keep their own name
    expect(queryByText("T5")).toBeFalsy();   // dining-only table gone → map switched
  });
});
