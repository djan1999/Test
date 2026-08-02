// ── Forgiving beverage search (pure) ─────────────────────────────────────────
// The bar list is Slovenian: Rebula, Šipon, Žametovka, Teran, Malvazija — full
// of diacritics a phone keyboard won't produce mid-service, next to producers
// nobody spells right the first time. A plain substring match made the operator
// the one who had to be accurate.
//
// So: accents are folded, word order doesn't matter, and a token is allowed to
// be slightly wrong. Pure, because the matching rules are the whole feature and
// they deserve to be pinned by tests rather than re-derived inside a render.

/**
 * Fold a string to its comparable form: lowercase, accents stripped, every run
 * of non-alphanumerics collapsed to a single space.
 *
 * "Šipon – Klinec (2021)" → "sipon klinec 2021"
 */
export const foldText = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")   // combining marks: š → s, ž → z, č → c
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// How wrong one token is allowed to be. Short tokens get no slack — at three
// characters almost anything is within one edit of anything else, and the
// result is a list that answers every query with the whole bar.
const allowedEdits = (token) => (token.length >= 7 ? 2 : token.length >= 5 ? 1 : 0);

/**
 * Levenshtein distance, abandoned as soon as it cannot come in at or under
 * `max`. The early exit is what keeps this cheap enough to run over the whole
 * catalog on every keystroke.
 */
export function boundedEditDistance(a, b, max) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (row[j] < best) best = row[j];
    }
    if (best > max) return max + 1;      // no cell on this row can recover
    prev = row;
  }
  return prev[b.length];
}

/**
 * Score one token against one haystack word.
 * Higher is better; null means no match at all.
 */
function scoreToken(token, words) {
  let best = null;
  for (const w of words) {
    if (w === token) return 100;                       // exact word
    if (w.startsWith(token)) { best = Math.max(best ?? 0, 80); continue; }
    if (w.includes(token)) { best = Math.max(best ?? 0, 60); continue; }
    const max = allowedEdits(token);
    if (max > 0) {
      const d = boundedEditDistance(token, w, max);
      if (d <= max) best = Math.max(best ?? 0, 40 - d * 10);   // typo, ranked below
    }
  }
  return best;
}

/**
 * Match a query against a record's searchable text.
 *
 * EVERY token in the query has to land somewhere — "kli reb" finds Rebula by
 * Klinec, in either order — but each may land by prefix, by substring, or with
 * a small typo. Returns a score for ranking, or null when it doesn't match.
 */
export function matchScore(query, ...fields) {
  const tokens = foldText(query).split(" ").filter(Boolean);
  if (tokens.length === 0) return null;
  const hay = foldText(fields.filter(Boolean).join(" "));
  if (!hay) return null;
  const words = hay.split(" ").filter(Boolean);

  let total = 0;
  for (const token of tokens) {
    const s = scoreToken(token, words);
    if (s == null) return null;                        // one miss disqualifies
    total += s;
  }
  // A hit early in the name reads as more relevant than one buried in the
  // notes, so nudge by where the first token landed.
  const lead = words.findIndex(w => w.startsWith(tokens[0]));
  return total / tokens.length + (lead === 0 ? 5 : lead > 0 ? 2 : 0);
}

/** Minimum characters before the list opens at all. */
export const MIN_QUERY = 2;

/**
 * Search the whole bar in one pass.
 *
 * @param {string} query
 * @param {{wines?, cocktails?, spirits?, beers?}} catalog
 * @param {number} limit  hard cap; the list scrolls, so this is a guard against
 *                        an empty-ish query dragging the entire catalog into
 *                        the DOM, not a display limit.
 * @returns {{key, type, item, sub, score}[]} best match first
 */
export function searchBeverages(query, { wines = [], cocktails = [], spirits = [], beers = [] } = {}, limit = 40) {
  if (foldText(query).replace(/ /g, "").length < MIN_QUERY) return [];
  const out = [];

  (wines || []).forEach((w, i) => {
    const score = matchScore(query, w?.name, w?.producer, w?.vintage, w?.country, w?.region, w?.grape);
    if (score == null) return;
    out.push({
      key: `wine:${w?.id ?? `${w?.name}-${i}`}`,
      type: "wine",
      item: w,
      sub: [w?.producer, w?.vintage].filter(Boolean).join(" · "),
      score,
    });
  });

  [["cocktail", cocktails], ["spirit", spirits], ["beer", beers]].forEach(([type, list]) => {
    (list || []).forEach((d, i) => {
      const score = matchScore(query, d?.name, d?.notes);
      if (score == null) return;
      out.push({
        key: `${type}:${d?.id ?? `${d?.name}-${i}`}`,
        type,
        item: d,
        sub: d?.notes || "",
        score,
      });
    });
  });

  return out
    .sort((a, b) => b.score - a.score || String(a.item?.name || "").localeCompare(String(b.item?.name || "")))
    .slice(0, limit);
}
