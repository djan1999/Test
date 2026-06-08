import { createClient } from "@supabase/supabase-js";

export const TABLES = {
  SERVICE_TABLES: import.meta.env.VITE_SUPABASE_SERVICE_TABLES || "service_tables",
  SERVICE_SETTINGS: "service_settings",
  SERVICE_ARCHIVE: "service_archive",
  MENU_COURSES: "menu_courses",
  WINES: "wines",
  BEVERAGES: "beverages",
  RESERVATIONS: "reservations",
};

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabaseConfig = Boolean(url && key);
export const supabase = hasSupabaseConfig
  ? createClient(url, key, {
      auth: {
        // Keep the floor PWA logged in across reloads and refresh the access
        // token silently so a long dinner service is never interrupted.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: "milka-auth",
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
