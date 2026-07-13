const STORAGE_KEY = "milka_client_diagnostics_v1";
const MAX_ENTRIES = 30;

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/\b(?:sb_secret_|sb_publishable_)[A-Za-z0-9_-]+\b/g, "[redacted-key]")
    .replace(/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\b/g, "[redacted-token]")
    .slice(0, maxLength);
}
export function readClientDiagnostics() {
  if (typeof localStorage === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

export function recordClientDiagnostic(source, error) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    source: cleanText(source || "runtime", 80),
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
