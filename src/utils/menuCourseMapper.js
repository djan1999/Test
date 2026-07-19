import {
  RESTRICTION_KEYS,
  RESTRICTION_COLUMN_MAP,
  normalizeCourseCategory,
} from "./menuUtils.js";
import { DIETARY_KEYS } from "../constants/dietary.js";

// Keeps the database shape at the data boundary. UI code should only handle
// the internal course model, while this module owns legacy and column details.
export function supabaseRowToCourse(row) {
  const restrictions = {};
  // Union of the live vocabulary and EVERY known DB column key: the four
  // allergy columns (gluten_free → "gluten", …) must map regardless of what
  // DIETARY_KEYS currently holds. On a fresh device the menu fetch can win
  // the boot race against the vocabulary load — mapping only DIETARY_KEYS
  // then nulled every allergy variant and cached the broken result, so a
  // celiac guest's printed menu showed the ORIGINAL dish with no warning.
  new Set([...DIETARY_KEYS, ...Object.keys(RESTRICTION_COLUMN_MAP)]).forEach((key) => {
    const dbKey = RESTRICTION_COLUMN_MAP[key];
    restrictions[key] = dbKey ? (row[dbKey] ?? null) : null;
  });
  Object.entries(row.restrictions_si || {}).forEach(([key, value]) => {
    if (key.startsWith("__en_")) {
      if (value) restrictions[key.slice("__en_".length)] = value;
    } else if (key.endsWith("__note")) {
      if (value) restrictions[`${key.slice(0, -"__note".length)}_note`] = value;
    } else if (value) {
      restrictions[`${key}_si`] = value;
    }
  });
  let menu = row.menu || null;
  let menuSi = row.menu_si || null;
  if (menu?.name?.includes("\n")) {
    const nameParts = menu.name.split(/\n+/).map((value) => value.trim()).filter(Boolean);
    const subParts = (menu.sub || "").split(/\n+/).map((value) => value.trim()).filter(Boolean);
    menu = { name: nameParts[0] || "", sub: subParts[0] || "" };
    if (!menuSi && nameParts[1]) menuSi = { name: nameParts[1], sub: subParts[1] || "" };
  }
  return {
    position: row.position,
    menu,
    veg: row.veg,
    hazards: row.hazards,
    na: row.na,
    na_si: row.na_si || null,
    wp: row.wp,
    wp_si: row.wp_si || null,
    os: row.os,
    os_si: row.os_si || null,
    premium: row.premium,
    premium_si: row.premium_si || null,
    is_snack: row.is_snack,
    is_last_bite: Boolean(row.is_last_bite),
    menu_si: menuSi,
    course_key: row.course_key || "",
    course_category: normalizeCourseCategory(row.course_category, row.optional_flag || ""),
    optional_flag: row.optional_flag || "",
    optional_pairing_flag: row.optional_pairing_flag || "",
    optional_pairing_label: row.optional_pairing_label || "",
    optional_pairing_enabled: row.optional_pairing_enabled !== false,
    optional_pairing_default_on: row.optional_pairing_default_on !== false,
    optional_pairing_alco: row.optional_pairing_alco || null,
    optional_pairing_alco_si: row.optional_pairing_alco_si || null,
    optional_pairing_na: row.optional_pairing_na || null,
    optional_pairing_na_si: row.optional_pairing_na_si || null,
    section_gap_before: false,
    show_on_short: Boolean(row.show_on_short),
    short_order: row.short_order || null,
    force_pairing_title: row.force_pairing_title || "",
    force_pairing_sub: row.force_pairing_sub || "",
    force_pairing_title_si: row.force_pairing_title_si || "",
    force_pairing_sub_si: row.force_pairing_sub_si || "",
    kitchen_note: row.kitchen_note || "",
    aperitif_btn: row.aperitif_btn || null,
    is_active: row.is_active !== false,
    restrictions,
  };
}

export function courseToSupabaseRow(course) {
  const restrictionColsSi = {};
  const restrictionNotes = {};
  const customEnglish = {};
  RESTRICTION_KEYS.forEach((key) => {
    if (course.restrictions?.[`${key}_si`]) restrictionColsSi[key] = course.restrictions[`${key}_si`];
    if (course.restrictions?.[`${key}_note`]) restrictionNotes[key] = course.restrictions[`${key}_note`];
    if (!RESTRICTION_COLUMN_MAP[key] && course.restrictions?.[key] != null) {
      customEnglish[`__en_${key}`] = course.restrictions[key];
    }
  });
  const restrictionsSi = (() => {
    const combined = { ...restrictionColsSi, ...customEnglish };
    Object.entries(restrictionNotes).forEach(([key, value]) => { combined[`${key}__note`] = value; });
    return Object.keys(combined).length ? combined : null;
  })();
  const result = {
    position: course.position,
    menu: course.menu,
    menu_si: course.menu_si,
    wp: course.wp,
    wp_si: course.wp_si,
    na: course.na,
    na_si: course.na_si,
    os: course.os,
    os_si: course.os_si,
    premium: course.premium,
    premium_si: course.premium_si,
    hazards: course.hazards,
    is_snack: course.is_snack,
    is_last_bite: course.is_last_bite === true,
    course_key: course.course_key,
    course_category: normalizeCourseCategory(course.course_category, course.optional_flag),
    optional_flag: course.optional_flag,
    optional_pairing_flag: course.optional_pairing_flag || "",
    optional_pairing_label: course.optional_pairing_label || "",
    optional_pairing_enabled: course.optional_pairing_enabled !== false,
    optional_pairing_default_on: course.optional_pairing_default_on !== false,
    optional_pairing_alco: course.optional_pairing_alco || null,
    optional_pairing_alco_si: course.optional_pairing_alco_si || null,
    optional_pairing_na: course.optional_pairing_na || null,
    optional_pairing_na_si: course.optional_pairing_na_si || null,
    section_gap_before: false,
    show_on_short: course.show_on_short,
    short_order: course.short_order,
    force_pairing_title: course.force_pairing_title,
    force_pairing_sub: course.force_pairing_sub,
    force_pairing_title_si: course.force_pairing_title_si,
    force_pairing_sub_si: course.force_pairing_sub_si,
    kitchen_note: course.kitchen_note,
    aperitif_btn: course.aperitif_btn,
    is_active: course.is_active !== false,
    restrictions_si: restrictionsSi,
  };
  // Same union as supabaseRowToCourse: every DB restriction column persists
  // even if the live vocabulary is stale/trimmed — otherwise a save from a
  // device with an incomplete vocabulary silently dropped allergy variants.
  new Set([...DIETARY_KEYS, ...Object.keys(RESTRICTION_COLUMN_MAP)]).forEach((key) => {
    const dbKey = RESTRICTION_COLUMN_MAP[key];
    if (dbKey) result[dbKey] = course.restrictions?.[key] ?? null;
  });
  return result;
}
