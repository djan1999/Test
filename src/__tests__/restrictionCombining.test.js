import { describe, it, expect } from "vitest";
import {
  applyCourseRestriction,
  courseModList,
  combineCourseMods,
  getCourseMod,
  courseRestrictionModCounts,
  overrideModCounts,
} from "../utils/menuUtils.js";
import {
  groupRestrictionsByGuest,
  guestKeyOf,
  nextGuestId,
  withGuestIds,
} from "../utils/restrictionGroups.js";
import { getVisibleCoursesForTable } from "../utils/courseProgress.js";

// The service-night report: a table carrying no pork, no alcohol and no fish.
// On SQUASH only the shellfish substitution reached the ticket — the pork one
// was silently dropped — and each restriction printed its own "1×" line even
// though they belonged to the same guest.
const squash = {
  course_key: "squash",
  menu: { name: "SQUASH", sub: "cracklings, crayfish" },
  restrictions: {
    shellfish: { name: "", sub: "cracklings", kitchen_note: "No Crayfish" },
    no_pork:   { name: "", sub: "crayfish",   kitchen_note: "No Cracklings" },
  },
};

describe("a guest carrying several restrictions (the SQUASH case)", () => {
  it("applies EVERY matching substitution, not just the highest-priority one", () => {
    const course = {
      menu: { name: "SQUASH", sub: "cracklings, crayfish" },
      restrictions: {
        shellfish: { name: "", sub: "cracklings, pickled walnut" },
        no_pork:   { name: "PUMPKIN", sub: "" },
      },
    };
    const dish = applyCourseRestriction(course, ["shellfish", "no_pork"]);
    // The allergy lands the field it defines (sub) and the pork variant is no
    // longer skipped — it lands the name. Before, the loop stopped at the
    // first match and the pork substitution never happened.
    expect(dish.sub).toBe("cracklings, pickled walnut");
    expect(dish.name).toBe("PUMPKIN");
  });

  it("still lets the ALLERGY win a field both variants define", () => {
    const course = {
      menu: { name: "SQUASH", sub: "" },
      restrictions: {
        shellfish: { name: "SQUASH, NO CRAYFISH", sub: "" },
        no_pork:   { name: "PUMPKIN", sub: "" },
      },
    };
    expect(applyCourseRestriction(course, ["shellfish", "no_pork"]).name)
      .toBe("SQUASH, NO CRAYFISH");
  });

  it("lists one modification per restriction", () => {
    expect(courseModList(squash, ["shellfish", "no_pork"]))
      .toEqual(["NO CRAYFISH", "NO CRACKLINGS"]);
  });

  it("folds them into ONE ticket line, saying the shared word once", () => {
    expect(getCourseMod(squash, ["shellfish", "no_pork"]))
      .toBe("NO CRAYFISH, CRACKLINGS");
  });

  it("keeps a single restriction rendering exactly as before", () => {
    expect(getCourseMod(squash, ["shellfish"])).toBe("NO CRAYFISH");
    expect(getCourseMod(squash, ["no_pork"])).toBe("NO CRACKLINGS");
  });

  it("joins with a comma when the mods share no leading word", () => {
    expect(combineCourseMods(["GF PASTA", "NO CREAM"])).toBe("GF PASTA, NO CREAM");
    expect(combineCourseMods(["ONE"])).toBe("ONE");
    expect(combineCourseMods([])).toBeNull();
  });

  it("does not repeat an identical modification twice", () => {
    const course = {
      menu: { name: "TART", sub: "butter" },
      restrictions: {
        dairy:  { kitchen_note: "No butter" },
        vegan:  { kitchen_note: "No butter" },
      },
    };
    expect(getCourseMod(course, ["dairy", "vegan"])).toBe("NO BUTTER");
  });
});

describe("courseRestrictionModCounts groups per PERSON", () => {
  const seats = [{ id: 1 }, { id: 2 }, { id: 3 }];

  it("one guest with two restrictions is 1× one combined line, not 2× two lines", () => {
    const restrictions = [
      { pos: null, note: "shellfish", guest: "g1" },
      { pos: null, note: "no_pork",   guest: "g1" },
    ];
    expect(courseRestrictionModCounts(squash, seats, restrictions))
      .toEqual({ "NO CRAYFISH, CRACKLINGS": 1 });
  });

  it("two different guests with one restriction each stay two lines", () => {
    const restrictions = [
      { pos: null, note: "shellfish", guest: "g1" },
      { pos: null, note: "no_pork",   guest: "g2" },
    ];
    expect(courseRestrictionModCounts(squash, seats, restrictions))
      .toEqual({ "NO CRAYFISH": 1, "NO CRACKLINGS": 1 });
  });

  it("two guests carrying the SAME pair of restrictions count 2× on one line", () => {
    const restrictions = [
      { pos: null, note: "shellfish", guest: "g1" },
      { pos: null, note: "no_pork",   guest: "g1" },
      { pos: null, note: "shellfish", guest: "g2" },
      { pos: null, note: "no_pork",   guest: "g2" },
    ];
    expect(courseRestrictionModCounts(squash, seats, restrictions))
      .toEqual({ "NO CRAYFISH, CRACKLINGS": 2 });
  });

  it("seat-assigned restrictions combine for that chair too", () => {
    const restrictions = [
      { pos: 2, note: "shellfish" },
      { pos: 2, note: "no_pork" },
    ];
    expect(courseRestrictionModCounts(squash, seats, restrictions))
      .toEqual({ "NO CRAYFISH, CRACKLINGS": 1 });
  });

  it("ungrouped legacy entries still read as one person each", () => {
    const restrictions = [{ pos: null, note: "shellfish" }, { pos: null, note: "no_pork" }];
    expect(courseRestrictionModCounts(squash, seats, restrictions))
      .toEqual({ "NO CRAYFISH": 1, "NO CRACKLINGS": 1 });
  });
});

// Per-ticket mod overrides (#129) are keyed by the DERIVED label, and
// combining changes what that label is. These pin how the two compose.
describe("combined mods and per-ticket text overrides", () => {
  const seats = [{ id: 1 }, { id: 2 }];
  const restrictions = [
    { pos: 1, note: "shellfish" },
    { pos: 1, note: "no_pork" },
  ];

  it("an override on the COMBINED label rewrites the line", () => {
    const counts = courseRestrictionModCounts(squash, seats, restrictions);
    expect(counts).toEqual({ "NO CRAYFISH, CRACKLINGS": 1 });
    const kcNote = { modOverrides: { "NO CRAYFISH, CRACKLINGS": "PLAIN SQUASH ONLY" } };
    expect(overrideModCounts(counts, kcNote)).toEqual({ "PLAIN SQUASH ONLY": 1 });
  });

  it("an override keyed to one restriction's old label falls back to the default", () => {
    // #129's documented behaviour when the derived text moves on: the stale
    // override stops matching and the current default resurfaces, rather than
    // silently shadowing it.
    const counts = courseRestrictionModCounts(squash, seats, restrictions);
    const stale = { modOverrides: { "NO CRAYFISH": "SOMETHING OLD" } };
    expect(overrideModCounts(counts, stale)).toEqual({ "NO CRAYFISH, CRACKLINGS": 1 });
  });

  it("a single-restriction guest's override is untouched by combining", () => {
    const counts = courseRestrictionModCounts(squash, seats, [{ pos: 1, note: "shellfish" }]);
    const kcNote = { modOverrides: { "NO CRAYFISH": "NO CRAYFISH, EXTRA LEMON" } };
    expect(overrideModCounts(counts, kcNote)).toEqual({ "NO CRAYFISH, EXTRA LEMON": 1 });
  });
});

describe("restriction guest grouping", () => {
  it("keys on the seat first, then the guest id", () => {
    expect(guestKeyOf({ note: "veg", pos: 3, guest: "g1" }, 0)).toBe("pos:3");
    expect(guestKeyOf({ note: "veg", pos: null, guest: "g1" }, 0)).toBe("guest:g1");
    expect(guestKeyOf({ note: "veg" }, 4)).toBe("anon:4");
  });

  it("groups a person's restrictions with the indices needed to move them together", () => {
    const list = [
      { pos: null, note: "no_pork",   guest: "g1" },
      { pos: null, note: "veg",       guest: "g2" },
      { pos: null, note: "no_alcohol", guest: "g1" },
    ];
    const groups = groupRestrictionsByGuest(list);
    expect(groups).toHaveLength(2);
    expect(groups[0].notes).toEqual(["no_pork", "no_alcohol"]);
    expect(groups[0].indices).toEqual([0, 2]);
    expect(groups[1].notes).toEqual(["veg"]);
  });

  it("drops entries with no restriction key", () => {
    expect(groupRestrictionsByGuest([{ pos: null, note: "" }, null])).toEqual([]);
  });

  it("gives every ungrouped legacy entry its own guest id — counts unchanged", () => {
    const migrated = withGuestIds([{ pos: null, note: "veg" }, { pos: null, note: "veg" }]);
    expect(migrated[0].guest).not.toBe(migrated[1].guest);
    expect(groupRestrictionsByGuest(migrated)).toHaveLength(2);
  });

  it("leaves seat-pinned entries alone — the chair already identifies the guest", () => {
    const migrated = withGuestIds([{ pos: 2, note: "veg" }]);
    expect(migrated[0].guest).toBeUndefined();
  });

  it("mints ids that do not collide with existing ones", () => {
    expect(nextGuestId([{ guest: "g1" }, { guest: "g4" }])).toBe("g5");
    expect(nextGuestId([])).toBe("g1");
  });
});

describe("optional courses in the ticket editor", () => {
  const menuCourses = [
    { course_key: "starter", position: 1, menu: { name: "STARTER" } },
    { course_key: "cheese",  position: 2, menu: { name: "CHEESE" }, course_category: "optional", optional_flag: "cheese" },
  ];
  const table = { seats: [{ id: 1 }], kitchenLog: {} };

  it("hides an unordered optional course on the live board", () => {
    const keys = getVisibleCoursesForTable(table, menuCourses).map(c => c.key);
    expect(keys).toEqual(["starter"]);
  });

  it("shows it — flagged pending — when the editor asks for every course", () => {
    const courses = getVisibleCoursesForTable(table, menuCourses, { includeUnordered: true });
    expect(courses.map(c => c.key)).toEqual(["starter", "cheese"]);
    expect(courses.find(c => c.key === "cheese").pending).toBe(true);
    expect(courses.find(c => c.key === "starter").pending).toBe(false);
  });

  it("stops flagging it once a seat orders it", () => {
    const ordered = { ...table, seats: [{ id: 1, extras: { cheese: { ordered: true } } }] };
    const courses = getVisibleCoursesForTable(ordered, menuCourses, { includeUnordered: true });
    expect(courses.find(c => c.key === "cheese").pending).toBe(false);
  });

  it("carries the guest's restrictions onto the optional dish", () => {
    const cheese = {
      course_key: "cheese",
      menu: { name: "CHEESE", sub: "" },
      restrictions: { dairy: { kitchen_note: "Sorbet instead" } },
    };
    expect(courseRestrictionModCounts(cheese, [{ id: 1 }], [{ pos: 1, note: "dairy" }]))
      .toEqual({ "SORBET INSTEAD": 1 });
  });
});
