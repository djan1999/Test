/**
 * "Same for all" — copy one guest's order onto every other chair at the table.
 *
 * Most tables order as one: four XC, four Wine pairings, four of the same
 * aperitif. The board card made staff tap that in four times.
 *
 * What is copied is the ORDER: water, pairing / BTG·BTB, every drink list, the
 * optional dishes and optional pairings. What stays with each chair is the
 * PERSON and the CHAIR:
 *   gender, hand, celebrating  — who sits there, not what they ordered
 *   floorPositions             — where the chair is on each map
 *   pairingSharedWith, and each extra's sharedWith — a share names specific
 *                                chairs (½ P2); copied, P3 would claim to
 *                                split with P2 while P2 splits with P1
 *   restrictions               — table-level by position, never touched here
 *
 * Pure: takes the seats array and returns the next one.
 */
const DRINK_LISTS = ["aperitifs", "digestivos", "glasses", "cocktails", "spirits", "beers"];

const copyExtras = (extras) => Object.fromEntries(
  Object.entries(extras && typeof extras === "object" ? extras : {}).map(([key, value]) => {
    const { sharedWith: _shared, restriction: _restriction, ...rest } = value || {};
    return [key, { ...rest }];
  }),
);

export function copySeatOrderToAll(seats, fromId) {
  const list = Array.isArray(seats) ? seats : [];
  const source = list.find((s) => s?.id === fromId);
  if (!source) return list;
  return list.map((seat) => {
    if (seat.id === fromId) return seat;
    const next = {
      ...seat,
      water: source.water ?? "—",
      pairing: source.pairing ?? "",
      pourMode: source.pourMode ?? null,
      pairingSharedWith: null,
      extras: copyExtras(source.extras),
      optionalPairings: Object.fromEntries(
        Object.entries(source.optionalPairings || {}).map(([k, v]) => [k, { ...v }]),
      ),
    };
    for (const key of DRINK_LISTS) {
      next[key] = (source[key] || []).map((item) => (item && typeof item === "object" ? { ...item } : item));
    }
    return next;
  });
}

/** Does any chair other than `fromId` already hold an order that copying would replace? */
export function otherSeatsHaveOrders(seats, fromId) {
  return (Array.isArray(seats) ? seats : []).some((s) => s?.id !== fromId && (
    (s.water && s.water !== "—")
    || (s.pairing && s.pairing !== "—")
    || !!s.pourMode
    || DRINK_LISTS.some((k) => (s[k] || []).length > 0)
    || Object.values(s.extras || {}).some((e) => e?.ordered)
    || Object.values(s.optionalPairings || {}).some((p) => p?.ordered)
  ));
}
