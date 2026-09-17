// ── The aperitif buttons on the seat card ────────────────────────────────────
// Reported as "quick access aperitif is broken — tapping does nothing".
//
// Two symptoms, one fault. Tapping did nothing because the click handler
// threw; opening quick access on a seat that already had an aperitif CRASHED,
// because the same broken reference runs during render once there is a chip to
// match against. A seat with no aperitifs never ran either, which is why an
// empty card looked perfectly healthy and no existing test caught it.

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { DisplayBoardCard } from "../components/service/DisplayBoard.jsx";

if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

const WINES = [
  { id: "domaine_slapšak|blanc_de_blanc|2020|si", name: "Blanc de blanc", producer: "Domaine Slapšak", byGlass: true },
  { id: "krug|vintage_2013|2013|fr", name: "Vintage 2013", producer: "Krug", byGlass: true },
];
const APERITIF_OPTIONS = [
  { id: 2, type: "wine", label: "Slapšak", enabled: true, linkedKey: "domaine_slapšak|blanc_de_blanc|2020|si", searchKey: "Blanc de blanc" },
  { id: 3, type: "wine", label: "Krug", enabled: true, linkedKey: "krug|vintage_2013|2013|fr", searchKey: "Vintage 2013" },
];

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

const setup = (seats, opts = {}) => {
  const updSeat = vi.fn();
  render(
    <DisplayBoardCard t={table(seats)} quickMode updSeat={updSeat} upd={vi.fn()}
      wines={WINES} cocktails={[]} spirits={[]} beers={[]} teas={[]} coffees={[]}
      aperitifOptions={APERITIF_OPTIONS} digestivoOptions={[]} {...opts} />,
  );
  return updSeat;
};

describe("tapping an aperitif button", () => {
  it("puts the linked wine on the seat", () => {
    const updSeat = setup([{}]);

    fireEvent.click(screen.getByText("Slapšak"));

    const [tableId, seatId, field, value] = updSeat.mock.calls.at(-1);
    expect([tableId, seatId, field]).toEqual([1, 1, "aperitifs"]);
    expect(value.map(x => x.name)).toEqual(["Blanc de blanc"]);
  });

  it("does not throw reaching the catalogue it resolves against", () => {
    // The handler read a `catalogs` binding declared in the DIGESTIVO block
    // below it. Every tap died on that reference before it could record
    // anything, which on the floor looks like a button that does nothing.
    const updSeat = setup([{}]);
    expect(() => fireEvent.click(screen.getByText("Krug"))).not.toThrow();
    expect(updSeat).toHaveBeenCalled();
  });

  it("opens on a seat that already has an aperitif, without taking the app down", () => {
    // The reported journey: added from the Detail sheet, then quick access
    // pressed. Deciding whether each button is lit reads every aperitif on the
    // seat, so with one there the broken reference ran during RENDER — not in
    // a handler — and took the card down with it.
    const withOne = [{ aperitifs: [{ id: "krug|vintage_2013|2013|fr", name: "Vintage 2013", producer: "Krug" }] }];
    expect(() => setup(withOne)).not.toThrow();
  });

  it("lights the button for a wine already on the seat", () => {
    setup([{ aperitifs: [{ id: "krug|vintage_2013|2013|fr", name: "Vintage 2013", producer: "Krug" }] }]);
    expect(screen.getByText("Krug").style.fontWeight).toBe("700");
    expect(screen.getByText("Slapšak").style.fontWeight).toBe("500");
  });

  it("a second tap takes it back off", () => {
    const updSeat = setup([{ aperitifs: [{ id: "krug|vintage_2013|2013|fr", name: "Vintage 2013", producer: "Krug" }] }]);

    fireEvent.click(screen.getByText("Krug"));

    expect(updSeat.mock.calls.at(-1)[3]).toEqual([]);
  });
});
