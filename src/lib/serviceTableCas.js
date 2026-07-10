import { foldTable } from "../utils/foldTable.js";

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

    const merged = current ? foldTable(base, mine, asObject(current.data)) : mine;
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
    if (saved === true) return { data: merged };
  }
  throw new Error(`Service table ${id} kept changing while saving; retrying later`);
}
