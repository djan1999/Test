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
  // out on the terrace (the last_bite_fired_at stamp is a retired field old
  // rows may still carry — it must change nothing anywhere)
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
    expect(container.textContent).not.toContain("LAST BITE"); // retired concept — stamp on r1 renders nothing
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

describe("stranded terrace parties (no reachable tile)", () => {
  it("a party whose terrace label vanished from the map gets a rescue banner with MOVE + CHANGE TABLE", () => {
    const stranded = { id: "r9", table_id: 6, data: { resName: "ZUPAN", guests: 3, visit_state: "terrace", terrace_table: "T99" } };
    const { container, handlers, getByText } = setup({ reservations: [...reservations, stranded] });
    fireEvent.click(getByText("TERRACE"));
    // no tile named T99 → the banner is the only way back in
    fireEvent.click(getByText(/MOVE TO T6/));
    expect(handlers.onMove).toHaveBeenCalledWith(stranded);
    fireEvent.click(getByText("CHANGE TABLE"));
    expect(container.textContent).toContain("TAP A FREE TABLE FOR ZUPAN ×3");
    fireEvent.click(findTable(container, "T25")); // free tile → re-assign
    expect(handlers.onAssign).toHaveBeenCalledWith(stranded, "T25");
  });

  it("a table-less terrace row (old armed rows included) self-heals to booked — picker, not banner", () => {
    // Before 10.07 an ARMED party could sit in 'terrace' with no table; the
    // arming concept is retired, so visitStateOf heals ANY table-less
    // terrace row to 'booked' — it re-enters the ASSIGN PARTY picker.
    const noTable = { id: "r8", table_id: 7, data: { resName: "KRANJC", guests: 2, visit_state: "terrace", terrace_table: null, last_bite_fired_at: "2026-07-10T20:00:00Z" } };
    const { container, handlers, getByText, queryByText } = setup({ reservations: [...reservations, noTable] });
    fireEvent.click(getByText("TERRACE"));
    expect(queryByText(/MOVE TO T7/)).toBeNull();          // no rescue banner
    expect(container.textContent).not.toContain("LAST BITE");
    fireEvent.click(findTable(container, "T25"));          // free tile → picker
    fireEvent.click(getByText(/KRANJC ×2/));
    expect(handlers.onAssign).toHaveBeenCalledWith(noTable, "T25");
  });
});

describe("terrace SET → KITCHEN (same handshake as the dining room)", () => {
  it("an occupied party's sheet sends SET for the next course AND turns the strip on", () => {
    const onSend = vi.fn();
    const { container, handlers, getByText } = setup({ onSendSetToKitchen: onSend });
    fireEvent.click(getByText("TERRACE"));
    fireEvent.click(findTable(container, "T23")); // WEISS's table
    getByText(/MOVE TO T9/); // still the party sheet…
    fireEvent.click(getByText("SET → KITCHEN"));
    // …and SET informs the kitchen: the party's board table (T9) gets the
    // courseReady handshake, exactly like a dining SEND
    expect(onSend).toHaveBeenCalledWith([9]);
    expect(handlers.onCycleStatus).toHaveBeenCalledWith("terrace_main", "T23");
    expect(container.textContent).toContain("SET → KITCHEN ✓");
  });

  it("an already-SET party offers UNSET instead — no double-send", () => {
    const onSend = vi.fn();
    const { container, handlers, getByText, queryByText } = setup({
      floorStatus: { terrace_main: { T23: "SET" } },
      onSendSetToKitchen: onSend,
    });
    fireEvent.click(getByText("TERRACE"));
    expect(container.textContent).toContain("SET"); // strip on the T23 tile
    fireEvent.click(findTable(container, "T23"));
    expect(queryByText("SET → KITCHEN")).toBeNull();
    fireEvent.click(getByText("UNSET"));
    expect(handlers.onCycleStatus).toHaveBeenCalledWith("terrace_main", "T23");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("a free terrace table has NO set control ('set for bites' is retired)", () => {
    const { container, getByText, queryByText } = setup({ onSendSetToKitchen: vi.fn() });
    fireEvent.click(getByText("TERRACE"));
    fireEvent.click(findTable(container, "T25")); // free
    getByText("ASSIGN PARTY"); // the sheet is purely the assign picker
    expect(queryByText("SET FOR BITES")).toBeNull();
    expect(queryByText("SET → KITCHEN")).toBeNull();
  });

  it("a leftover strip on a now-free table still offers UNSET so it can't get stuck", () => {
    const { container, handlers, getByText } = setup({
      floorStatus: { terrace_main: { T25: "SET" } },
      onSendSetToKitchen: vi.fn(),
    });
    fireEvent.click(getByText("TERRACE"));
    fireEvent.click(findTable(container, "T25"));
    fireEvent.click(getByText("UNSET"));
    expect(handlers.onCycleStatus).toHaveBeenCalledWith("terrace_main", "T25");
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
