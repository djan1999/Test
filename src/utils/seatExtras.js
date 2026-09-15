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
// off → on → ½P{each other chair} → off. The share partner is a seat id, so
// the cycle is as long as the table and every chair is reachable by tapping.

/** The states this seat's button scrolls through, in order. */
export const extraShareStates = (seatId, seats = []) =>
  ["off", "on", ...(Array.isArray(seats) ? seats : [])
    .filter((x) => x?.id !== seatId)
    .map((x) => x.id)];

/** Where the button is now: "off", "on", or the seat id it is shared with. */
export const extraShareState = (seat, dish) => {
  const ex = extraOf(seat, dish);
  if (!ex.ordered) return "off";
  const shared = ex.sharedWith ?? null;
  return shared !== null ? shared : "on";
};

/** The state one tap moves to, wrapping back to "off" past the last chair. */
export const nextExtraShareState = (seat, seats, dish) => {
  const states = extraShareStates(seat?.id, seats);
  const i = states.indexOf(extraShareState(seat, dish));
  return states[(i < 0 ? 0 : i + 1) % states.length];
};

/** What the button reads: "off", "on", or "½P2". */
export const extraShareLabel = (state) =>
  typeof state === "number" ? `½P${state}` : String(state);

/**
 * Every seat after one tap of this seat's share button.
 *
 * Only `extras.sharedWith` is touched. A previous version also cleared the
 * partner's `optionalPairings`, which silently wiped a pairing they had chosen
 * for themselves — the "beetroot pairing disappears when I touch share" bug.
 * The menu generator already reads the seat's own `sharedWith` flag.
 */
export const withExtraShareCycled = (seats, seatId, dish) => {
  const list = Array.isArray(seats) ? seats : [];
  const seat = list.find((s) => s?.id === seatId);
  if (!seat || !dish?.key) return list;
  const extra = extraOf(seat, dish);
  const prevShared = extra.sharedWith ?? null;
  const next = nextExtraShareState(seat, list, dish);
  const ordered = next !== "off";
  const sharedWith = typeof next === "number" ? next : null;
  return list.map((s) => {
    if (s?.id === seatId) {
      return { ...s, extras: { ...s.extras, [dish.key]: { ...extra, ordered, sharedWith } } };
    }
    // The chair this share used to name is released — it was only ordered
    // because somebody else was splitting with it.
    if (prevShared !== null && s?.id === prevShared && prevShared !== sharedWith) {
      const old = s.extras?.[dish.key] || {};
      return { ...s, extras: { ...s.extras, [dish.key]: { ...old, ordered: false, sharedWith: null } } };
    }
    // The chair it now names gets the other half.
    if (sharedWith !== null && s?.id === sharedWith) {
      const theirs = s.extras?.[dish.key] || { ordered: false, pairing: extra.pairing };
      return { ...s, extras: { ...s.extras, [dish.key]: { ...theirs, ordered: true, sharedWith: seatId } } };
    }
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
  return list.map((seat) => {
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
