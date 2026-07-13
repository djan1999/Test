import { describe, expect, it } from "vitest";
import { DEFAULT_SYNC_CONFIG, normalizeSyncConfig } from "../config/syncConfig.js";

describe("wine and beverage sync configuration", () => {
  it("uses safe defaults for a missing configuration", () => {
    expect(normalizeSyncConfig(null)).toEqual(DEFAULT_SYNC_CONFIG);
  });

  it("normalizes country codes and drops incomplete beverage sources", () => {
    expect(normalizeSyncConfig({
      wineCountries: [" si ", "at"],
      beveragePages: [
        { category: " Spirit ", label: " Gin ", url: " https://example.test/gin " },
        { category: "beer", label: "", url: "https://example.test/beer" },
      ],
    })).toMatchObject({
      wineCountries: ["SI", "AT"],
      beveragePages: [{ category: "spirit", label: "Gin", url: "https://example.test/gin" }],
    });
  });
});
