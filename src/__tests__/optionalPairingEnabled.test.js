import { describe, it, expect } from "vitest";
import { optionalPairingsFromCourses } from "../utils/menuUtils.js";
import { generateMenuHTML } from "../utils/menuGenerator.js";
import { buildDefaultTemplate } from "../utils/menuTemplateSchema.js";
import { supabaseRowToCourse } from "../utils/menuCourseMapper.js";

// Only a handful of courses sell an optional pairing — a drink of their own,
// cycled from a button on the seat. Today that's crayfish (Martini), beetroot
// and chicken gizzard (Beer). Every other course carries its drink through the
// ordinary pairing columns, so the pairing is opt-in: the admin editor's
// "Enabled" checkbox turns it on and nothing else does.
//
// The checkbox leaves optional_pairing_flag and the drink text on the record
// when it goes off, so a course retired from optional pairings keeps its key
// forever. SQUASH is the live example — key "squash", label "SQUASH", checkbox
// off — and it kept its button on the seat and its drink on the menu until
// every consumer started reading the checkbox instead of the key.

const squash = (opts = {}) => ({
  course_key: "squash",
  course_category: "main",
  position: 1,
  menu: { name: "SQUASH", sub: "cracklings, crayfish" },
  optional_flag: "",
  optional_pairing_flag: "squash",
  optional_pairing_label: "SQUASH",
  optional_pairing_default_on: true,
  wp: { name: "Nando, Sauvignon '08", sub: "" },
  na: { name: "FIG LEAF", sub: "" },
  restrictions: {},
  ...opts,
});

const crayfish = (opts = {}) => ({
  course_key: "crayfish",
  course_category: "main",
  position: 2,
  menu: { name: "CRAYFISH", sub: "" },
  optional_flag: "",
  optional_pairing_flag: "Crayfish",
  optional_pairing_label: "Martini",
  optional_pairing_enabled: true,
  optional_pairing_default_on: true,
  optional_pairing_alco: { name: "Kitchen Martini", sub: "" },
  optional_pairing_na: { name: "Kitchen Martini", sub: "" },
  restrictions: {},
  ...opts,
});

describe("optional pairings are opt-in", () => {
  it("keeps the courses that sell one, under their own drink label", () => {
    const [opt] = optionalPairingsFromCourses([crayfish()]);
    expect(opt).toMatchObject({ key: "crayfish", label: "Martini", hasAlco: true, hasNonAlco: true });
  });

  it("offers no button for a course holding a retired pairing key", () => {
    expect(optionalPairingsFromCourses([squash({ optional_pairing_enabled: false })]))
      .toEqual([]);
  });

  it("offers no button for a course that never enabled one", () => {
    // The column defaults to false, so a record that says nothing isn't asking.
    expect(optionalPairingsFromCourses([squash()])).toEqual([]);
    expect(supabaseRowToCourse({ ...squash(), menu: { name: "SQUASH" } }).optional_pairing_enabled)
      .toBe(false);
  });

  it("prints no optional-pairing drink for a retired pairing", () => {
    // Live shape: the squash row is authored as a plain `pairing` source, which
    // the resolver also accepts for optional-pairing courses. With the checkbox
    // off the wine comes from the ordinary pairing column instead — so a guest
    // on no pairing package gets no drink at all, where the retired optional
    // pairing used to hand them one.
    const menuTemplate = {
      version: 2,
      rows: [
        { id: "hdr", left: { type: "title" }, right: { type: "logo" }, widthPreset: "55/45", gap: 0 },
        {
          id: "c1",
          left: { type: "course", courseKey: "squash" },
          right: { type: "drinks", drinkSource: "pairing" },
          widthPreset: "55/45",
          gap: 0,
        },
      ],
    };
    const render = (pairing) => generateMenuHTML({
      seat: { id: 1, pairing, extras: {}, glasses: [], cocktails: [], beers: [],
              optionalPairings: { squash: { ordered: true, mode: "alco" } } },
      table: { menuType: "", restrictions: [], bottleWines: [] },
      menuCourses: [squash({ optional_pairing_enabled: false })],
      menuTemplate,
    });

    const noPackage = render("—");
    expect(noPackage).toContain("SQUASH");
    expect(noPackage).not.toContain("Nando, Sauvignon '08");

    // A guest who did buy the wine pairing still gets the course's wine.
    expect(render("Wine")).toContain("Nando, Sauvignon '08");
  });

  it("gets an ordinary drinks block when a layout is built from the courses", () => {
    const built = buildDefaultTemplate([squash({ optional_pairing_enabled: false }), crayfish()]);

    const squashRow = built.rows.find((r) => r.id === "course_squash");
    expect(squashRow.right.drinkSource).not.toBe("optional_pairing");
    expect(squashRow.right.pairingFlag).toBeUndefined();

    const crayfishRow = built.rows.find((r) => r.id === "course_crayfish");
    expect(crayfishRow.right).toMatchObject({ drinkSource: "optional_pairing", pairingFlag: "crayfish" });
  });
});
