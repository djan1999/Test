import { describe, it, expect } from "vitest";
import { buildBeverageLinkedKey, describeQuickAccessLink, resolveAperitifFromQuickAccessOption, wineKeyIsStale } from "../utils/quickAccessResolve.js";

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

describe("a linked wine never falls back to a fuzzy guess", () => {
  // The reported bug: links coming back as an old Adrien Renoir. A linked
  // button whose row is gone used to fuzzy-search its name across the whole
  // list and take the first by-the-glass hit.
  const wines = [
    { id: "adrien_renoir|'le_terroir'_verzy_grand_cru_(dég.03/22)|nv|fr", name: "'Le Terroir' Verzy Grand Cru", producer: "Adrien Renoir", byGlass: true },
    { id: "egly-ouriet|grand_cru|nv|fr", name: "Grand Cru", producer: "Egly-Ouriet", byGlass: true },
    { id: "krug|vintage_2013|2013|fr", name: "Vintage 2013", producer: "Krug", byGlass: false },
  ];
  const catalogs = { wines, cocktails: [], spirits: [], beers: [] };

  it("returns null rather than another wine when the link is gone", () => {
    const ap = {
      label: "Renoir", type: "wine",
      linkedKey: "adrien_renoir|'le_terroir'_verzy_grand_cru_(dég.05/25)|nv|fr",
      searchKey: "'Le Terroir' Verzy Grand Cru (dég.05/25)",
    };
    expect(resolveAperitifFromQuickAccessOption(ap, catalogs)).toBeNull();
    expect(describeQuickAccessLink(ap, catalogs).status).toBe("missing");
  });

  it("re-finds the same wine by exact name and producer when only its key changed", () => {
    const ap = { label: "Krug", type: "wine", linkedKey: "krug|vintage_2013|2013|be", searchKey: "Vintage 2013" };
    expect(resolveAperitifFromQuickAccessOption(ap, catalogs)).toBe(wines[2]);
    expect(describeQuickAccessLink(ap, catalogs).status).toBe("relinked");
  });

  it("does not re-find a same-named wine from another producer", () => {
    const ap = { label: "Egly", type: "wine", linkedKey: "pierre_peters|grand_cru|nv|fr", searchKey: "Grand Cru" };
    expect(resolveAperitifFromQuickAccessOption(ap, catalogs)).toBeNull();
  });

  it("still guesses by label for a button that was never linked", () => {
    const d = describeQuickAccessLink({ label: "Krug", searchKey: "Krug", type: "wine" }, catalogs);
    expect(d.status).toBe("guessed");
    expect(d.item).toBe(wines[2]);
  });
});

describe("wineKeyIsStale", () => {
  it("flags a row edited into another producer's wine", () => {
    // Live data: the Renoir row retyped as Nakada-Park Harmonie kept its key.
    expect(wineKeyIsStale({ id: "adrien_renoir|'le_terroir'_verzy_grand_cru_(dég.05/25)|nv|fr", name: "Harmonie", producer: "Nakada-Park" })).toBe(true);
    expect(wineKeyIsStale({ id: "nakada-park|harmonie|nv|fr", name: "Harmonie", producer: "Nakada-Park" })).toBe(false);
    expect(wineKeyIsStale({ id: "domaine_slapšak|blanc_de_blanc|2020|si", name: "Blanc de blanc", producer: "Domaine Slapšak" })).toBe(false);
    expect(wineKeyIsStale({ id: "manual|abc", name: "Harmonie", producer: "Nakada-Park" })).toBe(false);
  });
});
