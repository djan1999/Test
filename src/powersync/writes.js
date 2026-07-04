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
//   • the aliased local `id` is set to the natural key (service_tables→table_id,
//     menu_courses→position, wines→key, service_settings→its id) so a synced
//     copy of the same row lands on the same local PK instead of duplicating
//   • jsonb columns are stored as JSON text, booleans as 0/1 integers
//   • updates go through UPDATE (not INSERT OR REPLACE) so columns cleared to
//     null travel in the PATCH op and null out the Postgres column too

import { getPowerSync } from "./system.js";
import { getWorkspaceId } from "../lib/supabaseClient.js";

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

// UPDATE-then-INSERT upsert on (id, workspace_id). `cols` are real column
// values (already converted); `id` is the aliased local PK.
async function upsertLocalRow(tx, table, ws, id, cols) {
  const names = Object.keys(cols);
  const values = names.map((n) => cols[n]);
  const updated = await tx.execute(
    `UPDATE ${table} SET ${names.map((n) => `${n} = ?`).join(", ")} WHERE id = ? AND workspace_id = ?`,
    [...values, String(id), ws],
  );
  if ((updated?.rowsAffected ?? 0) === 0) {
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
      await upsertLocalRow(tx, "service_tables", ws, row.table_id, {
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
    await upsertLocalRow(tx, "service_settings", ws, id, {
      state: sqlite(state ?? {}),
      updated_at: new Date().toISOString(),
    });
  });
}

// Reservation upsert. The caller supplies the uuid id (crypto.randomUUID() for
// new rows); created_at is only written on insert so edits never restamp it.
export async function writeReservation({ id, date, table_id, data, created_at }) {
  const ws = requireWorkspace();
  await getPowerSync().writeTransaction(async (tx) => {
    const updated = await tx.execute(
      "UPDATE reservations SET date = ?, table_id = ?, data = ? WHERE id = ? AND workspace_id = ?",
      [date, Number(table_id), sqlite(data ?? {}), String(id), ws],
    );
    if ((updated?.rowsAffected ?? 0) === 0) {
      await tx.execute(
        "INSERT INTO reservations (id, workspace_id, date, table_id, data, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [String(id), ws, date, Number(table_id), sqlite(data ?? {}), created_at || new Date().toISOString()],
      );
    }
  });
}

export async function deleteReservationRow(id) {
  const ws = requireWorkspace();
  await getPowerSync().execute(
    "DELETE FROM reservations WHERE id = ? AND workspace_id = ?",
    [String(id), ws],
  );
}

// Full menu save: upsert every course row (position is the natural key) and
// delete rows whose position is no longer present — mirroring the legacy
// upsert + delete-missing pair, atomically.
export async function replaceMenuCourses(rows) {
  const ws = requireWorkspace();
  await getPowerSync().writeTransaction(async (tx) => {
    for (const row of rows) {
      const { position, ...cols } = row;
      const converted = {};
      for (const [k, v] of Object.entries(cols)) converted[k] = sqlite(v);
      await upsertLocalRow(tx, "menu_courses", ws, position, {
        position: Number(position),
        ...converted,
        updated_at: new Date().toISOString(),
      });
    }
    const positions = rows.map((r) => Number(r.position)).filter(Number.isFinite);
    if (positions.length > 0) {
      await tx.execute(
        `DELETE FROM menu_courses WHERE workspace_id = ? AND position NOT IN (${positions.map(() => "?").join(",")})`,
        [ws, ...positions],
      );
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
      await upsertLocalRow(tx, "wines", ws, key, {
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

// Manual beverages: replace all manual rows in the edited categories, like the
// legacy delete-by-filter + insert. Locally-created rows get a placeholder id;
// the server mints the real identity id on upload and the synced copy replaces
// the placeholder after the next checkpoint.
export async function replaceManualBeverages(rows) {
  const ws = requireWorkspace();
  await getPowerSync().writeTransaction(async (tx) => {
    await tx.execute(
      "DELETE FROM beverages WHERE workspace_id = ? AND source = 'manual' AND category IN ('cocktail','spirit','beer')",
      [ws],
    );
    for (const row of rows) {
      await tx.execute(
        "INSERT INTO beverages (id, workspace_id, category, name, notes, position, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [crypto.randomUUID(), ws, row.category, row.name, row.notes || "", Number(row.position) || 0, "manual", new Date().toISOString()],
      );
    }
  });
}
