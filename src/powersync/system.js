// PowerSync system — HEAVY module. Pulls in the PowerSync SDK + wa-sqlite WASM,
// so it must ONLY ever be reached through a dynamic import() gated by
// isPowerSyncEnabled() (see ./config.js). Static-importing this anywhere would
// ship the SDK to every user and defeat the "prod stays byte-for-byte" promise.

import { PowerSyncDatabase } from "@powersync/web";
import { AppSchema } from "./AppSchema.js";
import { SupabaseConnector } from "./SupabaseConnector.js";

let _db = null;
let _connected = false;

// Singleton on-device database. dbFilename namespaces the local SQLite file.
export function getPowerSync() {
  if (!_db) {
    _db = new PowerSyncDatabase({
      schema: AppSchema,
      database: { dbFilename: "milka-powersync.db" },
    });
  }
  return _db;
}

// Normalise a PowerSync SyncStatus into the small shape the app cares about.
function snapshot(s) {
  return {
    connected: !!s?.connected,
    hasSynced: !!s?.hasSynced,
    lastSyncedAt: s?.lastSyncedAt ? new Date(s.lastSyncedAt).getTime() : null,
  };
}

// Connect the local DB to the PowerSync service and start streaming. `onStatus`
// (optional) is called with a {connected, hasSynced, lastSyncedAt} snapshot on
// every status change and once immediately. Returns a disconnect function.
// Safe to call more than once (the connect itself no-ops if already connected).
export async function connect(onStatus) {
  const db = getPowerSync();
  if (!_connected) {
    await db.connect(new SupabaseConnector());
    _connected = true;
    if (typeof window !== "undefined") window.__powerSync = db; // DevTools aid
  }
  const dispose = db.registerListener({
    statusChanged: (status) => {
      const snap = snapshot(status);
      console.info("[PowerSync] status —", JSON.stringify(snap));
      onStatus?.(snap);
    },
  });
  // Emit the current status immediately so callers don't wait for the next change.
  onStatus?.(snapshot(db.currentStatus));
  return async () => {
    try { dispose?.(); } catch { /* noop */ }
    try { await db.disconnect(); } catch { /* noop */ }
    _connected = false;
  };
}
