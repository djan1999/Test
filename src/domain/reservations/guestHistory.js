// Loop 2 — Service → guest history. After service, from the archive, never live.
//
// When a service is ended the archive already holds what each party was
// actually served: the table, the menu, the covers, what the kitchen fired,
// the restrictions as they stood at the pass. Folding that back into the guest
// record is what turns a reservation system into a memory — "they sat at T05,
// took the long menu, one of them is coeliac".
//
// It is deliberately NOT a live subscription. A listener on the service board
// would put reservation writes inside the service transaction, which is
// exactly the coupling the boundary exists to prevent. This module is pure:
// give it an archive and the day's bookings, get visits back. The caller
// writes them, after the service is closed, and may run it again — a
// re-archived service must produce the same rows, not a second helping.
//
// Nothing here reads or writes service_tables, service_settings, the floor map
// or the service clock. The archive is a finished document.

const NAME_PUNCTUATION = /[^\p{L}\p{N}]+/gu;

/** Normalized join key for a party. The archive carries no reservation id — a
 *  board table only ever knew the guest's name and time — so the name and the
 *  seating time are what tie an archived table back to its booking. */
export function visitKey(name, time) {
  const cleanName = String(name || "").trim().toLowerCase().replace(NAME_PUNCTUATION, " ").trim();
  const cleanTime = String(time || "").trim().slice(0, 5);
  return cleanName || cleanTime ? `${cleanName}|${cleanTime}` : null;
}

/** Guest identity in reservation_guests: name plus the best contact we hold. */
export function guestKeyOf(booking) {
  const contact = booking?.email || booking?.phone || booking?.name;
  return `${String(booking?.name || "").trim().toLowerCase()}|${String(contact || "").trim().toLowerCase()}`;
}

function coursesFired(kitchenLog) {
  if (!kitchenLog || typeof kitchenLog !== "object") return [];
  return Object.entries(kitchenLog)
    .filter(([, value]) => value && (value.firedAt || value.at || value === true))
    .map(([key, value]) => ({
      course: key,
      at: (value && (value.firedAt || value.at)) || null,
    }))
    .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")));
}

function restrictionKeys(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(
    list
      .map((item) => (item && typeof item === "object" ? (item.key || item.note) : item))
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  )];
}

/** Every table of the group, so a joined party is one visit and not two. */
function tablesOfArchivedTable(table) {
  const group = Array.isArray(table?.tableGroup) ? table.tableGroup.filter(Boolean) : [];
  const ids = group.length ? group : (table?.id != null ? [table.id] : []);
  return [...new Set(ids.map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
}

/**
 * Visits an archived service produced, one per party that actually sat.
 *
 * A table is only a visit if somebody was there: `arrivedAt` or `active`. A
 * table that was templated from a reservation and never used produces nothing
 * — a no-show must not read as a visit in the guest's history.
 *
 * @param {object} archive  `{ id, date, label, state: { tables, serviceSession, startedAt } }`
 * @param {Array}  bookings the reservation store's bookings (any range)
 * @returns {Array} visit rows, each keyed by (bookingId | table, serviceInstanceId)
 */
export function visitsFromArchive(archive, bookings = []) {
  const state = archive?.state || {};
  const date = archive?.date || state.date || null;
  const service = state.serviceSession || null;
  // The service instance, not the archive row: re-archiving the same service
  // yields the same id, which is what makes the fold idempotent.
  const serviceInstanceId = String(archive?.id || state.startedAt || `${date}|${service}`);

  const candidates = (Array.isArray(bookings) ? bookings : [])
    .filter((booking) => !date || booking.date === date)
    .filter((booking) => !service || !booking.service || booking.service === service);
  const byKey = new Map();
  candidates.forEach((booking) => {
    const key = visitKey(booking.name, booking.time);
    if (key && !byKey.has(key)) byKey.set(key, booking);
  });

  const seen = new Set();
  return (Array.isArray(state.tables) ? state.tables : [])
    .filter((table) => table && (table.arrivedAt || table.active))
    .flatMap((table) => {
      const tables = tablesOfArchivedTable(table);
      const key = visitKey(table.resName, table.resTime);
      const booking = key ? byKey.get(key) || null : null;
      // A joined party is archived as several rows sharing one name and time.
      // The first carries the visit; the rest are the same people.
      const dedupe = booking ? `booking:${booking.id}` : `table:${key || tables[0]}`;
      if (seen.has(dedupe)) return [];
      seen.add(dedupe);

      return [{
        serviceInstanceId,
        bookingId: booking?.id || null,
        guestKey: booking ? guestKeyOf(booking) : null,
        name: booking?.name || table.resName || "",
        date,
        service,
        time: table.resTime || booking?.time || "",
        tables,
        covers: Number(table._groupGuests || table.guests || booking?.pax || 0),
        menuType: table.menuType || "",
        experience: booking?.experience || "",
        occasion: booking?.occasion || (table.birthday ? "Birthday" : ""),
        restrictions: restrictionKeys(table.restrictions),
        courses: coursesFired(table.kitchenLog),
        arrivedAt: table.arrivedAt || null,
        // A visit is identified by the party AND the service instance, so a
        // re-archive replaces its own row instead of adding another.
        visitId: `${serviceInstanceId}|${dedupe}`,
      }];
    });
}

/**
 * Fold visits into guest records. Idempotent per (guest, visitId): running it
 * twice over the same archive leaves the rows exactly as the first run did.
 *
 * @param {Array} guests  reservation_guests rows, each `{ name_key | nameKey, visits: [] }`
 * @param {Array} visits  from visitsFromArchive
 * @returns {{ guests: Array, updated: number, skipped: number }}
 */
export function foldVisitsIntoGuests(guests, visits) {
  const rows = (Array.isArray(guests) ? guests : []).map((guest) => ({ ...guest }));
  const byKey = new Map(rows.map((guest) => [String(guest.name_key ?? guest.nameKey ?? ""), guest]));

  let updated = 0;
  let skipped = 0;

  (Array.isArray(visits) ? visits : []).forEach((visit) => {
    // A visit we could not tie to a guest is not invented as a new one: the
    // party may have walked in, and a guest record made from a board label
    // would be a person who never gave us their name.
    const guest = visit.guestKey ? byKey.get(String(visit.guestKey)) : null;
    if (!guest) {
      skipped += 1;
      return;
    }
    const existing = Array.isArray(guest.visits) ? guest.visits : [];
    const at = existing.findIndex((row) => row.visitId === visit.visitId);
    if (at >= 0) {
      // Same service, re-archived. Replace in place — the later document wins,
      // the count does not move.
      const next = [...existing];
      next[at] = visit;
      guest.visits = next;
      updated += 1;
      return;
    }
    guest.visits = [...existing, visit].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    guest.visit_count = guest.visits.length;
    guest.last_visit = guest.visits[guest.visits.length - 1]?.date || guest.last_visit || null;
    updated += 1;
  });

  return { guests: rows, updated, skipped };
}
