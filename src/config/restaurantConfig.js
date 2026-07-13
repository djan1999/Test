import { blankTable, sanitizeTable, tableHasServiceContent } from "../utils/tableHelpers.js";

export const RESTAURANT_CONFIG_KEY = "restaurant_config_v1";
export const MIN_TABLE_ID = 1;
export const MAX_TABLE_ID = 999;
export const MAX_CONFIGURED_TABLES = 60;

export const DEFAULT_MILKA_TABLES = Object.freeze(
  Array.from({ length: 10 }, (_, index) => Object.freeze({
    id: index + 1,
    label: `T${String(index + 1).padStart(2, "0")}`,
  })),
);

export function makeDefaultRestaurantConfig({
  name = "MILKA",
  subtitle = "SERVICE BOARD",
  tables = DEFAULT_MILKA_TABLES,
} = {}) {
  return sanitizeRestaurantConfig({ version: 1, name, subtitle, tables });
}

export function sanitizeRestaurantConfig(raw, fallback = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const fallbackTables = Array.isArray(fallback.tables) && fallback.tables.length
    ? fallback.tables
    : DEFAULT_MILKA_TABLES;
  const inputTables = Array.isArray(source.tables) && source.tables.length
    ? source.tables
    : fallbackTables;
  const seen = new Set();
  const tables = [];
  for (const entry of inputTables) {
    const id = Number(typeof entry === "object" ? entry?.id : entry);
    if (!Number.isInteger(id) || id < MIN_TABLE_ID || id > MAX_TABLE_ID || seen.has(id)) continue;
    seen.add(id);
    const rawLabel = typeof entry === "object" ? entry?.label : "";
    tables.push({
      id,
      label: String(rawLabel || `T${String(id).padStart(2, "0")}`).trim().slice(0, 20),
    });
    if (tables.length >= MAX_CONFIGURED_TABLES) break;
  }
  if (!tables.length) tables.push(...DEFAULT_MILKA_TABLES.map((entry) => ({ ...entry })));
  tables.sort((a, b) => a.id - b.id);
  return {
    version: 1,
    name: String(source.name || fallback.name || "MILKA").trim().slice(0, 80) || "MILKA",
    subtitle: String(source.subtitle || fallback.subtitle || "SERVICE BOARD").trim().slice(0, 80) || "SERVICE BOARD",
    tables,
  };
}

export function configuredTableIds(config) {
  return sanitizeRestaurantConfig(config).tables.map((table) => table.id);
}

export function configuredTableLabel(config, tableId) {
  const id = Number(tableId);
  return sanitizeRestaurantConfig(config).tables.find((table) => table.id === id)?.label
    || `T${String(id).padStart(2, "0")}`;
}

/**
 * Apply a configuration to an in-memory board without dropping a live table.
 * Removed, empty tables disappear; removed tables with service activity remain
 * visible until the service is safely ended or cleared.
 */
export function reconcileConfiguredTables(existing, config) {
  const current = Array.isArray(existing) ? existing.map(sanitizeTable) : [];
  const byId = new Map(current.map((table) => [Number(table.id), table]));
  const configured = configuredTableIds(config).map((id) => byId.get(id) || blankTable(id));
  const configuredIds = new Set(configured.map((table) => table.id));
  const protectedRetired = current.filter((table) => (
    !configuredIds.has(table.id) && tableHasServiceContent(table)
  ));
  return [...configured, ...protectedRetired].sort((a, b) => a.id - b.id);
}

export function removedLiveTableIds(existing, config) {
  const configuredIds = new Set(configuredTableIds(config));
  return (existing || [])
    .filter((table) => !configuredIds.has(Number(table.id)) && tableHasServiceContent(table))
    .map((table) => Number(table.id))
    .sort((a, b) => a - b);
}
