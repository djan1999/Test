// Focused tests for the build-time restaurant defaults extracted from
// App.jsx (src/config/buildDefaults.js). These pin the parsing contract that
// used to live as unreachable module-private code inside App.jsx: every
// helper must degrade to a SAFE default rather than throwing, because a
// mistyped deployment variable must never stop a tablet from opening the
// board.

import { describe, it, expect } from "vitest";
import {
  parseRoomOptions,
  parseHotelGuestsFlag,
  parseSittingTimes,
  parseQuickAccessItems,
  BUILD_ROOM_OPTIONS,
  DEFAULT_SITTING_TIMES,
  DEFAULT_QUICK_ACCESS_ITEMS,
  DEFAULT_RESTAURANT_CONFIG,
} from "../config/buildDefaults.js";
import { configuredTableIds } from "../config/restaurantConfig.js";

describe("parseRoomOptions", () => {
  it("splits, trims and drops blanks", () => {
    expect(parseRoomOptions(" 01 , 11,12 ,, ")).toEqual(["01", "11", "12"]);
  });

  it("is empty for an unset or blank variable", () => {
    expect(parseRoomOptions(undefined)).toEqual([]);
    expect(parseRoomOptions("")).toEqual([]);
    expect(parseRoomOptions(",, ,")).toEqual([]);
  });
});

describe("parseHotelGuestsFlag", () => {
  it("enables hotel guests only for the literal string true", () => {
    expect(parseHotelGuestsFlag("true")).toBe(true);
    expect(parseHotelGuestsFlag("TRUE")).toBe(true);
    expect(parseHotelGuestsFlag(" true ")).toBe(false); // not trimmed — matches the shipped behaviour
    expect(parseHotelGuestsFlag("1")).toBe(false);
    expect(parseHotelGuestsFlag("yes")).toBe(false);
    expect(parseHotelGuestsFlag(undefined)).toBe(false);
  });
});

describe("parseSittingTimes", () => {
  it("splits and trims a configured list", () => {
    expect(parseSittingTimes("18:00, 20:30 ,21:00")).toEqual(["18:00", "20:30", "21:00"]);
  });

  // A board with no sitting rows shows nothing at all, so an empty result is
  // never acceptable — an unset OR entirely blank value must fall back.
  it("falls back to the four standard sittings when unset or blank", () => {
    const standard = ["18:00", "18:30", "19:00", "19:15"];
    expect(parseSittingTimes(undefined)).toEqual(standard);
    expect(parseSittingTimes("")).toEqual(standard);
    expect(parseSittingTimes(" , , ")).toEqual(standard);
  });
});

describe("parseQuickAccessItems", () => {
  it("normalises a configured list", () => {
    const items = parseQuickAccessItems(JSON.stringify([
      { id: 7, label: " Champagne ", type: "wine" },
      { label: "Water", searchKey: "still", linkedKey: " sparkling ", enabled: false },
    ]));
    expect(items).toEqual([
      { id: 7, label: "Champagne", searchKey: "Champagne", linkedKey: undefined, type: "wine", enabled: true },
      { id: 2, label: "Water", searchKey: "still", linkedKey: "sparkling", type: "wine", enabled: false },
    ]);
  });

  it("drops entries with no label", () => {
    expect(parseQuickAccessItems('[{"label":""},{"label":"Kir"}]'))
      .toEqual([{ id: 2, label: "Kir", searchKey: "Kir", linkedKey: undefined, type: "wine", enabled: true }]);
  });

  // A malformed variable must degrade to "no quick access", never throw at
  // module scope — that would take the whole app down at import time.
  it("degrades to an empty list for unset, malformed or non-array values", () => {
    expect(parseQuickAccessItems(undefined)).toEqual([]);
    expect(parseQuickAccessItems("   ")).toEqual([]);
    expect(parseQuickAccessItems("{not json")).toEqual([]);
    expect(parseQuickAccessItems('{"label":"Kir"}')).toEqual([]);
  });
});

describe("this deployment's defaults", () => {
  it("exposes parsed constants of the right shape", () => {
    expect(Array.isArray(BUILD_ROOM_OPTIONS)).toBe(true);
    expect(Array.isArray(DEFAULT_QUICK_ACCESS_ITEMS)).toBe(true);
    expect(DEFAULT_SITTING_TIMES.length).toBeGreaterThan(0);
  });

  // The build-time config is only ever the pre-login starting point; the
  // workspace's restaurant_config_v1 row owns these once it loads.
  it("seeds a neutral ten-table restaurant with hotel features off by default", () => {
    expect(configuredTableIds(DEFAULT_RESTAURANT_CONFIG)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(DEFAULT_RESTAURANT_CONFIG.features.hotelGuests).toBe(false);
    expect(DEFAULT_RESTAURANT_CONFIG.features.roomOptions).toEqual([]);
  });
});
