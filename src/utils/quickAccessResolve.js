import { resolveAperitifCatalogItem, keyHitsText } from "./search.js";

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

// The website sync keys a wine `producer|name|vintage|country`, lowercased with
// spaces as underscores (api/sync-wines.js). Hand-added wines are `manual|…`
// and say nothing about who made them.
const slug = (s) => String(s || "").trim().toLowerCase().replace(/\s/g, "_");
const wineKeyProducer = (key) => {
  const s = String(key || "");
  if (!s.includes("|") || s.startsWith("manual|")) return null;
  return s.slice(0, s.indexOf("|"));
};

/**
 * True when a wine row's key names a different producer than the row itself.
 *
 * Editing a synced wine in Drinks keeps its key (copy-on-edit, utils/wineEdit),
 * so a row retyped from one wine into another — the Adrien Renoir glass pour
 * overwritten with Nakada-Park Harmonie — still carries the old wine's id. A
 * Quick Access button linked to it shows that old id, and if the nightly sync
 * later brings the real Harmonie in, the list holds two Harmonies that the
 * picker cannot tell apart.
 */
export function wineKeyIsStale(wine) {
  const kp = wineKeyProducer(wine?.id);
  return Boolean(kp && wine?.producer && kp !== slug(wine.producer));
}

export function resolveQuickAccessLinkedItem(linkedKey, type, { wines = [], cocktails = [], spirits = [], beers = [], teas = [], coffees = [] } = {}) {
  if (!linkedKey) return null;
  if (type === "wine") {
    return wines.find(w => w.id === linkedKey) || null;
  }
  const parsed = parseBeverageLinkedKey(linkedKey);
  if (!parsed) return null;
  const lists = { cocktail: cocktails, spirit: spirits, beer: beers, tea: teas, coffee: coffees };
  const list = lists[parsed.category] || lists[type];
  if (!list) return null;
  return list.find(x => x.name === parsed.name) || null;
}

/**
 * A linked product whose row is gone — the sync re-keyed it (new vintage, new
 * disgorgement) or it was deleted. Only the SAME product may stand in for it:
 * the exact name it was picked under, and for a synced wine the same producer.
 *
 * This used to fall through to the fuzzy label search, which is how a button
 * came back holding whichever by-the-glass wine looked like the words — an
 * older Adrien Renoir, another house's "Grand Cru". A button that resolves to
 * nothing is shown as broken in the admin panel; a button that resolves to the
 * wrong wine is poured.
 */
function resolveRelinkedByName(ap, type, { wines = [], cocktails = [], spirits = [], beers = [], teas = [], coffees = [] } = {}) {
  const name = String(ap?.searchKey || "").trim().toLowerCase();
  if (!name) return null;
  if (type === "wine") {
    const producer = wineKeyProducer(ap.linkedKey);
    const hits = wines.filter(w =>
      String(w.name || "").trim().toLowerCase() === name
      && (!producer || slug(w.producer) === producer));
    return hits.find(w => w.byGlass) || hits[0] || null;
  }
  const parsed = parseBeverageLinkedKey(ap.linkedKey);
  const lists = { cocktail: cocktails, spirit: spirits, beer: beers, tea: teas, coffee: coffees };
  const list = lists[parsed?.category] || lists[type] || [];
  return list.find(x => String(x.name || "").trim().toLowerCase() === name) || null;
}

/** Resolve Quick Access row to a catalog row: linkedKey first, then fuzzy searchKey (unlinked rows only). */
export function resolveAperitifFromQuickAccessOption(ap, catalogs = {}) {
  const type = ap?.type || "wine";
  if (ap?.linkedKey) {
    return resolveQuickAccessLinkedItem(ap.linkedKey, type, catalogs)
      || resolveRelinkedByName(ap, type, catalogs);
  }
  return resolveAperitifCatalogItem(ap?.searchKey || ap?.label, type, catalogs);
}

/**
 * What the admin panel should say about one Quick Access row's product.
 *   linked  — the linked row is there
 *   relinked — the linked row is gone; the same product was found by name
 *   missing — linked, and nothing stands in for it
 *   guessed — never linked; the label/search text matched this row
 *   none    — never linked and nothing matches
 */
export function describeQuickAccessLink(ap, catalogs = {}) {
  const type = ap?.type || "wine";
  if (ap?.linkedKey) {
    const direct = resolveQuickAccessLinkedItem(ap.linkedKey, type, catalogs);
    if (direct) return { status: "linked", item: direct, staleKey: type === "wine" && wineKeyIsStale(direct) };
    const relinked = resolveRelinkedByName(ap, type, catalogs);
    if (relinked) return { status: "relinked", item: relinked, staleKey: type === "wine" && wineKeyIsStale(relinked) };
    return { status: "missing", item: null, staleKey: false };
  }
  const guessed = resolveAperitifCatalogItem(ap?.searchKey || ap?.label, type, catalogs);
  return guessed ? { status: "guessed", item: guessed, staleKey: false } : { status: "none", item: null, staleKey: false };
}

/** Whether a seat chip is the same product as this Quick Access config row. */
export function aperitifMatchesQuickAccessOption(stored, ap, catalogs = {}) {
  if (!stored) return false;
  const resolved = resolveAperitifFromQuickAccessOption(ap, catalogs);
  const type = ap?.type || "wine";
  if (resolved) {
    if (type === "wine") {
      if (stored.id && resolved.id) return stored.id === resolved.id;
      return (stored.name || "") === (resolved.name || "") && (stored.producer || "") === (resolved.producer || "");
    }
    return (stored.name || "") === (resolved.name || "");
  }
  // Nothing resolved, so the button put a label-only chip on the seat
  // ({ name: label }) — that chip is this button's, whatever the search text.
  if (ap?.label && (stored.name || "") === ap.label) return true;
  const sk = String(ap?.searchKey || ap?.label || "").trim().toLowerCase();
  if (!sk) return false;
  const xn = (stored.name || "").toLowerCase();
  const xp = (stored.producer || "").toLowerCase();
  return keyHitsText(xn, sk) || keyHitsText(xp, sk)
    || (xn.length >= 4 && sk.includes(xn)) || (xp.length >= 4 && sk.includes(xp));
}
