/**
 * menuLayoutProfiles.js — unified, row-based layout profile system.
 *
 * A profile wraps the existing MenuTemplateEditor row-based menuTemplate
 * (header / aperitif / course / drink / pairing-label / divider / spacer /
 * goodbye / team rows) with metadata: a name, a `target` ("guest_menu" or
 * "kitchen_flow"), and the matching layoutStyles.
 *
 * Profile shape (single source of truth — no separate flat layout system):
 *
 *   {
 *     id,
 *     name,
 *     target: "guest_menu" | "kitchen_flow",
 *     menuTemplate: { version: 2, rows: [...] },
 *     layoutStyles: { ... },
 *   }
 *
 * Persistence — service_settings.menu_layout_profiles_v2:
 *
 *   {
 *     profiles: [profile, ...],
 *     assignments: {
 *       longMenuProfileId,
 *       shortMenuProfileId,
 *       longKitchenProfileId,
 *       shortKitchenProfileId,
 *     },
 *     activeProfileId,
 *   }
 *
 * Long Menu / Short Menu / Long Kitchen / Short Kitchen each pick a profile;
 * the print path reads `profile.menuTemplate` + `profile.layoutStyles`,
 * the kitchen path reads course keys from `profile.menuTemplate` via
 * `deriveCourseKeysFromTemplate`.
 */

import { buildDefaultTemplate } from "./menuTemplateSchema.js";
import { buildDefaultTicketTemplate } from "./kitchenTicketSchema.js";

export const PROFILE_TARGETS = ["guest_menu", "kitchen_flow"];

const isTruthyShortFlag = (value) => {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "y" || v === "x" || v === "wahr";
};

let _seq = 0;
export function makeProfileId() {
  _seq += 1;
  return `profile_${Date.now().toString(36)}_${_seq}`;
}

const normalizeTarget = (t) => (PROFILE_TARGETS.includes(t) ? t : "guest_menu");

const cloneTemplate = (tpl) => {
  if (!tpl || typeof tpl !== "object") return null;
  const rows = Array.isArray(tpl.rows) ? tpl.rows.map(row => ({
    ...row,
    id: `row_${Date.now().toString(36)}_${++_seq}`,
    left: row.left ? { ...row.left } : null,
    right: row.right ? { ...row.right } : null,
  })) : [];
  return { ...tpl, version: tpl.version || 2, rows };
};

export function makeProfile({ name, target = "guest_menu", menuTemplate = null, layoutStyles = {} } = {}) {
  return {
    id: makeProfileId(),
    name: String(name || "Untitled Profile"),
    target: normalizeTarget(target),
    menuTemplate: menuTemplate || null,
    layoutStyles: layoutStyles && typeof layoutStyles === "object" ? layoutStyles : {},
  };
}

/**
 * Build a kitchen-flow template that contains only course rows for the given
 * courses. Header / drinks / pairing-label / goodbye / team rows are dropped
 * because the kitchen flow doesn't need them — KitchenBoard / SheetView only
 * read course keys from rows.
 *
 * Each course row sets the kitchen-side overlay defaults so per-course
 * kitchenDisplayName / showRestrictions / showPairingAlert / showSeatNotes /
 * showCourseNotes can be overridden in the editor.
 */
function buildKitchenTemplate(menuCourses = []) {
  const sorted = [...menuCourses].sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
  const rows = sorted.map((c, i) => ({
    id: `row_kitchen_${c.course_key || i}_${++_seq}`,
    left: {
      type: "course",
      courseKey: c.course_key || "",
      showPairing: false,
      kitchenDisplayName: "",
      showRestrictions: true,
      showPairingAlert: true,
      showSeatNotes: true,
      showCourseNotes: true,
    },
    right: null,
    widthPreset: "100/0",
    gap: 0,
  }));
  return { version: 2, rows };
}

/**
 * Seed the four default profiles and matching assignments from menuCourses.
 *
 * Long guest:    full active course list via buildDefaultTemplate.
 * Short guest:   active courses with show_on_short truthy (legacy migration only),
 *                ordered by short_order falling back to position; if no course
 *                is flagged we duplicate the long template so the short slot
 *                isn't empty.
 * Long kitchen:  course-only rows for every active course in position order.
 * Short kitchen: course-only rows for the same short-flagged courses.
 *
 * After this seeds the profile list, the user is expected to edit/rename
 * profiles in Admin — `show_on_short` / `short_order` are only consulted on
 * this initial seed.
 */
export function createDefaultProfiles(menuCourses = []) {
  const courses = Array.isArray(menuCourses) ? menuCourses : [];
  const active = courses.filter(c => c?.is_active !== false && !c?.is_snack && c?.course_key);

  const longSorted = [...active].sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
  const shortFlagged = active.filter(c => isTruthyShortFlag(c.show_on_short));
  const shortSorted = [...(shortFlagged.length > 0 ? shortFlagged : active)].sort((a, b) => {
    const aOrd = Number(a.short_order);
    const bOrd = Number(b.short_order);
    const aKey = Number.isFinite(aOrd) ? aOrd : 9999;
    const bKey = Number.isFinite(bOrd) ? bOrd : 9999;
    if (aKey !== bKey) return aKey - bKey;
    return (Number(a.position) || 0) - (Number(b.position) || 0);
  });

  const longGuest = makeProfile({
    name: "Default Long Menu",
    target: "guest_menu",
    menuTemplate: buildDefaultTemplate(longSorted),
    layoutStyles: {},
  });
  const shortGuest = makeProfile({
    name: "Default Short Menu",
    target: "guest_menu",
    menuTemplate: buildDefaultTemplate(shortSorted),
    layoutStyles: {},
  });
  const longKitchen = {
    ...makeProfile({
      name: "Default Long Kitchen",
      target: "kitchen_flow",
      menuTemplate: buildKitchenTemplate(longSorted),
      layoutStyles: {},
    }),
    ticketTemplate: buildDefaultTicketTemplate(),
  };
  const shortKitchen = {
    ...makeProfile({
      name: "Default Short Kitchen",
      target: "kitchen_flow",
      menuTemplate: buildKitchenTemplate(shortSorted),
      layoutStyles: {},
    }),
    ticketTemplate: buildDefaultTicketTemplate(),
  };

  return {
    profiles: [longGuest, shortGuest, longKitchen, shortKitchen],
    assignments: {
      longMenuProfileId:    longGuest.id,
      shortMenuProfileId:   shortGuest.id,
      longKitchenProfileId: longKitchen.id,
      shortKitchenProfileId:shortKitchen.id,
    },
    activeProfileId: longGuest.id,
  };
}

const ASSIGNMENT_SLOTS = [
  "longMenuProfileId",
  "shortMenuProfileId",
  "longKitchenProfileId",
  "shortKitchenProfileId",
];

/**
 * Sanitize a stored payload, repairing where possible:
 *   - v2 with profiles → use as-is, normalize target/fields
 *   - legacy v1 ({ profiles: [...], activeId }) without `target` →
 *     all profiles become target="guest_menu"
 *   - drops profiles that are missing menuTemplate
 *   - assignment slots that point to missing or wrong-target profiles are
 *     re-pointed to the first matching profile, or set null if none exist
 */
export function sanitizeProfilesPayload(raw) {
  const profilesIn = Array.isArray(raw?.profiles) ? raw.profiles : [];
  const profiles = profilesIn
    .filter(p => p && typeof p === "object")
    .map((p, idx) => ({
      id: String(p.id || makeProfileId()),
      name: String(p.name || `Profile ${idx + 1}`),
      target: normalizeTarget(p.target),
      menuTemplate: p.menuTemplate && typeof p.menuTemplate === "object" ? p.menuTemplate : null,
      layoutStyles: p.layoutStyles && typeof p.layoutStyles === "object" ? p.layoutStyles : {},
      ticketTemplate: p.ticketTemplate && typeof p.ticketTemplate === "object" ? p.ticketTemplate : null,
    }));

  const a = raw?.assignments || {};

  const pickValid = (slotId, target, idx) => {
    if (slotId) {
      const found = profiles.find(p => p.id === slotId);
      if (found && found.target === target) return slotId;
    }
    const matching = profiles.filter(p => p.target === target);
    if (matching.length === 0) return null;
    return matching[idx]?.id || matching[0].id;
  };

  const assignments = {
    longMenuProfileId:     pickValid(a.longMenuProfileId,     "guest_menu",   0),
    shortMenuProfileId:    pickValid(a.shortMenuProfileId,    "guest_menu",   1),
    longKitchenProfileId:  pickValid(a.longKitchenProfileId,  "kitchen_flow", 0),
    shortKitchenProfileId: pickValid(a.shortKitchenProfileId, "kitchen_flow", 1),
  };

  const activeProfileId = (() => {
    const a2 = raw?.activeProfileId || raw?.activeId;
    if (a2 && profiles.some(p => p.id === a2)) return a2;
    return profiles[0]?.id || null;
  })();

  return { profiles, assignments, activeProfileId };
}

/**
 * Coerce an old v1 payload ({ profiles:[{id,name,layoutStyles,menuTemplate}], activeId })
 * into a v2-shaped object. Each profile gets target="guest_menu". Caller
 * should still pass the result through sanitizeProfilesPayload to fill in
 * default assignments.
 */
export function migrateV1ToV2(v1Payload) {
  const profiles = Array.isArray(v1Payload?.profiles) ? v1Payload.profiles.map(p => ({
    id: p.id,
    name: p.name,
    target: "guest_menu",
    menuTemplate: p.menuTemplate || null,
    layoutStyles: p.layoutStyles || {},
  })) : [];
  return { profiles, assignments: {}, activeProfileId: v1Payload?.activeId || profiles[0]?.id || null };
}

/** Migrate the legacy single-profile keys (menu_layout_global + menu_layout_v2). */
export function migrateLegacySingleLayout(legacyLayout, legacyTemplate) {
  const profile = makeProfile({
    name: "Layout 1",
    target: "guest_menu",
    menuTemplate: legacyTemplate || null,
    layoutStyles: legacyLayout || {},
  });
  return { profiles: [profile], assignments: {}, activeProfileId: profile.id };
}

// ── Lookup helpers ────────────────────────────────────────────────────────────

/**
 * Pick the profile assigned to a given menu type & target.
 *   menuType: "short" → short slot, anything else → long slot
 *   target:   "guest_menu" (default) | "kitchen_flow"
 */
export function getAssignedProfile(menuType, profiles = [], assignments = {}, target = "guest_menu") {
  const list = Array.isArray(profiles) ? profiles : [];
  if (list.length === 0) return null;
  const isShort = String(menuType || "").trim().toLowerCase() === "short";
  const slot = (() => {
    if (target === "kitchen_flow") return isShort ? "shortKitchenProfileId" : "longKitchenProfileId";
    return isShort ? "shortMenuProfileId" : "longMenuProfileId";
  })();
  const id = assignments?.[slot];
  const found = list.find(p => p.id === id);
  if (!found || found.target !== target) return null;
  return found;
}

export const getAssignedGuestProfile   = (menuType, profiles, assignments) =>
  getAssignedProfile(menuType, profiles, assignments, "guest_menu");
export const getAssignedKitchenProfile = (menuType, profiles, assignments) =>
  getAssignedProfile(menuType, profiles, assignments, "kitchen_flow");

// ── Profile management ────────────────────────────────────────────────────────

export function duplicateProfile(profile, nextName) {
  if (!profile) return null;
  return {
    id: makeProfileId(),
    name: nextName || `${profile.name || "Profile"} (copy)`,
    target: normalizeTarget(profile.target),
    menuTemplate: cloneTemplate(profile.menuTemplate),
    layoutStyles: profile.layoutStyles ? { ...profile.layoutStyles } : {},
    ticketTemplate: profile.ticketTemplate ? cloneTemplate(profile.ticketTemplate) : null,
  };
}

export function renameProfile(profiles, id, nextName) {
  return (profiles || []).map(p =>
    p.id === id ? { ...p, name: String(nextName || "").trim() || p.name } : p
  );
}

export function setProfileTarget(profiles, id, target) {
  const t = normalizeTarget(target);
  return (profiles || []).map(p => (p.id === id ? { ...p, target: t } : p));
}

export function isProfileAssigned(id, assignments = {}) {
  return ASSIGNMENT_SLOTS.some(slot => assignments?.[slot] === id);
}

export function getProfileAssignmentRoles(id, assignments = {}) {
  return ASSIGNMENT_SLOTS.filter(slot => assignments?.[slot] === id);
}

/**
 * Deletion is blocked when the profile is currently assigned, or when removing
 * it would leave its target with zero profiles (the assignment dropdowns need
 * at least one to point at).
 */
export function canDeleteProfile(id, profiles = [], assignments = {}) {
  const list = Array.isArray(profiles) ? profiles : [];
  if (list.length <= 1) return false;
  if (isProfileAssigned(id, assignments)) return false;
  const target = list.find(p => p.id === id)?.target || "guest_menu";
  const remainingForTarget = list.filter(p => p.id !== id && p.target === target);
  if (remainingForTarget.length === 0) return false;
  return true;
}

// ── Kitchen flow translation ──────────────────────────────────────────────────

/**
 * Walk a row-based menuTemplate and return ordered course keys, deduplicated.
 * Used by KitchenBoard / SheetView to translate an assigned kitchen profile
 * (or any guest profile) into operational course order.
 *
 * Rules (per the brief):
 *   - inspect both `left` and `right` blocks of every row
 *   - collect blocks where block.type === "course" and block.courseKey is set
 *   - skip duplicates (a course should fire once per service)
 *   - ignore title, logo, drinks, text, divider, spacer/gap, team, goodbye, etc.
 */
export function deriveCourseKeysFromTemplate(menuTemplate) {
  const rows = Array.isArray(menuTemplate?.rows) ? menuTemplate.rows : [];
  const out = [];
  const seen = new Set();
  rows.forEach(row => {
    [row?.left, row?.right].forEach(block => {
      if (!block || block.type !== "course") return;
      const key = String(block.courseKey || "").trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      out.push(key);
    });
  });
  return out;
}

/**
 * Walk a template and return per-courseKey kitchen overlay options:
 *   { kitchenDisplayName, showRestrictions, showPairingAlert,
 *     showSeatNotes, showCourseNotes }
 *
 * Defaults for missing flags: all `show*` flags default to true,
 * `kitchenDisplayName` defaults to "".
 */
export function deriveKitchenItemsFromTemplate(menuTemplate) {
  const rows = Array.isArray(menuTemplate?.rows) ? menuTemplate.rows : [];
  const out = {};
  rows.forEach(row => {
    [row?.left, row?.right].forEach(block => {
      if (!block || block.type !== "course") return;
      const key = String(block.courseKey || "").trim();
      if (!key || out[key]) return;
      out[key] = {
        kitchenDisplayName: String(block.kitchenDisplayName || ""),
        showRestrictions: block.showRestrictions !== false,
        showPairingAlert: block.showPairingAlert !== false,
        showSeatNotes:    block.showSeatNotes    !== false,
        showCourseNotes:  block.showCourseNotes  !== false,
      };
    });
  });
  return out;
}
