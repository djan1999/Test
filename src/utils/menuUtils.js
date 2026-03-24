/**
 * Menu data utility functions shared across the application.
 */

export const firstFilled = (...vals) => vals.find(v => String(v ?? "").trim()) ?? "";

export const truthyCell = value => {
  const s = String(value ?? "").trim().toLowerCase();
  return s === "true" || s === "yes" || s === "y" || s === "1" || s === "x" || s === "wahr";
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

    const variant = courseRestrictions[mapped] || null;
    if (!variant) continue;

    const next = (siMapped && courseRestrictions[siMapped]) ? courseRestrictions[siMapped] : variant;
    if (next?.sub) {
      dish = { name: String(next.name || dish.name).trim(), sub: String(next.sub).trim() };
    } else if (next?.name) {
      dish = { name: dish.name, sub: String(next.name).trim() };
    }
    break;
  }

  return dish;
}

// Restriction keys shared between frontend and API sync
export const RESTRICTION_KEYS = [
  "veg","vegan","pescetarian","gluten_free","dairy_free","nut_free","shellfish_free",
  "no_red_meat","no_pork","no_game","no_offal","egg_free","no_alcohol",
  "no_garlic_onion","halal","low_fodmap",
];

/**
 * Parse a single Google-Sheets row object into the canonical menu-course shape
 * used by the frontend. Both App.jsx (CSV fallback) and api/sync-menu.js call
 * this so the parsing logic lives in exactly one place.
 *
 * Returns null when the row has no dish name.
 */
export function parseMenuRow(row) {
  const dishLines = String(row.dish ?? "").split("\n").map(s => s.trim());
  const descLines = String(row.description ?? "").split("\n").map(s => s.trim());
  const dishEnRaw = dishLines[0] || "";
  const descEnRaw = descLines[0] || "";
  const dishSiRaw = String(row.dish_si ?? "").trim() || dishLines[1] || "";
  const descSiRaw = String(row.dish_si_sub ?? "").trim() || descLines[1] || "";
  const kitchenNoteFallback = dishLines[2] || "";

  const menu = splitMainSubCell(dishEnRaw, descEnRaw);
  if (!menu?.name) return null;

  const courseKey = String(firstFilled(row.course_key, row.key, dishEnRaw) || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const restrictions = {};
  RESTRICTION_KEYS.forEach((key) => {
    const { en, si, note: cellNote } = parseBilingual(row[key], row[`${key}_sub`]);
    restrictions[key] = en;
    if (si) restrictions[`${key}_si`] = si;
    const note = String(firstFilled(row[`${key}_note`], cellNote) || "").trim();
    if (note) restrictions[`${key}_note`] = note;
  });

  const menuSi = splitMainSubCell(dishSiRaw, descSiRaw);
  const wpBi   = parseBilingual(row.wp_drink,  row.wp_sub);
  const naBi   = parseBilingual(row.na_drink,  row.na_sub);
  const osBi   = parseBilingual(row.os_drink,  row.os_sub);
  const premBi = parseBilingual(row.premium,   row.premium_sub);

  const fpRaw = String(firstFilled(row.force_pairing_title)).trim();
  const [fpEnLine, fpSiLine] = fpRaw.split("\n").map(l => l.trim());
  const fpEn = splitMainSubCell(fpEnLine, String(firstFilled(row.force_pairing_sub)).trim());
  const fpSi = fpSiLine ? splitMainSubCell(fpSiLine) : null;

  return {
    position: Number(firstFilled(row["#"], row.position, row.order_index)) || 0,
    is_snack: truthyCell(firstFilled(row["snack?"], row.snack)),
    menu,
    menu_si: menuSi?.name ? menuSi : null,
    wp: wpBi.en,
    wp_si: wpBi.si || null,
    na: naBi.en,
    na_si: naBi.si || null,
    os: osBi.en,
    os_si: osBi.si || null,
    premium: premBi.en,
    premium_si: premBi.si || null,
    course_key: courseKey,
    optional_flag: String(firstFilled(row.optional_flag)).trim().toLowerCase(),
    section_gap_before: truthyCell(firstFilled(row.section_gap_before)),
    show_on_short: truthyCell(firstFilled(row.show_on_short)),
    short_order: Number(firstFilled(row.short_order)) || null,
    force_pairing_title: fpEn?.name || "",
    force_pairing_sub: fpEn?.sub || "",
    force_pairing_title_si: fpSi?.name || "",
    force_pairing_sub_si: fpSi?.sub || "",
    kitchen_note: String(firstFilled(row.kitchen_note, kitchenNoteFallback)).trim(),
    aperitif_btn: String(firstFilled(row.aperitif_btn, row.aperitif) || "").trim() || null,
    restrictions,
  };
}

export const initDishes = [
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
