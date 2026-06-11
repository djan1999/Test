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
