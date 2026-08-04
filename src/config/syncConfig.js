export const MILKA_SYNC_PROVIDER = "milka";

// A new workspace must start with NO external catalogue source. The old
// default pointed at Hotel Milka, so the first Admin to press SYNC in another
// restaurant silently copied Milka's wine and beverage catalogue into it.
export const DEFAULT_SYNC_CONFIG = Object.freeze({
  provider: null,
  winesEnabled: false,
  beveragesEnabled: false,
  wineCountries: [],
  beveragePages: [],
});

const looksLikeLegacyMilkaConfig = (config) =>
  Array.isArray(config?.beveragePages)
  && config.beveragePages.some((page) => /(^|\.)hotelmilka\.si$/i.test((() => {
    try { return new URL(String(page?.url || "")).hostname; } catch { return ""; }
  })()));

export function normalizeSyncConfig(raw) {
  const config = raw && typeof raw === "object" ? raw : {};
  // Existing Milka/Demo rows predate the provider field. Recognize their saved
  // Hotel Milka URLs so this safe default can ship without interrupting them.
  const provider = config.provider === MILKA_SYNC_PROVIDER || looksLikeLegacyMilkaConfig(config)
    ? MILKA_SYNC_PROVIDER
    : null;
  const countries = Array.isArray(config.wineCountries) ? config.wineCountries : [];
  const beveragePages = Array.isArray(config.beveragePages) ? config.beveragePages : [];
  return {
    provider,
    winesEnabled: provider === MILKA_SYNC_PROVIDER && config.winesEnabled === true,
    beveragesEnabled: provider === MILKA_SYNC_PROVIDER && config.beveragesEnabled === true,
    wineCountries: countries.map((country) => String(country || "").trim().toUpperCase()).filter(Boolean),
    beveragePages: beveragePages
      .map((page) => ({
        category: String(page?.category || "").trim().toLowerCase(),
        label: String(page?.label || "").trim(),
        url: String(page?.url || "").trim(),
      }))
      .filter((page) => page.category && page.label && page.url),
  };
}

export function hasCatalogSyncProvider(config) {
  return normalizeSyncConfig(config).provider === MILKA_SYNC_PROVIDER;
}
