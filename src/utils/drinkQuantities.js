// ── Drink quantities (pure) ───────────────────────────────────────────────────
// A poured drink is stored as ONE ENTRY PER POUR: three glasses of the same
// Rebula are three entries in the seat's `glasses` list, and two bottles of it
// are two entries in the table's `bottleWines`. The menu generator, the archive
// counts, the kitchen and the sync rules all read that shape, so the counter
// the floor asked for is a VIEW over it rather than a new stored field:
// equal entries collapse into one row carrying a quantity, and the stepper
// adds or drops a single entry at a time.
//
// Keeping the storage flat is what makes the counter safe to add everywhere at
// once — an old tablet that never learns about quantities still reads the same
// list it always did.

const norm = (v) => String(v ?? "").trim().toLowerCase();

/**
 * What makes two stored entries "the same drink".
 *
 * Name alone is not enough: two producers ship a Rebula, and merging them puts
 * one row on screen for two different wines. Vintage counts for the same
 * reason. `byGlass` deliberately does NOT — which list an entry lives in
 * already says whether it was poured or opened, and a wine's own flag differs
 * between a catalogue hit and a manual entry.
 */
export function drinkKey(item) {
  return [norm(item?.name), norm(item?.producer), norm(item?.vintage)].join("|");
}

/**
 * One row per distinct drink, in the order they were first ordered.
 *
 * @returns {Array<{ key: string, item: object, qty: number }>}
 */
export function groupDrinks(list) {
  const rows = [];
  const byKey = new Map();
  (Array.isArray(list) ? list : []).forEach((item) => {
    if (!item) return;
    const key = drinkKey(item);
    const seen = byKey.get(key);
    if (seen) { seen.qty += 1; return; }
    const row = { key, item, qty: 1 };
    byKey.set(key, row);
    rows.push(row);
  });
  return rows;
}

/** One more of the same drink. A copy, so the two entries never alias. */
export function addOne(list, item) {
  return [...(Array.isArray(list) ? list : []), { ...item }];
}

/**
 * One fewer. Drops the LAST matching entry so a mis-tapped `+` is undone by
 * the `−` next to it, and leaves the list untouched when nothing matches.
 */
export function removeOne(list, key) {
  const next = Array.isArray(list) ? [...list] : [];
  for (let i = next.length - 1; i >= 0; i -= 1) {
    if (next[i] && drinkKey(next[i]) === key) {
      next.splice(i, 1);
      return next;
    }
  }
  return next;
}

/** Every one of them — what the row's × has always meant. */
export function removeAll(list, key) {
  return (Array.isArray(list) ? list : []).filter((x) => !x || drinkKey(x) !== key);
}

/** How many of that drink the list holds. */
export function countOf(list, key) {
  return (Array.isArray(list) ? list : []).filter((x) => x && drinkKey(x) === key).length;
}

/**
 * " ×3" for a round, and nothing at all for a single pour — a summary line
 * reading "Negroni ×1" is noise on every party that ordered one of something.
 */
export function qtySuffix(qty) {
  return Number(qty) > 1 ? ` ×${qty}` : "";
}
