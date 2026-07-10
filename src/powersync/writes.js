// Local-first writes into the on-device PowerSync SQLite DB — the app's single
// write path for synced tables once the local DB is primary. Every write lands
// in SQLite synchronously (instant UI, works offline) and is uploaded to
// Postgres by SupabaseConnector.uploadData() with the engine's retry queue.
//
// HEAVY module (pulls the SDK via system.js) — only reach it through a dynamic
// import() gated by the sqlite-primary check in App.jsx.
//
// Conventions (mirror AppSchema.js / the sync streams):
//   • every row is stamped with the active workspace_id + a fresh updated_at
//   • aliased local ids are `${workspace_id}|${natural_key}` so the same key
//     in two restaurants can never collide in the local database
//   • jsonb columns are stored as JSON text, booleans as 0/1 integers
//   • updates go through UPDATE (not INSERT OR REPLACE) so columns cleared to
//     null travel in the PATCH op and null out the Postgres column too

import { getPowerSync } from "./system.js";
import { getWorkspaceId } from "../lib/supabaseClient.js";
import { localRowId } from "./rowId.js";

// JS value → SQLite storage value (JSON text for objects, 0/1 for booleans).
const sqlite = (v) => {
  if (v == null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "object") return JSON.stringify(v);
  return v;
};

function requireWorkspace() {
  const ws = getWorkspaceId();
  if (!ws) throw new Error("[PowerSync writes] no active workspace");
  return ws;
}

// Upsert on (id, workspace_id) — probe-then-UPDATE/INSERT, atomic inside the
// caller's write transaction. `cols` are real column values (already
// converted); `id` is the aliased local PK.
//
// ⚠️ Do NOT decide UPDATE-vs-INSERT from rowsAffected: the app tables are
// PowerSync VIEWS, their writes run through INSTEAD OF triggers, and SQLite
// does not count trigger-made changes — a successful UPDATE reports
// rowsAffected 0. The original UPDATE-then-INSERT fell through to INSERT on
// every save of a synced row and died on the ps_data__* primary key
// ("UNIQUE constraint failed: ps_data__service_tables.id"), which blocked ALL
// saves the first time a real device went sqlite-primary (05.07 Demo test).
async function upsertLocalRow(tx, table, ws, id, cols) {
  const names = Object.keys(cols);
  const values = names.map((n) => cols[n]);
  const existing = await tx.getOptional(
    `SELECT id FROM ${table} WHERE id = ? AND workspace_id = ?`,
    [String(id), ws],
  );
  if (existing) {
    await tx.execute(
      `UPDATE ${table} SET ${names.map((n) => `${n} = ?`).join(", ")} WHERE id = ? AND workspace_id = ?`,
      [...values, String(id), ws],
    );
  } else {
    await tx.execute(
      `INSERT INTO ${table} (id, workspace_id, ${names.join(", ")}) VALUES (?, ?, ${names.map(() => "?").join(", ")})`,
      [String(id), ws, ...values],
    );
  }
}

// Board rows: [{ table_id, data, updated_at }]
export async function writeServiceTables(rows) {
  const ws = requireWorkspace();
  await getPowerSync().writeTransaction(async (tx) => {
    for (const row of rows) {
      await upsertLocalRow(tx, "service_tables", ws, localRowId(ws, row.table_id), {
        table_id: Number(row.table_id),
        data: sqlite(row.data ?? {}),
        updated_at: row.updated_at || new Date().toISOString(),
      });
    }
  });
}

// service_settings key/value blob (id = "menu_logo", "service_date", …).
export async function writeSetting(id, state) {
  const ws = requireWorkspace();
  await getPowerSync().writeTransaction(async (tx) => {
    await upsertLocalRow(tx, "service_settings", ws, localRowId(ws, id), {
      state: sqlite(state ?? {}),
      updated_at: new Date().toISOString(),
    });
  });
}

// Reservation upsert. The caller supplies the uuid id (crypto.randomUUID() for
// new rows); created_at is only written on insert so edits never restamp it.
async function writeReservationInTransaction(tx, ws, { id, date, table_id, data, created_at }) {
    // Probe-then-write, NOT rowsAffected (see upsertLocalRow): view UPDATEs
    // report 0 changes even on success, which turned every edit of a synced
    // reservation into a duplicate INSERT that died on the local PK.
    const existing = await tx.getOptional(
      "SELECT id FROM reservations WHERE id = ? AND workspace_id = ?",
      [String(id), ws],
    );
    if (existing) {
      // COALESCE keeps the stored date/table_id when an edit arrives without
      // one. Binding NULL here nulled the column: the row fell out of every
      // date-scoped read (the reservation "vanished" on this device) and the
      // upload died on Postgres NOT NULL — the 08.07 null-date incident.
      const tid = Number(table_id);
      await tx.execute(
        "UPDATE reservations SET date = COALESCE(?, date), table_id = COALESCE(?, table_id), data = ? WHERE id = ? AND workspace_id = ?",
        [date ?? null, Number.isFinite(tid) ? tid : null, sqlite(data ?? {}), String(id), ws],
      );
    } else {
      // A date-less INSERT can never render anywhere and Postgres rejects it —
      // fail loudly so the caller reports {ok:false} instead of a silent loss.
      if (!date) throw new Error(`[PowerSync writes] reservation ${id} has no date — refusing to insert an invisible row`);
      await tx.execute(
        "INSERT INTO reservations (id, workspace_id, date, table_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [String(id), ws, date, Number(table_id), sqlite(data ?? {}), created_at || new Date().toISOString()],
      );
    }
}

export async function writeReservation(row) {
  const ws = requireWorkspace();
  await getPowerSync().writeTransaction(async (tx) => {
    await writeReservationInTransaction(tx, ws, row);
  });
}

export async function writeReservations(rows) {
  const ws = requireWorkspace();
  await getPowerSync().writeTransaction(async (tx) => {
    for (const row of rows) await writeReservationInTransaction(tx, ws, row);
  });
}

export async function deleteReservationRow(id) {
  const ws = requireWorkspace();
  await getPowerSync().execute(
    "DELETE FROM reservations WHERE id = ? AND workspace_id = ?",
    [String(id), ws],
  );
}

// Menu save: upsert the CHANGED course rows (position is the natural key) and,
// when `keptPositions` is provided, delete rows whose position fell out of the
// kept list — atomically. The caller diffs, so an untouched course is never
// rewritten and the delete pass only runs when the user actually removed one.
export async function writeMenuCourses(changedRows, keptPositions = null) {
  const ws = requireWorkspace();
  await getPowerSync().writeTransaction(async (tx) => {
    for (const row of changedRows) {
      const { position, ...cols } = row;
      const converted = {};
      for (const [k, v] of Object.entries(cols)) converted[k] = sqlite(v);
      await upsertLocalRow(tx, "menu_courses", ws, localRowId(ws, position), {
        position: Number(position),
        ...converted,
        updated_at: new Date().toISOString(),
      });
    }
    const positions = (keptPositions || []).map(Number).filter(Number.isFinite);
    if (keptPositions) {
      if (positions.length > 0) {
        await tx.execute(
          `DELETE FROM menu_courses WHERE workspace_id = ? AND position NOT IN (${positions.map(() => "?").join(",")})`,
          [ws, ...positions],
        );
      } else {
        await tx.execute("DELETE FROM menu_courses WHERE workspace_id = ?", [ws]);
      }
    }
  });
}

// Wine rows shaped like the legacy upsert payload (key is the natural key).
export async function writeWines(rows) {
  const ws = requireWorkspace();
  await getPowerSync().writeTransaction(async (tx) => {
    for (const row of rows) {
      const { key, ...cols } = row;
      const converted = {};
      for (const [k, v] of Object.entries(cols)) converted[k] = sqlite(v);
      await upsertLocalRow(tx, "wines", ws, localRowId(ws, key), {
        key,
        ...converted,
        updated_at: new Date().toISOString(),
      });
    }
  });
}

export async function deleteWines(keys) {
  if (!keys?.length) return;
  const ws = requireWorkspace();
  await getPowerSync().execute(
    `DELETE FROM wines WHERE workspace_id = ? AND key IN (${keys.map(() => "?").join(",")})`,
    [ws, ...keys],
  );
}

// File a service archive entry locally (works offline; uploads like any other
// write). The uuid is minted client-side so the local row, the uploaded row,
// and any immediate re-read all share one identity.
async function writeArchiveInTransaction(tx, ws, { id, date, label, state }) {
  const archiveId = id || crypto.randomUUID();
  const existing = await tx.getOptional(
    "SELECT id FROM service_archive WHERE id = ? AND workspace_id = ?",
    [archiveId, ws],
  );
  if (!existing) {
    await tx.execute(
      "INSERT INTO service_archive (id, workspace_id, date, label, state, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, NULL)",
      [archiveId, ws, date, label, sqlite(state ?? {}), new Date().toISOString()],
    );
  }
  return archiveId;
}

export async function writeArchiveEntry(entry) {
  const ws = requireWorkspace();
  let id;
  await getPowerSync().writeTransaction(async (tx) => {
    id = await writeArchiveInTransaction(tx, ws, entry);
  });
  return id;
}

// Archive (optional), clear all board rows, and clear the shared service date
// in ONE local SQLite transaction. PowerSync uploads the resulting CRUD batch
// durably; a transient server failure keeps the entire batch queued for retry.
export async function finishServiceLocally({ archive = null, blankRows }) {
  const ws = requireWorkspace();
  await getPowerSync().writeTransaction(async (tx) => {
    if (archive) await writeArchiveInTransaction(tx, ws, archive);
    for (const row of blankRows || []) {
      await upsertLocalRow(tx, "service_tables", ws, localRowId(ws, row.table_id), {
        table_id: Number(row.table_id),
        data: sqlite(row.data ?? {}),
        updated_at: row.updated_at || new Date().toISOString(),
      });
    }
    await upsertLocalRow(tx, "service_settings", ws, localRowId(ws, "service_date"), {
      state: sqlite({}),
      updated_at: new Date().toISOString(),
    });
  });
}

// Soft-delete / restore an archive entry (deleted_at timestamp or null).
export async function setArchiveDeleted(id, deletedAt) {
  const ws = requireWorkspace();
  await getPowerSync().execute(
    "UPDATE service_archive SET deleted_at = ? WHERE id = ? AND workspace_id = ?",
    [deletedAt, String(id), ws],
  );
}

// Soft-delete every active archive entry (the Archive modal's "delete all").
export async function setAllArchivesDeleted(deletedAt) {
  const ws = requireWorkspace();
  await getPowerSync().execute(
    "UPDATE service_archive SET deleted_at = ? WHERE workspace_id = ? AND deleted_at IS NULL",
    [deletedAt, ws],
  );
}

// Permanently purge everything in the archive trash.
export async function purgeDeletedArchives() {
  const ws = requireWorkspace();
  await getPowerSync().execute(
    "DELETE FROM service_archive WHERE workspace_id = ? AND deleted_at IS NOT NULL",
    [ws],
  );
}

// Manual beverages: replace the manual rows of the EDITED categories only,
// like the legacy delete-by-filter + insert but scoped to what changed.
// Locally-created rows get a placeholder id; the server mints the real
// identity id on upload and the synced copy replaces the placeholder after
// the next checkpoint.
export async function replaceManualBeverages(rows, categories = ["cocktail", "spirit", "beer"]) {
  if (!categories.length) return;
  const ws = requireWorkspace();
  await getPowerSync().writeTransaction(async (tx) => {
    await tx.execute(
      `DELETE FROM beverages WHERE workspace_id = ? AND source = 'manual' AND category IN (${categories.map(() => "?").join(",")})`,
      [ws, ...categories],
    );
    for (const row of rows) {
      await tx.execute(
        "INSERT INTO beverages (id, workspace_id, category, name, notes, position, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [crypto.randomUUID(), ws, row.category, row.name, row.notes || "", Number(row.position) || 0, "manual", new Date().toISOString()],
      );
    }
  });
}
