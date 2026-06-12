// ── 86 list (out-of-stock) ───────────────────────────────────────────
// When a dish or drink runs out mid-service it gets "86'd": flagged
// unavailable so search results, quick-access buttons and extras toggles
// grey it out instead of letting service keep selling it. The list lives in
// service_settings (id "eighty_six", state { keys: [...] }) — no schema
// migration, realtime-synced like other settings, cleared when restocked.
//
// Key scheme (strings, stable across nightly syncs):
//   wine|<wine key>          — wines use their content-derived DB key
//   cocktail|<name lower>    — beverages are recreated on sync, names persist
//   spirit|<name lower>
//   beer|<name lower>
//   dish|<optional flag>     — optional-extra courses by their flag key

export const EIGHTY_SIX_SETTINGS_ID = "eighty_six";

const normName = (v) => String(v || "").trim().toLowerCase();

export const wineEightySixKey = (w) =>
  `wine|${typeof w?.id === "string" ? w.id : normName(w?.name)}`;

/** Key for a BeverageSearch-style entry: type is wine|bottle|cocktail|spirit|beer. */
export function eightySixKeyFor(type, item) {
  if (type === "wine" || type === "bottle") return wineEightySixKey(item);
  return `${type}|${normName(item?.name)}`;
}

export const dishEightySixKey = (flag) => `dish|${normName(flag)}`;

/** State payload → clean array of keys. */
export const normalizeEightySixKeys = (state) =>
  (Array.isArray(state?.keys) ? state.keys : []).filter(k => typeof k === "string" && k.length > 0);

/** Human label for a key when the source item can't be resolved anymore. */
export function eightySixKeyLabel(key) {
  const i = String(key || "").indexOf("|");
  if (i < 0) return String(key || "");
  const type = key.slice(0, i);
  let name = key.slice(i + 1);
  // Wine keys are content-derived: producer|name|vintage|country with
  // underscores for spaces — make a readable fallback out of them.
  if (type === "wine" && name.includes("|")) name = name.split("|").slice(0, 2).join(" · ");
  return name.replace(/_/g, " ");
}
