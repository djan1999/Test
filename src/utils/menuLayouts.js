/**
 * menuLayouts.js — named, reusable Menu Layouts (guest menu + kitchen flow).
 *
 * A layout is an ordered list of items (course refs + static blocks) that
 * decides what appears on a menu (or kitchen ticket flow) and in what order.
 * Course content (name, description, restrictions, pairings) lives in
 * menuCourses; layouts only reference courses by `course_key`.
 *
 * Each layout has a `target`:
 *   - "guest_menu"   → drives the printed/preview customer menu
 *   - "kitchen_flow" → drives KitchenBoard / SheetView course visibility & order
 *
 * Long Menu / Short Menu and Long Kitchen / Short Kitchen each pick which
 * layout to use via `assignments`:
 *   {
 *     longMenuLayoutId,
 *     shortMenuLayoutId,
 *     longKitchenLayoutId,
 *     shortKitchenLayoutId,
 *   }
 *
 * Backward compatibility: layouts without a `target` are treated as
 * "guest_menu" (the original system). Old payloads without kitchen
 * assignments are upgraded by sanitizeLayoutsPayload (kitchen ids stay null
 * and callers fall back to the legacy show_on_short / position behavior
 * until defaults are seeded).
 *
 * Persistence: stored in Supabase service_settings under id="menu_layouts_v1"
 * as { layouts: [...], assignments: {...} }.
 */

export const LAYOUT_TARGETS = ["guest_menu", "kitchen_flow"];

// Item types allowed in each layout target. Guest menus support richer
// presentation blocks (static text, optional notes); kitchen flows are
// deliberately simple — visibility/order is what matters there.
export const GUEST_LAYOUT_ITEM_TYPES = [
  "course",
  "staticText",
  "sectionHeader",
  "spacer",
  "divider",
  "optionalNote",
];

export const KITCHEN_LAYOUT_ITEM_TYPES = [
  "course",
  "sectionHeader",
  "spacer",
  "divider",
];

// Combined list — preserved for back-compat with callers that imported the
// original symbol (sanitization, generic UIs).
export const LAYOUT_ITEM_TYPES = [
  ...new Set([...GUEST_LAYOUT_ITEM_TYPES, ...KITCHEN_LAYOUT_ITEM_TYPES]),
];

export function itemTypesForTarget(target) {
  return target === "kitchen_flow" ? KITCHEN_LAYOUT_ITEM_TYPES : GUEST_LAYOUT_ITEM_TYPES;
}

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

const normCategory = (course) => {
  const raw = normalizeCourseToken(course?.course_category);
  if (raw === "main" || raw === "optional" || raw === "celebration") return raw;
  return normalizeCourseToken(course?.optional_flag) ? "optional" : "main";
};

let _seq = 0;
export function makeId(prefix = "item") {
  _seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${_seq}`;
}

const KITCHEN_COURSE_DEFAULTS = {
  kitchenDisplayName: "",
  showRestrictions: true,
  showPairingAlert: true,
  showSeatNotes: true,
  showCourseNotes: true,
};

// Item defaults per (target, type). Falls back to guest_menu when target is
// unknown so generic callers keep working.
const ITEM_DEFAULTS = {
  guest_menu: {
    course:        () => ({ courseKey: "", showPairing: true }),
    staticText:    () => ({ text: "", align: "left", bold: false }),
    sectionHeader: () => ({ text: "", align: "right" }),
    spacer:        () => ({ size: "medium" }),
    divider:       () => ({}),
    optionalNote:  () => ({ text: "" }),
  },
  kitchen_flow: {
    course:        () => ({ courseKey: "", ...KITCHEN_COURSE_DEFAULTS }),
    sectionHeader: () => ({ text: "", align: "left" }),
    spacer:        () => ({ size: "medium" }),
    divider:       () => ({}),
  },
};

export function makeLayoutItem(type, fields = {}, target = "guest_menu") {
  const allowed = itemTypesForTarget(target);
  if (!allowed.includes(type)) {
    throw new Error(`Item type "${type}" is not allowed in a "${target}" layout`);
  }
  const tableForTarget = ITEM_DEFAULTS[target] || ITEM_DEFAULTS.guest_menu;
  const defaultsFn = tableForTarget[type] || (ITEM_DEFAULTS.guest_menu[type] || (() => ({})));
  return { id: makeId(type), type, ...defaultsFn(), ...fields };
}

export function makeLayout(name, items = [], target = "guest_menu") {
  const finalTarget = LAYOUT_TARGETS.includes(target) ? target : "guest_menu";
  return {
    id: makeId("layout"),
    name: String(name || "Untitled Layout"),
    target: finalTarget,
    items: Array.isArray(items)
      ? items.map(it => ({ ...it, id: it.id || makeId(it.type || "item") }))
      : [],
  };
}

const isTruthyShortFlag = (value) => {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "y" || v === "x" || v === "wahr";
};

const sortLong = (a, b) => (Number(a.position) || 0) - (Number(b.position) || 0);
const sortShortFallbackPosition = (a, b) => {
  const aOrd = Number(a.short_order);
  const bOrd = Number(b.short_order);
  const aKey = Number.isFinite(aOrd) ? aOrd : 9999;
  const bKey = Number.isFinite(bOrd) ? bOrd : 9999;
  if (aKey !== bKey) return aKey - bKey;
  return (Number(a.position) || 0) - (Number(b.position) || 0);
};

/**
 * Build the default Long/Short Menu and Long/Short Kitchen layouts from
 * menuCourses. Returns the full payload:
 *
 * {
 *   layouts: [longGuest, shortGuest, longKitchen, shortKitchen],
 *   assignments: {
 *     longMenuLayoutId, shortMenuLayoutId,
 *     longKitchenLayoutId, shortKitchenLayoutId,
 *   },
 * }
 *
 * Long: every active non-snack course in `position` order.
 * Short: courses with show_on_short truthy, sorted by short_order
 *        (falls back to long order when nothing is flagged).
 */
export function createDefaultLayouts(menuCourses = []) {
  const courses = Array.isArray(menuCourses) ? menuCourses : [];
  const active = courses.filter(c => c?.is_active !== false && !c?.is_snack && c?.course_key);

  const longCourseList = [...active].sort(sortLong);
  const shortSource = active.filter(c => isTruthyShortFlag(c.show_on_short));
  const shortCourseList = (shortSource.length > 0 ? [...shortSource] : [...active]).sort(sortShortFallbackPosition);

  const longGuest = makeLayout(
    "Default Long Menu",
    longCourseList.map(c => makeLayoutItem("course", { courseKey: c.course_key }, "guest_menu")),
    "guest_menu",
  );
  const shortGuest = makeLayout(
    "Default Short Menu",
    shortCourseList.map(c => makeLayoutItem("course", { courseKey: c.course_key }, "guest_menu")),
    "guest_menu",
  );
  const longKitchen = makeLayout(
    "Default Long Kitchen",
    longCourseList.map(c => makeLayoutItem("course", { courseKey: c.course_key }, "kitchen_flow")),
    "kitchen_flow",
  );
  const shortKitchen = makeLayout(
    "Default Short Kitchen",
    shortCourseList.map(c => makeLayoutItem("course", { courseKey: c.course_key }, "kitchen_flow")),
    "kitchen_flow",
  );

  return {
    layouts: [longGuest, shortGuest, longKitchen, shortKitchen],
    assignments: {
      longMenuLayoutId: longGuest.id,
      shortMenuLayoutId: shortGuest.id,
      longKitchenLayoutId: longKitchen.id,
      shortKitchenLayoutId: shortKitchen.id,
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

/**
 * Pick the layout assigned to a given menu type & target.
 * menuType: "short" → short, anything else → long.
 * target:   "guest_menu" (default) | "kitchen_flow".
 */
export function getAssignedLayout(menuType, layouts = [], assignments = {}, target = "guest_menu") {
  const list = Array.isArray(layouts) ? layouts : [];
  if (list.length === 0) return null;
  const isShort = String(menuType || "").trim().toLowerCase() === "short";
  const slot = (() => {
    if (target === "kitchen_flow") return isShort ? "shortKitchenLayoutId" : "longKitchenLayoutId";
    return isShort ? "shortMenuLayoutId" : "longMenuLayoutId";
  })();
  const targetId = assignments?.[slot];
  const found = list.find(l => l?.id === targetId);
  if (!found) return null;
  // If the layout has a target tag, make sure it matches the requested target.
  // Untagged layouts are treated as guest_menu (legacy behavior).
  const layoutTarget = found.target || "guest_menu";
  if (target === "kitchen_flow" && layoutTarget !== "kitchen_flow") return null;
  if (target === "guest_menu" && layoutTarget !== "guest_menu") return null;
  return found;
}

/** Convenience helpers for the two targets. */
export const getAssignedGuestLayout = (menuType, layouts, assignments) =>
  getAssignedLayout(menuType, layouts, assignments, "guest_menu");
export const getAssignedKitchenLayout = (menuType, layouts, assignments) =>
  getAssignedLayout(menuType, layouts, assignments, "kitchen_flow");

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
    target: layout.target || "guest_menu",
    items: (layout.items || []).map(it => ({ ...it, id: makeId(it.type || "item") })),
  };
}

export function renameLayout(layouts, layoutId, nextName) {
  return (layouts || []).map(l =>
    l.id === layoutId ? { ...l, name: String(nextName || "").trim() || l.name } : l
  );
}

const ASSIGNMENT_SLOTS = [
  "longMenuLayoutId",
  "shortMenuLayoutId",
  "longKitchenLayoutId",
  "shortKitchenLayoutId",
];

/** Returns true if the layout is currently assigned to ANY slot. */
export function isLayoutAssigned(layoutId, assignments = {}) {
  return ASSIGNMENT_SLOTS.some(slot => assignments?.[slot] === layoutId);
}

/** Returns the list of assignment-slot keys the given layout currently fills. */
export function getLayoutAssignmentRoles(layoutId, assignments = {}) {
  return ASSIGNMENT_SLOTS.filter(slot => assignments?.[slot] === layoutId);
}

/**
 * Deletion is blocked while a layout is assigned to any slot, or when removing
 * it would leave its target without any layouts at all (since the editor needs
 * at least one layout per target to assign).
 */
export function canDeleteLayout(layoutId, layouts = [], assignments = {}) {
  const list = Array.isArray(layouts) ? layouts : [];
  if (list.length <= 1) return false;
  if (isLayoutAssigned(layoutId, assignments)) return false;
  const target = list.find(l => l.id === layoutId)?.target || "guest_menu";
  const remainingForTarget = list.filter(l => l.id !== layoutId && (l.target || "guest_menu") === target);
  if (remainingForTarget.length === 0) return false;
  return true;
}

/**
 * Validate and normalize a stored layouts payload, repairing when possible.
 *
 * Backwards compatibility:
 *   - Layouts without a `target` are upgraded to target="guest_menu".
 *   - Items whose type is not allowed for the layout's target are dropped.
 *   - Missing kitchen assignments are returned as null (callers fall back to
 *     legacy show_on_short / position behavior until defaults are seeded).
 *   - Assignment slots that point to non-existent or wrong-target layouts are
 *     auto-cleared (or repointed to the first matching layout) so the UI
 *     never shows stale ids.
 */
export function sanitizeLayoutsPayload(raw) {
  const layouts = Array.isArray(raw?.layouts)
    ? raw.layouts
        .filter(l => l && typeof l === "object")
        .map(l => {
          const target = LAYOUT_TARGETS.includes(l.target) ? l.target : "guest_menu";
          const allowedTypes = itemTypesForTarget(target);
          return {
            id: String(l.id || makeId("layout")),
            name: String(l.name || "Untitled Layout"),
            target,
            items: Array.isArray(l.items)
              ? l.items
                  .filter(it => it && typeof it === "object" && allowedTypes.includes(it.type))
                  .map(it => ({ ...it, id: String(it.id || makeId(it.type)) }))
              : [],
          };
        })
    : [];

  const a = raw?.assignments || {};

  const pickValid = (slotId, target, fallbackIdx) => {
    if (slotId) {
      const found = layouts.find(l => l.id === slotId);
      if (found && (found.target || "guest_menu") === target) return slotId;
    }
    const matchingForTarget = layouts.filter(l => (l.target || "guest_menu") === target);
    if (matchingForTarget.length === 0) return null;
    return matchingForTarget[fallbackIdx]?.id || matchingForTarget[0].id;
  };

  return {
    layouts,
    assignments: {
      longMenuLayoutId:    pickValid(a.longMenuLayoutId,    "guest_menu",   0),
      shortMenuLayoutId:   pickValid(a.shortMenuLayoutId,   "guest_menu",   1),
      longKitchenLayoutId: pickValid(a.longKitchenLayoutId, "kitchen_flow", 0),
      shortKitchenLayoutId:pickValid(a.shortKitchenLayoutId,"kitchen_flow", 1),
    },
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

// ── Kitchen layout helpers ───────────────────────────────────────────────────

/**
 * Resolve a kitchen layout against menuCourses + a table to produce the
 * ordered, ready-to-render list of courses for KitchenBoard / SheetView.
 *
 * Behaviour:
 *   - Inactive courses are excluded even if listed in the layout.
 *   - Optional courses appear only when at least one seat ordered them
 *     (or when the layout marks the course explicitly active and birthday is on).
 *   - Celebration courses appear when table.birthday is on (auto-includes all
 *     seats) or when at least one seat ordered the corresponding extra.
 *   - Missing course refs (courseKey doesn't match any active course) are
 *     skipped silently — the layout is the source of truth, but it can't
 *     materialise courses that no longer exist.
 *
 * Each entry: { index, key, name, firedAt, rawCourse, kitchenItem }
 *   - kitchenItem is the raw layout item, so callers can read kitchenDisplayName,
 *     showRestrictions, showPairingAlert, etc.
 */
export function resolveKitchenCourses(layout, table, menuCourses = []) {
  if (!layout || !Array.isArray(layout.items)) return [];
  const seats = Array.isArray(table?.seats) ? table.seats : [];
  const log = table?.kitchenLog || {};
  const overrides = table?.kitchenCourseNotes || {};

  const courseByKey = new Map();
  (Array.isArray(menuCourses) ? menuCourses : []).forEach(c => {
    const k = c?.course_key;
    if (!k) return;
    courseByKey.set(k, c);
    const norm = normalizeCourseToken(k);
    if (norm && norm !== k && !courseByKey.has(norm)) courseByKey.set(norm, c);
  });

  const orderedSeatsForFlag = (Array.isArray(menuCourses) ? menuCourses : []).reduce((acc, course) => {
    const flag = normalizeCourseToken(course?.optional_flag);
    if (!flag) return acc;
    const cat = normCategory(course);
    const isCelebration = cat === "celebration" || (cat !== "main" && cat !== "optional" && flag);
    acc[flag] = isCelebration && table?.birthday
      ? [...seats]
      : seats.filter(s => !!s.extras?.[flag]?.ordered);
    return acc;
  }, {});

  const resolved = [];
  let displayIdx = 0;
  for (const item of layout.items) {
    if (item?.type !== "course") continue;
    const k = item.courseKey;
    const course = courseByKey.get(k) || courseByKey.get(normalizeCourseToken(k || ""));
    if (!course) continue;
    if (course.is_active === false) continue;
    if (course.is_snack) continue;

    const category = normCategory(course);
    const flag = normalizeCourseToken(course.optional_flag);

    if (category === "celebration") {
      const birthdayOn = !!table?.birthday;
      const ordered = (orderedSeatsForFlag[flag] || []).length > 0;
      if (!birthdayOn && !ordered) continue;
    } else if (category === "optional" && flag) {
      const ordered = (orderedSeatsForFlag[flag] || []).length > 0;
      if (!ordered) continue;
    }

    displayIdx += 1;
    const baseName = course?.menu?.name || course?.menu_si?.name || course.course_key;
    const overrideName = overrides[course.course_key]?.name;
    const kitchenName = item.kitchenDisplayName?.trim?.();
    resolved.push({
      index: displayIdx,
      key: course.course_key,
      name: overrideName || kitchenName || baseName,
      firedAt: log[course.course_key]?.firedAt || null,
      rawCourse: course,
      kitchenItem: item,
    });
  }
  return resolved;
}
