// An experience IS a menu. Before this, "Grand tasting" was a label a guest
// picked and nothing downstream read — the kitchen ticket, the allergy sheet
// and Menu Layout all key off menuType, and the guest's choice never reached
// it. These pin the one crossing point.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_RESERVATION_CONFIG,
  experiencesFor,
  menuTypeForExperience,
  normalizeReservationConfig,
} from "../config.js";

describe("menuTypeForExperience", () => {
  it("the two menus the restaurant serves are the two experiences", () => {
    const keys = normalizeReservationConfig(DEFAULT_RESERVATION_CONFIG).experiences.map((e) => e.key);
    expect(keys).toEqual(["long", "short"]);
  });

  it("resolves a choice to the menu the kitchen cooks", () => {
    expect(menuTypeForExperience("long", DEFAULT_RESERVATION_CONFIG)).toBe("long");
    expect(menuTypeForExperience("short", DEFAULT_RESERVATION_CONFIG)).toBe("short");
  });

  it("keys must stay long and short — getAssignedProfile reads exactly those words", () => {
    const menus = normalizeReservationConfig(DEFAULT_RESERVATION_CONFIG).experiences
      .map((e) => e.menuType);
    expect(menus).toEqual(["long", "short"]);
  });

  it("an experience that is only wording commits the kitchen to nothing", () => {
    const config = {
      ...DEFAULT_RESERVATION_CONFIG,
      experiences: [{ key: "chefs_table", title: "Chef's table", services: ["dinner"], active: true }],
    };
    expect(menuTypeForExperience("chefs_table", config)).toBeNull();
  });

  it("an unknown or empty choice resolves to nothing rather than guessing", () => {
    expect(menuTypeForExperience("", DEFAULT_RESERVATION_CONFIG)).toBeNull();
    expect(menuTypeForExperience("nonsense", DEFAULT_RESERVATION_CONFIG)).toBeNull();
    expect(menuTypeForExperience(null, DEFAULT_RESERVATION_CONFIG)).toBeNull();
  });
});

describe("a season is which services a menu is offered on", () => {
  const withServices = (shortServices) => ({
    ...DEFAULT_RESERVATION_CONFIG,
    experiences: normalizeReservationConfig(DEFAULT_RESERVATION_CONFIG).experiences
      .map((e) => (e.key === "short" ? { ...e, services: shortServices } : e)),
  });

  it("winter: the short menu runs at both services", () => {
    const config = withServices(["lunch", "dinner"]);
    expect(experiencesFor("lunch", config).map((e) => e.key)).toContain("short");
    expect(experiencesFor("dinner", config).map((e) => e.key)).toContain("short");
  });

  it("summer: the short menu runs at lunch only, and dinner never offers it", () => {
    const config = withServices(["lunch"]);
    expect(experiencesFor("lunch", config).map((e) => e.key)).toContain("short");
    expect(experiencesFor("dinner", config).map((e) => e.key)).not.toContain("short");
    // The long menu is untouched by the season.
    expect(experiencesFor("dinner", config).map((e) => e.key)).toContain("long");
  });

  it("a hidden experience is offered at no service at all", () => {
    const config = {
      ...DEFAULT_RESERVATION_CONFIG,
      experiences: normalizeReservationConfig(DEFAULT_RESERVATION_CONFIG).experiences
        .map((e) => (e.key === "short" ? { ...e, active: false } : e)),
    };
    expect(experiencesFor("lunch", config).map((e) => e.key)).not.toContain("short");
  });
});
