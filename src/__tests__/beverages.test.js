import { describe, it, expect } from "vitest";
import { pickBeveragesForCategory, manualBeverageRows } from "../utils/beverages.js";

describe("pickBeveragesForCategory", () => {
  it("puts the synced rows first, in the order the website lists them", () => {
    const rows = [
      { category: "cocktail", source: "manual", name: "House Only", position: 0 },
      { category: "cocktail", source: "sync", name: "Negroni", position: 0 },
      { category: "cocktail", source: "sync", name: "House G&T", position: 1 },
    ];
    const out = pickBeveragesForCategory(rows, "cocktail");
    expect(out.map(r => r.name)).toEqual(["Negroni", "House G&T", "House Only"]);
  });

  it("drops a manual row the sync already carries by name", () => {
    // The twin a whole-list "Save Drinks" used to leave behind. The sync owns
    // the row; the snapshot of it is not a second drink.
    const rows = [
      { category: "tea", source: "sync", name: "Cascara", position: 0, notes: "Tea" },
      { category: "tea", source: "manual", name: "cascara", position: 0, notes: "stale" },
      { category: "tea", source: "manual", name: "Peppermint", position: 1, notes: "Tea" },
    ];
    const out = pickBeveragesForCategory(rows, "tea");
    expect(out.map(r => [r.name, r.notes])).toEqual([["Cascara", "Tea"], ["Peppermint", "Tea"]]);
  });

  it("keeps a drink the kitchen pours that the website does not list", () => {
    // Reported as "adding teas or coffees and saving isn't saving them": the
    // row reached the table and every read then filtered it back out, because
    // one synced row in the category hid every manual one.
    const rows = [
      ...["MILKA Tea Mix", "Cascara"].map((name, i) => ({ category: "tea", source: "sync", name, position: i })),
      ...["MILKA Tea Mix", "Cascara", "Peppermint", "Chamomile"].map((name, i) => ({ category: "tea", source: "manual", name, position: i })),
    ];
    expect(pickBeveragesForCategory(rows, "tea").map(r => r.name))
      .toEqual(["MILKA Tea Mix", "Cascara", "Peppermint", "Chamomile"]);
  });

  it("says where each row came from, so a save can write back only its own", () => {
    const rows = [
      { category: "tea", source: "sync", name: "Cascara", position: 0 },
      { category: "tea", source: "manual", name: "Peppermint", position: 0 },
    ];
    expect(pickBeveragesForCategory(rows, "tea").map(r => r.source)).toEqual(["sync", "manual"]);
  });

  it("regression: a stale manual snapshot must not shadow a fresh sync", () => {
    // Mirrors the real data that caused the bug: 10 manual + 10 sync cocktails.
    // The sync's list still arrives whole and in its own order — that is what
    // "must not shadow" means. An old manual row the sync has no name for is
    // kept rather than discarded, so it now trails the list instead of being
    // invisible; it cannot displace or reorder anything the website sent.
    const rows = [
      { category: "cocktail", source: "manual", name: "Freezer Dry Martini", position: 0 },
      { category: "cocktail", source: "manual", name: "Old Fashion", position: 1 },
      { category: "cocktail", source: "sync", name: "Dry Martini", position: 0 },
      { category: "cocktail", source: "sync", name: "Old Fashioned", position: 1 },
      { category: "cocktail", source: "sync", name: "Vieux Carré", position: 2 },
    ];
    const out = pickBeveragesForCategory(rows, "cocktail");
    expect(out.filter(r => r.source === "sync").map(r => r.name))
      .toEqual(["Dry Martini", "Old Fashioned", "Vieux Carré"]);
    expect(out.slice(0, 3).map(r => r.name)).toEqual(["Dry Martini", "Old Fashioned", "Vieux Carré"]);
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

describe("manualBeverageRows", () => {
  const shown = [
    { name: "Cascara", notes: "Tea", source: "sync" },
    { name: "Peppermint", notes: "Tea", source: "manual" },
    { name: "Chamomile", notes: "" },
  ];

  it("writes back the operator's rows and never the website's", () => {
    // Snapshotting the whole list is what left a synced category holding two
    // copies of every row, one of which every read then had to throw away.
    expect(manualBeverageRows(shown, "tea")).toEqual([
      { category: "tea", name: "Peppermint", notes: "Tea", position: 0, source: "manual" },
      { category: "tea", name: "Chamomile", notes: "", position: 1, source: "manual" },
    ]);
  });

  it("treats a row with no source as the operator's — it was just added", () => {
    expect(manualBeverageRows([{ name: "Chamomile" }], "tea")[0].source).toBe("manual");
  });

  it("drops a blank row rather than writing a nameless drink", () => {
    expect(manualBeverageRows([{ name: "   " }, { name: "Peppermint" }], "tea").map(r => r.name))
      .toEqual(["Peppermint"]);
  });

  it("round-trips: what is shown, saved and read back is what was shown", () => {
    const stored = [
      { category: "tea", source: "sync", name: "Cascara", notes: "Tea", position: 0 },
      { category: "tea", source: "manual", name: "Peppermint", notes: "Tea", position: 0 },
    ];
    const displayed = pickBeveragesForCategory(stored, "tea");
    const added = [...displayed, { name: "Chamomile", notes: "" }];
    const written = manualBeverageRows(added, "tea").map(r => ({ ...r, category: "tea" }));
    const reRead = pickBeveragesForCategory(
      [...stored.filter(r => r.source === "sync"), ...written], "tea");
    expect(reRead.map(r => r.name)).toEqual(["Cascara", "Peppermint", "Chamomile"]);
  });
});
