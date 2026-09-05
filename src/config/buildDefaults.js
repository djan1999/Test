// BUILD-TIME RESTAURANT DEFAULTS — the deployment's opening guesses about a
// restaurant, parsed once from `import.meta.env` (Vite inlines these at build
// time, so they are constants for the life of the bundle).
//
// These are only ever a STARTING POINT. Once a workspace is signed in, its
// `restaurant_config_v1` row owns the restaurant name, table set and hotel
// features, and its saved settings own the quick-access list — the values here
// are what a device shows before that data has loaded, and what a brand-new
// deployment falls back to. Nothing here is per-workspace state; nothing here
// reads or writes storage.
//
// Extracted verbatim from App.jsx so the parsing is unit-testable on its own:
// every `parse*` helper takes the raw environment string as an argument and
// the module-scope constants below apply it to the real environment. Device
// ACCESS credentials (the PIN/password constants) deliberately stay in App.jsx
// — they are a different concern from restaurant configuration.

import { makeDefaultRestaurantConfig } from "./restaurantConfig.js";
import { PRODUCT_NAME as APP_NAME, PRODUCT_SUBTITLE as APP_SUBTITLE } from "./product.js";

/** `VITE_DEFAULT_ROOM_OPTIONS` — "01,11,12" → ["01","11","12"]. */
export const parseRoomOptions = (raw) => String(raw || "")
  .split(",")
  .map((room) => room.trim())
  .filter(Boolean);

/** `VITE_ENABLE_HOTEL_GUESTS` — only the literal string "true" enables it. */
export const parseHotelGuestsFlag = (raw) => String(raw || "").toLowerCase() === "true";

/**
 * `VITE_DEFAULT_SITTING_TIMES` — "18:00,18:30" → ["18:00","18:30"].
 * An unset OR entirely blank value falls back to the four standard sittings:
 * a board with no sitting rows at all shows nothing, so an empty list is
 * never an acceptable outcome here.
 */
export const parseSittingTimes = (raw) => {
  const times = String(raw || "18:00,18:30,19:00,19:15")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  return times.length > 0 ? times : ["18:00", "18:30", "19:00", "19:15"];
};

/**
 * `VITE_DEFAULT_QUICK_ACCESS` — a JSON array of quick-access buttons. Every
 * failure mode (unset, malformed JSON, not an array, entries without a label)
 * degrades to an empty list rather than throwing: a bad deployment variable
 * must never stop the board from opening.
 */
export const parseQuickAccessItems = (raw) => {
  const text = String(raw || "").trim();
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item, idx) => ({
        id: Number(item?.id) || idx + 1,
        label: String(item?.label || "").trim(),
        searchKey: String(item?.searchKey || item?.label || "").trim(),
        linkedKey: item?.linkedKey != null && String(item.linkedKey).trim() !== "" ? String(item.linkedKey).trim() : undefined,
        type: String(item?.type || "wine").trim() || "wine",
        enabled: item?.enabled !== false,
      }))
      .filter(item => item.label);
  } catch {
    return [];
  }
};

// ── this deployment's values ────────────────────────────────────────────────

export const BUILD_ROOM_OPTIONS = parseRoomOptions(import.meta.env.VITE_DEFAULT_ROOM_OPTIONS);

export const DEFAULT_SITTING_TIMES = parseSittingTimes(import.meta.env.VITE_DEFAULT_SITTING_TIMES);

export const DEFAULT_QUICK_ACCESS_ITEMS = parseQuickAccessItems(import.meta.env.VITE_DEFAULT_QUICK_ACCESS);

export const DEFAULT_RESTAURANT_CONFIG = makeDefaultRestaurantConfig({
  name: APP_NAME,
  subtitle: APP_SUBTITLE,
  features: {
    hotelGuests: parseHotelGuestsFlag(import.meta.env.VITE_ENABLE_HOTEL_GUESTS),
    roomOptions: BUILD_ROOM_OPTIONS,
  },
});
