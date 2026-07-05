import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import FloorView from "../components/floor/FloorView.jsx";
import { buildDefaultFloorMaps } from "../utils/floorMaps.js";

// FLOOR view smoke: the FOH surface — tabs, ticker, two-zone taps, and the
// terrace actions folded in from the old TerracePanel.

const floorMaps = buildDefaultFloorMaps();

const boardTable = (id, extra = {}) => ({
  id, active: false, resName: "", resTime: "", guests: 0, restrictions: [], tableGroup: [], ...extra,
});

const tables = [
  boardTable(1, { active: true, resName: "NOVAK", guests: 2, resTime: "18:00", restrictions: [{ pos: 1, note: "shellfish" }] }),
  boardTable(4, { resName: "KOVAČ", guests: 4, resTime: "19:30" }),
  ...[2, 3, 5, 6, 7, 8, 9, 10].map((id) => boardTable(id)),
];

const reservations = [
  // out on the terrace, armed
  { id: "r1", table_id: 9, data: { resName: "WEISS", guests: 4, visit_state: "terrace", terrace_table: "T23", last_bite_fired_at: "2026-07-05T18:00:00Z" } },
  // waiting for a terrace assignment
  { id: "r2", table_id: 5, data: { resName: "MURN", guests: 2, visit_state: "booked", resTime: "20:00" } },
  // mid-move to the dining room
  { id: "r3", table_id: 8, data: { resName: "HORVAT", guests: 2, visit_state: "arriving" } },
];

const setup = (overrides = {}) => {
  const handlers = {
    onCycleStatus: vi.fn(),
    onUpdateFloorMaps: vi.fn(),
    onAssign: vi.fn(),
    onClear: vi.fn(),
    onMove: vi.fn(),
    onMarkSeated: vi.fn(),
    renderQuickAccess: vi.fn((bt) => <div>QUICK-ACCESS-{bt.id}</div>),
  };
  const utils = render(
    <FloorView
      floorMaps={floorMaps}
      floorStatus={{ dining_a: { T4: "SET", T5: "DIRTY" } }}
      reservations={reservations}
      tables={tables}
      editable
      {...handlers}
      {...overrides}
    />,
  );
  return { ...utils, handlers };
};

const findTable = (container, label) =>
  [...container.querySelectorAll("g")].find((g) => g.textContent.startsWith(label));

describe("FloorView (FOH FLOOR surface)", () => {
  it("shows the active dining layout + terrace tabs and the ticker counts", () => {
    const { container, getByText } = setup();
    getByText("LAYOUT A");
    getByText("TERRACE");
    // T1 occupied ×2 covers; T4 reserved; r3 arriving on T8 → RES 2
    expect(container.textContent).toContain("COVERS 2");
    expect(container.textContent).toContain("SEATED 1");
    expect(container.textContent).toContain("RES 2");
    expect(container.textContent).toContain("SET 1");
    expect(container.textContent).toContain("DIRTY 1");
    // occupied table renders the party, allergy ▲, ARRIVING badge on T8
    expect(container.textContent).toContain("NOVAK ×2");
    expect(container.textContent).toContain("▲");
    expect(container.textContent).toContain("ARRIVING · KV");
  });

  it("strip tap cycles status for the visible map; body tap opens the board's quick access", () => {
    const { container, handlers } = setup();
    fireEvent.click(container.querySelector('[data-strip="T6"]'));
    expect(handlers.onCycleStatus).toHaveBeenCalledWith("dining_a", "T6");
    fireEvent.click(findTable(container, "T1"));
    expect(handlers.renderQuickAccess).toHaveBeenCalled();
    expect(handlers.renderQuickAccess.mock.calls[0][0].id).toBe(1);
    expect(container.textContent).toContain("QUICK-ACCESS-1");
  });

  it("an arriving party's table sheet carries MARK SEATED", () => {
    const { container, handlers, getByText } = setup();
    fireEvent.click(findTable(container, "T8"));
    fireEvent.click(getByText(/MARK SEATED/));
    expect(handlers.onMarkSeated).toHaveBeenCalledWith(reservations[2]);
  });

  it("terrace tab: occupied table is armed with MOVE / CLEAR; free table assigns a booked party", () => {
    const { container, handlers, getByText } = setup();
    fireEvent.click(getByText("TERRACE"));
    expect(container.textContent).toContain("WEISS ×4");
    expect(container.textContent).toContain("LAST BITE ✓");
    fireEvent.click(findTable(container, "T23"));
    fireEvent.click(getByText(/MOVE TO T9/));
    expect(handlers.onMove).toHaveBeenCalledWith(reservations[0]);
    // free table → booked-party picker (MURN waits, HORVAT is mid-move)
    fireEvent.click(findTable(container, "T21"));
    fireEvent.click(getByText(/MURN ×2/));
    expect(handlers.onAssign).toHaveBeenCalledWith(reservations[1], "T21");
  });

  it("EDIT switches the canvas to edit mode and lists every map as a tab", () => {
    const { container, getByText, handlers } = setup();
    fireEvent.click(getByText("EDIT"));
    getByText("LAYOUT B"); // inactive layouts editable too
    // drag commits exactly one geometry update through updateFloorMaps
    const svg = container.querySelector("svg");
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 368, right: 400, bottom: 368 });
    const t1 = findTable(container, "T1");
    fireEvent.pointerDown(t1, { clientX: 40, clientY: 40 });
    fireEvent.pointerMove(t1, { clientX: 80, clientY: 80 });
    fireEvent.pointerUp(t1, { clientX: 80, clientY: 80 });
    expect(handlers.onUpdateFloorMaps).toHaveBeenCalledTimes(1);
    const next = handlers.onUpdateFloorMaps.mock.calls[0][0];
    const t1Next = next.maps.find((m) => m.id === "dining_a").tables.find((t) => t.label === "T1");
    expect([t1Next.x, t1Next.y]).toEqual([18, 18]);
  });
});
