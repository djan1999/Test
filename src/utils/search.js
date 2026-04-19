/**
 * Fuzzy search helpers for wine and drink catalogs.
 */

export const fuzzy = (q, wineList, byGlass = null) => {
  if (!q) return [];
  const lq = q.toLowerCase();
  return wineList.filter(w => {
    const hit = (w.name || "").toLowerCase().includes(lq)
      || (w.producer || "").toLowerCase().includes(lq)
      || (w.vintage || "").includes(lq);
    return hit && (byGlass === null || w.byGlass === byGlass);
  }).slice(0, 6);
};

export const fuzzyDrink = (q, list) => {
  if (!q) return [];
  const lq = q.toLowerCase();
  return list.filter(d =>
    d.name.toLowerCase().includes(lq) || (d.notes || "").toLowerCase().includes(lq)
  ).slice(0, 6);
};

/**
 * Resolve a Quick Access searchKey to a row from the live catalog (wines / cocktails / spirits / beers).
 * Matches grape name, producer, and full "Grape – Producer" strings so keys saved from the picker still work.
 */
/** @deprecated Prefer resolveAperitifFromQuickAccessOption from quickAccessResolve.js when linkedKey exists */
export function resolveAperitifCatalogItem(searchKey, type, { wines = [], cocktails = [], spirits = [], beers = [] } = {}) {
  const sk = String(searchKey || "").trim().toLowerCase();
  if (!sk) return null;

  const wineHit = (w) => {
    const wn = (w.name || "").toLowerCase();
    const wp = (w.producer || "").toLowerCase();
    const full = wn && wp ? `${wn} – ${wp}` : (wn || wp);
    return (
      wn.includes(sk) ||
      wp.includes(sk) ||
      full.includes(sk) ||
      (wn.length >= 4 && sk.includes(wn)) ||
      (wp.length >= 4 && sk.includes(wp))
    );
  };

  const drinkHit = (d) => {
    const cn = (d?.name || "").toLowerCase();
    return cn.includes(sk) || (cn.length >= 4 && sk.includes(cn)) || ((d?.notes || "").toLowerCase().includes(sk));
  };

  if (type === "wine") {
    return wines.find(w => w.byGlass && wineHit(w)) || wines.find(wineHit) || null;
  }
  if (type === "cocktail") return cocktails.find(drinkHit) || null;
  if (type === "spirit") return spirits.find(drinkHit) || null;
  if (type === "beer") return beers.find(drinkHit) || null;
  return null;
}

/** True if a chip already on the seat is the same product as this Quick Access row. */
export function aperitifMatchesQuickAccess(stored, searchKey, type, { wines = [], cocktails = [], spirits = [], beers = [] } = {}) {
  if (!stored) return false;
  const resolved = resolveAperitifCatalogItem(searchKey, type, { wines, cocktails, spirits, beers });
  if (resolved) {
    if (type === "wine") {
      return stored.id && resolved.id
        ? stored.id === resolved.id
        : (stored.name || "") === (resolved.name || "") && (stored.producer || "") === (resolved.producer || "");
    }
    return (stored.name || "") === (resolved.name || "");
  }
  const sk = String(searchKey || "").trim().toLowerCase();
  if (!sk) return false;
  const xn = (stored.name || "").toLowerCase();
  const xp = (stored.producer || "").toLowerCase();
  return xn.includes(sk) || xp.includes(sk) || (xn.length >= 4 && sk.includes(xn)) || (xp.length >= 4 && sk.includes(xp));
}
