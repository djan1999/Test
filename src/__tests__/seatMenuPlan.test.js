import { describe, it, expect } from "vitest";
import {
  courseKeyOf,
  restrictionTag,
  substitutionAttribution,
  defaultMenuTitle,
  defaultThankYou,
} from "../utils/seatMenuPlan.js";

// A course carries its restriction variants inline — the app stores full dish
// records, so a substitution is a lookup on the course, not a wording map.
const course = (name, sub, restrictions = {}, extra = {}) => ({
  course_key: name.toLowerCase().replace(/\s+/g, "_"),
  menu: { name, sub },
  restrictions,
  ...extra,
});

describe("courseKeyOf", () => {
  it("normalizes to the engine's key space", () => {
    expect(courseKeyOf({ course_key: "Danube Salmon" })).toBe("danube_salmon");
    expect(courseKeyOf({ course_key: "cheese & honey" })).toBe("cheese_and_honey");
    expect(courseKeyOf({ menu: { name: "Linzer Eye" } })).toBe("linzer_eye");
    expect(courseKeyOf({}, 3)).toBe("course_3");
  });
});

describe("substitutionAttribution", () => {
  const zganci = course("Žganci", "Pork crackling", {
    gluten: { name: "Polenta", sub: "Porcini, aged Tolminc" },
  });

  it("returns null when the seat's restrictions leave the course unchanged", () => {
    expect(substitutionAttribution(zganci, [])).toBe(null);
    expect(substitutionAttribution(zganci, ["nut"])).toBe(null);
  });

  it("names the restriction that caused the change and keeps the original wording", () => {
    const attr = substitutionAttribution(zganci, ["gluten"]);
    expect(attr).not.toBe(null);
    expect(attr.key).toBe("gluten");
    expect(attr.tag).toBe("GLUTEN FREE");
    expect(attr.wasName).toBe("Žganci");
    expect(attr.wasSub).toBe("Pork crackling");
  });

  it("attributes to the key that actually changed the dish when the seat carries several", () => {
    // gluten has no variant here — dairy is the one that changed the plate.
    const kefir = course("Kefir", "Cucumber, dill", {
      dairy: { name: "Mountain herbs", sub: "Oat cream, rye crisp" },
    });
    const attr = substitutionAttribution(kefir, ["gluten", "dairy"]);
    expect(attr.key).toBe("dairy");
  });

  it("attributes to the allergy when an allergy and a lifestyle key both substitute", () => {
    // The engine applies allergies over lifestyle keys — the attribution line
    // must name the key the combined pass let win.
    const trout = course("Trout", "Beurre blanc", {
      nut: { name: "Trout, no praline", sub: "Beurre blanc" },
      veg: { name: "Kohlrabi", sub: "Horseradish, green apple" },
    });
    const attr = substitutionAttribution(trout, ["veg", "nut"]);
    expect(attr.key).toBe("nut");
  });

  it("uses the SI wording and SI variant when the run is in Slovene", () => {
    const si = course("Kefir", "Cucumber, dill", {
      dairy: { name: "Mountain herbs", sub: "Oat cream" },
      dairy_si: { name: "Gorske zeli", sub: "Ovsena smetana" },
    }, { menu_si: { name: "Kefir", sub: "Kumare, koper" } });
    const attr = substitutionAttribution(si, ["dairy"], "si");
    expect(attr.key).toBe("dairy");
    // The WAS wording is the SI base, not the EN one.
    expect(attr.wasSub).toBe("Kumare, koper");
  });
});

describe("restrictionTag", () => {
  it("upper-cases the vocabulary label and falls back to the raw key", () => {
    expect(restrictionTag("gluten")).toBe("GLUTEN FREE");
    expect(restrictionTag("some_custom_key")).toBe("SOME_CUSTOM_KEY");
  });
});

describe("defaults", () => {
  it("pre-fills the title per language and date", () => {
    const d = new Date(2026, 1, 14);
    expect(defaultMenuTitle("en", d)).toBe("MENU · 14 February 2026");
    expect(defaultMenuTitle("si", d)).toBe("MENI · 14. februar 2026");
    expect(defaultThankYou("si")).toBe("Hvala za vaš obisk.");
  });
});
