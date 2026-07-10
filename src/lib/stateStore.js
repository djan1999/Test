// Shared service_settings key/value store seam: one read + one write helper
// that pick the on-device SQLite DB when it is primary (see
// powersync/primary.js) and fall back to a direct Supabase call otherwise.
// Used by App.jsx and by the admin/menu components that own their own
// settings rows (inventory, menu generator texts) — so every settings blob
// gets offline-capable writes for free.

import { supabase, getWorkspaceId, TABLES } from "./supabaseClient.js";
import { scopedFrom } from "./scopedDb.js";
import { isSqlitePrimary } from "../powersync/primary.js";

// → the state object, or null when the row doesn't exist. Throws on real
// read failures (callers that seed defaults on "empty" rely on the
// distinction).
export async function readStateKey(id) {
  // No active workspace yet (boot / the workspace-picker screen): fail fast
  // like any other read failure instead of hitting PostgREST, which rejects
  // `workspace_id=eq.null` with a 400 and floods the Postgres logs with uuid
  // parse errors. Callers already treat a throw as "keep cached, retry later",
  // and the loaders re-run once a workspace is applied.
  if (!supabase || !getWorkspaceId()) throw new Error("no active workspace");
  if (isSqlitePrimary()) {
    const { readSetting } = await import("../powersync/reads.js");
    return readSetting(id);
  }
  const { data, error } = await scopedFrom(TABLES.SERVICE_SETTINGS)
    .select("state").eq("id", id).maybeSingle();
  if (error) throw error;
  return data?.state ?? null;
}

export async function saveStateKey(id, state) {
  if (!supabase || !getWorkspaceId()) return { ok: true };
  try {
    if (isSqlitePrimary()) {
      const { writeSetting } = await import("../powersync/writes.js");
      await writeSetting(id, state);
    } else {
      const { error } = await scopedFrom(TABLES.SERVICE_SETTINGS)
        .upsert({ id, state, updated_at: new Date().toISOString() }, { onConflict: "id" });
      if (error) throw error;
    }
    return { ok: true };
  } catch (error) {
    console.error(`Settings save failed (${id}):`, error);
    return { ok: false, error };
  }
}

export async function readStatePrefix(prefix) {
  if (!supabase || !getWorkspaceId()) throw new Error("no active workspace");
  if (isSqlitePrimary()) {
    const { readSettingsPrefix } = await import("../powersync/reads.js");
    return readSettingsPrefix(prefix);
  }
  const { data, error } = await scopedFrom(TABLES.SERVICE_SETTINGS)
    .select("id,state,updated_at").like("id", `${prefix}%`).order("id");
  if (error) throw error;
  return data || [];
}
