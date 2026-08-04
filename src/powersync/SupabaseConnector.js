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

import { supabase } from "../lib/supabaseClient.js";
import { POWERSYNC_URL } from "./config.js";
import { naturalKeyFromLocalId, tableKeyFromLocalId } from "./rowId.js";
import { saveServiceTableWithCas } from "../lib/serviceTableCas.js";
import { saveServiceSettingWithCas } from "../lib/serviceSettingCas.js";
import { isMergeableSettingKey } from "../utils/foldSettingState.js";
import { recordClientDiagnostic } from "../lib/clientDiagnostics.js";
import { tableHasServiceContent } from "../utils/tableHelpers.js";
import { saveReservationWithCas } from "../lib/reservationCas.js";
import { CAS_EXHAUSTED_CODE } from "../lib/casErrors.js";

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
  // Board rows are keyed by (workspace, SERVICE, table). The local id alias is
  // `${ws}|${service}|${table}`; buildRow restores both pieces from it when a
  // PATCH doesn't carry the columns.
  service_tables:   { column: "table_id", int: true,  conflict: "workspace_id,service_id,table_id" },
  service_settings: { column: "id",       int: false, conflict: "workspace_id,id" },
  menu_courses:     { column: "position", int: true,  conflict: "workspace_id,position" },
  wines:            { column: "key",      int: false, conflict: "workspace_id,key" },
};

// Tables whose Postgres PK is the plain uuid `id` PowerSync already uses.
const UUID_ID_TABLES = new Set(["reservations", "service_archive", "services"]);

// jsonb columns per table. SQLite stores them as JSON text; PostgREST would
// persist a raw string as a jsonb *string value*, so parse before upload.
const JSON_COLUMNS = {
  service_tables: new Set(["data"]),
  service_settings: new Set(["state"]),
  reservations: new Set(["data"]),
  service_archive: new Set(["state"]),
  services: new Set(["snapshot"]),
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

// A coordinated deployment can make a missing column/RPC/schema-cache error
// succeed later, so operational-table ops with those errors stay queued.
// Deterministic authorization/data/constraint verdicts are diagnosed and
// completed instead: retrying one forever wedges every later device write.
const SCHEMA_RETRY_TABLES = new Set([
  "services", "service_tables", "service_settings", "reservations", "service_archive",
]);

// Postgres error classes that will fail identically on every retry —
// constraint violations, bad data, missing columns/permissions, and PostgREST
// schema-cache errors. Retrying these would wedge the queue forever.
const PERMANENT_ERROR_CODES = [/^22...$/, /^23...$/, /^42...$/, /^PGRST\d+$/];
const isPermanentError = (error) =>
  PERMANENT_ERROR_CODES.some((re) => re.test(String(error?.code || "")));

// These errors cannot become successful by retrying the same local operation.
// Retrying them behind PowerSync's head-of-line queue blocks both uploads and
// incoming checkpoints on the device. Deployment/schema errors remain queued
// so a coordinated backend rollout can still make them succeed later.
const isSkippableOperationalError = (error) => {
  const code = String(error?.code || "");
  return code === "42501" // RLS / insufficient privilege
    || /^22...$/.test(code) // invalid data
    || /^23...$/.test(code); // constraint verdict
};

// Thrown for ops that can never succeed (unknown table, unusable key) so the
// drain loop logs + skips them instead of retrying forever.
class PermanentOpError extends Error {
  constructor(message, code = "POWERSYNC_UNUPLOADABLE") {
    super(message);
    this.code = code;
  }
}

const opIdentity = (op) => ({ table: op.table, op: op.op, id: String(op.id ?? "") });

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
  if (op.table === "service_tables") {
    // Composite (service, table) key — restore BOTH pieces from the local id
    // alias when the op doesn't carry the columns (PATCH ops usually don't).
    const parsed = tableKeyFromLocalId(op.id, workspaceId);
    if (row.service_id == null && parsed.serviceId) row.service_id = parsed.serviceId;
    if (row.table_id == null && parsed.tableId != null) row.table_id = parsed.tableId;
    row.table_id = Number(row.table_id);
    if (!row.service_id || !Number.isFinite(row.table_id)) {
      throw new PermanentOpError(`service_tables op without a resolvable (service, table) key: ${op.id}`);
    }
    row.service_id = String(row.service_id);
    delete row.id;
  } else if (nat) {
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

function workspaceFromAliasedId(op) {
  if (!(op.table in NATURAL_KEY) && op.table !== "service_tables") return null;
  const value = String(op.id ?? "");
  const cut = value.indexOf("|");
  return cut > 0 ? value.slice(0, cut) : null;
}

// Resolve the workspace from immutable operation evidence only. The selected
// workspace is deliberately NOT a fallback: it describes the UI now, not the
// restaurant where an offline operation originated. The local-row lookup
// preserves legacy PATCHes queued before write-time workspace stamping shipped.
async function workspaceForOp(op, database) {
  let ws = op.opData?.workspace_id
    ?? op.previousValues?.workspace_id
    ?? workspaceFromAliasedId(op);
  if (!ws && op.op !== OP_DELETE && database?.getOptional) {
    const local = await database.getOptional(
      `SELECT workspace_id FROM ${op.table} WHERE id = ?`,
      [String(op.id)],
    );
    ws = local?.workspace_id || null;
  }
  if (!ws) {
    throw new PermanentOpError(
      `${op.table} ${op.op} has no provable workspace_id; the operation was not uploaded.`,
      "POWERSYNC_WORKSPACE_UNKNOWN",
    );
  }
  return String(ws);
}

async function checkedMutation(query, op) {
  const projection = NATURAL_KEY[op.table]?.column || "id";
  const result = await query.select(projection);
  if (!result?.error && Array.isArray(result?.data) && result.data.length === 0) {
    throw new PermanentOpError(
      `${op.table} ${op.op} matched no server row; server truth was kept.`,
      "POWERSYNC_ZERO_MATCH",
    );
  }
  return result;
}

// (The finishServicePayload transaction-collapse is GONE. Ending a service is
// now a single UPDATE on ONE services row — there is no multi-row blanking
// transaction to keep atomic, and no code path that can blank the board. A
// queued end from an offline device uploads as that one-row UPDATE and can
// only ever end the old service it names.)

// Service-board rows are busy shared documents: two tablets often edit
// different seats on the same table within seconds. A plain row UPDATE makes
// the last uploader erase the other tablet's work. Read the current server
// row, fold it with PowerSync's tracked ancestor, then commit with a database
// compare-and-swap. If somebody wins the race first, retry against their copy.
async function applyServiceTableWrite(op, ws, row) {
  // buildRow already restored + validated the (service, table) key.
  try {
    await saveServiceTableWithCas({
      client: supabase,
      workspaceId: ws,
      serviceId: row.service_id,
      tableId: Number(row.table_id),
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
// server, its CAS refuses and the WHOLE gesture is dropped (see uploadData) —
// the source blank never uploads, so the party stays on its server table and
// the next checkpoint restores it locally: a refused move simply didn't
// happen. Stable ordering keeps unrelated operations in their original order.
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
    if (result.deleted) {
      const error = new Error(
        `Reservation ${op.id} was deleted on another device; the offline edit was not restored.`,
      );
      error.code = "POWERSYNC_ROW_GONE";
      console.warn(error.message);
      recordClientDiagnostic("reservation edit discarded (row deleted)", error);
    }
    return { error: null };
  } catch (error) {
    return { error };
  }
}

async function applyOp(op, database) {
  if (!KNOWN_TABLES.has(op.table)) {
    throw new PermanentOpError(`unknown table: ${op.table}`);
  }
  const ws = await workspaceForOp(op, database);
  const from = supabase.from(op.table);

  if (op.op === OP_DELETE) {
    if (op.table === "beverages") {
      // beverages.id is a bigint identity; a non-numeric id means the row was
      // created locally and its DELETE never maps to a server row.
      const id = Number(op.id);
      if (!Number.isFinite(id)) throw new PermanentOpError(`beverages delete with local-only id: ${op.id}`);
      return checkedMutation(from.delete().match({ id, workspace_id: ws }), op);
    }
    if (op.table === "service_tables") {
      const parsed = tableKeyFromLocalId(op.id, ws);
      const serviceId = op.previousValues?.service_id ?? parsed.serviceId;
      const tableId = Number(op.previousValues?.table_id ?? parsed.tableId);
      if (!serviceId || !Number.isFinite(tableId)) {
        throw new PermanentOpError(`service_tables delete without a resolvable (service, table) key: ${op.id}`);
      }
      return checkedMutation(
        from.delete().match({ service_id: String(serviceId), table_id: tableId, workspace_id: ws }),
        op,
      );
    }
    const nat = NATURAL_KEY[op.table];
    if (nat) {
      const rawKey = op.previousValues?.[nat.column]
        ?? naturalKeyFromLocalId(op.id, ws);
      const key = nat.int ? Number(rawKey) : rawKey;
      if (nat.int && !Number.isFinite(Number(key))) {
        throw new PermanentOpError(`non-numeric ${op.table}.${nat.column} key: ${op.id}`);
      }
      return checkedMutation(
        from.delete().match({ [nat.column]: nat.int ? Number(key) : key, workspace_id: ws }),
        op,
      );
    }
    return checkedMutation(from.delete().match({ id: op.id, workspace_id: ws }), op);
  }

  const row = buildRow(op, ws);

  if (op.table === "service_tables") {
    return applyServiceTableWrite(op, ws, row);
  }

  if (op.table === "service_settings" && isMergeableSettingKey(String(row.id))) {
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
      return checkedMutation(from.update(row).match({ id: numericId, workspace_id: ws }), op);
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
      return checkedMutation(
        from.update(row).match({ [nat.column]: key, workspace_id: ws }),
        op,
      );
    }
    const { id: _rowId, ...cols } = row;
    return checkedMutation(from.update(cols).match({ id: op.id, workspace_id: ws }), op);
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

    for (const op of serviceTableClaimsFirst(transaction.crud)) {
      try {
        const result = await applyOp(op, database);
        if (result?.error) {
          if (result.error.code === "MILKA_TABLE_CONFLICT") {
            // The CAS refused this board write: the table changed or became
            // occupied under our stale ancestor. That is a VERDICT, not an
            // outage — the fold re-runs against the same ancestor on every
            // retry, so the op can never succeed later. Treating it as
            // transient wedged the queue forever, and since checkpoints are
            // never applied over pending uploads, one refused write froze the
            // whole device in BOTH directions (23.07 Demo drill). Accept the
            // verdict instead: surface it, drop the REST of this gesture
            // (claims-first ordering puts a move's refused destination before
            // its source blank, so nothing is ever erased by the drop), and
            // let the next checkpoint restore server truth locally.
            console.error("[PowerSync] CAS refused board write — dropping the rest of its transaction:", op, result.error.message);
            recordClientDiagnostic("board write refused (newer table kept)", result.error);
            break;
          }
          if (result.error.code === CAS_EXHAUSTED_CODE) {
            console.error("[PowerSync] compare-and-swap exhausted — server truth kept:", opIdentity(op), result.error.message);
            recordClientDiagnostic(`${op.table} concurrent edit not applied`, result.error);
            if (op.table === "service_tables") break;
            continue;
          }
          if (isPermanentError(result.error)
              && (!SCHEMA_RETRY_TABLES.has(op.table) || isSkippableOperationalError(result.error))) {
            // Will fail on every retry — log the operation identity and move on rather
            // than wedging the whole queue behind it.
            console.error("[PowerSync] permanent upload failure — skipping op:", opIdentity(op), result.error);
            recordClientDiagnostic(`${op.table} upload rejected`, result.error);
            if (op.table === "service_tables") break;
            continue;
          }
          throw result.error; // transient → engine retries with backoff
        }
      } catch (e) {
        if (e instanceof PermanentOpError) {
          console.error("[PowerSync] unuploadable op — skipping:", opIdentity(op), e.message);
          recordClientDiagnostic(`${op.table} operation skipped`, e);
          if (op.table === "service_tables") break;
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
