// THE LOGBOOK SEAM — the only module that appends to the service_events log
// (docs/EVENT_LOG_PLAN.md). Every gesture becomes one small immutable fact;
// the database enforces that facts can only ever be APPENDED, so nothing that
// goes through here can overwrite or erase anything.
//
// Phase-1 contract for callers:
//   • appendServiceEvent() is fire-and-forget and MUST NOT be awaited on any
//     user path — the card system stays the source of truth, and a dead
//     network or a missing table can never affect service. Events queue in
//     localStorage (per workspace, capped) and drain on the heartbeat /
//     online signal / next append.
//   • Idempotent by identity: every event carries a client-minted uuid and
//     the upload ignores duplicates, so replaying a queue can never
//     double-append.
//   • Attribution: every fact names the DEVICE that produced it (a per-tablet
//     id minted once); the author account is stamped at upload from the live
//     session (the RLS policy requires actor_id = auth.uid()).
//   • Permanent refusals (a purged service's FK, an RLS verdict, bad data)
//     DROP the event with a diagnostic — the queue must never wedge behind a
//     fact the server will refuse forever.

import { supabase, getWorkspaceId } from "./supabaseClient.js";
import { randomUuid } from "../utils/uuid.js";
import { recordClientDiagnostic } from "./clientDiagnostics.js";

const QUEUE_KEY_PREFIX = "milka_event_queue:";
const DEVICE_ID_KEY = "milka_device_id";
const QUEUE_CAP = 500; // drop-oldest beyond this — the log is additive telemetry in Phase 1
const UPLOAD_CHUNK = 50;

// Errors that will refuse this exact event forever — retrying wedges the
// queue behind it. 23xxx (constraint/FK: e.g. the service was purged before
// the queue drained), 42501 (RLS verdict), 22xxx (bad data).
const isPermanentRefusal = (error) => /^(22|23)|^42501$/.test(String(error?.code || ""));

const queueKey = (workspaceId) => `${QUEUE_KEY_PREFIX}${workspaceId}`;

export function getDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = randomUuid();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return "unknown-device";
  }
}

function readQueue(workspaceId) {
  try {
    const raw = localStorage.getItem(queueKey(workspaceId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(workspaceId, events) {
  try {
    localStorage.setItem(queueKey(workspaceId), JSON.stringify(events));
  } catch { /* storage full/unavailable — the events stay in memory-of-nothing; never throw */ }
}

// Pending facts not yet accepted by the server (the SYSTEM panel readout).
export function pendingServiceEventCount(workspaceId = getWorkspaceId()) {
  if (!workspaceId) return 0;
  return readQueue(workspaceId).length;
}

/**
 * Append one fact to the logbook. Fire-and-forget: queues locally, then kicks
 * an async drain. Returns the queued event (or null when there is nothing to
 * attach it to — no workspace/service means no log line).
 */
export function appendServiceEvent({ serviceId, type, tableId = null, payload = {} }) {
  const workspaceId = getWorkspaceId();
  if (!supabase || !workspaceId || !serviceId || !type) return null;
  const event = {
    event_id: randomUuid(),
    service_id: String(serviceId),
    device_id: getDeviceId(),
    type: String(type),
    table_id: tableId == null ? null : Number(tableId),
    payload: payload ?? {},
    client_ts: new Date().toISOString(),
  };
  const queue = readQueue(workspaceId);
  queue.push(event);
  if (queue.length > QUEUE_CAP) {
    const dropped = queue.length - QUEUE_CAP;
    queue.splice(0, dropped);
    console.warn(`[eventLog] queue over cap — dropped ${dropped} oldest fact(s)`);
  }
  writeQueue(workspaceId, queue);
  void drainServiceEvents(workspaceId);
  return event;
}

// How many facts the SERVER holds for a service (the SYSTEM panel's proof of
// life for the logbook). Head-only count — no rows travel.
export async function countServiceEvents(serviceId, workspaceId = getWorkspaceId()) {
  if (!supabase || !workspaceId || !serviceId) return 0;
  const { count, error } = await supabase
    .from("service_events")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("service_id", String(serviceId));
  if (error) throw error;
  return count || 0;
}

// A service's facts, server-ordered. `ascending` false reads the tail (the
// story view); the parity checker reads the whole log ascending.
export async function readServiceEvents(serviceId, { limit = 5000, ascending = true } = {}, workspaceId = getWorkspaceId()) {
  if (!supabase || !workspaceId || !serviceId) return [];
  const { data, error } = await supabase
    .from("service_events")
    .select("id, device_id, type, table_id, payload, client_ts, recorded_at")
    .eq("workspace_id", workspaceId)
    .eq("service_id", String(serviceId))
    .order("id", { ascending })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// Single-flight drain per workspace.
const drainingFor = new Set();

/**
 * Upload queued facts, oldest first, in chunks, ignoring duplicates. Keeps
 * the remainder on any transient failure; DROPS (with a diagnostic) events
 * the server refuses permanently. Safe to call at any time from anywhere.
 */
export async function drainServiceEvents(workspaceId = getWorkspaceId()) {
  if (!supabase || !workspaceId || drainingFor.has(workspaceId)) return { ok: true, uploaded: 0 };
  drainingFor.add(workspaceId);
  let uploaded = 0;
  try {
    for (;;) {
      const queue = readQueue(workspaceId);
      if (queue.length === 0) return { ok: true, uploaded };
      const chunk = queue.slice(0, UPLOAD_CHUNK);
      let actorId = null;
      try {
        const { data } = await supabase.auth.getSession();
        actorId = data?.session?.user?.id || null;
      } catch { /* no session — the insert will be refused and retried later */ }
      const rows = chunk.map((event) => ({
        ...event,
        workspace_id: workspaceId,
        actor_id: actorId,
      }));
      const { error } = await supabase
        .from("service_events")
        .upsert(rows, { onConflict: "workspace_id,event_id", ignoreDuplicates: true });
      if (error) {
        if (!isPermanentRefusal(error)) return { ok: false, uploaded, error }; // transient — retry later
        // A permanent verdict on the batch: isolate it by uploading one by
        // one, dropping exactly the refused fact(s) so the queue never wedges.
        for (const event of chunk) {
          const { error: single } = await supabase
            .from("service_events")
            .upsert([{ ...event, workspace_id: workspaceId, actor_id: actorId }], {
              onConflict: "workspace_id,event_id",
              ignoreDuplicates: true,
            });
          const current = readQueue(workspaceId);
          if (!single) {
            writeQueue(workspaceId, current.filter((queued) => queued.event_id !== event.event_id));
            uploaded += 1;
          } else if (isPermanentRefusal(single)) {
            writeQueue(workspaceId, current.filter((queued) => queued.event_id !== event.event_id));
            recordClientDiagnostic("event log append refused", single);
            console.warn("[eventLog] fact refused permanently — dropped:", event.type, single.code);
          } else {
            return { ok: false, uploaded, error: single }; // transient mid-batch
          }
        }
        continue;
      }
      const remaining = readQueue(workspaceId);
      const sent = new Set(chunk.map((event) => event.event_id));
      writeQueue(workspaceId, remaining.filter((queued) => !sent.has(queued.event_id)));
      uploaded += chunk.length;
    }
  } finally {
    drainingFor.delete(workspaceId);
  }
}
