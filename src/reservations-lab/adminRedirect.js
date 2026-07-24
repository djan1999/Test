export function reservationAdminRedirectTarget(routePath) {
  const normalized = String(routePath || "").replace(/\/+$/, "") || "/";
  return normalized === "/reservations/admin" ? "/?admin=reservations" : null;
}
