/**
 * localStorage helpers for the Milka Service Board.
 * All reads return null/default on error so a corrupted entry never crashes the app.
 */

export const BEV_STORAGE_KEY = "milka-beverages-v1";
const DEFAULT_TEAM_NAMES_FROM_ENV = String(import.meta.env.VITE_DEFAULT_TEAM_NAMES || "").trim();

export function readLocalBeverages() {
  try {
    const raw = localStorage.getItem(BEV_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

export function writeLocalBeverages(bev) {
  try { localStorage.setItem(BEV_STORAGE_KEY, JSON.stringify(bev)); } catch {}
}

export const TEAM_STORAGE_KEY = "milka-menu-team-v2";
export const DEFAULT_TEAM_NAMES = DEFAULT_TEAM_NAMES_FROM_ENV;

export function readTeamNames() {
  if (typeof window === "undefined") return DEFAULT_TEAM_NAMES || "";
  try {
    const raw = window.localStorage.getItem(TEAM_STORAGE_KEY);
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
    window.localStorage.setItem(TEAM_STORAGE_KEY, value ?? "");
  } catch {}
}

export const MENU_TITLE_EN_KEY = "milka-menu-title-en-v1";
export const MENU_TITLE_SI_KEY = "milka-menu-title-si-v1";
export const THANK_YOU_EN_KEY  = "milka-thankyou-en-v1";
export const THANK_YOU_SI_KEY  = "milka-thankyou-si-v1";

export function readMenuTitle(lang) {
  const key = lang === "si" ? MENU_TITLE_SI_KEY : MENU_TITLE_EN_KEY;
  if (typeof window === "undefined") return "";
  try { return window.localStorage.getItem(key) ?? ""; } catch { return ""; }
}

export function writeMenuTitle(lang, value) {
  if (typeof window === "undefined") return;
  const key = lang === "si" ? MENU_TITLE_SI_KEY : MENU_TITLE_EN_KEY;
  try { window.localStorage.setItem(key, value || ""); } catch {}
}

export function readThankYouNote(lang) {
  const key = lang === "si" ? THANK_YOU_SI_KEY : THANK_YOU_EN_KEY;
  if (typeof window === "undefined") return "";
  try { return window.localStorage.getItem(key) ?? ""; } catch { return ""; }
}

export function writeThankYouNote(lang, value) {
  if (typeof window === "undefined") return;
  const key = lang === "si" ? THANK_YOU_SI_KEY : THANK_YOU_EN_KEY;
  try { window.localStorage.setItem(key, value || ""); } catch {}
}

export const STORAGE_KEY = "milka-service-board-v8";

export const readLocalBoardState = () => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
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
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
};
