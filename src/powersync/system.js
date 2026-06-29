// PowerSync system — HEAVY module. Pulls in the PowerSync SDK + wa-sqlite WASM,
// so it must ONLY ever be reached through a dynamic import() gated by
// isPowerSyncEnabled() (see ./config.js). Static-importing this anywhere would
// ship the SDK to every user and defeat the "prod stays byte-for-byte" promise.

import { PowerSyncDatabase } from "@powersync/web";
import { AppSchema } from "./AppSchema.js";
import { SupabaseConnector } from "./SupabaseConnector.js";

let _db = null;
let _connected = false;

// Singleton on-device database. dbFilename namespaces the local SQLite file;
// the pilot only ever holds Demo data (sync rules hard-filter to Demo), so a
// single fixed name is fine.
export function getPowerSync() {
  if (!_db) {
    _db = new PowerSyncDatabase({
      schema: AppSchema,
      database: { dbFilename: "milka-powersync-demo.db" },
    });
  }
  return _db;
}

// Connect the local DB to the PowerSync service and start streaming. Returns a
// disconnect function for cleanup. Safe to call more than once (no-ops if
// already connected). Logs sync status transitions so the pilot is observable
// from the browser console (the PowerSync dashboard also shows the live client).
export async function connect() {
  const db = getPowerSync();
  if (!_connected) {
    await db.connect(new SupabaseConnector());
    _connected = true;
    db.registerListener({
      statusChanged: (status) => {
        console.info(
          "[PowerSync] status — connected:",
          status.connected,
          "| lastSynced:",
          status.lastSyncedAt,
          "| hasSynced:",
          status.hasSynced,
        );
      },
    });
    // Expose for ad-hoc debugging from DevTools (e.g. window.__powerSync.getAll).
    if (typeof window !== "undefined") window.__powerSync = db;
  }
  return async () => {
    try {
      await db.disconnect();
    } catch {
      /* noop */
    }
    _connected = false;
  };
}
