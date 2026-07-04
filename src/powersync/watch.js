// Live UI updates driven by local-DB changes — the primary cross-device update
// path once PowerSync is streaming (it re-runs the mapped reader whenever the
// underlying table changes, locally or from another device). HEAVY module:
// only reach it via dynamic import() gated by isPowerSyncEnabled().

import { getPowerSync } from "./system.js";
import {
  readReservations, readServiceTables, readWines, readBeverages, readMenuCourses,
  readLiveSettings,
} from "./reads.js";

// Start watches for the supplied handlers; returns a disposer. `range` is the
// reservations date window { from, to } (ISO). Each watch fires on any change to
// its table (insert/update/delete, local or synced) and re-runs the reader.
export function startWatches(handlers, range) {
  const db = getPowerSync();
  const controller = new AbortController();
  const opts = { signal: controller.signal };
  const bind = (triggerSql, run) =>
    db.watch(triggerSql, [], { onResult: () => { run().catch(() => {}); }, onError: () => {} }, opts);

  if (handlers.onReservations)
    bind("SELECT count(*) AS n FROM reservations", async () => handlers.onReservations(await readReservations(range.from, range.to)));
  if (handlers.onServiceTables)
    bind("SELECT count(*) AS n FROM service_tables", async () => handlers.onServiceTables(await readServiceTables()));
  if (handlers.onWines)
    bind("SELECT count(*) AS n FROM wines", async () => handlers.onWines(await readWines()));
  if (handlers.onBeverages)
    bind("SELECT count(*) AS n FROM beverages", async () => handlers.onBeverages(await readBeverages()));
  if (handlers.onMenuCourses)
    bind("SELECT count(*) AS n FROM menu_courses", async () => handlers.onMenuCourses(await readMenuCourses()));
  if (handlers.onLiveSettings)
    bind("SELECT count(*) AS n, max(updated_at) AS ts FROM service_settings", async () => handlers.onLiveSettings(await readLiveSettings()));

  return () => { try { controller.abort(); } catch { /* noop */ } };
}
