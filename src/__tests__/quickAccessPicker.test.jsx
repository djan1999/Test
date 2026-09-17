// ── The quick-access product picker ──────────────────────────────────────────
// Reported as "I can't find anything for search". The cause was an empty
// catalogue, not the control — so this pins that the control finds what is
// there, and that an empty category says so rather than failing silently.

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen, within } from "@testing-library/react";
import QuickAccessPanel from "../components/admin/QuickAccessPanel.jsx";

const COFFEES = [
  { id: 31, name: "Espresso", notes: "Espresso, Banibeans" },
  { id: 32, name: "Nestor Lasso Ají Decaf", notes: "Filter, BANI BEANS" },
];
const SPIRITS = [{ id: 5, name: "Grappa Williams", notes: "" }];

const digestivoItem = (over = {}) => ({
  id: 7, label: "Coffee", searchKey: "Coffee", enabled: true,
  variants: [{ label: "Espresso", type: "coffee" }],
  ...over,
});

const setup = (items, catalogs = {}) => {
  const onUpdate = vi.fn();
  render(
    <QuickAccessPanel
      quickAccessItems={items}
      onUpdateQuickAccess={onUpdate}
      wines={[]} cocktails={[]} spirits={SPIRITS} beers={[]}
      teas={[]} coffees={[]}
      heading="DIGESTIVO" addPlaceholder="e.g. Espresso" emptyLabel="none"
      showMenuOnly={false} showVariants
      {...catalogs}
    />,
  );
  return onUpdate;
};

describe("searching for a product to link", () => {
  it("finds a coffee from the coffee catalogue", () => {
    const onUpdate = setup([digestivoItem()], { coffees: COFFEES });
    const box = screen.getByPlaceholderText("search coffee…");
    fireEvent.change(box, { target: { value: "esp" } });
    fireEvent.mouseDown(screen.getByText("Espresso"));
    // The pick lands on the SUBCATEGORY, linked by its catalogue key.
    const next = onUpdate.mock.calls.at(-1)[0][0];
    expect(next.variants[0]).toMatchObject({ searchKey: "Espresso", linkedKey: "coffee|Espresso" });
  });

  it("searches the category the row is set to, not the whole bar", () => {
    setup([digestivoItem()], { coffees: COFFEES });
    const box = screen.getByPlaceholderText("search coffee…");
    // "Grappa" is a spirit; a coffee row must not offer it.
    fireEvent.change(box, { target: { value: "grappa" } });
    expect(screen.queryByText("Grappa Williams")).toBeNull();
  });

  it("finds nothing when that category is empty — the reported symptom", () => {
    // Exactly the state a workspace was in before the sync fetched tea and
    // coffee: the control works, the shelf behind it is bare.
    setup([digestivoItem()], { coffees: [] });
    fireEvent.change(screen.getByPlaceholderText("search coffee…"), { target: { value: "esp" } });
    expect(screen.queryByText("Espresso")).toBeNull();
  });

  it("still links its own drink for a plain button with no subcategories", () => {
    const onUpdate = setup([{ id: 9, label: "Grappa", searchKey: "Grappa", type: "spirit", enabled: true }]);
    fireEvent.click(screen.getByText("EDIT"));
    // A row that already carries a key offers to REPLACE it rather than
    // advertising the category again.
    const box = screen.getByPlaceholderText("search to replace…");
    fireEvent.change(box, { target: { value: "willi" } });
    fireEvent.mouseDown(screen.getByText("Grappa Williams"));
    expect(onUpdate).not.toHaveBeenCalled();   // EDIT stages, SAVE commits
    fireEvent.click(screen.getByText("SAVE"));
    expect(onUpdate.mock.calls.at(-1)[0][0]).toMatchObject({ linkedKey: "spirit|Grappa Williams" });
  });
});
