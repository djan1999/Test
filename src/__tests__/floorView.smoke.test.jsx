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
  boardTable(9, { active: true, resName: "WEISS", guests: 4, seats: [
    { id: 1, water: "XC", pairing: "Non-Alc" },
    { id: 2, water: "OW", pairing: "Wine" },
  ] }),
  ...[2, 3, 5, 6, 7, 8, 10].map((id) => boardTable(id)),
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
  };
  const utils = render(
    <FloorView
      floorMaps={floorMaps}
      floorStatus={{ dining_a: { T4: "SET" } }}
      reservations={reservations}
      tables={tables}
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
    // T1 ×2 + T9 ×4 occupied; T4 reserved; r3 arriving on T8 → RES 2
    expect(container.textContent).toContain("COVERS 6");
    expect(container.textContent).toContain("SEATED 2");
    expect(container.textContent).toContain("RES 2");
    expect(container.textContent).toContain("SET 1");
    // FOH tables are label-only (per Djan): no names, no ×pax, no course on
    // the shape — the ▲ and the ARRIVING badge stay
    expect(container.textContent).not.toContain("×2");
    expect(container.textContent).not.toContain("NOVAK");
    expect(container.textContent).not.toContain("WEISS");
    expect(container.textContent).toContain("▲");
    expect(container.textContent).toContain("ARRIVING · KV");
    // waters/pairings BY POSITION at T9's chairs — the HOUSE shortcuts as
    // stored, stacked water-over-pairing in the chair pill (Wine → WP)
    expect(container.textContent).toContain("XC");
    expect(container.textContent).toContain("NA");
    expect(container.textContent).toContain("OW");
    expect(container.textContent).toContain("WP");
  });

  it("a dining table is one big SET toggle — tap calls the status handler, no sheet", () => {
    const { container, handlers } = setup();
    fireEvent.click(findTable(container, "T1")); // occupied dining body — no sheet, toggles
    expect(handlers.onCycleStatus).toHaveBeenCalledWith("dining_a", "T1");
    expect(handlers.onCycleStatus).toHaveBeenCalledTimes(1);
  });

  it("an arriving party's table sheet carries MARK SEATED", () => {
    const { container, handlers, getByText } = setup();
    fireEvent.click(findTable(container, "T8"));
    fireEvent.click(getByText(/MARK SEATED/));
    expect(handlers.onMarkSeated).toHaveBeenCalledWith(reservations[2]);
  });

  it("terrace tab: occupied sheet shows waters by position (no name) + MOVE; free table assigns", () => {
    const { container, handlers, getByText } = setup();
    fireEvent.click(getByText("TERRACE"));
    expect(container.textContent).not.toContain("WEISS"); // no names on the floor
    expect(container.textContent).toContain("T9");        // the party's identity = its dining table
    expect(container.textContent).toContain("XC");        // the party's seat notes travel to the terrace table
    expect(container.textContent).toContain("LAST BITE ✓");
    fireEvent.click(findTable(container, "T23"));
    expect(container.textContent).toContain("×4");        // pax lives in the sheet header
    // the sheet: waters by seat position + pairings, reservation name omitted
    const sheet = getByText("P1").closest("div").parentElement.parentElement;
    expect(sheet.textContent).toContain("XC");
    expect(sheet.textContent).toContain("Non-Alc");
    expect(sheet.textContent).toContain("P2");
    expect(sheet.textContent).not.toContain("WEISS");
    fireEvent.click(getByText(/MOVE TO T9/));
    expect(handlers.onMove).toHaveBeenCalledWith(reservations[0]);
    // free table → booked-party picker (MURN waits, HORVAT is mid-move)
    fireEvent.click(findTable(container, "T21"));
    fireEvent.click(getByText(/MURN ×2/));
    expect(handlers.onAssign).toHaveBeenCalledWith(reservations[1], "T21");
  });

});

describe("terrace CHANGE TABLE (re-seat on the terrace)", () => {
  it("occupied sheet arms the move; tapping a free table re-assigns, occupied tables refuse", () => {
    const { container, handlers, getByText } = setup();
    fireEvent.click(getByText("TERRACE"));
    fireEvent.click(findTable(container, "T23")); // WEISS's table
    fireEvent.click(getByText("CHANGE TABLE"));
    expect(container.textContent).toContain("TAP A FREE TABLE FOR WEISS ×4");
    fireEvent.click(findTable(container, "T23")); // still occupied — refused
    expect(handlers.onAssign).not.toHaveBeenCalled();
    fireEvent.click(findTable(container, "T25")); // free → re-seat
    expect(handlers.onAssign).toHaveBeenCalledWith(reservations[0], "T25");
    expect(container.textContent).not.toContain("TAP A FREE TABLE");
  });

  it("CANCEL disarms without assigning", () => {
    const { container, handlers, getByText } = setup();
    fireEvent.click(getByText("TERRACE"));
    fireEvent.click(findTable(container, "T23"));
    fireEvent.click(getByText("CHANGE TABLE"));
    fireEvent.click(getByText("CANCEL"));
    fireEvent.click(findTable(container, "T25"));
    expect(handlers.onAssign).not.toHaveBeenCalled(); // free-table tap = plain sheet again
  });
});

describe("terrace SET FOR BITES", () => {
  it("free-table sheet toggles the strip and closes", () => {
    const { container, handlers, getByText, queryByText } = setup();
    fireEvent.click(getByText("TERRACE"));
    fireEvent.click(findTable(container, "T25")); // free
    fireEvent.click(getByText("SET FOR BITES"));
    expect(handlers.onCycleStatus).toHaveBeenCalledWith("terrace_main", "T25");
    expect(queryByText("ASSIGN PARTY")).toBeNull(); // sheet closed
  });

  it("an already-SET table offers UNSET instead, and its strip shows on the tile", () => {
    const { container, handlers, getByText, queryByText } = setup({
      floorStatus: { terrace_main: { T25: "SET" } },
    });
    fireEvent.click(getByText("TERRACE"));
    expect(container.textContent).toContain("SET"); // strip on the T25 tile
    fireEvent.click(findTable(container, "T25"));
    expect(queryByText("SET FOR BITES")).toBeNull();
    fireEvent.click(getByText("UNSET"));
    expect(handlers.onCycleStatus).toHaveBeenCalledWith("terrace_main", "T25");
  });

  it("an occupied party's sheet carries the toggle next to its move/clear actions", () => {
    const { container, handlers, getByText } = setup();
    fireEvent.click(getByText("TERRACE"));
    fireEvent.click(findTable(container, "T23")); // WEISS's table
    getByText(/MOVE TO T9/); // still the party sheet…
    fireEvent.click(getByText("SET FOR BITES")); // …with the bites toggle
    expect(handlers.onCycleStatus).toHaveBeenCalledWith("terrace_main", "T23");
  });
});

describe("SEND SET → KITCHEN", () => {
  it("appears when a seated table is SET and forwards its board id", () => {
    const onSend = vi.fn();
    const { container, getByText } = setup({
      // T1 seated + SET (sendable); T4 SET but only reserved (not sendable)
      floorStatus: { dining_a: { T1: "SET", T4: "SET" } },
      onSendSetToKitchen: onSend,
    });
    fireEvent.click(getByText(/SEND SET → KITCHEN \(1\)/));
    expect(onSend).toHaveBeenCalledWith([1]);
    expect(container.textContent).toContain("SENT TO KITCHEN ✓");
  });

  it("hidden when nothing is both seated and SET", () => {
    const { queryByText } = setup({ onSendSetToKitchen: vi.fn() });
    expect(queryByText(/SEND SET → KITCHEN/)).toBeNull(); // T4 SET is reserved-only
  });
});
