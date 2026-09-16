import { describe, it, expect } from "vitest";
import { fuzzy, fuzzyDrink, keyHitsText, resolveAperitifCatalogItem, aperitifMatchesQuickAccess } from "../utils/search.js";

const wines = [
  { name: "Riesling Spätlese", producer: "Mosel Estate", vintage: "2021", byGlass: true },
  { name: "Pinot Noir", producer: "Burgundy Domaine", vintage: "2019", byGlass: false },
  { name: "Chardonnay", producer: "Mosel Estate", vintage: "2022", byGlass: true },
];

const drinks = [
  { name: "Negroni", notes: "bitter, gin" },
  { name: "Mojito", notes: "rum, mint" },
  { name: "Old Fashioned", notes: "bourbon, bitters" },
];

describe("fuzzy (wine search)", () => {
  it("matches by wine name", () => {
    expect(fuzzy("riesling", wines)).toHaveLength(1);
    expect(fuzzy("riesling", wines)[0].name).toBe("Riesling Spätlese");
  });

  it("matches by producer", () => {
    const results = fuzzy("mosel", wines);
    expect(results).toHaveLength(2);
  });

  it("matches by vintage", () => {
    const results = fuzzy("2019", wines);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("Pinot Noir");
  });

  it("is case-insensitive", () => {
    expect(fuzzy("PINOT", wines)).toHaveLength(1);
  });

  it("returns empty array for empty query", () => {
    expect(fuzzy("", wines)).toEqual([]);
  });

  it("filters by byGlass when specified", () => {
    const byGlass = fuzzy("mosel", wines, true);
    expect(byGlass.every(w => w.byGlass === true)).toBe(true);
  });

  it("includes all matching when byGlass is null", () => {
    expect(fuzzy("mosel", wines, null)).toHaveLength(2);
  });

  it("bottle search (byGlass false) also surfaces by-the-glass wines", () => {
    // Every wine can be ordered by the bottle, so a bottle search must not
    // hide wines that are also poured by the glass.
    const bottle = fuzzy("mosel", wines, false);
    expect(bottle).toHaveLength(2);
    expect(bottle.some(w => w.byGlass === true)).toBe(true);
  });

  it("bottle search finds a wine that is only offered by the glass", () => {
    const bottle = fuzzy("riesling", wines, false);
    expect(bottle).toHaveLength(1);
    expect(bottle[0].name).toBe("Riesling Spätlese");
  });

  it("caps results at 6", () => {
    const big = Array.from({ length: 10 }, (_, i) => ({
      name: `Wine ${i}`, producer: "Same", vintage: "2020", byGlass: true,
    }));
    expect(fuzzy("Wine", big)).toHaveLength(6);
  });
});

describe("fuzzyDrink", () => {
  it("matches by drink name", () => {
    expect(fuzzyDrink("negroni", drinks)).toHaveLength(1);
  });

  it("matches by notes", () => {
    expect(fuzzyDrink("bourbon", drinks)).toHaveLength(1);
    expect(fuzzyDrink("bourbon", drinks)[0].name).toBe("Old Fashioned");
  });

  it("is case-insensitive", () => {
    expect(fuzzyDrink("MOJITO", drinks)).toHaveLength(1);
  });

  it("returns empty array for empty query", () => {
    expect(fuzzyDrink("", drinks)).toEqual([]);
  });

  it("caps results at 6", () => {
    const big = Array.from({ length: 10 }, (_, i) => ({ name: `Drink ${i}`, notes: "same" }));
    expect(fuzzyDrink("Drink", big)).toHaveLength(6);
  });
});

describe("resolveAperitifCatalogItem", () => {
  const wines = [
    { name: "Lunar", producer: "Movia", vintage: "2016", byGlass: false },
    { name: "Robinia", producer: "Štemberger", vintage: "2018", byGlass: true },
  ];
  const cocktails = [{ name: "Negroni", notes: "Campari" }];

  it("matches wine by grape name only (picker-style key)", () => {
    const w = resolveAperitifCatalogItem("Robinia", "wine", { wines, cocktails });
    expect(w).toEqual(wines[1]);
  });

  it("matches wine by full Producer – Name string (legacy saved keys)", () => {
    const w = resolveAperitifCatalogItem("Štemberger – Robinia", "wine", { wines, cocktails });
    expect(w).toEqual(wines[1]);
  });

  it("matches cocktail by name", () => {
    const c = resolveAperitifCatalogItem("negroni", "cocktail", { wines, cocktails });
    expect(c?.name).toBe("Negroni");
  });
});

describe("aperitifMatchesQuickAccess", () => {
  const wines = [{ id: "k1", name: "Lunar", producer: "Movia", vintage: "2016", byGlass: true }];

  it("returns true when stored row matches resolved catalog wine", () => {
    expect(aperitifMatchesQuickAccess(
      { id: "k1", name: "Lunar", producer: "Movia" },
      "Lunar",
      "wine",
      { wines }
    )).toBe(true);
  });
});

describe("a quick-access key must land on a word boundary", () => {
  // The bug this pins: the Tea digestivo button came back linked to a
  // champagne. "tea" is a substring of Co·tea·ux and Cha·tea·u, and the
  // resolver picks ONE match silently rather than offering a list — so the
  // first by-the-glass Coteaux Champenois on the wine list won a button meant
  // for a pot of tea.
  const cellar = [
    { id: "w1", name: "Adrien Renoir – Coteaux Champenois Verzy blanc", producer: "Adrien Renoir", byGlass: true },
    { id: "w2", name: "Chateau Thivin – Cote de Brouilly", producer: "Chateau Thivin", byGlass: true },
    { id: "w3", name: "Nebbiolo d'Alba", producer: "Produttori", byGlass: true },
  ];

  it("refuses the middle of somebody else's word", () => {
    expect(keyHitsText("Adrien Renoir – Coteaux Champenois", "tea")).toBe(false);
    expect(keyHitsText("Chateau Thivin", "tea")).toBe(false);
    expect(resolveAperitifCatalogItem("Tea", "wine", { wines: cellar })).toBeNull();
  });

  it("still takes a whole word, wherever it sits", () => {
    expect(keyHitsText("Milka Tea", "tea")).toBe(true);
    expect(keyHitsText("Tea", "tea")).toBe(true);
    expect(keyHitsText("Earl Grey – Tea House", "tea")).toBe(true);
  });

  it("still takes a prefix, so a shortened key keeps working", () => {
    expect(keyHitsText("Nebbiolo d'Alba", "nebb")).toBe(true);
    expect(resolveAperitifCatalogItem("Nebb", "wine", { wines: cellar })?.id).toBe("w3");
  });

  it("finds the tea once the catalogue actually has one", () => {
    const withTea = [...cellar, { id: "w9", name: "Milka Tea Blend", producer: "House", byGlass: true }];
    expect(resolveAperitifCatalogItem("Tea", "wine", { wines: withTea })?.id).toBe("w9");
  });

  it("holds for drinks as well as wines", () => {
    const pours = [{ name: "Coteaux Punch", notes: "" }, { name: "Tea Punch", notes: "" }];
    expect(resolveAperitifCatalogItem("Tea", "cocktail", { cocktails: pours })?.name).toBe("Tea Punch");
  });

  it("treats a stored chip the same way when nothing resolves", () => {
    // The fallback compare has to agree, or a seat would keep a champagne chip
    // that the button no longer claims.
    expect(aperitifMatchesQuickAccess(
      { name: "Adrien Renoir – Coteaux Champenois", producer: "Adrien Renoir" },
      "Tea", "wine", { wines: [] },
    )).toBe(false);
    expect(aperitifMatchesQuickAccess({ name: "Milka Tea" }, "Tea", "wine", { wines: [] })).toBe(true);
  });

  it("escapes a key that looks like a pattern instead of throwing", () => {
    expect(keyHitsText("Riesling (dry)", "(dry)")).toBe(true);
    expect(keyHitsText("Riesling", "*")).toBe(false);
  });
});
