// PowerSync gating — LIGHTWEIGHT module (no heavy imports).
//
// This file is safe to import statically anywhere: it pulls in none of the
// PowerSync SDK / wa-sqlite WASM, so importing it costs nothing up front. The
// actual SDK lives in ./system.js and is only ever reached through a dynamic
// import() gated by isPowerSyncEnabled() below, so the heavy WASM loads lazily.
//
// PowerSync is the app-wide default: it runs for EVERY explicitly authorized
// workspace — the separate Demo account and every restaurant alike.

// PowerSync instance URL. Defaults to the instance baked in here so it works
// without any Vercel env config; VITE_POWERSYNC_URL overrides it (e.g. to point
// at a different instance, or set to "" to fully disable). This is NOT a secret
// — Vite inlines VITE_ vars into the client bundle anyway, and auth is via the
// Supabase JWT. The deployed Sync Streams hard-scope each client to ONLY its own
// workspace(s) via workspace_members, so no cross-tenant data can reach a device.
export const POWERSYNC_URL =
  String(import.meta.env.VITE_DISABLE_POWERSYNC || "").toLowerCase() === "true"
    ? ""
    : import.meta.env.VITE_POWERSYNC_URL ??
      "https://6a2edf200ef84ed671a1a45e.powersync.journeyapps.com";

// Enabled app-wide: on for every workspace whenever a URL is configured and a
// workspace is active (Demo and restaurants alike). Per-workspace data isolation
// is enforced server-side by explicit workspace membership, not here.
export function isPowerSyncEnabled(workspaceId) {
  return Boolean(POWERSYNC_URL) && Boolean(workspaceId);
}
