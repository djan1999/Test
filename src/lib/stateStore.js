// Shared service_settings key/value store seam: one read + one write helper
// that pick the on-device SQLite DB when it is primary (see
// powersync/primary.js) and fall back to a direct Supabase call otherwise.
// Used by App.jsx and by the admin/menu components that own their own
// settings rows (inventory, menu generator texts) — so every settings blob
// gets offline-capable writes for free.

import { supabase, getWorkspaceId, TABLES } from "./supabaseClient.js";
import { scopedFrom } from "./scopedDb.js";
import { isSqlitePrimary } from "../powersync/primary.js";

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
async function writeStateKeyOnce(id, state) {
  if (isSqlitePrimary()) {
    const { writeSetting } = await import("../powersync/writes.js");
    await writeSetting(id, state);
  } else {
    const { error } = await scopedFrom(TABLES.SERVICE_SETTINGS)
      .upsert({ id, state, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (error) throw error;
  }
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
const queues = new Map(); // id → { latest, chain, attempts, retryTimer }

function queueOf(id) {
  let q = queues.get(id);
  if (!q) {
    q = { latest: undefined, chain: Promise.resolve(), attempts: 0, retryTimer: null };
    queues.set(id, q);
  }
  return q;
}

function scheduleRetry(id) {
  const q = queueOf(id);
  if (q.retryTimer) return;
  const delay = Math.min(2000 * 2 ** q.attempts, 30000);
  q.attempts += 1;
  q.retryTimer = setTimeout(() => {
    q.retryTimer = null;
    flushStateKey(id);
  }, delay);
}

async function flushStateKey(id) {
  const q = queues.get(id);
  if (!q || q.latest === undefined) return { ok: true };
  const attempt = q.chain.then(async () => {
    const value = q.latest; // always the newest — never a stale snapshot
    if (value === undefined) return { ok: true };
    try {
      await writeStateKeyOnce(id, value);
      // Only clear if nothing newer arrived while this write was in flight.
      if (q.latest === value) { q.latest = undefined; q.attempts = 0; }
      return { ok: true };
    } catch (error) {
      console.error(`Settings save failed (${id}):`, error);
      scheduleRetry(id);
      return { ok: false, error };
    }
  });
  q.chain = attempt.catch(() => {}); // the chain itself never rejects
  return attempt;
}

export async function saveStateKey(id, state) {
  if (!supabase || !getWorkspaceId()) return { ok: true };
  const q = queueOf(id);
  q.latest = state;
  // A newer value supersedes any scheduled retry of the older one.
  if (q.retryTimer) { clearTimeout(q.retryTimer); q.retryTimer = null; }
  q.attempts = 0;
  return flushStateKey(id);
}

// Connectivity returned — push every retained value out immediately.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    for (const [id, q] of queues) {
      if (q.latest === undefined) continue;
      if (q.retryTimer) { clearTimeout(q.retryTimer); q.retryTimer = null; }
      q.attempts = 0;
      flushStateKey(id);
    }
  });
}

// Test seam: pending keys still waiting to reach the store.
export function pendingStateKeys() {
  return [...queues.entries()].filter(([, q]) => q.latest !== undefined).map(([id]) => id);
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
