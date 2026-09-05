/**
 * Device health — the 20:05 answer.
 *
 * Gate D's question is a phone call: it is 20:05, the restaurant is full, and
 * someone says the kitchen screen isn't updating. Everything needed to answer
 * that already exists somewhere — the sync chip, the PowerSync status
 * snapshot, the client diagnostics list, the service date. What did not exist
 * was one place that reads them together and says which of the six actual
 * causes this is, and what to do about it.
 *
 * The output is written to be read aloud down a phone by someone who has
 * never seen the code. Each verdict carries:
 *
 *   headline — what is true right now, in five words
 *   meaning  — why the screen looks the way it does
 *   action   — the single next thing to do
 *
 * The most important verdict is the boring one. When this device is healthy,
 * the fault is not here: the service was never started, or the floor device
 * that should have sent the ticket is the one that is offline. A triage tool
 * that cannot say "the problem is somewhere else" sends people to clear local
 * databases that were never broken, and RESET LOCAL SYNC DB destroys work.
 *
 * Browser-free and side-effect-free: every input is passed in.
 */

export const HEALTH = Object.freeze({
  HEALTHY: "healthy",
  IDLE: "idle",
  OFFLINE: "offline",
  CONNECTING: "connecting",
  STALLED: "stalled",
  BLOCKED: "blocked",
  UNKNOWN: "unknown",
});

// How long a connected stream may go without a completed sync before the
// device is described as stalled rather than live. Ordinary quiet moments in a
// service are far shorter than this; a genuinely stuck stream is far longer.
export const STALL_AFTER_MS = 90_000;

// Diagnostic codes that mean an operation was refused or abandoned rather than
// retried — the class that silently loses an edit instead of delaying it.
const SEVERE_CODES = [
  "POWERSYNC_ZERO_MATCH",
  "MILKA_CAS_EXHAUSTED",
  "WORKSPACE_UNRESOLVED",
  "PERMISSION",
  "42501", // Postgres insufficient_privilege — an RLS denial reaching the client
];

const isSevere = (entry) => {
  const text = `${entry?.source || ""} ${entry?.message || ""}`.toUpperCase();
  return SEVERE_CODES.some((code) => text.includes(code));
};

function ageText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/**
 * Evaluate this device. Every argument is optional; what cannot be observed is
 * reported as unknown rather than assumed healthy.
 *
 * @param {object}  input
 * @param {boolean} input.online          navigator.onLine, or equivalent
 * @param {object}  input.powerSyncStatus the snapshot from powersync/system.js
 * @param {string}  input.syncStatus      the app's own chip state
 * @param {boolean} input.serviceActive   is a service running for this device
 * @param {Array}   input.diagnostics     recent client diagnostics, newest first
 * @param {number}  input.now             clock, injected for testability
 */
export function evaluateDeviceHealth({
  online = true,
  powerSyncStatus = null,
  syncStatus = null,
  serviceActive = true,
  diagnostics = [],
  now = Date.now(),
} = {}) {
  const status = powerSyncStatus || {};
  const recent = Array.isArray(diagnostics) ? diagnostics : [];
  const severe = recent.filter(isSevere);
  const lastSyncAge = Number.isFinite(status.lastSyncedAt) ? now - status.lastSyncedAt : null;

  const facts = [
    ["Network", online ? "on the venue network" : "no network"],
    ["Sync stream", status.connected ? "connected" : status.connecting ? "connecting" : "down"],
    ["First sync", status.hasSyncedP1 ? "complete" : "not finished"],
    ["Last sync", lastSyncAge == null ? "never on this device" : ageText(lastSyncAge)],
    ["Service", serviceActive ? "running" : "not started"],
    ["Refused operations", severe.length ? `${severe.length} recorded` : "none"],
  ];

  const verdict = (state, headline, meaning, action, escalate = false) => ({
    state, headline, meaning, action, escalate, facts,
    severeDiagnostics: severe.slice(0, 3),
  });

  // 1. Nothing to observe. Say so; do not guess.
  if (!powerSyncStatus && !syncStatus) {
    return verdict(
      HEALTH.UNKNOWN,
      "Cannot read this device's state",
      "The sync engine has not reported to this screen yet, usually because the app has only just opened.",
      "Wait ten seconds and look again. If it stays blank, reload this device once.",
    );
  }

  // 2. Off the network. The single most common cause, and the one where doing
  //    anything to the device makes it worse.
  if (!online || (!status.connected && !status.connecting)) {
    return verdict(
      HEALTH.OFFLINE,
      "This device is offline",
      "It is not reaching the venue network, so it shows the last state it received. Everything typed on it is still being saved locally and will upload by itself when the network returns.",
      "Fix the Wi-Fi or move the device back into range. Do NOT reset the local database — that would throw away the edits waiting to upload.",
    );
  }

  // 3. Refused operations. Rare, and the only class that loses an edit.
  if (severe.length) {
    return verdict(
      HEALTH.BLOCKED,
      "Operations are being refused",
      `This device recorded ${severe.length} operation${severe.length === 1 ? "" : "s"} the server would not accept. The screen may be missing changes made here. Most recent: ${severe[0]?.message?.slice(0, 140) || "see diagnostics"}`,
      "Write down what was entered on this device in the last few minutes, then escalate to the platform operator before clearing anything.",
      true,
    );
  }

  // 4. Connected but the first copy has not landed.
  if (status.connecting || !status.hasSyncedP1) {
    return verdict(
      HEALTH.CONNECTING,
      "Still receiving its first copy",
      "The device is connected and downloading tonight's board. Screens stay blank or partial until that finishes.",
      "Give it up to a minute. If it has not filled in by then, reload this device once.",
    );
  }

  // 5. Connected, synced once, but the stream has gone quiet or is erroring.
  if (status.streamError || (lastSyncAge != null && lastSyncAge > STALL_AFTER_MS)) {
    return verdict(
      HEALTH.STALLED,
      "Connected, but not receiving",
      status.streamError
        ? `The sync stream is reporting an error: ${String(status.streamError).slice(0, 160)}`
        : `The stream is up but nothing has arrived for ${ageText(lastSyncAge)}. Changes made elsewhere are not reaching this screen.`,
      "Reload this device once (close and reopen the app). If the same thing happens on a second device, it is the service, not the device — escalate.",
      true,
    );
  }

  // 6. Healthy, but no service is running. At 20:05 this usually means FOH
  //    never pressed START, and the kitchen is staring at NO ACTIVE SERVICE.
  if (!serviceActive) {
    return verdict(
      HEALTH.IDLE,
      "Healthy — no service running",
      "This device is connected and up to date. It shows nothing because no service has been started for tonight; the kitchen screen goes live by itself the moment the floor starts it.",
      "Ask the floor to press START SERVICE. Nothing is wrong with this device.",
    );
  }

  // 7. Healthy. The fault, if there is one, is not on this device.
  return verdict(
    HEALTH.HEALTHY,
    "This device is healthy",
    `It is connected and received data ${lastSyncAge == null ? "recently" : ageText(lastSyncAge)}. If the screen still looks wrong, the change never left the other device — most often the floor tablet is the one that is offline, or the ticket was never sent.`,
    "Check the floor device's own status chip before touching this one. Do not reset anything here.",
  );
}

/**
 * A short line for a phone call or a screenshot: identifies the device, its
 * build, and its verdict, with no guest data in it.
 */
export function supportSummary({ health, buildId = "dev", role = "", workspaceSlug = "", now = Date.now() }) {
  const stamp = new Date(now).toISOString().replace(/\.\d+Z$/, "Z");
  return [
    `state=${health?.state || "unknown"}`,
    `build=${buildId}`,
    role ? `role=${role}` : null,
    workspaceSlug ? `restaurant=${workspaceSlug}` : null,
    `at=${stamp}`,
  ].filter(Boolean).join(" · ");
}
