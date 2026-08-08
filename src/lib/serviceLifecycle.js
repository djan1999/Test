// SERVICE LIFECYCLE store seam — the ONLY module that persists lifecycle
// transitions. Local-first when the on-device SQLite DB is primary (uploads
// ride the PowerSync queue), direct Supabase otherwise.
//
// Every operation here is NON-DESTRUCTIVE by construction:
//   startService  → INSERT a new services row (a fresh board namespace —
//                   nothing is cleared; the new service simply has no rows).
//                   Guarded: a device that cannot SEE the running service
//                   (un-synced local mirror) JOINS it instead of superseding
//                   it — see the blind-start guard on startServiceStore.
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
import { isStaleServiceDate, isActivePastReview } from "../utils/serviceDay.js";

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

// SERVER-TRUTH live-service read — deliberately bypasses the local mirror
// even when SQLite is primary. Boot-time decisions ("is a service already
// running?") must never be made from a freshly opened device's local
// database: its persisted first-sync flag makes it sqlite-primary the moment
// it opens, BEFORE this session's first checkpoint lands, so the local mirror
// can predate today's service entirely. Throws when the server is
// unreachable — callers fall back to their local knowledge, never the other
// way around.
export async function fetchLiveServiceFromServer({ timeoutMs = 3500 } = {}) {
  if (!supabase || !getWorkspaceId()) throw new Error("no active workspace");
  let timer;
  try {
    const read = Promise.resolve(
      scopedFrom(TABLES.SERVICES)
        .select("*")
        .eq("status", "live")
        .order("started_at", { ascending: false })
        .limit(5),
    );
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("live-service check timed out")), timeoutMs);
    });
    const { data, error } = await Promise.race([read, timeout]);
    if (error) throw error;
    return currentServiceFrom(data || []);
  } finally {
    clearTimeout(timer);
  }
}

// A live service is only a JOIN target while its date is current (or an
// active past-day review). A stale-dated live row is an abandoned night the
// boot check will file, not a service to drop into.
const isJoinableLiveService = (svc) =>
  Boolean(svc && svc.date && (!isStaleServiceDate(svc.date) || isActivePastReview(svc.date, svc.chosenOn)));

// The server's live service — IF this device has no newer knowledge of it.
// Returns the entity to JOIN, or null when the caller may proceed (prompt /
// start). Comparing the server row against the local store's copy of the
// SAME row decides who knows more:
//   • absent locally → the device is behind (un-synced mirror); JOIN.
//   • live locally   → both agree; JOIN.
//   • ended locally with a local updated_at >= the server's → this device
//     holds the newer verdict (its own end is still uploading); not live.
//   • ended locally but the server's copy is newer → it was RESUMED on
//     another device and this one hasn't synced the resume yet; JOIN.
// `knownLiveId` names the live service the caller can already see and is
// deliberately replacing — never a join target.
export async function confirmJoinableLiveService({ knownLiveId = null } = {}) {
  const remote = await fetchLiveServiceFromServer();
  if (!isJoinableLiveService(remote)) return null;
  if (knownLiveId && String(remote.id) === String(knownLiveId)) return null;
  let localRows = [];
  try { localRows = await fetchServicesStore(20); } catch { /* no local view yet */ }
  const local = (localRows || []).map(sanitizeService).find((s) => s && s.id === remote.id);
  if (local && local.status === "ended") {
    const localTs = Date.parse(local.updatedAt || "") || 0;
    const remoteTs = Date.parse(remote.updatedAt || "") || 0;
    if (localTs >= remoteTs) return null;
  }
  return remote;
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
//
// ── Blind-start guard ──────────────────────────────────────────────────────
// Starting is the ONLY lifecycle write that can displace the running service
// (the single-live trigger ends it as 'superseded', and every device adopts
// the new empty namespace — the whole restaurant's board resets). The
// reset-mid-service incidents all shared one shape: a freshly opened device
// couldn't SEE the live service, because its local mirror predated this
// session's first checkpoint — so the app offered START, and one tap on the
// date picker superseded the running board. The guard makes that ignorance
// non-destructive: confirm against the SERVER first, and a live service this
// device didn't name in `knownLiveId` is JOINED, never displaced. A device
// that names the live row it replaces (the confirmed day-switch and
// session-flip flows) still supersedes exactly as designed, and with no
// server AND no local evidence of a live service the start proceeds — an
// offline day-open must keep working.
export async function startServiceStore({ date, session = "dinner", chosenOn = null, knownLiveId = null }) {
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
    const live = await confirmJoinableLiveService({ knownLiveId });
    if (live) return { ok: true, service: live, joined: true, persisted: false };
  } catch {
    // Server unreachable — the local store is the only remaining evidence.
    try {
      const live = await readLiveServiceStore();
      if (isJoinableLiveService(live) && (!knownLiveId || String(live.id) !== String(knownLiveId))) {
        return { ok: true, service: live, joined: true, persisted: false };
      }
    } catch { /* nothing readable (fresh offline boot) — proceed with the start */ }
  }
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
