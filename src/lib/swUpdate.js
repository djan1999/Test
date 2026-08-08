// Waiting-service-worker handshake between the PWA registration (main.jsx),
// the boot update gate (App's CONNECTING splash) and the admin SYSTEM panel.
// A deployed build downloads in the background and WAITS — it must never
// force-reload devices mid-service (the 11.07 deploy reloaded every tablet
// during prep). It applies at exactly two safe moments:
//   • BOOT, forcibly: forceBootUpdateIfAvailable() runs while the CONNECTING
//     splash is up — an ONLINE device may not open on an outdated build (an
//     old build is old bugs; per Djan, 08.08). The splash shows UPDATING…,
//     the new build activates, the page reloads, and only then does the boot
//     gate open. Offline devices proceed on their cached build (there is
//     nothing to fetch), and every wait below is bounded so a wedged worker
//     can never brick a boot.
//   • mid-session, deliberately: the SYSTEM panel's APPLY UPDATE button
//     (needed for the kitchen display, which never closes on its own).
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

// ── Boot update gate ─────────────────────────────────────────────────────────

let registration = null;
export function setSwRegistration(reg) { registration = reg; }

const RELOAD_GUARD_KEY = "milka_boot_update_reload_once";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const bounded = (promise, ms) =>
  Promise.race([Promise.resolve(promise), delay(ms).then(() => undefined)]);

// Wait (bounded) for an installing worker to leave the 'installing' state.
const waitForInstalled = (worker, ms) => new Promise((resolve) => {
  let settled = false;
  const finish = () => { if (!settled) { settled = true; resolve(); } };
  const timer = setTimeout(finish, ms);
  try {
    worker.addEventListener("statechange", () => {
      if (worker.state !== "installing") { clearTimeout(timer); finish(); }
    });
    if (worker.state !== "installing") { clearTimeout(timer); finish(); }
  } catch { clearTimeout(timer); finish(); }
});

// Activate the WAITING build and reload. The reload-loop guard is set first:
// if the reloaded boot somehow still sees an update (a registry serving
// endless "new" workers), it passes through once instead of looping forever.
// If no reload happens within the bound (a wedged worker), the guard is
// cleared and the boot proceeds on the current build — never bricked.
function applyWaitingAndReload(reg, { reloadTimeoutMs, reload }) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { sessionStorage.removeItem(RELOAD_GUARD_KEY); } catch { /* noop */ }
      resolve(false);
    }, reloadTimeoutMs);
    try { sessionStorage.setItem(RELOAD_GUARD_KEY, "1"); } catch { /* noop */ }
    try {
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reload();
      }, { once: true });
    } catch { /* the timeout path resolves */ }
    // Prefer the registered vite-pwa path (it reloads on controllerchange
    // itself); fall back to the raw SKIP_WAITING message when the register
    // callback hasn't wired applyFn yet at boot.
    if (typeof applyFn === "function") applyFn();
    else reg.waiting?.postMessage?.({ type: "SKIP_WAITING" });
  });
}

// The boot update gate. Resolves false when there is nothing to apply (no SW
// support, offline, already current, or the one-shot reload guard is set);
// when a new build exists it activates it and reloads — the promise then
// never needs to resolve, the page is gone. Every step is bounded.
export async function forceBootUpdateIfAvailable({
  onApplying = () => {},
  registrationWaitMs = 3000,
  checkWaitMs = 5000,
  installWaitMs = 30000,
  reloadTimeoutMs = 8000,
  reload = () => window.location.reload(),
} = {}) {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return false;
  try {
    if (sessionStorage.getItem(RELOAD_GUARD_KEY) === "1") {
      sessionStorage.removeItem(RELOAD_GUARD_KEY);
      return false;
    }
  } catch { /* storage unavailable — proceed without loop protection */ }
  let reg = registration;
  if (!reg) {
    try { reg = await bounded(navigator.serviceWorker.getRegistration(), registrationWaitMs); } catch { reg = null; }
  }
  if (!reg) return false;

  // A build already downloaded and WAITING (from the previous session's
  // background check) applies immediately — the common, fast case.
  if (reg.waiting) {
    onApplying();
    return applyWaitingAndReload(reg, { reloadTimeoutMs, reload });
  }

  // Fresh check with the server. Offline/unreachable → nothing to force; the
  // cached build is all there is and the boot proceeds.
  try { await bounded(reg.update(), checkWaitMs); } catch { return false; }
  if (reg.installing) {
    onApplying(); // a new build is downloading — the splash says UPDATING…
    await waitForInstalled(reg.installing, installWaitMs);
  }
  if (reg.waiting) {
    onApplying();
    return applyWaitingAndReload(reg, { reloadTimeoutMs, reload });
  }
  return false;
}
