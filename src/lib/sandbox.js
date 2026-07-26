// Sandbox ("Test Service") kill-switch. When ON, every persistence seam in the
// app becomes a hard no-op — a test service runs fully in memory and NOTHING
// reaches Supabase or the on-device PowerSync DB, so it can never touch, share,
// or archive real service data.
//
// Module-level (mirrors powersync/primary.js) so the seams outside the App
// component tree — lib/stateStore.js, lib/serviceLifecycle.js — can check
// it without prop drilling. LIGHT module, no SDK imports, safe to import
// anywhere. App.jsx is the only writer (setSandbox on test start/end).
//
// The guard is placed at the LOWEST write seam and defaults to "write nothing",
// so even a miswired caller cannot leak a test into real data.

let sandbox = false;

export const setSandbox = (value) => { sandbox = Boolean(value); };
export const isSandbox = () => sandbox;
