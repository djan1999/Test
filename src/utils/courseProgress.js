/**
 * Shared course visibility and progression logic used by SheetView,
 * KitchenBoard, and any future service views.
 *
 * Layout-driven (preferred) vs. legacy (fallback):
 *   - When the caller passes profiles + assignments (or a resolved kitchen
 *     profile / template directly), course visibility and order are derived
 *     from that profile's row-based menuTemplate via
 *     `deriveCourseKeysFromTemplate`. show_on_short / short_order / position
 *     are not consulted at all on this path.
 *   - When no kitchen layout context is available, behaviour falls back to
 *     the original show_on_short / short_order / position rules so older
 *     tables and tests keep working unchanged.
 */

import {
  getAssignedKitchenProfile,
  deriveCourseKeysFromTemplate,
  deriveKitchenItemsFromTemplate,
} from "./menuLayoutProfiles.js";

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
 * Resolve which kitchen profile/template to use, if any. Accepts either:
 *   - an already-resolved profile-like object (`{ menuTemplate }`)
 *   - a bare menuTemplate (`{ rows: [...] }`) — used as-is
 *   - the unified payload `{ profiles, assignments }` — looked up via menuType
 *   - `{ kitchenProfile }` or `{ kitchenTemplate }` shorthand
 *   - undefined / null — returns null and the legacy path is used
 */
function pickKitchenTemplate(table, options) {
  if (!options) return null;
  if (Array.isArray(options.rows)) return options;                  // bare template
  if (options.menuTemplate && Array.isArray(options.menuTemplate.rows)) return options.menuTemplate;
  if (options.kitchenTemplate && Array.isArray(options.kitchenTemplate.rows)) return options.kitchenTemplate;
  if (options.kitchenProfile?.menuTemplate?.rows) return options.kitchenProfile.menuTemplate;
  const profiles = options.profiles;
  const assignments = options.assignments;
  if (Array.isArray(profiles) && assignments) {
    const profile = getAssignedKitchenProfile(table?.menuType || "", profiles, assignments);
    return profile?.menuTemplate || null;
  }
  return null;
}

/**
 * Compute visible courses against an assigned kitchen template.
 * - Course list & order derived from `deriveCourseKeysFromTemplate`
 * - Inactive / snack courses excluded even if listed
 * - Optional courses appear only when at least one seat ordered them
 * - Celebration courses appear when birthday is on, or a seat ordered them
 * - Each entry exposes a `kitchenItem` (per-courseKey overlay options
 *   read from the matching course block in the template).
 */
function visibleFromTemplate(template, table, menuCourses) {
  const seats = Array.isArray(table?.seats) ? table.seats : [];
  const log = table?.kitchenLog || {};
  const overrides = table?.kitchenCourseNotes || {};

  const courseByKey = new Map();
  (Array.isArray(menuCourses) ? menuCourses : []).forEach(c => {
    if (c?.course_key) courseByKey.set(c.course_key, c);
  });

  const orderedSeatsForFlag = (Array.isArray(menuCourses) ? menuCourses : []).reduce((acc, course) => {
    const flag = normFlag(course?.optional_flag);
    if (!flag) return acc;
    const cat = normCategory(course);
    const isCelebration = cat === "celebration" || (cat !== "main" && cat !== "optional" && flag);
    acc[flag] = isCelebration && table?.birthday
      ? [...seats]
      : seats.filter(s => !!s.extras?.[flag]?.ordered);
    return acc;
  }, {});

  const orderedKeys = deriveCourseKeysFromTemplate(template);
  const itemMap = deriveKitchenItemsFromTemplate(template);

  const out = [];
  let displayIdx = 0;
  for (const key of orderedKeys) {
    const course = courseByKey.get(key);
    if (!course) continue;
    if (course.is_active === false) continue;
    if (course.is_snack) continue;

    const category = normCategory(course);
    const flag = normFlag(course.optional_flag);
    if (category === "celebration") {
      const ordered = (orderedSeatsForFlag[flag] || []).length > 0;
      if (!table?.birthday && !ordered) continue;
    } else if (category === "optional" && flag) {
      const ordered = (orderedSeatsForFlag[flag] || []).length > 0;
      if (!ordered) continue;
    }

    const kitchenItem = itemMap[key] || null;
    const baseName = course?.menu?.name || course?.menu_si?.name || course.course_key;
    const overrideName = overrides[course.course_key]?.name;
    const kitchenName = kitchenItem?.kitchenDisplayName || "";

    displayIdx += 1;
    out.push({
      index:    displayIdx,
      key:      course.course_key,
      name:     overrideName || kitchenName || baseName,
      firedAt:  log[course.course_key]?.firedAt || null,
      rawCourse: course,
      kitchenItem,
    });
  }
  return out;
}

/**
 * Return filtered, sorted, display-ready course objects for a given table.
 *
 * Profile-driven path (preferred): when the caller passes profiles+assignments
 * or a kitchen template, the kitchen profile's menuTemplate decides
 * visibility and order via `deriveCourseKeysFromTemplate`.
 *
 * Legacy fallback path:
 *   - Skips inactive (is_active === false) and snack courses
 *   - Celebration courses auto-include all seats when table.birthday is on
 *   - Optional/celebration courses hidden unless at least one seat ordered them
 *   - Short menu: only courses with show_on_short truthy, sorted by short_order
 *   - Long menu: sorted by position
 *
 * Each returned object: { index, key, name, firedAt, rawCourse, kitchenItem? }
 */
export function getVisibleCoursesForTable(table, menuCourses, options) {
  const template = pickKitchenTemplate(table, options);
  if (template) return visibleFromTemplate(template, table || {}, menuCourses || []);

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

      if (category === "celebration" && table?.birthday) return true;

      if ((category === "optional" || category === "celebration") && flag) {
        if ((orderedSeatsForFlag[flag] || []).length === 0) return false;
      }

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

  let currentIdx = -1;
  for (let i = courses.length - 1; i >= 0; i--) {
    if (courses[i].firedAt) { currentIdx = i; break; }
  }
  const current = currentIdx >= 0 ? courses[currentIdx] : null;

  let previousIdx = -1;
  if (currentIdx > 0) {
    for (let i = currentIdx - 1; i >= 0; i--) {
      if (courses[i].firedAt) { previousIdx = i; break; }
    }
  }
  const previous = previousIdx >= 0 ? courses[previousIdx] : null;

  const searchStart = currentIdx >= 0 ? currentIdx + 1 : 0;
  let nextFireIdx = -1;
  for (let i = searchStart; i < courses.length; i++) {
    if (!courses[i].firedAt) { nextFireIdx = i; break; }
  }
  const nextFire = nextFireIdx >= 0 ? courses[nextFireIdx] : null;

  return { previous, current, nextFire, allComplete, firedCount, total };
}
