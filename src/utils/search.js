/**
 * Fuzzy search helpers for wine and drink catalogs.
 */

export const fuzzy = (q, wineList, byGlass = null) => {
  if (!q) return [];
  const lq = q.toLowerCase();
  return wineList.filter(w => {
    const hit = w.name.toLowerCase().includes(lq)
      || w.producer.toLowerCase().includes(lq)
      || w.vintage.includes(lq);
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
