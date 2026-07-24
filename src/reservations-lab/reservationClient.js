const ACCESS_KEY = "milka_reservations_lab_access";
const EDGE_API = String(import.meta.env.VITE_RESERVATIONS_API_URL || "").replace(/\/+$/, "");

async function edgeRequest(action, body = {}, { staff = false } = {}) {
  if (!EDGE_API) return null;
  const response = await fetch(EDGE_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(staff ? { "x-milka-lab-access": getLabAccessCode() } : {}),
    },
    body: JSON.stringify({ action, ...body }),
  });
  return parseResponse(response);
}

async function parseResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.message || payload.error || "Reservation request failed.");
    error.code = payload.error;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function staffHeaders(credentials = getLabAccessCode()) {
  if (credentials && typeof credentials === "object") {
    const accessToken = String(credentials.accessToken || "").trim();
    const workspaceId = String(credentials.workspaceId || "").trim();
    return {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(workspaceId ? { "x-milka-workspace-id": workspaceId } : {}),
    };
  }
  const accessCode = String(credentials || "").trim();
  return accessCode ? { "x-milka-lab-access": accessCode } : {};
}

export function getLabAccessCode() {
  try {
    return sessionStorage.getItem(ACCESS_KEY) || "";
  } catch {
    return "";
  }
}

export function setLabAccessCode(value) {
  try {
    if (value) sessionStorage.setItem(ACCESS_KEY, value);
    else sessionStorage.removeItem(ACCESS_KEY);
  } catch {
    // Session storage is a convenience only; the server still checks each call.
  }
}

export async function loadStaffState(credentials = getLabAccessCode()) {
  if (EDGE_API) {
    const response = await fetch(EDGE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...staffHeaders(credentials) },
      body: JSON.stringify({ action: "staffState" }),
    });
    return parseResponse(response);
  }
  const response = await fetch("/api/resv/staff", {
    headers: staffHeaders(credentials),
    cache: "no-store",
  });
  return parseResponse(response);
}

export async function staffAction(action, body = {}, credentials = getLabAccessCode()) {
  if (EDGE_API) {
    const response = await fetch(EDGE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...staffHeaders(credentials) },
      body: JSON.stringify({ action, ...body }),
    });
    return parseResponse(response);
  }
  const response = await fetch("/api/resv/staff", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...staffHeaders(credentials),
    },
    body: JSON.stringify({ action, ...body }),
  });
  return parseResponse(response);
}

export async function loadPublicConfig() {
  if (EDGE_API) return edgeRequest("publicConfig");
  const response = await fetch("/api/resv/public?mode=config", { cache: "no-store" });
  return parseResponse(response);
}

export async function loadPublicAvailability(date, pax) {
  if (EDGE_API) return edgeRequest("availability", { date, pax });
  const params = new URLSearchParams({ mode: "availability", date, pax: String(pax) });
  const response = await fetch(`/api/resv/public?${params}`, { cache: "no-store" });
  return parseResponse(response);
}

export async function submitPublicBooking(booking, idempotencyKey) {
  if (EDGE_API) return edgeRequest("submit", { booking, idempotencyKey });
  const response = await fetch("/api/resv/public", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "submit", booking, idempotencyKey }),
  });
  return parseResponse(response);
}

export async function validatePublicBooking(booking, idempotencyKey) {
  if (EDGE_API) return edgeRequest("validate", { booking, idempotencyKey });
  const response = await fetch("/api/resv/public", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "validate", booking, idempotencyKey }),
  });
  return parseResponse(response);
}

export async function submitPublicWaitlist(entry) {
  if (EDGE_API) return edgeRequest("waitlist", { entry });
  const response = await fetch("/api/resv/public", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "waitlist", entry }),
  });
  return parseResponse(response);
}

export async function loadManagedBooking(token) {
  if (EDGE_API) return edgeRequest("manage", { token });
  const params = new URLSearchParams({ mode: "manage", token });
  const response = await fetch(`/api/resv/public?${params}`, { cache: "no-store" });
  return parseResponse(response);
}

export async function cancelManagedBooking(token, reason) {
  if (EDGE_API) return edgeRequest("cancel", { token, reason });
  const response = await fetch("/api/resv/public", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "cancel", token, reason }),
  });
  return parseResponse(response);
}

export async function changeManagedBooking(token, booking, idempotencyKey) {
  if (EDGE_API) return edgeRequest("change", { token, booking, idempotencyKey });
  const response = await fetch("/api/resv/public", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "change", token, booking, idempotencyKey }),
  });
  return parseResponse(response);
}

export function localISODate(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Ljubljana",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

export function shiftISODate(date, amount) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

export function formatLongDate(date) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}
