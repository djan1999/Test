// Waiting-service-worker handshake between the PWA registration (main.jsx)
// and the admin SYSTEM panel. A deployed build downloads in the background
// and WAITS — it must never force-reload devices mid-service (the 11.07
// deploy reloaded every tablet during prep). The update applies when the
// app is next fully closed and reopened, or on demand via the SYSTEM
// panel's APPLY UPDATE button (needed for the kitchen display, which never
// closes on its own).
let applyFn = null;
const listeners = new Set();

export function setUpdateReady(apply) {
  applyFn = apply;
  for (const l of listeners) { try { l(true); } catch { /* noop */ } }
}

export function isUpdateReady() {
  return typeof applyFn === "function";
}

export function applyUpdate() {
  applyFn?.();
}

// Subscribe to readiness; fires immediately if an update is already waiting.
// Returns an unsubscribe function.
export function onUpdateReady(listener) {
  listeners.add(listener);
  if (applyFn) { try { listener(true); } catch { /* noop */ } }
  return () => listeners.delete(listener);
}
