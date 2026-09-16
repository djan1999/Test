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
    // Every wine can be ordered by the bottle, so a bottle search
    // (byGlass === false) also surfaces wines poured by the glass. Only a
    // by-the-glass search (byGlass === true) stays restricted to glass wines.
    const modeMatch =
      byGlass === null || byGlass === false || w.byGlass === true;
    return hit && modeMatch;
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
const KEY_ESCAPE = /[.*+?^${}()|[\]\\]/g;

/**
 * Does this catalogue text answer to this quick-access key?
 *
 * The key has to land on a WORD BOUNDARY. A bare substring test is what linked
 * the "Tea" digestivo button to a champagne: "tea" sits inside both Co·tea·ux
 * and Cha·tea·u, so the first by-the-glass Coteaux Champenois on the list won a
 * button meant for a pot of tea — silently, because this resolver picks one
 * match rather than offering a list to choose from.
 *
 * Only the LEADING edge is checked, so a prefix key still works: "Nebb" finds
 * Nebbiolo, "Grappa" finds Grappa Williams. What it refuses is the middle of
 * somebody else's word.
 */
export const keyHitsText = (text, key) => {
  const t = String(text || "").toLowerCase();
  const k = String(key || "").trim().toLowerCase();
  if (!t || !k) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${k.replace(KEY_ESCAPE, "\\$&")}`, "u").test(t);
};

/** @deprecated Prefer resolveAperitifFromQuickAccessOption from quickAccessResolve.js when linkedKey exists */
export function resolveAperitifCatalogItem(searchKey, type, { wines = [], cocktails = [], spirits = [], beers = [], teas = [], coffees = [] } = {}) {
  const sk = String(searchKey || "").trim().toLowerCase();
  if (!sk) return null;

  const wineHit = (w) => {
    const wn = (w.name || "").toLowerCase();
    const wp = (w.producer || "").toLowerCase();
    const full = wn && wp ? `${wn} – ${wp}` : (wn || wp);
    return (
      keyHitsText(wn, sk) ||
      keyHitsText(wp, sk) ||
      keyHitsText(full, sk) ||
      // The reverse direction — a key that NAMES the product ("Aperol Spritz"
      // for an Aperol). Length-guarded, so a short row cannot swallow it.
      (wn.length >= 4 && sk.includes(wn)) ||
      (wp.length >= 4 && sk.includes(wp))
    );
  };

  const drinkHit = (d) => {
    const cn = (d?.name || "").toLowerCase();
    return keyHitsText(cn, sk) || (cn.length >= 4 && sk.includes(cn)) || keyHitsText(d?.notes, sk);
  };

  if (type === "wine") {
    return wines.find(w => w.byGlass && wineHit(w)) || wines.find(wineHit) || null;
  }
  const byType = { cocktail: cocktails, spirit: spirits, beer: beers, tea: teas, coffee: coffees };
  return byType[type]?.find(drinkHit) || null;
}

/** True if a chip already on the seat is the same product as this Quick Access row. */
export function aperitifMatchesQuickAccess(stored, searchKey, type, catalogs = {}) {
  if (!stored) return false;
  const resolved = resolveAperitifCatalogItem(searchKey, type, catalogs);
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
  return keyHitsText(xn, sk) || keyHitsText(xp, sk)
    || (xn.length >= 4 && sk.includes(xn)) || (xp.length >= 4 && sk.includes(xp));
}
