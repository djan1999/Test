/**
 * Per-SEAT menu plan — the model behind the MENU workspace.
 *
 * A printed menu belongs to a seat, not to a table: two guests sharing a table
 * with different restrictions get different sheets from one generate action.
 * This module turns (courses × one seat's restriction keys × print options)
 * into the exact list of lines that seat will receive, and — crucially — keeps
 * the PROVENANCE of every substitution so the workspace can show what was
 * replaced instead of silently swapping wording under the operator.
 *
 * Substitution itself is NOT reimplemented here. applyCourseRestriction() in
 * menuUtils is the app's one substitution engine and already handles every
 * storage form of a restriction key, the SI variants, and allergy-outranks-
 * lifestyle priority. This module calls it and adds the attribution layer.
 *
 * Note on priority: the spec this screen was built from says "first matching
 * restriction wins". The app's engine deliberately applies EVERY active
 * restriction (lowest priority first, so the top-ranked one still wins each
 * field it defines) — a guest who is both shellfish-allergic and eats no pork
 * must get both substitutions, not just the first. We keep the app's engine
 * and attribute the visible change to the highest-priority key that produces
 * one, which is the key the guest's ticket needs to carry.
 */

import {
  applyCourseRestriction,
  resolveSeatRestrictionKeys,
  restrictionPriorityKeys,
  RESTRICTION_COLUMN_TO_KEY,
} from "./menuUtils.js";
import { restrCompact } from "../constants/dietary.js";

/** Pairing set label → the course column holding that set's drink. */
export const PAIRING_SETS = [
  { key: "Wine", label: "WINE", col: "wp" },
  { key: "Non-Alc", label: "NON-ALCOHOLIC", col: "na" },
  { key: "Premium", label: "PREMIUM", col: "premium" },
  { key: "Our Story", label: "OUR STORY", col: "os" },
];

export const pairingSetLabel = (key) =>
  PAIRING_SETS.find((p) => p.key === key)?.label || "";

const pairingColumn = (key) => PAIRING_SETS.find((p) => p.key === key)?.col || null;

/** Stable identity for a course, matching the key space the templates use. */
export const courseKeyOf = (course, index = 0) => {
  const raw = String(course?.course_key || course?.menu?.name || "").trim().toLowerCase();
  const token = raw
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return token || `course_${index}`;
};

/** The seat's restriction keys — assigned to this seat, plus table-wide ones. */
export const seatRestrictionKeys = (restrictions, seatId) =>
  resolveSeatRestrictionKeys(restrictions, seatId);

/** Display tag for a restriction key, e.g. "GLUTEN FREE". */
export const restrictionTag = (key) => String(restrCompact(key) || key).toUpperCase();

// The dish as authored, in the chosen language, before any restriction runs.
const baseCourse = (course, lang) =>
  (lang === "si" && course?.menu_si?.name) ? { ...course, menu: course.menu_si } : course;

const sameDish = (a, b) =>
  String(a?.name || "") === String(b?.name || "") && String(a?.sub || "") === String(b?.sub || "");

/**
 * Which active restriction is responsible for the substitution the guest sees.
 *
 * Applied in isolation, top priority first: the first key that alone changes
 * the dish is the one the engine's combined pass let win, so it is the key the
 * "SUBSTITUTED FOR […]" line must name.
 */
const attributeSubstitution = (course, activeKeys, lang, base) => {
  const active = new Set((activeKeys || []).map((k) => RESTRICTION_COLUMN_TO_KEY[k] || k));
  for (const key of restrictionPriorityKeys()) {
    if (!active.has(RESTRICTION_COLUMN_TO_KEY[key] || key)) continue;
    const alone = applyCourseRestriction(course, [key], lang);
    if (alone && !sameDish(alone, base)) return key;
  }
  return null;
};

/** The grey pairing line under a course, for the selected pairing set. */
const pairingLineFor = (course, pairingSet, lang) => {
  const col = pairingColumn(pairingSet);
  if (!col) return null;
  const drink = (lang === "si" ? (course?.[`${col}_si`] || course?.[col]) : course?.[col]) || null;
  const name = String(drink?.name || "").trim();
  const sub = String(drink?.sub || "").trim();
  if (!name && !sub) return null;
  return [name, sub].filter(Boolean).join(" · ");
};

/**
 * Build one seat's course list.
 *
 * `edits` is that seat's one-time edit map, `{ [courseKey]: { name } }` — the
 * edits are scoped to seat + course and never touch the master menu.
 *
 * Every course in `courses` produces a row. A restriction with no rule for a
 * course prints the course unchanged: dropping it would take a plate away from
 * a guest with no trace on the sheet, so the red tag on the ticket carries the
 * warning instead.
 */
export function buildSeatCourses({
  courses = [],
  restrictionKeys = [],
  lang = "en",
  pairingSet = "",
  edits = {},
} = {}) {
  return (courses || []).map((course, i) => {
    const key = courseKeyOf(course, i);
    const resolved = baseCourse(course, lang);
    const base = {
      name: String(resolved?.menu?.name || "").trim(),
      sub: String(resolved?.menu?.sub || "").trim(),
    };
    const applied = applyCourseRestriction(resolved, restrictionKeys, lang) || base;
    const substituted = !sameDish(applied, base);
    const substitutedFor = substituted
      ? attributeSubstitution(resolved, restrictionKeys, lang, base)
      : null;

    const edit = edits?.[key] || null;
    const editedName = typeof edit?.name === "string" ? edit.name.trim() : "";
    const edited = editedName.length > 0 && editedName !== applied.name;

    return {
      index: i + 1,
      courseKey: key,
      name: edited ? editedName : applied.name,
      sub: applied.sub,
      substituted,
      substitutedFor,
      substitutedForTag: substitutedFor ? restrictionTag(substitutedFor) : "",
      wasName: base.name,
      wasSub: base.sub,
      edited,
      pairing: pairingLineFor(course, pairingSet, lang),
    };
  });
}

/**
 * The full print model for one seat — everything the printed page needs and
 * nothing that depends on React state.
 */
export function buildSeatMenu({
  seat,
  seatNumber,
  seatCount,
  restrictions = [],
  courses = [],
  lang = "en",
  pairingSet = "",
  menuTitle = "",
  thankYou = "",
  aperitif = "",
  edits = {},
  wordmark = "",
} = {}) {
  const keys = seatRestrictionKeys(restrictions, seat?.id);
  return {
    seatId: seat?.id ?? null,
    seatNumber,
    seatCount,
    restrictionKeys: keys,
    restrictionTags: keys.map(restrictionTag),
    courses: buildSeatCourses({ courses, restrictionKeys: keys, lang, pairingSet, edits }),
    lang,
    pairingSet,
    pairingSetLabel: pairingSetLabel(pairingSet),
    menuTitle: String(menuTitle || "").trim(),
    thankYou: String(thankYou || "").trim(),
    aperitif: String(aperitif || "").trim(),
    wordmark: String(wordmark || "").trim(),
  };
}

const MONTHS_EN = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const MONTHS_SI = ["januar", "februar", "marec", "april", "maj", "junij",
  "julij", "avgust", "september", "oktober", "november", "december"];

/** Pre-filled MENU TITLE, per language and service date. */
export function defaultMenuTitle(lang = "en", date = new Date()) {
  const d = date.getDate();
  if (lang === "si") return `MENI · ${d}. ${MONTHS_SI[date.getMonth()]} ${date.getFullYear()}`;
  return `MENU · ${d} ${MONTHS_EN[date.getMonth()]} ${date.getFullYear()}`;
}

/** Pre-filled THANK-YOU LINE, per language. */
export const defaultThankYou = (lang = "en") =>
  lang === "si" ? "Hvala za vaš obisk." : "Thank you for dining with us.";
