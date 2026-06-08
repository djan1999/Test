/**
 * menuLayoutProfiles.js — unified, row-based layout profile system.
 *
 * A profile wraps the existing MenuTemplateEditor row-based menuTemplate
 * (header / aperitif / course / drink / pairing-label / divider / spacer /
 * goodbye / team rows) with metadata: a name, a `target` ("guest_menu"),
 * and the matching layoutStyles.
 *
 * Profile shape (single source of truth — no separate flat layout system):
 *
 *   {
 *     id,
 *     name,
 *     target: "guest_menu",
 *     menuTemplate: { version: 2, rows: [...] },
 *     layoutStyles: { ... },
 *   }
 *
 * Persistence — service_settings.menu_layout_profiles_v2:
 *
 *   {
 *     profiles: [profile, ...],
 *     assignments: {
 *       longMenuProfileId,   // the single "active / printed" guest profile
 *       shortMenuProfileId,  // retired — always null (kept for shape/back-compat)
 *     },
 *     activeProfileId,
 *   }
 *
 * `longMenuProfileId` selects the live profile. Each profile owns BOTH its long
 * (`menuTemplate`) and short (`shortMenuTemplate`) version; the print path reads
 * whichever matches the table's menuType, plus `profile.layoutStyles`.
 */

import { buildDefaultTemplate } from "./menuTemplateSchema.js";

export const PROFILE_TARGETS = ["guest_menu"];

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

export function makeProfile({ name, target = "guest_menu", menuTemplate = null, shortMenuTemplate = null, layoutStyles = {} } = {}) {
  return {
    id: makeProfileId(),
    name: String(name || "Untitled Profile"),
    target: normalizeTarget(target),
    menuTemplate: menuTemplate || null,
    shortMenuTemplate: shortMenuTemplate || null,
    layoutStyles: layoutStyles && typeof layoutStyles === "object" ? layoutStyles : {},
  };
}

/**
 * Seed the two default profiles and matching assignments from menuCourses.
 *
 * Long guest:  full active course list via buildDefaultTemplate.
 * Short guest: active courses with show_on_short truthy (legacy migration only),
 *              ordered by short_order falling back to position; if no course
 *              is flagged we duplicate the long template so the short slot
 *              isn't empty.
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

  const guestProfile = makeProfile({
    name: "Default Menu",
    target: "guest_menu",
    menuTemplate: buildDefaultTemplate(longSorted),
    shortMenuTemplate: buildDefaultTemplate(shortSorted),
    layoutStyles: {},
  });

  return {
    profiles: [guestProfile],
    assignments: {
      longMenuProfileId:  guestProfile.id,
      shortMenuProfileId: null,
    },
    activeProfileId: guestProfile.id,
  };
}

const ASSIGNMENT_SLOTS = [
  "longMenuProfileId",
  "shortMenuProfileId",
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
      shortMenuTemplate: p.shortMenuTemplate && typeof p.shortMenuTemplate === "object" ? p.shortMenuTemplate : null,
      // Kitchen ticket layouts live alongside the guest-menu templates on the
      // same profile. Both have to be preserved here — sanitize runs on every
      // profile-level admin action AND on every load, so anything not copied
      // is silently destroyed the next time the user touches profile manager.
      ticketTemplate: p.ticketTemplate && typeof p.ticketTemplate === "object" ? p.ticketTemplate : null,
      shortTicketTemplate: p.shortTicketTemplate && typeof p.shortTicketTemplate === "object" ? p.shortTicketTemplate : null,
      layoutStyles: p.layoutStyles && typeof p.layoutStyles === "object" ? p.layoutStyles : {},
    }));

  const a = raw?.assignments || {};

  // Long slot = the single "active / printed" guest profile. Each profile owns
  // BOTH its long (`menuTemplate`) and short (`shortMenuTemplate`) versions, so
  // one slot is all that's needed. Falls back to the first guest profile when
  // unset/invalid so there is always a live menu.
  const matchingGuest = profiles.filter(p => p.target === "guest_menu");
  const longMenuId = (() => {
    if (a.longMenuProfileId) {
      const found = matchingGuest.find(p => p.id === a.longMenuProfileId);
      if (found) return found.id;
    }
    return matchingGuest[0]?.id ?? null;
  })();

  // ── Retire the separate short-menu profile slot ──────────────────────────
  // The short menu now lives INSIDE the active profile as `shortMenuTemplate`,
  // edited via the LONG/SHORT toggle. If an older payload still points the
  // short slot at a DISTINCT profile, fold that profile's template into the
  // active profile's shortMenuTemplate — but only when that slot is empty, so a
  // real short layout is never clobbered — then drop the assignment so the dead
  // slot can't resurface. This is idempotent: once migrated, the short slot is
  // null and the active short template is non-empty, so it never runs again.
  const isEmptyTemplate = (t) => !t || !Array.isArray(t.rows) || t.rows.length === 0;
  const legacyShortId = a.shortMenuProfileId;
  if (legacyShortId && legacyShortId !== longMenuId) {
    const longProfile = profiles.find(p => p.id === longMenuId);
    const shortProfile = profiles.find(p => p.id === legacyShortId && p.target === "guest_menu");
    if (longProfile && shortProfile && isEmptyTemplate(longProfile.shortMenuTemplate)) {
      const source = !isEmptyTemplate(shortProfile.shortMenuTemplate)
        ? shortProfile.shortMenuTemplate
        : shortProfile.menuTemplate;
      if (!isEmptyTemplate(source)) {
        longProfile.shortMenuTemplate = cloneTemplate(source);
      }
    }
  }

  const assignments = {
    longMenuProfileId:  longMenuId,
    // Retired — always null now. Kept in the shape for backward-compat with the
    // assignment helpers and any stored payloads that still carry the key.
    shortMenuProfileId: null,
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
 * Pick the guest_menu profile assigned to a given menu type.
 *   menuType: "short" → short slot, anything else → long slot
 */
export function getAssignedProfile(menuType, profiles = [], assignments = {}, target = "guest_menu") {
  const list = Array.isArray(profiles) ? profiles : [];
  if (list.length === 0) return null;
  const isShort = String(menuType || "").trim().toLowerCase() === "short";
  const slot = isShort ? "shortMenuProfileId" : "longMenuProfileId";
  const id = assignments?.[slot];
  const found = list.find(p => p.id === id);
  if (!found || found.target !== target) return null;
  return found;
}

export const getAssignedGuestProfile = (menuType, profiles, assignments) =>
  getAssignedProfile(menuType, profiles, assignments, "guest_menu");

// ── Profile management ────────────────────────────────────────────────────────

export function duplicateProfile(profile, nextName) {
  if (!profile) return null;
  return {
    id: makeProfileId(),
    name: nextName || `${profile.name || "Profile"} (copy)`,
    target: normalizeTarget(profile.target),
    menuTemplate: cloneTemplate(profile.menuTemplate),
    shortMenuTemplate: profile.shortMenuTemplate ? cloneTemplate(profile.shortMenuTemplate) : null,
    // Kitchen ticket layouts must be cloned too — otherwise duplicating a
    // profile silently drops its ticket layouts, matching the same data-loss
    // pattern that wiped them via sanitize.
    ticketTemplate: profile.ticketTemplate ? cloneTemplate(profile.ticketTemplate) : null,
    shortTicketTemplate: profile.shortTicketTemplate ? cloneTemplate(profile.shortTicketTemplate) : null,
    layoutStyles: profile.layoutStyles ? { ...profile.layoutStyles } : {},
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

// ── Short menu template builders ─────────────────────────────────────────────

/**
 * Build a guest-menu template seeded from courses flagged show_on_short.
 * Used by the Admin "Sync" button and initial profile creation.
 * Falls back to all active courses when no course is flagged.
 */
export function buildShortMenuTemplateFromCourses(menuCourses = []) {
  const courses = Array.isArray(menuCourses) ? menuCourses : [];
  const active = courses.filter(c => c?.is_active !== false && !c?.is_snack && c?.course_key);
  const shortFlagged = active.filter(c => isTruthyShortFlag(c.show_on_short));
  const base = shortFlagged.length > 0 ? shortFlagged : active;
  const sorted = [...base].sort((a, b) => {
    const aOrd = Number(a.short_order);
    const bOrd = Number(b.short_order);
    const aKey = Number.isFinite(aOrd) ? aOrd : 9999;
    const bKey = Number.isFinite(bOrd) ? bOrd : 9999;
    if (aKey !== bKey) return aKey - bKey;
    return (Number(a.position) || 0) - (Number(b.position) || 0);
  });
  return buildDefaultTemplate(sorted);
}

/**
 * Return the sorted course list that would be used for the short menu.
 * Useful for previewing which courses will appear on the short menu profile
 * before committing a sync.
 */
export function getShortMenuCourseList(menuCourses = []) {
  const courses = Array.isArray(menuCourses) ? menuCourses : [];
  const active = courses.filter(c => c?.is_active !== false && !c?.is_snack && c?.course_key);
  const shortFlagged = active.filter(c => isTruthyShortFlag(c.show_on_short));
  const base = shortFlagged.length > 0 ? shortFlagged : active;
  return [...base].sort((a, b) => {
    const aOrd = Number(a.short_order);
    const bOrd = Number(b.short_order);
    const aKey = Number.isFinite(aOrd) ? aOrd : 9999;
    const bKey = Number.isFinite(bOrd) ? bOrd : 9999;
    if (aKey !== bKey) return aKey - bKey;
    return (Number(a.position) || 0) - (Number(b.position) || 0);
  });
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
