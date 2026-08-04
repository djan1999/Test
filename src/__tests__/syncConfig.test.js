import { describe, expect, it } from "vitest";
import {
  DEFAULT_SYNC_CONFIG,
  hasCatalogSyncProvider,
  normalizeSyncConfig,
} from "../config/syncConfig.js";

describe("wine and beverage sync configuration", () => {
  it("uses safe defaults for a missing configuration", () => {
    expect(normalizeSyncConfig(null)).toEqual(DEFAULT_SYNC_CONFIG);
  });

  it("normalizes country codes and drops incomplete beverage sources", () => {
    expect(normalizeSyncConfig({
      provider: "milka",
      winesEnabled: true,
      wineCountries: [" si ", "at"],
      beveragePages: [
        { category: " Spirit ", label: " Gin ", url: " https://example.test/gin " },
        { category: "beer", label: "", url: "https://example.test/beer" },
      ],
    })).toMatchObject({
      provider: "milka",
      winesEnabled: true,
      wineCountries: ["SI", "AT"],
      beveragePages: [{ category: "spirit", label: "Gin", url: "https://example.test/gin" }],
    });
  });

  it("keeps a new restaurant disabled even when enable flags are supplied", () => {
    expect(normalizeSyncConfig({ winesEnabled: true, beveragesEnabled: true })).toEqual(DEFAULT_SYNC_CONFIG);
    expect(hasCatalogSyncProvider({ winesEnabled: true })).toBe(false);
  });

  it("recognizes existing Hotel Milka settings that predate provider metadata", () => {
    const legacy = normalizeSyncConfig({
      winesEnabled: true,
      beveragesEnabled: true,
      wineCountries: ["SI"],
      beveragePages: [{
        category: "wine",
        label: "Legacy source",
        url: "https://vinska-karta.hotelmilka.si/category/vino/",
      }],
    });
    expect(legacy.provider).toBe("milka");
    expect(legacy.winesEnabled).toBe(true);
    expect(hasCatalogSyncProvider(legacy)).toBe(true);
  });
});
