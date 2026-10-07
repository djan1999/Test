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

describe("the panel says what a button pours", () => {
  // Live config, 07.10: "Nakada" linked to a row whose key is the old Adrien
  // Renoir pour — the row had been retyped into Harmonie in Drinks. The panel
  // showed "id: adrien_renoir|…", which read as a link to Renoir.
  const WINES = [
    { id: "adrien_renoir|'le_terroir'_verzy_grand_cru_(dég.05/25)|nv|fr", name: "Harmonie", producer: "Nakada-Park", vintage: "NV", byGlass: true },
    { id: "nakada-park|harmonie|nv|fr", name: "Harmonie", producer: "Nakada-Park", vintage: "NV", byGlass: true },
  ];
  const renderAperitif = (items) => render(
    <QuickAccessPanel quickAccessItems={items} onUpdateQuickAccess={vi.fn()} wines={WINES} />,
  );

  it("names the product, not the raw id, and flags a row edited from another wine", () => {
    renderAperitif([{ id: 1, label: "Nakada", type: "wine", enabled: true, searchKey: "Harmonie", linkedKey: WINES[0].id }]);
    expect(screen.getByText("→ Nakada-Park – Harmonie · NV")).toBeTruthy();
    expect(screen.queryByText(/adrien_renoir/)).toBeNull();
    expect(screen.getByText(/edited in Drinks from a different wine/)).toBeTruthy();
  });

  it("shows a vanished link as missing instead of guessing another wine", () => {
    renderAperitif([{ id: 1, label: "Renoir", type: "wine", enabled: true, searchKey: "'Le Terroir' Verzy Grand Cru (dég.03/22)", linkedKey: "adrien_renoir|'le_terroir'_verzy_grand_cru_(dég.03/22)|nv|fr" }]);
    expect(screen.getByText(/Linked product missing/)).toBeTruthy();
  });

  it("marks an unlinked button as a name match", () => {
    renderAperitif([{ id: 1, label: "Harmonie", type: "wine", enabled: true, searchKey: "Harmonie" }]);
    expect(screen.getByText(/matched by name, not linked/)).toBeTruthy();
  });
});
