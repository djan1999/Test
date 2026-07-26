// GENERATED FILE — DO NOT EDIT.
// Copied verbatim from src/domain/reservations by scripts/syncEdgeDomain.mjs.
// Edit the source and re-run `npm run sync:edge-domain`.

// Availability engine — the single authority for "can this party book this time".
//
// Used identically by the staff workspace, the Calendar, the public /book page
// and the server. Resolution order (fixed by spec):
//   1. date closure / private event
//   2. date-specific service override
//   3. normal weekday service schedule
//   4. experience restrictions
//   5. capacity, pacing and booking rules
//
// Reservation-owned only: nothing here reads service_tables, floor maps,
// courses or the live service clock (HANDOFF.md §Service Boundary Contract).

import {
  RESTAURANT_TIMEZONE,
  durationForParty,
  experiencesFor,
  normalizeReservationConfig,
  partyLimitsFor,
} from "./config.js";

const ACTIVE_STATUSES = new Set(["pending", "confirmed", "arrived"]);

export function dateWeekday(date) {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

export function minutesOf(time) {
  const [hours, minutes] = String(time || "00:00").split(":").map(Number);
  return (hours * 60) + minutes;
}

export function timeOf(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

export function generateSlots(first, last, interval = 30) {
  const slots = [];
  for (let at = minutesOf(first); at <= minutesOf(last); at += Number(interval || 30)) {
    slots.push(timeOf(at));
  }
  return slots;
}

export function resolveServicesForDate(date, services, exceptions = [], { publicOnly = false } = {}) {
  const weekday = dateWeekday(date);
  const dayRules = exceptions.filter((rule) => rule.date === date);
  if (dayRules.some((rule) => rule.kind === "closed" || rule.kind === "private_event")) return [];

  const serviceOverrides = new Map(
    dayRules
      .filter((rule) => rule.kind === "service_override" && rule.service)
      .map((rule) => [rule.service, rule]),
  );
  const serviceNames = new Set([
    ...services.map((item) => item.service),
    ...serviceOverrides.keys(),
  ]);

  return [...serviceNames].flatMap((serviceName) => {
    const weekly = services.find((item) => item.service === serviceName && Number(item.weekday) === weekday);
    const override = serviceOverrides.get(serviceName);
    if (override?.mode === "off") return [];
    if (!weekly?.enabled && override?.mode !== "on") return [];

    const resolved = {
      service: serviceName,
      first: override?.first || weekly?.first || (serviceName === "lunch" ? "12:00" : "18:00"),
      last: override?.last || weekly?.last || (serviceName === "lunch" ? "13:30" : "19:30"),
      interval: Number(override?.interval || weekly?.interval || 30),
      onlineEnabled: override?.onlineOff ? false : weekly?.onlineEnabled !== false,
      // Per-service party limits and walk-in permission travel with the
      // resolved service so callers never re-read the weekly rows.
      minPax: weekly?.minPax != null ? Number(weekly.minPax) : null,
      maxPax: weekly?.maxPax != null ? Number(weekly.maxPax) : null,
      walkInsEnabled: weekly?.walkInsEnabled !== false,
    };
    return publicOnly && !resolved.onlineEnabled ? [] : [resolved];
  }).sort((a, b) => minutesOf(a.first) - minutesOf(b.first));
}

function intervalsOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

/** Tables a booking occupies: a combined party holds every table in its group. */
function tablesOfBooking(booking) {
  if (Array.isArray(booking.tableGroup) && booking.tableGroup.length) return booking.tableGroup.map(String);
  return booking.tableLabel ? [String(booking.tableLabel)] : [];
}

function busyTablesAt({ date, time, pax, bookings, config, excludeId }) {
  const normalized = normalizeReservationConfig(config);
  const start = minutesOf(time);
  const end = start + durationForParty(pax, normalized) + normalized.durations.buffer;
  const busy = new Set();
  bookings.forEach((booking) => {
    if (booking.date !== date) return;
    if (excludeId && booking.id === excludeId) return;
    if (!ACTIVE_STATUSES.has(booking.status)) return;
    const bookingStart = minutesOf(booking.time);
    const bookingEnd = bookingStart + durationForParty(booking.pax, normalized) + normalized.durations.buffer;
    if (!intervalsOverlap(start, end, bookingStart, bookingEnd)) return;
    tablesOfBooking(booking).forEach((label) => busy.add(label));
  });
  return busy;
}

/**
 * Every configured table with its verdict for one party at one time, in the
 * order the host reads them off the floor.
 *
 * A "no" is never hidden. The host is standing in front of a guest, and
 * "T04 — Novak 19:00" is the sentence they can say out loud; a table that has
 * simply vanished from the grid tells them nothing and invites a second guess.
 * Reason wording here is for STAFF and may name the party holding the table —
 * the public page's rule about never naming another guest is enforced where
 * the public page is served, not here.
 *
 * @returns {Array<{ id: string, seats: number, ok: boolean, reason: string|null,
 *                   takenBy: { name: string, time: string } | null }>}
 */
export function tableAvailabilityAt({ date, time, pax, bookings = [], config, excludeId = null }) {
  const normalized = normalizeReservationConfig(config);
  const party = Number(pax) || 0;
  // No sitting time yet: seats are still knowable, occupancy is not.
  if (!time) {
    return normalized.tables.map((table) => ({
      id: String(table.id),
      seats: Number(table.seats) || 0,
      ok: false,
      reason: "pick_time",
      takenBy: null,
    }));
  }

  const busy = busyTablesAt({ date, time, pax: party, bookings, config: normalized, excludeId });
  const holder = new Map();
  const start = minutesOf(time);
  const end = start + durationForParty(party, normalized) + normalized.durations.buffer;
  bookings.forEach((booking) => {
    if (booking.date !== date) return;
    if (excludeId && booking.id === excludeId) return;
    if (!ACTIVE_STATUSES.has(booking.status)) return;
    const bookingStart = minutesOf(booking.time);
    const bookingEnd = bookingStart + durationForParty(booking.pax, normalized) + normalized.durations.buffer;
    if (!intervalsOverlap(start, end, bookingStart, bookingEnd)) return;
    tablesOfBooking(booking).forEach((label) => {
      if (!holder.has(label)) holder.set(label, { name: booking.name || "Reservation", time: booking.time || "" });
    });
  });

  return normalized.tables.map((table) => {
    const id = String(table.id);
    const seats = Number(table.seats) || 0;
    if (busy.has(id)) return { id, seats, ok: false, reason: "taken", takenBy: holder.get(id) || null };
    // Seats are advice, not a lock: a host may seat four at a six-top, and
    // combining is what covers a party larger than any single table.
    if (party && seats < party) return { id, seats, ok: false, reason: "too_small", takenBy: null };
    return { id, seats, ok: true, reason: null, takenBy: null };
  });
}

/**
 * Smallest table that seats the party; failing that, the first configured
 * joinable pair whose combined seats fit. Returns null when nothing fits.
 * @returns {{ tables: string[], combined: boolean } | null}
 */
export function suggestTables({ date, time, pax, bookings = [], config, excludeId = null }) {
  const normalized = normalizeReservationConfig(config);
  const busy = busyTablesAt({ date, time, pax, bookings, config: normalized, excludeId });
  const seatsOf = (label) => Number((normalized.tables.find((table) => table.id === label) || {}).seats || 0);

  const single = [...normalized.tables]
    .filter((table) => Number(table.seats) >= Number(pax) && !busy.has(String(table.id)))
    .sort((a, b) => Number(a.seats) - Number(b.seats) || String(a.id).localeCompare(String(b.id)))[0];
  if (single) return { tables: [String(single.id)], combined: false };

  const pair = (normalized.combos || [])
    .map((combo) => combo.map(String))
    .filter((combo) => combo.every((label) => seatsOf(label) > 0 && !busy.has(label)))
    .filter((combo) => combo.reduce((total, label) => total + seatsOf(label), 0) >= Number(pax))
    .sort((a, b) => (
      a.reduce((total, label) => total + seatsOf(label), 0) - b.reduce((total, label) => total + seatsOf(label), 0)
    ))[0];
  return pair ? { tables: pair, combined: true } : null;
}

/** Back-compatible single-label helper for existing call sites. */
export function suggestTable(args) {
  const suggestion = suggestTables(args);
  return suggestion ? suggestion.tables[0] : null;
}

/** Tables this party could be MOVED to, and the reservation each swap displaces.
 *  Powers "swap tables with another reservation" in the staff editor. */
export function swapCandidates({ date, time, pax, bookings = [], config, reservationId }) {
  const normalized = normalizeReservationConfig(config);
  const start = minutesOf(time);
  const end = start + durationForParty(pax, normalized) + normalized.durations.buffer;
  return normalized.tables
    .filter((table) => Number(table.seats) >= Number(pax))
    .map((table) => {
      const label = String(table.id);
      const occupant = bookings.find((booking) => (
        booking.date === date
        && booking.id !== reservationId
        && ACTIVE_STATUSES.has(booking.status)
        && tablesOfBooking(booking).includes(label)
        && intervalsOverlap(
          start, end,
          minutesOf(booking.time),
          minutesOf(booking.time) + durationForParty(booking.pax, normalized) + normalized.durations.buffer,
        )
      )) || null;
      // A swap is only offered when the other party also fits this party's table.
      return { table: label, seats: Number(table.seats), occupant, free: !occupant };
    });
}

export function evaluateAvailability({
  date,
  pax,
  services,
  exceptions = [],
  bookings = [],
  config,
  publicOnly = false,
  experience = null,
  nowMinutes = null,
  isToday = false,
}) {
  const normalized = normalizeReservationConfig(config);
  const dayServices = resolveServicesForDate(date, services, exceptions, { publicOnly });
  const active = bookings.filter((booking) => booking.date === date && ACTIVE_STATUSES.has(booking.status));
  const capacityOverride = exceptions.find((rule) => rule.date === date && rule.kind === "capacity_override");
  const dayCap = capacityOverride?.capacity != null ? Number(capacityOverride.capacity) : null;
  const dayCovers = active.reduce((total, booking) => total + Number(booking.pax || 0), 0);

  return dayServices.map((service) => {
    const limits = partyLimitsFor(service, normalized);
    const offered = experience
      ? experiencesFor(service.service, normalized).some((item) => item.key === experience)
      : true;
    const serviceBookings = active.filter((booking) => booking.service === service.service);
    const serviceCovers = serviceBookings.reduce((total, booking) => total + Number(booking.pax || 0), 0);
    const serviceCap = dayCap != null ? dayCap : Number(normalized.pacing.coversPerService);

    return {
      ...service,
      ...limits,
      offersExperience: offered,
      slots: generateSlots(service.first, service.last, service.interval).map((time) => {
        const slotCovers = serviceBookings
          .filter((booking) => booking.time === time)
          .reduce((total, booking) => total + Number(booking.pax || 0), 0);
        const suggestion = suggestTables({ date, time, pax, bookings: active, config: normalized });

        // Reasons are returned, never just a boolean: an unavailable time always
        // says why, in words a host can repeat to a guest on the phone.
        let reason = null;
        if (!offered) reason = "not_offered";
        else if (Number(pax) < limits.minPax) reason = "party_too_small";
        else if (Number(pax) > limits.maxPax) reason = "party_too_large";
        else if (isToday && nowMinutes != null && minutesOf(time) < nowMinutes + Number(normalized.online.leadMinutes)) reason = "too_late";
        else if (dayCap != null && dayCovers + Number(pax) > dayCap) reason = "day_full";
        else if (serviceCovers + Number(pax) > serviceCap) reason = "service_full";
        else if (slotCovers + Number(pax) > Number(normalized.pacing.coversPerSlot)) reason = "sitting_full";
        else if (!suggestion) reason = "no_table";

        return {
          time,
          ok: reason === null,
          reason,
          tables: reason === null ? suggestion.tables : [],
          tableLabel: reason === null ? suggestion.tables[0] : null,
          combined: reason === null ? suggestion.combined : false,
        };
      }),
    };
  });
}

/** The restaurant's own wall clock, not the server's and not the browser's.
 *  Returns the local date and minutes-since-midnight in the given timezone. */
export function restaurantClock(timezone = RESTAURANT_TIMEZONE, at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone || RESTAURANT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at).reduce((values, part) => ({ ...values, [part.type]: part.value }), {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: (Number(parts.hour) * 60) + Number(parts.minute),
  };
}

export function shiftISODate(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + Number(days));
  return value.toISOString().slice(0, 10);
}

/**
 * One request's worth of availability, with the policies that belong to the
 * request rather than to a slot: the online switch, the booking window, today's
 * lead time, and the booking a guest is allowed to ignore because it is theirs.
 *
 * Both servers call THIS — the Vercel route and the Supabase edge function —
 * so a rule can never be true on one and false on the other.
 *
 * @param {object}  input
 * @param {?{date: string, minutes: number}} input.now  restaurant clock; required for the public window and lead time
 * @param {?string} input.excludeBookingId  a booking the caller already holds (manage link), never counted against them
 */
export function availabilityForRequest({
  date,
  pax,
  services,
  exceptions = [],
  bookings = [],
  config,
  publicOnly = false,
  experience = null,
  now = null,
  excludeBookingId = null,
}) {
  const normalized = normalizeReservationConfig(config);
  // The booking window and the online switch are the server's to enforce, never
  // the browser's: a hand-made request for a past date, for one beyond
  // online.windowDays, or made while online booking is off, is offered nothing.
  const outsideWindow = Boolean(publicOnly) && Boolean(now) && (
    date < now.date || date > shiftISODate(now.date, normalized.online.windowDays)
  );
  const onlineClosed = Boolean(publicOnly) && normalized.online.enabled === false;
  const visible = excludeBookingId
    ? bookings.filter((booking) => String(booking.id) !== String(excludeBookingId))
    : bookings;

  return {
    config: normalized,
    outsideWindow,
    onlineClosed,
    services: (outsideWindow || onlineClosed) ? [] : evaluateAvailability({
      date,
      pax: Number(pax),
      services,
      exceptions,
      bookings: visible,
      config: normalized,
      publicOnly,
      experience,
      isToday: Boolean(publicOnly) && Boolean(now) && date === now.date,
      nowMinutes: publicOnly && now ? now.minutes : null,
    }),
  };
}

export const UNAVAILABLE_REASONS = {
  not_offered: "That menu is not served at this time.",
  party_too_small: "This service takes larger parties only.",
  party_too_large: "Larger parties are arranged personally — please call us.",
  too_late: "Too close to this seating to book online.",
  day_full: "Fully booked for the day.",
  service_full: "Fully booked for this service.",
  sitting_full: "That seating is full — try another time.",
  no_table: "No table of the right size is free then.",
};

/** True when a walk-in may be taken right now for this date + service. */
export function walkInsAllowed({ date, services, exceptions = [], config }) {
  const normalized = normalizeReservationConfig(config);
  if (normalized.walkIns?.enabled === false) return false;
  return resolveServicesForDate(date, services, exceptions).some((service) => service.walkInsEnabled !== false);
}
