/**
 * foldTable — fold a locally-edited table together with a newer copy of the
 * same table from the store, using the last-synced ancestor to tell who
 * touched what.
 *
 * Granularity: top-level fields, and whole seats (matched by seat id). For
 * each unit, the LOCAL version wins only where it actually differs from the
 * ancestor; everything the local user didn't touch adopts the incoming value.
 * So two waiters editing DIFFERENT seats of the same table both keep their
 * work, and a genuine same-seat conflict resolves to the local edit — which
 * the pending autosave then writes, converging every device via row-level
 * last-write-wins.
 *
 * Pure and dependency-free. Callers are expected to sanitize the result.
 */

const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function foldSeats(ancestorSeats, mineSeats, theirsSeats) {
  const byId = (list) => new Map((Array.isArray(list) ? list : []).map((s) => [s.id, s]));
  const anc = byId(ancestorSeats);
  const mine = byId(mineSeats);
  const theirs = byId(theirsSeats);
  const ids = [...new Set([...theirs.keys(), ...mine.keys()])].sort((a, b) => a - b);

  const out = [];
  for (const id of ids) {
    const m = mine.get(id);
    const a = anc.get(id);
    const t = theirs.get(id);
    if (m && t) {
      out.push(eq(m, a) ? t : m); // untouched locally → adopt theirs; else local edit wins
    } else if (t && !m) {
      // Seat only in theirs: if the ancestor had it, the local user removed it
      // (guest count reduced) — the removal wins. Otherwise theirs added it.
      if (!a) out.push(t);
    } else if (m && !t) {
      // Seat only in mine: if it's an untouched ancestor seat, theirs removed
      // it — adopt the removal. A locally-edited or locally-added seat stays.
      if (!a || !eq(m, a)) out.push(m);
    }
  }
  return out;
}

export function foldTable(ancestor, mine, theirs) {
  if (!ancestor) return mine; // no ancestor to diff against — keep local edits whole
  const out = {};
  const keys = new Set([...Object.keys(theirs || {}), ...Object.keys(mine || {})]);
  keys.delete("seats");
  for (const k of keys) {
    out[k] = eq(mine?.[k], ancestor?.[k]) ? theirs?.[k] : mine?.[k];
  }
  out.seats = foldSeats(ancestor?.seats, mine?.seats, theirs?.seats);
  out.id = mine?.id ?? theirs?.id;
  return out;
}
