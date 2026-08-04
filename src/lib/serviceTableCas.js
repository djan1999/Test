import { foldTableWithMeta } from "../utils/foldTable.js";
import { casExhaustedError } from "./casErrors.js";

const asObject = (value) => {
  if (value && typeof value === "object") return value;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return {};
};

// Content that took WORK to enter — kitchen activity, bottles, any seat with
// drinks/pairings/extras. Deliberately narrower than tableHasServiceContent:
// the reservation skeleton an un-synced device rebuilds (party name + active
// flag + blank seats) must NOT count, or the guard below can't tell it apart
// from the real table it would replace (24.07 incident: six skeletons with
// active:true overwrote six fully-worked tables).
const hasWorkedContent = (t) => {
  if (!t || typeof t !== "object") return false;
  if (t.kitchenLog && Object.keys(t.kitchenLog).length > 0) return true;
  if (Array.isArray(t.bottleWines) && t.bottleWines.length > 0) return true;
  if (t.kitchenSent || t.courseReady) return true;
  return (t.seats || []).some((s) => {
    if (!s || typeof s !== "object") return false;
    if (s.water && s.water !== "—") return true;
    if (s.pairing && s.pairing !== "—") return true;
    if ((s.aperitifs || []).length || (s.glasses || []).length || (s.cocktails || []).length
        || (s.spirits || []).length || (s.beers || []).length) return true;
    if (Object.values(s.extras || {}).some((e) => e?.ordered)) return true;
    if (Object.values(s.optionalPairings || {}).some((p) => p?.ordered)) return true;
    return false;
  });
};

const readServiceTable = async (client, workspaceId, serviceId, tableId) => {
  const { data, error } = await client
    .from("service_tables")
    .select("data,updated_at")
    .eq("workspace_id", workspaceId)
    .eq("service_id", serviceId)
    .eq("table_id", tableId)
    .maybeSingle();
  if (error) throw error;
  return data;
};

const foldServiceTable = ({ tableId, data, ancestor, current }) => {
  const mine = asObject(data);
  const base = ancestor == null ? null : asObject(ancestor);

  if (base == null && current && hasWorkedContent(asObject(current.data)) && !hasWorkedContent(mine)) {
    const error = new Error(
      `Service table ${tableId} holds worked content this device never synced; the un-synced overwrite was refused and the server's table was kept.`,
    );
    error.code = "MILKA_TABLE_CONFLICT";
    error.conflict = "unsynced-overwrite";
    throw error;
  }

  const folded = current
    ? foldTableWithMeta(base, mine, asObject(current.data))
    : { data: mine, conflict: null };
  if (folded.conflict) {
    const error = new Error(
      folded.conflict === "concurrent-clear"
        ? `Service table ${tableId} changed on another device while it was being cleared or moved; the newer table was preserved.`
        : `Service table ${tableId} became occupied by another party; the move/start was refused.`,
    );
    error.code = "MILKA_TABLE_CONFLICT";
    error.conflict = folded.conflict;
    throw error;
  }
  return folded.data;
};

// Shared server write for the busy service-board document. Both PowerSync
// uploads and the direct-Supabase outage fallback use the same merge and
// compare-and-swap contract; otherwise the fallback can erase a tablet edit.
// SERVICE-SCOPED since the entity rework: the row is addressed by
// (workspace, service, table), so a write can only ever land inside the
// service namespace it names — a stale device writing its old service's rows
// touches that old service and nothing else.
export async function saveServiceTableWithCas({
  client,
  workspaceId,
  serviceId,
  tableId,
  data,
  ancestor = null,
  maxAttempts = 4,
}) {
  const id = Number(tableId);
  if (!client || !workspaceId || !serviceId || !Number.isFinite(id)) {
    throw new Error("Invalid service-table CAS request");
  }
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const current = await readServiceTable(client, workspaceId, serviceId, id);

    // A device with NO before-picture (base null: its local DB was reset or it
    // never synced this row) is not entitled to replace a server table that
    // holds worked content with a write that has none. This is the 24.07
    // resume-overwrite class: the fold can't defend the server row because
    // conflict detection needs an ancestor, so refuse outright. The refusal
    // rides the MILKA_TABLE_CONFLICT contract — the uploader drops the
    // gesture, the server row survives, and the device converges to server
    // truth on its next checkpoint.
    const merged = foldServiceTable({ tableId: id, data, ancestor, current });
    const { data: saved, error: saveError } = await client.rpc(
      "save_service_table_if_current",
      {
        p_workspace_id: workspaceId,
        p_service_id: serviceId,
        p_table_id: id,
        p_expected_updated_at: current?.updated_at ?? null,
        p_data: merged,
        p_updated_at: new Date().toISOString(),
      },
    );
    if (saveError) throw saveError;
    if (saved === true) return { data: merged, conflict: null };
  }
  throw casExhaustedError(
    `Service table ${id} kept changing while saving; the server's latest table was kept.`,
  );
}

// Multi-row board gestures (move, swap, layout switch) must commit as one
// unit. The RPC raises a serialization failure when any expected version has
// changed, which rolls the entire function call back before this helper
// re-reads and folds every row again.
export async function saveServiceTablesBatchWithCas({
  client,
  workspaceId,
  serviceId,
  writes,
  maxAttempts = 4,
}) {
  const normalized = (writes || []).map((write) => ({
    tableId: Number(write.tableId),
    data: asObject(write.data),
    ancestor: write.ancestor == null ? null : asObject(write.ancestor),
  }));
  const ids = normalized.map(({ tableId }) => tableId);
  if (!client || !workspaceId || !serviceId || normalized.length < 2
      || ids.some((id) => !Number.isFinite(id)) || new Set(ids).size !== ids.length) {
    throw new Error("Invalid service-table batch CAS request");
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const currentRows = await Promise.all(normalized.map(({ tableId }) => (
      readServiceTable(client, workspaceId, serviceId, tableId)
    )));
    const merged = normalized.map((write, index) => ({
      tableId: write.tableId,
      data: foldServiceTable({ ...write, current: currentRows[index] }),
      expectedUpdatedAt: currentRows[index]?.updated_at ?? null,
    }));
    const { data: saved, error } = await client.rpc(
      "save_service_tables_batch_if_current",
      {
        p_workspace_id: workspaceId,
        p_service_id: serviceId,
        p_rows: merged.map((row) => ({
          table_id: row.tableId,
          expected_updated_at: row.expectedUpdatedAt,
          data: row.data,
        })),
        p_updated_at: new Date().toISOString(),
      },
    );
    if (error && String(error.code || "") !== "40001") throw error;
    if (!error && saved === true) return { rows: merged };
  }

  throw casExhaustedError(
    `Service-table gesture (${ids.join(", ")}) kept changing while saving; it remains queued for retry.`,
  );
}
