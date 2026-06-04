import { describe, it, expect } from "vitest";
import { pickBeveragesForCategory } from "../utils/beverages.js";

describe("pickBeveragesForCategory", () => {
  it("returns synced rows for a category when they exist, ignoring manual", () => {
    const rows = [
      { category: "cocktail", source: "manual", name: "Old Snapshot", position: 0 },
      { category: "cocktail", source: "sync", name: "Negroni", position: 0 },
      { category: "cocktail", source: "sync", name: "House G&T", position: 1 },
    ];
    const out = pickBeveragesForCategory(rows, "cocktail");
    expect(out.map(r => r.name)).toEqual(["Negroni", "House G&T"]);
  });

  it("regression: a stale manual snapshot must not shadow a fresh sync", () => {
    // Mirrors the real data that caused the bug: 10 manual + 10 sync cocktails.
    const rows = [
      { category: "cocktail", source: "manual", name: "Freezer Dry Martini", position: 0 },
      { category: "cocktail", source: "manual", name: "Old Fashion", position: 1 },
      { category: "cocktail", source: "sync", name: "Dry Martini", position: 0 },
      { category: "cocktail", source: "sync", name: "Old Fashioned", position: 1 },
      { category: "cocktail", source: "sync", name: "Vieux Carré", position: 2 },
    ];
    const out = pickBeveragesForCategory(rows, "cocktail");
    expect(out.map(r => r.name)).toEqual(["Dry Martini", "Old Fashioned", "Vieux Carré"]);
  });

  it("falls back to manual rows when a category was never synced", () => {
    const rows = [
      { category: "cocktail", source: "manual", name: "House Special", position: 0 },
      { category: "spirit", source: "sync", name: "Gin", position: 0 },
    ];
    expect(pickBeveragesForCategory(rows, "cocktail").map(r => r.name)).toEqual(["House Special"]);
  });

  it("sorts by position and normalizes missing notes", () => {
    const rows = [
      { category: "beer", source: "sync", name: "B", position: 2 },
      { category: "beer", source: "sync", name: "A", position: 1, notes: "lager" },
    ];
    const out = pickBeveragesForCategory(rows, "beer");
    expect(out.map(r => r.name)).toEqual(["A", "B"]);
    expect(out[1].notes).toBe("");
  });

  it("only returns rows for the requested category", () => {
    const rows = [
      { category: "cocktail", source: "sync", name: "Negroni", position: 0 },
      { category: "spirit", source: "sync", name: "Whisky", position: 0 },
    ];
    expect(pickBeveragesForCategory(rows, "cocktail").map(r => r.name)).toEqual(["Negroni"]);
  });

  it("returns an empty array for empty or non-array input", () => {
    expect(pickBeveragesForCategory([], "cocktail")).toEqual([]);
    expect(pickBeveragesForCategory(null, "cocktail")).toEqual([]);
  });
});
