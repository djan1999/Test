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

// There is deliberately NO helper that stamps guest ids onto existing
// entries. An entry without one means "we don't know whose this is yet" —
// which is the normal state when a booking is taken — and inventing ids on
// load would turn that honest unknown into a claim that every restriction
// belongs to a different named person (or, worse, all to the same one).
// Attribution is only ever an explicit act: naming a guest in the form, or
// pinning the restriction to a seat during service.

/** All restriction keys carried by one person's group. */
export const groupNotes = (group) => (group?.notes || []).filter(Boolean);
