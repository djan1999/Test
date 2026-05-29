import { resolveAperitifCatalogItem } from "./search.js";

/** Stable beverage id for Quick Access: `${category}|${name}` (name is full display name from DB). */
export function buildBeverageLinkedKey(category, name) {
  return `${String(category || "").trim().toLowerCase()}|${String(name || "").trim()}`;
}

function parseBeverageLinkedKey(linkedKey) {
  const s = String(linkedKey || "");
  const i = s.indexOf("|");
  if (i < 0) return null;
  return { category: s.slice(0, i).trim().toLowerCase(), name: s.slice(i + 1).trim() };
}

export function resolveQuickAccessLinkedItem(linkedKey, type, { wines = [], cocktails = [], spirits = [], beers = [] } = {}) {
  if (!linkedKey) return null;
  if (type === "wine") {
    return wines.find(w => w.id === linkedKey) || null;
  }
  const parsed = parseBeverageLinkedKey(linkedKey);
  if (!parsed) return null;
  const lists = { cocktail: cocktails, spirit: spirits, beer: beers };
  const list = lists[parsed.category] || lists[type];
  if (!list) return null;
  return list.find(x => x.name === parsed.name) || null;
}

/** Resolve Quick Access row to a catalog row: linkedKey first, then fuzzy searchKey. */
export function resolveAperitifFromQuickAccessOption(ap, { wines, cocktails, spirits, beers }) {
  const type = ap?.type || "wine";
  if (ap?.linkedKey) {
    const byLink = resolveQuickAccessLinkedItem(ap.linkedKey, type, { wines, cocktails, spirits, beers });
    if (byLink) return byLink;
  }
  return resolveAperitifCatalogItem(ap?.searchKey || ap?.label, type, { wines, cocktails, spirits, beers });
}

/** Whether a seat chip is the same product as this Quick Access config row. */
export function aperitifMatchesQuickAccessOption(stored, ap, { wines, cocktails, spirits, beers }) {
  if (!stored) return false;
  const resolved = resolveAperitifFromQuickAccessOption(ap, { wines, cocktails, spirits, beers });
  const type = ap?.type || "wine";
  if (resolved) {
    if (type === "wine") {
      if (stored.id && resolved.id) return stored.id === resolved.id;
      return (stored.name || "") === (resolved.name || "") && (stored.producer || "") === (resolved.producer || "");
    }
    return (stored.name || "") === (resolved.name || "");
  }
  const sk = String(ap?.searchKey || ap?.label || "").trim().toLowerCase();
  if (!sk) return false;
  const xn = (stored.name || "").toLowerCase();
  const xp = (stored.producer || "").toLowerCase();
  return xn.includes(sk) || xp.includes(sk) || (xn.length >= 4 && sk.includes(xn)) || (xp.length >= 4 && sk.includes(xp));
}
