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
  kitchenNote: "",
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
    onFire: vi.fn(),
    onUnfire: vi.fn(),
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
      aperitifOptions={[{ label: "SPRITZ", searchKey: "spritz" }]}
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
        onFire={() => {}}
        onUnfire={() => {}}
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
    expect(screen.getByText("FIRE — Sea Bass")).toBeTruthy();
  });

  it("fires the next course and confirms with a toast", () => {
    const { onFire } = setup();
    fireEvent.click(screen.getByText("FIRE — Sea Bass"));
    expect(onFire).toHaveBeenCalledWith("starter");
    expect(screen.getByText("FIRED — SEA BASS")).toBeTruthy();
  });

  it("UNDO takes back the last fired course", () => {
    const { onUnfire } = setup();
    fireEvent.click(screen.getByText("UNDO"));
    expect(onUnfire).toHaveBeenCalledWith("amuse");
  });

  it("goes inert and reads ALL COURSES FIRED at the end of the menu", () => {
    setup({ kitchenLog: { amuse: { firedAt: "20:20" }, starter: { firedAt: "20:45" }, main: { firedAt: "21:10" } } });
    const done = screen.getByText("ALL COURSES FIRED");
    expect(done.disabled).toBe(true);
    expect(screen.queryByText("NEXT")).toBeNull();
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
    expect(screen.getByText("PICK A SEAT FIRST")).toBeTruthy();
    fireEvent.click(screen.getByText("S2"));
    fireEvent.click(screen.getByText("Gluten Free"));
    expect(updBooking).toHaveBeenCalledWith("restrictions", [{ pos: 2, note: "gluten" }]);
    // The panel closes on the pick — the operator is done in one gesture.
    expect(screen.queryByText("Gluten Free")).toBeNull();
  });

  it("removes a restriction when its tag is tapped", () => {
    const { upd } = setup({ restrictions: [{ pos: 1, note: "vegan" }, { pos: 2, note: "nut" }] });
    expect(screen.getByText(/\[Vegan\] SEAT_1/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Remove Vegan from seat 1"));
    expect(upd).toHaveBeenCalledWith("restrictions", [{ pos: 2, note: "nut" }]);
  });
});

describe("TableSheet — water & wine", () => {
  it("applies a water choice to the whole party", () => {
    const { updSeat } = setup();
    fireEvent.click(screen.getByText("XC"));
    expect(updSeat).toHaveBeenCalledWith(1, "water", "XC");
    expect(updSeat).toHaveBeenCalledWith(2, "water", "XC");
  });

  it("waits for two characters before offering wine matches", () => {
    setup();
    const search = screen.getByLabelText("Search wines");
    fireEvent.change(search, { target: { value: "r" } });
    expect(screen.queryByText("GLASS")).toBeNull();
    fireEvent.change(search, { target: { value: "reb" } });
    expect(screen.getByText("GLASS")).toBeTruthy();
    expect(screen.getByText("BOTTLE")).toBeTruthy();
  });

  it("records a glass and a bottle distinctly on the table", () => {
    const { upd } = setup();
    fireEvent.change(screen.getByLabelText("Search wines"), { target: { value: "reb" } });
    fireEvent.click(screen.getByText("GLASS"));
    expect(upd).toHaveBeenCalledWith("bottleWines", [expect.objectContaining({ name: "Rebula", byGlass: true })]);
  });

  it("lists chosen drinks with a way to take them off", () => {
    const { upd } = setup({ bottleWines: [{ name: "Rebula", producer: "Klinec", byGlass: false }] });
    expect(screen.getByText("BOTTLE")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Remove Rebula"));
    expect(upd).toHaveBeenCalledWith("bottleWines", []);
  });
});

describe("TableSheet — notes", () => {
  it("commits each note on blur, and only the kitchen note is flagged for the pass", () => {
    const { updBooking } = setup();
    const kitchen = screen.getByLabelText("Kitchen note");
    expect(kitchen.style.borderColor || kitchen.style.border).toMatch(/192, 128, 128|c08080/);

    fireEvent.change(screen.getByLabelText("Staff note"), { target: { value: "anniversary" } });
    expect(updBooking).not.toHaveBeenCalled();          // no write per keystroke
    fireEvent.blur(screen.getByLabelText("Staff note"));
    expect(updBooking).toHaveBeenCalledWith("notes", "anniversary");

    fireEvent.change(kitchen, { target: { value: "no butter on P2" } });
    fireEvent.blur(kitchen);
    expect(updBooking).toHaveBeenCalledWith("kitchenNote", "no butter on P2");
  });
});

describe("TableSheet — action grid", () => {
  it("shows only the actions the table's state allows", () => {
    setup();
    expect(screen.getByText("SET → KITCHEN")).toBeTruthy();
    expect(screen.getByText("MOVE TABLE")).toBeTruthy();
    expect(screen.getByText("SWAP TABLES")).toBeTruthy();
    expect(screen.getByText("JOIN TABLE +")).toBeTruthy();
    expect(screen.getByText("CLEAR TABLE")).toBeTruthy();
    expect(screen.queryByText("MARK ARRIVING")).toBeNull();
    expect(screen.queryByText("UNSET")).toBeNull();
  });

  it("replaces SET with UNSET once the table is set for the kitchen", () => {
    const { onUnsetKitchen } = setup({ courseReady: { key: "starter", at: "20:40" } });
    expect(screen.queryByText("SET → KITCHEN")).toBeNull();
    fireEvent.click(screen.getByText("UNSET"));
    expect(onUnsetKitchen).toHaveBeenCalled();
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
