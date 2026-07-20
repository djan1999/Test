export const MAX_ONBOARDING_TABLES = 60;
export const MIN_ONBOARDING_TABLE_ID = 1;
export const MAX_ONBOARDING_TABLE_ID = 999;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function slugifyRestaurantName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

export function defaultOnboardingTables(count = 10) {
  const safeCount = Math.min(MAX_ONBOARDING_TABLES, Math.max(1, Number(count) || 10));
  return Array.from({ length: safeCount }, (_, index) => ({
    id: index + 1,
    label: `T${String(index + 1).padStart(2, "0")}`,
  }));
}

export function isValidTimeZone(value) {
  const timeZone = String(value || "").trim();
  if (!timeZone || timeZone.length > 80) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

export function normalizeManagedRestaurantPayload(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const name = String(source.name || "").trim().replace(/\s+/g, " ").slice(0, 80);
  const slug = String(source.slug || slugifyRestaurantName(name)).trim().toLowerCase();
  const subtitle = String(source.subtitle || "SERVICE BOARD").trim().replace(/\s+/g, " ").slice(0, 80);
  const adminEmail = String(source.adminEmail || "").trim().toLowerCase();
  const timezone = String(source.timezone || "Europe/Ljubljana").trim();
  const keepOperatorAdmin = source.keepOperatorAdmin !== false;
  const inputTables = Array.isArray(source.tables) ? source.tables : [];
  const tables = [];
  const seenIds = new Set();

  for (const entry of inputTables) {
    const id = Number(entry?.id);
    const label = String(entry?.label || "").trim().replace(/\s+/g, " ").slice(0, 20);
    if (!Number.isInteger(id) || id < MIN_ONBOARDING_TABLE_ID || id > MAX_ONBOARDING_TABLE_ID) continue;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    tables.push({ id, label: label || `T${String(id).padStart(2, "0")}` });
    if (tables.length >= MAX_ONBOARDING_TABLES) break;
  }
  tables.sort((a, b) => a.id - b.id);

  const errors = {};
  if (!name) errors.name = "Enter the restaurant name.";
  if (!SLUG_PATTERN.test(slug) || slug.length > 60) {
    errors.slug = "Use lowercase letters, numbers, and single hyphens only.";
  }
  if (!EMAIL_PATTERN.test(adminEmail) || adminEmail.length > 254) {
    errors.adminEmail = "Enter a valid Admin email address.";
  }
  if (!isValidTimeZone(timezone)) errors.timezone = "Choose a valid IANA timezone.";
  if (!tables.length) errors.tables = "Configure at least one table.";
  if (inputTables.length > MAX_ONBOARDING_TABLES) {
    errors.tables = `A restaurant can have at most ${MAX_ONBOARDING_TABLES} tables.`;
  }
  if (inputTables.length !== seenIds.size) errors.tables = "Every table needs a unique numeric id.";

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: {
      name,
      slug,
      subtitle: subtitle || "SERVICE BOARD",
      adminEmail,
      timezone,
      keepOperatorAdmin,
      tables,
    },
  };
}

export function parsePlatformOperatorIds(value) {
  return new Set(
    String(value || "")
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(entry)),
  );
}
