import { describe, it, expect } from "vitest";
import {
  applyCourseRestriction,
  applyMenuOverride,
  mergeDishes,
} from "../utils/menuUtils.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeCourse(name, sub = "", restrictions = {}) {
  return {
    course_key: name.toLowerCase().replace(/\s/g, "_"),
    menu: { name, sub },
    restrictions,
  };
}

// ── applyCourseRestriction ─────────────────────────────────────────────────────

describe("applyCourseRestriction", () => {
  it("returns the base dish when no active restrictions", () => {
    const course = makeCourse("Lamb", "Rosemary jus");
    expect(applyCourseRestriction(course, [])).toEqual({ name: "Lamb", sub: "Rosemary jus" });
  });

  it("returns null when course has no menu", () => {
    expect(applyCourseRestriction({ restrictions: {} }, ["veg"])).toBeNull();
  });

  it("substitutes sub-only when restriction cell has no pipe (name is kept)", () => {
    const course = makeCourse("Lamb", "Rosemary jus", {
      veg: { name: "Beetroot variation", sub: "" },
    });
    const result = applyCourseRestriction(course, ["veg"]);
    expect(result.name).toBe("Lamb");
    expect(result.sub).toBe("Beetroot variation");
  });

  it("substitutes both name and sub when restriction cell has pipe separator", () => {
    const course = makeCourse("Lamb", "Rosemary jus", {
      veg: { name: "Mushroom", sub: "Truffle sauce" },
    });
    const result = applyCourseRestriction(course, ["veg"]);
    expect(result.name).toBe("Mushroom");
    expect(result.sub).toBe("Truffle sauce");
  });

  it("vegan restriction takes priority over veg (vegan is earlier in priority list)", () => {
    const course = makeCourse("Lamb", "", {
      vegan: { name: "Tofu", sub: "Miso glaze" },
      veg:   { name: "Halloumi", sub: "" },
    });
    const result = applyCourseRestriction(course, ["vegan", "veg"]);
    expect(result.name).toBe("Tofu");
  });

  it("only applies the highest-priority matching restriction (stops after first match)", () => {
    const course = makeCourse("Beef", "", {
      vegan: { name: "Tofu", sub: "" },
      gluten_free: { name: "Gluten-free beef", sub: "" },
    });
    // vegan is earlier in priority list
    const result = applyCourseRestriction(course, ["vegan", "gluten"]);
    expect(result.name).toBe("Beef");
    expect(result.sub).toBe("Tofu");
  });

  it("does not substitute if active restriction has no corresponding restriction data", () => {
    const course = makeCourse("Beef", "Jus", {});
    const result = applyCourseRestriction(course, ["gluten"]);
    expect(result).toEqual({ name: "Beef", sub: "Jus" });
  });

  it("uses SI variant when lang=si and si restriction exists", () => {
    const course = makeCourse("Lamb", "", {
      veg:    { name: "Mushroom", sub: "" },
      veg_si: { name: "Gobe", sub: "" },
    });
    const result = applyCourseRestriction(course, ["veg"], "si");
    expect(result.sub).toBe("Gobe");
  });

  it("falls back to EN restriction when lang=si but no SI variant exists", () => {
    const course = makeCourse("Lamb", "", {
      veg: { name: "Mushroom", sub: "" },
    });
    const result = applyCourseRestriction(course, ["veg"], "si");
    expect(result.sub).toBe("Mushroom");
  });

  it("handles gluten restriction mapped to gluten_free column", () => {
    const course = makeCourse("Bread", "", {
      gluten_free: { name: "Gluten-free bread", sub: "" },
    });
    const result = applyCourseRestriction(course, ["gluten"]);
    expect(result.sub).toBe("Gluten-free bread");
  });
});

// ── applyMenuOverride ──────────────────────────────────────────────────────────

describe("applyMenuOverride", () => {
  const course = {
    course_key: "lamb",
    menu: { name: "Lamb", sub: "Rosemary jus" },
    menu_si: { name: "Jagnje", sub: "Rožmarin" },
  };

  it("returns course unchanged when no override for this course_key", () => {
    expect(applyMenuOverride(course, { fish: { name: "Trout" } })).toBe(course);
  });

  it("returns course unchanged when overrides is null/undefined", () => {
    expect(applyMenuOverride(course, null)).toBe(course);
    expect(applyMenuOverride(course, undefined)).toBe(course);
  });

  it("applies a table-wide name override", () => {
    const result = applyMenuOverride(course, { lamb: { name: "Venison" } });
    expect(result.menu.name).toBe("Venison");
    expect(result.menu.sub).toBe("Rosemary jus");
  });

  it("applies a table-wide sub override, keeping original name", () => {
    const result = applyMenuOverride(course, { lamb: { sub: "Red wine jus" } });
    expect(result.menu.name).toBe("Lamb");
    expect(result.menu.sub).toBe("Red wine jus");
  });

  it("seat-specific override takes precedence over table-wide", () => {
    const overrides = {
      lamb: {
        name: "Table-wide name",
        seats: { 2: { name: "Seat 2 name" } },
      },
    };
    const result = applyMenuOverride(course, overrides, 2);
    expect(result.menu.name).toBe("Seat 2 name");
  });

  it("table-wide override applies when seatId has no specific override", () => {
    const overrides = {
      lamb: {
        name: "Table-wide name",
        seats: { 2: { name: "Seat 2 name" } },
      },
    };
    const result = applyMenuOverride(course, overrides, 3);
    expect(result.menu.name).toBe("Table-wide name");
  });

  it("applies SI name_si and sub_si overrides", () => {
    const result = applyMenuOverride(course, {
      lamb: { name_si: "Srna", sub_si: "Rdeče vino" },
    });
    expect(result.menu_si.name).toBe("Srna");
    expect(result.menu_si.sub).toBe("Rdeče vino");
  });

  it("does not change menu_si when only EN fields are overridden", () => {
    const result = applyMenuOverride(course, { lamb: { name: "Venison" } });
    expect(result.menu_si).toBe(course.menu_si);
  });
});

// ── mergeDishes ───────────────────────────────────────────────────────────────

describe("mergeDishes", () => {
  it("returns all 3 default dishes when given empty array", () => {
    const result = mergeDishes([]);
    expect(result).toHaveLength(3);
    expect(result.map(d => d.name)).toEqual(["Beetroot", "Cheese", "Cake"]);
  });

  it("preserves custom fields while restoring built-in name and pairings", () => {
    const custom = [{ id: 1, name: "OldName", pairings: [], ordered: true }];
    const result = mergeDishes(custom);
    const beetroot = result.find(d => d.id === 1);
    expect(beetroot.name).toBe("Beetroot");
    expect(beetroot.ordered).toBe(true);
    expect(beetroot.pairings).toContain("Champagne");
  });

  it("adds missing default dishes when they are absent from the list", () => {
    const result = mergeDishes([{ id: 1, name: "Beetroot", pairings: [] }]);
    expect(result.find(d => d.id === 2)).toBeDefined(); // Cheese added
    expect(result.find(d => d.id === 3)).toBeDefined(); // Cake added
  });

  it("sorts by id", () => {
    const result = mergeDishes([
      { id: 3, name: "Cake", pairings: [] },
      { id: 1, name: "Beetroot", pairings: [] },
    ]);
    expect(result[0].id).toBe(1);
    expect(result[1].id).toBe(2);
    expect(result[2].id).toBe(3);
  });

  it("does not duplicate default dishes", () => {
    const result = mergeDishes([
      { id: 1, name: "Beetroot", pairings: [] },
      { id: 2, name: "Cheese", pairings: [] },
      { id: 3, name: "Cake", pairings: [] },
    ]);
    expect(result).toHaveLength(3);
  });

  it("handles null/undefined input gracefully", () => {
    expect(mergeDishes(null)).toHaveLength(3);
    expect(mergeDishes(undefined)).toHaveLength(3);
  });
});
