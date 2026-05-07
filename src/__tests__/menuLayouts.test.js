import { describe, it, expect } from "vitest";
import {
  createDefaultLayouts,
  resolveMenuLayout,
  resolveKitchenCourses,
  getAssignedLayout,
  getAssignedGuestLayout,
  getAssignedKitchenLayout,
  duplicateLayout,
  renameLayout,
  isLayoutAssigned,
  canDeleteLayout,
  sanitizeLayoutsPayload,
  makeLayout,
  makeLayoutItem,
  moveLayoutItem,
  spacerSizeToPt,
  itemTypesForTarget,
  LAYOUT_ITEM_TYPES,
  GUEST_LAYOUT_ITEM_TYPES,
  KITCHEN_LAYOUT_ITEM_TYPES,
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

  it("guest layouts allow rich item types", () => {
    expect(GUEST_LAYOUT_ITEM_TYPES).toEqual(expect.arrayContaining([
      "course", "staticText", "sectionHeader", "spacer", "divider", "optionalNote",
    ]));
  });

  it("kitchen layouts allow only the simple subset", () => {
    expect(KITCHEN_LAYOUT_ITEM_TYPES).toEqual(["course", "sectionHeader", "spacer", "divider"]);
    expect(KITCHEN_LAYOUT_ITEM_TYPES).not.toContain("staticText");
    expect(KITCHEN_LAYOUT_ITEM_TYPES).not.toContain("optionalNote");
  });

  it("itemTypesForTarget routes correctly", () => {
    expect(itemTypesForTarget("guest_menu")).toBe(GUEST_LAYOUT_ITEM_TYPES);
    expect(itemTypesForTarget("kitchen_flow")).toBe(KITCHEN_LAYOUT_ITEM_TYPES);
    expect(itemTypesForTarget("nonsense")).toBe(GUEST_LAYOUT_ITEM_TYPES);
  });
});

// ── Kitchen layouts ─────────────────────────────────────────────────────────

describe("createDefaultLayouts (with kitchen layouts)", () => {
  it("creates four layouts: long/short guest + long/short kitchen", () => {
    const { layouts, assignments } = createDefaultLayouts(sampleCourses);
    expect(layouts).toHaveLength(4);
    const targets = layouts.map(l => l.target);
    expect(targets.filter(t => t === "guest_menu")).toHaveLength(2);
    expect(targets.filter(t => t === "kitchen_flow")).toHaveLength(2);
    expect(assignments.longMenuLayoutId).toBeTruthy();
    expect(assignments.shortMenuLayoutId).toBeTruthy();
    expect(assignments.longKitchenLayoutId).toBeTruthy();
    expect(assignments.shortKitchenLayoutId).toBeTruthy();
    expect(assignments.longKitchenLayoutId).not.toBe(assignments.longMenuLayoutId);
    expect(assignments.shortKitchenLayoutId).not.toBe(assignments.shortMenuLayoutId);
  });

  it("kitchen long layout contains every active non-snack course in position order", () => {
    const { layouts, assignments } = createDefaultLayouts(sampleCourses);
    const longKitchen = layouts.find(l => l.id === assignments.longKitchenLayoutId);
    expect(longKitchen.target).toBe("kitchen_flow");
    const keys = longKitchen.items.filter(i => i.type === "course").map(i => i.courseKey);
    expect(keys).toEqual(["amuse", "linzer_eye", "trout_belly", "danube_salmon", "venison", "dessert"]);
  });

  it("kitchen short layout filters by show_on_short and orders by short_order", () => {
    const { layouts, assignments } = createDefaultLayouts(sampleCourses);
    const shortKitchen = layouts.find(l => l.id === assignments.shortKitchenLayoutId);
    const keys = shortKitchen.items.filter(i => i.type === "course").map(i => i.courseKey);
    expect(keys).toEqual(["linzer_eye", "trout_belly", "venison"]);
  });

  it("kitchen course items carry the kitchen-specific defaults", () => {
    const { layouts, assignments } = createDefaultLayouts(sampleCourses);
    const longKitchen = layouts.find(l => l.id === assignments.longKitchenLayoutId);
    const item = longKitchen.items.find(i => i.type === "course");
    expect(item.showRestrictions).toBe(true);
    expect(item.showPairingAlert).toBe(true);
    expect(item.showSeatNotes).toBe(true);
    expect(item.showCourseNotes).toBe(true);
    expect(item.kitchenDisplayName).toBe("");
  });
});

describe("getAssignedKitchenLayout / getAssignedGuestLayout", () => {
  it("guest helper picks guest_menu layouts only", () => {
    const { layouts, assignments } = createDefaultLayouts(sampleCourses);
    const longGuest = getAssignedGuestLayout("long", layouts, assignments);
    expect(longGuest.target).toBe("guest_menu");
  });

  it("kitchen helper picks kitchen_flow layouts only", () => {
    const { layouts, assignments } = createDefaultLayouts(sampleCourses);
    const longKitchen = getAssignedKitchenLayout("long", layouts, assignments);
    const shortKitchen = getAssignedKitchenLayout("short", layouts, assignments);
    expect(longKitchen.target).toBe("kitchen_flow");
    expect(shortKitchen.target).toBe("kitchen_flow");
    expect(longKitchen.id).not.toBe(shortKitchen.id);
  });

  it("returns null when assignment points to a wrong-target layout", () => {
    const { layouts, assignments } = createDefaultLayouts(sampleCourses);
    // Cross-wire long-guest into the kitchen slot deliberately
    const wrong = { ...assignments, longKitchenLayoutId: assignments.longMenuLayoutId };
    expect(getAssignedKitchenLayout("long", layouts, wrong)).toBeNull();
  });

  it("explicit target argument on getAssignedLayout works for both", () => {
    const { layouts, assignments } = createDefaultLayouts(sampleCourses);
    expect(getAssignedLayout("long",  layouts, assignments, "guest_menu").target).toBe("guest_menu");
    expect(getAssignedLayout("short", layouts, assignments, "kitchen_flow").target).toBe("kitchen_flow");
  });
});

describe("duplicateLayout preserves target", () => {
  it("kitchen layout duplicates as a kitchen layout with new ids", () => {
    const original = makeLayout("Long Kitchen", [
      makeLayoutItem("course", { courseKey: "linzer_eye" }, "kitchen_flow"),
      makeLayoutItem("sectionHeader", { text: "Hot pass" }, "kitchen_flow"),
    ], "kitchen_flow");
    const copy = duplicateLayout(original);
    expect(copy.target).toBe("kitchen_flow");
    expect(copy.id).not.toBe(original.id);
    expect(copy.items[0].id).not.toBe(original.items[0].id);
    expect(copy.items[0].courseKey).toBe("linzer_eye");
  });

  it("untagged legacy layouts duplicate as guest_menu", () => {
    const original = { id: "legacy", name: "Old", items: [] };
    const copy = duplicateLayout(original);
    expect(copy.target).toBe("guest_menu");
  });
});

describe("canDeleteLayout / isLayoutAssigned for kitchen slots", () => {
  it("blocks deletion when kitchen-assigned", () => {
    const a = makeLayout("Kitchen A", [], "kitchen_flow");
    const b = makeLayout("Kitchen B", [], "kitchen_flow");
    const c = makeLayout("Guest C",   [], "guest_menu");
    const d = makeLayout("Guest D",   [], "guest_menu");
    const layouts = [a, b, c, d];
    const assignments = {
      longKitchenLayoutId: a.id,
      shortKitchenLayoutId: b.id,
      longMenuLayoutId: c.id,
      shortMenuLayoutId: d.id,
    };
    expect(isLayoutAssigned(a.id, assignments)).toBe(true);
    expect(canDeleteLayout(a.id, layouts, assignments)).toBe(false);
    expect(canDeleteLayout(b.id, layouts, assignments)).toBe(false);
    expect(canDeleteLayout(c.id, layouts, assignments)).toBe(false);
  });

  it("allows deletion when there's a sibling layout in the same target", () => {
    const a = makeLayout("Kitchen A", [], "kitchen_flow");
    const b = makeLayout("Kitchen B", [], "kitchen_flow");
    const c = makeLayout("Kitchen C", [], "kitchen_flow");
    const layouts = [a, b, c];
    const assignments = { longKitchenLayoutId: a.id, shortKitchenLayoutId: b.id };
    // c is the unassigned third kitchen layout — deletion allowed
    expect(canDeleteLayout(c.id, layouts, assignments)).toBe(true);
  });

  it("blocks deletion that would leave a target empty", () => {
    const a = makeLayout("Solo Kitchen", [], "kitchen_flow");
    const b = makeLayout("Guest 1", [], "guest_menu");
    const c = makeLayout("Guest 2", [], "guest_menu");
    const layouts = [a, b, c];
    const assignments = { longMenuLayoutId: b.id, shortMenuLayoutId: c.id };
    expect(canDeleteLayout(a.id, layouts, assignments)).toBe(false);
  });
});

describe("sanitizeLayoutsPayload (kitchen + back-compat)", () => {
  it("upgrades old payloads (no target) to guest_menu", () => {
    const raw = {
      layouts: [
        { id: "x", name: "Old", items: [{ id: "i1", type: "course", courseKey: "linzer_eye" }] },
      ],
      assignments: { longMenuLayoutId: "x", shortMenuLayoutId: "x" },
    };
    const s = sanitizeLayoutsPayload(raw);
    expect(s.layouts[0].target).toBe("guest_menu");
    expect(s.assignments.longMenuLayoutId).toBe("x");
    expect(s.assignments.shortMenuLayoutId).toBe("x");
    // No kitchen layouts, so kitchen ids stay null
    expect(s.assignments.longKitchenLayoutId).toBeNull();
    expect(s.assignments.shortKitchenLayoutId).toBeNull();
  });

  it("preserves kitchen layouts and assignments when present", () => {
    const raw = {
      layouts: [
        { id: "g1", name: "Guest 1", target: "guest_menu", items: [] },
        { id: "k1", name: "Kitchen 1", target: "kitchen_flow", items: [] },
        { id: "k2", name: "Kitchen 2", target: "kitchen_flow", items: [] },
      ],
      assignments: {
        longMenuLayoutId: "g1",
        shortMenuLayoutId: "g1",
        longKitchenLayoutId: "k1",
        shortKitchenLayoutId: "k2",
      },
    };
    const s = sanitizeLayoutsPayload(raw);
    expect(s.assignments.longKitchenLayoutId).toBe("k1");
    expect(s.assignments.shortKitchenLayoutId).toBe("k2");
  });

  it("drops staticText / optionalNote items from kitchen layouts (not allowed)", () => {
    const raw = {
      layouts: [
        { id: "k", name: "K", target: "kitchen_flow", items: [
          { id: "a", type: "course",        courseKey: "linzer_eye" },
          { id: "b", type: "staticText",    text: "drop me" },
          { id: "c", type: "optionalNote",  text: "drop me too" },
          { id: "d", type: "sectionHeader", text: "keep" },
          { id: "e", type: "spacer",        size: "small" },
          { id: "f", type: "divider" },
        ]},
      ],
      assignments: {},
    };
    const s = sanitizeLayoutsPayload(raw);
    expect(s.layouts[0].items.map(i => i.type)).toEqual(["course", "sectionHeader", "spacer", "divider"]);
  });

  it("clears kitchen assignment that points to a guest layout", () => {
    const raw = {
      layouts: [
        { id: "g1", name: "G", target: "guest_menu", items: [] },
        { id: "k1", name: "K", target: "kitchen_flow", items: [] },
      ],
      // Wrong target wiring: longKitchenLayoutId points at a guest layout
      assignments: { longKitchenLayoutId: "g1", shortKitchenLayoutId: "k1" },
    };
    const s = sanitizeLayoutsPayload(raw);
    expect(s.assignments.longKitchenLayoutId).toBe("k1"); // re-pointed to the only matching kitchen layout
    expect(s.assignments.shortKitchenLayoutId).toBe("k1");
  });
});

// ── resolveKitchenCourses ────────────────────────────────────────────────────

describe("resolveKitchenCourses", () => {
  const baseTable = { id: 1, menuType: "long", birthday: false, seats: [], kitchenLog: {}, kitchenCourseNotes: {} };

  it("returns courses in layout order with index, name, firedAt, kitchenItem", () => {
    const layout = makeLayout("K", [
      makeLayoutItem("course", { courseKey: "linzer_eye" }, "kitchen_flow"),
      makeLayoutItem("course", { courseKey: "venison" },    "kitchen_flow"),
    ], "kitchen_flow");
    const table = { ...baseTable, kitchenLog: { linzer_eye: { firedAt: "19:00" } } };
    const visible = resolveKitchenCourses(layout, table, sampleCourses);
    expect(visible).toHaveLength(2);
    expect(visible[0]).toMatchObject({ index: 1, key: "linzer_eye", firedAt: "19:00" });
    expect(visible[1]).toMatchObject({ index: 2, key: "venison",    firedAt: null });
    expect(visible[0].kitchenItem).toBeDefined();
    expect(visible[0].rawCourse.course_key).toBe("linzer_eye");
  });

  it("skips inactive courses even when they appear in the layout", () => {
    const courses = [
      ...sampleCourses,
      course("inactive_course", 99, { is_active: false, name: "Inactive" }),
    ];
    const layout = makeLayout("K", [
      makeLayoutItem("course", { courseKey: "linzer_eye" }, "kitchen_flow"),
      makeLayoutItem("course", { courseKey: "inactive_course" }, "kitchen_flow"),
    ], "kitchen_flow");
    const visible = resolveKitchenCourses(layout, baseTable, courses);
    expect(visible.map(c => c.key)).toEqual(["linzer_eye"]);
  });

  it("hides optional courses with no seats ordered", () => {
    const courses = [
      ...sampleCourses,
      course("cheese", 99, { course_category: "optional", optional_flag: "cheese", name: "Cheese" }),
    ];
    const layout = makeLayout("K", [
      makeLayoutItem("course", { courseKey: "cheese" }, "kitchen_flow"),
    ], "kitchen_flow");
    const visible = resolveKitchenCourses(layout, { ...baseTable, seats: [{ id: 1, extras: {} }] }, courses);
    expect(visible).toHaveLength(0);
  });

  it("shows optional courses when at least one seat ordered them", () => {
    const courses = [
      ...sampleCourses,
      course("cheese", 99, { course_category: "optional", optional_flag: "cheese", name: "Cheese" }),
    ];
    const layout = makeLayout("K", [
      makeLayoutItem("course", { courseKey: "cheese" }, "kitchen_flow"),
    ], "kitchen_flow");
    const table = { ...baseTable, seats: [{ id: 1, extras: { cheese: { ordered: true } } }] };
    const visible = resolveKitchenCourses(layout, table, courses);
    expect(visible.map(c => c.key)).toEqual(["cheese"]);
  });

  it("shows celebration courses when birthday is on (regardless of seats)", () => {
    const courses = [
      ...sampleCourses,
      course("cake", 99, { course_category: "celebration", optional_flag: "cake", name: "Cake" }),
    ];
    const layout = makeLayout("K", [
      makeLayoutItem("course", { courseKey: "cake" }, "kitchen_flow"),
    ], "kitchen_flow");
    const table = { ...baseTable, birthday: true };
    const visible = resolveKitchenCourses(layout, table, courses);
    expect(visible.map(c => c.key)).toEqual(["cake"]);
  });

  it("hides celebration courses when birthday is off and no seats ordered", () => {
    const courses = [
      ...sampleCourses,
      course("cake", 99, { course_category: "celebration", optional_flag: "cake", name: "Cake" }),
    ];
    const layout = makeLayout("K", [
      makeLayoutItem("course", { courseKey: "cake" }, "kitchen_flow"),
    ], "kitchen_flow");
    const visible = resolveKitchenCourses(layout, baseTable, courses);
    expect(visible).toHaveLength(0);
  });

  it("uses kitchenDisplayName override when present", () => {
    const layout = makeLayout("K", [
      makeLayoutItem("course", { courseKey: "venison", kitchenDisplayName: "Pass: VEN" }, "kitchen_flow"),
    ], "kitchen_flow");
    const visible = resolveKitchenCourses(layout, baseTable, sampleCourses);
    expect(visible[0].name).toBe("Pass: VEN");
  });

  it("kitchenCourseNotes name override beats kitchenDisplayName", () => {
    const layout = makeLayout("K", [
      makeLayoutItem("course", { courseKey: "venison", kitchenDisplayName: "Pass: VEN" }, "kitchen_flow"),
    ], "kitchen_flow");
    const table = { ...baseTable, kitchenCourseNotes: { venison: { name: "VEN MEDIUM" } } };
    const visible = resolveKitchenCourses(layout, table, sampleCourses);
    expect(visible[0].name).toBe("VEN MEDIUM");
  });
});
