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
// Handles both legacy rows ("Brda, SI") and new rows ("Brda, Slovenia").
export function stripCountryFromRegion(region, country) {
  const code = String(country || "").trim();
  if (!region) return "";
  const name = COUNTRY_NAMES[code] || "";
  const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tags = [code, name].filter(Boolean).map(escape);
  if (!tags.length) return String(region).trim();
  return String(region).replace(new RegExp(`,?\\s*(?:${tags.join("|")})$`, "i"), "").trim();
}
