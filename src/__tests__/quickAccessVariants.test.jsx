// ── Editing a digestivo button's subcategories ───────────────────────────────
// Reported as "can't add subcategories": the + button wrote a blank row and
// the panel then re-read its rows through the sanitiser the FLOOR uses, which
// drops blanks — so the row vanished before it could be drawn and the button
// looked dead. A form has to be able to hold a row that is not finished yet.
//
// These render the panel controlled, holding the items in state, because the
// bug lived in the round trip: what the panel wrote came back changed.

import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, fireEvent, screen } from "@testing-library/react";
import QuickAccessPanel from "../components/admin/QuickAccessPanel.jsx";

const COFFEES = [{ id: 31, name: "Espresso", notes: "Espresso, Banibeans" }];

const Harness = ({ initial }) => {
  const [items, setItems] = useState(initial);
  return (
    <QuickAccessPanel
      quickAccessItems={items}
      onUpdateQuickAccess={setItems}
      wines={[]} cocktails={[]} spirits={[]} beers={[]}
      teas={[]} coffees={COFFEES}
      heading="DIGESTIVO" addPlaceholder="e.g. Espresso" emptyLabel="none"
      showMenuOnly={false} showVariants
    />
  );
};

const coffee = (variants) => [{
  id: 7, label: "Coffee", searchKey: "Coffee", enabled: true, variants,
}];

const subInput = (n) => screen.getByLabelText(`Coffee subcategory ${n}`);

describe("adding a subcategory", () => {
  it("draws the new row so it can be typed into", () => {
    render(<Harness initial={coffee([{ label: "Espresso", type: "coffee" }])} />);
    expect(screen.queryByLabelText("Coffee subcategory 2")).toBeNull();

    fireEvent.click(screen.getByText("+ subcategory"));

    expect(subInput(2)).toBeTruthy();
    expect(subInput(2).value).toBe("");
  });

  it("keeps the row while it is being named", () => {
    render(<Harness initial={coffee([])} />);
    fireEvent.click(screen.getByText("+ subcategory"));
    fireEvent.change(subInput(1), { target: { value: "Cappuccino" } });

    expect(subInput(1).value).toBe("Cappuccino");
  });

  it("adds a second row beside a first one still unnamed", () => {
    render(<Harness initial={coffee([])} />);
    fireEvent.click(screen.getByText("+ subcategory"));
    fireEvent.click(screen.getByText("+ subcategory"));

    // Two blank rows share a label; the sanitiser would have de-duplicated
    // them down to none at all.
    expect(subInput(1)).toBeTruthy();
    expect(subInput(2)).toBeTruthy();
  });
});

describe("renaming a subcategory", () => {
  it("survives being cleared on the way to a new name", () => {
    render(<Harness initial={coffee([{ label: "Espresso", type: "coffee" }])} />);

    fireEvent.change(subInput(1), { target: { value: "" } });
    expect(subInput(1)).toBeTruthy();

    fireEvent.change(subInput(1), { target: { value: "Cappuccino" } });
    expect(subInput(1).value).toBe("Cappuccino");
  });

  it("lets a space be typed mid-name", () => {
    render(<Harness initial={coffee([{ label: "Cafe", type: "coffee" }])} />);

    // Trimming on every keystroke ate the trailing space, so the next word
    // arrived stuck to the last one.
    fireEvent.change(subInput(1), { target: { value: "Cafe " } });
    fireEvent.change(subInput(1), { target: { value: `${subInput(1).value}au lait` } });

    expect(subInput(1).value).toBe("Cafe au lait");
  });
});

describe("what the row is worth to the floor", () => {
  it("counts only named subcategories in the summary", () => {
    render(<Harness initial={coffee([{ label: "Espresso", type: "coffee" }])} />);
    expect(screen.getByText("· 1 sub")).toBeTruthy();

    fireEvent.click(screen.getByText("+ subcategory"));
    expect(screen.getByText("· 1 sub")).toBeTruthy();

    fireEvent.change(subInput(2), { target: { value: "Cappuccino" } });
    expect(screen.getByText("· 2 sub")).toBeTruthy();
  });

  it("removes the row it is asked to remove", () => {
    render(<Harness initial={coffee([
      { label: "Espresso", type: "coffee" },
      { label: "Cappuccino", type: "coffee" },
    ])} />);

    fireEvent.click(screen.getByLabelText("Remove Coffee subcategory 1"));

    expect(subInput(1).value).toBe("Cappuccino");
    expect(screen.queryByLabelText("Coffee subcategory 2")).toBeNull();
  });
});
