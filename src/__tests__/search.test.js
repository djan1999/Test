import { describe, it, expect } from "vitest";
import { fuzzy, fuzzyDrink } from "../utils/search.js";

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
