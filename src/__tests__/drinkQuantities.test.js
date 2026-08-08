// ── Drink quantities ──────────────────────────────────────────────────────────
// The counter on the sheet is a view over the stored one-entry-per-pour lists,
// so these pin the two things that could quietly corrupt an order: which
// entries are treated as the same drink, and that a step touches exactly one
// entry.

import { describe, it, expect } from "vitest";
import {
  addOne, countOf, drinkKey, groupDrinks, qtySuffix, removeAll, removeOne,
} from "../utils/drinkQuantities.js";

const rebula = (over = {}) => ({ name: "Rebula", producer: "Klinec", vintage: "2021", ...over });

describe("drinkQuantities — what counts as the same drink", () => {
  it("ignores case and stray whitespace, which the catalogue and manual entry disagree on", () => {
    expect(drinkKey({ name: " rebula ", producer: "Klinec", vintage: "2021" }))
      .toBe(drinkKey(rebula()));
  });

  it("keeps two producers' Rebula apart", () => {
    expect(drinkKey(rebula())).not.toBe(drinkKey(rebula({ producer: "Movia" })));
  });

  it("keeps two vintages apart", () => {
    expect(drinkKey(rebula())).not.toBe(drinkKey(rebula({ vintage: "2019" })));
  });

  it("does not split a wine over byGlass — the list it sits in already says that", () => {
    expect(drinkKey(rebula({ byGlass: true }))).toBe(drinkKey(rebula({ byGlass: false })));
  });
});

describe("drinkQuantities — grouping", () => {
  it("collapses repeats into one row with the count, in order of first pour", () => {
    const rows = groupDrinks([rebula(), { name: "Negroni" }, rebula()]);
    expect(rows.map(r => [r.item.name, r.qty])).toEqual([["Rebula", 2], ["Negroni", 1]]);
  });

  it("survives the empty, missing and holed lists the board can hand it", () => {
    expect(groupDrinks(undefined)).toEqual([]);
    expect(groupDrinks(null)).toEqual([]);
    expect(groupDrinks([null, rebula(), undefined])).toHaveLength(1);
  });
});

describe("drinkQuantities — stepping", () => {
  it("adds a copy, never an alias of the row's own item", () => {
    const list = [rebula()];
    const next = addOne(list, list[0]);
    expect(next).toHaveLength(2);
    expect(next[1]).not.toBe(next[0]);
    expect(next[1]).toEqual(next[0]);
  });

  it("drops exactly one, and it is the last one poured", () => {
    const first = rebula({ tag: "first" });
    const last = rebula({ tag: "last" });
    const next = removeOne([first, { name: "Negroni" }, last], drinkKey(rebula()));
    expect(next).toEqual([first, { name: "Negroni" }]);
  });

  it("leaves the list alone when there is nothing of that drink to drop", () => {
    const list = [rebula()];
    expect(removeOne(list, drinkKey({ name: "Negroni" }))).toEqual(list);
  });

  it("clears the whole row on remove-all, keeping everything else", () => {
    const negroni = { name: "Negroni" };
    expect(removeAll([rebula(), negroni, rebula()], drinkKey(rebula()))).toEqual([negroni]);
  });

  it("counts what is actually on the list", () => {
    expect(countOf([rebula(), rebula()], drinkKey(rebula()))).toBe(2);
    expect(countOf([], drinkKey(rebula()))).toBe(0);
  });
});

describe("drinkQuantities — the label", () => {
  it("says nothing for a single pour and ×N for a round", () => {
    expect(qtySuffix(1)).toBe("");
    expect(qtySuffix(0)).toBe("");
    expect(qtySuffix(3)).toBe(" ×3");
  });
});
