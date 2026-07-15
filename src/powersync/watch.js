// Live UI updates driven by local-DB changes — the primary cross-device update
// path once PowerSync is streaming. HEAVY module: only import it when enabled.

import { getPowerSync } from "./system.js";
import {
  readReservations, readServiceTables, readWines, readBeverages, readMenuCourses,
  readLiveSettings,
} from "./reads.js";

const disposeSubscription = (subscription) => {
  try {
    if (typeof subscription === "function") subscription();
    else if (typeof subscription?.unsubscribe === "function") subscription.unsubscribe();
    else if (typeof subscription?.dispose === "function") subscription.dispose();
  } catch { /* cleanup must remain best-effort */ }
};

// `onError` receives { source, phase, error }. `onReady` fires only after every
// enabled source has completed a successful first mapped read.
export function startWatches(handlers, range, lifecycle = {}) {
  const db = getPowerSync();
  const controller = new AbortController();
  const opts = { signal: controller.signal };
  const subscriptions = [];
  const enabled = new Set();
  const ready = new Set();
  let disposed = false;
  let announcedReady = false;

  const report = (source, phase, error) => {
    if (!disposed) lifecycle.onError?.({ source, phase, error });
  };
  const markReady = (source) => {
    ready.add(source);
    if (!announcedReady && ready.size === enabled.size) {
      announcedReady = true;
      lifecycle.onReady?.({ sources: [...ready] });
    }
  };
  const bind = (source, triggerSql, reader, handler) => {
    if (!handler) return;
    enabled.add(source);
    const run = async () => {
      try {
        const value = await reader();
        if (disposed) return;
        await handler(value);
        markReady(source);
      } catch (error) {
        report(source, "read", error);
      }
    };
    try {
      const subscription = db.watch(triggerSql, [], {
        onResult: () => { void run(); },
        onError: (error) => report(source, "engine", error),
      }, opts);
      subscriptions.push(subscription);
    } catch (error) {
      report(source, "subscribe", error);
    }
  };

  bind("reservations", "SELECT count(*) AS n FROM reservations",
    () => readReservations(range.from, range.to), handlers.onReservations);
  bind("service_tables", "SELECT count(*) AS n FROM service_tables",
    readServiceTables, handlers.onServiceTables);
  bind("wines", "SELECT count(*) AS n FROM wines", readWines, handlers.onWines);
  bind("beverages", "SELECT count(*) AS n FROM beverages", readBeverages, handlers.onBeverages);
  bind("menu_courses", "SELECT count(*) AS n FROM menu_courses", readMenuCourses, handlers.onMenuCourses);
  bind("service_settings", "SELECT count(*) AS n, max(updated_at) AS ts FROM service_settings",
    readLiveSettings, handlers.onLiveSettings);

  if (enabled.size === 0) lifecycle.onReady?.({ sources: [] });

  return () => {
    disposed = true;
    try { controller.abort(); } catch { /* noop */ }
    subscriptions.forEach(disposeSubscription);
    subscriptions.length = 0;
  };
}
