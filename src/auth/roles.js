/**
 * Workspace roles and the app surfaces each role may open.
 *
 * Keep this module browser-free and dependency-free: the UI, tests, API
 * routes, and database migration all use the same three-role vocabulary.
 */

export const WORKSPACE_ROLES = Object.freeze({
  ADMIN: "admin",
  SERVICE: "service",
  KITCHEN: "kitchen",
});

export const ROLE_LABELS = Object.freeze({
  [WORKSPACE_ROLES.ADMIN]: "Admin",
  [WORKSPACE_ROLES.SERVICE]: "Service",
  [WORKSPACE_ROLES.KITCHEN]: "Kitchen",
});

const LEGACY_ROLE_MAP = Object.freeze({
  owner: WORKSPACE_ROLES.ADMIN,
  staff: WORKSPACE_ROLES.SERVICE,
});

const MODE_ACCESS = Object.freeze({
  [WORKSPACE_ROLES.ADMIN]: new Set([
    "admin", "service", "reservation", "menu", "display", "kitchen_floor",
  ]),
  [WORKSPACE_ROLES.SERVICE]: new Set(["service", "reservation", "menu"]),
  [WORKSPACE_ROLES.KITCHEN]: new Set(["display", "kitchen_floor"]),
});

export function normalizeWorkspaceRole(role, fallback = null) {
  const key = String(role || "").trim().toLowerCase();
  if (LEGACY_ROLE_MAP[key]) return LEGACY_ROLE_MAP[key];
  if (Object.values(WORKSPACE_ROLES).includes(key)) return key;
  return fallback;
}

export function canAccessMode(role, mode) {
  const normalized = normalizeWorkspaceRole(role);
  if (!normalized || !mode) return false;
  return MODE_ACCESS[normalized]?.has(String(mode)) === true;
}

export function canAdminister(role) {
  return normalizeWorkspaceRole(role) === WORKSPACE_ROLES.ADMIN;
}

export function visibleEntryModes(role) {
  const normalized = normalizeWorkspaceRole(role);
  if (!normalized) return [];
  return ["display", "service", "reservation", "admin", "menu"]
    .filter((mode) => canAccessMode(normalized, mode));
}

export function roleLabel(role) {
  const normalized = normalizeWorkspaceRole(role);
  return ROLE_LABELS[normalized] || "No access";
}
