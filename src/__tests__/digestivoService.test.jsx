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

  it("scrolls a configured button through its subcategories, then back off", () => {
    const updSeat = vi.fn();
    let seat = {};
    const renderAt = () => render(
      <DisplayBoardCard t={table([seat])} quickMode updSeat={updSeat} upd={vi.fn()}
        aperitifOptions={[]} digestivoOptions={DIGESTIVO_WITH_SUBS} />,
    );

    // off → Espresso
    let view = renderAt();
    fireEvent.click(view.getByTitle(/^Coffee — off; tap for Espresso$/));
    expect(updSeat.mock.calls.at(-1)[3].map(d => d.name)).toEqual(["Coffee (Espresso)"]);

    // Espresso → Cappuccino, replacing rather than stacking
    seat = { digestivos: updSeat.mock.calls.at(-1)[3] };
    view.unmount();
    view = renderAt();
    fireEvent.click(view.getByTitle(/^Coffee — Espresso; tap for Cappuccino$/));
    expect(updSeat.mock.calls.at(-1)[3].map(d => d.name)).toEqual(["Coffee (Cappuccino)"]);

    // Cappuccino → off
    seat = { digestivos: updSeat.mock.calls.at(-1)[3] };
    view.unmount();
    view = renderAt();
    fireEvent.click(view.getByTitle(/^Coffee — Cappuccino; tap for off$/));
    expect(updSeat.mock.calls.at(-1)[3]).toEqual([]);
  });

  it("shows the current subcategory on the button, with the scroll affordance", () => {
    render(
      <DisplayBoardCard
        t={table([{ digestivos: [{ name: "Coffee (Cappuccino)", baseName: "Coffee", variant: "Cappuccino", digestivoId: 7 }] }])}
        quickMode updSeat={vi.fn()} upd={vi.fn()}
        aperitifOptions={[]} digestivoOptions={DIGESTIVO_WITH_SUBS} />,
    );
    const btn = screen.getByTitle(/^Coffee — Cappuccino/);
    expect(btn.textContent).toContain("Cappuccino");
    expect(btn.textContent).toContain("→");
  });

  it("advertises the first subcategory while the button is still off", () => {
    render(
      <DisplayBoardCard t={table([{}])} quickMode updSeat={vi.fn()} upd={vi.fn()}
        aperitifOptions={[]} digestivoOptions={DIGESTIVO_WITH_SUBS} />,
    );
    expect(screen.getByTitle(/^Coffee — off; tap for Espresso$/).textContent).toContain("Espresso");
  });

  it("leaves a button with no subcategories as a plain toggle, with no arrow", () => {
    render(
      <DisplayBoardCard t={table([{}])} quickMode updSeat={vi.fn()} upd={vi.fn()}
        aperitifOptions={[]} digestivoOptions={DIGESTIVO_WITH_SUBS} />,
    );
    const grappa = screen.getByTitle("Grappa");
    expect(grappa.textContent).toBe("Grappa");
  });

  it("scrolling one button leaves the other button's pick alone", () => {
    const updSeat = vi.fn();
    render(
      <DisplayBoardCard
        t={table([{ digestivos: [{ name: "Grappa", baseName: "Grappa", digestivoId: 8 }] }])}
        quickMode updSeat={updSeat} upd={vi.fn()}
        aperitifOptions={[]} digestivoOptions={DIGESTIVO_WITH_SUBS} />,
    );
    fireEvent.click(screen.getByTitle(/^Coffee — off/));
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
    expect(screen.getByText("P1 Coffee ×2 · P2 Grappa")).toBeTruthy();
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
