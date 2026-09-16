// ── The digestivo and BTG/BTB, end to end through the real surfaces ──────────
// The pure helpers are covered in digestivo.test.js and pourMode.test.js. This
// file checks the three places a server or a chef actually touches them: the
// seat's quick-access buttons, the exclusivity between a pairing and BTG/BTB,
// and the DIGESTIVO line landing above the anchored course on the ticket.

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen, within } from "@testing-library/react";
import { DisplayBoardCard } from "../components/service/DisplayBoard.jsx";
import KitchenBoard from "../components/kitchen/KitchenBoard.jsx";

if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

const seatDefaults = {
  gender: null, pairingSharedWith: null, water: "—", pairing: "", pourMode: null,
  aperitifs: [], digestivos: [], glasses: [], cocktails: [], spirits: [], beers: [],
  extras: {}, optionalPairings: {},
};

const table = (seats) => ({
  id: 1, active: true, guests: seats.length, resName: "TEST", restrictions: [],
  tableGroup: [], kitchenLog: {}, kitchenAlert: null, courseOverrides: {},
  kitchenCourseNotes: {}, menuType: "", lang: "en", resTime: "",
  seats: seats.map((s, i) => ({ id: i + 1, ...seatDefaults, ...s })),
});

const DIGESTIVO_OPTIONS = [
  { id: 7, label: "Coffee", searchKey: "Coffee", type: "cocktail" },
  { id: 8, label: "Grappa", searchKey: "Grappa", type: "spirit" },
];

// The same two buttons, with Coffee carrying subcategories to scroll.
const DIGESTIVO_WITH_SUBS = [
  { ...DIGESTIVO_OPTIONS[0], variants: ["Espresso", "Cappuccino"] },
  DIGESTIVO_OPTIONS[1],
];

// The section label renders as several text nodes ("[", "Digestivo", "]") and
// is uppercased by CSS, not in the DOM — so match the element's own raw text.
const exactText = (value) => (_content, el) =>
  el?.textContent?.trim() === value && !Array.from(el.children).some(c => c.textContent?.trim() === value);

const applySeatsUpdate = (upd, seats) => {
  const call = upd.mock.calls.find((c) => c[1] === "seats");
  expect(call).toBeTruthy();
  return typeof call[2] === "function" ? call[2](seats) : call[2];
};

describe("the digestivo buttons on the seat", () => {
  it("shows one button per configured digestivo, under its own heading", () => {
    render(
      <DisplayBoardCard t={table([{}])} quickMode updSeat={vi.fn()} upd={vi.fn()}
        aperitifOptions={[]} digestivoOptions={DIGESTIVO_OPTIONS} />,
    );
    expect(screen.getByText(exactText("[Digestivo]"))).toBeTruthy();
    expect(screen.getByText("Coffee")).toBeTruthy();
    expect(screen.getByText("Grappa")).toBeTruthy();
  });

  it("shows no section at all for a restaurant that runs no digestivo", () => {
    render(
      <DisplayBoardCard t={table([{}])} quickMode updSeat={vi.fn()} upd={vi.fn()}
        aperitifOptions={[]} digestivoOptions={[]} />,
    );
    expect(screen.queryByText(exactText("[Digestivo]"))).toBeNull();
  });

  it("records the pick on the seat's own digestivo list", () => {
    const updSeat = vi.fn();
    render(
      <DisplayBoardCard t={table([{}])} quickMode updSeat={updSeat} upd={vi.fn()}
        aperitifOptions={[]} digestivoOptions={DIGESTIVO_OPTIONS} />,
    );
    fireEvent.click(screen.getByText("Grappa"));
    const [tableId, seatId, field, value] = updSeat.mock.calls.at(-1);
    expect([tableId, seatId, field]).toEqual([1, 1, "digestivos"]);
    expect(value.map((x) => x.name)).toEqual(["Grappa"]);
  });

  it("a second tap takes the same drink back off", () => {
    const updSeat = vi.fn();
    render(
      <DisplayBoardCard t={table([{ digestivos: [{ name: "Grappa" }] }])} quickMode
        updSeat={updSeat} upd={vi.fn()} aperitifOptions={[]} digestivoOptions={DIGESTIVO_OPTIONS} />,
    );
    fireEvent.click(screen.getByText("Grappa"));
    expect(updSeat.mock.calls.at(-1)[3]).toEqual([]);
  });

  it("opens a panel with every subcategory on it, and records the one picked", () => {
    // It used to SCROLL: one tap per step, so reaching Filter past espresso,
    // latte, cappuccino and decaf was five taps, and a guest saying "no, the
    // decaf" had to be scrolled to rather than picked.
    const updSeat = vi.fn();
    render(
      <DisplayBoardCard t={table([{}])} quickMode updSeat={updSeat} upd={vi.fn()}
        aperitifOptions={[]} digestivoOptions={DIGESTIVO_WITH_SUBS} />,
    );
    fireEvent.click(screen.getByTitle(/^Coffee — none chosen/));

    const panel = screen.getByRole("dialog", { name: "Choose Coffee" });
    expect(within(panel).getByText("Espresso")).toBeTruthy();
    expect(within(panel).getByText("Cappuccino")).toBeTruthy();

    fireEvent.click(within(panel).getByText("Cappuccino"));
    expect(updSeat.mock.calls.at(-1)[3].map(d => d.name)).toEqual(["Coffee (Cappuccino)"]);
    // The panel closes behind the choice.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("reaches any subcategory in one tap, in either direction", () => {
    const updSeat = vi.fn();
    render(
      <DisplayBoardCard
        t={table([{ digestivos: [{ name: "Coffee (Cappuccino)", baseName: "Coffee", variant: "Cappuccino", digestivoId: 7 }] }])}
        quickMode updSeat={updSeat} upd={vi.fn()}
        aperitifOptions={[]} digestivoOptions={DIGESTIVO_WITH_SUBS} />,
    );
    fireEvent.click(screen.getByTitle(/^Coffee — Cappuccino/));
    const panel = screen.getByRole("dialog", { name: "Choose Coffee" });
    // The one that is on reads as chosen, and stepping BACK is a single tap.
    expect(within(panel).getByText("Cappuccino").closest("button").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(panel).getByText("Espresso"));
    expect(updSeat.mock.calls.at(-1)[3].map(d => d.name)).toEqual(["Coffee (Espresso)"]);
  });

  it("offers NONE, so taking the drink back off is never a scroll to the end", () => {
    const updSeat = vi.fn();
    render(
      <DisplayBoardCard
        t={table([{ digestivos: [{ name: "Coffee (Espresso)", baseName: "Coffee", variant: "Espresso", digestivoId: 7 }] }])}
        quickMode updSeat={updSeat} upd={vi.fn()}
        aperitifOptions={[]} digestivoOptions={DIGESTIVO_WITH_SUBS} />,
    );
    fireEvent.click(screen.getByTitle(/^Coffee — Espresso/));
    fireEvent.click(within(screen.getByRole("dialog")).getByText("✕ None"));
    expect(updSeat.mock.calls.at(-1)[3]).toEqual([]);
  });

  it("closes without recording anything when dismissed", () => {
    const updSeat = vi.fn();
    render(
      <DisplayBoardCard t={table([{}])} quickMode updSeat={updSeat} upd={vi.fn()}
        aperitifOptions={[]} digestivoOptions={DIGESTIVO_WITH_SUBS} />,
    );
    fireEvent.click(screen.getByTitle(/^Coffee — none chosen/));
    fireEvent.click(screen.getByLabelText("Close"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updSeat).not.toHaveBeenCalled();
  });

  it("shows the chosen subcategory on the button, with the open affordance", () => {
    render(
      <DisplayBoardCard
        t={table([{ digestivos: [{ name: "Coffee (Cappuccino)", baseName: "Coffee", variant: "Cappuccino", digestivoId: 7 }] }])}
        quickMode updSeat={vi.fn()} upd={vi.fn()}
        aperitifOptions={[]} digestivoOptions={DIGESTIVO_WITH_SUBS} />,
    );
    const btn = screen.getByTitle(/^Coffee — Cappuccino/);
    expect(btn.textContent).toContain("Cappuccino");
    // ▾ (a panel opens), not → (the label advances one step)
    expect(btn.textContent).toContain("▾");
    expect(btn.textContent).not.toContain("→");
  });

  it("says CHOOSE rather than naming one subcategory while none is picked", () => {
    // Advertising "Espresso" on an off button read as though espresso were
    // already the choice, one tap from being ordered.
    render(
      <DisplayBoardCard t={table([{}])} quickMode updSeat={vi.fn()} upd={vi.fn()}
        aperitifOptions={[]} digestivoOptions={DIGESTIVO_WITH_SUBS} />,
    );
    expect(screen.getByTitle(/^Coffee — none chosen/).textContent).toContain("choose");
  });

  it("choosing on one button leaves the other button's pick alone", () => {
    const updSeat = vi.fn();
    render(
      <DisplayBoardCard
        t={table([{ digestivos: [{ name: "Grappa", baseName: "Grappa", digestivoId: 8 }] }])}
        quickMode updSeat={updSeat} upd={vi.fn()}
        aperitifOptions={[]} digestivoOptions={DIGESTIVO_WITH_SUBS} />,
    );
    fireEvent.click(screen.getByTitle(/^Coffee — none chosen/));
    fireEvent.click(within(screen.getByRole("dialog")).getByText("Espresso"));
    expect(updSeat.mock.calls.at(-1)[3].map(d => d.name).sort())
      .toEqual(["Coffee (Espresso)", "Grappa"]);
  });

  it("shows the chosen subcategory on the read-only seat chip", () => {
    render(
      <DisplayBoardCard
        t={table([{ digestivos: [{ name: "Coffee (Espresso)", baseName: "Coffee", variant: "Espresso", digestivoId: 7 }] }])}
        quickMode={false} aperitifOptions={[]} digestivoOptions={DIGESTIVO_WITH_SUBS} />,
    );
    expect(screen.getByText("D · Coffee (Espresso)")).toBeTruthy();
  });

  it("reaches the rest of the catalogue through the search beside the buttons", () => {
    // The buttons carry what the house pours nightly. A guest asking for the
    // one bottle nobody put on a button should not send a server to admin in
    // the middle of service.
    const updSeat = vi.fn();
    render(
      <DisplayBoardCard t={table([{}])} quickMode updSeat={updSeat} upd={vi.fn()}
        aperitifOptions={[]} digestivoOptions={DIGESTIVO_OPTIONS}
        spirits={[{ id: "s1", name: "Chartreuse", notes: "herbal" }]} />,
    );
    fireEvent.click(screen.getByLabelText("Search all beverages for a digestivo"));
    fireEvent.change(screen.getByPlaceholderText("find any beverage for digestivo…"),
      { target: { value: "chart" } });
    fireEvent.mouseDown(screen.getByText("Chartreuse"));

    const [tableId, seatId, field, value] = updSeat.mock.calls.at(-1);
    expect([tableId, seatId, field]).toEqual([1, 1, "digestivos"]);
    expect(value.map((x) => x.name)).toEqual(["Chartreuse"]);
  });

  it("a searched drink joins the button's pick instead of replacing it", () => {
    // Scrolling a button is one guest changing their mind; a second drink
    // found in the catalogue is a second drink.
    const updSeat = vi.fn();
    render(
      <DisplayBoardCard
        t={table([{ digestivos: [{ name: "Grappa", baseName: "Grappa", digestivoId: 8 }] }])}
        quickMode updSeat={updSeat} upd={vi.fn()}
        aperitifOptions={[]} digestivoOptions={DIGESTIVO_OPTIONS}
        spirits={[{ id: "s1", name: "Chartreuse", notes: "herbal" }]} />,
    );
    fireEvent.click(screen.getByLabelText("Search all beverages for a digestivo"));
    fireEvent.change(screen.getByPlaceholderText("find any beverage for digestivo…"),
      { target: { value: "chart" } });
    fireEvent.mouseDown(screen.getByText("Chartreuse"));
    expect(updSeat.mock.calls.at(-1)[3].map((x) => x.name)).toEqual(["Grappa", "Chartreuse"]);
  });

  it("offers no digestivo search to a restaurant that runs no digestivo", () => {
    render(
      <DisplayBoardCard t={table([{}])} quickMode updSeat={vi.fn()} upd={vi.fn()}
        aperitifOptions={[]} digestivoOptions={[]} />,
    );
    expect(screen.queryByLabelText("Search all beverages for a digestivo")).toBeNull();
  });

  it("does not touch the aperitif list, which is a different moment of the night", () => {
    const updSeat = vi.fn();
    render(
      <DisplayBoardCard t={table([{}])} quickMode updSeat={updSeat} upd={vi.fn()}
        aperitifOptions={[{ label: "Slapšak", searchKey: "Slapšak", type: "wine" }]}
        digestivoOptions={DIGESTIVO_OPTIONS} />,
    );
    fireEvent.click(screen.getByText("Coffee"));
    expect(updSeat.mock.calls.every((c) => c[3 - 1] !== "aperitifs")).toBe(true);
  });
});

describe("BTG / BTB beside the pairing", () => {
  const renderSeat = (seat, upd = vi.fn()) => {
    const utils = render(
      <DisplayBoardCard t={table([seat])} quickMode updSeat={vi.fn()} upd={upd}
        aperitifOptions={[]} digestivoOptions={[]} />,
    );
    return { ...utils, upd };
  };

  it("offers both buttons on a seat with no pairing", () => {
    renderSeat({});
    expect(screen.getByTitle("By the glass").disabled).toBe(false);
    expect(screen.getByTitle("By the bottle").disabled).toBe(false);
  });

  it("records by-the-glass on the seat", () => {
    const { upd } = renderSeat({});
    fireEvent.click(screen.getByTitle("By the glass"));
    expect(applySeatsUpdate(upd, table([{}]).seats)[0].pourMode).toBe("btg");
  });

  it("disables both once the seat takes a pairing — the pairing IS the answer", () => {
    renderSeat({ pairing: "Wine" });
    const btg = screen.getByTitle(/By the glass — unavailable/);
    const btb = screen.getByTitle(/By the bottle — unavailable/);
    expect(btg.disabled).toBe(true);
    expect(btb.disabled).toBe(true);
  });

  it("a disabled button records nothing when tapped", () => {
    const { upd } = renderSeat({ pairing: "Wine" });
    fireEvent.click(screen.getByTitle(/By the glass — unavailable/));
    expect(upd.mock.calls.some((c) => c[1] === "seats")).toBe(false);
  });

  it("choosing a pairing clears a BTG the seat already had", () => {
    const seats = table([{ pourMode: "btg" }]).seats;
    const { upd } = renderSeat({ pourMode: "btg" });
    fireEvent.click(screen.getByText("None"));   // cycle: none → Wine
    const next = applySeatsUpdate(upd, seats)[0];
    expect(next.pairing).toBe("Wine");
    expect(next.pourMode).toBeNull();
  });

  it("still works for a caller that only passes the single-field seat writer", () => {
    const updSeat = vi.fn();
    render(
      <DisplayBoardCard t={table([{ pourMode: "btg" }])} quickMode updSeat={updSeat}
        aperitifOptions={[]} digestivoOptions={[]} />,
    );
    fireEvent.click(screen.getByText("None"));   // cycle: none → Wine
    expect(updSeat).toHaveBeenCalledWith(1, 1, "pairing", "Wine");
    expect(updSeat).toHaveBeenCalledWith(1, 1, "pourMode", null);
  });

  it("shows the mode as a chip in the read-only seat row", () => {
    render(
      <DisplayBoardCard t={table([{ pourMode: "btb" }])} quickMode={false}
        aperitifOptions={[]} digestivoOptions={[]} />,
    );
    expect(screen.getByText("BTB")).toBeTruthy();
  });
});

const makeCourse = (position, key, name, over = {}) => ({
  position,
  menu: { name, sub: "" },
  menu_si: null, wp: null, wp_si: null, na: null, na_si: null,
  os: null, os_si: null, premium: null, premium_si: null,
  hazards: null, is_snack: false,
  course_key: key,
  optional_flag: "", section_gap_before: false, show_on_short: false,
  short_order: null, force_pairing_title: "", force_pairing_sub: "",
  force_pairing_title_si: "", force_pairing_sub_si: "",
  kitchen_note: "", aperitif_btn: null, restrictions: {},
  ...over,
});

describe("the DIGESTIVO line on the kitchen ticket", () => {
  const courses = [
    makeCourse(1, "danube", "Danube"),
    makeCourse(2, "buchtel", "Buchtel", { digestivo_before: true }),
  ];

  const renderTicket = (seats, menuCourses = courses) => render(
    <KitchenBoard tables={[table(seats)]} menuCourses={menuCourses} upd={vi.fn()} updMany={vi.fn()} />,
  );

  it("prints the chosen subcategory, not just the button name", () => {
    renderTicket([{ digestivos: [{ name: "Coffee (Espresso)", baseName: "Coffee", variant: "Espresso" }] }]);
    expect(screen.getByText("P1 Coffee (Espresso)")).toBeTruthy();
  });

  it("prints the ordering chairs and the total when a guest ordered one", () => {
    renderTicket([{ digestivos: [{ name: "Coffee" }, { name: "Coffee" }] }, { digestivos: [{ name: "Grappa" }] }]);
    expect(screen.getByText("DIGESTIVO")).toBeTruthy();
    expect(screen.getByText("3×")).toBeTruthy();
    // One segment per chair, so a long round wraps instead of ellipsizing
    // away the drink the pass still has to pour.
    expect(screen.getByText("P1 Coffee ×2")).toBeTruthy();
    expect(screen.getByText("P2 Grappa")).toBeTruthy();
  });

  it("prints nothing when nobody ordered one, however the menu is anchored", () => {
    renderTicket([{}, {}]);
    expect(screen.queryByText("DIGESTIVO")).toBeNull();
  });

  it("prints nothing when the order exists but no course is anchored", () => {
    renderTicket([{ digestivos: [{ name: "Coffee" }] }], [makeCourse(1, "danube", "Danube")]);
    expect(screen.queryByText("DIGESTIVO")).toBeNull();
  });

  it("puts the line ABOVE the anchored course, not above the one before it", () => {
    const { container } = renderTicket([{ digestivos: [{ name: "Coffee" }] }]);
    const text = container.textContent;
    expect(text.indexOf("Danube")).toBeLessThan(text.indexOf("DIGESTIVO"));
    expect(text.indexOf("DIGESTIVO")).toBeLessThan(text.indexOf("Buchtel"));
  });

  it("wears none of the next-due highlight it sits beside", () => {
    // The row used to take the parchment fill and the charcoal left edge the
    // ticket uses for the course that is about to go out, which made every
    // digestivo read as the next fire — and hid the course that really was.
    const { container } = renderTicket([{ digestivos: [{ name: "Coffee" }] }]);
    const row = container.querySelector("[data-digestivo-line]");
    expect(row.style.background).not.toBe("rgb(242, 237, 227)");
    expect(row.style.borderLeft).toBe("4px solid transparent");
    expect(container.textContent).toContain("DIGESTIVO");
  });

  it("shows BTG on the seat chip of an unpaired guest, and never beside a pairing", () => {
    const { container } = renderTicket([{ pourMode: "btg" }, { pairing: "Wine", pourMode: "btb" }]);
    // P1 has no pairing, so its chip says BTG; P2 took the Wine pairing, so
    // its stale BTB must not print beside it.
    expect(within(container).getByTitle("By the glass")).toBeTruthy();
    expect(within(container).queryByTitle("By the bottle")).toBeNull();
    expect(container.textContent).toContain("BTG");
    expect(container.textContent).not.toContain("BTB");
  });
});

describe("Send does not pop the digestivo at the kitchen", () => {
  // The line is already on the ticket the moment service records it. A popup
  // on top of that is an interruption the pass has to dismiss before it can
  // read anything else, over a drink nobody has to start cooking.
  const alerted = (seats) => ({
    ...table(seats),
    kitchenAlert: {
      timestamp: Date.now(),
      confirmed: false,
      course: null,
      seats: [{ id: 1, gender: null, pairing: "Non-Alc", pairingChanged: true, extras: [] }],
    },
  });

  it("names the pairing it really is about, and never the digestivo", () => {
    const { container } = render(
      <KitchenBoard
        tables={[alerted([{ pairing: "Non-Alc", digestivos: [{ name: "Coffee" }] }])]}
        menuCourses={[makeCourse(1, "danube", "Danube")]}
        upd={vi.fn()} updMany={vi.fn()} />,
    );
    const popup = screen.getByText("CONFIRM").closest("div").parentElement;
    expect(within(popup).queryByText("DIGESTIVO")).toBeNull();
    expect(within(popup).queryByText(/Coffee/)).toBeNull();
    expect(container.textContent).toContain("Non-Alc");
  });
});
