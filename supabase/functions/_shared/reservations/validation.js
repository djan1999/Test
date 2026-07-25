// GENERATED FILE — DO NOT EDIT.
// Copied verbatim from src/domain/reservations by scripts/syncEdgeDomain.mjs.
// Edit the source and re-run `npm run sync:edge-domain`.

// What a booking payload must be, for both servers and for /book.
//
// Two things live here that used to live in neither place properly.
//
// First, ONE copy of the rules. The Vercel route and the Supabase edge function
// each carried their own `validateBooking`, and they had already drifted.
//
// Second, LIMITS. Every guest-supplied string reached the database unbounded:
// /book and the waitlist are unauthenticated, so anyone could store as much
// text as they liked, and a note of ten thousand characters would go on to
// wreck the printed breakdown and the kitchen ticket for a real service. The
// bounds below are generous for a person and useless for a robot.
//
// Rejecting, not truncating: silently cutting a guest's allergy note in half is
// worse than telling them it is too long.

export const LIMITS = {
  name: 120,
  phone: 40,
  email: 200,
  notes: 1000,
  occasion: 120,
  experience: 64,
  language: 8,
  ref: 64,
  idempotencyKey: 128,
  allergies: 40,
  allergyNote: 200,
  accessibility: 20,
  accessibilityNote: 120,
  waitlistWindow: 60,
  maxPax: 30,
};

// Deliberately loose: the point is to reject "not an address at all", not to
// adjudicate the RFC. A guest whose real address we refuse cannot book.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function fail(message, code) {
  const error = new Error(message);
  error.code = code || "invalid_booking";
  error.statusCode = 400;
  throw error;
}

function checkText(value, max, label) {
  const text = String(value ?? "");
  if (text.length > max) fail(`${label} is too long (maximum ${max} characters).`, "too_long");
  return text;
}

function checkList(list, maxItems, maxItemLength, label) {
  if (list == null) return;
  if (!Array.isArray(list)) fail(`${label} must be a list.`, "invalid_booking");
  if (list.length > maxItems) fail(`Too many ${label.toLowerCase()} (maximum ${maxItems}).`, "too_long");
  list.forEach((item) => {
    // An entry is either a bare string or { pos, note, key } — the restriction
    // shape the kitchen ticket reads. Only its text is bounded.
    const text = item && typeof item === "object"
      ? `${item.note ?? ""}${item.key ?? ""}`
      : String(item ?? "");
    checkText(text, maxItemLength, `An entry in ${label.toLowerCase()}`);
  });
}

/**
 * The shape and size a booking must have before any server touches the
 * database. Throws with guest-readable wording; `error.code` is "too_long" for
 * a length refusal so a caller can tell it apart from a genuine rejection.
 */
export function validateBookingPayload(payload) {
  const input = payload || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.date || ""))) fail("Choose a valid date.");
  if (!/^\d{2}:\d{2}$/.test(String(input.time || ""))) fail("Choose a valid time.");
  if (!/^[a-z][a-z0-9_-]{1,31}$/.test(String(input.service || ""))) fail("Choose a valid service.");
  if (!String(input.name || "").trim()) fail("Guest name is required.");
  if (!Number.isInteger(Number(input.pax)) || Number(input.pax) < 1 || Number(input.pax) > LIMITS.maxPax) {
    fail(`Party size must be between 1 and ${LIMITS.maxPax}.`);
  }

  checkText(input.name, LIMITS.name, "Guest name");
  checkText(input.phone, LIMITS.phone, "Telephone number");
  checkText(input.occasion, LIMITS.occasion, "Occasion");
  checkText(input.experience, LIMITS.experience, "Menu");
  checkText(input.notes, LIMITS.notes, "Note");
  checkText(input.language, LIMITS.language, "Language");
  checkText(input.ref, LIMITS.ref, "Reference");
  checkText(input.idempotencyKey, LIMITS.idempotencyKey, "Request key");

  const email = String(input.email || "").trim();
  if (email) {
    checkText(email, LIMITS.email, "Email address");
    if (!EMAIL.test(email)) fail("That email address does not look right.", "invalid_email");
  }

  checkList(input.allergies, LIMITS.allergies, LIMITS.allergyNote, "Dietary notes");
  checkList(input.accessibility, LIMITS.accessibility, LIMITS.accessibilityNote, "Access needs");
  return true;
}

/** The waitlist is the other unauthenticated write. Same bounds, fewer fields. */
export function validateWaitlistEntry(entry) {
  const input = entry || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.date || ""))) fail("Choose a valid date.");
  if (!String(input.name || "").trim()) fail("Your name is required.");
  if (!Number.isInteger(Number(input.pax)) || Number(input.pax) < 1 || Number(input.pax) > LIMITS.maxPax) {
    fail(`Party size must be between 1 and ${LIMITS.maxPax}.`);
  }
  if (input.time && !/^\d{2}:\d{2}$/.test(String(input.time))) fail("Choose a valid time.");
  if (input.service && !/^[a-z][a-z0-9_-]{1,31}$/.test(String(input.service))) fail("Choose a valid service.");

  checkText(input.name, LIMITS.name, "Your name");
  checkText(input.phone, LIMITS.phone, "Telephone number");
  checkText(input.notes, LIMITS.notes, "Note");
  checkText(input.window, LIMITS.waitlistWindow, "Time window");

  const email = String(input.email || "").trim();
  if (email) {
    checkText(email, LIMITS.email, "Email address");
    if (!EMAIL.test(email)) fail("That email address does not look right.", "invalid_email");
  }
  return true;
}
