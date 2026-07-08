// PowerSync system — HEAVY module. Pulls in the PowerSync SDK + wa-sqlite WASM,
// so it must ONLY ever be reached through a dynamic import() gated by
// isPowerSyncEnabled() (see ./config.js). Static-importing this anywhere would
// ship the SDK to every user and defeat the "prod stays byte-for-byte" promise.

import { PowerSyncDatabase } from "@powersync/web";
import { AppSchema } from "./AppSchema.js";
import { SupabaseConnector } from "./SupabaseConnector.js";
import { supabase } from "../lib/supabaseClient.js";

let _db = null;
let _connected = false;

// The device remembers which Supabase user last synced the local DB. One
// dbFilename serves whoever is logged in, so when a DIFFERENT account signs in
// (admin → restaurant handover, a shared tablet changing hands) the previous
// user's rows and sync state MUST NOT carry over: stale hasSynced flags let the
// new session go sqlite-primary on the old account's data, and leftover rows
// from workspaces the new user can't sync trip the foreign-rows tripwire and
// wedge the device on the fallback. Clearing before the first connect forces a
// clean first sync for the new user (PowerSync's documented logout behaviour).
const LAST_SYNC_USER_KEY = "milka-powersync-last-user";

async function clearIfUserChanged(db) {
  let userId = null;
  try {
    const { data } = await supabase.auth.getSession();
    userId = data?.session?.user?.id || null;
  } catch { /* no session yet — the connector waits for login */ }
  if (!userId) return;
  let last = null;
  try { last = localStorage.getItem(LAST_SYNC_USER_KEY); } catch { /* noop */ }
  if (last && last !== userId) {
    console.warn("[PowerSync] signed-in account changed — clearing the on-device DB before connect");
    try { await db.disconnectAndClear(); } catch (e) { console.warn("[PowerSync] disconnectAndClear failed:", e); }
  }
  try { localStorage.setItem(LAST_SYNC_USER_KEY, userId); } catch { /* noop */ }
}

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
// hasSyncedP1: the priority-1 data (board, reservations, settings — see
// powersync/sync-rules.yaml) has completed its first sync, so the board is
// usable before the big reference lists finish downloading. Falls back to the
// full-sync flag when priorities aren't deployed.
function snapshot(s) {
  let p1 = false;
  try { p1 = !!s?.statusForPriority?.(1)?.hasSynced; } catch { /* noop */ }
  // Surface WHY the stream is down, not just that it is: the download/upload
  // errors are the only place the engine names its failure (401, WebSocket
  // refused, sync-rule errors…). They reach the console via the status log
  // below and the admin SYSTEM panel via App's powerSyncStatus — so a single
  // screenshot from a misbehaving device identifies the cause.
  const flow = s?.dataFlowStatus || {};
  const err = flow.downloadError ?? flow.uploadError ?? null;
  return {
    connected: !!s?.connected,
    connecting: !!s?.connecting,
    hasSynced: !!s?.hasSynced,
    hasSyncedP1: !!s?.hasSynced || p1,
    lastSyncedAt: s?.lastSyncedAt ? new Date(s.lastSyncedAt).getTime() : null,
    downloading: !!flow.downloading,
    uploading: !!flow.uploading,
    streamError: err ? String(err?.message || err) : null,
  };
}

// Wipe the local DB and reconnect the stream — the self-heal for a local DB
// contaminated with another account's rows. Devices that switched logins
// BEFORE the account-switch guard existed (the 07.07 admin → restaurant
// handover) still carry the previous user's workspaces; the foreign-rows
// tripwire spots them and calls this instead of wedging on the fallback
// forever. Safe because the stream can only re-deliver the CURRENT user's
// workspaces. Registered status listeners survive the reconnect.
export async function clearLocalAndResync() {
  const db = getPowerSync();
  await db.disconnectAndClear();
  await db.connect(new SupabaseConnector());
  _connected = true;
}

// Connect the local DB to the PowerSync service and start streaming. `onStatus`
// (optional) is called with a {connected, hasSynced, lastSyncedAt} snapshot on
// every status change and once immediately. Returns a disconnect function.
// Safe to call more than once (the connect itself no-ops if already connected).
export async function connect(onStatus) {
  const db = getPowerSync();
  if (!_connected) {
    await clearIfUserChanged(db);
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
