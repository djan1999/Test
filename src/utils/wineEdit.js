// Copy-on-edit for synced wines.
//
// The nightly website sync deletes and re-inserts every wine with
// source:'sync'. Any hand correction made to a synced wine (typo fix, marking
// it by-the-glass, …) therefore vanished at 02:00. The fix: the moment a human
// edits a synced wine, flip that row to source:'manual' (keeping its key).
// The sync never deletes manual rows, and skips scraped rows whose key already
// exists (ignoreDuplicates) — so the human correction permanently wins.

/** Content fingerprint used to detect a human edit to a synced wine. */
export const wineFingerprint = (w) => JSON.stringify([
  w?.name || "",
  w?.producer || "",
  w?.vintage || "NV",
  w?.region || "",
  w?.country || "",
  !!w?.byGlass,
]);

/**
 * Stamp the definitive `source` onto each wine about to be saved.
 * - A wine already marked manual stays manual — even if its content matches
 *   the original again (a flipped row must never silently revert to sync).
 * - A sync wine whose content changed vs. the original list flips to manual.
 * - Wines without a source fall back to their key prefix ("manual|…").
 */
export function stampWineSources(updatedWines, originalWines) {
  const originalById = new Map((originalWines || []).map(w => [w.id, w]));
  return (updatedWines || []).map(w => {
    const key = typeof w.id === "string" ? w.id : `manual|legacy_${w.id}`;
    let source = w.source || (String(key).startsWith("manual|") ? "manual" : "sync");
    if (source === "sync") {
      const orig = originalById.get(w.id);
      if (orig && wineFingerprint(orig) !== wineFingerprint(w)) source = "manual";
    }
    return { ...w, source };
  });
}

const wineKey = (w) => (typeof w.id === "string" ? w.id : `manual|legacy_${w.id}`);

/** The database row a wine is stored as (without workspace_id). */
export const wineToRow = (w) => ({
  key: wineKey(w),
  source: w.source,
  wine_name: w.name,
  name: w.producer ? `${w.producer} – ${w.name}` : w.name,
  producer: w.producer || "",
  vintage: w.vintage || "NV",
  region: w.region || "",
  country: w.country || "",
  by_glass: w.byGlass ?? false,
});

/**
 * What a catalogue save actually has to send. The editor hands back the WHOLE
 * list, and upserting all of it rewrote ~1,500 rows per one-wine edit — every
 * row a WAL change, a realtime event and a PowerSync op on every device.
 * Only rows that are new or differ from the original list are written; keys
 * that disappeared are deleted. `stampedWines` must already carry sources
 * (stampWineSources), so a sync → manual flip counts as a change.
 */
export function wineSaveDiff(stampedWines, originalWines) {
  const originalRows = new Map((originalWines || []).map((w) => {
    const row = wineToRow({ ...w, source: w.source || "sync" });
    return [row.key, JSON.stringify(row)];
  }));
  const allRows = (stampedWines || []).map(wineToRow);
  const savedKeys = new Set(allRows.map((r) => r.key));
  return {
    rows: allRows.filter((r) => originalRows.get(r.key) !== JSON.stringify(r)),
    deletedKeys: (originalWines || [])
      .map((w) => (typeof w.id === "string" ? w.id : null))
      .filter((k) => k && !savedKeys.has(k)),
  };
}
