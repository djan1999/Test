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

// Board rows are keyed by (workspace, SERVICE, table): the service entity is
// part of the identity, so two services' rows for the same table id can never
// collide — locally or anywhere else.
export function localTableRowId(workspaceId, serviceId, tableId) {
  if (!workspaceId) throw new Error("Cannot build a PowerSync row id without a workspace");
  if (!serviceId) throw new Error("Cannot build a service_tables row id without a service");
  return `${workspaceId}|${String(serviceId)}|${String(tableId)}`;
}

// → { serviceId, tableId } parsed from a service_tables local id, or nulls
// when the id doesn't carry the expected `${ws}|${service}|${table}` shape.
export function tableKeyFromLocalId(id, workspaceId) {
  const value = String(id ?? "");
  const prefix = `${workspaceId}|`;
  if (!workspaceId || !value.startsWith(prefix)) return { serviceId: null, tableId: null };
  const rest = value.slice(prefix.length);
  const cut = rest.lastIndexOf("|");
  if (cut <= 0) return { serviceId: null, tableId: rest || null };
  return { serviceId: rest.slice(0, cut), tableId: rest.slice(cut + 1) };
}
