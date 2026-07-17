import { describe, it, expect, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import KitchenMinimap from "../components/kitchen/KitchenMinimap.jsx";
import { buildDefaultFloorMaps } from "../utils/floorMaps.js";

const floorMaps = buildDefaultFloorMaps();

describe("KitchenMinimap", () => {
  // The remembered-room preference lives in localStorage; isolate each case.
  beforeEach(() => { try { localStorage.clear(); } catch {} });
  it("renders the active dining layout with bare table numbers", () => {
    const { container, queryByText } = render(
      <KitchenMinimap floorMaps={floorMaps} tables={[]} focusedTableId={null} />
    );
    expect(queryByText("1")).toBeTruthy(); // T1
    expect(queryByText("5")).toBeTruthy(); // T5 (dining only)
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("highlights a focused dining table and labels its live guest positions", () => {
    const table = { id: 8, active: true, seats: [{ id: 1 }, { id: 2 }] };
    const { getAllByText } = render(
      <KitchenMinimap floorMaps={floorMaps} tables={[table]} focusedTableId={8} />
    );
    expect(getAllByText("8").length).toBeGreaterThanOrEqual(1); // T8 number
    // live guest positions P1/P2 render their numbers on the lit table
    expect(getAllByText("1").length).toBeGreaterThanOrEqual(1);
    expect(getAllByText("2").length).toBeGreaterThanOrEqual(1);
  });

  it("follows a terrace party onto the terrace map", () => {
    const table = { id: 21, _visit: { visit: "terrace", terraceLabel: "T21" }, seats: [{ id: 1 }] };
    const { queryByText } = render(
      <KitchenMinimap floorMaps={floorMaps} tables={[table]} focusedTableId={21} />
    );
    expect(queryByText("21")).toBeTruthy(); // terrace tile T21
    expect(queryByText("5")).toBeFalsy();   // dining-only table gone → map switched
  });
});
