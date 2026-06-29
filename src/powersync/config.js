// PowerSync gating — LIGHTWEIGHT module (no heavy imports).
//
// This file is safe to import statically anywhere: it pulls in none of the
// PowerSync SDK / wa-sqlite WASM, so importing it costs nothing up front. The
// actual SDK lives in ./system.js and is only ever reached through a dynamic
// import() gated by isPowerSyncEnabled() below, so the heavy WASM loads lazily.
//
// PowerSync is the app-wide default: it runs for EVERY workspace — Demo and
// every restaurant (e.g. Hotel Milka) alike — not just a pilot. Supabase
// realtime remains in place as a safety net alongside it.

// Demo workspace id — kept for reference (sync rules now scope per-tenant by
// workspace membership, so this is no longer used for gating; PowerSync is on
// for all workspaces, not just Demo).
export const DEMO_WORKSPACE_ID = "547ffccc-cc93-42bd-942e-23eb0dc3a99e";

// PowerSync instance URL. Defaults to the instance baked in here so it works
// without any Vercel env config; VITE_POWERSYNC_URL overrides it (e.g. to point
// at a different instance, or set to "" to fully disable). This is NOT a secret
// — Vite inlines VITE_ vars into the client bundle anyway, and auth is via the
// Supabase JWT. The deployed Sync Streams hard-scope each client to ONLY its own
// workspace(s) via workspace_members, so no cross-tenant data can reach a device.
export const POWERSYNC_URL =
  import.meta.env.VITE_POWERSYNC_URL ??
  "https://6a2edf200ef84ed671a1a45e.powersync.journeyapps.com";

// Enabled app-wide: on for every workspace whenever a URL is configured and a
// workspace is active (Demo and restaurants alike). Per-workspace data isolation
// is enforced server-side by the sync rules, not here. Accounts with no synced
// rows (e.g. the platform-admin, which isn't a workspace member) simply find an
// empty local DB and fall back to Supabase.
export function isPowerSyncEnabled(workspaceId) {
  return Boolean(POWERSYNC_URL) && Boolean(workspaceId);
}
