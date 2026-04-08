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
export const supabase = hasSupabaseConfig ? createClient(url, key) : null;
export const supabaseUrl = url;
