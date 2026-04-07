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
    return raw && raw.trim() ? raw : (DEFAULT_TEAM_NAMES || "");
  } catch {
    return DEFAULT_TEAM_NAMES || "";
  }
}

export function writeTeamNames(value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TEAM_STORAGE_KEY, value || DEFAULT_TEAM_NAMES || "");
  } catch {}
}

export const MENU_TITLE_EN_KEY = "milka-menu-title-en-v1";
export const MENU_TITLE_SI_KEY = "milka-menu-title-si-v1";
const MENU_TITLE_EN_FALLBACK = "MENU";
const MENU_TITLE_SI_FALLBACK = "Zimski Meni";

export function readMenuTitle(lang) {
  const key = lang === "si" ? MENU_TITLE_SI_KEY : MENU_TITLE_EN_KEY;
  const fallback = lang === "si" ? MENU_TITLE_SI_FALLBACK : MENU_TITLE_EN_FALLBACK;
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw && raw.trim() ? raw : fallback;
  } catch { return fallback; }
}

export function writeMenuTitle(lang, value) {
  if (typeof window === "undefined") return;
  const key = lang === "si" ? MENU_TITLE_SI_KEY : MENU_TITLE_EN_KEY;
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
