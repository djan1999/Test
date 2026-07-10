// Terrace flow: the party/visit state machine, pure. State lives INSIDE
// `reservations.data` (jsonb rides opaquely through the PowerSync seams, so
// these fields are offline-queue-safe with zero schema change). A reservation
// carrying none of these keys is a legacy row and behaves exactly as today.
//
//   booked ──assignTerrace──────────────▶ terrace
//   booked ──(existing seat flow)───────▶ dining        (terrace skipped)
//   terrace ──MOVE TO {dining_table}────▶ arriving      (or dining, single-tap)
//   arriving ─MARK SEATED───────────────▶ dining
//   dining ──(existing clear flow)──────▶ done
//
// The LAST BITE arming concept (kitchen fire → ARMED badge → move cue) was
// removed 10.07 per Djan — too much signal for the efficiency it bought — and
// returned the same day in a harder form: a course flagged is_last_bite now
// AUTO-RUNS the move when the kitchen fires it (App's fire-to-clear effect →
// moveTerracePartyIn), freeing the terrace table immediately. Manual MOVE
// stays available from the occupied tile's sheet / stranded banner. Old rows
// may still carry a last_bite_fired_at stamp; it is ignored everywhere and
// drops naturally on the next reservation edit. All writers must persist the
// returned data via App's persistReservationRow seam.

export const VISIT_STATES = ["booked", "terrace", "arriving", "dining", "done"];

/** The reservation-data keys that carry the visit through the flow. Any code
 *  that REBUILDS a reservation's data blob (the edit form) must carry these,
 *  or a routine mid-service edit teleports a live terrace party back to
 *  'booked' (ghost tile). */
export const FLOW_KEYS = ["visit_state", "terrace_table", "terrace_map_id", "moved_at"];

/** Pick only the flow keys PRESENT on a data blob — legacy rows (none of the
 *  keys) come back as {} so rebuilt blobs stay byte-identical for them. */
export const pickFlowKeys = (data) =>
  Object.fromEntries(FLOW_KEYS.filter((k) => (data || {})[k] !== undefined).map((k) => [k, data[k]]));

export const visitStateOf = (data) => {
  const s = data?.visit_state;
  if (!VISIT_STATES.includes(s)) return "booked";
  // Self-heal the dead-end state: 'terrace' with NO table is a party the map
  // can't show — no tile, no sheet — and 'terrace' locks it out of every
  // (re)assign gate and keeps its ghost ticket on the kitchen board. Reading
  // it as 'booked' returns the party to the normal pool everywhere at once,
  // including rows already stuck in the store from before this fix.
  if (s === "terrace" && !data?.terrace_table) return "booked";
  return s;
};

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
// broken down early). The party leaves 'terrace' — keeping it locked the
// party out of every seat/assign surface with no way back (the stuck
// "ON TERRACE" party, 10.07). The heal target depends on where the guests
// actually are: `seatedInside` (the caller checks the board) means a
// dessert-outside party still eating at its ACTIVE dining table → 'dining',
// so they don't reappear in the ASSIGN PARTY picker as a waiting party (the
// double-seat hazard). Otherwise → 'booked'.
export function clearTerraceTable(data, { seatedInside = false } = {}) {
  if (visitStateOf(data) !== "terrace") return null;
  return {
    ...(data || {}),
    terrace_table: null,
    visit_state: seatedInside ? "dining" : "booked",
  };
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
