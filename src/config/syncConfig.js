export const DEFAULT_SYNC_CONFIG = {
  winesEnabled: true,
  beveragesEnabled: true,
  wineCountries: ["SI", "AT", "IT", "FR", "HR"],
  beveragePages: [
    { category: "cocktail", label: "Cocktail", url: "https://vinska-karta.hotelmilka.si/category/cocktails/" },
    { category: "beer", label: "Beer", url: "https://vinska-karta.hotelmilka.si/category/pivo/" },
    { category: "spirit", label: "Whisky", url: "https://vinska-karta.hotelmilka.si/category/viski" },
    { category: "spirit", label: "Cognac / Brandy", url: "https://vinska-karta.hotelmilka.si/category/cognac" },
    { category: "spirit", label: "Rum", url: "https://vinska-karta.hotelmilka.si/category/rum" },
    { category: "spirit", label: "Agave", url: "https://vinska-karta.hotelmilka.si/category/agave" },
    { category: "spirit", label: "Gin", url: "https://vinska-karta.hotelmilka.si/category/gin" },
    { category: "spirit", label: "Vodka", url: "https://vinska-karta.hotelmilka.si/category/vodka" },
    { category: "spirit", label: "Other", url: "https://vinska-karta.hotelmilka.si/category/other-ostalo" },
    { category: "spirit", label: "Liqueur", url: "https://vinska-karta.hotelmilka.si/category/likerji" },
  ],
};

export function normalizeSyncConfig(raw) {
  const config = raw && typeof raw === "object" ? raw : {};
  const countries = Array.isArray(config.wineCountries) ? config.wineCountries : DEFAULT_SYNC_CONFIG.wineCountries;
  const beveragePages = Array.isArray(config.beveragePages) ? config.beveragePages : DEFAULT_SYNC_CONFIG.beveragePages;
  return {
    winesEnabled: config.winesEnabled !== false,
    beveragesEnabled: config.beveragesEnabled !== false,
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
