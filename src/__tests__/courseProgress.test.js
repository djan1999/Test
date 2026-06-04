import { describe, it, expect } from "vitest";
import { getVisibleCoursesForTable, getCourseProgressState } from "../utils/courseProgress.js";
import { makeProfile } from "../utils/menuLayoutProfiles.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeCourse(overrides = {}) {
  return {
    course_key: "test_course",
    position: 1,
    is_active: true,
    is_snack: false,
    course_category: "main",
    optional_flag: "",
    show_on_short: false,
    short_order: null,
    menu: { name: "Test Course", sub: "" },
    ...overrides,
  };
}

function makeTable(overrides = {}) {
  return {
    id: 1,
    menuType: "long",
    birthday: false,
    seats: [],
    kitchenLog: {},
    kitchenCourseNotes: {},
    ...overrides,
  };
}

// ── getVisibleCoursesForTable ──────────────────────────────────────────────────

describe("getVisibleCoursesForTable — basic filtering", () => {
  it("excludes snack courses", () => {
    const table = makeTable();
    const courses = [
      makeCourse({ course_key: "snack_a", is_snack: true }),
      makeCourse({ course_key: "main_a", is_snack: false }),
    ];
    const visible = getVisibleCoursesForTable(table, courses);
    expect(visible).toHaveLength(1);
    expect(visible[0].key).toBe("main_a");
  });

  it("excludes inactive (is_active === false) courses", () => {
    const table = makeTable();
    const courses = [
      makeCourse({ course_key: "inactive", is_active: false }),
      makeCourse({ course_key: "active" }),
    ];
    const visible = getVisibleCoursesForTable(table, courses);
    expect(visible).toHaveLength(1);
    expect(visible[0].key).toBe("active");
  });

  it("excludes courses without a course_key", () => {
    const table = makeTable();
    const courses = [
      { is_active: true, is_snack: false, menu: { name: "No Key" } },
      makeCourse({ course_key: "has_key" }),
    ];
    const visible = getVisibleCoursesForTable(table, courses);
    expect(visible).toHaveLength(1);
    expect(visible[0].key).toBe("has_key");
  });

  it("returns 1-indexed course objects with key, name, firedAt, rawCourse", () => {
    const table = makeTable({ kitchenLog: { main_a: { firedAt: "19:00" } } });
    const courses = [
      makeCourse({ course_key: "main_a", position: 1, menu: { name: "Amuse" } }),
      makeCourse({ course_key: "main_b", position: 2, menu: { name: "Soup" } }),
    ];
    const visible = getVisibleCoursesForTable(table, courses);
    expect(visible[0]).toMatchObject({ index: 1, key: "main_a", name: "Amuse", firedAt: "19:00" });
    expect(visible[1]).toMatchObject({ index: 2, key: "main_b", firedAt: null });
    expect(visible[0].rawCourse).toBe(courses[0]);
  });

  it("applies kitchenCourseNotes name override", () => {
    const table = makeTable({ kitchenCourseNotes: { main_a: { name: "Custom Name" } } });
    const courses = [makeCourse({ course_key: "main_a", menu: { name: "Original" } })];
    const visible = getVisibleCoursesForTable(table, courses);
    expect(visible[0].name).toBe("Custom Name");
  });

  it("sorts long menu by position", () => {
    const table = makeTable({ menuType: "long" });
    const courses = [
      makeCourse({ course_key: "c", position: 3 }),
      makeCourse({ course_key: "a", position: 1 }),
      makeCourse({ course_key: "b", position: 2 }),
    ];
    const visible = getVisibleCoursesForTable(table, courses);
    expect(visible.map(c => c.key)).toEqual(["a", "b", "c"]);
  });
});

// ── Legacy path: menuType no longer filters (show_on_short removed) ─────────────

describe("getVisibleCoursesForTable — menuType in the legacy path", () => {
  it("does not filter by show_on_short when menuType is 'short'", () => {
    const table = makeTable({ menuType: "short" });
    const courses = [
      makeCourse({ course_key: "on_short",  show_on_short: true,  position: 1 }),
      makeCourse({ course_key: "off_short", show_on_short: false, position: 2 }),
    ];
    const visible = getVisibleCoursesForTable(table, courses);
    expect(visible.map(c => c.key)).toEqual(["on_short", "off_short"]);
  });

  it("sorts by position regardless of menuType", () => {
    const table = makeTable({ menuType: "short" });
    const courses = [
      makeCourse({ course_key: "b", position: 2 }),
      makeCourse({ course_key: "a", position: 1 }),
      makeCourse({ course_key: "c", position: 3 }),
    ];
    const visible = getVisibleCoursesForTable(table, courses);
    expect(visible.map(c => c.key)).toEqual(["a", "b", "c"]);
  });

  it("does not apply any short filter when menuType is 'long'", () => {
    const table = makeTable({ menuType: "long" });
    const courses = [
      makeCourse({ course_key: "a", show_on_short: false, position: 1 }),
      makeCourse({ course_key: "b", show_on_short: true,  position: 2 }),
    ];
    const visible = getVisibleCoursesForTable(table, courses);
    expect(visible).toHaveLength(2);
  });
});

// ── Optional courses ──────────────────────────────────────────────────────────

describe("getVisibleCoursesForTable — optional courses", () => {
  it("hides optional course when no seats ordered it", () => {
    const table = makeTable({
      seats: [{ id: 1, extras: {} }, { id: 2, extras: {} }],
    });
    const courses = [
      makeCourse({ course_key: "cheese", course_category: "optional", optional_flag: "cheese", position: 1 }),
      makeCourse({ course_key: "main",   course_category: "main",     position: 2 }),
    ];
    const visible = getVisibleCoursesForTable(table, courses);
    expect(visible.map(c => c.key)).toEqual(["main"]);
  });

  it("shows optional course when at least one seat ordered it", () => {
    const table = makeTable({
      seats: [
        { id: 1, extras: { cheese: { ordered: true } } },
        { id: 2, extras: {} },
      ],
    });
    const courses = [
      makeCourse({ course_key: "cheese", course_category: "optional", optional_flag: "cheese", position: 1 }),
    ];
    const visible = getVisibleCoursesForTable(table, courses);
    expect(visible).toHaveLength(1);
    expect(visible[0].key).toBe("cheese");
  });

  it("optional course on short menu shows when ordered (show_on_short no longer filters)", () => {
    const table = makeTable({
      menuType: "short",
      seats: [{ id: 1, extras: { cheese: { ordered: true } } }],
    });
    const courses = [
      makeCourse({
        course_key: "cheese",
        course_category: "optional",
        optional_flag: "cheese",
        show_on_short: false,
        short_order: 1,
      }),
    ];
    const visible = getVisibleCoursesForTable(table, courses);
    expect(visible).toHaveLength(1);
    expect(visible[0].key).toBe("cheese");
  });
});

// ── Celebration courses ───────────────────────────────────────────────────────

describe("getVisibleCoursesForTable — celebration courses", () => {
  it("includes celebration course for all seats when birthday is on", () => {
    const table = makeTable({
      birthday: true,
      seats: [{ id: 1, extras: {} }, { id: 2, extras: {} }],
    });
    const courses = [
      makeCourse({ course_key: "cake", course_category: "celebration", optional_flag: "cake", position: 1 }),
      makeCourse({ course_key: "main", course_category: "main", position: 2 }),
    ];
    const visible = getVisibleCoursesForTable(table, courses);
    expect(visible.map(c => c.key)).toContain("cake");
  });

  it("hides celebration course when birthday is off and no seats ordered", () => {
    const table = makeTable({
      birthday: false,
      seats: [{ id: 1, extras: {} }],
    });
    const courses = [
      makeCourse({ course_key: "cake", course_category: "celebration", optional_flag: "cake", position: 1 }),
    ];
    const visible = getVisibleCoursesForTable(table, courses);
    expect(visible).toHaveLength(0);
  });

  it("birthday celebration course bypasses short menu filter", () => {
    const table = makeTable({
      menuType: "short",
      birthday: true,
      seats: [],
    });
    const courses = [
      makeCourse({
        course_key: "cake",
        course_category: "celebration",
        optional_flag: "cake",
        show_on_short: false,
        short_order: 99,
      }),
    ];
    const visible = getVisibleCoursesForTable(table, courses);
    expect(visible).toHaveLength(1);
    expect(visible[0].key).toBe("cake");
  });
});

// ── getCourseProgressState ─────────────────────────────────────────────────────

describe("getCourseProgressState", () => {
  function makeVisibleCourse(key, firedAt = null, index = 1) {
    return { index, key, name: key, firedAt, rawCourse: {} };
  }

  it("returns nulls when course list is empty", () => {
    const table = makeTable();
    const state = getCourseProgressState(table, []);
    expect(state.current).toBeNull();
    expect(state.previous).toBeNull();
    expect(state.nextFire).toBeNull();
    expect(state.allComplete).toBe(false);
    expect(state.total).toBe(0);
    expect(state.firedCount).toBe(0);
  });

  it("when nothing fired: current=null, previous=null, nextFire=first course", () => {
    const table = makeTable();
    const courses = [
      makeVisibleCourse("a", null, 1),
      makeVisibleCourse("b", null, 2),
    ];
    const state = getCourseProgressState(table, courses);
    expect(state.current).toBeNull();
    expect(state.previous).toBeNull();
    expect(state.nextFire?.key).toBe("a");
    expect(state.allComplete).toBe(false);
  });

  it("first course fired: current=a, previous=null, nextFire=b", () => {
    const table = makeTable();
    const courses = [
      makeVisibleCourse("a", "19:00", 1),
      makeVisibleCourse("b", null, 2),
      makeVisibleCourse("c", null, 3),
    ];
    const state = getCourseProgressState(table, courses);
    expect(state.current?.key).toBe("a");
    expect(state.previous).toBeNull();
    expect(state.nextFire?.key).toBe("b");
    expect(state.allComplete).toBe(false);
    expect(state.firedCount).toBe(1);
    expect(state.total).toBe(3);
  });

  it("middle course fired: current=b, previous=a, nextFire=c", () => {
    const table = makeTable();
    const courses = [
      makeVisibleCourse("a", "19:00", 1),
      makeVisibleCourse("b", "19:20", 2),
      makeVisibleCourse("c", null, 3),
    ];
    const state = getCourseProgressState(table, courses);
    expect(state.current?.key).toBe("b");
    expect(state.previous?.key).toBe("a");
    expect(state.nextFire?.key).toBe("c");
    expect(state.allComplete).toBe(false);
  });

  it("all courses fired: current=last, nextFire=null, allComplete=true", () => {
    const table = makeTable();
    const courses = [
      makeVisibleCourse("a", "19:00", 1),
      makeVisibleCourse("b", "19:20", 2),
      makeVisibleCourse("c", "19:40", 3),
    ];
    const state = getCourseProgressState(table, courses);
    expect(state.current?.key).toBe("c");
    expect(state.previous?.key).toBe("b");
    expect(state.nextFire).toBeNull();
    expect(state.allComplete).toBe(true);
    expect(state.firedCount).toBe(3);
  });

  it("single course fired and complete: previous=null, allComplete=true", () => {
    const table = makeTable();
    const courses = [makeVisibleCourse("a", "19:00", 1)];
    const state = getCourseProgressState(table, courses);
    expect(state.current?.key).toBe("a");
    expect(state.previous).toBeNull();
    expect(state.nextFire).toBeNull();
    expect(state.allComplete).toBe(true);
  });
});

// ── Layout-driven path (assigned guest profile drives the kitchen board) ────────

describe("getVisibleCoursesForTable — assigned guest profile (row-based)", () => {
  // Build a guest profile with row-based long + short templates from course keys.
  const rowsFrom = (id, keys, blockOverrides = {}) => keys.map((k, i) => ({
    id: `row_${id}_${i}`,
    left: { type: "course", courseKey: k, ...(blockOverrides[k] || {}) },
    right: null,
    widthPreset: "100/0",
    gap: 0,
  }));
  const makeGuestProfile = (id, longKeys, shortKeys = null, blockOverrides = {}) => ({
    ...makeProfile({
      name: `Guest ${id}`,
      target: "guest_menu",
      menuTemplate: { version: 2, rows: rowsFrom(id, longKeys, blockOverrides) },
      shortMenuTemplate: shortKeys ? { version: 2, rows: rowsFrom(`${id}s`, shortKeys, blockOverrides) } : null,
      layoutStyles: {},
    }),
    id,
  });

  it("long table uses the long template from the assigned guest profile", () => {
    const profile = makeGuestProfile("G", ["a", "b", "c"], ["b"]);
    const profiles = [profile];
    const assignments = { longMenuProfileId: "G", shortMenuProfileId: "G" };
    const table = makeTable({ menuType: "long" });
    const courses = [
      makeCourse({ course_key: "a", position: 3 }),
      makeCourse({ course_key: "b", position: 1 }),
      makeCourse({ course_key: "c", position: 2 }),
    ];
    const visible = getVisibleCoursesForTable(table, courses, { profiles, assignments });
    // Template row order, not position order
    expect(visible.map(c => c.key)).toEqual(["a", "b", "c"]);
  });

  it("short table uses the profile's short template", () => {
    const profile = makeGuestProfile("G", ["a", "b", "c"], ["c", "a"]);
    const profiles = [profile];
    const assignments = { longMenuProfileId: "G", shortMenuProfileId: "G" };
    const table = makeTable({ menuType: "short" });
    const courses = [
      makeCourse({ course_key: "a", position: 1 }),
      makeCourse({ course_key: "b", position: 2 }),
      makeCourse({ course_key: "c", position: 3 }),
    ];
    const visible = getVisibleCoursesForTable(table, courses, { profiles, assignments });
    expect(visible.map(c => c.key)).toEqual(["c", "a"]);
  });

  it("excludes inactive courses even if listed in the template", () => {
    const profile = makeGuestProfile("G", ["a", "b"]);
    const profiles = [profile];
    const assignments = { longMenuProfileId: "G" };
    const table = makeTable({ menuType: "long" });
    const courses = [
      makeCourse({ course_key: "a", is_active: true }),
      makeCourse({ course_key: "b", is_active: false }),
    ];
    const visible = getVisibleCoursesForTable(table, courses, { profiles, assignments });
    expect(visible.map(c => c.key)).toEqual(["a"]);
  });

  it("hides optional course unless at least one seat ordered it", () => {
    const profile = makeGuestProfile("G", ["main", "cheese"]);
    const profiles = [profile];
    const assignments = { longMenuProfileId: "G" };
    const courses = [
      makeCourse({ course_key: "main", course_category: "main" }),
      makeCourse({ course_key: "cheese", course_category: "optional", optional_flag: "cheese" }),
    ];

    const tableNo  = makeTable({ menuType: "long", seats: [{ id: 1, extras: {} }] });
    const tableYes = makeTable({ menuType: "long", seats: [{ id: 1, extras: { cheese: { ordered: true } } }] });

    expect(getVisibleCoursesForTable(tableNo,  courses, { profiles, assignments }).map(c => c.key))
      .toEqual(["main"]);
    expect(getVisibleCoursesForTable(tableYes, courses, { profiles, assignments }).map(c => c.key))
      .toEqual(["main", "cheese"]);
  });

  it("celebration course shown when birthday is on", () => {
    const profile = makeGuestProfile("G", ["main", "cake"]);
    const profiles = [profile];
    const assignments = { longMenuProfileId: "G" };
    const courses = [
      makeCourse({ course_key: "main" }),
      makeCourse({ course_key: "cake", course_category: "celebration", optional_flag: "cake" }),
    ];
    const tableBday = makeTable({ menuType: "long", birthday: true, seats: [] });
    const tableOff  = makeTable({ menuType: "long", birthday: false, seats: [{ id: 1, extras: {} }] });
    expect(getVisibleCoursesForTable(tableBday, courses, { profiles, assignments }).map(c => c.key))
      .toEqual(["main", "cake"]);
    expect(getVisibleCoursesForTable(tableOff,  courses, { profiles, assignments }).map(c => c.key))
      .toEqual(["main"]);
  });

  it("preserves firedAt state from table.kitchenLog", () => {
    const profile = makeGuestProfile("G", ["a", "b"]);
    const profiles = [profile];
    const assignments = { longMenuProfileId: "G" };
    const courses = [makeCourse({ course_key: "a" }), makeCourse({ course_key: "b" })];
    const table = makeTable({ menuType: "long", kitchenLog: { a: { firedAt: "20:15" } } });
    const visible = getVisibleCoursesForTable(table, courses, { profiles, assignments });
    expect(visible[0].firedAt).toBe("20:15");
    expect(visible[1].firedAt).toBeNull();
  });

  it("nextFire follows the template row order, not position", () => {
    const profile = makeGuestProfile("G", ["c", "a", "b"]);
    const profiles = [profile];
    const assignments = { longMenuProfileId: "G" };
    const courses = [
      makeCourse({ course_key: "a", position: 1 }),
      makeCourse({ course_key: "b", position: 2 }),
      makeCourse({ course_key: "c", position: 3 }),
    ];
    const table = makeTable({ menuType: "long" });
    const visible = getVisibleCoursesForTable(table, courses, { profiles, assignments });
    const state = getCourseProgressState(table, visible);
    expect(state.nextFire?.key).toBe("c");

    const tableAfter = { ...table, kitchenLog: { c: { firedAt: "19:00" } } };
    const visibleAfter = getVisibleCoursesForTable(tableAfter, courses, { profiles, assignments });
    expect(getCourseProgressState(tableAfter, visibleAfter).nextFire?.key).toBe("a");
  });

  it("falls back to legacy (position order) when no profile is assigned", () => {
    const table = makeTable({ menuType: "short" });
    const courses = [
      makeCourse({ course_key: "first",  position: 1 }),
      makeCourse({ course_key: "second", position: 2 }),
    ];
    const visible = getVisibleCoursesForTable(table, courses, { profiles: [], assignments: {} });
    expect(visible.map(c => c.key)).toEqual(["first", "second"]);
  });

  it("falls back to legacy when assignments point at missing profiles", () => {
    const courses = [
      makeCourse({ course_key: "a", position: 2 }),
      makeCourse({ course_key: "b", position: 1 }),
    ];
    const table = makeTable({ menuType: "long" });
    const profiles = [];
    const assignments = { longMenuProfileId: "x", shortMenuProfileId: "y" };
    const visible = getVisibleCoursesForTable(table, courses, { profiles, assignments });
    expect(visible.map(c => c.key)).toEqual(["b", "a"]);
  });

  it("reads kitchenItem flags from the matching course block in the template", () => {
    const profile = makeGuestProfile("G", ["a"], null, {
      a: { showRestrictions: false, kitchenDisplayName: "Plate A" },
    });
    const profiles = [profile];
    const assignments = { longMenuProfileId: "G" };
    const courses = [makeCourse({ course_key: "a" })];
    const visible = getVisibleCoursesForTable(makeTable(), courses, { profiles, assignments });
    expect(visible[0].kitchenItem).toBeDefined();
    expect(visible[0].kitchenItem.showRestrictions).toBe(false);
    expect(visible[0].kitchenItem.kitchenDisplayName).toBe("Plate A");
    expect(visible[0].name).toBe("Plate A");
  });

  it("accepts a bare kitchen template directly (resolved profile shortcut)", () => {
    const courses = [makeCourse({ course_key: "venison" })];
    const template = { version: 2, rows: [{ id: "r1", left: { type: "course", courseKey: "venison" }, right: null }] };
    const visible = getVisibleCoursesForTable(makeTable(), courses, { kitchenTemplate: template });
    expect(visible.map(c => c.key)).toEqual(["venison"]);
  });
});
