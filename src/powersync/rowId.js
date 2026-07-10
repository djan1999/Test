// PowerSync requires one globally unique text `id` per local table. Several
// Postgres tables use a workspace-scoped natural key instead, so the local id
// must include BOTH pieces. Without the workspace prefix, table 3 (or a wine
// key) in one restaurant can overwrite the same key from another restaurant.

export function localRowId(workspaceId, naturalKey) {
  if (!workspaceId) throw new Error("Cannot build a PowerSync row id without a workspace");
  return `${workspaceId}|${String(naturalKey)}`;
}

export function naturalKeyFromLocalId(id, workspaceId) {
  const value = String(id ?? "");
  const prefix = `${workspaceId}|`;
  return workspaceId && value.startsWith(prefix) ? value.slice(prefix.length) : value;
}
