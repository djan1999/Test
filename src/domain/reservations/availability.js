import { durationForParty, normalizeReservationConfig } from "./config.js";

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
    };
    return publicOnly && !resolved.onlineEnabled ? [] : [resolved];
  }).sort((a, b) => minutesOf(a.first) - minutesOf(b.first));
}

function intervalsOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

export function suggestTable({ date, time, pax, bookings, config }) {
  const normalized = normalizeReservationConfig(config);
  const start = minutesOf(time);
  const end = start + durationForParty(pax, normalized) + normalized.durations.buffer;
  const occupied = bookings.filter((booking) => (
    booking.date === date
    && ACTIVE_STATUSES.has(booking.status)
    && booking.tableLabel
    && intervalsOverlap(
      start,
      end,
      minutesOf(booking.time),
      minutesOf(booking.time) + durationForParty(booking.pax, normalized) + normalized.durations.buffer,
    )
  ));
  return [...normalized.tables]
    .filter((table) => Number(table.seats) >= Number(pax))
    .sort((a, b) => Number(a.seats) - Number(b.seats))
    .find((table) => !occupied.some((booking) => booking.tableLabel === table.id))?.id || null;
}

export function evaluateAvailability({
  date,
  pax,
  services,
  exceptions = [],
  bookings = [],
  config,
  publicOnly = false,
}) {
  const normalized = normalizeReservationConfig(config);
  const dayServices = resolveServicesForDate(date, services, exceptions, { publicOnly });
  const active = bookings.filter((booking) => (
    booking.date === date && ACTIVE_STATUSES.has(booking.status)
  ));
  const capacityOverride = exceptions.find((rule) => rule.date === date && rule.kind === "capacity_override");
  const serviceCap = Number(capacityOverride?.capacity || normalized.pacing.coversPerService);

  return dayServices.map((service) => {
    const serviceBookings = active.filter((booking) => booking.service === service.service);
    const serviceCovers = serviceBookings.reduce((total, booking) => total + Number(booking.pax || 0), 0);
    return {
      ...service,
      slots: generateSlots(service.first, service.last, service.interval).map((time) => {
        const slotCovers = serviceBookings
          .filter((booking) => booking.time === time)
          .reduce((total, booking) => total + Number(booking.pax || 0), 0);
        const tableLabel = suggestTable({ date, time, pax, bookings: active, config: normalized });
        const ok = serviceCovers + Number(pax) <= serviceCap
          && slotCovers + Number(pax) <= Number(normalized.pacing.coversPerSlot)
          && Boolean(tableLabel);
        return { time, ok, tableLabel: ok ? tableLabel : null };
      }),
    };
  });
}
