import { createClient } from "@supabase/supabase-js";

export const TABLES = {
  SERVICE_TABLES: "service_tables",
  SERVICE_SETTINGS: "service_settings",
  SERVICE_ARCHIVE: "service_archive",
  MENU_COURSES: "menu_courses",
  WINES: "wines",
  BEVERAGES: "beverages",
  RESERVATIONS: "reservations",
  AUDIT_LOG: "audit_log",
  WORKSPACE_MEMBERS: "workspace_members",
};

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ── "Remember me" session persistence ───────────────────────────────────────
// When enabled (the default), the auth session lives in localStorage and the
// device stays logged in across app restarts. When disabled (e.g. a shared
// device), it lives in sessionStorage and is dropped when the app/tab closes.
const REMEMBER_KEY = "milka-remember";
export const getRememberMe = () => {
  try { return localStorage.getItem(REMEMBER_KEY) !== "0"; } catch { return true; }
};
export const setRememberMe = (on) => {
  try { localStorage.setItem(REMEMBER_KEY, on ? "1" : "0"); } catch {}
};

// Storage adapter that routes Supabase's auth token to localStorage (remember)
// or sessionStorage (don't), based on the current preference. Reads fall back to
// the other store so an existing session still resolves right after the
// preference flips (and so users logged in before this feature stay logged in).
const hasWindow = typeof window !== "undefined";
const authStorage = hasWindow ? {
  getItem: (k) => {
    try {
      const primary = getRememberMe() ? window.localStorage : window.sessionStorage;
      const hit = primary.getItem(k);
      if (hit != null) return hit;
      const other = getRememberMe() ? window.sessionStorage : window.localStorage;
      return other.getItem(k);
    } catch { return null; }
  },
  setItem: (k, v) => {
    try {
      if (getRememberMe()) { window.localStorage.setItem(k, v); window.sessionStorage.removeItem(k); }
      else { window.sessionStorage.setItem(k, v); window.localStorage.removeItem(k); }
    } catch {}
  },
  removeItem: (k) => {
    try { window.localStorage.removeItem(k); window.sessionStorage.removeItem(k); } catch {}
  },
} : undefined;

export const hasSupabaseConfig = Boolean(url && key);
export const supabase = hasSupabaseConfig
  ? createClient(url, key, {
      auth: {
        // Keep the floor PWA logged in across reloads and refresh the access
        // token silently so a long dinner service is never interrupted. The
        // custom storage adapter honours the "remember me" preference.
        persistSession: true,
        autoRefreshToken: true,
        // Required for password-recovery and staff-invitation links. Supabase
        // consumes the one-time URL credentials, establishes the short-lived
        // session, then App shows the password-creation screen.
        detectSessionInUrl: true,
        storageKey: "milka-auth",
        storage: authStorage,
      },
    })
  : null;
export const supabaseUrl = url;

// ── Current workspace (tenant) ──────────────────────────────────────────────
// Each restaurant is an isolated workspace. This module-level singleton is the
// single source of truth for "which workspace am I querying", so the handful of
// module-scope helpers and directly-imported components can scope their queries
// without prop-drilling. App.jsx mirrors it into React state so data-loading
// effects and realtime subscriptions re-run when the workspace changes.
let _workspaceId = null;
export const getWorkspaceId = () => _workspaceId;
export const setWorkspaceId = (id) => {
  _workspaceId = id || null;
};
