import { useCallback, useEffect, useRef } from "react";
import { enqueue, readQueue, removeAt } from "../lib/syncQueue.js";

export function useOfflineQueue({ supabase, onFlushed } = {}) {
  const flushingRef = useRef(false);

  const flushQueue = useCallback(async () => {
    if (!supabase || flushingRef.current) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    flushingRef.current = true;
    try {
      let idx = 0;
      let items = readQueue();
      while (idx < items.length) {
        const item = items[idx];
        // Skip and drop legacy/non-serializable jobs (e.g. older { kind, run } shape)
        // so a poisoned queue cannot block all future writes.
        if (!item || typeof item !== "object" || !item.table || !item.op) {
          removeAt(idx);
          items = readQueue();
          continue;
        }

        const query = supabase.from(item.table);
        let result;
        if (item.op === "upsert") {
          result = await query.upsert(item.payload, item.options || {});
        } else if (item.op === "insert") {
          result = await query.insert(item.payload, item.options || {});
        } else if (item.op === "update") {
          result = await query.update(item.payload, item.options || {}).match(item.match || {});
        } else if (item.op === "delete") {
          result = await query.delete().match(item.match || {});
        } else {
          // Unknown op — drop it rather than retry forever.
          removeAt(idx);
          items = readQueue();
          continue;
        }

        if (result?.error) break;
        removeAt(idx);
        items = readQueue();
      }
      onFlushed?.();
    } finally {
      flushingRef.current = false;
    }
  }, [supabase, onFlushed]);

  const enqueueWrite = useCallback((item) => {
    enqueue(item);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    flushQueue();
    const onOnline = () => { flushQueue(); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [supabase, flushQueue]);

  return { enqueueWrite, flushQueue, enqueue: enqueueWrite };
}
