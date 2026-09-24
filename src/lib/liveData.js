// Shared refresh lifecycle. Events are hints; wake/reconnect and a bounded
// periodic read repair missed events without deleting caches or pending writes.
const queries = new Set();
const listeners = new Set();
let snapshot = [];
let stopLifecycle = null;
const notify = () => {
  snapshot = [...queries].map(q => ({ key: q.key, scope: q.scope, ...q.status }));
  listeners.forEach(fn => fn());
};
export const subscribeLiveStatus = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const getLiveStatus = () => snapshot;

export function invalidateLiveData(table = null, scope = null) {
  const pending = [];
  for (const q of queries) {
    if ((scope == null || q.scope === scope) && (!table || q.tables.includes(table))) pending.push(q.refresh());
  }
  return Promise.all(pending);
}

function ensureLifecycle() {
  if (stopLifecycle || typeof window === "undefined") return;
  let wakeTimer;
  const wake = () => {
    if (document.hidden) return;
    clearTimeout(wakeTimer);
    wakeTimer = setTimeout(() => invalidateLiveData(), 250);
  };
  const interval = setInterval(() => { if (!document.hidden) invalidateLiveData(); }, 60000);
  window.addEventListener("online", wake);
  window.addEventListener("focus", wake);
  document.addEventListener("visibilitychange", wake);
  stopLifecycle = () => {
    clearInterval(interval); clearTimeout(wakeTimer);
    window.removeEventListener("online", wake);
    window.removeEventListener("focus", wake);
    document.removeEventListener("visibilitychange", wake);
    stopLifecycle = null;
  };
}

export function registerLiveQuery({ key, scope, tables = [], read, apply, onError, immediate = true, timeoutMs = 20000 }) {
  let disposed = false, running = null, wanted = 0, retryTimer = null, attempts = 0, discarded = 0;
  const q = { key, scope, tables, status: { state: "loading", updatedAt: null, error: null }, refresh: null };
  const setStatus = (patch) => { if (!disposed) { q.status = { ...q.status, ...patch }; notify(); } };
  const run = async () => {
    while (!disposed) {
      const mine = wanted;
      let timeout;
      setStatus({ state: "loading" });
      try {
        const value = await Promise.race([
          Promise.resolve().then(read),
          new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`${key} refresh timed out`)), timeoutMs); }),
        ]);
        if (disposed) return;
        // A newer notification superseded this read: re-read once rather than
        // paint it. Only once — during service notifications arrive faster than
        // a read completes, and discarding every superseded read starved the
        // board for seconds. Reads are serial per query, so a completed read is
        // never older than what is already painted.
        if (mine !== wanted && discarded++ < 1) continue;
        discarded = 0;
        const accepted = await apply(value);
        attempts = 0;
        setStatus({ state: accepted === false ? "held" : "ready", updatedAt: Date.now(), error: null });
      } catch (error) {
        if (disposed) return;
        if (mine !== wanted) continue;
        setStatus({ state: "error", error: error?.message || String(error) });
        onError?.(error);
        retryTimer = setTimeout(() => q.refresh(), Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5)));
      } finally { clearTimeout(timeout); }
      if (mine === wanted) return;
    }
  };
  q.refresh = () => {
    if (disposed) return Promise.resolve();
    wanted += 1;
    clearTimeout(retryTimer);
    if (!running) running = run().finally(() => { running = null; });
    return running;
  };
  queries.add(q); notify(); ensureLifecycle();
  if (immediate) q.refresh();
  return {
    refresh: q.refresh,
    dispose() {
      disposed = true; clearTimeout(retryTimer); queries.delete(q); notify();
      if (!queries.size) stopLifecycle?.();
    },
  };
}
