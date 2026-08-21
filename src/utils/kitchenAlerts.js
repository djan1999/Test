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
      // `pairing: null` alone is ambiguous — unchanged, or cancelled back to
      // '—'. The alert merge below must know which, or a cancellation would
      // resurrect the pending alert's stale pairing in the kitchen popup.
      pairingChanged,
      extras: newExtras,
    });
  });
  return seats;
}

// True when there is at least one new/changed item to send to the kitchen.
export function hasKitchenUpdate(current = {}, baseline = {}) {
  return kitchenDelta(current, baseline).length > 0;
}

// ── Alert slot merge ──────────────────────────────────────────────────────────
// kitchenAlert is ONE slot per table, but two surfaces write it: SET (a course
// announcement, seats:[]) and Send (an order delta, no course). Writing one
// over a pending unconfirmed other swallowed the first popup — and a swallowed
// order delta is gone for good, because Send advances the kitchenSent baseline
// immediately, so the lost items never re-send. Every alert write goes through
// this merge: the popup then shows the set course AND the pending order items
// together (the overlay already renders both sections of one alert).
// Scope: this protects the slot on the WRITING device. Two devices writing the
// same table's slot concurrently still race through the table fold's atomic
// kitchenAlert field (foldTable choose()) exactly as before this merge.

// Legacy alert seats predate the extras array and carry {beet,cheese} keys the
// popup only reads when extras is NOT an array — translate them, or a merge
// would stamp `extras: []` on them and hide the items from the popup.
function normalizeAlertSeat(s) {
  if (Array.isArray(s.extras)) return { ...s, extras: [...s.extras] };
  const extras = [];
  if (s.beet) extras.push({ key: "beetroot", name: "Beetroot", pairing: s.beet.pairing ?? null, sharedWith: null });
  if (s.cheese) extras.push({ key: "cheese", name: "Cheese", pairing: null, sharedWith: null });
  const { beet, cheese, ...rest } = s;
  return { ...rest, extras };
}

function mergeAlertSeats(pending = [], next = []) {
  const byId = new Map();
  (pending || []).forEach((s) => byId.set(Number(s.id), normalizeAlertSeat(s)));
  (next || []).forEach((raw) => {
    const s = normalizeAlertSeat(raw);
    const prev = byId.get(Number(s.id));
    if (!prev) { byId.set(Number(s.id), s); return; }
    const extras = [...(prev.extras || [])];
    (s.extras || []).forEach((ex) => {
      const i = extras.findIndex((p) => p.key === ex.key);
      if (i >= 0) extras[i] = ex; else extras.push(ex);
    });
    // pairingChanged distinguishes "cancelled back to —" (null + true) from
    // "unchanged" (null + false); alerts written before the flag existed fall
    // back to treating a concrete value as a change
    const pairingKnown = s.pairingChanged ?? (s.pairing != null || s.pairingSharedWith != null);
    byId.set(Number(s.id), {
      ...prev,
      gender: s.gender ?? prev.gender ?? null,
      pairing: pairingKnown ? (s.pairing ?? null) : (prev.pairing ?? null),
      pairingSharedWith: pairingKnown ? (s.pairingSharedWith ?? null) : (prev.pairingSharedWith ?? null),
      pairingChanged: pairingKnown || !!prev.pairingChanged,
      extras,
    });
  });
  return [...byId.values()];
}

export function mergeKitchenAlert(pending, next) {
  if (!pending || pending.confirmed) return next;
  const merged = {
    ...next,
    course: next.course ?? pending.course ?? null,
    seats: mergeAlertSeats(pending.seats, next.seats),
    confirmed: false,
  };
  // the freshest baseline snapshot wins; a SET alert carries none, so a
  // pending Send's snapshot must survive for the kitchen's CONFIRM ack
  const snapshot = next.snapshot ?? pending.snapshot;
  if (snapshot) merged.snapshot = snapshot;
  return merged;
}
