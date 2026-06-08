/**
 * localStorage helpers for the Milka Service Board.
 * All reads return null/default on error so a corrupted entry never crashes the app.
 *
 * Workspace-specific caches are namespaced per workspace via `wsKey()` so that
 * switching restaurants never shows the previous restaurant's cached board,
 * beverages or menu text. In local-only mode (no Supabase, no workspace) the
 * original un-namespaced keys are used for backward compatibility.
 */

import { getWorkspaceId } from "../lib/supabaseClient.js";

const wsKey = (base) => {
  const ws = getWorkspaceId();
  return ws ? `${base}:${ws}` : base;
};

export const BEV_STORAGE_KEY = "milka-beverages-v1";
const DEFAULT_TEAM_NAMES_FROM_ENV = String(import.meta.env.VITE_DEFAULT_TEAM_NAMES || "").trim();

export function readLocalBeverages() {
  try {
    const raw = localStorage.getItem(wsKey(BEV_STORAGE_KEY));
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

export function writeLocalBeverages(bev) {
  try { localStorage.setItem(wsKey(BEV_STORAGE_KEY), JSON.stringify(bev)); } catch {}
}

export const TEAM_STORAGE_KEY = "milka-menu-team-v2";
export const DEFAULT_TEAM_NAMES = DEFAULT_TEAM_NAMES_FROM_ENV;

export function readTeamNames() {
  if (typeof window === "undefined") return DEFAULT_TEAM_NAMES || "";
  try {
    const raw = window.localStorage.getItem(wsKey(TEAM_STORAGE_KEY));
    // null means the key was never set → fall back to the env default.
    // An empty string means the user deliberately cleared the field → respect it.
    return raw !== null ? raw : (DEFAULT_TEAM_NAMES || "");
  } catch {
    return DEFAULT_TEAM_NAMES || "";
  }
}

export function writeTeamNames(value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(wsKey(TEAM_STORAGE_KEY), value ?? "");
  } catch {}
}

export const MENU_TITLE_EN_KEY = "milka-menu-title-en-v1";
export const MENU_TITLE_SI_KEY = "milka-menu-title-si-v1";
export const THANK_YOU_EN_KEY  = "milka-thankyou-en-v1";
export const THANK_YOU_SI_KEY  = "milka-thankyou-si-v1";

export function readMenuTitle(lang) {
  const key = lang === "si" ? MENU_TITLE_SI_KEY : MENU_TITLE_EN_KEY;
  if (typeof window === "undefined") return "";
  try { return window.localStorage.getItem(wsKey(key)) ?? ""; } catch { return ""; }
}

export function writeMenuTitle(lang, value) {
  if (typeof window === "undefined") return;
  const key = lang === "si" ? MENU_TITLE_SI_KEY : MENU_TITLE_EN_KEY;
  try { window.localStorage.setItem(wsKey(key), value || ""); } catch {}
}

export function readThankYouNote(lang) {
  const key = lang === "si" ? THANK_YOU_SI_KEY : THANK_YOU_EN_KEY;
  if (typeof window === "undefined") return "";
  try { return window.localStorage.getItem(wsKey(key)) ?? ""; } catch { return ""; }
}

export function writeThankYouNote(lang, value) {
  if (typeof window === "undefined") return;
  const key = lang === "si" ? THANK_YOU_SI_KEY : THANK_YOU_EN_KEY;
  try { window.localStorage.setItem(wsKey(key), value || ""); } catch {}
}

export const STORAGE_KEY = "milka-service-board-v8";

export const readLocalBoardState = () => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(wsKey(STORAGE_KEY));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

export const writeLocalBoardState = state => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(wsKey(STORAGE_KEY), JSON.stringify(state));
  } catch {}
};

// ── Menu courses cache ────────────────────────────────────────────────────────
// Courses are the spine of the menu/board, but were never cached — so every
// launch started with an empty list and blocked on the network. Caching them
// per workspace lets the device paint instantly from its last-known courses and
// refresh in the background (or on a realtime change).
export const MENU_COURSES_KEY = "milka-menu-courses-v1";

export function readLocalMenuCourses() {
  try {
    const raw = localStorage.getItem(wsKey(MENU_COURSES_KEY));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

export function writeLocalMenuCourses(courses) {
  try {
    localStorage.setItem(wsKey(MENU_COURSES_KEY), JSON.stringify(Array.isArray(courses) ? courses : []));
  } catch {}
}

// ── Wines cache ───────────────────────────────────────────────────────────────
// Wines live in their own table (website sync is the source of truth) and were
// not part of the board-state cache, so they also started empty each launch.
export const WINES_KEY = "milka-wines-v1";

export function readLocalWines() {
  try {
    const raw = localStorage.getItem(wsKey(WINES_KEY));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

export function writeLocalWines(wines) {
  try {
    localStorage.setItem(wsKey(WINES_KEY), JSON.stringify(Array.isArray(wines) ? wines : []));
  } catch {}
}

// ── Logo cache ────────────────────────────────────────────────────────────────
// The brand logo is a (potentially large) data URI in service_settings. Caching
// it per workspace lets the real logo paint instantly instead of flashing the
// bundled default while the network read is in flight.
export const MENU_LOGO_KEY = "milka-menu-logo-v1";

export function readLocalLogo() {
  try { return localStorage.getItem(wsKey(MENU_LOGO_KEY)) || ""; } catch { return ""; }
}

export function writeLocalLogo(dataUri) {
  try {
    if (dataUri) localStorage.setItem(wsKey(MENU_LOGO_KEY), dataUri);
    else localStorage.removeItem(wsKey(MENU_LOGO_KEY));
  } catch {}
}
