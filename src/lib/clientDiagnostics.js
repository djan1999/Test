const STORAGE_KEY = "milka_client_diagnostics_v1";
const MAX_ENTRIES = 30;

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/\b(?:sb_secret_|sb_publishable_)[A-Za-z0-9_-]+\b/g, "[redacted-key]")
    .replace(/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\b/g, "[redacted-token]")
    .slice(0, maxLength);
}
// ── two very different things end up in this log ─────────────────────────────
// A DEFENCE that fired ("a device tried to overwrite live work with a stale
// copy; the write was refused and the server's table kept") is the system
// WORKING — nothing was lost and there is nothing to do. An ERROR is something
// that actually broke. Showing both as red "recorded issues" teaches the owner
// that red is normal, which is how a real alarm gets ignored on a busy night.
// Every entry therefore carries a `kind`; legacy entries recorded before this
// split are classified by their source so old logs read correctly too.
const DEFENCE_SOURCES = new Set([
  "board write refused (newer table kept)", // the CAS/worked-content shield held
  "floor settings conflict",                // concurrent edits, BOTH preserved
  "reservation edit discarded (row deleted)", // edit to a row that no longer exists
]);

export function diagnosticKind(entry) {
  if (entry?.kind === "defence" || entry?.kind === "error") return entry.kind;
  return DEFENCE_SOURCES.has(String(entry?.source || "")) ? "defence" : "error";
}

export function readClientDiagnostics() {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_ENTRIES).map((entry) => ({ ...entry, kind: diagnosticKind(entry) }));
  } catch {
    return [];
  }
}

export function recordClientDiagnostic(source, error, { kind } = {}) {
  const cleanSource = cleanText(source || "runtime", 80);
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    source: cleanSource,
    kind: kind === "defence" ? "defence" : diagnosticKind({ source: cleanSource, kind }),
    message: cleanText(error?.message || error || "Unknown error", 600),
    stack: cleanText(error?.stack || "", 2400),
  };

  if (typeof localStorage !== "undefined") {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify([entry, ...readClientDiagnostics()].slice(0, MAX_ENTRIES)),
      );
    } catch {}
  }

  if (typeof window !== "undefined") {
    try { window.dispatchEvent(new CustomEvent("milka:diagnostic", { detail: entry })); } catch {}
  }
  return entry;
}

export function clearClientDiagnostics() {
  if (typeof localStorage !== "undefined") {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }
  if (typeof window !== "undefined") {
    try { window.dispatchEvent(new CustomEvent("milka:diagnostics-cleared")); } catch {}
  }
}

let globalHandlersInstalled = false;

export function installGlobalDiagnostics() {
  if (globalHandlersInstalled || typeof window === "undefined") return;
  globalHandlersInstalled = true;

  window.addEventListener("error", (event) => {
    recordClientDiagnostic("window.error", event.error || event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    recordClientDiagnostic("unhandledrejection", event.reason);
  });
}
