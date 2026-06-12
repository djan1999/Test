import { describe, it, expect } from "vitest";
import {
  eightySixKeyFor, wineEightySixKey, dishEightySixKey,
  normalizeEightySixKeys, eightySixKeyLabel,
} from "../utils/eightySix.js";
import { setEightySixCache, getEightySixSet } from "../hooks/useEightySix.js";

describe("86 key derivation", () => {
  it("keys wines by their stable DB key, for glass and bottle alike", () => {
    const w = { id: "movia|rebula|2020|slovenia", name: "Rebula" };
    expect(wineEightySixKey(w)).toBe("wine|movia|rebula|2020|slovenia");
    expect(eightySixKeyFor("wine", w)).toBe(wineEightySixKey(w));
    expect(eightySixKeyFor("bottle", w)).toBe(wineEightySixKey(w));
  });

  it("falls back to the lowercased name for wines without a string key", () => {
    expect(wineEightySixKey({ id: 7, name: "House Red" })).toBe("wine|house red");
  });

  it("keys beverages by type and normalized name (sync recreates their row ids)", () => {
    expect(eightySixKeyFor("cocktail", { name: " Old Fashioned " })).toBe("cocktail|old fashioned");
    expect(eightySixKeyFor("beer", { name: "Union" })).toBe("beer|union");
  });

  it("keys dishes by their optional flag", () => {
    expect(dishEightySixKey(" Cheese ")).toBe("dish|cheese");
  });
});

describe("normalizeEightySixKeys", () => {
  it("accepts only non-empty strings", () => {
    expect(normalizeEightySixKeys({ keys: ["a", "", 3, null, "b"] })).toEqual(["a", "b"]);
    expect(normalizeEightySixKeys(null)).toEqual([]);
    expect(normalizeEightySixKeys({})).toEqual([]);
  });
});

describe("eightySixKeyLabel", () => {
  it("renders readable fallbacks for unresolvable keys", () => {
    expect(eightySixKeyLabel("cocktail|old fashioned")).toBe("old fashioned");
    expect(eightySixKeyLabel("wine|movia|veliko_belo|2019|slovenia")).toBe("movia · veliko belo");
    expect(eightySixKeyLabel("dish|cheese")).toBe("cheese");
  });
});

describe("eighty-six store", () => {
  it("mirrors the saved keys into a Set and replaces on update", () => {
    setEightySixCache(["wine|x", "beer|y"]);
    expect(getEightySixSet().has("wine|x")).toBe(true);
    setEightySixCache(["beer|y"]);
    expect(getEightySixSet().has("wine|x")).toBe(false);
    expect(getEightySixSet().has("beer|y")).toBe(true);
    setEightySixCache([]); // reset for other tests
  });
});
