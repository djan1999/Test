import { supabase, getWorkspaceId } from "./supabaseClient.js";

// Tables whose primary key is composite (workspace_id + a natural key). Upserts
// against these must target the composite conflict columns or PostgREST errors.
const COMPOSITE_CONFLICT = {
  service_tables: "workspace_id,table_id",
  service_settings: "workspace_id,id",
  menu_courses: "workspace_id,position",
  wines: "workspace_id,key",
};

const stamp = (row, ws) => ({ ...row, workspace_id: ws });

/**
 * Thin wrapper around `supabase.from(table)` that scopes every query to the
 * current workspace:
 *   - select / delete  → adds `.eq('workspace_id', ws)` to the filter
 *   - insert / upsert   → stamps `workspace_id` into the payload (and rewrites
 *                         upsert `onConflict` to the composite key)
 *   - update            → stamps `workspace_id` into the SET *and* the filter
 *
 * The returned builders are the real PostgREST builders, so call sites can keep
 * chaining `.eq('id', …)`, `.match(…)`, `.order(…)`, `.single()`, etc.
 *
 * Awkward filters that this can't model (e.g. `.not('position','in',…)`) should
 * call `supabase.from(...)` directly and append
 * `.eq('workspace_id', getWorkspaceId())` by hand.
 */
export function scopedFrom(table) {
  const ws = getWorkspaceId();
  const base = () => supabase.from(table);
  return {
    select: (cols, opts) => base().select(cols, opts).eq("workspace_id", ws),
    insert: (payload, opts) => {
      const body = Array.isArray(payload)
        ? payload.map((r) => stamp(r, ws))
        : stamp(payload, ws);
      return base().insert(body, opts);
    },
    upsert: (payload, opts = {}) => {
      const body = Array.isArray(payload)
        ? payload.map((r) => stamp(r, ws))
        : stamp(payload, ws);
      const onConflict = COMPOSITE_CONFLICT[table] || opts.onConflict;
      return base().upsert(body, { ...opts, onConflict });
    },
    update: (payload, opts) =>
      base().update(stamp(payload, ws), opts).eq("workspace_id", ws),
    delete: (opts) => base().delete(opts).eq("workspace_id", ws),
  };
}

/**
 * Stamp an offline-queue job with the current workspace at ENQUEUE time. Queued
 * jobs are replayed verbatim by useOfflineQueue (not through scopedFrom), so the
 * workspace they were created in must travel with them — a write made in one
 * restaurant must never flush into another after the user switches profiles.
 */
export function scopeJob(job) {
  const ws = getWorkspaceId();
  if (!ws || !job) return job;
  const stampRow = (r) => ({ ...r, workspace_id: ws });
  const next = { ...job, workspaceId: ws };
  if ((job.op === "insert" || job.op === "upsert" || job.op === "update") && job.payload != null) {
    next.payload = Array.isArray(job.payload) ? job.payload.map(stampRow) : stampRow(job.payload);
  }
  if (job.op === "update" || job.op === "delete") {
    next.match = { ...(job.match || {}), workspace_id: ws };
  }
  if (job.op === "upsert" && COMPOSITE_CONFLICT[job.table]) {
    next.options = { ...(job.options || {}), onConflict: COMPOSITE_CONFLICT[job.table] };
  }
  return next;
}

export { COMPOSITE_CONFLICT };
