import { describe, it, expect } from "vitest";
import { optionalPairingsFromCourses } from "../utils/menuUtils.js";
import { generateMenuHTML } from "../utils/menuGenerator.js";
import { buildDefaultTemplate } from "../utils/menuTemplateSchema.js";

// The admin course editor's "Enabled" checkbox is the switch for a course's
// optional pairing. Unchecking it leaves optional_pairing_flag and the drink
// text on the record — deliberately, so re-enabling restores the whole setup —
// so every consumer has to read the toggle, not just the flag. Before this,
// a course that had once been an optional pairing (SQUASH) kept its cycling
// button in the service UI and its drink on the printed menu forever.

const squash = (opts = {}) => ({
  course_key: "squash",
  course_category: "main",
  position: 1,
  menu: { name: "SQUASH", sub: "cracklings, crayfish" },
  optional_flag: "",
  optional_pairing_flag: "squash_pairing",
  optional_pairing_label: "",
  optional_pairing_default_on: true,
  optional_pairing_alco: { name: "Bramble Sour", sub: "" },
  optional_pairing_na: { name: "Pumpkin Shrub", sub: "" },
  restrictions: {},
  ...opts,
});

describe("a course whose optional pairing is disabled", () => {
  it("offers no pairing button in the service UI", () => {
    expect(optionalPairingsFromCourses([squash({ optional_pairing_enabled: false })]))
      .toEqual([]);
  });

  it("still offers one while the toggle is on", () => {
    const [opt] = optionalPairingsFromCourses([squash({ optional_pairing_enabled: true })]);
    expect(opt).toMatchObject({ key: "squash_pairing", label: "SQUASH", hasAlco: true, hasNonAlco: true });
  });

  it("counts a record that never stored the toggle as enabled", () => {
    // Spreadsheet imports and older records omit the column; the mappers
    // normalize a missing value to true, so only an explicit false disables.
    expect(optionalPairingsFromCourses([squash()])).toHaveLength(1);
  });

  it("prints no pairing drink on the generated menu", () => {
    const course = squash({ optional_pairing_enabled: false });
    const menuTemplate = {
      version: 2,
      rows: [
        { id: "hdr", left: { type: "title" }, right: { type: "logo" }, widthPreset: "55/45", gap: 0 },
        {
          id: "c1",
          left: { type: "course", courseKey: "squash" },
          right: { type: "drinks", drinkSource: "optional_pairing" },
          widthPreset: "55/45",
          gap: 0,
        },
      ],
    };
    const html = generateMenuHTML({
      seat: { id: 1, pairing: "Wine", extras: {}, glasses: [], cocktails: [], beers: [],
              optionalPairings: { squash_pairing: { ordered: true, mode: "alco" } } },
      table: { menuType: "", restrictions: [], bottleWines: [] },
      menuCourses: [course],
      menuTemplate,
    });
    expect(html).toContain("SQUASH");
    expect(html).not.toContain("Bramble Sour");
    expect(html).not.toContain("Pumpkin Shrub");
  });

  it("gets an ordinary drinks block when a layout is built from the courses", () => {
    const off = buildDefaultTemplate([squash({ optional_pairing_enabled: false })]);
    const offRow = off.rows.find((r) => r.id === "course_squash");
    expect(offRow.right.drinkSource).not.toBe("optional_pairing");
    expect(offRow.right.pairingFlag).toBeUndefined();

    const on = buildDefaultTemplate([squash({ optional_pairing_enabled: true })]);
    const onRow = on.rows.find((r) => r.id === "course_squash");
    expect(onRow.right).toMatchObject({ drinkSource: "optional_pairing", pairingFlag: "squash_pairing" });
  });
});
