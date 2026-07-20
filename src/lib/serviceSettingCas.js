import { foldSettingState } from "../utils/foldSettingState.js";

const asObject = (value) => {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch { return {}; }
  }
  return {};
};

// Version-checked settings save. The read gives us the latest server document;
// the RPC changes it only if updated_at still matches that read. If another
// device wins in between, retry against its new value and fold again.
export async function saveServiceSettingWithCas({
  client,
  workspaceId,
  id,
  state,
  ancestor = null,
  maxAttempts = 4,
}) {
  if (!client || !workspaceId || !id) throw new Error("Invalid service-setting CAS request");
  const mine = asObject(state);
  const base = ancestor == null ? null : asObject(ancestor);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { data: current, error: readError } = await client
      .from("service_settings")
      .select("state,updated_at")
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .maybeSingle();
    if (readError) throw readError;

    const { state: merged, conflicts } = foldSettingState(
      id,
      base,
      mine,
      asObject(current?.state),
    );
    const { data: saved, error: saveError } = await client.rpc(
      "save_service_setting_if_current",
      {
        p_workspace_id: workspaceId,
        p_id: id,
        p_expected_updated_at: current?.updated_at ?? null,
        p_state: merged,
        p_updated_at: new Date().toISOString(),
      },
    );
    if (saveError) throw saveError;
    if (saved === true) return { state: merged, conflicts };
  }
  throw new Error(`Setting ${id} kept changing while saving; retrying later`);
}
