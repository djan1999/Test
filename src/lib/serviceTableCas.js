import { foldTableWithMeta } from "../utils/foldTable.js";

const asObject = (value) => {
  if (value && typeof value === "object") return value;
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return {}; }
  }
  return {};
};

// Shared server write for the busy service-board document. Both PowerSync
// uploads and the direct-Supabase outage fallback use the same merge and
// compare-and-swap contract; otherwise the fallback can erase a tablet edit.
export async function saveServiceTableWithCas({
  client,
  workspaceId,
  tableId,
  data,
  ancestor = null,
  maxAttempts = 4,
}) {
  const id = Number(tableId);
  if (!client || !workspaceId || !Number.isFinite(id)) {
    throw new Error("Invalid service-table CAS request");
  }
  const mine = asObject(data);
  const base = ancestor == null ? null : asObject(ancestor);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { data: current, error: readError } = await client
      .from("service_tables")
      .select("data,updated_at")
      .eq("workspace_id", workspaceId)
      .eq("table_id", id)
      .maybeSingle();
    if (readError) throw readError;

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
        p_table_id: id,
        p_expected_updated_at: current?.updated_at ?? null,
        p_data: merged,
        p_updated_at: new Date().toISOString(),
      },
    );
    if (saveError) throw saveError;
    if (saved === true) return { data: merged, conflict: null };
  }
  throw new Error(`Service table ${id} kept changing while saving; retrying later`);
}
