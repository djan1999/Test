// ── Service-day clock ─────────────────────────────────────────
// A dinner service legitimately runs past midnight, so the service "day" must
// NOT roll over at 00:00 — it rolls over in the early morning once service is
// truly over (default 06:00, override with VITE_SERVICE_DAY_ROLLOVER_HOUR).
// Until that hour the active service day is still the previous calendar date,
// so a service that crossed midnight is preserved instead of being treated as
// stale and wiped (which previously destroyed the night's drinks/seat input).

const pad2 = (n) => String(n).padStart(2, "0");
const toLocalDateISO = (date = new Date()) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

export const SERVICE_DAY_ROLLOVER_HOUR = (() => {
  const raw = Number(import.meta.env.VITE_SERVICE_DAY_ROLLOVER_HOUR);
  return Number.isFinite(raw) && raw >= 0 && raw <= 23 ? raw : 6;
})();

export const currentServiceDay = (now = new Date()) =>
  toLocalDateISO(new Date(now.getTime() - SERVICE_DAY_ROLLOVER_HOUR * 3600 * 1000));

// ISO YYYY-MM-DD strings sort lexicographically by calendar date.
export const isStaleServiceDate = (date, today = currentServiceDay()) =>
  Boolean(date) && String(date) < today;

// A past service date is only auto-endable if it ROLLED OVER while running —
// i.e. it was current/future when chosen. A date deliberately chosen in the
// past (demo, reviewing or re-running an earlier day) must never be auto-ended
// out from under the user; it stays until ended manually.
export const SERVICE_DATE_CHOSEN_ON_KEY = "milka_service_date_chosen_on";
export const isDeliberatelyPastDate = (date, chosenOn) =>
  Boolean(date && chosenOn) && String(date) < String(chosenOn);

// A deliberately-past date is only an ACTIVE review while it is still the
// service day it was chosen on. Once the clock rolls past chosenOn the
// selection is abandoned: keeping it would silently file new services under a
// stale past date (the 10.06 incident — a stray "view an old day" pick on the
// 12th pinned every later service to the 10th). After the rollover it is
// treated like any other stale date (released / auto-ended), so the picker
// prompts for today instead.
export const isActivePastReview = (date, chosenOn, today = currentServiceDay()) =>
  isDeliberatelyPastDate(date, chosenOn) && String(chosenOn) >= String(today);

// Whether picking a service date should WIPE the local board. Only true when
// switching between two genuinely different known days — NOT when a device is
// joining the current service (prevDate null: a fresh login, a second device,
// a re-login). The old check (`next && next !== prev`) cleared on join because
// prev was null, blanking the shared live board and propagating it to every
// device — the "opened on the laptop and it wiped the tablet" bug.
export const shouldClearBoardOnDateChange = (prevDate, nextDate) =>
  Boolean(nextDate && prevDate && String(nextDate) !== String(prevDate));

// Decide what a device should do when entering Service, given the server's
// persisted service_date state ({ date, chosenOn }). If a live (non-stale, or
// still-active past-review) service exists → JOIN it silently, no prompt, no
// wipe. Otherwise → START: prompt for a new service date. This is what makes a
// second device / re-login "just see the live service" instead of being asked
// to start one (and clearing the board in the process).
export function resolveServiceEntry(state, today = currentServiceDay()) {
  const date = state?.date || null;
  const chosenOn = state?.chosenOn || null;
  if (date && (!isStaleServiceDate(date, today) || isActivePastReview(date, chosenOn, today))) {
    return { action: "join", date, chosenOn };
  }
  return { action: "start", date: null, chosenOn: null };
}
