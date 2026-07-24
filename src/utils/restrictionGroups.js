/**
 * Restrictions belong to PEOPLE, not to tables.
 *
 * A table restriction entry is `{ note, pos, guest?, detail?, kitchenAdded? }`.
 * Historically each entry stood alone, so a guest who is "no pork + no
 * alcohol + no fish" produced three independent entries — three separate
 * "1× …" lines on the kitchen ticket for ONE person, and three chips to pin
 * to a chair one at a time.
 *
 * `guest` ties entries to the same prospective person BEFORE seats are
 * assigned; once assigned, `pos` does the same job (a chair holds exactly one
 * guest). Everything downstream — the ticket's mod counts, the printed menu,
 * the unassigned strip — groups on the pair.
 *
 * Entries with neither marker keep the old semantics: one entry, one person.
 */

// Grouping identity for one entry. Seat wins when present: a chair holds one
// guest, so two entries pinned to the same P are the same person even if they
// were entered separately (or carry different `guest` ids from older data).
export function guestKeyOf(restriction, index) {
  if (!restriction) return `anon:${index}`;
  if (restriction.pos != null) return `pos:${restriction.pos}`;
  if (restriction.guest) return `guest:${restriction.guest}`;
  return `anon:${index}`;
}

/**
 * Group a table's restrictions by person, preserving entry order.
 *
 * Returns `[{ key, guest, pos, notes, entries, indices }]` where `indices` are
 * positions in the ORIGINAL array — callers assign or remove a whole person's
 * restrictions in one write with them.
 */
export function groupRestrictionsByGuest(restrictions = []) {
  const order = [];
  const groups = new Map();
  (restrictions || []).forEach((r, index) => {
    if (!r || !r.note) return;
    const key = guestKeyOf(r, index);
    if (!groups.has(key)) {
      groups.set(key, { key, guest: r.guest || null, pos: r.pos ?? null, notes: [], entries: [], indices: [] });
      order.push(key);
    }
    const group = groups.get(key);
    group.notes.push(r.note);
    group.entries.push(r);
    group.indices.push(index);
    if (group.guest == null && r.guest) group.guest = r.guest;
    if (group.pos == null && r.pos != null) group.pos = r.pos;
  });
  return order.map((key) => groups.get(key));
}

/** Next free `gN` guest id for this table's restriction list. */
export function nextGuestId(restrictions = []) {
  let max = 0;
  (restrictions || []).forEach((r) => {
    const match = /^g(\d+)$/.exec(String(r?.guest || ""));
    if (match) max = Math.max(max, Number(match[1]));
  });
  return `g${max + 1}`;
}

/**
 * Stamp a guest id onto every unassigned entry that lacks one.
 *
 * Reservations written before grouping existed treated each entry as its own
 * person, so each gets its OWN id — counts stay exactly as they are today and
 * staff can merge them by hand. Seat-pinned entries are left alone: `pos`
 * already identifies the person.
 */
export function withGuestIds(restrictions = []) {
  const used = new Set((restrictions || []).map((r) => r?.guest).filter(Boolean));
  let n = 0;
  const mint = () => {
    let id;
    do { id = `g${++n}`; } while (used.has(id));
    used.add(id);
    return id;
  };
  return (restrictions || []).map((r) =>
    (r && r.note && !r.guest && r.pos == null) ? { ...r, guest: mint() } : r);
}

/** All restriction keys carried by one person's group. */
export const groupNotes = (group) => (group?.notes || []).filter(Boolean);
