/**
 * UI-model glue for the MENU workspace.
 *
 * GENERATION LIVES IN ONE PLACE: generateMenuHTML (utils/menuGenerator.js) is
 * the app's single menu engine — templates, layout styles, drink queues,
 * pairing columns, optional-course filtering, per-seat overrides. This module
 * deliberately re-implements NONE of that. What it adds is the substitution
 * ATTRIBUTION layer: which restriction key caused the wording a seat receives
 * to differ from the master menu, and what the original wording was — so the
 * workspace can show "SUBSTITUTED FOR [X] — WAS: …" instead of silently
 * swapping words under the operator.
 *
 * Substitution itself is applyCourseRestriction() in menuUtils — the app's one
 * substitution engine (every storage form of a key, SI variants, allergy-
 * outranks-lifestyle priority). We call it, never copy it.
 */

import {
  applyCourseRestriction,
  restrictionPriorityKeys,
  RESTRICTION_COLUMN_TO_KEY,
} from "./menuUtils.js";
import { restrCompact } from "../constants/dietary.js";

/**
 * Stable identity for a course, matching the engine's key space: the same
 * normalization generateMenuHTML applies to template course keys, so a map of
 * one-time edits keyed with courseKeyOf() feeds seatOutputOverrides directly.
 */
export const courseKeyOf = (course, index = 0) => {
  const raw = String(course?.course_key || course?.menu?.name || "").trim().toLowerCase();
  const token = raw
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return token || `course_${index}`;
};

/** Display tag for a restriction key, e.g. "GLUTEN FREE". */
export const restrictionTag = (key) => String(restrCompact(key) || key).toUpperCase();

// The dish as authored, in the chosen language, before any restriction runs.
const baseCourse = (course, lang) =>
  (lang === "si" && course?.menu_si?.name) ? { ...course, menu: course.menu_si } : course;

const sameDish = (a, b) =>
  String(a?.name || "") === String(b?.name || "") && String(a?.sub || "") === String(b?.sub || "");

/**
 * Which active restriction is responsible for the substitution the guest sees,
 * plus the original wording.
 *
 * The engine applies EVERY active restriction (lowest priority first, so the
 * top-ranked one still wins each field it defines). For the red attribution
 * line we re-run the keys in isolation, top priority first: the first key that
 * alone changes the dish is the one the combined pass let win, so it is the
 * key the "SUBSTITUTED FOR […]" line must name.
 *
 * Returns null when the seat's restrictions leave this course unchanged,
 * otherwise { key, tag, wasName, wasSub }.
 */
export function substitutionAttribution(course, restrictionKeys = [], lang = "en") {
  const resolved = baseCourse(course, lang);
  const base = {
    name: String(resolved?.menu?.name || "").trim(),
    sub: String(resolved?.menu?.sub || "").trim(),
  };
  const applied = applyCourseRestriction(resolved, restrictionKeys, lang) || base;
  if (sameDish(applied, base)) return null;

  const active = new Set((restrictionKeys || []).map((k) => RESTRICTION_COLUMN_TO_KEY[k] || k));
  let key = null;
  for (const candidate of restrictionPriorityKeys()) {
    if (!active.has(RESTRICTION_COLUMN_TO_KEY[candidate] || candidate)) continue;
    const alone = applyCourseRestriction(resolved, [candidate], lang);
    if (alone && !sameDish(alone, base)) { key = candidate; break; }
  }

  return {
    key,
    tag: key ? restrictionTag(key) : "",
    wasName: base.name,
    wasSub: base.sub,
  };
}

const MONTHS_EN = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const MONTHS_SI = ["januar", "februar", "marec", "april", "maj", "junij",
  "julij", "avgust", "september", "oktober", "november", "december"];

/** Pre-filled MENU TITLE when nothing is stored yet, per language and date. */
export function defaultMenuTitle(lang = "en", date = new Date()) {
  const d = date.getDate();
  if (lang === "si") return `MENI · ${d}. ${MONTHS_SI[date.getMonth()]} ${date.getFullYear()}`;
  return `MENU · ${d} ${MONTHS_EN[date.getMonth()]} ${date.getFullYear()}`;
}

/** Pre-filled THANK-YOU LINE when nothing is stored yet, per language. */
export const defaultThankYou = (lang = "en") =>
  lang === "si" ? "Hvala za vaš obisk." : "Thank you for dining with us.";
