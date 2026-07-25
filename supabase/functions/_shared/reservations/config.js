// GENERATED FILE — DO NOT EDIT.
// Copied verbatim from src/domain/reservations by scripts/syncEdgeDomain.mjs.
// Edit the source and re-run `npm run sync:edge-domain`.

// Reservation configuration — ONE model shared by every surface: the staff
// workspace (Day Book / Calendar / Guests / Waitlist / Planning & Print), the
// Reservations Admin panel, the public /book page and the availability engine.
//
// ADDITIVE ONLY. Every key added since the first version has a default here, so
// a reservation_config row written by an older build keeps loading unchanged.
// Nothing in this file reads or writes live-Service state (service_tables,
// service_settings, floor maps, courses, the service clock) — see
// HANDOFF.md §Service Boundary Contract.

export const RESTAURANT_TIMEZONE = "Europe/Ljubljana";

export const DEFAULT_RESERVATION_CONFIG = {
  restaurantName: "Milka",
  tagline: "A table at Milka",
  timezone: RESTAURANT_TIMEZONE,
  online: {
    enabled: true,
    maxPax: 6,
    minPax: 1,
    leadMinutes: 30,
    windowDays: 90,
    autoConfirmMaxPax: 4,
    whenFull: "waitlist",
  },
  pacing: {
    coversPerSlot: 12,
    coversPerService: 44,
  },
  durations: {
    small: 120,
    medium: 150,
    large: 180,
    buffer: 15,
  },
  tables: [
    { id: "T01", seats: 2 },
    { id: "T02", seats: 2 },
    { id: "T03", seats: 2 },
    { id: "T04", seats: 4 },
    { id: "T05", seats: 4 },
    { id: "T06", seats: 4 },
    { id: "T07", seats: 6 },
    { id: "T08", seats: 8 },
  ],
  // Tables that may be pushed together for a larger party. The suggestion
  // engine tries single tables first, then these pairs, in listed order.
  combos: [["T01", "T02"], ["T02", "T03"], ["T07", "T08"]],
  // Walk-ins are a staff action only; the public page never offers them.
  walkIns: {
    enabled: true,
    holdMinutes: 15,
  },
  experiences: [
    {
      key: "grand_tasting",
      title: "Grand tasting",
      description: "The full seasonal tasting menu. Allow around three hours.",
      services: ["lunch", "dinner"],
      active: true,
      deposit: "none",
    },
    {
      key: "seasonal",
      title: "Seasonal menu",
      description: "A shorter expression of the season. Allow around two hours.",
      services: ["lunch", "dinner"],
      active: true,
      deposit: "none",
    },
  ],
  publicPage: {
    phone: "+386 40 000 000",
    languages: ["en", "sl"],
    requireEmail: true,
    requirePhone: true,
    policies: "Please tell us about allergies and accessibility needs before your visit.",
  },
  // Drafts only until a sending provider is connected. {name} {date} {time}
  // {pax} {ref} are filled in per booking.
  messages: {
    confirm: {
      en: "Dear {name}, your table for {pax} on {date} at {time} is confirmed. Reference {ref}. We look forward to welcoming you. — Restaurant Milka",
      sl: "Spoštovani {name}, vaša miza za {pax} dne {date} ob {time} je potrjena. Referenca {ref}. Veselimo se vašega obiska. — Restavracija Milka",
    },
    reminder: {
      en: "A reminder of your table for {pax} tomorrow at {time}. Tell us if your plans change. — Restaurant Milka",
      sl: "Opomnik: vaša miza za {pax} jutri ob {time}. Sporočite nam, če se načrti spremenijo. — Restavracija Milka",
    },
    modified: {
      en: "Your reservation {ref} now stands for {date} at {time}. — Restaurant Milka",
      sl: "Vaša rezervacija {ref} je spremenjena na {date} ob {time}. — Restavracija Milka",
    },
    cancelled: {
      en: "Your reservation {ref} has been cancelled. We hope to welcome you another time. — Restaurant Milka",
      sl: "Vaša rezervacija {ref} je preklicana. Upamo, da vas pozdravimo kdaj drugič. — Restavracija Milka",
    },
    waitlist: {
      en: "Good news — a table for {pax} has opened at {time}. Call us within 15 minutes to take it. — Restaurant Milka",
      sl: "Dobra novica — miza za {pax} je prosta ob {time}. Pokličite nas v 15 minutah. — Restavracija Milka",
    },
  },
  waitlist: {
    enabled: true,
    defaultQuoteMinutes: 30,
    autoSuggest: true,
  },
  privacy: {
    retentionMonths: 24,
  },
  // Reservation roles. Authorization itself stays the Admin shell's — these
  // rows only say what a signed-in person may do inside Reservations.
  team: [],
};

export const RESERVATION_ROLES = ["admin", "manager", "host", "readonly"];

export const DEFAULT_WEEKLY_SERVICES = [
  { service: "dinner", weekday: 2, enabled: true, first: "18:00", last: "19:30", interval: 30, onlineEnabled: true },
  { service: "dinner", weekday: 3, enabled: true, first: "18:00", last: "19:30", interval: 30, onlineEnabled: true },
  { service: "dinner", weekday: 4, enabled: true, first: "18:00", last: "19:30", interval: 30, onlineEnabled: true },
  { service: "dinner", weekday: 5, enabled: true, first: "18:00", last: "20:00", interval: 30, onlineEnabled: true },
  { service: "dinner", weekday: 6, enabled: true, first: "18:00", last: "20:00", interval: 30, onlineEnabled: true },
  { service: "dinner", weekday: 0, enabled: true, first: "18:00", last: "19:30", interval: 30, onlineEnabled: true },
  { service: "lunch", weekday: 2, enabled: true, first: "12:00", last: "13:30", interval: 30, onlineEnabled: true },
  { service: "lunch", weekday: 3, enabled: true, first: "12:00", last: "13:30", interval: 30, onlineEnabled: true },
  { service: "lunch", weekday: 4, enabled: true, first: "12:00", last: "13:30", interval: 30, onlineEnabled: true },
  { service: "lunch", weekday: 5, enabled: true, first: "12:00", last: "13:30", interval: 30, onlineEnabled: true },
];

const mergeSection = (defaults, input) => ({ ...defaults, ...(input && typeof input === "object" ? input : {}) });

export function normalizeReservationConfig(value) {
  const input = value && typeof value === "object" ? value : {};
  const base = DEFAULT_RESERVATION_CONFIG;
  return {
    ...base,
    ...input,
    online: mergeSection(base.online, input.online),
    pacing: mergeSection(base.pacing, input.pacing),
    durations: mergeSection(base.durations, input.durations),
    publicPage: mergeSection(base.publicPage, input.publicPage),
    waitlist: mergeSection(base.waitlist, input.waitlist),
    privacy: mergeSection(base.privacy, input.privacy),
    walkIns: mergeSection(base.walkIns, input.walkIns),
    // A saved empty list is a real choice (no joinable tables, no experiences
    // offered) for arrays the restaurant curates; only a MISSING key falls back.
    tables: Array.isArray(input.tables) ? input.tables : base.tables,
    combos: Array.isArray(input.combos) ? input.combos : base.combos,
    experiences: Array.isArray(input.experiences) ? input.experiences : base.experiences,
    team: Array.isArray(input.team) ? input.team : base.team,
    messages: normalizeMessages(input.messages),
  };
}

function normalizeMessages(input) {
  const out = {};
  Object.keys(DEFAULT_RESERVATION_CONFIG.messages).forEach((kind) => {
    out[kind] = mergeSection(DEFAULT_RESERVATION_CONFIG.messages[kind], (input || {})[kind]);
  });
  // Keep any extra template the restaurant added beyond the built-in five.
  Object.keys(input || {}).forEach((kind) => { if (!out[kind]) out[kind] = { ...(input[kind] || {}) }; });
  return out;
}

export function normalizeWeeklyServices(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return DEFAULT_WEEKLY_SERVICES.map((row) => ({ ...row }));
  return rows.map((row) => ({
    service: String(row.service || "dinner"),
    weekday: Number(row.weekday),
    enabled: row.enabled !== false,
    first: String(row.first || (row.service === "lunch" ? "12:00" : "18:00")),
    last: String(row.last || (row.service === "lunch" ? "13:30" : "19:30")),
    interval: Number(row.interval || 30),
    onlineEnabled: row.onlineEnabled !== false,
    // Per-service party limits. Absent → fall back to the global online limits
    // at call time, never at read time, so a later config change is picked up.
    minPax: row.minPax != null ? Number(row.minPax) : null,
    maxPax: row.maxPax != null ? Number(row.maxPax) : null,
    walkInsEnabled: row.walkInsEnabled !== false,
  }));
}

export function durationForParty(pax, config) {
  const durations = normalizeReservationConfig(config).durations;
  if (pax <= 2) return durations.small;
  if (pax <= 5) return durations.medium;
  return durations.large;
}

/** Party-size limits for one resolved service — per-service values win, the
 *  global online limits are the fallback. Used by /book and the staff form. */
export function partyLimitsFor(service, config) {
  const normalized = normalizeReservationConfig(config);
  return {
    minPax: service?.minPax != null ? service.minPax : normalized.online.minPax,
    maxPax: service?.maxPax != null ? service.maxPax : normalized.online.maxPax,
  };
}

/** Experiences offered for a given service, in listed order. */
export function experiencesFor(serviceName, config) {
  return normalizeReservationConfig(config).experiences
    .filter((experience) => experience.active !== false)
    .filter((experience) => !experience.services || experience.services.includes(serviceName));
}

/** Guest-safe subset — everything /book may know, and nothing more. No table
 *  inventory, no pacing numbers, no team, no internal keys. */
export function publicConfigOf(config) {
  const normalized = normalizeReservationConfig(config);
  return {
    restaurantName: normalized.restaurantName,
    tagline: normalized.tagline,
    timezone: normalized.timezone,
    phone: normalized.publicPage.phone,
    languages: normalized.publicPage.languages,
    requireEmail: normalized.publicPage.requireEmail !== false,
    requirePhone: normalized.publicPage.requirePhone !== false,
    policies: normalized.publicPage.policies,
    onlineEnabled: normalized.online.enabled !== false,
    maxPax: normalized.online.maxPax,
    minPax: normalized.online.minPax,
    leadMinutes: normalized.online.leadMinutes,
    windowDays: normalized.online.windowDays,
    autoConfirmMaxPax: normalized.online.autoConfirmMaxPax,
    whenFull: normalized.online.whenFull,
    waitlistEnabled: normalized.waitlist.enabled !== false,
    experiences: normalized.experiences
      .filter((experience) => experience.active !== false)
      .map(({ key, title, description, services }) => ({ key, title, description, services })),
  };
}

/** Render a guest message template. Unknown placeholders are left intact so a
 *  typo is visible in a preview rather than silently dropped. */
export function renderMessage(template, values) {
  return String(template || "").replace(/\{(\w+)\}/g, (match, key) => (
    values && values[key] != null ? String(values[key]) : match
  ));
}
