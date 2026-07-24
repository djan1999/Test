export const RESTAURANT_TIMEZONE = "Europe/Ljubljana";

export const DEFAULT_RESERVATION_CONFIG = {
  restaurantName: "Milka",
  tagline: "A table at Milka",
  timezone: RESTAURANT_TIMEZONE,
  online: {
    enabled: true,
    maxPax: 6,
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
  publicPage: {
    phone: "+386 40 000 000",
    languages: ["en", "sl"],
    policies: "Please tell us about allergies and accessibility needs before your visit.",
  },
  waitlist: {
    enabled: true,
    defaultQuoteMinutes: 30,
    autoSuggest: true,
  },
  privacy: {
    retentionMonths: 24,
  },
};

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

export function normalizeReservationConfig(value) {
  const input = value && typeof value === "object" ? value : {};
  return {
    ...DEFAULT_RESERVATION_CONFIG,
    ...input,
    online: { ...DEFAULT_RESERVATION_CONFIG.online, ...(input.online || {}) },
    pacing: { ...DEFAULT_RESERVATION_CONFIG.pacing, ...(input.pacing || {}) },
    durations: { ...DEFAULT_RESERVATION_CONFIG.durations, ...(input.durations || {}) },
    publicPage: { ...DEFAULT_RESERVATION_CONFIG.publicPage, ...(input.publicPage || {}) },
    waitlist: { ...DEFAULT_RESERVATION_CONFIG.waitlist, ...(input.waitlist || {}) },
    privacy: { ...DEFAULT_RESERVATION_CONFIG.privacy, ...(input.privacy || {}) },
    tables: Array.isArray(input.tables) && input.tables.length
      ? input.tables
      : DEFAULT_RESERVATION_CONFIG.tables,
  };
}

export function durationForParty(pax, config) {
  const durations = normalizeReservationConfig(config).durations;
  if (pax <= 2) return durations.small;
  if (pax <= 5) return durations.medium;
  return durations.large;
}
