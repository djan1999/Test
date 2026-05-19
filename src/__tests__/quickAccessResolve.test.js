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
