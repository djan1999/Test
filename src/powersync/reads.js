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

// The settings rows the app live-updates across devices. floor_status /
// floor_maps joined 11.07: they were boot-read only, so a SET marker tapped
// on one tablet never reached another device without a full reload.
// Floor SET strips are namespaced PER SERVICE (`floor_status_v2:<serviceId>`)
// since the entity rework: a stale device replaying its old service's strips
// writes to that OLD key and can never overwrite the live service's strips.
// (The legacy shared `service_date` and `floor_status_v1` keys are retired
// and deliberately not read.)
export async function readLiveSettings() {
  const ws = getWorkspaceId();
  const ids = ["kitchen_ticket_order", "floor_maps_v1", "restaurant_config_v1"]
    .map((id) => localRowId(ws, id));
  const rows = await getPowerSync().getAll(
    "SELECT id, state, updated_at FROM service_settings WHERE workspace_id = ? AND (id IN (?, ?, ?) OR id LIKE ?)",
    [ws, ...ids, `${localRowId(ws, "floor_status_v2:")}%`],
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

// Service board rows for ONE service, shaped like the Supabase select the
// board consumes: { service_id, table_id, data, updated_at }. No service →
// no rows (a device between services has no board namespace to read).
export async function readServiceTables(serviceId) {
  if (!serviceId) return [];
  const rows = await getPowerSync().getAll(
    "SELECT service_id, table_id, data, updated_at FROM service_tables WHERE workspace_id = ? AND service_id = ? ORDER BY table_id",
    [getWorkspaceId(), String(serviceId)],
  );
  return rows.map(reviveRow);
}

// All services rows for the workspace (newest started_at first, bounded).
export async function readServices(limit = 120) {
  const rows = await getPowerSync().getAll(
    "SELECT * FROM services WHERE workspace_id = ? ORDER BY started_at DESC LIMIT ?",
    [getWorkspaceId(), limit],
  );
  return rows.map(reviveRow);
}

// Board rows for a SET of services in one query — the archive detail reads.
export async function readServiceTablesForServices(serviceIds) {
  const ids = (serviceIds || []).map(String).filter(Boolean);
  if (ids.length === 0) return [];
  const rows = await getPowerSync().getAll(
    `SELECT service_id, table_id, data, updated_at FROM service_tables WHERE workspace_id = ? AND service_id IN (${ids.map(() => "?").join(",")}) ORDER BY service_id, table_id`,
    [getWorkspaceId(), ...ids],
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

// Labels already taken on one service day — the input set for the end-label
// dedup ("… · 2"). Ended services AND legacy archive rows both count.
export async function readActiveArchivesForDate(date) {
  const ws = getWorkspaceId();
  const db = getPowerSync();
  const [legacy, services] = await Promise.all([
    db.getAll(
      "SELECT id, label, created_at FROM service_archive WHERE workspace_id = ? AND date = ? AND deleted_at IS NULL",
      [ws, date],
    ),
    db.getAll(
      "SELECT id, label, ended_at AS created_at FROM services WHERE workspace_id = ? AND date = ? AND status = 'ended' AND deleted_at IS NULL AND label IS NOT NULL",
      [ws, date],
    ),
  ]);
  return [...legacy, ...services].map(reviveRow);
}

// Archive view: ended services (adapted to the legacy entry shape) merged
// with legacy service_archive rows, split into { active, deleted } — active
// newest-first ≤60, trash newest-first ≤30 (the caps the modal always had).
export async function readServiceArchive() {
  const { archiveEntryFromService, mergeArchiveEntries } = await import("../lib/serviceEntity.js");
  const ws = getWorkspaceId();
  const db = getPowerSync();
  const [legacyActive, legacyDeleted, endedServices] = await Promise.all([
    // LIMIT in SQL, not post-parse: each legacy row's `state` is a full board
    // snapshot (easily 100KB+); parsing everything just to slice the top 60
    // made the Archive open slower every week on the weakest device.
    db.getAll(
      "SELECT id, date, label, state, created_at, deleted_at, workspace_id FROM service_archive WHERE workspace_id = ? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 60",
      [ws],
    ),
    db.getAll(
      "SELECT id, date, label, state, created_at, deleted_at, workspace_id FROM service_archive WHERE workspace_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 30",
      [ws],
    ),
    db.getAll(
      "SELECT * FROM services WHERE workspace_id = ? AND status = 'ended' ORDER BY ended_at DESC LIMIT 90",
      [ws],
    ),
  ]);
  const services = endedServices.map(reviveRow);
  const tableRows = await readServiceTablesForServices(services.map((row) => row.id));
  const rowsByService = new Map();
  for (const row of tableRows) {
    const key = String(row.service_id);
    if (!rowsByService.has(key)) rowsByService.set(key, []);
    rowsByService.get(key).push(row);
  }
  return mergeArchiveEntries({
    serviceEntries: services.map((row) => archiveEntryFromService(row, rowsByService.get(String(row.id)) || [])),
    legacyActive: legacyActive.map(reviveRow),
    legacyDeleted: legacyDeleted.map(reviveRow),
  });
}
