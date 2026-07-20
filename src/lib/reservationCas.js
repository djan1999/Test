import { foldReservationRow } from "../utils/foldReservation.js";

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

const normalizeRow = (row) => row ? {
  date: row.date ?? null,
  table_id: row.table_id == null ? null : Number(row.table_id),
  data: asObject(row.data),
  created_at: row.created_at ?? null,
} : null;

// Reservations have no updated_at column, so their CAS compares the exact
// date/table/data snapshot read immediately before the write. The database
// changes the row only while all three still match; otherwise this helper
// re-reads, folds independent edits and retries.
export async function saveReservationWithCas({
  client,
  workspaceId,
  id,
  date,
  tableId,
  data,
  createdAt = null,
  ancestor = null,
  allowInsert = false,
  maxAttempts = 4,
}) {
  if (!client || !workspaceId || !id) throw new Error("Invalid reservation CAS request");
  const base = normalizeRow(ancestor);

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const { data: currentRaw, error: readError } = await client
      .from("reservations")
      .select("date,table_id,data,created_at")
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .maybeSingle();
    if (readError) throw readError;
    const current = normalizeRow(currentRaw);

    if (!current && !allowInsert) return { row: null, conflicts: [], deleted: true };
    const mine = normalizeRow({
      date: date ?? base?.date ?? current?.date,
      table_id: tableId ?? base?.table_id ?? current?.table_id,
      data: data ?? base?.data ?? current?.data,
      created_at: createdAt ?? base?.created_at ?? current?.created_at,
    });
    if (!mine.date || !Number.isFinite(mine.table_id)) {
      throw new Error(`Reservation ${id} is missing its date or table assignment`);
    }

    const folded = current
      ? foldReservationRow(base, mine, current)
      : { row: mine, conflicts: [] };
    const { data: saved, error: saveError } = await client.rpc(
      "save_reservation_if_current",
      {
        p_workspace_id: workspaceId,
        p_id: id,
        p_expected_date: current?.date ?? null,
        p_expected_table_id: current?.table_id ?? null,
        p_expected_data: current?.data ?? null,
        p_date: folded.row.date,
        p_table_id: folded.row.table_id,
        p_data: folded.row.data,
        p_created_at: folded.row.created_at || createdAt || new Date().toISOString(),
      },
    );
    if (saveError) throw saveError;
    if (saved === true) return { row: folded.row, conflicts: folded.conflicts, deleted: false };
  }
  throw new Error(`Reservation ${id} kept changing while saving; retrying later`);
}
