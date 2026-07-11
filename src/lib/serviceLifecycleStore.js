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
//
// `expected` ({ startedAt, date }) names WHICH service is being ended. When
// provided, the store refuses the whole operation if it no longer holds that
// service — enforced atomically inside the Postgres function on the fallback
// path, and against the local DB's own service_date inside the SQLite
// transaction. A refused end returns { superseded: true } and writes NOTHING:
// no archive, no board blanking, no date clear. This is the store-side half
// of the 11.07 fix for "a stale device's late finish wiped the next service".
export async function finishServiceStore({ client, workspaceId, sqlitePrimary, archive = null, expected = null }) {
  const blankRows = makeBlankServiceRows();
  if (!client || !workspaceId) return { rows: blankRows, superseded: false };

  if (sqlitePrimary) {
    const { finishServiceLocally } = await import("../powersync/writes.js");
    const result = await finishServiceLocally({ archive, blankRows, expected });
    return { rows: blankRows, superseded: !!result?.superseded };
  }

  const { data, error } = await client.rpc("archive_and_finish_service", {
    p_workspace_id: workspaceId,
    p_archive_id: archive?.id || null,
    p_archive_date: archive?.date || null,
    p_archive_label: archive?.label || null,
    p_archive_state: archive?.state || null,
    p_expected_started_at: expected?.startedAt || null,
    p_expected_date: expected?.date || null,
  });
  if (error) throw error;
  return { rows: blankRows, superseded: data?.superseded === true };
}
