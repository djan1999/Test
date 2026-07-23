// SERVICE LIFECYCLE store seam — the ONLY module that persists lifecycle
// transitions. Local-first when the on-device SQLite DB is primary (uploads
// ride the PowerSync queue), direct Supabase otherwise.
//
// Every operation here is NON-DESTRUCTIVE by construction:
//   startService  → INSERT a new services row (a fresh board namespace —
//                   nothing is cleared; the new service simply has no rows).
//   endService    → UPDATE that one row to status='ended'. Idempotent; the
//                   ended service IS the archive entry.
//   resumeService → UPDATE that one row back to status='live'. The single-live
//                   trigger arbitrates, so a resume can never displace a newer
//                   live service — it just re-ends as 'superseded'.
//   updateService → field patch (re-date heal, session relabel).
// There is no operation that blanks service_tables. A stale device replaying
// any of these can only affect the old service row it already knows about.

import { supabase, getWorkspaceId, TABLES } from "./supabaseClient.js";
import { scopedFrom } from "./scopedDb.js";
import { isSqlitePrimary } from "../powersync/primary.js";
import { isSandbox } from "./sandbox.js";
import { randomUuid } from "../utils/uuid.js";
import { sanitizeService, currentServiceFrom } from "./serviceEntity.js";

const nowISO = () => new Date().toISOString();

// ── reads ───────────────────────────────────────────────────────────────────

// All services rows for the workspace (newest first, bounded — the archive
// view and the boot check never need more).
export async function fetchServicesStore(limit = 120) {
  if (!supabase || !getWorkspaceId()) throw new Error("no active workspace");
  if (isSqlitePrimary()) {
    const { readServices } = await import("../powersync/reads.js");
    return readServices(limit);
  }
  const { data, error } = await scopedFrom(TABLES.SERVICES)
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// The live service the whole restaurant should be on, or null.
export async function readLiveServiceStore() {
  const rows = await fetchServicesStore(20);
  return currentServiceFrom(rows);
}

// Labels already taken on one service day — the "… · 2" dedup input for an
// ending service's label. Ended services AND legacy archive rows both count.
export async function fetchSameDayLabelsStore(date) {
  if (!supabase || !getWorkspaceId() || !date) return [];
  if (isSqlitePrimary()) {
    const { readActiveArchivesForDate } = await import("../powersync/reads.js");
    return readActiveArchivesForDate(date);
  }
  const [legacy, ended] = await Promise.all([
    scopedFrom(TABLES.SERVICE_ARCHIVE)
      .select("id, label").eq("date", date).is("deleted_at", null),
    scopedFrom(TABLES.SERVICES)
      .select("id, label").eq("date", date).eq("status", "ended")
      .is("deleted_at", null).not("label", "is", null),
  ]);
  if (legacy.error) throw legacy.error;
  return [...(legacy.data || []), ...(ended.error ? [] : (ended.data || []))];
}

// ── writes ──────────────────────────────────────────────────────────────────

// Start a service: mint the entity client-side (the id must exist before any
// board row can reference it, offline included) and persist it. The server's
// single-live trigger ends any other live service — non-destructively.
export async function startServiceStore({ date, session = "dinner", chosenOn = null }) {
  const entity = sanitizeService({
    id: randomUuid(),
    workspace_id: getWorkspaceId(),
    date,
    session,
    chosen_on: chosenOn || date,
    started_at: nowISO(),
    status: "live",
    updated_at: nowISO(),
  });
  if (!entity?.date) return { ok: false, error: new Error("a service needs a date") };
  if (!supabase || !getWorkspaceId() || isSandbox()) return { ok: true, service: entity, persisted: false };
  try {
    if (isSqlitePrimary()) {
      const { insertServiceLocally } = await import("../powersync/writes.js");
      await insertServiceLocally(entity);
    } else {
      const { error } = await scopedFrom(TABLES.SERVICES).insert({
        id: entity.id,
        date: entity.date,
        session: entity.session,
        chosen_on: entity.chosenOn,
        started_at: entity.startedAt,
        status: "live",
        updated_at: entity.updatedAt,
      });
      if (error) throw error;
    }
    return { ok: true, service: entity, persisted: true };
  } catch (error) {
    return { ok: false, error };
  }
}

// End a service: one idempotent status flip on ONE row, addressed by id.
// `label` / `snapshot` decorate the archive entry; both optional — an end
// with neither still preserves every table row.
export async function endServiceStore(serviceId, { reason = "manual", label = null, snapshot = null } = {}) {
  if (!serviceId) return { ok: false, error: new Error("no service to end") };
  if (!supabase || !getWorkspaceId() || isSandbox()) return { ok: true, persisted: false };
  const patch = {
    status: "ended",
    ended_at: nowISO(),
    end_reason: reason,
    ...(label ? { label } : {}),
    ...(snapshot ? { snapshot } : {}),
    updated_at: nowISO(),
  };
  try {
    if (isSqlitePrimary()) {
      const { updateServiceLocally } = await import("../powersync/writes.js");
      await updateServiceLocally(serviceId, patch);
    } else {
      const { error } = await scopedFrom(TABLES.SERVICES)
        .update(patch)
        .eq("id", serviceId);
      if (error) throw error;
    }
    return { ok: true, persisted: true };
  } catch (error) {
    return { ok: false, error };
  }
}

// Resume an ENDED service: flip its one row back to 'live'. Nothing was
// deleted when it ended — its board rows are all still keyed to its id — so
// this alone brings the whole board back on every device. The single-live
// trigger still arbitrates: if a NEWER live service exists, the resumed row
// is immediately re-ended ('superseded'), so a resume can never hijack a
// service that is actually running. The result reports the store's honest
// verdict: `resumed: false` means the store refused (a newer live row won).
export async function resumeServiceStore(serviceId) {
  if (!serviceId) return { ok: false, error: new Error("no service to resume") };
  if (!supabase || !getWorkspaceId() || isSandbox()) {
    return { ok: false, error: new Error("resume needs a connected workspace") };
  }
  const patch = {
    status: "live",
    ended_at: null,
    end_reason: null,
    // The label was minted for the ENDED entry; re-ending mints a fresh one.
    label: null,
    deleted_at: null,
    updated_at: nowISO(),
  };
  try {
    if (isSqlitePrimary()) {
      const { updateServiceLocally } = await import("../powersync/writes.js");
      await updateServiceLocally(serviceId, patch);
    } else {
      const { error } = await scopedFrom(TABLES.SERVICES)
        .update(patch)
        .eq("id", serviceId);
      if (error) throw error;
    }
    const live = await readLiveServiceStore();
    return { ok: true, persisted: true, resumed: Boolean(live && live.id === serviceId), live };
  } catch (error) {
    return { ok: false, error };
  }
}

// Patch a service's descriptive fields (the re-date heal for a live service
// running under a rolled-over date, a session relabel). Safe: one row, by id.
export async function updateServiceStore(serviceId, patch) {
  if (!serviceId || !patch) return { ok: false, error: new Error("nothing to update") };
  if (!supabase || !getWorkspaceId() || isSandbox()) return { ok: true, persisted: false };
  const row = { ...patch, updated_at: nowISO() };
  try {
    if (isSqlitePrimary()) {
      const { updateServiceLocally } = await import("../powersync/writes.js");
      await updateServiceLocally(serviceId, row);
    } else {
      const { error } = await scopedFrom(TABLES.SERVICES)
        .update(row)
        .eq("id", serviceId);
      if (error) throw error;
    }
    return { ok: true, persisted: true };
  } catch (error) {
    return { ok: false, error };
  }
}
