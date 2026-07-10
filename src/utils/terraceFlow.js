// Terrace flow: the party/visit state machine, pure. State lives INSIDE
// `reservations.data` (jsonb rides opaquely through the PowerSync seams, so
// these fields are offline-queue-safe with zero schema change). A reservation
// carrying none of these keys is a legacy row and behaves exactly as today.
//
//   booked ──assignTerrace──────────────▶ terrace
//   booked ──(existing seat flow)───────▶ dining        (terrace skipped)
//   terrace ─kitchen fires LAST BITE────▶ terrace+ARMED (badge only, derived)
//   ARMED  ──MOVE TO {dining_table}─────▶ arriving      (or dining, single-tap)
//   arriving ─MARK SEATED───────────────▶ dining
//   dining ──(existing clear flow)──────▶ done
//
// ARMED is not a visit_state — it is derived (last_bite_fired_at set while
// still on terrace), so nothing here auto-moves a party. All writers must
// persist the returned data via App's persistReservationRow seam.

export const VISIT_STATES = ["booked", "terrace", "arriving", "dining", "done"];

export const visitStateOf = (data) => {
  const s = data?.visit_state;
  if (!VISIT_STATES.includes(s)) return "booked";
  // Self-heal the dead-end state: 'terrace' with NO table and NO fired last
  // bite is a party the flow has nothing left to offer — not on any terrace
  // tile, no MOVE (that needs ARMED), and 'terrace' locks it out of every
  // (re)assign gate and keeps its ghost ticket on the kitchen board. Reading
  // it as 'booked' returns the party to the normal pool everywhere at once,
  // including rows already stuck in the store from before this fix. An ARMED
  // party without a table stays 'terrace' on purpose — the stranded banner's
  // MOVE is its designed path in.
  if (s === "terrace" && !data?.terrace_table && !data?.last_bite_fired_at) return "booked";
  return s;
};

// LAST BITE ✓ badge. Kept true after a manual terrace-table clear (the clear
// nulls terrace_table but leaves visit_state) so MOVE stays reachable from
// the reservation row — the "table cleared meanwhile" edge case.
export const isArmed = (data) =>
  visitStateOf(data) === "terrace" && !!data?.last_bite_fired_at;

// FOH assigns a terrace table (mini-map picker). Valid from 'booked'
// (arrival snacks), from 'terrace' as a re-assign, and from 'dining' —
// dessert/digestif back outside, and the recovery path for a party whose
// visit was completed by hand. Mid-transition ('arriving') and 'done' → null.
export function assignTerrace(data, label, mapId) {
  const s = visitStateOf(data);
  if (s !== "booked" && s !== "terrace" && s !== "dining") return null;
  if (!label) return null;
  return {
    ...(data || {}),
    visit_state: "terrace",
    terrace_table: label,
    terrace_map_id: mapId || null,
  };
}

// FOH clears the terrace table without moving the party (spilled drink, table
// broken down early). An ARMED party keeps visit_state 'terrace' so its MOVE
// stays reachable (the stranded banner). An UN-armed party — nothing fired
// yet — returns to 'booked': keeping it 'terrace' locked it out of every
// seat/assign surface with no way back (the stuck "ON TERRACE" party).
export function clearTerraceTable(data) {
  if (visitStateOf(data) !== "terrace") return null;
  const next = { ...(data || {}), terrace_table: null };
  if (!next.last_bite_fired_at) next.visit_state = "booked";
  return next;
}

// The ONLY kitchen hook: called when a course is marked out on the ticket.
// Arms only a terrace party, only once — extra courses ordered after the last
// bite never re-arm, and a party with no terrace leg is a no-op.
export function shouldArmOnFire(course, data) {
  return !!course?.is_last_bite &&
    visitStateOf(data) === "terrace" &&
    !data?.last_bite_fired_at;
}

export function fireLastBite(data, nowIso) {
  if (visitStateOf(data) !== "terrace" || data?.last_bite_fired_at) return null;
  return { ...(data || {}), last_bite_fired_at: nowIso };
}

// MOVE TO {dining_table}. Never blocked or warned by the dining table's
// status (SET means set — no readiness handshake). With MOVE_SINGLE_TAP the
// arriving confirm is skipped. terrace_table is kept as history; terrace
// occupancy derives from visit_state === 'terrace', so the table frees (and
// can be re-assigned) the moment this returns.
export function moveToDining(data, nowIso, { singleTap = false } = {}) {
  if (visitStateOf(data) !== "terrace") return null;
  return {
    ...(data || {}),
    visit_state: singleTap ? "dining" : "arriving",
    moved_at: nowIso,
  };
}

// FOH taps SEATED on the dining table after the kitchen visit.
export function markSeated(data) {
  if (visitStateOf(data) !== "arriving") return null;
  return { ...(data || {}), visit_state: "dining" };
}

// The existing clear-table flow closes the visit. Only meaningful for rows
// that ever entered the flow — legacy rows stay untouched (undefined keys).
export function closeVisit(data) {
  if (!data?.visit_state) return null;
  return { ...data, visit_state: "done" };
}
