// PowerSync pilot gating — LIGHTWEIGHT module (no heavy imports).
//
// This file is safe to import statically anywhere: it pulls in none of the
// PowerSync SDK / wa-sqlite WASM, so importing it costs nothing for the normal
// Supabase code path. The actual SDK lives in ./system.js and is only ever
// reached through a dynamic import() gated by isPowerSyncEnabled() below — so
// for production / the Hotel Milka workspace the app stays byte-for-byte the
// current build and never loads PowerSync.

// Demo workspace — the ONLY workspace the pilot is allowed to touch. Must match
// the hard filter in powersync/sync-rules.yaml and the deployed Sync Streams.
export const DEMO_WORKSPACE_ID = "547ffccc-cc93-42bd-942e-23eb0dc3a99e";

// PowerSync instance URL. Defaults to the pilot instance baked in here so the
// Demo pilot works without any Vercel env config; VITE_POWERSYNC_URL overrides
// it (e.g. to point at a different instance, or set to "" to fully disable).
// This is NOT a secret — Vite inlines VITE_ vars into the client bundle anyway,
// and auth is via the Supabase JWT — and the pilot is still hard-gated to the
// Demo workspace (see isPowerSyncEnabled), so prod / Hotel Milka load nothing.
export const POWERSYNC_URL =
  import.meta.env.VITE_POWERSYNC_URL ??
  "https://6a2edf200ef84ed671a1a45e.powersync.journeyapps.com";

// The pilot turns on only when BOTH are true: a URL is configured AND the active
// workspace is Demo. Anything else (no URL, or the live Milka workspace) → off.
export function isPowerSyncEnabled(workspaceId) {
  return Boolean(POWERSYNC_URL) && workspaceId === DEMO_WORKSPACE_ID;
}
