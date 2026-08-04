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
  const mine = asObject(data);
  const base = ancestor == null ? null : asObject(ancestor);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { data: current, error: readError } = await client
      .from("service_tables")
      .select("data,updated_at")
      .eq("workspace_id", workspaceId)
      .eq("service_id", serviceId)
      .eq("table_id", id)
      .maybeSingle();
    if (readError) throw readError;

    // A device with NO before-picture (base null: its local DB was reset or it
    // never synced this row) is not entitled to replace a server table that
    // holds worked content with a write that has none. This is the 24.07
    // resume-overwrite class: the fold can't defend the server row because
    // conflict detection needs an ancestor, so refuse outright. The refusal
    // rides the MILKA_TABLE_CONFLICT contract — the uploader drops the
    // gesture, the server row survives, and the device converges to server
    // truth on its next checkpoint.
    if (base == null && current && hasWorkedContent(asObject(current.data)) && !hasWorkedContent(mine)) {
      const error = new Error(
        `Service table ${id} holds worked content this device never synced; the un-synced overwrite was refused and the server's table was kept.`,
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
          ? `Service table ${id} changed on another device while it was being cleared or moved; the newer table was preserved.`
          : `Service table ${id} became occupied by another party; the move/start was refused.`,
      );
      error.code = "MILKA_TABLE_CONFLICT";
      error.conflict = folded.conflict;
      throw error;
    }
    const merged = folded.data;
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
