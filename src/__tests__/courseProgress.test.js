import { describe, it, expect } from "vitest";
import { getVisibleCoursesForTable, getCourseProgressState } from "../utils/courseProgress.js";
import { makeLayout, makeLayoutItem } from "../utils/menuLayouts.js";

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

// ── Short menu ────────────────────────────────────────────────────────────────

describe("getVisibleCoursesForTable — short menu", () => {
  it("includes only show_on_short courses when menuType is 'short'", () => {
    const table = makeTable({ menuType: "short" });
    const courses = [
      makeCourse({ course_key: "on_short",  show_on_short: true,  short_order: 1 }),
      makeCourse({ course_key: "off_short", show_on_short: false, short_order: 2 }),
    ];
    const visible = getVisibleCoursesForTable(table, courses);
    expect(visible).toHaveLength(1);
    expect(visible[0].key).toBe("on_short");
  });

  it("sorts short menu by short_order", () => {
    const table = makeTable({ menuType: "short" });
    const courses = [
      makeCourse({ course_key: "b", show_on_short: true, short_order: 2 }),
      makeCourse({ course_key: "a", show_on_short: true, short_order: 1 }),
      makeCourse({ course_key: "c", show_on_short: true, short_order: 3 }),
    ];
    const visible = getVisibleCoursesForTable(table, courses);
    expect(visible.map(c => c.key)).toEqual(["a", "b", "c"]);
  });

  it("treats truthy variants for show_on_short ('1', 'yes', 'x')", () => {
    const table = makeTable({ menuType: "short" });
    const courses = [
      makeCourse({ course_key: "a", show_on_short: "1",   short_order: 1 }),
      makeCourse({ course_key: "b", show_on_short: "yes", short_order: 2 }),
      makeCourse({ course_key: "c", show_on_short: "x",   short_order: 3 }),
      makeCourse({ course_key: "d", show_on_short: "no",  short_order: 4 }),
    ];
    const visible = getVisibleCoursesForTable(table, courses);
    expect(visible.map(c => c.key)).toEqual(["a", "b", "c"]);
  });

  it("does not apply short filter when menuType is 'long'", () => {
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

  it("optional courses on short menu still filtered by show_on_short", () => {
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
    expect(visible).toHaveLength(0);
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

// ── Layout-driven path (kitchen layout overrides legacy filtering) ────────────

describe("getVisibleCoursesForTable — assigned kitchen layout", () => {
  const makeKitchenLayout = (id, courseKeys) => ({
    ...makeLayout(`Kitchen ${id}`, courseKeys.map(k => makeLayoutItem("course", { courseKey: k }, "kitchen_flow")), "kitchen_flow"),
    id,
  });

  it("long table uses the assigned long kitchen layout (not show_on_short)", () => {
    const longLayout  = makeKitchenLayout("LK", ["a", "b", "c"]);
    const shortLayout = makeKitchenLayout("SK", ["b"]);
    const layouts = [longLayout, shortLayout];
    const assignments = { longKitchenLayoutId: "LK", shortKitchenLayoutId: "SK" };
    const table = makeTable({ menuType: "long" });
    const courses = [
      makeCourse({ course_key: "a", position: 3, show_on_short: false }),
      makeCourse({ course_key: "b", position: 1, show_on_short: true,  short_order: 1 }),
      makeCourse({ course_key: "c", position: 2, show_on_short: false }),
    ];
    const visible = getVisibleCoursesForTable(table, courses, { layouts, assignments });
    expect(visible.map(c => c.key)).toEqual(["a", "b", "c"]); // layout order, not position
  });

  it("short table uses the assigned short kitchen layout, ignoring show_on_short", () => {
    // Short layout deliberately includes a course where show_on_short=false
    // and excludes one where show_on_short=true.
    const longLayout  = makeKitchenLayout("LK", ["a", "b", "c"]);
    const shortLayout = makeKitchenLayout("SK", ["c", "a"]);
    const layouts = [longLayout, shortLayout];
    const assignments = { longKitchenLayoutId: "LK", shortKitchenLayoutId: "SK" };
    const table = makeTable({ menuType: "short" });
    const courses = [
      makeCourse({ course_key: "a", position: 1, show_on_short: false }),
      makeCourse({ course_key: "b", position: 2, show_on_short: true, short_order: 1 }),
      makeCourse({ course_key: "c", position: 3, show_on_short: false }),
    ];
    const visible = getVisibleCoursesForTable(table, courses, { layouts, assignments });
    expect(visible.map(c => c.key)).toEqual(["c", "a"]);
  });

  it("excludes inactive courses even if listed in the kitchen layout", () => {
    const layout = makeKitchenLayout("LK", ["a", "b"]);
    const layouts = [layout];
    const assignments = { longKitchenLayoutId: "LK" };
    const table = makeTable({ menuType: "long" });
    const courses = [
      makeCourse({ course_key: "a", is_active: true }),
      makeCourse({ course_key: "b", is_active: false }),
    ];
    const visible = getVisibleCoursesForTable(table, courses, { layouts, assignments });
    expect(visible.map(c => c.key)).toEqual(["a"]);
  });

  it("hides optional course unless at least one seat ordered it", () => {
    const layout = makeKitchenLayout("LK", ["main", "cheese"]);
    const layouts = [layout];
    const assignments = { longKitchenLayoutId: "LK" };
    const courses = [
      makeCourse({ course_key: "main", course_category: "main" }),
      makeCourse({ course_key: "cheese", course_category: "optional", optional_flag: "cheese" }),
    ];

    const tableNo  = makeTable({ menuType: "long", seats: [{ id: 1, extras: {} }] });
    const tableYes = makeTable({ menuType: "long", seats: [{ id: 1, extras: { cheese: { ordered: true } } }] });

    expect(getVisibleCoursesForTable(tableNo,  courses, { layouts, assignments }).map(c => c.key))
      .toEqual(["main"]);
    expect(getVisibleCoursesForTable(tableYes, courses, { layouts, assignments }).map(c => c.key))
      .toEqual(["main", "cheese"]);
  });

  it("celebration course shown when birthday is on", () => {
    const layout = makeKitchenLayout("LK", ["main", "cake"]);
    const layouts = [layout];
    const assignments = { longKitchenLayoutId: "LK" };
    const courses = [
      makeCourse({ course_key: "main" }),
      makeCourse({ course_key: "cake", course_category: "celebration", optional_flag: "cake" }),
    ];
    const tableBday = makeTable({ menuType: "long", birthday: true, seats: [] });
    const tableOff  = makeTable({ menuType: "long", birthday: false, seats: [{ id: 1, extras: {} }] });
    expect(getVisibleCoursesForTable(tableBday, courses, { layouts, assignments }).map(c => c.key))
      .toEqual(["main", "cake"]);
    expect(getVisibleCoursesForTable(tableOff,  courses, { layouts, assignments }).map(c => c.key))
      .toEqual(["main"]);
  });

  it("preserves firedAt state from table.kitchenLog", () => {
    const layout = makeKitchenLayout("LK", ["a", "b"]);
    const layouts = [layout];
    const assignments = { longKitchenLayoutId: "LK" };
    const courses = [makeCourse({ course_key: "a" }), makeCourse({ course_key: "b" })];
    const table = makeTable({ menuType: "long", kitchenLog: { a: { firedAt: "20:15" } } });
    const visible = getVisibleCoursesForTable(table, courses, { layouts, assignments });
    expect(visible[0].firedAt).toBe("20:15");
    expect(visible[1].firedAt).toBeNull();
  });

  it("nextFire follows the kitchen layout order, not position/short_order", () => {
    // Layout order: [c, a, b]; position would yield [a, b, c]
    const layout = makeKitchenLayout("LK", ["c", "a", "b"]);
    const layouts = [layout];
    const assignments = { longKitchenLayoutId: "LK" };
    const courses = [
      makeCourse({ course_key: "a", position: 1 }),
      makeCourse({ course_key: "b", position: 2 }),
      makeCourse({ course_key: "c", position: 3 }),
    ];
    const table = makeTable({ menuType: "long" });
    const visible = getVisibleCoursesForTable(table, courses, { layouts, assignments });
    const state = getCourseProgressState(table, visible);
    expect(state.nextFire?.key).toBe("c");

    // After firing c, next is a
    const visibleAfterFire = getVisibleCoursesForTable(
      { ...table, kitchenLog: { c: { firedAt: "19:00" } } },
      courses,
      { layouts, assignments }
    );
    const state2 = getCourseProgressState(
      { ...table, kitchenLog: { c: { firedAt: "19:00" } } },
      visibleAfterFire
    );
    expect(state2.nextFire?.key).toBe("a");
  });

  it("falls back to legacy show_on_short when no kitchen layout is assigned", () => {
    // Empty payload — no layouts at all → legacy path.
    const table = makeTable({ menuType: "short" });
    const courses = [
      makeCourse({ course_key: "on",  show_on_short: true,  short_order: 1 }),
      makeCourse({ course_key: "off", show_on_short: false, short_order: 2 }),
    ];
    const visible = getVisibleCoursesForTable(table, courses, { layouts: [], assignments: {} });
    expect(visible.map(c => c.key)).toEqual(["on"]);
  });

  it("falls back to legacy when assignments don't include a kitchen slot for this menu type", () => {
    // Only guest assignments are populated; kitchen ones are null.
    const courses = [
      makeCourse({ course_key: "a", position: 2 }),
      makeCourse({ course_key: "b", position: 1 }),
    ];
    const table = makeTable({ menuType: "long" });
    const layouts = [];
    const assignments = { longMenuLayoutId: "x", shortMenuLayoutId: "y", longKitchenLayoutId: null, shortKitchenLayoutId: null };
    const visible = getVisibleCoursesForTable(table, courses, { layouts, assignments });
    // Sorted by position (legacy)
    expect(visible.map(c => c.key)).toEqual(["b", "a"]);
  });

  it("attaches kitchenItem so callers can read showRestrictions/etc.", () => {
    const layout = {
      ...makeLayout("K", [
        makeLayoutItem("course", { courseKey: "a", showRestrictions: false, kitchenDisplayName: "Plate A" }, "kitchen_flow"),
      ], "kitchen_flow"),
      id: "LK",
    };
    const layouts = [layout];
    const assignments = { longKitchenLayoutId: "LK" };
    const courses = [makeCourse({ course_key: "a" })];
    const visible = getVisibleCoursesForTable(makeTable(), courses, { layouts, assignments });
    expect(visible[0].kitchenItem).toBeDefined();
    expect(visible[0].kitchenItem.showRestrictions).toBe(false);
    expect(visible[0].kitchenItem.kitchenDisplayName).toBe("Plate A");
    expect(visible[0].name).toBe("Plate A");
  });
});
