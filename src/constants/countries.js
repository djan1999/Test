export const COUNTRY_NAMES = {
  FR: "France", IT: "Italy", ES: "Spain", DE: "Germany", AT: "Austria",
  SI: "Slovenia", PT: "Portugal", GR: "Greece", HU: "Hungary", HR: "Croatia",
  CH: "Switzerland", GE: "Georgia", RO: "Romania", BG: "Bulgaria", RS: "Serbia",
  CZ: "Czech Republic", SK: "Slovakia", MD: "Moldova", AM: "Armenia",
  US: "USA", AR: "Argentina", CL: "Chile", AU: "Australia", NZ: "New Zealand",
  ZA: "South Africa", UY: "Uruguay",
};

// Strip a trailing country tag (code or full name) from a region string so the
// caller can re-append the canonical display name without duplicating it.
// Handles both legacy rows ("Brda, SI") and new rows ("Brda, Slovenia"), and
// falls back to any known country in COUNTRY_NAMES when the row has no
// country column set (e.g. manually-added wines).
export function stripCountryFromRegion(region, country) {
  if (!region) return "";
  const code = String(country || "").trim();
  const name = COUNTRY_NAMES[code] || "";
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const primary = [code, name].filter(Boolean);
  // If the row has no country column, fall back to every known code/name so
  // free-text entries like "Montagne de Reims, FR" still lose the tag.
  const fallback = primary.length
    ? []
    : [...Object.keys(COUNTRY_NAMES), ...Object.values(COUNTRY_NAMES)];
  const tags = [...primary, ...fallback].map(escape);
  if (!tags.length) return String(region).trim();
  return String(region).replace(new RegExp(`,?\\s*(?:${tags.join("|")})$`, "i"), "").trim();
}

// Infer a country code from a region string by looking for a trailing country
// tag (code or full name). Returns "" when nothing matches. Used to render
// full names for rows that never had a `country` column populated.
export function inferCountryFromRegion(region) {
  const s = String(region || "").trim();
  if (!s) return "";
  const tail = s.split(",").pop().trim();
  if (!tail) return "";
  const upper = tail.toUpperCase();
  if (COUNTRY_NAMES[upper]) return upper;
  const entry = Object.entries(COUNTRY_NAMES).find(([, name]) => name.toLowerCase() === tail.toLowerCase());
  return entry ? entry[0] : "";
}
