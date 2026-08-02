import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
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

  it("free-tile picker offers ONLY parties physically in the house, as name · table · time", () => {
    try { localStorage.setItem("milka_kitchen_minimap_map", "terrace"); } catch {}
    const onAssign = vi.fn();
    const tables = [
      { id: 5, active: true, seats: [{ id: 1 }] },  // arrived, legacy 'booked' row
    ];
    const reservations = [
      { id: "r-dining", table_id: 8, data: { resName: "Kovac", resTime: "19:00", visit_state: "dining" } },
      { id: "r-arrived", table_id: 5, data: { resName: "Novak", resTime: "18:30" } },      // booked, but table 5 is live
      { id: "r-later", table_id: 9, data: { resName: "Zupan", resTime: "20:30" } },        // booked, NOT here yet
    ];
    const { container, queryByText, getByText } = render(
      <KitchenMinimap floorMaps={floorMaps} tables={tables} focusedTableId={null}
        reservations={reservations} onAssign={onAssign} onSwapSeats={vi.fn()} onCycleStatus={vi.fn()} />
    );
    fireEvent.click(container.querySelector('[data-table="T21"]')); // free terrace tile
    expect(queryByText("ASSIGN PARTY")).toBeTruthy();
    expect(queryByText("Kovac")).toBeTruthy();  // seated inside
    expect(queryByText("Novak")).toBeTruthy();  // arrived (board table live)
    expect(queryByText("Zupan")).toBeFalsy();   // not in the house — never offered
    fireEvent.click(getByText("Kovac"));
    expect(onAssign).toHaveBeenCalledWith(reservations[0], "T21");
  });

  it("occupied terrace tile's sheet shows dining table, name and time with the service actions", () => {
    try { localStorage.setItem("milka_kitchen_minimap_map", "terrace"); } catch {}
    const onCycleStatus = vi.fn();
    const tables = [
      { id: 8, _visit: { visit: "terrace", terraceLabel: "T22" }, seats: [{ id: 1 }] },
    ];
    const reservations = [
      { id: "r8", table_id: 8, data: { resName: "Kovac", resTime: "19:00", visit_state: "terrace", terrace_table: "T22" } },
    ];
    const { container, queryByText } = render(
      <KitchenMinimap floorMaps={floorMaps} tables={tables} focusedTableId={null}
        reservations={reservations} onAssign={vi.fn()} onSwapSeats={vi.fn()} onCycleStatus={onCycleStatus} />
    );
    fireEvent.click(container.querySelector('[data-table="T8"]')); // renamed occupied tile
    expect(queryByText(/Kovac/)).toBeTruthy();
    expect(queryByText("CHANGE TABLE")).toBeTruthy();
    expect(queryByText("SET → KITCHEN")).toBeTruthy();
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
