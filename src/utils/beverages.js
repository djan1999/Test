/**
 * Pure helpers for reconciling the beverages catalog.
 * No React or browser dependencies — safe to import in tests and serverless code.
 */

/**
 * Pick the rows to display for a single beverage category from the full
 * `beverages` table dump.
 *
 * The hotel website is the source of truth: whenever a category has rows that
 * were written by the website sync (`source: "sync"`), those win. Manual rows
 * (`source: "manual"`) are only a fallback for categories that were never
 * synced. This prevents a one-off admin "Save Drinks" — which snapshots the
 * current list into `manual` rows — from permanently shadowing every later
 * sync (the bug where the cocktail list never updated after a sync).
 *
 * @param {Array<{category:string, name:string, notes?:string, position?:number, source?:string, id?:any}>} rows
 * @param {string} cat
 * @returns {Array<{id:any, name:string, notes:string, position:number}>}
 */
export function pickBeveragesForCategory(rows, cat) {
  const all = (Array.isArray(rows) ? rows : []).filter(r => r.category === cat);
  const byPos = (a, b) => (a.position ?? 0) - (b.position ?? 0);
  const sync = all.filter(r => r.source === "sync").sort(byPos);
  const chosen = sync.length > 0 ? sync : all.filter(r => r.source === "manual").sort(byPos);
  return chosen.map((r, i) => ({ id: r.id, name: r.name, notes: r.notes || "", position: r.position ?? i }));
}
