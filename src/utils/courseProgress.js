/**
 * Shared course visibility and progression logic used by SheetView,
 * KitchenBoard, and any future service views.
 *
 * Layout-driven (preferred) vs. legacy (fallback):
 *   - When the caller passes an assigned kitchen layout (or the full
 *     `{ layouts, assignments }` payload), course visibility and order are
 *     decided by that layout. show_on_short / short_order / position are
 *     ignored.
 *   - When no layout context is provided (or no kitchen layout is assigned
 *     for this menu type), behaviour falls back to the original
 *     show_on_short / short_order / position rules so older tables and tests
 *     keep working unchanged.
 */

import { getAssignedKitchenLayout, resolveKitchenCourses } from "./menuLayouts.js";

const normFlag = s =>
  String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const normCategory = course => {
  const raw = normFlag(course?.course_category);
  if (raw === "main" || raw === "optional" || raw === "celebration") return raw;
  return normFlag(course?.optional_flag) ? "optional" : "main";
};

const isTruthyShort = v => {
  const s = String(v ?? "").trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "y" || s === "x" || s === "wahr";
};

/**
 * Resolve which kitchen layout to use, if any. Accepts either:
 *   - an already-resolved layout object ({ id, items, target }) — used as-is
 *   - the full payload `{ layouts, assignments }` — looked up via menuType
 *   - undefined / null — returns null and the legacy path is used
 */
function pickKitchenLayout(table, options) {
  if (!options) return null;
  if (Array.isArray(options.items)) return options;
  if (options.kitchenLayout && Array.isArray(options.kitchenLayout.items)) return options.kitchenLayout;
  const layouts = options.layouts;
  const assignments = options.assignments;
  if (!Array.isArray(layouts) || !assignments) return null;
  return getAssignedKitchenLayout(table?.menuType || "", layouts, assignments);
}

/**
 * Return filtered, sorted, display-ready course objects for a given table.
 *
 * Layout-driven path (when an assigned kitchen layout is found):
 *   - Course list & order come from layout.items (course-type entries only).
 *   - Inactive / snack courses excluded even if listed.
 *   - Optional courses appear only when at least one seat ordered them.
 *   - Celebration courses appear when birthday is on, or at least one seat
 *     ordered the matching extra.
 *
 * Legacy path (no layout context):
 *   - Skips inactive (is_active === false) and snack courses
 *   - Celebration courses auto-include all seats when table.birthday is on
 *   - Optional/celebration courses hidden unless at least one seat ordered them
 *   - Short menu: only courses with show_on_short truthy, sorted by short_order
 *   - Long menu: sorted by position
 *
 * Each returned object: { index, key, name, firedAt, rawCourse, kitchenItem? }
 *
 * Signature: getVisibleCoursesForTable(table, menuCourses, options)
 *   options can be:
 *     - undefined          → legacy fallback
 *     - resolved layout    → use directly
 *     - { kitchenLayout }  → use the bundled resolved layout
 *     - { layouts, assignments } → resolve kitchen layout via table.menuType
 */
export function getVisibleCoursesForTable(table, menuCourses, options) {
  const layout = pickKitchenLayout(table, options);
  if (layout) {
    return resolveKitchenCourses(layout, table || {}, menuCourses || []);
  }

  // ── Legacy path (unchanged) ────────────────────────────────────────────────
  const log       = table?.kitchenLog        || {};
  const overrides = table?.kitchenCourseNotes || {};
  const seats     = table?.seats             || [];
  const isShort   = String(table?.menuType || "").trim().toLowerCase() === "short";

  const orderedSeatsForFlag = (menuCourses || []).reduce((acc, course) => {
    const flag = normFlag(course?.optional_flag);
    if (!flag) return acc;
    const cat = normFlag(course?.course_category);
    const isCelebration =
      cat === "celebration" ||
      (cat !== "optional" && cat !== "main" && flag);
    acc[flag] = isCelebration && table?.birthday
      ? [...seats]
      : seats.filter(s => !!s.extras?.[flag]?.ordered);
    return acc;
  }, {});

  const filtered = (menuCourses || [])
    .filter(c => c?.course_key)
    .filter(c => c.is_active !== false)
    .filter(c => !c.is_snack)
    .filter(c => {
      const category = normCategory(c);
      const flag = normFlag(c?.optional_flag);

      // Celebration + birthday → always include, skip all remaining checks
      if (category === "celebration" && table?.birthday) return true;

      // Optional / celebration with no seats ordered → exclude
      // (if seats did order it, fall through to the short-menu check below)
      if ((category === "optional" || category === "celebration") && flag) {
        if ((orderedSeatsForFlag[flag] || []).length === 0) return false;
      }

      // Short menu filter applies to everything that reaches this point,
      // including optional courses whose seats ordered them
      if (isShort && !isTruthyShort(c.show_on_short)) return false;

      return true;
    })
    .sort((a, b) =>
      isShort
        ? (Number(a.short_order) || 9999) - (Number(b.short_order) || 9999)
        : (Number(a.position)    || 0)    - (Number(b.position)    || 0)
    );

  return filtered.map((c, i) => ({
    index:     i + 1,
    key:       c.course_key,
    name:      overrides[c.course_key]?.name || c?.menu?.name || c?.menu_si?.name || c.course_key,
    firedAt:   log[c.course_key]?.firedAt || null,
    rawCourse: c,
  }));
}

/**
 * Derive PREVIOUS / CURRENT / NEXT FIRE state from a visible-courses list.
 *
 * - current   = latest fired course in menu order (what is on the table)
 * - previous  = last fired course before current
 * - nextFire  = first unfired course after current;
 *               when nothing is fired yet → first course in list
 *               when all done → null (caller renders "COMPLETE")
 */
export function getCourseProgressState(table, visibleCourses) {
  const courses   = visibleCourses;
  const total     = courses.length;
  const firedCount = courses.filter(c => c.firedAt).length;
  const allComplete = total > 0 && firedCount === total;

  // current = highest-index fired course (walk from end to respect menu order)
  let currentIdx = -1;
  for (let i = courses.length - 1; i >= 0; i--) {
    if (courses[i].firedAt) { currentIdx = i; break; }
  }
  const current = currentIdx >= 0 ? courses[currentIdx] : null;

  // previous = last fired course before current
  let previousIdx = -1;
  if (currentIdx > 0) {
    for (let i = currentIdx - 1; i >= 0; i--) {
      if (courses[i].firedAt) { previousIdx = i; break; }
    }
  }
  const previous = previousIdx >= 0 ? courses[previousIdx] : null;

  // nextFire = first unfired after current; if nothing fired yet, start from 0
  const searchStart = currentIdx >= 0 ? currentIdx + 1 : 0;
  let nextFireIdx = -1;
  for (let i = searchStart; i < courses.length; i++) {
    if (!courses[i].firedAt) { nextFireIdx = i; break; }
  }
  const nextFire = nextFireIdx >= 0 ? courses[nextFireIdx] : null;

  return { previous, current, nextFire, allComplete, firedCount, total };
}
