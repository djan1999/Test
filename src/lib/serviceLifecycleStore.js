export function makeBlankServiceRows(now = new Date().toISOString()) {
  return Array.from({ length: 10 }, (_, index) => ({
    table_id: index + 1,
    data: {},
    updated_at: now,
  }));
}

// One persistence boundary for ending a service. The caller owns only the UI
// transition after this succeeds; it must never reproduce the individual
// archive/table/settings writes in a component.
export async function finishServiceStore({ client, workspaceId, sqlitePrimary, archive = null }) {
  const blankRows = makeBlankServiceRows();
  if (!client || !workspaceId) return blankRows;

  if (sqlitePrimary) {
    const { finishServiceLocally } = await import("../powersync/writes.js");
    await finishServiceLocally({ archive, blankRows });
    return blankRows;
  }

  const { error } = await client.rpc("archive_and_finish_service", {
    p_workspace_id: workspaceId,
    p_archive_id: archive?.id || null,
    p_archive_date: archive?.date || null,
    p_archive_label: archive?.label || null,
    p_archive_state: archive?.state || null,
  });
  if (error) throw error;
  return blankRows;
}
