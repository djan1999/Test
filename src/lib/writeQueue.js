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
export function createWriteQueue(writeOnce) {
  const queues = new Map(); // key → { latest, chain, attempts, retryTimer }

  const queueOf = (key) => {
    let q = queues.get(key);
    if (!q) {
      q = { latest: undefined, chain: Promise.resolve(), attempts: 0, retryTimer: null };
      queues.set(key, q);
    }
    return q;
  };

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
        await writeOnce(key, value);
        // Only clear if nothing newer arrived while this write was in flight.
        if (q.latest === value) { q.latest = undefined; q.attempts = 0; }
        return { ok: true };
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
    q.latest = value;
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
    if (q.retryTimer) { clearTimeout(q.retryTimer); q.retryTimer = null; }
  };

  return { save, pending, drop, flushAll };
}
