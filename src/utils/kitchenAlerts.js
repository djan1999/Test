import { extraPairingForSeat } from "../constants/pairings.js";
import { getCourseMod, applyModOverride } from "./menuUtils.js";
import { seatPourMode } from "./pourMode.js";
import { groupRestrictionsByGuest } from "./restrictionGroups.js";
import { restrLabel } from "../constants/dietary.js";

// ── Kitchen "send" deltas ─────────────────────────────────────────────────────
// Service pings the kitchen as a table's order firms up (pairings, optional
// extras like beetroot/cheese). Re-sending the whole order each time buries the
// new bit and confuses the line, so each Send carries only what changed since
// the kitchen last acknowledged — and when nothing changed, there's nothing to
// send.
//
// A snapshot is the diff-friendly shape of a table's current orders:
//   { [seatId]: { gender, pairing, pourMode, pairingSharedWith,
//                 extras: [{key,name,pairing,sharedWith}] } }
// Digestivos are deliberately NOT in here. They print on the ticket straight
// from the seat, as a service line above the course admin anchored them to —
// nobody has to start a plate for one, so interrupting the pass with a popup
// about a coffee is noise on a surface that only works when every popup
// matters. See digestivo.js.
// The kitchen stores the snapshot it acknowledged (table.kitchenSent); the next
// Send diffs the live snapshot against it.

export function kitchenSnapshot(seats = [], optionalExtras = [], optionalPairings = [], restrictions = [], kitchenCourseNotes = {}) {
  const out = {};
  const seatIds = new Set((seats || []).map(s => s.id));
  const unassigned = groupRestrictionsByGuest((restrictions || []).filter(r =>
    r?.note && (r.pos == null || !seatIds.has(r.pos))));
  (seats || []).forEach((s) => {
    // The dietaries pinned to THIS chair. An extra called for a restricted
    // guest must reach the kitchen carrying the dish's modification — the
    // beetroot for a nut allergy is a different plate, and the popup is the
    // moment the pass starts it, not the ticket they read later.
    const restrKeys = (restrictions || [])
      .filter((r) => r && r.note && r.pos === s.id)
      .map((r) => r.note);
    const extras = (optionalExtras || [])
      .filter((d) => !!(s.extras?.[d.key] || s.extras?.[d.id])?.ordered)
      .map((d) => {
        const ex = s.extras?.[d.key] || s.extras?.[d.id];
        // Same derivation the ticket row shows (getCourseMod), including the
        // per-table text override, so the popup and the ticket say the same
        // thing about the same plate.
        const mod = restrKeys.length && d.course ? getCourseMod(d.course, restrKeys) : null;
        return {
          key: d.key,
          name: d.name,
          pairing: extraPairingForSeat(s, d, optionalPairings),
          sharedWith: ex?.sharedWith ?? null,
          restriction: mod ? applyModOverride(mod, kitchenCourseNotes?.[d.course?.course_key]) : null,
          // Warn at dish level without claiming every ordering chair has the
          // allergy. Orphaned positions are also unresolved, as on the ticket.
          unassignedRestrictions: unassigned.map(group => {
            const pendingMod = d.course ? getCourseMod(d.course, group.notes) : null;
            const label = group.notes.map(restrLabel).join(", ");
            return pendingMod ? `${label}: ${applyModOverride(pendingMod, kitchenCourseNotes?.[d.course?.course_key])}` : label;
          }),
        };
      });
    out[s.id] = {
      gender: s.gender || null,
      pairing: s.pairing && s.pairing !== "—" ? s.pairing : null,
      // How an UNPAIRED guest is drinking. The kitchen had no way of hearing
      // "by the glass" or "by the bottle" before — a seat with no pairing
      // simply read as no drink at all.
      pourMode: seatPourMode(s),
      pairingSharedWith: s.pairingSharedWith ?? null,
      extras,
    };
  });
  return out;
}

// ── SET course restrictions ──────────────────────────────────────────────────
// A SET popup names the course the table is ready for. When a guest's dietary
// changes that plate, the popup must say so, per chair — the same way a called
// beetroot does ("P2 · POTATO CRACKLINGS") — because the popup is where the
// pass starts the course. Derived exactly as the ticket row derives it
// (getCourseMod + the per-table text override), and gated by the kitchen
// layout's showRestrictions switch like the ticket is.
//   → { restrictions: [{ pos, mod }], unassignedRestrictions: [string] }
export function setCourseRestrictions(visibleCourse, seats = [], restrictions = [], kitchenCourseNotes = {}) {
  const empty = { restrictions: [], unassignedRestrictions: [] };
  const raw = visibleCourse?.rawCourse;
  if (!raw) return empty;
  if (visibleCourse.kitchenItem && visibleCourse.kitchenItem.showRestrictions === false) return empty;
  const kcNote = kitchenCourseNotes?.[raw.course_key || visibleCourse.key];
  const seatIds = new Set((seats || []).map(s => s.id));
  const out = [];
  [...(seats || [])].sort((a, b) => Number(a.id) - Number(b.id)).forEach((s) => {
    const keys = (restrictions || []).filter(r => r && r.note && r.pos === s.id).map(r => r.note);
    const mod = keys.length ? getCourseMod(raw, keys) : null;
    if (mod) out.push({ pos: s.id, mod: applyModOverride(mod, kcNote) });
  });
  const unassigned = groupRestrictionsByGuest((restrictions || []).filter(r =>
    r?.note && (r.pos == null || !seatIds.has(r.pos))));
  const unassignedRestrictions = unassigned.map((group) => {
    const mod = getCourseMod(raw, group.notes);
    return mod ? `${group.notes.map(restrLabel).join(", ")}: ${applyModOverride(mod, kcNote)}` : null;
  }).filter(Boolean);
  return { restrictions: out, unassignedRestrictions };
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
        || (prev.sharedWith ?? null) !== (e.sharedWith ?? null)
        // An allergy recorded AFTER the dish was sent is exactly the update
        // the kitchen must hear about — the plate may already be on the line.
        || (prev.restriction ?? null) !== (e.restriction ?? null)
        || JSON.stringify(prev.unassignedRestrictions || []) !== JSON.stringify(e.unassignedRestrictions || []);
    });
    const pairingChanged = (cur.pairing ?? null) !== (base.pairing ?? null)
      || (cur.pairingSharedWith ?? null) !== (base.pairingSharedWith ?? null)
      // BTG/BTB rides with the pairing: it answers the same question about
      // the same chair, so the kitchen hears a switch between them as one
      // change and the popup prints whichever now holds.
      || (cur.pourMode ?? null) !== (base.pourMode ?? null);
    if (newExtras.length === 0 && !pairingChanged) return;
    seats.push({
      id: Number(id),
      gender: cur.gender ?? null,
      pairing: pairingChanged ? cur.pairing : null,
      pourMode: pairingChanged ? (cur.pourMode ?? null) : null,
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
      pourMode: pairingKnown ? (s.pourMode ?? null) : (prev.pourMode ?? null),
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
