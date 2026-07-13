import { TABLES } from "./supabaseClient.js";
import { scopedFrom } from "./scopedDb.js";

// Audit history is intentionally server-only data: it is not part of the
// PowerSync operational stream. Admin UI components call this seam instead of
// knowing how the database query is built.
export async function fetchAuditLog(limit = 200) {
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
  const { data, error } = await scopedFrom(TABLES.AUDIT_LOG)
    .select("id, actor_id, actor_email, action, entity_type, entity_key, before_data, after_data, created_at")
    .order("created_at", { ascending: false })
    .limit(safeLimit);
  if (error) throw error;
  return data || [];
}
