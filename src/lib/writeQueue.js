// Generic per-key serialized write queue with latest-value-wins retry — the
// same guarantees lib/stateStore.js gives settings blobs, extracted so
// RESERVATION rows get them on the direct-Supabase fallback path (the
// sqlite-primary path is already ordered by the local transaction + the
// PowerSync upload queue):
//   • SERIALIZED — one write in flight per key; later saves chain behind it,
//     so an older visit-state PATCH can never land after a newer one
//     (assign-terrace-then-CLEAR used to resurrect the assign in the store
//     whenever the first request stalled past the second);
//   • LATEST-VALUE-WINS — every attempt sends the key's newest value;
//   • RETRY with capped backoff after a failure, plus a flush on the
//     browser's 'online' signal (a failed CLEAR used to be console.warn'd
//     and silently lost — nothing ever retried it).
// Callers get an honest result for THEIR attempt ({ok:false} shows their
// error UI), but the value is retained and keeps retrying.
export function createWriteQueue(writeOnce, {
  storageKey = null,
  maxRetainedAgeMs = 24 * 60 * 60 * 1000,
  mergePending = (_previous, next) => next,
} = {}) {
  const queues = new Map(); // key → { latest, chain, attempts, retryTimer, retainedAt }

  const storage = storageKey && typeof window !== "undefined" ? window.localStorage : null;
  const persist = () => {
    if (!storage) return;
    try {
      const pending = [...queues.entries()]
        .filter(([, q]) => q.latest !== undefined)
        .map(([key, q]) => ({ key, value: q.latest, retainedAt: q.retainedAt || Date.now() }));
      if (pending.length) storage.setItem(storageKey, JSON.stringify(pending));
      else storage.removeItem(storageKey);
    } catch { /* storage quota/privacy mode — RAM queue still works */ }
  };

  const queueOf = (key) => {
    let q = queues.get(key);
    if (!q) {
      q = {
        latest: undefined,
        chain: Promise.resolve(),
        attempts: 0,
        retryTimer: null,
        retainedAt: null,
      };
      queues.set(key, q);
    }
    return q;
  };

  let restored = false;
  if (storage) {
    try {
      const saved = JSON.parse(storage.getItem(storageKey) || "[]");
      for (const item of Array.isArray(saved) ? saved : []) {
        if (!item || typeof item.key !== "string" || item.value === undefined) continue;
        const retainedAt = Number(item.retainedAt) || 0;
        if (!retainedAt || Date.now() - retainedAt > maxRetainedAgeMs) continue;
        const q = queueOf(item.key);
        q.latest = item.value;
        q.retainedAt = retainedAt;
        restored = true;
      }
      persist(); // remove malformed/expired records
    } catch {
      try { storage.removeItem(storageKey); } catch { /* noop */ }
    }
  }

  const scheduleRetry = (key) => {
    const q = queueOf(key);
    if (q.retryTimer) return;
    const delay = Math.min(2000 * 2 ** q.attempts, 30000);
    q.attempts += 1;
    q.retryTimer = setTimeout(() => { q.retryTimer = null; flush(key); }, delay);
  };

  const flush = (key) => {
    const q = queues.get(key);
    if (!q || q.latest === undefined) return Promise.resolve({ ok: true });
    const attempt = q.chain.then(async () => {
      const value = q.latest; // always the newest — never a stale snapshot
      if (value === undefined) return { ok: true };
      try {
        const written = await writeOnce(key, value);
        // Only clear if nothing newer arrived while this write was in flight.
        if (q.latest === value) {
          q.latest = undefined;
          q.attempts = 0;
          q.retainedAt = null;
          persist();
        }
        return { ok: true, value: written };
      } catch (error) {
        scheduleRetry(key);
        return { ok: false, error };
      }
    });
    q.chain = attempt.catch(() => {}); // the chain itself never rejects
    return attempt;
  };

  const save = (key, value) => {
    const q = queueOf(key);
    q.latest = q.latest === undefined ? value : mergePending(q.latest, value);
    q.retainedAt = Date.now();
    persist(); // durable before the network attempt starts
    // A newer value supersedes any scheduled retry of the older one.
    if (q.retryTimer) { clearTimeout(q.retryTimer); q.retryTimer = null; }
    q.attempts = 0;
    return flush(key);
  };

  // Connectivity returned — push every retained value out immediately.
  const flushAll = () => {
    for (const [key, q] of queues) {
      if (q.latest === undefined) continue;
      if (q.retryTimer) { clearTimeout(q.retryTimer); q.retryTimer = null; }
      q.attempts = 0;
      flush(key);
    }
  };
  if (typeof window !== "undefined") window.addEventListener("online", flushAll);
  // A reload normally occurs while the browser already reports "online", so
  // there may be no future online event. Replay restored work after module
  // setup; auth may still be resolving, in which case normal retry takes over.
  if (restored) setTimeout(flushAll, 0);

  // Retained keys still waiting to reach the store (test seam / diagnostics).
  const pending = () =>
    [...queues.entries()].filter(([, q]) => q.latest !== undefined).map(([k]) => k);

  // Drop a retained value that became a lie while it waited (see
  // stateStore.dropPendingStateKey for the pattern's rationale).
  const drop = (key) => {
    const q = queues.get(key);
    if (!q) return;
    q.latest = undefined;
    q.attempts = 0;
    q.retainedAt = null;
    if (q.retryTimer) { clearTimeout(q.retryTimer); q.retryTimer = null; }
    persist();
  };

  return { save, pending, drop, flushAll };
}
