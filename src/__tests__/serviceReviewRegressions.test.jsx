import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { blankTable, makeSeats, regroupTableRows } from "../utils/tableHelpers.js";
import { kitchenSnapshot, kitchenDelta, mergeKitchenAlert } from "../utils/kitchenAlerts.js";
import { KitchenAlertOverlay } from "../components/kitchen/KitchenBoard.jsx";
import { DisplayBoardCard } from "../components/service/DisplayBoard.jsx";
import TableSheet from "../components/service/TableSheet.jsx";

describe("regrouping preserves canonical guest identity", () => {
  const party = () => {
    const t = { ...blankTable(2), active: true, guests: 3, tableGroup: [2, 3], seats: makeSeats(3),
      restrictions: [{ pos: 3, note: "nut" }], kitchenSent: { 3: { pairing: "Wine" } },
      kitchenAlert: { seats: [{ id: 3 }], confirmed: false } };
    t.seats[2] = { ...t.seats[2], id: 6, digestivos: [{ name: "Decaf" }],
      pairingSharedWith: 2, floorPositions: { "terrace:T20": 4 } };
    t.restrictions[0].pos = 6;
    return t;
  };

  it("keeps blank chairs, sparse IDs, digestivos and dependent references through split and rejoin", () => {
    const original = party();
    const initial = [original, { ...blankTable(3), tableGroup: [2, 3] }, blankTable(1)];
    const split = regroupTableRows(initial, [2, 3], [2]);
    const joined = regroupTableRows(split, [2], [1, 2]);
    const final = regroupTableRows(joined, [1, 2], [1]).find(t => t.id === 1);
    for (const key of ["seats", "restrictions", "kitchenSent", "kitchenAlert", "guests"]) {
      expect(final[key]).toEqual(original[key]);
    }
    expect(final.seats.map(s => s.id)).toEqual([1, 2, 6]);
    expect(initial[0]).toEqual(original);
  });

  it("recovers an intact party from a secondary table", () => {
    const original = { ...party(), id: 3 };
    const next = regroupTableRows([{ ...blankTable(2), tableGroup: [2, 3] }, original], [2, 3], [2]);
    expect(next[0].seats).toEqual(original.seats);
    expect(next[0].restrictions).toEqual(original.restrictions);
  });

  it("refuses to erase a second live party with conflicting guest IDs", () => {
    const first = party();
    const second = { ...party(), id: 3 };
    const rows = [first, second];
    expect(regroupTableRows(rows, [2, 3], [2])).toBe(rows);
  });
});

describe("unassigned dietaries reach the extra alert", () => {
  const seats = makeSeats(2).map(s => ({ ...s, extras: { beetroot: { ordered: true } } }));
  const extras = [{ key: "beetroot", name: "Beetroot", course: {
    course_key: "beetroot", menu: { name: "Beetroot" }, restrictions: { nut_note: "no hazelnut oil" },
  } }];

  it.each([null, 9])("warns once per dish for an unresolved position %s without assigning it to each seat", (pos) => {
    const before = kitchenSnapshot(seats, extras);
    const current = kitchenSnapshot(seats, extras, [], [{ pos, note: "nut" }]);
    const delta = kitchenDelta(current, before);
    expect(delta).toHaveLength(2);
    expect(delta[0].extras[0].restriction).toBeNull();
    const alert = mergeKitchenAlert({ seats: [], confirmed: false, course: { index: 1, name: "Beetroot" } },
      { seats: delta, snapshot: current, timestamp: new Date().toISOString() });
    const view = render(<KitchenAlertOverlay alerts={[{ tableId: 2, alert }]} onConfirm={vi.fn()} />);
    expect(view.getAllByRole("alert")).toHaveLength(1);
    expect(view.getByRole("alert").textContent).toContain("Seat assignment needed");
    expect(view.getByRole("alert").textContent).toContain("NO HAZELNUT OIL");
    expect(kitchenDelta(current, current)).toEqual([]);
  });

  it("replaces the warning with a seat-specific modification when assigned", () => {
    const pending = kitchenSnapshot(seats, extras, [], [{ pos: null, note: "nut" }]);
    const assigned = kitchenSnapshot(seats, extras, [], [{ pos: 2, note: "nut" }]);
    const alert = mergeKitchenAlert({ seats: kitchenDelta(pending, {}), confirmed: false },
      { seats: kitchenDelta(assigned, pending), snapshot: assigned });
    expect(alert.seats.every(s => s.extras[0].unassignedRestrictions.length === 0)).toBe(true);
    expect(alert.seats.find(s => s.id === 2).extras[0].restriction).toBe("NO HAZELNUT OIL");
  });
});

describe("quick beverage ordering destinations", () => {
  const wine = { id: "w1", name: "Rebula", producer: "Klinec", vintage: "2022", byGlass: true };
  it("reopens quick access after recording both an aperitif and a digestivo in details", () => {
    const options = [{ id: 1, label: "REBULA", linkedKey: "w1", type: "wine" }];
    const digestivoOptions = [{ id: 7, label: "Coffee", type: "coffee", variants: ["Decaf"] }];
    function Flow() {
      const [t, setTable] = React.useState({ ...blankTable(1), active: true, guests: 1, seats: makeSeats(1) });
      const [details, setDetails] = React.useState(true);
      const updSeat = (id, field, value) => setTable(prev => ({ ...prev,
        seats: prev.seats.map(s => s.id === id ? { ...s, [field]: value } : s) }));
      const props = { wines: [wine], aperitifOptions: options, digestivoOptions };
      return details ? <>
        <button onClick={() => { setTable(prev => JSON.parse(JSON.stringify(prev))); setDetails(false); }}>Return to quick access</button>
        <TableSheet {...props} table={t} tables={[t]} menuCourses={[]} reservations={[]} onClose={() => {}}
          upd={() => {}} updSeat={updSeat} updBooking={() => {}} />
      </> : <DisplayBoardCard {...props} t={t} quickMode />;
    }
    const view = render(<Flow />);
    fireEvent.click(view.getByLabelText("Add REBULA"));
    fireEvent.click(view.getByText("DIGESTIVO"));
    fireEvent.click(view.getByLabelText("Choose which Coffee"));
    fireEvent.click(view.getByLabelText("Add Coffee Decaf"));
    fireEvent.click(view.getByText("Return to quick access"));
    expect(view.getByText("REBULA").style.fontWeight).toBe("700");
    expect(view.getByText("Decaf")).toBeTruthy();
  });
  it.each(["aperitif", "digestivo"])("stores a searched %s bottle at table level and keeps it on reopen", (phase) => {
    let t = { ...blankTable(1), active: true, guests: 1, seats: makeSeats(1), bottleWines: [{ name: "Existing" }] };
    const upd = vi.fn((id, field, value) => { t = { ...t, [field]: value }; });
    const updSeat = vi.fn();
    const props = { wines: [wine], aperitifOptions: [], digestivoOptions: [{ id: 7, label: "Coffee", type: "coffee" }], upd, updSeat };
    const view = render(<DisplayBoardCard {...props} t={t} quickMode />);
    fireEvent.click(view.getByLabelText(`Search all beverages for ${phase === "aperitif" ? "an" : "a"} ${phase}`));
    fireEvent.change(view.getByPlaceholderText(`find any beverage for ${phase}…`), { target: { value: "Rebula" } });
    fireEvent.mouseDown(view.getAllByText("Rebula")[1]);
    expect(upd).toHaveBeenCalledWith(1, "bottleWines", [{ name: "Existing" }, { ...wine, byGlass: false }]);
    expect(updSeat).not.toHaveBeenCalled();
    t = JSON.parse(JSON.stringify(t));
    view.rerender(<DisplayBoardCard {...props} t={t} quickMode={false} />);
    view.rerender(<DisplayBoardCard {...props} t={t} quickMode />);
    expect(t.bottleWines).toHaveLength(2);
    expect(t.seats[0].digestivos).toEqual([]);
    expect(t.seats[0].aperitifs).toEqual([]);
  });
});
