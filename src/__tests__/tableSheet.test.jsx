// ── Table side sheet ──────────────────────────────────────────────────────────
// The sheet replaced the full-screen detail view, so the contract that used to
// be "a route exists" is now "a panel opens over a board that never unmounts".
// These pin the parts an operator depends on mid-service: the way out (×,
// scrim, Esc), the writes landing immediately with a receipt, the state gating
// on the action grid, and the fact that MOVE/SWAP/JOIN never offer a bare list
// of table numbers.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import TableSheet from "../components/service/TableSheet.jsx";
import { candidateReason } from "../components/service/TablePickerModal.jsx";

const COURSES = [
  { course_key: "amuse",   position: 1, is_active: true, menu: { name: "Amuse Bouche" } },
  { course_key: "starter", position: 2, is_active: true, menu: { name: "Sea Bass" } },
  { course_key: "main",    position: 3, is_active: true, menu: { name: "Venison" } },
];

const seat = id => ({
  id, water: "—", pairing: "", aperitifs: [], glasses: [], cocktails: [],
  spirits: [], beers: [], extras: {}, optionalPairings: {}, floorPositions: {},
});

const baseTable = (over = {}) => ({
  id: 4,
  active: true,
  guests: 2,
  resName: "Weber",
  resTime: "20:00",
  arrivedAt: "20:06",
  menuType: "long",
  lang: "en",
  guestType: "",
  rooms: [],
  birthday: false,
  notes: "",
  restrictions: [],
  bottleWines: [],
  seats: [seat(1), seat(2)],
  kitchenLog: { amuse: { firedAt: "20:20" } },
  tableGroup: [],
  displayLabel: "T04",
  ...over,
});

const OTHER_TABLES = [
  { id: 4, displayLabel: "T04", active: true, resName: "Weber", resTime: "20:00", seats: [] },
  { id: 7, displayLabel: "T07", active: false, resName: "", resTime: "", seats: [] },
  { id: 8, displayLabel: "T08", active: false, resName: "Novak", resTime: "21:15", guests: 3, seats: [] },
  { id: 9, displayLabel: "T09", active: true, arrivedAt: "19:40", resName: "Kos", guests: 5, seats: [] },
];

const setup = (over = {}, props = {}) => {
  const handlers = {
    onClose: vi.fn(),
    upd: vi.fn(),
    updSeat: vi.fn(),
    updBooking: vi.fn(),
    onMarkSeated: vi.fn(),
    onMarkArriving: vi.fn(),
    onSetKitchen: vi.fn(),
    onUnsetKitchen: vi.fn(),
    onMoveTable: vi.fn(async () => ({ ok: true })),
    onJoinTable: vi.fn(async () => ({ ok: true })),
    onSplitTable: vi.fn(async () => ({ ok: true })),
    onOpenTicket: vi.fn(),
    onClearTable: vi.fn(async () => ({ ok: true })),
  };
  const view = render(
    <TableSheet
      table={baseTable(over)}
      tables={OTHER_TABLES}
      reservations={[]}
      menuCourses={COURSES}
      wines={[{ id: "w1", name: "Rebula", producer: "Klinec", vintage: "2021", byGlass: true }]}
      cocktails={[{ id: "c1", name: "Negroni", notes: "bitter" }]}
      spirits={[{ id: "s1", name: "Negrita Rum", notes: "dark" }]}
      beers={[{ id: "b1", name: "Human Fish Lager", notes: "pale" }]}
      reservationOnTable={() => null}
      seatCapOf={() => 4}
      {...handlers}
      {...props}
    />,
  );
  return { ...view, ...handlers };
};

beforeEach(() => { vi.clearAllMocks(); });

describe("TableSheet — chrome", () => {
  it("reads the party back in one header line and closes from the ×", () => {
    const { onClose } = setup();
    expect(screen.getByText("TABLE_04")).toBeTruthy();
    expect(screen.getByText("Weber")).toBeTruthy();
    expect(screen.getByText("LIVE 20:06")).toBeTruthy();
    expect(screen.getByText("2 COVERS · 20:00 → 20:06")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Close table sheet"));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes when the scrim is clicked", () => {
    const { container, onClose } = setup();
    fireEvent.click(container.querySelector("[data-table-sheet-scrim]"));
    expect(onClose).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("names every joined member of a combined booking in the header", () => {
    setup({ tableGroup: [4, 8] });
    expect(screen.getByText("+T08")).toBeTruthy();
  });

  it("only renders ONE sheet — a different table swaps the content in place", () => {
    const { container, rerender } = setup();
    rerender(
      <TableSheet
        table={baseTable({ id: 8, displayLabel: "T08", resName: "Novak" })}
        tables={OTHER_TABLES}
        menuCourses={COURSES}
        onClose={() => {}}
        upd={() => {}}
        updSeat={() => {}}
        updBooking={() => {}}
      />,
    );
    expect(container.querySelectorAll("[data-table-sheet]").length).toBe(1);
    expect(screen.getByText("TABLE_08")).toBeTruthy();
    expect(screen.queryByText("TABLE_04")).toBeNull();
  });
});

describe("TableSheet — primary action", () => {
  it("offers MARK SEATED to a party that is not seated yet, stamped with the time", () => {
    const { onMarkSeated } = setup({ active: false, arrivedAt: null });
    const button = screen.getByText(/^MARK SEATED — \d{2}:\d{2}$/);
    fireEvent.click(button);
    expect(onMarkSeated).toHaveBeenCalled();
  });

  it("withdraws MARK SEATED once the party is seated", () => {
    setup();
    expect(screen.queryByText(/MARK SEATED/)).toBeNull();
  });
});

describe("TableSheet — courses", () => {
  it("shows menu position, the quiet-pass clock and marks the next course", () => {
    setup();
    expect(screen.getByText("COURSE_02/03")).toBeTruthy();
    expect(screen.getByText(/LAST FIRE \d+ MIN AGO/)).toBeTruthy();
    expect(screen.getByText("NEXT")).toBeTruthy();
  });

  it("SETS the next course — service cannot fire, only the pass can", () => {
    const { onSetKitchen } = setup();
    fireEvent.click(screen.getByText("SET — Sea Bass"));
    expect(onSetKitchen).toHaveBeenCalled();
    expect(screen.getByText("SET — SEA BASS")).toBeTruthy();
  });

  it("offers no way to fire a course from the floor", () => {
    setup();
    expect(screen.queryByText(/^FIRE/)).toBeNull();
    // …and the action grid no longer duplicates the same signal.
    expect(screen.queryByText("SET → KITCHEN")).toBeNull();
    expect(screen.queryByText("UNSET")).toBeNull();
  });

  it("shows the standing set on its course, and goes inert rather than re-setting", () => {
    setup({ courseReady: { key: "starter", index: 2, name: "Sea Bass", at: "20:41" } });
    expect(screen.getByText("SET")).toBeTruthy();          // marked in the list
    const button = screen.getByText("SET ✓ 20:41 — Sea Bass");
    expect(button.disabled).toBe(true);
  });

  it("UNDO takes the SET back, not a fire", () => {
    const { onUnsetKitchen } = setup({ courseReady: { key: "starter", index: 2, name: "Sea Bass", at: "20:41" } });
    expect(screen.getByLabelText("Take back SET — Sea Bass")).toBeTruthy();
    fireEvent.click(screen.getByText("UNDO"));
    expect(onUnsetKitchen).toHaveBeenCalled();
    expect(screen.getByText("UNSET — SEA BASS")).toBeTruthy();
  });

  it("has nothing to undo when nothing is set", () => {
    setup();
    expect(screen.getByText("UNDO").disabled).toBe(true);
  });

  it("ignores a set whose course the kitchen has already fired", () => {
    setup({ courseReady: { key: "amuse", index: 1, name: "Amuse Bouche", at: "20:15" } });
    expect(screen.getByText("SET — Sea Bass")).toBeTruthy();   // moved on to the next
    expect(screen.getByText("UNDO").disabled).toBe(true);
  });

  it("goes inert and reads ALL COURSES FIRED at the end of the menu", () => {
    setup({ kitchenLog: { amuse: { firedAt: "20:20" }, starter: { firedAt: "20:45" }, main: { firedAt: "21:10" } } });
    const done = screen.getByText("ALL COURSES FIRED");
    expect(done.disabled).toBe(true);
    expect(screen.queryByText("NEXT")).toBeNull();
  });
});

describe("TableSheet — no Quick Access overlap", () => {
  it("carries no quick-aperitif shortcuts — those stay on the board card", () => {
    // The sheet is table-level. Per-seat aperitif work belongs to the card's
    // Quick Access and to TICKET & MENUS; duplicating it here gave the same
    // party three editors.
    setup({}, { aperitifOptions: [{ label: "SPRITZ", searchKey: "spritz" }] });
    expect(screen.queryByText("[QUICK APERITIF]")).toBeNull();
    expect(screen.queryByText("SPRITZ")).toBeNull();
    // Table-level drink work is still here.
    expect(screen.getByText("[BEVERAGES]")).toBeTruthy();
  });

  it("carries no water controls — water is per-seat work on the card", () => {
    setup();
    expect(screen.queryByText("[WATER & WINE]")).toBeNull();
    ["XC", "XW", "OC", "OW"].forEach(o => expect(screen.queryByText(o)).toBeNull());
  });
});

describe("TableSheet — booking chips", () => {
  it("writes a menu change straight back to the reservation", () => {
    const { updBooking } = setup();
    fireEvent.click(screen.getByText("SHORT"));
    expect(updBooking).toHaveBeenCalledWith("menuType", "short");
    expect(screen.getByText("MENU — SHORT")).toBeTruthy();
  });

  it("writes the language and the cake flag", () => {
    const { updBooking } = setup();
    fireEvent.click(screen.getByText("SLO"));
    expect(updBooking).toHaveBeenCalledWith("lang", "si");
    fireEvent.click(screen.getByText("[CAKE]"));
    expect(updBooking).toHaveBeenCalledWith("birthday", true);
  });

  it("reveals the room field only for a hotel booking, and clears rooms leaving it", () => {
    const { updBooking, rerender } = setup({ guestType: "hotel", rooms: ["214"] });
    const room = screen.getByLabelText("Hotel room number");
    fireEvent.blur(room, { target: { value: "301" } });
    expect(updBooking).toHaveBeenCalledWith("rooms", ["301"]);
    expect(updBooking).toHaveBeenCalledWith("room", "301");

    rerender(
      <TableSheet
        table={baseTable()}
        tables={OTHER_TABLES}
        menuCourses={COURSES}
        onClose={() => {}} upd={() => {}} updSeat={() => {}} updBooking={() => {}}
        onFire={() => {}} onUnfire={() => {}}
      />,
    );
    expect(screen.queryByLabelText("Hotel room number")).toBeNull();
  });
});

describe("TableSheet — restrictions by seat", () => {
  it("says so plainly when nothing is recorded", () => {
    setup();
    expect(screen.getByText("NONE RECORDED")).toBeTruthy();
  });

  it("adds a restriction to a chosen seat through the inline panel", () => {
    const { updBooking } = setup();
    fireEvent.click(screen.getByText("+ ADD"));
    expect(screen.getByText("PICK A POSITION FIRST")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Restriction for position 2"));
    fireEvent.click(screen.getByText("Gluten Free"));
    expect(updBooking).toHaveBeenCalledWith("restrictions", [{ pos: 2, note: "gluten" }]);
    // The panel closes on the pick — the operator is done in one gesture.
    expect(screen.queryByText("Gluten Free")).toBeNull();
  });

  it("removes a restriction when its tag is tapped", () => {
    const { upd } = setup({ restrictions: [{ pos: 1, note: "vegan" }, { pos: 2, note: "nut" }] });
    expect(screen.getByText(/\[Vegan\] P1/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Remove Vegan from position 1"));
    expect(upd).toHaveBeenCalledWith("restrictions", [{ pos: 2, note: "nut" }]);
  });
});

describe("TableSheet — beverages", () => {
  const search = (q) => fireEvent.change(screen.getByLabelText("Search beverages"), { target: { value: q } });

  it("waits for two characters before offering matches", () => {
    setup();
    search("r");
    expect(screen.queryByText("GLASS")).toBeNull();
    search("reb");
    expect(screen.getByText("GLASS")).toBeTruthy();
    expect(screen.getByText("BOTTLE")).toBeTruthy();
  });

  it("searches the whole catalog, not only wine", () => {
    setup();
    search("negro");
    expect(screen.getByText("Negroni")).toBeTruthy();
    search("human");
    expect(screen.getByText("Human Fish Lager")).toBeTruthy();
    search("negri");
    expect(screen.getByText("Negrita Rum")).toBeTruthy();
  });

  it("offers GLASS/BOTTLE for wine and a single ADD for everything else", () => {
    setup();
    search("negro");
    expect(screen.getByText("ADD")).toBeTruthy();
    expect(screen.queryByText("GLASS")).toBeNull();
  });

  it("offers GLASS and BOTTLE on every wine, whatever the printed list says", () => {
    // `byGlass` describes the printed list, not what the room can pour. A
    // bottle-only wine still goes out by the glass when a guest asks.
    setup({}, { wines: [
      { id: "w1", name: "Rebula", producer: "Klinec", vintage: "2021", byGlass: true },
      { id: "w2", name: "Rebula Ortodox", producer: "Movia", vintage: "2018", byGlass: false },
    ] });
    search("rebula");
    expect(screen.getAllByText("BOTTLE")).toHaveLength(2);
    expect(screen.getAllByText("GLASS")).toHaveLength(2);
  });

  it("scrolls the results instead of hiding everything past the fourth", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      id: `w${i}`, name: `Rebula ${i}`, producer: "Klinec", vintage: "2021", byGlass: true,
    }));
    const { container } = setup({}, { wines: many });
    search("rebula");
    const list = container.querySelector("[data-drink-results]");
    expect(list.style.overflowY).toBe("auto");
    expect(list.style.maxHeight).toBeTruthy();
    expect(container.querySelectorAll("[data-drink-results] button").length).toBe(24); // 12 × GLASS+BOTTLE
  });

  it("forgives accents and typos, and does not care about word order", () => {
    setup({}, { wines: [{ id: "w1", name: "Šipon", producer: "Klinec", vintage: "2021" }] });
    search("sipon");                      // no diacritic on the keyboard
    expect(screen.getByText("Šipon")).toBeTruthy();
    search("sippon");                     // fat finger
    expect(screen.getByText("Šipon")).toBeTruthy();
    search("klinec sip");                 // producer first
    expect(screen.getByText("Šipon")).toBeTruthy();
  });

  it("sends a GLASS to the party's glasses, never to the table's bottles", () => {
    // bottleWines is what the menu, summary and archive read as "bottles for
    // the table" — a by-the-glass pour sent there came back as a bottle.
    const { upd, updSeat } = setup({}, { drinkPhase: undefined });
    search("reb");
    fireEvent.click(screen.getByText("WITH MENU"));
    fireEvent.click(screen.getByText("GLASS"));
    expect(updSeat).toHaveBeenCalledWith(1, "glasses", [expect.objectContaining({ name: "Rebula", byGlass: true })]);
    expect(updSeat).toHaveBeenCalledWith(2, "glasses", [expect.objectContaining({ name: "Rebula", byGlass: true })]);
    expect(upd).not.toHaveBeenCalledWith("bottleWines", expect.anything());
  });

  it("sends a BOTTLE to the table, since a bottle is shared", () => {
    const { upd } = setup();
    search("reb");
    fireEvent.click(screen.getByText("BOTTLE"));
    expect(upd).toHaveBeenCalledWith("bottleWines", [expect.objectContaining({ name: "Rebula", byGlass: false })]);
  });

  it("lands a pick as an APERITIF by default", () => {
    const { updSeat } = setup();
    search("negro");
    fireEvent.click(screen.getByText("ADD"));
    expect(updSeat).toHaveBeenCalledWith(1, "aperitifs", [expect.objectContaining({ name: "Negroni" })]);
  });

  it("lands it with the menu once the phase is switched", () => {
    const { updSeat } = setup();
    fireEvent.click(screen.getByText("WITH MENU"));
    search("negro");
    fireEvent.click(screen.getByText("ADD"));
    expect(updSeat).toHaveBeenCalledWith(1, "cocktails", [expect.objectContaining({ name: "Negroni" })]);
    expect(screen.getByText("WITH MENU · PARTY — NEGRONI")).toBeTruthy();
  });

  it("routes each beverage type to its own list with the menu", () => {
    const { updSeat } = setup();
    fireEvent.click(screen.getByText("WITH MENU"));
    search("human");
    fireEvent.click(screen.getByText("ADD"));
    expect(updSeat).toHaveBeenCalledWith(1, "beers", [expect.objectContaining({ name: "Human Fish Lager" })]);
  });

  it("reads the party's drinks back with how many seats hold each", () => {
    const { container } = setup({
      bottleWines: [{ name: "Rebula", producer: "Klinec", byGlass: false }],
      seats: [
        { ...seat(1), aperitifs: [{ name: "Negroni" }], glasses: [{ name: "Rebula", byGlass: true }] },
        { ...seat(2), aperitifs: [{ name: "Negroni" }] },
      ],
    });
    const rowText = (tag) => [...container.querySelectorAll(`[data-drink-row="${tag}"]`)]
      .map(el => el.textContent);
    // Two seats hold the Negroni, one holds the glass of Rebula, and the
    // table's own bottle carries no per-seat count at all.
    expect(rowText("APERITIF")).toEqual([expect.stringContaining("Negroni · 2/2")]);
    expect(rowText("GLASS")).toEqual([expect.stringContaining("Rebula · 1/2")]);
    expect(rowText("BOTTLE")).toEqual([expect.stringContaining("Rebula · Klinec")]);
    expect(rowText("BOTTLE")[0]).not.toMatch(/\d\/\d/);
  });

  it("takes a per-seat drink off every seat at once", () => {
    const { updSeat } = setup({
      seats: [
        { ...seat(1), aperitifs: [{ name: "Negroni" }] },
        { ...seat(2), aperitifs: [{ name: "Negroni" }] },
      ],
    });
    fireEvent.click(screen.getByLabelText("Remove Negroni"));
    expect(updSeat).toHaveBeenCalledWith(1, "aperitifs", []);
    expect(updSeat).toHaveBeenCalledWith(2, "aperitifs", []);
  });

  it("says so when the party has ordered nothing", () => {
    setup();
    expect(screen.getByText("NONE ORDERED")).toBeTruthy();
  });
});

describe("TableSheet — beverages, per seat", () => {
  const search = (q) => fireEvent.change(screen.getByLabelText("Search beverages"), { target: { value: q } });

  it("writes a pick to ONE seat when that seat is the target", () => {
    const { updSeat } = setup();
    fireEvent.click(screen.getByLabelText("Drinks for position 2"));
    search("negro");
    fireEvent.click(screen.getByText("ADD"));
    expect(updSeat).toHaveBeenCalledTimes(1);
    expect(updSeat).toHaveBeenCalledWith(2, "aperitifs", [expect.objectContaining({ name: "Negroni" })]);
    expect(screen.getByText("APERITIF · P2 — NEGRONI")).toBeTruthy();
  });

  it("goes back to the whole party when the seat is deselected", () => {
    const { updSeat } = setup();
    fireEvent.click(screen.getByLabelText("Drinks for position 2"));
    fireEvent.click(screen.getByLabelText("Drinks for position 2"));   // toggle off
    search("negro");
    fireEvent.click(screen.getByText("ADD"));
    expect(updSeat).toHaveBeenCalledTimes(2);
  });

  it("reads back only that seat's drinks, uncounted", () => {
    const { container } = setup({
      seats: [
        { ...seat(1), aperitifs: [{ name: "Negroni" }] },
        { ...seat(2), aperitifs: [{ name: "Spritz" }] },
      ],
    });
    fireEvent.click(screen.getByLabelText("Drinks for position 2"));
    const rows = [...container.querySelectorAll('[data-drink-row="APERITIF"]')].map(el => el.textContent);
    expect(rows).toEqual([expect.stringContaining("Spritz")]);
    expect(rows[0]).not.toMatch(/\d\/\d/);              // one seat — nothing to count
  });

  it("removes from that seat alone, leaving the rest of the party", () => {
    const { updSeat } = setup({
      seats: [
        { ...seat(1), aperitifs: [{ name: "Negroni" }] },
        { ...seat(2), aperitifs: [{ name: "Negroni" }] },
      ],
    });
    fireEvent.click(screen.getByLabelText("Drinks for position 2"));
    fireEvent.click(screen.getByLabelText("Remove Negroni"));
    expect(updSeat).toHaveBeenCalledTimes(1);
    expect(updSeat).toHaveBeenCalledWith(2, "aperitifs", []);
  });

  it("still shows the table's bottles under a single seat — a bottle is shared", () => {
    const { container } = setup({ bottleWines: [{ name: "Rebula", producer: "Klinec" }] });
    fireEvent.click(screen.getByLabelText("Drinks for position 1"));
    expect(container.querySelectorAll('[data-drink-row="BOTTLE"]')).toHaveLength(1);
  });

  it("says which seat is empty rather than a generic nothing", () => {
    setup();
    fireEvent.click(screen.getByLabelText("Drinks for position 2"));
    expect(screen.getByText("NONE ON P2")).toBeTruthy();
  });

  it("offers no seat scope on a table of one", () => {
    setup({ guests: 1, seats: [seat(1)] });
    expect(screen.queryByLabelText("Drinks for the whole party")).toBeNull();
  });
});

describe("TableSheet — notes", () => {
  it("commits the staff note on blur, not on every keystroke", () => {
    const { updBooking } = setup();
    fireEvent.change(screen.getByLabelText("Staff note"), { target: { value: "anniversary" } });
    expect(updBooking).not.toHaveBeenCalled();
    fireEvent.blur(screen.getByLabelText("Staff note"));
    expect(updBooking).toHaveBeenCalledWith("notes", "anniversary");
  });

  it("carries no kitchen note — the concept is gone", () => {
    setup();
    expect(screen.queryByLabelText("Kitchen note")).toBeNull();
    expect(screen.queryByText("[KITCHEN NOTE]")).toBeNull();
  });
});

describe("TableSheet — action grid", () => {
  it("shows only the actions the table's state allows", () => {
    setup();
    expect(screen.getByText("MOVE TABLE")).toBeTruthy();
    expect(screen.getByText("SWAP TABLES")).toBeTruthy();
    expect(screen.getByText("JOIN TABLE +")).toBeTruthy();
    expect(screen.getByText("CLEAR TABLE")).toBeTruthy();
    expect(screen.queryByText("MARK ARRIVING")).toBeNull();
  });

  it("leaves setting to the COURSES panel rather than duplicating it here", () => {
    // SET used to sit in the grid as well, which meant two buttons for one
    // signal — and the grid one couldn't say WHICH course it would set.
    setup({ courseReady: { key: "starter", index: 2, name: "Sea Bass", at: "20:40" } });
    expect(screen.queryByText("SET → KITCHEN")).toBeNull();
    expect(screen.queryByText("UNSET")).toBeNull();
  });

  it("offers MARK ARRIVING to a party still on the terrace", () => {
    const { onMarkArriving } = setup({ _visit: { visit: "terrace", terraceLabel: "TR2" } });
    fireEvent.click(screen.getByText("MARK ARRIVING"));
    expect(onMarkArriving).toHaveBeenCalled();
  });

  it("offers SPLIT — never a partial move — on a combined booking", async () => {
    const { onSplitTable } = setup({ tableGroup: [4, 8] });
    expect(screen.queryByText("MOVE TABLE")).toBeNull();
    fireEvent.click(screen.getByText("SPLIT T04+T08"));
    expect(onSplitTable).toHaveBeenCalled();
  });
});

describe("TableSheet — pickers and confirms", () => {
  it("gives every candidate table a reason, not a bare number", () => {
    setup();
    fireEvent.click(screen.getByText("MOVE TABLE"));
    const dialog = screen.getByRole("dialog", { name: "[MOVE TABLE]" });
    expect(within(dialog).getByText("FREE")).toBeTruthy();
    expect(within(dialog).getByText("HELD 21:15 — NOVAK (3)")).toBeTruthy();
    expect(within(dialog).getByText("LIVE — KOS (5)")).toBeTruthy();
  });

  it("moves to the picked table and reports it", async () => {
    const { onMoveTable } = setup();
    fireEvent.click(screen.getByText("MOVE TABLE"));
    const dialog = screen.getByRole("dialog", { name: "[MOVE TABLE]" });
    fireEvent.click(within(dialog).getByText("T07"));
    expect(onMoveTable).toHaveBeenCalledWith(7, "auto");
    expect(await screen.findByText("MOVED — T07")).toBeTruthy();
  });

  it("keeps the picker open when a move is refused, so the retry is one tap", async () => {
    setup({}, { onMoveTable: vi.fn(async () => ({ ok: false, reason: "persist-failed" })) });
    fireEvent.click(screen.getByText("MOVE TABLE"));
    fireEvent.click(within(screen.getByRole("dialog", { name: "[MOVE TABLE]" })).getByText("T07"));
    expect(await screen.findByText("MOVE REFUSED")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "[MOVE TABLE]" })).toBeTruthy();
  });

  it("only lets JOIN take a genuinely free table", () => {
    setup();
    fireEvent.click(screen.getByText("JOIN TABLE +"));
    const dialog = screen.getByRole("dialog", { name: "[JOIN TABLE]" });
    expect(within(dialog).getByText("T07").closest("button").disabled).toBe(false);
    expect(within(dialog).getByText("T08").closest("button").disabled).toBe(true);
    expect(within(dialog).getByText("T09").closest("button").disabled).toBe(true);
  });

  it("states the consequence and the way back before clearing a table", async () => {
    const { onClearTable } = setup();
    fireEvent.click(screen.getByText("CLEAR TABLE"));
    const dialog = screen.getByRole("alertdialog", { name: "[CLEAR TABLE]" });
    expect(within(dialog).getByText(/takes Weber off the live board/)).toBeTruthy();
    expect(within(dialog).getByText(/can be restored/)).toBeTruthy();
    fireEvent.click(within(dialog).getByText("CLEAR TABLE"));
    expect(onClearTable).toHaveBeenCalled();
  });
});

describe("candidateReason", () => {
  it("prefers who holds a table over how many seats it has", () => {
    expect(candidateReason({ table: { active: true, resName: "Kos", guests: 5 } }))
      .toEqual({ text: "LIVE — KOS (5)", tone: "live" });
    expect(candidateReason({ table: { resName: "Weber", resTime: "20:30", guests: 7 } }))
      .toEqual({ text: "HELD 20:30 — WEBER (7)", tone: "held" });
  });

  it("warns when a free table is too small for the party", () => {
    expect(candidateReason({ table: {}, seatCap: 4, partySize: 6 }))
      .toEqual({ text: "SEATS 4 — PARTY 6", tone: "tight" });
  });

  it("says how long a free table stays free", () => {
    expect(candidateReason({ table: {}, nextBooking: "21:00" }))
      .toEqual({ text: "FREE UNTIL 21:00", tone: "free" });
    expect(candidateReason({ table: {} })).toEqual({ text: "FREE", tone: "free" });
  });
});
