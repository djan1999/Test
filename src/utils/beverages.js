/**
 * Pure helpers for reconciling the beverages catalog.
 * No React or browser dependencies — safe to import in tests and serverless code.
 */

/**
 * The name two rows are the same drink by — the only thing the website and the
 * operator can both be said to know about a row.
 */
const bevKey = (row) => String(row?.name ?? "").trim().toLowerCase();

/**
 * Pick the rows to display for a single beverage category from the full
 * `beverages` table dump.
 *
 * The hotel website is the source of truth for the rows IT carries: where a
 * category has synced rows, those win over a manual row of the same name, so a
 * one-off admin "Save Drinks" — which snapshots the list into `manual` rows —
 * can never shadow a later sync (the bug where the cocktail list stopped
 * updating).
 *
 * A manual row the sync does NOT carry is a different thing: a drink the
 * kitchen pours that the website does not list, and it shows alongside. Sync
 * winning outright is what made adding a tea to a synced category look like a
 * save that did nothing — the row reached the table and was then filtered out
 * of every read of it.
 *
 * Each returned row carries the `source` it came from, so a save can write
 * back the operator's own rows without claiming the website's as its own.
 *
 * @param {Array<{category:string, name:string, notes?:string, position?:number, source?:string, id?:any}>} rows
 * @param {string} cat
 * @returns {Array<{id:any, name:string, notes:string, position:number, source:string}>}
 */
export function pickBeveragesForCategory(rows, cat) {
  const all = (Array.isArray(rows) ? rows : []).filter(r => r.category === cat);
  const byPos = (a, b) => (a.position ?? 0) - (b.position ?? 0);
  const sync = all.filter(r => r.source === "sync").sort(byPos);
  const manual = all.filter(r => r.source === "manual").sort(byPos);
  const synced = new Set(sync.map(bevKey));
  const chosen = sync.length > 0
    ? [...sync, ...manual.filter(r => !synced.has(bevKey(r)))]
    : manual;
  return chosen.map((r, i) => ({
    id: r.id,
    name: r.name,
    notes: r.notes || "",
    position: r.position ?? i,
    source: r.source === "sync" ? "sync" : "manual",
  }));
}

/**
 * The rows one category's edited list writes back: the operator's own, never
 * the website's.
 *
 * Writing the whole displayed list back as `manual` is what left a synced
 * category holding two copies of every row — the sync's, and a manual twin of
 * it that the read above then had to throw away. A row that came from the sync
 * is the website's to change.
 *
 * @param {Array<{name:string, notes?:string, source?:string}>} list
 * @param {string} category
 */
export function manualBeverageRows(list, category) {
  return (Array.isArray(list) ? list : [])
    .filter(item => item?.source !== "sync" && String(item?.name ?? "").trim())
    .map((item, i) => ({
      category,
      name: item.name,
      notes: item.notes || "",
      position: i,
      source: "manual",
    }));
}
