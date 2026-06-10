import { extraPairingForSeat } from "../constants/pairings.js";

// ── Kitchen "send" deltas ─────────────────────────────────────────────────────
// Service pings the kitchen as a table's order firms up (pairings, optional
// extras like beetroot/cheese). Re-sending the whole order each time buries the
// new bit and confuses the line, so each Send carries only what changed since
// the kitchen last acknowledged — and when nothing changed, there's nothing to
// send.
//
// A snapshot is the diff-friendly shape of a table's current orders:
//   { [seatId]: { gender, pairing, pairingSharedWith, extras: [{key,name,pairing,sharedWith}] } }
// The kitchen stores the snapshot it acknowledged (table.kitchenSent); the next
// Send diffs the live snapshot against it.

export function kitchenSnapshot(seats = [], optionalExtras = [], optionalPairings = []) {
  const out = {};
  (seats || []).forEach((s) => {
    const extras = (optionalExtras || [])
      .filter((d) => !!(s.extras?.[d.key] || s.extras?.[d.id])?.ordered)
      .map((d) => {
        const ex = s.extras?.[d.key] || s.extras?.[d.id];
        return {
          key: d.key,
          name: d.name,
          pairing: extraPairingForSeat(s, d, optionalPairings),
          sharedWith: ex?.sharedWith ?? null,
        };
      });
    out[s.id] = {
      gender: s.gender || null,
      pairing: s.pairing && s.pairing !== "—" ? s.pairing : null,
      pairingSharedWith: s.pairingSharedWith ?? null,
      extras,
    };
  });
  return out;
}

// Overlay-format seats containing ONLY what changed since `baseline`: a seat
// appears only if its pairing changed or it gained/changed an extra; its
// `pairing` is omitted (null) unless it changed, and `extras` is limited to the
// new/changed ones. Empty array ⇒ nothing new to tell the kitchen.
export function kitchenDelta(current = {}, baseline = {}) {
  const seats = [];
  Object.keys(current).forEach((id) => {
    const cur = current[id] || {};
    const base = baseline[id] || {};
    const baseExtras = Array.isArray(base.extras) ? base.extras : [];
    const newExtras = (cur.extras || []).filter((e) => {
      const prev = baseExtras.find((p) => p.key === e.key);
      if (!prev) return true; // newly ordered
      return (prev.pairing ?? null) !== (e.pairing ?? null)
        || (prev.sharedWith ?? null) !== (e.sharedWith ?? null);
    });
    const pairingChanged = (cur.pairing ?? null) !== (base.pairing ?? null)
      || (cur.pairingSharedWith ?? null) !== (base.pairingSharedWith ?? null);
    if (newExtras.length === 0 && !pairingChanged) return;
    seats.push({
      id: Number(id),
      gender: cur.gender ?? null,
      pairing: pairingChanged ? cur.pairing : null,
      pairingSharedWith: pairingChanged ? cur.pairingSharedWith : null,
      extras: newExtras,
    });
  });
  return seats;
}

// True when there is at least one new/changed item to send to the kitchen.
export function hasKitchenUpdate(current = {}, baseline = {}) {
  return kitchenDelta(current, baseline).length > 0;
}
