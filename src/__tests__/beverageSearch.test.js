// ── Forgiving beverage search ────────────────────────────────────────────────
// The rules the operator feels: accents they can't type, producers they can't
// spell, and words in whatever order they came to mind — against a bar list
// that is mostly Slovenian.

import { describe, it, expect } from "vitest";
import {
  MIN_QUERY,
  boundedEditDistance,
  foldText,
  matchScore,
  searchBeverages,
} from "../utils/beverageSearch.js";

const wine = (name, producer = "", vintage = "", extra = {}) =>
  ({ id: name, name, producer, vintage, ...extra });

const CATALOG = {
  wines: [
    wine("Rebula", "Klinec", "2021", { byGlass: true }),
    wine("Rebula Ortodox", "Movia", "2018"),
    wine("Šipon", "Dveri Pax", "2020"),
    wine("Žametovka", "Frelih", "2019"),
    wine("Teran", "Čotar", "2017"),
  ],
  cocktails: [{ id: "c1", name: "Negroni", notes: "bitter, sweet vermouth" }],
  spirits: [{ id: "s1", name: "Negrita Rum", notes: "dark" }],
  beers: [{ id: "b1", name: "Human Fish Lager", notes: "pale" }],
};

const names = (rows) => rows.map(r => r.item.name);

describe("foldText", () => {
  it("strips accents and punctuation down to comparable words", () => {
    expect(foldText("Šipon – Klinec (2021)")).toBe("sipon klinec 2021");
    expect(foldText("Žametovka")).toBe("zametovka");
    expect(foldText("Čotar")).toBe("cotar");
    expect(foldText("")).toBe("");
    expect(foldText(null)).toBe("");
  });
});

describe("boundedEditDistance", () => {
  it("measures small edits and gives up past the bound", () => {
    expect(boundedEditDistance("rebula", "rebula", 2)).toBe(0);
    expect(boundedEditDistance("rebulla", "rebula", 2)).toBe(1);
    expect(boundedEditDistance("rebual", "rebula", 2)).toBe(2);
    expect(boundedEditDistance("negroni", "rebula", 2)).toBeGreaterThan(2);
  });

  it("rejects on length alone before doing any work", () => {
    expect(boundedEditDistance("a", "abcdefgh", 2)).toBeGreaterThan(2);
  });
});

describe("matchScore", () => {
  it("finds a word the operator could not type the accent for", () => {
    expect(matchScore("sipon", "Šipon")).not.toBeNull();
    expect(matchScore("zametovka", "Žametovka")).not.toBeNull();
    expect(matchScore("cotar", "Teran", "Čotar")).not.toBeNull();
  });

  it("forgives a typo once the word is long enough to be sure", () => {
    expect(matchScore("rebulla", "Rebula")).not.toBeNull();   // 7 chars, 1 edit
    expect(matchScore("negronni", "Negroni")).not.toBeNull();
    // Three characters is too short to guess at — everything is one edit from
    // everything, and the list would answer every query with the whole bar.
    expect(matchScore("reb", "Teran")).toBeNull();
  });

  it("takes the query's words in any order, across any field", () => {
    expect(matchScore("klinec rebula", "Rebula", "Klinec")).not.toBeNull();
    expect(matchScore("rebula klinec", "Rebula", "Klinec")).not.toBeNull();
    expect(matchScore("2021 klinec", "Rebula", "Klinec", "2021")).not.toBeNull();
  });

  it("requires every token to land — one miss disqualifies the row", () => {
    expect(matchScore("rebula movia", "Rebula", "Klinec")).toBeNull();
  });

  it("ranks an exact word over a prefix, and a prefix over a typo", () => {
    const exact = matchScore("rebula", "Rebula");
    const prefix = matchScore("rebu", "Rebula");
    const typo = matchScore("rebulla", "Rebula");
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(typo);
  });

  it("says nothing for an empty query or an empty record", () => {
    expect(matchScore("", "Rebula")).toBeNull();
    expect(matchScore("   ", "Rebula")).toBeNull();
    expect(matchScore("rebula")).toBeNull();
  });
});

describe("searchBeverages", () => {
  it("waits for the minimum query length", () => {
    expect(searchBeverages("r", CATALOG)).toEqual([]);
    expect(searchBeverages("re", CATALOG).length).toBeGreaterThan(0);
    expect(MIN_QUERY).toBe(2);
  });

  it("reaches every corner of the bar from one field", () => {
    expect(names(searchBeverages("negroni", CATALOG))).toContain("Negroni");
    expect(names(searchBeverages("rum", CATALOG))).toContain("Negrita Rum");
    expect(names(searchBeverages("lager", CATALOG))).toContain("Human Fish Lager");
    expect(names(searchBeverages("vermouth", CATALOG))).toContain("Negroni");   // by its notes
  });

  it("puts the closest hit first", () => {
    expect(names(searchBeverages("rebula", CATALOG))[0]).toBe("Rebula");
    expect(names(searchBeverages("ortodox", CATALOG))[0]).toBe("Rebula Ortodox");
  });

  it("returns EVERY hit, not a handful — the list scrolls", () => {
    const many = { wines: Array.from({ length: 30 }, (_, i) => wine(`Rebula ${i}`, "Klinec")) };
    expect(searchBeverages("rebula", many)).toHaveLength(30);
  });

  it("still caps at the guard so a loose query can't drag in the whole cellar", () => {
    const huge = { wines: Array.from({ length: 200 }, (_, i) => wine(`Rebula ${i}`, "Klinec")) };
    expect(searchBeverages("rebula", huge)).toHaveLength(40);
  });

  it("carries the type and a readable sub-line for each hit", () => {
    const [hit] = searchBeverages("ortodox", CATALOG);
    expect(hit.type).toBe("wine");
    expect(hit.sub).toBe("Movia · 2018");
    const [cocktail] = searchBeverages("negroni", CATALOG);
    expect(cocktail.type).toBe("cocktail");
    expect(cocktail.sub).toBe("bitter, sweet vermouth");
  });

  it("survives a missing or ragged catalog", () => {
    expect(searchBeverages("rebula")).toEqual([]);
    expect(searchBeverages("rebula", { wines: null, cocktails: undefined })).toEqual([]);
    expect(searchBeverages("rebula", { wines: [{ name: "Rebula" }] })).toHaveLength(1);
  });
});
