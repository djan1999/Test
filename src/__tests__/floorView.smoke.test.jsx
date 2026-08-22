import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, within } from "@testing-library/react";
import FloorView from "../components/floor/FloorView.jsx";
import FloorMap from "../components/floor/FloorMap.jsx";
import KitchenFloorView from "../components/kitchen/KitchenFloorView.jsx";
import { buildDefaultFloorMaps } from "../utils/floorMaps.js";

// FLOOR view smoke: the FOH surface — tabs, ticker, two-zone taps, and the
// terrace actions folded in from the old TerracePanel.

const floorMaps = buildDefaultFloorMaps();

const boardTable = (id, extra = {}) => ({
  id, active: false, resName: "", resTime: "", guests: 0, restrictions: [], tableGroup: [], ...extra,
});

const tables = [
  boardTable(1, { active: true, resName: "NOVAK", guests: 2, resTime: "18:00", restrictions: [{ pos: 1, note: "shellfish" }], seats: [
    { id: 1, water: "—", pairing: "", floorPositions: {} },
    { id: 2, water: "—", pairing: "", floorPositions: {} },
  ] }),
  boardTable(4, { resName: "KOVAČ", guests: 4, resTime: "19:30" }),
  boardTable(9, { active: true, resName: "WEISS", guests: 4, restrictions: [{ pos: 2, note: "gluten" }], seats: [
    { id: 1, water: "XC", pairing: "Non-Alc", gender: "Mrs" },
    { id: 2, water: "OW", pairing: "Wine", gender: "Mr" },
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
  { id: "r3", table_id: 8, data: { resName: "HORVAT", guests: 2, visit_state: "terrace", terrace_table: "T24" } },
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
    // T1 ×2 + T9 ×4 occupied; T4 reserved → RES 1
    expect(container.textContent).toContain("COVERS 6");
    expect(container.textContent).toContain("SEATED 2");
    expect(container.textContent).toContain("RES 1");
    expect(container.textContent).toContain("SET 1");
    // FOH tables carry no names and no ×pax (per Djan) — the label ▲ is
    // retired and the restriction CODE at the red chair is the signal
    // instead. (The course readout DOES ride the tile now — but only when a
    // menu exists; this fixture passes none.)
    expect(container.textContent).not.toContain("×2");
    expect(container.textContent).not.toContain("NOVAK");
    expect(container.textContent).not.toContain("WEISS");
    expect(container.textContent).not.toContain("▲");
    expect(container.textContent).toContain("SHF"); // T1 P1 shellfish, at the chair
    // waters/pairings BY POSITION at T9's chairs — the HOUSE shortcuts as
    // stored, stacked water-over-pairing in the chair pill (Wine → WP)
    expect(container.textContent).toContain("XC");
    expect(container.textContent).toContain("NA");
    expect(container.textContent).toContain("OW");
    expect(container.textContent).toContain("WP");
  });

  it("a dining tap SELECTS only — no SET toggle, no sheet; the dock follows (per Djan, 21.08)", () => {
    const { container, handlers, getByText } = setup();
    fireEvent.click(findTable(container, "T1")); // occupied dining body
    expect(handlers.onCycleStatus).not.toHaveBeenCalled(); // peeking can't flip SET
    expect(getByText("[TABLE DOCK]").parentElement.textContent).toContain("T1");
  });

  it("a free dining table's tap selects too — no set control on an empty table (22.08)", () => {
    // The one dining tap that used to open a sheet was an ARRIVING table's
    // MARK SEATED. That state is gone, so the dining map has no sheet at all.
    const { container, handlers, getByText } = setup();
    fireEvent.click(findTable(container, "T8"));
    expect(handlers.onCycleStatus).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("MARK SEATED");
    const dock = getByText("[TABLE DOCK]").parentElement;
    expect(dock.textContent).toContain("NOT SEATED");
    expect(within(dock).queryByText("SET")).toBeNull(); // the old strip SET is gone
  });

  it("terrace tap: ONE surface — the dock carries the party actions, no sheet (22.08)", () => {
    const { container, handlers, getByText, queryByText } = setup();
    fireEvent.click(getByText("TERRACE"));
    expect(container.textContent).not.toContain("WEISS"); // no names on the floor
    expect(container.textContent).toContain("T9");        // the party's identity = its dining table
    expect(container.textContent).toContain("XC");        // the party's seat notes travel to the terrace table
    expect(container.textContent).not.toContain("LAST BITE"); // retired concept — stamp on r1 renders nothing
    fireEvent.click(findTable(container, "T23"));
    expect(queryByText("✕")).toBeNull();                  // the old bottom sheet is gone
    const dock = getByText("[TABLE DOCK]").parentElement;
    expect(dock.textContent).toContain("×4");             // pax in the dock header
    expect(dock.textContent).not.toContain("WEISS");
    fireEvent.click(within(dock).getByText(/MOVE TO T9/));
    expect(handlers.onMove).toHaveBeenCalledWith(reservations[0]);
    // free table → the assign picker in the dock (MURN waits, HORVAT is mid-move)
    fireEvent.click(findTable(container, "T21"));
    fireEvent.click(getByText(/MURN ×2/));
    expect(handlers.onAssign).toHaveBeenCalledWith(reservations[1], "T21");
  });

  it("a 'dining' party stays assignable — back OUT for the last course (per Djan, 15.07)", () => {
    const backOut = { id: "r4", table_id: 1, data: { resName: "NOVAK", guests: 2, visit_state: "dining" } };
    const { container, handlers, getByText } = setup({ reservations: [...reservations, backOut] });
    fireEvent.click(getByText("TERRACE"));
    fireEvent.click(findTable(container, "T21"));
    // the picker labels the dining party by its table, marked as a return
    fireEvent.click(getByText(/NOVAK ×2 · T1 ↩/));
    expect(handlers.onAssign).toHaveBeenCalledWith(backOut, "T21");
  });

});

describe("terrace CHANGE TABLE (re-seat on the terrace)", () => {
  it("dock CHANGE TABLE arms the move; a free table re-seats, the party's OWN table refuses", () => {
    const { container, handlers, getByText } = setup();
    fireEvent.click(getByText("TERRACE"));
    fireEvent.click(findTable(container, "T23")); // WEISS's table → dock
    fireEvent.click(getByText("CHANGE TABLE"));
    expect(container.textContent).toContain("TAP A TABLE FOR WEISS ×4");
    fireEvent.click(findTable(container, "T23")); // its own table — nothing to swap with
    expect(handlers.onAssign).not.toHaveBeenCalled();
    fireEvent.click(findTable(container, "T25")); // free → re-seat
    expect(handlers.onAssign).toHaveBeenCalledWith(reservations[0], "T25");
    expect(container.textContent).not.toContain("TAP A TABLE FOR");
  });

  it("CHANGE TABLE onto an OCCUPIED table swaps the two parties (22.08)", () => {
    const { container, handlers, getByText } = setup();
    fireEvent.click(getByText("TERRACE"));
    fireEvent.click(findTable(container, "T23")); // WEISS (on T23)
    fireEvent.click(getByText("CHANGE TABLE"));
    fireEvent.click(findTable(container, "T24")); // HORVAT's table → swap, not refuse
    expect(handlers.onAssign).toHaveBeenCalledWith(reservations[0], "T24");
    expect(handlers.onAssign).toHaveBeenCalledWith(reservations[2], "T23");
    expect(container.textContent).not.toContain("TAP A TABLE FOR");
  });

  it("CANCEL disarms without assigning", () => {
    const { container, handlers, getByText } = setup();
    fireEvent.click(getByText("TERRACE"));
    fireEvent.click(findTable(container, "T23"));
    fireEvent.click(getByText("CHANGE TABLE"));
    fireEvent.click(getByText("CANCEL"));
    fireEvent.click(findTable(container, "T25"));
    expect(handlers.onAssign).not.toHaveBeenCalled(); // free-table tap = plain dock select again
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
    expect(container.textContent).toContain("TAP A TABLE FOR ZUPAN ×3");
    // a stranded party has no live tile to hand the other party — occupied
    // stays refused for them, never a swap
    fireEvent.click(findTable(container, "T23"));
    expect(handlers.onAssign).not.toHaveBeenCalled();
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

describe("terrace SET → KITCHEN (same handshake as the dining room, from the dock)", () => {
  const MENU = [
    { position: 1, course_key: "amuse", menu: { name: "Amuse" }, is_active: true, is_snack: false, optional_flag: "", course_category: "main" },
  ];

  it("the dock's set button announces the party's next course AND turns the strip on", () => {
    const onSend = vi.fn();
    const { container, handlers, getByText } = setup({ menuCourses: MENU, onSendSetToKitchen: onSend });
    fireEvent.click(getByText("TERRACE"));
    fireEvent.click(findTable(container, "T23")); // WEISS's table → dock
    fireEvent.click(getByText(/SET → KITCHEN · Amuse/));
    // SET informs the kitchen: the party's board table (T9) gets the
    // courseReady handshake, exactly like a dining SEND
    expect(onSend).toHaveBeenCalledWith([9]);
    expect(handlers.onCycleStatus).toHaveBeenCalledWith("terrace_main", "T23");
    expect(container.textContent).toContain("SET → KITCHEN ✓");
  });

  it("an announced party's button reads UNSET — it clears, never double-sends", () => {
    const onSend = vi.fn();
    const onUnsetKitchen = vi.fn();
    const announced = tables.map((t) =>
      t.id === 9 ? { ...t, courseReady: { key: "amuse", index: 1, name: "Amuse" } } : t);
    const { container, handlers, getByText, queryByText } = setup({
      floorStatus: { terrace_main: { T23: "SET" } },
      tables: announced,
      menuCourses: MENU,
      onSendSetToKitchen: onSend,
      onUnsetKitchen,
    });
    fireEvent.click(getByText("TERRACE"));
    fireEvent.click(findTable(container, "T23"));
    expect(queryByText(/SET → KITCHEN ·/)).toBeNull(); // no second set press
    fireEvent.click(getByText(/UNSET · Amuse/));
    expect(onUnsetKitchen).toHaveBeenCalledWith(9);
    expect(handlers.onCycleStatus).toHaveBeenCalledWith("terrace_main", "T23");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("a free terrace table has NO set control — its dock is the assign picker", () => {
    const { container, getByText, queryByText } = setup({ menuCourses: MENU, onSendSetToKitchen: vi.fn() });
    fireEvent.click(getByText("TERRACE"));
    fireEvent.click(findTable(container, "T25")); // free
    getByText("[ASSIGN PARTY]");
    expect(queryByText("SET FOR BITES")).toBeNull();
    expect(queryByText(/SET → KITCHEN ·/)).toBeNull();
  });

  it("a leftover strip on a now-free table still offers UNSET so it can't get stuck", () => {
    const { container, handlers, getByText } = setup({
      floorStatus: { terrace_main: { T25: "SET" } },
      onSendSetToKitchen: vi.fn(),
    });
    fireEvent.click(getByText("TERRACE"));
    fireEvent.click(findTable(container, "T25"));
    fireEvent.click(getByText("UNSET")); // the dock's cleanup — the one surface
    expect(handlers.onCycleStatus).toHaveBeenCalledWith("terrace_main", "T25");
  });
});

describe("seat presentation — gender outlines + positional restrictions", () => {
  it("unrestricted chairs fill with the soft gender tint under the gender outline", () => {
    const { container } = setup({
      tables: tables.map((t) => t.id === 9 ? { ...t, restrictions: [] } : t),
    });
    // T9's P1 is Mrs (pink outline + soft pink fill), P2 is Mr (blue + soft blue)
    const mrs = container.querySelector('rect[stroke="#f9a8d4"]');
    const mr = container.querySelector('rect[stroke="#93c5fd"]');
    expect(mrs.getAttribute("fill")).toBe("#fce7f3");
    expect(mr.getAttribute("fill")).toBe("#dbeafe");
  });

  it("a restricted Mrs seat reads red-filled with the pink gender outline", () => {
    const { container } = setup({
      tables: tables.map((t) => t.id === 9
        ? { ...t, restrictions: [{ pos: 1, note: "gluten" }] }
        : t),
    });
    const pill = container.querySelector('rect[stroke="#f9a8d4"]');
    expect(pill).toBeTruthy();
    expect(pill.getAttribute("fill")).toBe("#b84a3a"); // signal.alert
  });

  it("kitchen register: seatPositionLabels renders chairs as P1/P2 blocks", () => {
    const { container } = render(
      <FloorMap
        map={floorMaps.maps.find((m) => m.id === "dining_a")}
        mode="service"
        tableState={{ T1: { status: "occupied", pax: 2 } }}
        restrictionsByLabel={{ T1: [{ pos: 1, note: "gluten" }] }}
        seatPositionLabels
      />,
    );
    const t1 = findTable(container, "T1");
    expect(t1.textContent).toContain("P1");
    expect(t1.textContent).toContain("P2");
    expect(t1.textContent).toContain("GLU"); // the restriction code still rides beside the block
  });

  it("terrace chairs mark restrictions by position from the party's BOARD table", () => {
    const { container, getByText } = setup();
    fireEvent.click(getByText("TERRACE"));
    // WEISS (board T9, gluten on P2) sits at T23 — the terrace chair carries
    // the live board restriction even though the reservation blob has none.
    const t23 = findTable(container, "T23");
    expect(t23.querySelector('rect[fill="#b84a3a"]')).toBeTruthy();
  });
});

describe("dining floor-invisible warning (a live party whose slot no tile claims)", () => {
  it("shows NOT ON THIS MAP when the party's tile was deleted mid-service", () => {
    const maps = JSON.parse(JSON.stringify(floorMaps));
    const dining = maps.maps.find((m) => m.id === maps.activeDiningMapId);
    dining.tables = dining.tables.filter((t) => t.label !== "T1");
    const { container, getByText } = setup({ floorMaps: maps });
    getByText("NOT ON THIS MAP");
    expect(container.textContent).toContain("NOVAK"); // board 1 is active
  });

  it("no banner when every live slot is claimed", () => {
    const { queryByText } = setup();
    expect(queryByText("NOT ON THIS MAP")).toBeNull();
  });
});

describe("seat swap — drag a chair onto another chair of the same table", () => {
  const mockBox = (container) => {
    const svg = container.querySelector("svg");
    // jsdom rects are all-zero; 400×368 box → 4px per map unit.
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 368, right: 400, bottom: 368 });
  };

  it("dropping P1 on P2 swaps those positions on the board table — a DINING drag is an identity swap (the chair is the plate position, so the kitchen ticket follows)", () => {
    const onSwapSeats = vi.fn();
    const { container } = setup({ onSwapSeats });
    mockBox(container);
    // Dining T1 at (8,8) 12×9: P1 chairs the W edge (~5.6,12.5 units → ~22,50px),
    // P2 the E edge (~22.4,12.5 units → ~90,50px).
    const seat = findTable(container, "T1").querySelector('[data-seat="0"]');
    fireEvent.pointerDown(seat, { clientX: 22, clientY: 50 });
    fireEvent.pointerMove(seat, { clientX: 60, clientY: 50 });
    fireEvent.pointerUp(seat, { clientX: 90, clientY: 50 });
    expect(onSwapSeats).toHaveBeenCalledWith(1, 1, 2, "dining_a:T1", { identity: true });
  });

  it("the KITCHEN dining map takes the same drag (per Djan) — identity swap, ticket position follows", () => {
    const onSwapSeats = vi.fn();
    const { container } = render(
      <KitchenFloorView
        mapKind="dining"
        floorMaps={floorMaps}
        floorStatus={{}}
        reservations={reservations}
        tables={tables}
        onSwapSeats={onSwapSeats}
      />,
    );
    mockBox(container);
    const seat = findTable(container, "T1").querySelector('[data-seat="0"]');
    fireEvent.pointerDown(seat, { clientX: 22, clientY: 50 });
    fireEvent.pointerMove(seat, { clientX: 60, clientY: 50 });
    fireEvent.pointerUp(seat, { clientX: 90, clientY: 50 });
    expect(onSwapSeats).toHaveBeenCalledWith(1, 1, 2, "dining_a:T1", { identity: true });
  });

  it("a drag that lands on empty floor swaps nothing", () => {
    const onSwapSeats = vi.fn();
    const { container } = setup({ onSwapSeats });
    mockBox(container);
    const seat = findTable(container, "T1").querySelector('[data-seat="0"]');
    fireEvent.pointerDown(seat, { clientX: 22, clientY: 50 });
    fireEvent.pointerMove(seat, { clientX: 22, clientY: 150 });
    fireEvent.pointerUp(seat, { clientX: 22, clientY: 150 });
    expect(onSwapSeats).not.toHaveBeenCalled();
  });

  it("a plain tap on a chair still resolves as the table tap (dock focus intact)", () => {
    const onSwapSeats = vi.fn();
    const { container, handlers, getByText } = setup({ onSwapSeats });
    mockBox(container);
    const seat = findTable(container, "T1").querySelector('[data-seat="0"]');
    fireEvent.pointerDown(seat, { clientX: 22, clientY: 50 });
    fireEvent.pointerUp(seat, { clientX: 22, clientY: 50 });
    fireEvent.click(seat); // bubbles to the table group
    expect(onSwapSeats).not.toHaveBeenCalled();
    expect(handlers.onCycleStatus).not.toHaveBeenCalled(); // taps never toggle now
    expect(getByText("[TABLE DOCK]").parentElement.textContent).toContain("T1");
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

describe("SEND SET → KITCHEN — no double-send of an already-announced course", () => {
  const menuCourses = [
    { position: 1, course_key: "amuse", menu: { name: "Amuse" }, is_active: true, is_snack: false, optional_flag: "", course_category: "main" },
    { position: 2, course_key: "main", menu: { name: "Main" }, is_active: true, is_snack: false, optional_flag: "", course_category: "main" },
  ];
  // T1 has already been sent for its next course (courseReady === its nextFire);
  // T9 is freshly SET and never sent.
  const withReady = tables.map((t) =>
    t.id === 1 ? { ...t, courseReady: { key: "amuse", index: 1, name: "Amuse" } } : t);

  it("an already-sent SET table is excluded from SEND and wears an amber ring", () => {
    const onSend = vi.fn();
    const { container, queryByText } = setup({
      floorStatus: { dining_a: { T1: "SET" } },
      tables: withReady,
      menuCourses,
      onSendSetToKitchen: onSend,
    });
    // Nothing left to send — T1 already holds the kitchen's SET banner.
    expect(queryByText(/SEND SET → KITCHEN/)).toBeNull();
    // …and it shows the amber ring (signal.warn) so staff see it's been sent.
    const t1 = findTable(container, "T1");
    expect(t1.querySelector('[stroke="#c49a4a"]')).toBeTruthy();
  });

  it("SEND forwards ONLY the table not yet announced (the new one), not the already-sent one", () => {
    const onSend = vi.fn();
    const { getByText } = setup({
      floorStatus: { dining_a: { T1: "SET", T9: "SET" } },
      tables: withReady, // T1 sent, T9 fresh
      menuCourses,
      onSendSetToKitchen: onSend,
    });
    fireEvent.click(getByText(/SEND SET → KITCHEN \(1\)/));
    expect(onSend).toHaveBeenCalledWith([9]); // T1 (already sent) is not re-fired
  });

  it("a fresh SET table (no courseReady) still sends and shows no ring", () => {
    const onSend = vi.fn();
    const { container, getByText } = setup({
      floorStatus: { dining_a: { T1: "SET" } },
      tables, // T1 has no courseReady
      menuCourses,
      onSendSetToKitchen: onSend,
    });
    const t1 = findTable(container, "T1");
    expect(t1.querySelector('[stroke="#c49a4a"]')).toBeNull(); // not sent → no ring
    fireEvent.click(getByText(/SEND SET → KITCHEN \(1\)/));
    expect(onSend).toHaveBeenCalledWith([1]);
  });
});

describe("FOH table dock (quick access beside the map)", () => {
  const menuCourses = [
    { position: 1, course_key: "amuse", menu: { name: "Amuse" }, is_active: true, is_snack: false, optional_flag: "", course_category: "main" },
    { position: 2, course_key: "brioche", menu: { name: "Brioche" }, is_active: true, is_snack: false, optional_flag: "", course_category: "main" },
  ];
  const withFired = tables.map((t) =>
    t.id === 1 ? { ...t, kitchenLog: { amuse: { firedAt: "19:47" } } } : t);
  const dockOf = (getByText) => getByText("[TABLE DOCK]").parentElement;

  it("a dining tap focuses the dock: course readout, restriction tags, no drink rows, no names", () => {
    const { container, handlers, getByText } = setup({ tables: withFired, menuCourses });
    expect(container.textContent).toContain("TAP A TABLE");
    fireEvent.click(findTable(container, "T1"));
    expect(handlers.onCycleStatus).not.toHaveBeenCalled(); // select-only tap
    const dock = dockOf(getByText);
    expect(dock.textContent).toContain("[COURSE · C1/2]");
    expect(dock.textContent).toContain("C01 / Amuse");   // NOW — what's on the table
    expect(dock.textContent).toContain("19:47");
    expect(dock.textContent).toContain("C02 / Brioche"); // NEXT
    // restriction tags stay; the per-seat drink rows are gone (the map's
    // chair pills carry those — per Djan, 22.08), and names never reach the floor
    expect(dock.textContent).toContain("[SHF]");
    expect(dock.textContent).not.toContain("[SEATS]");
    expect(dock.textContent).not.toContain("NOVAK");
  });

  it("the tile itself carries the course readout (C n/total), like the kitchen floor", () => {
    const { container } = setup({ tables: withFired, menuCourses });
    expect(findTable(container, "T1").textContent).toContain("C1/2");
  });

  it("a SET pressed kitchen/board-side (courseReady, NO strip) now shows on the floor", () => {
    const announced = tables.map((t) =>
      t.id === 1 ? { ...t, courseReady: { key: "amuse", index: 1, name: "Amuse" } } : t);
    const { container } = setup({ tables: announced, menuCourses }); // no strip for T1
    expect(findTable(container, "T1").querySelector('[stroke="#c49a4a"]')).toBeTruthy();
  });

  it("the ONE set button names the dish it announces, and turns the strip on", () => {
    const onSend = vi.fn();
    const { container, handlers, getByText } = setup({ tables: withFired, menuCourses, onSendSetToKitchen: onSend });
    fireEvent.click(findTable(container, "T1"));
    handlers.onCycleStatus.mockClear();
    fireEvent.click(within(dockOf(getByText)).getByText(/SET → KITCHEN · Brioche/));
    expect(onSend).toHaveBeenCalledWith([1]);
    expect(handlers.onCycleStatus).toHaveBeenCalledWith("dining_a", "T1");
  });

  it("once announced the button flips to UNSET — it clears the banner, never re-sends", () => {
    const announced = withFired.map((t) =>
      t.id === 1 ? { ...t, courseReady: { key: "brioche", index: 2, name: "Brioche" } } : t);
    const onSend = vi.fn();
    const onUnsetKitchen = vi.fn();
    const { container, getByText, queryByText } = setup({
      tables: announced, menuCourses, onSendSetToKitchen: onSend, onUnsetKitchen,
    });
    fireEvent.click(findTable(container, "T1"));
    const dock = dockOf(getByText);
    expect(within(dock).queryByText(/SET → KITCHEN/)).toBeNull(); // no second set press
    fireEvent.click(within(dock).getByText(/UNSET · Brioche/));
    expect(onUnsetKitchen).toHaveBeenCalledWith(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("dock extras: a P-chip toggles the seat's cheese; SEND merges into a pending SET popup", () => {
    const upd = vi.fn();
    const EXTRAS = [{ key: "cheese", id: "cheese", name: "Cheese", pairings: ["—"] }];
    // P2 already wants cheese (never sent) AND an unconfirmed SET banner sits
    // in the alert slot — the exact override case: neither may swallow the other.
    const withCheese = withFired.map((t) =>
      t.id === 1 ? {
        ...t,
        seats: [
          { id: 1, water: "—", pairing: "", floorPositions: {} },
          { id: 2, water: "—", pairing: "", extras: { cheese: { ordered: true, pairing: "—" } }, floorPositions: {} },
        ],
        kitchenAlert: { timestamp: "t0", tableName: null, seats: [], confirmed: false, course: { key: "brioche", index: 2, name: "Brioche" } },
      } : t);
    const { container, getByText } = setup({ tables: withCheese, menuCourses, optionalExtras: EXTRAS, upd });
    fireEvent.click(findTable(container, "T1"));
    const dock = dockOf(getByText);
    // toggle P1's cheese on → a seats updater lands on the board table
    fireEvent.click(within(dock).getAllByText("P1").find((el) => el.tagName === "BUTTON"));
    expect(upd).toHaveBeenCalledWith(1, "seats", expect.any(Function));
    const updater = upd.mock.calls.find((c) => c[1] === "seats")[2];
    const nextSeats = updater(withCheese.find((t) => t.id === 1).seats);
    expect(nextSeats.find((s) => s.id === 1).extras.cheese.ordered).toBe(true);
    // SEND ORDER → the alert write MERGES: the SET course survives the cheese call
    fireEvent.click(within(dock).getByText("SEND ORDER → KITCHEN"));
    const alertCall = upd.mock.calls.find((c) => c[1] === "kitchenAlert");
    expect(alertCall[0]).toBe(1);
    expect(alertCall[2].course).toEqual({ key: "brioche", index: 2, name: "Brioche" });
    expect(alertCall[2].seats.some((s) => (s.extras || []).some((e) => e.key === "cheese"))).toBe(true);
    expect(upd.mock.calls.find((c) => c[1] === "kitchenSent")).toBeTruthy();
  });

  it("a chair tap opens the board's QUICK ACCESS card in a side panel (22.08)", () => {
    const upd = vi.fn();
    const { container, handlers, getByText, queryByText } = setup({
      tables: withFired, menuCourses, upd, updSeat: vi.fn(),
    });
    fireEvent.click(findTable(container, "T1").querySelector('[data-seat="0"]'));
    // the chair tap selects — it neither toggles nor reads as a table tap
    expect(handlers.onCycleStatus).not.toHaveBeenCalled();
    getByText("[QUICK ACCESS · T1]");
    // the REAL board card renders in the panel — same editor as board mode
    expect(container.textContent).toContain("NOVAK");
    // ✕ closes it; the dock stays on the table
    fireEvent.click(getByText("✕"));
    expect(queryByText("[QUICK ACCESS · T1]")).toBeNull();
    expect(dockOf(getByText).textContent).toContain("T1");
    // a table-body tap never opens it
    fireEvent.click(findTable(container, "T1"));
    expect(queryByText("[QUICK ACCESS · T1]")).toBeNull();
  });

  it("the terrace dock follows the tapped party too — same info on both floors", () => {
    const withFired9 = tables.map((t) =>
      t.id === 9 ? { ...t, kitchenLog: { amuse: { firedAt: "20:02" } } } : t);
    const { container, getByText } = setup({ tables: withFired9, menuCourses });
    fireEvent.click(getByText("TERRACE"));
    fireEvent.click(findTable(container, "T23")); // WEISS's table → board 9
    const dock = dockOf(getByText);
    expect(dock.textContent).toContain("[COURSE · C1/2]");
    expect(dock.textContent).toContain("C01 / Amuse");
  });
});
