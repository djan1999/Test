// Fast reads from the on-device PowerSync SQLite DB — the app's primary read
// path once priority-1 has synced. HEAVY module (pulls the SDK via system.js) — only ever reach it
// through a dynamic import() gated by isPowerSyncEnabled().
//
// Every query is scoped to the active workspace: the sync streams alias
// natural keys into the local `id` PK, so an account that syncs more than one
// workspace must never read another tenant's aliased rows.

import { getPowerSync } from "./system.js";
import { getWorkspaceId } from "../lib/supabaseClient.js";
import { localRowId, naturalKeyFromLocalId } from "./rowId.js";

// Resolve true once the local DB has completed its first full sync, so we never
// paint a half-synced (partial) table. Falls through to false after a timeout so
// a stalled/empty sync never blocks the Supabase path behind it.
export async function whenSynced(timeoutMs = 4000) {
  const db = getPowerSync();
  if (db.currentStatus?.hasSynced) return true;
  return new Promise((resolve) => {
    let settled = false;
    let dispose;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { dispose?.(); } catch { /* noop */ }
      resolve(v);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    dispose = db.registerListener({
      statusChanged: (s) => { if (s.hasSynced) finish(true); },
    });
  });
}

// Like whenSynced, but resolves as soon as a given priority level has completed
// its first sync (or the full sync completes, or the timeout). With prioritized
// sync rules this lets the board/planner paint before lower-priority data (the
// 733 wines, archive) finishes downloading on a fresh device. Degrades safely:
// if priorities aren't deployed, the full-sync path resolves it exactly like
// whenSynced, so it can never regress.
export async function whenSyncedPriority(priority, timeoutMs = 4000) {
  const db = getPowerSync();
  if (db.currentStatus?.hasSynced) return true;
  if (db.currentStatus?.statusForPriority?.(priority)?.hasSynced) return true;
  return new Promise((resolve) => {
    let settled = false;
    let dispose;
    const finish = (v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { dispose?.(); } catch { /* noop */ }
      resolve(v);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    dispose = db.registerListener({
      statusChanged: (s) => {
        if (s.hasSynced || s.statusForPriority?.(priority)?.hasSynced) finish(true);
      },
    });
    db.waitForFirstSync?.({ priority }).then(() => finish(true)).catch(() => { /* noop */ });
  });
}

// PowerSync stores jsonb columns as JSON text. Re-parse only object/array
// strings (those starting with { or [) so e.g. reservations.data and
// service_tables.data become objects again — matching what supabase-js returns.
// Plain strings and numbers pass through untouched (no type coercion).
function reviveRow(row) {
  const out = {};
  for (const k in row) {
    const v = row[k];
    if (typeof v === "string" && (v[0] === "{" || v[0] === "[")) {
      try { out[k] = JSON.parse(v); continue; } catch { /* keep raw string */ }
    }
    out[k] = v;
  }
  return out;
}

// One service_settings blob (id = "menu_logo", "service_date", …) → the state
// object, or null when the row doesn't exist. Mirrors the Supabase
// `.select("state").eq("id", id).maybeSingle()` reads: a missing row is null,
// a real read failure THROWS — callers that seed defaults on "genuinely empty"
// (the layout-profiles loader) must be able to tell the two apart.
export async function readSetting(id) {
  const ws = getWorkspaceId();
  const row = await getPowerSync().getOptional(
    "SELECT state FROM service_settings WHERE id = ? AND workspace_id = ?",
    [localRowId(ws, id), ws],
  );
  if (row?.state == null) return null;
  return reviveRow(row).state ?? null;
}

export async function readSettingsPrefix(prefix) {
  const ws = getWorkspaceId();
  const rows = await getPowerSync().getAll(
    "SELECT id, state, updated_at FROM service_settings WHERE workspace_id = ? AND id LIKE ? ORDER BY id",
    [ws, `${localRowId(ws, prefix)}%`],
  );
  return rows.map((row) => ({
    ...reviveRow(row),
    id: naturalKeyFromLocalId(row.id, ws),
  }));
}

// The settings rows the app live-updates across devices. floor_status_v1 /
// floor_maps_v1 joined 11.07: they were boot-read only, so a SET marker
// tapped on one tablet never reached another device without a full reload.
export async function readLiveSettings() {
  const ws = getWorkspaceId();
  const ids = ["kitchen_ticket_order", "service_date", "floor_status_v1", "floor_maps_v1", "restaurant_config_v1"]
    .map((id) => localRowId(ws, id));
  const rows = await getPowerSync().getAll(
    "SELECT id, state, updated_at FROM service_settings WHERE workspace_id = ? AND id IN (?, ?, ?, ?, ?)",
    [ws, ...ids],
  );
  return rows.map((row) => ({
    ...reviveRow(row),
    id: naturalKeyFromLocalId(row.id, ws),
  }));
}

// Reservations within the planner window (-7…+30 days), shaped like the
// Supabase rows the planner already consumes.
export async function readReservations(fromISO, toISO) {
  const rows = await getPowerSync().getAll(
    "SELECT id, workspace_id, date, table_id, data, created_at FROM reservations WHERE workspace_id = ? AND date >= ? AND date <= ? ORDER BY date, created_at",
    [getWorkspaceId(), fromISO, toISO],
  );
  return rows.map(reviveRow);
}

// Service board rows, shaped like the Supabase select the board consumes:
// { table_id, data, updated_at }.
export async function readServiceTables() {
  const rows = await getPowerSync().getAll(
    "SELECT table_id, data, updated_at FROM service_tables WHERE workspace_id = ? ORDER BY table_id",
    [getWorkspaceId()],
  );
  return rows.map(reviveRow);
}

// Wines, already mapped to the shape setWines() expects (mirrors loadWines).
export async function readWines() {
  const rows = await getPowerSync().getAll(
    "SELECT key, name, wine_name, producer, vintage, region, country, by_glass, source FROM wines WHERE workspace_id = ? ORDER BY name",
    [getWorkspaceId()],
  );
  return rows.map((r) => ({
    id: r.key,
    name: r.wine_name || r.name,
    producer: r.producer || "",
    vintage: r.vintage || "",
    region: r.region || "",
    country: r.country || "",
    byGlass: !!r.by_glass,
    source: r.source || "sync",
  }));
}

// Beverages, shaped like the Supabase select loadBeverages() consumes; the
// caller splits them by category via pickBeveragesForCategory().
export async function readBeverages() {
  return getPowerSync().getAll(
    "SELECT id, category, name, notes, position, source FROM beverages WHERE workspace_id = ? ORDER BY position",
    [getWorkspaceId()],
  );
}

// Postgres boolean columns arrive from SQLite as 0/1 integers. The course
// mapper (supabaseRowToCourse) uses `!== false` semantics, where a raw 0 would
// read as TRUE — e.g. an archived course (is_active = 0) would come back
// active. Convert to real booleans before handing rows to the app.
const MENU_COURSE_BOOL_COLUMNS = [
  "is_snack", "is_last_bite", "optional_pairing_enabled",
  "optional_pairing_default_on", "section_gap_before", "show_on_short",
  "is_active",
];

// Menu course rows with jsonb columns revived to objects and booleans
// normalised; the caller maps each through supabaseRowToCourse (same as the
// Supabase path).
export async function readMenuCourses() {
  const rows = await getPowerSync().getAll(
    "SELECT * FROM menu_courses WHERE workspace_id = ? ORDER BY position",
    [getWorkspaceId()],
  );
  return rows.map((r) => {
    const out = reviveRow(r);
    for (const col of MENU_COURSE_BOOL_COLUMNS) {
      if (out[col] != null) out[col] = !!out[col];
    }
    return out;
  });
}

// Active (non-deleted) archive entries for one service day — the input set
// for the manual-archive label dedup.
export async function readActiveArchivesForDate(date) {
  const rows = await getPowerSync().getAll(
    "SELECT id, label, state, created_at FROM service_archive WHERE workspace_id = ? AND date = ? AND deleted_at IS NULL",
    [getWorkspaceId(), date],
  );
  return rows.map(reviveRow);
}

// Service archive split into { active, deleted }, mirroring the two Supabase
// queries the Archive modal runs (active newest-first ≤60, trash newest-first
// ≤30). state jsonb is revived to an object.
export async function readServiceArchive() {
  const rows = await getPowerSync().getAll(
    "SELECT id, date, label, state, created_at, deleted_at, workspace_id FROM service_archive WHERE workspace_id = ? ORDER BY created_at DESC",
    [getWorkspaceId()],
  );
  const mapped = rows.map(reviveRow);
  return {
    active: mapped.filter((r) => r.deleted_at == null).slice(0, 60),
    deleted: mapped
      .filter((r) => r.deleted_at != null)
      .sort((a, b) => String(b.deleted_at).localeCompare(String(a.deleted_at)))
      .slice(0, 30),
  };
}
