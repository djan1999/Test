import { describe, it, expect } from "vitest";
import { buildBeverageLinkedKey, resolveAperitifFromQuickAccessOption } from "../utils/quickAccessResolve.js";

describe("resolveAperitifFromQuickAccessOption", () => {
  const wines = [{ id: "movia|lunar|2019|si", name: "Lunar", producer: "Movia", byGlass: true }];
  const cocktails = [{ id: 1, name: "Negroni", notes: "bitter" }];

  it("resolves wine by linkedKey (stable DB key)", () => {
    const r = resolveAperitifFromQuickAccessOption(
      { label: "Lunar", linkedKey: "movia|lunar|2019|si", searchKey: "Lunar", type: "wine" },
      { wines, cocktails, spirits: [], beers: [] }
    );
    expect(r).toEqual(wines[0]);
  });

  it("resolves cocktail by linkedKey", () => {
    const lk = buildBeverageLinkedKey("cocktail", "Negroni");
    const r = resolveAperitifFromQuickAccessOption(
      { label: "Negroni", linkedKey: lk, searchKey: "Negroni", type: "cocktail" },
      { wines, cocktails, spirits: [], beers: [] }
    );
    expect(r?.name).toBe("Negroni");
  });
});

describe("tea and coffee are catalogue products like any other", () => {
  // The whole point of giving them a category: a digestivo button LINKS to a
  // real row instead of asking the wine list for "tea" and being handed a
  // Coteaux Champenois, which is what it did before.
  const CELLAR = [
    { id: "w1", name: "Adrien Renoir – Coteaux Champenois", producer: "Adrien Renoir", byGlass: true },
  ];
  const TEAS = [{ id: 21, name: "MILKA Tea Mix", notes: "Tea" }];
  const COFFEES = [
    { id: 31, name: "Nestor Lasso Ají Decaf", notes: "Filter, BANI BEANS" },
    { id: 32, name: "Espresso", notes: "Espresso, Banibeans" },
  ];
  const catalogs = { wines: CELLAR, cocktails: [], spirits: [], beers: [], teas: TEAS, coffees: COFFEES };

  it("resolves a tea by its linked key", () => {
    const r = resolveAperitifFromQuickAccessOption(
      { label: "Tea", type: "tea", linkedKey: buildBeverageLinkedKey("tea", "MILKA Tea Mix") },
      catalogs,
    );
    expect(r).toEqual(TEAS[0]);
  });

  it("resolves a coffee by its linked key, down to the subcategory", () => {
    const r = resolveAperitifFromQuickAccessOption(
      { label: "Coffee", type: "coffee", linkedKey: buildBeverageLinkedKey("coffee", "Nestor Lasso Ají Decaf") },
      catalogs,
    );
    expect(r.notes).toBe("Filter, BANI BEANS");
  });

  it("searches its own category and never the wine list", () => {
    // This is the bug, in one assertion: a Tea button must not come back
    // holding a champagne, whether or not a tea exists to find.
    expect(resolveAperitifFromQuickAccessOption({ label: "Tea", searchKey: "Tea", type: "tea" }, catalogs))
      .toEqual(TEAS[0]);
    expect(resolveAperitifFromQuickAccessOption(
      { label: "Tea", searchKey: "Tea", type: "tea" },
      { ...catalogs, teas: [] },
    )).toBeNull();
  });

  it("falls back to the search key when a linked row has been deleted", () => {
    const r = resolveAperitifFromQuickAccessOption(
      { label: "Coffee", searchKey: "Espresso", type: "coffee", linkedKey: buildBeverageLinkedKey("coffee", "Gone") },
      catalogs,
    );
    expect(r.name).toBe("Espresso");
  });
});
