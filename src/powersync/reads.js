// Fast reads from the on-device PowerSync SQLite DB. HEAVY module (pulls the
// SDK via system.js) — only ever reach it through a dynamic import() gated by
// isPowerSyncEnabled(). Used to paint the UI instantly from local data while
// the existing Supabase load still runs as the source-of-truth refresh.

import { getPowerSync } from "./system.js";

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

// Reservations within the planner window (-7…+30 days), shaped like the
// Supabase rows the planner already consumes.
export async function readReservations(fromISO, toISO) {
  const rows = await getPowerSync().getAll(
    "SELECT id, workspace_id, date, table_id, data, created_at FROM reservations WHERE date >= ? AND date <= ? ORDER BY date, created_at",
    [fromISO, toISO],
  );
  return rows.map(reviveRow);
}

// Service board rows, shaped like the Supabase select the board reconcile
// (mergeRemoteTables) already consumes: { table_id, data, updated_at }.
export async function readServiceTables() {
  const rows = await getPowerSync().getAll(
    "SELECT table_id, data, updated_at FROM service_tables ORDER BY table_id",
  );
  return rows.map(reviveRow);
}

// Wines, already mapped to the shape setWines() expects (mirrors loadWines).
export async function readWines() {
  const rows = await getPowerSync().getAll(
    "SELECT key, name, wine_name, producer, vintage, region, country, by_glass, source FROM wines ORDER BY name",
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
    "SELECT id, category, name, notes, position, source FROM beverages ORDER BY position",
  );
}

// Menu course rows with jsonb columns revived to objects; the caller maps each
// through supabaseRowToCourse (same as the Supabase path).
export async function readMenuCourses() {
  const rows = await getPowerSync().getAll(
    "SELECT * FROM menu_courses ORDER BY position",
  );
  return rows.map(reviveRow);
}

// Service archive split into { active, deleted }, mirroring the two Supabase
// queries the Archive modal runs (active newest-first ≤60, trash newest-first
// ≤30). state jsonb is revived to an object.
export async function readServiceArchive() {
  const rows = await getPowerSync().getAll(
    "SELECT id, date, label, state, created_at, deleted_at, workspace_id FROM service_archive ORDER BY created_at DESC",
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
