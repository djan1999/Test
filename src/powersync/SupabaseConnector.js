// PowerSync ↔ Supabase backend connector.
//
// Two responsibilities in the PowerSync model:
//   1. fetchCredentials() — hand PowerSync the instance URL + a valid Supabase
//      access token so it can authenticate the sync stream. We reuse the app's
//      existing supabase client (src/lib/supabaseClient.js) so the token, the
//      "remember me" storage adapter, and silent refresh are all shared — no
//      second auth surface.
//   2. uploadData() — drains the local SQLite write queue back to Postgres via
//      supabase-js (user JWT, so RLS applies to every uploaded op).
//
// The local SQLite database is the app's single write path for the synced
// tables; everything the UI writes lands here first and is uploaded by this
// connector. Natural keys: PowerSync requires a text `id` PK per table, and
// the sync streams alias each composite-key table's natural key into it
// (service_tables→table_id, menu_courses→position, wines→key,
// service_settings→id). Upload rebuilds the real Postgres row from the op's
// column data + that workspace-qualified alias, and targets the SAME conflict columns the legacy
// scopedFrom() writes used (lib/scopedDb.js COMPOSITE_CONFLICT — verified
// against the composite primary keys in schema.sql).

import { supabase, getWorkspaceId } from "../lib/supabaseClient.js";
import { POWERSYNC_URL } from "./config.js";
import { naturalKeyFromLocalId } from "./rowId.js";
import { saveServiceTableWithCas } from "../lib/serviceTableCas.js";
import { saveServiceSettingWithCas } from "../lib/serviceSettingCas.js";
import { MERGEABLE_SETTING_KEYS } from "../utils/foldSettingState.js";
import { recordClientDiagnostic } from "../lib/clientDiagnostics.js";
import { tableHasServiceContent } from "../utils/tableHelpers.js";
import { saveReservationWithCas } from "../lib/reservationCas.js";

// @powersync/common UpdateType values, inlined so this module stays importable
// without the SDK (unit tests exercise uploadData with mock transactions).
// op.op is "PUT" | "PATCH" | "DELETE". PUT (full row) uploads as an upsert;
// PATCH (changed columns only) uploads as a plain UPDATE — see applyOp.
const OP_DELETE = "DELETE";
const OP_PATCH = "PATCH";

// Conflict targets per composite-key table — must mirror lib/scopedDb.js
// COMPOSITE_CONFLICT / the schema.sql primary keys exactly, or PostgREST
// rejects the upsert (42P10: no unique constraint on the conflict columns).
const NATURAL_KEY = {
  service_tables:   { column: "table_id", int: true,  conflict: "workspace_id,table_id" },
  service_settings: { column: "id",       int: false, conflict: "workspace_id,id" },
  menu_courses:     { column: "position", int: true,  conflict: "workspace_id,position" },
  wines:            { column: "key",      int: false, conflict: "workspace_id,key" },
};

// Tables whose Postgres PK is the plain uuid `id` PowerSync already uses.
const UUID_ID_TABLES = new Set(["reservations", "service_archive"]);

// jsonb columns per table. SQLite stores them as JSON text; PostgREST would
// persist a raw string as a jsonb *string value*, so parse before upload.
const JSON_COLUMNS = {
  service_tables: new Set(["data"]),
  service_settings: new Set(["state"]),
  reservations: new Set(["data"]),
  service_archive: new Set(["state"]),
  menu_courses: new Set([
    "menu", "menu_si", "veg", "vegan", "pescetarian", "gluten_free", "dairy_free",
    "nut_free", "shellfish_free", "no_red_meat", "no_pork", "no_game", "no_offal",
    "egg_free", "no_alcohol", "no_garlic_onion", "halal", "low_fodmap",
    "restrictions_si", "wp", "wp_si", "na", "na_si", "os", "os_si",
    "premium", "premium_si", "hazards",
    "optional_pairing_alco", "optional_pairing_alco_si",
    "optional_pairing_na", "optional_pairing_na_si",
  ]),
};

// boolean columns per table — SQLite stores 0/1 integers.
const BOOLEAN_COLUMNS = {
  menu_courses: new Set([
    "is_snack", "is_last_bite", "optional_pairing_enabled",
    "optional_pairing_default_on", "section_gap_before", "show_on_short",
    "is_active",
  ]),
  wines: new Set(["by_glass"]),
};

const KNOWN_TABLES = new Set([
  ...Object.keys(NATURAL_KEY), ...UUID_ID_TABLES, "beverages",
]);

// Operational writes are never disposable. A schema/permission error here is
// an outage to surface and retry, not permission to tell PowerSync the tap was
// uploaded and silently erase it from the queue.
const NEVER_DROP_TABLES = new Set([
  "service_tables", "service_settings", "reservations", "service_archive",
]);

// Postgres error classes that will fail identically on every retry —
// constraint violations, bad data, missing columns/permissions, and PostgREST
// schema-cache errors. Retrying these would wedge the queue forever.
const PERMANENT_ERROR_CODES = [/^22...$/, /^23...$/, /^42...$/, /^PGRST\d+$/];
const isPermanentError = (error) =>
  PERMANENT_ERROR_CODES.some((re) => re.test(String(error?.code || "")));

// Thrown for ops that can never succeed (unknown table, unusable key) so the
// drain loop logs + skips them instead of retrying forever.
class PermanentOpError extends Error {}

function convertValue(table, column, value) {
  if (value == null) return value;
  if (BOOLEAN_COLUMNS[table]?.has(column)) return !(value === 0 || value === "0" || value === false);
  if (JSON_COLUMNS[table]?.has(column) && typeof value === "string") {
    const c = value[0];
    if (c === "{" || c === "[") {
      try { return JSON.parse(value); } catch { return value; }
    }
  }
  return value;
}

// Rebuild the typed Postgres row for a PUT/PATCH op: convert column values,
// re-attach the natural key from the op id, and stamp the workspace.
function buildRow(op, workspaceId) {
  const row = {};
  for (const [col, val] of Object.entries(op.opData || {})) {
    row[col] = convertValue(op.table, col, val);
  }
  const nat = NATURAL_KEY[op.table];
  if (nat) {
    const opKey = naturalKeyFromLocalId(op.id, workspaceId);
    if (row[nat.column] == null || String(row[nat.column]) === String(op.id)) {
      row[nat.column] = nat.int ? Number(opKey) : opKey;
    }
    else if (nat.int) row[nat.column] = Number(row[nat.column]);
    if (nat.int && !Number.isFinite(row[nat.column])) {
      throw new PermanentOpError(`non-numeric ${op.table}.${nat.column} key: ${op.id}`);
    }
    // The aliased local id is not a real column on these tables — except
    // service_settings, whose natural key genuinely is named `id`.
    if (nat.column !== "id") delete row.id;
  } else if (UUID_ID_TABLES.has(op.table)) {
    row.id = op.id;
  }
  row.workspace_id = workspaceId;
  return row;
}

// Resolve which workspace an op belongs to. Rows written locally always carry
// workspace_id (opData); deletes fall back to the tracked previous values,
// then to the active workspace. An op with no resolvable workspace is
// permanently skipped — uploading it unscoped could cross tenants.
function workspaceForOp(op) {
  const ws = op.opData?.workspace_id
    ?? op.previousValues?.workspace_id
    ?? getWorkspaceId();
  if (!ws) throw new PermanentOpError("op has no resolvable workspace_id");
  return ws;
}

const isEmptyObjectValue = (table, column, value) => {
  const parsed = convertValue(table, column, value);
  return Boolean(parsed)
    && typeof parsed === "object"
    && !Array.isArray(parsed)
    && Object.keys(parsed).length === 0;
};

// `finishServiceLocally()` deliberately emits one very distinctive SQLite
// transaction: every configured service-table row blanked, one blank service_date setting,
// and optionally one archive insert. Replaying those as twelve independent
// HTTP writes would be durable (PowerSync retries the batch) but not atomic on
// Postgres: another tablet could briefly see a cleared table while the service
// date was still live. Recognize only the exact transaction and collapse it
// into the server-side archive_and_finish_service transaction.
function finishServicePayload(crud) {
  if (!Array.isArray(crud) || crud.length < 2) return null;
  if (crud.some((op) => op.op === OP_DELETE)) return null;

  const tableOps = crud.filter((op) => op.table === "service_tables");
  const settingOps = crud.filter((op) => op.table === "service_settings");
  const archiveOps = crud.filter((op) => op.table === "service_archive");
  if (tableOps.length < 1 || settingOps.length !== 1 || archiveOps.length > 1) return null;
  if (tableOps.length + settingOps.length + archiveOps.length !== crud.length) return null;

  const workspaces = new Set(crud.map(workspaceForOp));
  if (workspaces.size !== 1) return null;
  const workspaceId = [...workspaces][0];

  const tableIds = tableOps.map((op) => {
    const row = buildRow(op, workspaceId);
    if (!isEmptyObjectValue("service_tables", "data", row.data)) return NaN;
    return Number(row.table_id ?? naturalKeyFromLocalId(op.id, workspaceId));
  });
  if (new Set(tableIds).size !== tableIds.length
      || !tableIds.every((id) => Number.isInteger(id) && id >= 1 && id <= 999)) return null;

  const setting = buildRow(settingOps[0], workspaceId);
  if (setting.id !== "service_date"
      || !isEmptyObjectValue("service_settings", "state", setting.state)) return null;

  const archive = archiveOps.length === 1 ? buildRow(archiveOps[0], workspaceId) : null;
  if (archive && (!archive.id || !archive.date || !archive.label)) return null;

  // Engage the RPC's identity guard: the settings op's tracked previousValues
  // (trackPrevious in AppSchema) still hold the {date, startedAt} of the
  // service the ENDING DEVICE saw when it blanked service_date. The local
  // check in finishServiceLocally() can only compare against the local DB —
  // stale by definition on an offline device — so without these params a
  // finish queued during an outage replayed unguarded and could blank a newer
  // service that started while the device was away. With them, the server
  // answers { superseded: true } instead of wiping (see uploadData).
  // Legacy batches without previousValues fall back to the unguarded call.
  let expectedStartedAt = null;
  let expectedDate = null;
  const prevState = convertValue(
    "service_settings", "state", settingOps[0].previousValues?.state,
  );
  if (prevState && typeof prevState === "object" && !Array.isArray(prevState)) {
    if (typeof prevState.startedAt === "string" && prevState.startedAt) {
      expectedStartedAt = prevState.startedAt;
    }
    if (typeof prevState.date === "string" && prevState.date) {
      expectedDate = prevState.date;
    }
  }

  return {
    p_workspace_id: workspaceId,
    p_archive_id: archive?.id || null,
    p_archive_date: archive?.date || null,
    p_archive_label: archive?.label || null,
    p_archive_state: archive?.state || null,
    p_expected_started_at: expectedStartedAt,
    p_expected_date: expectedDate,
  };
}

// Service-board rows are busy shared documents: two tablets often edit
// different seats on the same table within seconds. A plain row UPDATE makes
// the last uploader erase the other tablet's work. Read the current server
// row, fold it with PowerSync's tracked ancestor, then commit with a database
// compare-and-swap. If somebody wins the race first, retry against their copy.
async function applyServiceTableWrite(op, ws, row) {
  const tableId = Number(row.table_id ?? naturalKeyFromLocalId(op.id, ws));
  if (!Number.isFinite(tableId)) {
    throw new PermanentOpError(`non-numeric service_tables.table_id key: ${op.id}`);
  }
  try {
    await saveServiceTableWithCas({
      client: supabase,
      workspaceId: ws,
      tableId,
      data: row.data ?? {},
      ancestor: convertValue("service_tables", "data", op.previousValues?.data),
    });
    return { error: null };
  } catch (error) {
    return { error };
  }
}

// A MOVE is stored locally as "destination receives the party" + "source is
// blanked". Upload the claim first. If the destination became occupied on the
// server, its CAS refuses and the transaction stays queued WITHOUT erasing the
// source. Stable ordering keeps unrelated operations in their original order.
function serviceTableClaimsFirst(crud) {
  const boardWrites = (crud || []).filter((op) => op.table === "service_tables" && op.op !== OP_DELETE);
  const ids = boardWrites.map((op) => String(op.id));
  if (new Set(ids).size !== ids.length) return crud; // preserve same-row operation order
  const priority = (op) => {
    if (op.table !== "service_tables" || op.op === OP_DELETE) return 1;
    const data = convertValue("service_tables", "data", op.opData?.data);
    const hasParty = Boolean(String(data?.resName || "").trim() || String(data?.resTime || "").trim());
    return tableHasServiceContent(data) || hasParty ? 0 : 2;
  };
  return (crud || []).map((op, index) => ({ op, index, priority: priority(op) }))
    .sort((a, b) => a.priority - b.priority || a.index - b.index)
    .map(({ op }) => op);
}

async function applyMergeableSettingWrite(op, ws, row) {
  const id = String(row.id ?? naturalKeyFromLocalId(op.id, ws));
  try {
    const result = await saveServiceSettingWithCas({
      client: supabase,
      workspaceId: ws,
      id,
      state: row.state ?? {},
      ancestor: convertValue("service_settings", "state", op.previousValues?.state),
    });
    if (result.conflicts?.length) {
      const error = new Error(
        `${id} had concurrent edits; both floor designs were preserved (local edit saved as RECOVERED COPY).`,
      );
      console.warn(error.message, result.conflicts);
      recordClientDiagnostic("floor settings conflict", error);
    }
    return { error: null };
  } catch (error) {
    return { error };
  }
}

async function applyReservationWrite(op, ws, row) {
  const previous = op.previousValues;
  const ancestor = previous ? {
    date: previous.date ?? null,
    table_id: previous.table_id ?? null,
    data: convertValue("reservations", "data", previous.data),
    created_at: previous.created_at ?? null,
  } : null;
  try {
    const result = await saveReservationWithCas({
      client: supabase,
      workspaceId: ws,
      id: op.id,
      date: row.date,
      tableId: row.table_id,
      data: row.data,
      createdAt: row.created_at,
      ancestor,
      allowInsert: op.op !== OP_PATCH,
    });
    if (result.conflicts?.length) {
      const error = new Error(
        `Reservation ${op.id} had concurrent edits; independent changes were merged and the server kept any conflicting table/terrace transition.`,
      );
      console.warn(error.message, result.conflicts);
      recordClientDiagnostic("reservation conflict", error);
    }
    return { error: null };
  } catch (error) {
    return { error };
  }
}

async function applyOp(op) {
  if (!KNOWN_TABLES.has(op.table)) {
    throw new PermanentOpError(`unknown table: ${op.table}`);
  }
  const ws = workspaceForOp(op);
  const from = supabase.from(op.table);

  if (op.op === OP_DELETE) {
    if (op.table === "beverages") {
      // beverages.id is a bigint identity; a non-numeric id means the row was
      // created locally and its DELETE never maps to a server row.
      const id = Number(op.id);
      if (!Number.isFinite(id)) throw new PermanentOpError(`beverages delete with local-only id: ${op.id}`);
      return from.delete().match({ id, workspace_id: ws });
    }
    const nat = NATURAL_KEY[op.table];
    if (nat) {
      const rawKey = op.previousValues?.[nat.column]
        ?? naturalKeyFromLocalId(op.id, ws);
      const key = nat.int ? Number(rawKey) : rawKey;
      if (nat.int && !Number.isFinite(Number(key))) {
        throw new PermanentOpError(`non-numeric ${op.table}.${nat.column} key: ${op.id}`);
      }
      return from.delete().match({ [nat.column]: nat.int ? Number(key) : key, workspace_id: ws });
    }
    return from.delete().match({ id: op.id, workspace_id: ws });
  }

  const row = buildRow(op, ws);

  if (op.table === "service_tables") {
    return applyServiceTableWrite(op, ws, row);
  }

  if (op.table === "service_settings" && MERGEABLE_SETTING_KEYS.has(String(row.id))) {
    return applyMergeableSettingWrite(op, ws, row);
  }

  if (op.table === "reservations") {
    return applyReservationWrite(op, ws, row);
  }

  if (op.table === "beverages") {
    // beverages.id is GENERATED ALWAYS — the server mints ids, so inserts must
    // not carry one. Locally-created rows get a placeholder id that is dropped
    // here; the server row (with its real id) syncs back down and replaces the
    // local placeholder once the checkpoint completes.
    const numericId = Number(op.id);
    delete row.id;
    if (Number.isFinite(numericId)) {
      return from.update(row).match({ id: numericId, workspace_id: ws });
    }
    return from.insert(row);
  }

  const nat = NATURAL_KEY[op.table];

  // A PATCH carries ONLY the columns that changed. Upserting it builds an
  // INSERT tuple with NULL for every absent column, and Postgres checks NOT
  // NULL constraints on that proposed tuple EVEN when the key conflicts and
  // the UPDATE arm would run. So a reservations edit that didn't change
  // `date` died with 23502, was permanently skipped, and the next checkpoint
  // reverted the device — the 08/09.07 "assigned, then it unassigns itself"
  // class (terrace assigns, visit states, archive soft-deletes). A plain
  // UPDATE sets only what the op carries and can never trip absent-column
  // constraints. A PATCH whose server row is gone matches nothing and is
  // dropped — a deleted row must stay deleted, not be resurrected half-empty.
  if (op.op === OP_PATCH) {
    if (nat) {
      const rawKey = row[nat.column] ?? naturalKeyFromLocalId(op.id, ws);
      const key = nat.int ? Number(rawKey) : rawKey;
      return from.update(row).match({ [nat.column]: key, workspace_id: ws });
    }
    const { id: _rowId, ...cols } = row;
    return from.update(cols).match({ id: op.id, workspace_id: ws });
  }

  // PUT carries the full row — the legacy scopedFrom(table).upsert() shape.
  return from.upsert(row, { onConflict: nat ? nat.conflict : "id" });
}

export class SupabaseConnector {
  async fetchCredentials() {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data?.session) {
      // No session → return null so PowerSync waits and retries after login,
      // instead of connecting unauthenticated.
      return null;
    }
    return {
      endpoint: POWERSYNC_URL,
      token: data.session.access_token,
    };
  }

  async uploadData(database) {
    const transaction = await database.getNextCrudTransaction();
    if (!transaction) return;

    const finishPayload = finishServicePayload(transaction.crud);
    if (finishPayload) {
      const { data, error } = await supabase.rpc("archive_and_finish_service", finishPayload);
      if (error) throw error;
      if (data && typeof data === "object" && data.superseded === true) {
        // The store already holds a NEWER service than the one this queued
        // finish was ending: the guard refused the wipe. The archive (when
        // present) was still filed server-side; the queued blanks are dropped
        // and this device adopts the live service on the next sync-down.
        console.warn(
          "[PowerSync] queued end-of-service was superseded by a newer service — board wipe skipped.",
          finishPayload.p_archive_label || "",
        );
      }
      await transaction.complete();
      return;
    }

    for (const op of serviceTableClaimsFirst(transaction.crud)) {
      try {
        const result = await applyOp(op);
        if (result?.error) {
          if (isPermanentError(result.error) && !NEVER_DROP_TABLES.has(op.table)) {
            // Will fail on every retry — log the full op and move on rather
            // than wedging the whole queue behind it.
            console.error("[PowerSync] permanent upload failure — skipping op:", op, result.error);
            continue;
          }
          throw result.error; // transient → engine retries with backoff
        }
      } catch (e) {
        if (e instanceof PermanentOpError) {
          console.error("[PowerSync] unuploadable op — skipping:", op, e.message);
          continue;
        }
        // Network/transient failure: rethrow WITHOUT completing so PowerSync
        // keeps the transaction and retries with backoff.
        throw e;
      }
    }
    await transaction.complete();
  }
}
