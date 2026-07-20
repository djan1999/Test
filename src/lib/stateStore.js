// Shared service_settings key/value store seam: one read + one write helper
// that pick the on-device SQLite DB when it is primary (see
// powersync/primary.js) and fall back to a direct Supabase call otherwise.
// Used by App.jsx and by the admin/menu components that own their own
// settings rows (inventory, menu generator texts) — so every settings blob
// gets offline-capable writes for free.

import { supabase, getWorkspaceId, TABLES } from "./supabaseClient.js";
import { scopedFrom } from "./scopedDb.js";
import { isSqlitePrimary } from "../powersync/primary.js";
import { isSandbox } from "./sandbox.js";
import { saveServiceSettingWithCas } from "./serviceSettingCas.js";
import { MERGEABLE_SETTING_KEYS } from "../utils/foldSettingState.js";
import { recordClientDiagnostic } from "./clientDiagnostics.js";

// → the state object, or null when the row doesn't exist. Throws on real
// read failures (callers that seed defaults on "empty" rely on the
// distinction).
export async function readStateKey(id) {
  // No active workspace yet (boot / the workspace-picker screen): fail fast
  // like any other read failure instead of hitting PostgREST, which rejects
  // `workspace_id=eq.null` with a 400 and floods the Postgres logs with uuid
  // parse errors. Callers already treat a throw as "keep cached, retry later",
  // and the loaders re-run once a workspace is applied.
  if (!supabase || !getWorkspaceId()) throw new Error("no active workspace");
  if (isSqlitePrimary()) {
    const { readSetting } = await import("../powersync/reads.js");
    return readSetting(id);
  }
  const { data, error } = await scopedFrom(TABLES.SERVICE_SETTINGS)
    .select("state").eq("id", id).maybeSingle();
  if (error) throw error;
  return data?.state ?? null;
}

// One raw write, path picked at WRITE time — so a queued retry that fires
// after the device flips to sqlite-primary rides the durable PowerSync queue.
async function writeStateKeyOnce(id, state, ancestor = null, workspaceId = getWorkspaceId()) {
  // A retained write may outlive a workspace switch. It can use the active
  // SQLite database only while it still belongs to that same workspace;
  // otherwise send it directly to its captured workspace in Supabase.
  if (isSqlitePrimary() && workspaceId === getWorkspaceId()) {
    const { writeSetting } = await import("../powersync/writes.js");
    await writeSetting(id, state);
    return { state, conflicts: [] };
  }
  if (MERGEABLE_SETTING_KEYS.has(id)) {
    const result = await saveServiceSettingWithCas({
      client: supabase,
      workspaceId,
      id,
      state,
      ancestor,
    });
    if (result.conflicts?.length) {
      const error = new Error(
        `${id} had concurrent edits; both floor designs were preserved (local edit saved as RECOVERED COPY).`,
      );
      console.warn(error.message, result.conflicts);
      recordClientDiagnostic("floor settings conflict", error);
    }
    return result;
  }
  const { error } = await scopedFrom(TABLES.SERVICE_SETTINGS, workspaceId)
    .upsert({ id, state, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw error;
  return { state, conflicts: [] };
}

// Per-key write queues. The fallback upsert used to fire-and-forget: on a
// network blip the write returned {ok:false}, nearly every caller ignored it,
// and the setting (floor SET markers, kitchen ticket order, the service
// date…) silently never reached the store while the device kept showing it
// locally. Now every key gets:
//   • SERIALIZED writes — one in flight per key, later calls chain behind it,
//     so two rapid saves can never race out of order at the server;
//   • LATEST-VALUE-WINS — each attempt writes the key's newest value; a retry
//     can never resurrect an older value over a newer one;
//   • RETRY with capped backoff after a failure, plus a flush when the
//     browser's 'online' signal fires.
// Callers still get an honest result for THEIR attempt ({ok:false} shows
// their error UI), but the value is retained and keeps retrying.
const queues = new Map(); // workspace+id → { workspaceId,id,latest,chain,attempts,retryTimer,retainedAt }
const queueKey = (workspaceId, id) => `${workspaceId}\u0000${id}`;

// Whole-blob keys where replaying a LONG-retained failed write is still worse
// than losing it. Floor maps now use a per-map three-way fold + version check,
// but hours-old same-map geometry can only be kept as a recovered copy, not
// safely auto-published. Bound that retry window; the editor already exposes
// failed-save state, and re-editing queues a fresh value.
const RETAINED_MAX_AGE_MS = { floor_maps_v1: 10 * 60 * 1000 };
const retainedExpired = (id, q) => {
  const cap = RETAINED_MAX_AGE_MS[id];
  return Boolean(cap && q.retainedAt && Date.now() - q.retainedAt > cap);
};

function queueOf(workspaceId, id) {
  const key = queueKey(workspaceId, id);
  let q = queues.get(key);
  if (!q) {
    q = {
      workspaceId,
      id,
      latest: undefined,
      chain: Promise.resolve(),
      attempts: 0,
      retryTimer: null,
      retainedAt: null,
    };
    queues.set(key, q);
  }
  return q;
}

function scheduleRetry(workspaceId, id) {
  const q = queueOf(workspaceId, id);
  if (q.retryTimer) return;
  const delay = Math.min(2000 * 2 ** q.attempts, 30000);
  q.attempts += 1;
  q.retryTimer = setTimeout(() => {
    q.retryTimer = null;
    const qq = queues.get(queueKey(workspaceId, id));
    if (qq && retainedExpired(id, qq)) {
      console.warn(`Settings retry dropped (${id}): the retained value aged past its replay cap.`);
      dropPendingStateKey(id, workspaceId);
      return;
    }
    flushStateKey(id, workspaceId);
  }, delay);
}

async function flushStateKey(id, workspaceId = getWorkspaceId()) {
  const q = queues.get(queueKey(workspaceId, id));
  if (!q || q.latest === undefined) return { ok: true };
  const attempt = q.chain.then(async () => {
    const value = q.latest; // always the newest — never a stale snapshot
    if (value === undefined) return { ok: true };
    try {
      const saved = await writeStateKeyOnce(id, value.state, value.ancestor, workspaceId);
      // Only clear if nothing newer arrived while this write was in flight.
      if (q.latest === value) { q.latest = undefined; q.attempts = 0; q.retainedAt = null; }
      return { ok: true, ...saved };
    } catch (error) {
      console.error(`Settings save failed (${id}):`, error);
      scheduleRetry(workspaceId, id);
      return { ok: false, error };
    }
  });
  q.chain = attempt.catch(() => {}); // the chain itself never rejects
  return attempt;
}

export async function saveStateKey(id, state, { ancestor = null } = {}) {
  const workspaceId = getWorkspaceId();
  if (!supabase || !workspaceId) return { ok: true };
  // Test service: never persist. The UI keeps its in-memory state; the store
  // (service_date, floor markers, kitchen order, logo, …) is left untouched.
  if (isSandbox()) return { ok: true };
  const q = queueOf(workspaceId, id);
  // If an earlier value is still unsaved, its ancestor is the last snapshot
  // known to be durable. A later UI tap was calculated from the optimistic
  // local state, not from the server. Replacing that durable ancestor with the
  // optimistic one would make the three-way fold mistake the first tap for
  // already-saved data and drop it after a failed attempt.
  q.latest = { state, ancestor: q.latest?.ancestor ?? ancestor };
  q.retainedAt = Date.now(); // fresh value → fresh replay-age budget
  // A newer value supersedes any scheduled retry of the older one.
  if (q.retryTimer) { clearTimeout(q.retryTimer); q.retryTimer = null; }
  q.attempts = 0;
  return flushStateKey(id, workspaceId);
}

// Connectivity returned — push every retained value out immediately.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    for (const q of queues.values()) {
      if (q.latest === undefined) continue;
      if (retainedExpired(q.id, q)) {
        console.warn(`Settings online-replay dropped (${q.id}): the retained value aged past its replay cap.`);
        dropPendingStateKey(q.id, q.workspaceId);
        continue;
      }
      if (q.retryTimer) { clearTimeout(q.retryTimer); q.retryTimer = null; }
      q.attempts = 0;
      flushStateKey(q.id, q.workspaceId);
    }
  });
}

// Test seam: pending keys still waiting to reach the store.
export function pendingStateKeys(workspaceId = getWorkspaceId()) {
  return [...queues.values()]
    .filter((q) => q.workspaceId === workspaceId && q.latest !== undefined)
    .map((q) => q.id);
}

// Drop a key's retained value and cancel its retry — for values that became
// LIES while they waited. The concrete case: a floor-strip write fails on a
// flaky link, its blob is retained for retry, the service then ENDS on
// another device — the retained old-service strips would replay on the next
// 'online' signal (even an hour later) and overwrite the ending device's {}
// wipe. Lifecycle adoption calls this the moment a service end/replace is
// observed; an in-flight attempt can no longer be stopped, but `latest`
// clearing stops the retry/online replays.
export function dropPendingStateKey(id, workspaceId = getWorkspaceId()) {
  const q = queues.get(queueKey(workspaceId, id));
  if (!q) return;
  q.latest = undefined;
  q.attempts = 0;
  q.retainedAt = null;
  if (q.retryTimer) { clearTimeout(q.retryTimer); q.retryTimer = null; }
}

export async function readStatePrefix(prefix) {
  if (!supabase || !getWorkspaceId()) throw new Error("no active workspace");
  if (isSqlitePrimary()) {
    const { readSettingsPrefix } = await import("../powersync/reads.js");
    return readSettingsPrefix(prefix);
  }
  const { data, error } = await scopedFrom(TABLES.SERVICE_SETTINGS)
    .select("id,state,updated_at").like("id", `${prefix}%`).order("id");
  if (error) throw error;
  return data || [];
}
