/**
 * menuLayouts.js — named, reusable Menu Layouts.
 *
 * A Menu Layout is an ordered list of items (course refs + static blocks) that
 * decides what appears on a printed menu and in what order. Course content
 * (name, description, restrictions, pairings) lives in menuCourses; layouts
 * only reference courses by `course_key`.
 *
 * Long Menu and Short Menu each pick which layout to use via `layoutAssignments`:
 *   { longMenuLayoutId, shortMenuLayoutId }
 *
 * Layout shape:
 * {
 *   id: "layout_long_2026_winter",
 *   name: "Long 2026 Winter",
 *   items: [
 *     { id, type: "course",        courseKey: "linzer_eye" },
 *     { id, type: "staticText",    text: "...", align: "left" },
 *     { id, type: "sectionHeader", text: "Pairings", align: "right" },
 *     { id, type: "spacer",        size: "medium" },     // small | medium | large
 *     { id, type: "divider" },
 *     { id, type: "optionalNote",  text: "..." },
 *   ],
 * }
 *
 * Persistence: stored in Supabase service_settings under id="menu_layouts_v1"
 * as { layouts: [...], assignments: { longMenuLayoutId, shortMenuLayoutId } }.
 */

export const LAYOUT_ITEM_TYPES = [
  "course",
  "staticText",
  "sectionHeader",
  "spacer",
  "divider",
  "optionalNote",
];

export const SPACER_SIZES = ["small", "medium", "large"];

const SPACER_PT = { small: 6, medium: 12, large: 24 };
export function spacerSizeToPt(size) {
  return SPACER_PT[String(size || "medium").toLowerCase()] ?? SPACER_PT.medium;
}

const normalizeCourseToken = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

let _seq = 0;
export function makeId(prefix = "item") {
  _seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${_seq}`;
}

const ITEM_DEFAULTS = {
  course:        () => ({ courseKey: "" }),
  staticText:    () => ({ text: "", align: "left", bold: false }),
  sectionHeader: () => ({ text: "", align: "right" }),
  spacer:        () => ({ size: "medium" }),
  divider:       () => ({}),
  optionalNote:  () => ({ text: "" }),
};

export function makeLayoutItem(type, fields = {}) {
  if (!LAYOUT_ITEM_TYPES.includes(type)) {
    throw new Error(`Unknown menu-layout item type: ${type}`);
  }
  const defaults = ITEM_DEFAULTS[type]();
  return { id: makeId(type), type, ...defaults, ...fields };
}

export function makeLayout(name, items = []) {
  return {
    id: makeId("layout"),
    name: String(name || "Untitled Layout"),
    items: Array.isArray(items) ? items.map(it => ({ ...it, id: it.id || makeId(it.type || "item") })) : [],
  };
}

const isTruthyShortFlag = (value) => {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "y" || v === "x" || v === "wahr";
};

/**
 * Build the default Long and Short layouts from menuCourses.
 *
 * Long Layout: every active non-snack course in `position` order.
 * Short Layout: active courses with show_on_short truthy, sorted by short_order
 *               (falling back to position when short_order is missing).
 *
 * Returns { layouts: [longLayout, shortLayout], assignments: {...} }.
 */
export function createDefaultLayouts(menuCourses = []) {
  const courses = Array.isArray(menuCourses) ? menuCourses : [];
  const active = courses.filter(c => c?.is_active !== false && !c?.is_snack && c?.course_key);

  const longItems = [...active]
    .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))
    .map(c => makeLayoutItem("course", { courseKey: c.course_key }));

  const shortSource = active.filter(c => isTruthyShortFlag(c.show_on_short));
  const shortItems = [...shortSource]
    .sort((a, b) => {
      const aOrd = Number(a.short_order);
      const bOrd = Number(b.short_order);
      const aKey = Number.isFinite(aOrd) ? aOrd : 9999;
      const bKey = Number.isFinite(bOrd) ? bOrd : 9999;
      if (aKey !== bKey) return aKey - bKey;
      return (Number(a.position) || 0) - (Number(b.position) || 0);
    })
    .map(c => makeLayoutItem("course", { courseKey: c.course_key }));

  const longLayout = makeLayout("Default Long Layout", longItems);
  const shortLayout = makeLayout("Default Short Layout", shortItems.length > 0 ? shortItems : longItems);

  return {
    layouts: [longLayout, shortLayout],
    assignments: {
      longMenuLayoutId: longLayout.id,
      shortMenuLayoutId: shortLayout.id,
    },
  };
}

/**
 * Resolve a layout's items into render-ready entries by attaching the matching
 * course object to each course item. Items whose courseKey doesn't match any
 * known course are returned with `course: null` and `missing: true` so the
 * caller can decide whether to skip or warn.
 */
export function resolveMenuLayout(layout, menuCourses = []) {
  if (!layout || !Array.isArray(layout.items)) return [];
  const courseMap = new Map();
  (Array.isArray(menuCourses) ? menuCourses : []).forEach(c => {
    const k = c?.course_key;
    if (k) {
      courseMap.set(k, c);
      const norm = normalizeCourseToken(k);
      if (norm && norm !== k && !courseMap.has(norm)) courseMap.set(norm, c);
    }
  });

  return layout.items.map((item, idx) => {
    if (item.type === "course") {
      const course = courseMap.get(item.courseKey)
        || courseMap.get(normalizeCourseToken(item.courseKey))
        || null;
      return { ...item, index: idx, course, missing: !course };
    }
    return { ...item, index: idx };
  });
}

/** Pick the layout assigned to a given menu type. menuType is "short" or anything else (treated as long). */
export function getAssignedLayout(menuType, layouts = [], assignments = {}) {
  const list = Array.isArray(layouts) ? layouts : [];
  if (list.length === 0) return null;
  const isShort = String(menuType || "").trim().toLowerCase() === "short";
  const targetId = isShort ? assignments?.shortMenuLayoutId : assignments?.longMenuLayoutId;
  return list.find(l => l?.id === targetId) || null;
}

/** Return the ordered list of resolved courses (skipping missing course items). */
export function getOrderedCoursesForLayout(layout, menuCourses = []) {
  const resolved = resolveMenuLayout(layout, menuCourses);
  return resolved.filter(it => it.type === "course" && it.course && !it.missing).map(it => it.course);
}

// ── Layout management helpers ────────────────────────────────────────────────

export function duplicateLayout(layout, nextName) {
  if (!layout) return null;
  return {
    id: makeId("layout"),
    name: nextName || `${layout.name || "Layout"} (copy)`,
    items: (layout.items || []).map(it => ({ ...it, id: makeId(it.type || "item") })),
  };
}

export function renameLayout(layouts, layoutId, nextName) {
  return (layouts || []).map(l =>
    l.id === layoutId ? { ...l, name: String(nextName || "").trim() || l.name } : l
  );
}

/** Returns true if the layout is currently assigned to Long or Short. */
export function isLayoutAssigned(layoutId, assignments = {}) {
  return assignments?.longMenuLayoutId === layoutId || assignments?.shortMenuLayoutId === layoutId;
}

export function canDeleteLayout(layoutId, layouts = [], assignments = {}) {
  if ((layouts || []).length <= 1) return false;
  return !isLayoutAssigned(layoutId, assignments);
}

/** Validate and normalize a stored layouts payload, repairing when possible. */
export function sanitizeLayoutsPayload(raw) {
  const layouts = Array.isArray(raw?.layouts)
    ? raw.layouts
        .filter(l => l && typeof l === "object")
        .map(l => ({
          id: String(l.id || makeId("layout")),
          name: String(l.name || "Untitled Layout"),
          items: Array.isArray(l.items)
            ? l.items.filter(it => it && typeof it === "object" && LAYOUT_ITEM_TYPES.includes(it.type))
                     .map(it => ({ ...it, id: String(it.id || makeId(it.type)) }))
            : [],
        }))
    : [];

  const ids = new Set(layouts.map(l => l.id));
  const a = raw?.assignments || {};
  const longId = a.longMenuLayoutId && ids.has(a.longMenuLayoutId) ? a.longMenuLayoutId : (layouts[0]?.id || null);
  const shortId = a.shortMenuLayoutId && ids.has(a.shortMenuLayoutId) ? a.shortMenuLayoutId : (layouts[1]?.id || layouts[0]?.id || null);

  return {
    layouts,
    assignments: { longMenuLayoutId: longId, shortMenuLayoutId: shortId },
  };
}

/** Reorder helper used by drag-and-drop / up-down buttons. */
export function moveLayoutItem(items, fromIdx, toIdx) {
  const arr = Array.isArray(items) ? [...items] : [];
  if (fromIdx < 0 || fromIdx >= arr.length || toIdx < 0 || toIdx >= arr.length || fromIdx === toIdx) return arr;
  const [it] = arr.splice(fromIdx, 1);
  arr.splice(toIdx, 0, it);
  return arr;
}
