import { describe, it, expect } from "vitest";
import {
  createDefaultLayouts,
  resolveMenuLayout,
  getAssignedLayout,
  duplicateLayout,
  renameLayout,
  isLayoutAssigned,
  canDeleteLayout,
  sanitizeLayoutsPayload,
  makeLayout,
  makeLayoutItem,
  moveLayoutItem,
  spacerSizeToPt,
  LAYOUT_ITEM_TYPES,
} from "../utils/menuLayouts.js";
import { generateMenuHTML } from "../utils/menuGenerator.js";

const course = (key, position, opts = {}) => ({
  course_key: key,
  position,
  is_active: opts.is_active !== false,
  is_snack: !!opts.is_snack,
  show_on_short: opts.show_on_short || false,
  short_order: opts.short_order ?? null,
  menu: { name: opts.name || key, sub: opts.sub || "" },
  ...opts,
});

const sampleCourses = [
  course("amuse",        1, { name: "Amuse" }),
  course("linzer_eye",   2, { name: "Linzer Eye",     show_on_short: true,  short_order: 1 }),
  course("trout_belly",  3, { name: "Trout Belly",    show_on_short: true,  short_order: 2 }),
  course("danube_salmon",4, { name: "Danube Salmon",  show_on_short: false }),
  course("venison",      5, { name: "Venison",        show_on_short: true,  short_order: 3 }),
  course("dessert",      6, { name: "Dessert" }),
];

describe("createDefaultLayouts", () => {
  it("creates a long layout with all active non-snack courses sorted by position", () => {
    const { layouts, assignments } = createDefaultLayouts(sampleCourses);
    const longLayout = layouts.find(l => l.id === assignments.longMenuLayoutId);
    expect(longLayout).toBeTruthy();
    const longKeys = longLayout.items.filter(i => i.type === "course").map(i => i.courseKey);
    expect(longKeys).toEqual(["amuse", "linzer_eye", "trout_belly", "danube_salmon", "venison", "dessert"]);
  });

  it("creates a short layout filtered by show_on_short and ordered by short_order", () => {
    const { layouts, assignments } = createDefaultLayouts(sampleCourses);
    const shortLayout = layouts.find(l => l.id === assignments.shortMenuLayoutId);
    expect(shortLayout).toBeTruthy();
    const shortKeys = shortLayout.items.filter(i => i.type === "course").map(i => i.courseKey);
    expect(shortKeys).toEqual(["linzer_eye", "trout_belly", "venison"]);
  });

  it("assigns Long Menu and Short Menu to separate layouts by default", () => {
    const { assignments } = createDefaultLayouts(sampleCourses);
    expect(assignments.longMenuLayoutId).toBeTruthy();
    expect(assignments.shortMenuLayoutId).toBeTruthy();
    expect(assignments.longMenuLayoutId).not.toBe(assignments.shortMenuLayoutId);
  });

  it("falls back to long-style content when no course is marked show_on_short", () => {
    const noShort = sampleCourses.map(c => ({ ...c, show_on_short: false }));
    const { layouts, assignments } = createDefaultLayouts(noShort);
    const shortLayout = layouts.find(l => l.id === assignments.shortMenuLayoutId);
    const longLayout = layouts.find(l => l.id === assignments.longMenuLayoutId);
    const shortKeys = shortLayout.items.filter(i => i.type === "course").map(i => i.courseKey);
    const longKeys = longLayout.items.filter(i => i.type === "course").map(i => i.courseKey);
    expect(shortKeys.length).toBe(longKeys.length);
  });

  it("excludes inactive and snack courses", () => {
    const courses = [
      ...sampleCourses,
      course("snack", 7, { is_snack: true, name: "Snack" }),
      course("inactive", 8, { is_active: false, name: "Inactive" }),
    ];
    const { layouts, assignments } = createDefaultLayouts(courses);
    const longLayout = layouts.find(l => l.id === assignments.longMenuLayoutId);
    const longKeys = longLayout.items.filter(i => i.type === "course").map(i => i.courseKey);
    expect(longKeys).not.toContain("snack");
    expect(longKeys).not.toContain("inactive");
  });
});

describe("resolveMenuLayout", () => {
  it("attaches the matching course object to course items", () => {
    const layout = makeLayout("L", [
      makeLayoutItem("course", { courseKey: "linzer_eye" }),
      makeLayoutItem("course", { courseKey: "venison" }),
    ]);
    const resolved = resolveMenuLayout(layout, sampleCourses);
    expect(resolved).toHaveLength(2);
    expect(resolved[0].course?.course_key).toBe("linzer_eye");
    expect(resolved[1].course?.course_key).toBe("venison");
    expect(resolved[0].missing).toBe(false);
  });

  it("flags missing courses but still returns the item", () => {
    const layout = makeLayout("L", [
      makeLayoutItem("course", { courseKey: "linzer_eye" }),
      makeLayoutItem("course", { courseKey: "ghost_course" }),
      makeLayoutItem("staticText", { text: "hi" }),
    ]);
    const resolved = resolveMenuLayout(layout, sampleCourses);
    expect(resolved).toHaveLength(3);
    expect(resolved[1].missing).toBe(true);
    expect(resolved[1].course).toBeNull();
    expect(resolved[2].type).toBe("staticText");
  });

  it("preserves non-course items", () => {
    const layout = makeLayout("L", [
      makeLayoutItem("sectionHeader", { text: "Pairings" }),
      makeLayoutItem("spacer", { size: "large" }),
      makeLayoutItem("divider"),
    ]);
    const resolved = resolveMenuLayout(layout, sampleCourses);
    expect(resolved.map(r => r.type)).toEqual(["sectionHeader", "spacer", "divider"]);
  });
});

describe("getAssignedLayout", () => {
  it("picks long layout for non-short menu types", () => {
    const { layouts, assignments } = createDefaultLayouts(sampleCourses);
    expect(getAssignedLayout("", layouts, assignments)?.id).toBe(assignments.longMenuLayoutId);
    expect(getAssignedLayout("long", layouts, assignments)?.id).toBe(assignments.longMenuLayoutId);
  });

  it("picks short layout when menuType is 'short'", () => {
    const { layouts, assignments } = createDefaultLayouts(sampleCourses);
    expect(getAssignedLayout("short", layouts, assignments)?.id).toBe(assignments.shortMenuLayoutId);
    expect(getAssignedLayout("SHORT", layouts, assignments)?.id).toBe(assignments.shortMenuLayoutId);
  });

  it("returns null when no layouts", () => {
    expect(getAssignedLayout("short", [], {})).toBeNull();
  });

  it("returns null when assignment id doesn't match any layout", () => {
    const { layouts } = createDefaultLayouts(sampleCourses);
    expect(getAssignedLayout("short", layouts, { shortMenuLayoutId: "missing" })).toBeNull();
  });
});

describe("duplicateLayout", () => {
  it("creates a deep copy with fresh ids on layout and items", () => {
    const original = makeLayout("Original", [
      makeLayoutItem("course", { courseKey: "linzer_eye" }),
      makeLayoutItem("staticText", { text: "Hello" }),
    ]);
    const copy = duplicateLayout(original, "Copy");
    expect(copy.id).not.toBe(original.id);
    expect(copy.name).toBe("Copy");
    expect(copy.items).toHaveLength(2);
    expect(copy.items[0].courseKey).toBe("linzer_eye");
    expect(copy.items[0].id).not.toBe(original.items[0].id);
    expect(copy.items[1].id).not.toBe(original.items[1].id);
    // Mutating the copy must not affect the original
    copy.items.push(makeLayoutItem("divider"));
    expect(original.items).toHaveLength(2);
  });

  it("provides a default name suffixed with (copy) when none given", () => {
    const original = makeLayout("Long 2026", []);
    const copy = duplicateLayout(original);
    expect(copy.name).toBe("Long 2026 (copy)");
  });
});

describe("renameLayout / isLayoutAssigned / canDeleteLayout", () => {
  it("renames the layout in place", () => {
    const layouts = [makeLayout("A"), makeLayout("B")];
    const next = renameLayout(layouts, layouts[0].id, "Renamed");
    expect(next[0].name).toBe("Renamed");
    expect(next[1].name).toBe("B");
  });

  it("ignores empty/blank rename", () => {
    const layouts = [makeLayout("A")];
    const next = renameLayout(layouts, layouts[0].id, "   ");
    expect(next[0].name).toBe("A");
  });

  it("isLayoutAssigned reports both long and short slots", () => {
    const a = makeLayout("A");
    const b = makeLayout("B");
    const assignments = { longMenuLayoutId: a.id, shortMenuLayoutId: b.id };
    expect(isLayoutAssigned(a.id, assignments)).toBe(true);
    expect(isLayoutAssigned(b.id, assignments)).toBe(true);
    expect(isLayoutAssigned("other", assignments)).toBe(false);
  });

  it("blocks deletion of a layout assigned to long or short", () => {
    const a = makeLayout("A");
    const b = makeLayout("B");
    const c = makeLayout("C");
    const layouts = [a, b, c];
    const assignments = { longMenuLayoutId: a.id, shortMenuLayoutId: b.id };
    expect(canDeleteLayout(a.id, layouts, assignments)).toBe(false);
    expect(canDeleteLayout(b.id, layouts, assignments)).toBe(false);
    expect(canDeleteLayout(c.id, layouts, assignments)).toBe(true);
  });

  it("blocks deletion of the only remaining layout", () => {
    const a = makeLayout("A");
    expect(canDeleteLayout(a.id, [a], {})).toBe(false);
  });
});

describe("sanitizeLayoutsPayload", () => {
  it("returns empty layouts and null assignments for invalid input", () => {
    const sanitized = sanitizeLayoutsPayload(null);
    expect(sanitized.layouts).toEqual([]);
    expect(sanitized.assignments.longMenuLayoutId).toBeNull();
  });

  it("drops items with unknown types", () => {
    const raw = {
      layouts: [{ id: "x", name: "X", items: [
        { id: "a", type: "course", courseKey: "linzer_eye" },
        { id: "b", type: "??", text: "no" },
        { id: "c", type: "staticText", text: "ok" },
      ]}],
      assignments: { longMenuLayoutId: "x" },
    };
    const s = sanitizeLayoutsPayload(raw);
    expect(s.layouts[0].items.map(i => i.type)).toEqual(["course", "staticText"]);
    expect(s.assignments.longMenuLayoutId).toBe("x");
  });

  it("clears assignments that point to non-existent layouts", () => {
    const raw = {
      layouts: [{ id: "x", name: "X", items: [] }],
      assignments: { longMenuLayoutId: "missing", shortMenuLayoutId: "missing" },
    };
    const s = sanitizeLayoutsPayload(raw);
    expect(s.assignments.longMenuLayoutId).toBe("x");
    expect(s.assignments.shortMenuLayoutId).toBe("x");
  });
});

describe("moveLayoutItem", () => {
  it("moves the item to the target index", () => {
    const items = [{ id: "a" }, { id: "b" }, { id: "c" }];
    expect(moveLayoutItem(items, 0, 2).map(i => i.id)).toEqual(["b", "c", "a"]);
    expect(moveLayoutItem(items, 2, 0).map(i => i.id)).toEqual(["c", "a", "b"]);
  });

  it("no-ops on invalid indices", () => {
    const items = [{ id: "a" }, { id: "b" }];
    expect(moveLayoutItem(items, -1, 0)).toEqual(items);
    expect(moveLayoutItem(items, 0, 5)).toEqual(items);
    expect(moveLayoutItem(items, 0, 0)).toEqual(items);
  });
});

describe("spacerSizeToPt", () => {
  it("maps named sizes to point values", () => {
    expect(spacerSizeToPt("small")).toBeLessThan(spacerSizeToPt("medium"));
    expect(spacerSizeToPt("medium")).toBeLessThan(spacerSizeToPt("large"));
    expect(spacerSizeToPt("nonsense")).toBe(spacerSizeToPt("medium"));
  });
});

// ── Integration: short menu uses assigned layout, not show_on_short filtering ──

describe("generateMenuHTML with menuLayout", () => {
  const baseSeat = { id: 1, pairing: "", aperitifs: [], glasses: [], cocktails: [], beers: [] };

  // The rendered HTML keeps original-case course names (CSS uppercases them
  // visually). data-ck="<course_key>" attributes give us a stable, case-safe
  // way to verify which courses appear.
  const dataCkAttr = (key) => `data-ck="${key}"`;

  it("renders only courses listed in the assigned short layout (ignoring show_on_short)", () => {
    // Use a short layout that DELIBERATELY differs from show_on_short — it
    // includes danube_salmon (show_on_short=false) and excludes linzer_eye
    // (show_on_short=true). The assigned layout must win.
    const shortLayout = makeLayout("Custom Short", [
      makeLayoutItem("course", { courseKey: "amuse" }),
      makeLayoutItem("course", { courseKey: "danube_salmon" }),
      makeLayoutItem("course", { courseKey: "venison" }),
    ]);
    const html = generateMenuHTML({
      seat: baseSeat,
      table: { menuType: "short", restrictions: [], bottleWines: [] },
      menuCourses: sampleCourses,
      menuLayout: shortLayout,
      menuTitle: "TEST",
    });
    expect(html).toContain(dataCkAttr("amuse"));
    expect(html).toContain(dataCkAttr("danube_salmon"));
    expect(html).toContain(dataCkAttr("venison"));
    expect(html).not.toContain(dataCkAttr("linzer_eye"));
    expect(html).not.toContain(dataCkAttr("trout_belly"));
  });

  it("respects the layout course order even when short_order would order them differently", () => {
    const layout = makeLayout("Reordered", [
      makeLayoutItem("course", { courseKey: "venison" }),       // short_order=3
      makeLayoutItem("course", { courseKey: "linzer_eye" }),    // short_order=1
      makeLayoutItem("course", { courseKey: "trout_belly" }),   // short_order=2
    ]);
    const html = generateMenuHTML({
      seat: baseSeat,
      table: { menuType: "short", restrictions: [], bottleWines: [] },
      menuCourses: sampleCourses,
      menuLayout: layout,
      menuTitle: "TEST",
    });
    const venisonIdx = html.indexOf(dataCkAttr("venison"));
    const linzerIdx = html.indexOf(dataCkAttr("linzer_eye"));
    const troutIdx = html.indexOf(dataCkAttr("trout_belly"));
    expect(venisonIdx).toBeGreaterThan(0);
    expect(linzerIdx).toBeGreaterThan(0);
    expect(troutIdx).toBeGreaterThan(0);
    expect(venisonIdx).toBeLessThan(linzerIdx);
    expect(linzerIdx).toBeLessThan(troutIdx);
  });

  it("skips course items whose courseKey doesn't match any course (missing refs)", () => {
    const layout = makeLayout("WithMissing", [
      makeLayoutItem("course", { courseKey: "linzer_eye" }),
      makeLayoutItem("course", { courseKey: "this_does_not_exist" }),
      makeLayoutItem("course", { courseKey: "venison" }),
    ]);
    const html = generateMenuHTML({
      seat: baseSeat,
      table: { menuType: "long", restrictions: [], bottleWines: [] },
      menuCourses: sampleCourses,
      menuLayout: layout,
      menuTitle: "TEST",
    });
    expect(html).toContain(dataCkAttr("linzer_eye"));
    expect(html).toContain(dataCkAttr("venison"));
    expect(html).not.toContain(dataCkAttr("this_does_not_exist"));
    // Should not throw and HTML must still be valid-looking
    expect(html.length).toBeGreaterThan(100);
  });

  it("falls back to legacy menuType filtering when no layout is provided", () => {
    // Without a menuLayout, the short menu should still filter by show_on_short
    // (back-compat path).
    const html = generateMenuHTML({
      seat: baseSeat,
      table: { menuType: "short", restrictions: [], bottleWines: [] },
      menuCourses: sampleCourses,
      menuTitle: "TEST",
    });
    expect(html).toContain(dataCkAttr("linzer_eye"));
    expect(html).toContain(dataCkAttr("venison"));
    expect(html).not.toContain(dataCkAttr("amuse"));
    expect(html).not.toContain(dataCkAttr("danube_salmon"));
  });
});

describe("LAYOUT_ITEM_TYPES coverage", () => {
  it("exposes all required item types", () => {
    expect(LAYOUT_ITEM_TYPES).toContain("course");
    expect(LAYOUT_ITEM_TYPES).toContain("staticText");
    expect(LAYOUT_ITEM_TYPES).toContain("sectionHeader");
    expect(LAYOUT_ITEM_TYPES).toContain("spacer");
    expect(LAYOUT_ITEM_TYPES).toContain("divider");
    expect(LAYOUT_ITEM_TYPES).toContain("optionalNote");
  });
});
