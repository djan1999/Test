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
