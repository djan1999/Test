/**
 * Menu data utility functions shared across the application.
 */

export const firstFilled = (...vals) => vals.find(v => String(v ?? "").trim()) ?? "";

export const truthyCell = value => {
  const s = String(value ?? "").trim().toLowerCase();
  return s === "true" || s === "yes" || s === "y" || s === "1" || s === "wahr";
};

export const splitMainSubCell = (title, sub = "") => {
  const rawTitle = String(title ?? "").trim();
  const rawSub = String(sub ?? "").trim();
  if (!rawTitle && !rawSub) return null;
  if (rawTitle.includes("|")) {
    const [left, ...rest] = rawTitle.split("|");
    return {
      name: left.trim(),
      sub: rest.join("|").trim() || rawSub || "",
    };
  }
  return { name: rawTitle, sub: rawSub };
};

// Parse a bilingual cell with optional kitchen note:
//   Line 1 = EN  (menu generator)
//   Line 2 = SI  (menu generator)
//   Line 3 = kitchen ticket note (never used for menu generation)
// rawSubCol is the optional separate sub/description column (same 3-line structure).
// Returns { en: {name, sub} | null, si: {name, sub} | null, note: string }
export const parseBilingual = (rawCell, rawSubCol = "") => {
  const lines    = String(rawCell   ?? "").split("\n").map(s => s.trim());
  const subLines = String(rawSubCol ?? "").split("\n").map(s => s.trim());
  const en = splitMainSubCell(lines[0] || "", subLines[0] || "");
  const si = (lines[1] || subLines[1])
    ? splitMainSubCell(lines[1] || "", subLines[1] || "")
    : null;
  const note = lines[2] || subLines[2] || "";
  return { en: en?.name ? en : null, si: si?.name ? si : null, note };
};

// Apply a service-level menu override to a course.
// overrides[courseKey] = { name?, sub?, name_si?, sub_si?, seats?: { [seatId]: { name?, sub? } } }
// seatId: if provided, seat-specific overrides take precedence over table-wide ones.
export const applyMenuOverride = (course, overrides, seatId = null) => {
  const base = overrides?.[course.course_key];
  if (!base) return course;
  const seatOv = seatId != null ? (base.seats?.[seatId] || {}) : {};
  const ov = { ...base, ...seatOv };
  if (!Object.keys(ov).filter(k => k !== "seats").length) return course;
  return {
    ...course,
    menu: {
      name: "name" in ov ? ov.name : course.menu?.name,
      sub:  "sub"  in ov ? ov.sub  : course.menu?.sub,
    },
    menu_si: ("name_si" in ov || "sub_si" in ov) ? {
      name: "name_si" in ov ? ov.name_si : (course.menu_si?.name || ""),
      sub:  "sub_si"  in ov ? ov.sub_si  : (course.menu_si?.sub  || ""),
    } : course.menu_si,
  };
};

export const RESTRICTION_PRIORITY_KEYS = [
  "vegan","veg","pescetarian","gluten","dairy","nut","shellfish",
  "no_red_meat","no_pork","no_game","no_offal","egg_free","no_alcohol",
  "no_garlic_onion","halal","low_fodmap"
];

export const RESTRICTION_COLUMN_MAP = {
  veg: "veg",
  vegan: "vegan",
  pescetarian: "pescetarian",
  gluten: "gluten_free",
  dairy: "dairy_free",
  nut: "nut_free",
  shellfish: "shellfish_free",
  no_red_meat: "no_red_meat",
  no_pork: "no_pork",
  no_game: "no_game",
  no_offal: "no_offal",
  egg_free: "egg_free",
  no_alcohol: "no_alcohol",
  no_garlic_onion: "no_garlic_onion",
  halal: "halal",
  low_fodmap: "low_fodmap",
};

export function applyCourseRestriction(course, activeRestrictions, lang = "en") {
  const baseDish = course?.menu || null;
  if (!baseDish) return null;

  let dish = {
    name: String(baseDish.name || "").trim(),
    sub: String(baseDish.sub || "").trim(),
  };

  const courseRestrictions = course?.restrictions || {};

  for (const key of RESTRICTION_PRIORITY_KEYS) {
    if (!(activeRestrictions || []).includes(key)) continue;
    const mapped = RESTRICTION_COLUMN_MAP[key] || key;
    const siMapped = lang === "si" ? `${mapped}_si` : null;

    if (courseRestrictions[mapped]) {
      const next = (siMapped && courseRestrictions[siMapped]) ? courseRestrictions[siMapped] : courseRestrictions[mapped];
      if (next?.sub) {
        dish = { name: String(next.name || dish.name).trim(), sub: String(next.sub).trim() };
      } else if (next?.name) {
        dish = { name: dish.name, sub: String(next.name).trim() };
      }
      break;
    }

    if (mapped === "veg" && course?.veg) {
      const v = course.veg;
      if (v?.sub) {
        dish = { name: String(v.name || dish.name).trim(), sub: String(v.sub).trim() };
      } else if (v?.name) {
        dish = { name: dish.name, sub: String(v.name).trim() };
      }
    }
  }

  return dish;
}

const initDishes = [
  { id: 1, name: "Beetroot",  pairings: ["—", "Champagne", "N/A"] },
  { id: 2, name: "Cheese",    pairings: ["—", "Wine", "Non-Alc"] },
  { id: 3, name: "Cake",      pairings: ["—"] },
];

export function mergeDishes(list) {
  const base = Array.isArray(list) ? list : [];
  const builtinById = new Map(initDishes.map(d => [String(d.id), d]));
  const merged = base.map(item => {
    const builtin = builtinById.get(String(item?.id ?? ""));
    if (!builtin) return item;
    return {
      ...item,
      name: builtin.name,
      pairings: [...builtin.pairings],
    };
  });
  const seen = new Set(merged.map(x => String(x?.id ?? "")));
  initDishes.forEach(d => {
    if (!seen.has(String(d.id))) merged.push({ ...d, pairings: [...d.pairings] });
  });
  return merged.sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
}
