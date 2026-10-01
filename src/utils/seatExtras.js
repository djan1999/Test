/**
 * seatExtras.js — the optional-dish controls (cheese, beetroot) as pure state.
 *
 * An optional extra carries three answers about one chair, and the floor gives
 * them with one button each:
 *
 *   ORDERED   does this guest want it at all
 *   SHARE     ½P2 — one plate between this chair and another
 *   PAIRING   a linked optional pairing (wine / non-alc) poured with it
 *
 * All three lived inline in the board card, so the floor map's dock could only
 * offer the first and had to send staff back to the card for the other two —
 * a trip across the room to say "they'll split it". The state machines live
 * here now, so every surface that shows an extra shows the SAME extra: the
 * same cycle order, the same labels, the same partner-release rule.
 *
 * Each writer takes the whole `seats` array and returns the next one, because
 * a share is a fact about two chairs: turning one off has to release the
 * partner pointing back at it, and re-pointing a share has to free the chair
 * it used to name.
 *
 * Pure: no React, no tokens, no storage.
 */

/** This dish's record on this seat, or the blank one it starts from. */
export const extraOf = (seat, dish) =>
  seat?.extras?.[dish?.key]
  || seat?.extras?.[dish?.id]
  || { ordered: false, pairing: dish?.pairings?.[0] || "—" };

/** The optional pairing wired to this dish, or null when it pours nothing. */
export const linkedPairingFor = (dish, optionalPairings = []) =>
  (optionalPairings || []).find(
    (op) => op?.extraKey && (op.extraKey === dish?.key || op.extraKey === dish?.id),
  ) || null;

// ── Share ───────────────────────────────────────────────────────────────────
// A share is a GROUP of chairs splitting one plate (or one pairing): P1 + P2,
// or P1 + P2 + P3. Every member stores the OTHER members:
//
//   P1.extras.beetroot.sharedWith = [2, 3]
//   P2.extras.beetroot.sharedWith = [1, 3]
//   P3.extras.beetroot.sharedWith = [1, 2]
//
// so any one chair answers "who am I splitting with" on its own. Older rows
// stored a single seat id (`sharedWith: 2`); shareMates() reads both shapes,
// and every writer here writes the array.
//
// The old control scrolled off → on → ½P2 → ½P3 → off on one button. Staff
// could not see who they were about to land on, could only ever pair two
// chairs, and the kitchen heard just "Share". Now the dish button is plain
// on/off and the share is chosen by tapping the chairs it goes to.

/** Every other chair in this share, sorted — [] when not shared. */
export const shareMates = (value) => {
  const raw = Array.isArray(value) ? value : (value == null ? [] : [value]);
  return [...new Set(raw.map(Number).filter((n) => Number.isFinite(n)))].sort((a, b) => a - b);
};

/** Stored form: the sorted mates, or null when the chair shares with nobody. */
const storedMates = (mates) => (mates.length ? [...mates].sort((a, b) => a - b) : null);

/** The other chairs splitting this dish with this seat. */
export const extraMates = (seat, dish) => shareMates(extraOf(seat, dish).sharedWith);

/** The other chairs splitting this seat's pairing. */
export const pairingMates = (seat) => shareMates(seat?.pairingSharedWith);

const FRACTION = { 2: "½", 3: "⅓", 4: "¼" };

/**
 * Short tag for a chair in a share, naming the partners: "½ P2", "⅓ P2+P3".
 * Empty string when not shared.
 */
export const shareTag = (mates) => {
  const list = shareMates(mates);
  if (!list.length) return "";
  const frac = FRACTION[list.length + 1] || `1/${list.length + 1}`;
  return `${frac} ${list.map((id) => `P${id}`).join("+")}`;
};

/**
 * Split chairs into their share groups. `entries` is [{ id, mates }]; returns
 * sorted id arrays, one per group (a chair sharing with nobody is its own
 * group of one), ordered by their first chair. A mate named by a chair but
 * missing from `entries` is still listed — the kitchen popup only carries the
 * chairs that changed, and "P1 + P2" must not shrink to "P1".
 */
export const shareGroups = (entries = []) => {
  const groups = [];
  const seen = new Set();
  const byId = new Map((entries || []).map((e) => [Number(e.id), shareMates(e.mates)]));
  [...byId.keys()].sort((a, b) => a - b).forEach((id) => {
    if (seen.has(id)) return;
    // Walk the links, so a half-written legacy pair (only one side pointing
    // at the other) still lands in one group.
    const group = new Set([id]);
    const queue = [id];
    while (queue.length) {
      const cur = queue.shift();
      const linked = [...(byId.get(cur) || [])];
      byId.forEach((m, other) => { if (m.includes(cur)) linked.push(other); });
      linked.forEach((n) => { if (!group.has(n)) { group.add(n); queue.push(n); } });
    }
    group.forEach((n) => seen.add(n));
    groups.push([...group].sort((a, b) => a - b));
  });
  return groups;
};

/**
 * Add `mateId` to `seatId`'s share group, or take them out of it.
 *
 * `getMates(seat)` reads a chair's mates; `write(seat, mates, role)` returns
 * the chair with its new mates, where role is "join" (just added), "leave"
 * (just removed) or "stay" (membership unchanged, mates list changed).
 * A chair joining leaves whatever group it was in before.
 */
const regroup = (list, seatId, mateId, getMates, write) => {
  const self = list.find((s) => s?.id === seatId);
  const mate = list.find((s) => s?.id === mateId);
  if (!self || !mate || seatId === mateId) return list;
  const group = new Set([seatId, ...getMates(self)].filter((id) => list.some((s) => s?.id === id)));
  const changes = new Map();
  const setGroup = (members, roleOf) => members.forEach((id) =>
    changes.set(id, { mates: members.filter((x) => x !== id), role: roleOf(id) }));

  if (group.has(mateId)) {
    group.delete(mateId);
    changes.set(mateId, { mates: [], role: "leave" });
    setGroup([...group], () => "stay");
  } else {
    // The mate's old group carries on without it.
    const old = getMates(mate).filter((id) => id !== seatId && !group.has(id)
      && list.some((s) => s?.id === id));
    setGroup(old, () => "stay");
    group.add(mateId);
    setGroup([...group], (id) => (id === mateId ? "join" : "stay"));
  }
  return list.map((s) => {
    const c = changes.get(s?.id);
    return c ? write(s, c.mates, c.role) : s;
  });
};

/** Take a chair out of its share group, leaving the rest of the group intact. */
const leaveGroup = (list, seatId, getMates, write) => {
  const self = list.find((s) => s?.id === seatId);
  if (!self) return list;
  const rest = getMates(self).filter((id) => list.some((s) => s?.id === id));
  if (!rest.length) return list;
  return list.map((s) => {
    if (s?.id === seatId) return write(s, [], "stay");
    if (rest.includes(s?.id)) return write(s, rest.filter((x) => x !== s.id), "stay");
    return s;
  });
};

const extraWriter = (dish) => (s, mates, role) => {
  const cur = extraOf(s, dish);
  const ordered = role === "join" ? true : role === "leave" ? false : cur.ordered;
  return {
    ...s,
    extras: { ...s.extras, [dish.key]: { ...cur, ordered, sharedWith: storedMates(mates) } },
  };
};

/**
 * Every seat after this seat's dish is switched on or off. Switching off also
 * takes the chair out of its share — the others keep splitting.
 */
export const withExtraToggled = (seats, seatId, dish) => {
  const list = Array.isArray(seats) ? seats : [];
  const seat = list.find((s) => s?.id === seatId);
  if (!seat || !dish?.key) return list;
  const extra = extraOf(seat, dish);
  if (extra.ordered) {
    const detached = leaveGroup(list, seatId, (s) => extraMates(s, dish), extraWriter(dish));
    return detached.map((s) => (s?.id === seatId
      ? { ...s, extras: { ...s.extras, [dish.key]: { ...extraOf(s, dish), ordered: false, sharedWith: null } } }
      : s));
  }
  return list.map((s) => (s?.id === seatId
    ? { ...s, extras: { ...s.extras, [dish.key]: { ...extra, ordered: true, sharedWith: null } } }
    : s));
};

/**
 * Every seat after `mateId` is added to (or removed from) the chairs sharing
 * `seatId`'s dish. A chair added is ordered the dish; a chair removed is not
 * — it only had it because it was splitting.
 *
 * Only `extras` is touched: a mate's own optional-pairing choice survives
 * (the "beetroot pairing disappears when I touch share" bug).
 */
export const withExtraShareToggled = (seats, seatId, dish, mateId) => {
  const list = Array.isArray(seats) ? seats : [];
  if (!dish?.key) return list;
  const seat = list.find((s) => s?.id === seatId);
  if (!seat || seatId === mateId || !list.some((s) => s?.id === mateId)) return list;
  // Sharing implies the dish is on for the chair doing the sharing.
  const base = extraOf(seat, dish).ordered ? list : withExtraToggled(list, seatId, dish);
  return regroup(base, seatId, mateId, (s) => extraMates(s, dish), extraWriter(dish));
};

/** Every seat after this chair steps out of its dish share; the rest keep splitting. */
export const withExtraShareLeft = (seats, seatId, dish) => {
  const list = Array.isArray(seats) ? seats : [];
  if (!dish?.key) return list;
  return leaveGroup(list, seatId, (s) => extraMates(s, dish), extraWriter(dish));
};

/**
 * Every seat after this seat's extra stops being shared with anyone. The
 * chairs it named are released — they only had it because they were splitting.
 */
export const withExtraShareCleared = (seats, seatId, dish) => {
  const list = Array.isArray(seats) ? seats : [];
  const seat = list.find((s) => s?.id === seatId);
  if (!seat || !dish?.key) return list;
  return extraMates(seat, dish).reduce(
    (acc, mateId) => regroup(acc, seatId, mateId, (s) => extraMates(s, dish), extraWriter(dish)),
    list,
  );
};

// ── Pairing share ───────────────────────────────────────────────────────────
// The same group, for a drinks pairing two or more guests split. A chair
// joining takes the group's pairing (and drops BTG/BTB — a paired chair has
// no pour mode); a chair leaving keeps the pairing it was poured, because it
// may well carry on with a pairing of its own.

const pairingWriter = (pairing) => (s, mates, role) => ({
  ...s,
  pairingSharedWith: storedMates(mates),
  ...(role === "join" ? { pairing, pourMode: null } : {}),
});

/** Every seat after `mateId` joins or leaves `seatId`'s shared pairing. */
export const withPairingShareToggled = (seats, seatId, mateId) => {
  const list = Array.isArray(seats) ? seats : [];
  const seat = list.find((s) => s?.id === seatId);
  const pairing = seat?.pairing;
  if (!seat || !pairing || pairing === "—") return list;
  return regroup(list, seatId, mateId, pairingMates, pairingWriter(pairing));
};

/**
 * Every seat after `transform` changes this seat's pairing. Chairs sharing
 * the pairing follow it; clearing the pairing dissolves the share.
 */
export const withSharedPairing = (seats, seatId, transform) => {
  const list = Array.isArray(seats) ? seats : [];
  const seat = list.find((s) => s?.id === seatId);
  if (!seat) return list;
  const next = transform(seat);
  const mates = pairingMates(seat).filter((id) => list.some((s) => s?.id === id));
  const hasPairing = !!(next.pairing && next.pairing !== "—");
  if (!mates.length) return list.map((s) => (s?.id === seatId ? next : s));
  if (!hasPairing) {
    const group = [seatId, ...mates];
    return list.map((s) => {
      if (s?.id === seatId) return { ...next, pairingSharedWith: null };
      if (group.includes(s?.id)) return { ...s, pairingSharedWith: null };
      return s;
    });
  }
  return list.map((s) => {
    if (s?.id === seatId) return next;
    if (mates.includes(s?.id)) return { ...s, pairing: next.pairing, pourMode: null };
    return s;
  });
};

// ── Linked pairing ──────────────────────────────────────────────────────────
// off → on → wine → n/a → off, skipping whichever of the two the menu does not
// pour. "on" is the dish with no drink beside it.

/** The states a linked dish's button scrolls through, in order. */
export const extraPairingStates = (linked) => {
  const states = ["off", "on"];
  if (linked?.hasAlco) states.push("alco");
  if (linked?.hasNonAlco) states.push("nonalc");
  return states;
};

/** Where a linked dish's button is now: "off", "on", "alco" or "nonalc". */
export const extraPairingState = (seat, dish, linked) => {
  if (!extraOf(seat, dish).ordered) return "off";
  const raw = seat?.optionalPairings?.[linked?.key];
  const ordered = raw?.ordered !== undefined ? !!raw.ordered : false;
  if (!ordered) return "on";
  if (raw.mode === "alco") return "alco";
  if (raw.mode === "nonalc") return "nonalc";
  return "on";
};

/** What each state reads under the dish name. */
export const EXTRA_PAIRING_LABEL = { off: "off", on: "on", alco: "wine", nonalc: "n/a" };

/** Every seat after one tap of this seat's linked-pairing button. */
export const withExtraPairingCycled = (seats, seatId, dish, linked) => {
  const list = Array.isArray(seats) ? seats : [];
  if (!dish?.key || !linked?.key) return list;
  const states = extraPairingStates(linked);
  const seat = list.find((s) => s?.id === seatId);
  // Cycling back to off takes the chair out of its share, as the plain
  // on/off toggle does — the rest of the group keeps splitting.
  const goingOff = seat
    && states[(states.indexOf(extraPairingState(seat, dish, linked)) + 1) % states.length] === "off";
  const base = goingOff ? withExtraShareLeft(list, seatId, dish) : list;
  return base.map((seat) => {
    if (seat?.id !== seatId) return seat;
    const xtra = extraOf(seat, dish);
    const cur = extraPairingState(seat, dish, linked);
    const next = states[(states.indexOf(cur) + 1) % states.length];
    const raw = seat.optionalPairings?.[linked.key];
    return {
      ...seat,
      extras: {
        ...seat.extras,
        [dish.key]: { ...xtra, ordered: next !== "off", pairing: dish.pairings?.[0] || "—" },
      },
      optionalPairings: {
        ...(seat.optionalPairings || {}),
        [linked.key]: {
          ...(raw || {}),
          ordered: next === "alco" || next === "nonalc",
          ...(next === "alco" ? { mode: "alco" } : next === "nonalc" ? { mode: "nonalc" } : { mode: null }),
        },
      },
    };
  });
};
