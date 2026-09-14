/**
 * pourMode.js — BTG / BTB, the drink story for a guest who is NOT on a pairing.
 *
 * Until now a seat with no pairing reached the kitchen as silence, and the
 * pass had no way of knowing whether that chair was drinking by the glass,
 * from a bottle the table opened, or not at all. `seat.pourMode` says which:
 *
 *   "btg" — by the glass     "btb" — by the bottle     null — neither
 *
 * It is EXCLUSIVE with `seat.pairing` by construction. A paired guest's wine
 * comes from the pairing, so "Wine · BTG" is not extra detail, it is two
 * contradictory instructions for one chair. The writers below clear one when
 * they set the other, and `seatPourMode` re-applies the rule on the read side
 * so rows written before it existed (or merged from an older tablet) can
 * never print both.
 *
 * Pure and dependency-free — imported by the seat factory, the kitchen
 * snapshot and the service UI alike.
 */

export const POUR_MODES = ["btg", "btb"];

export const POUR_MODE_LABEL = { btg: "BTG", btb: "BTB" };

export const POUR_MODE_TITLE = { btg: "By the glass", btb: "By the bottle" };

/**
 * Anything that isn't one of the two known modes is no mode at all.
 *
 * "btv" was the by-the-bottle spelling during development, before the floor
 * corrected it to BTB. It is accepted and translated rather than dropped, so a
 * seat set on a preview build keeps its choice instead of silently reading as
 * "no drink" — the exact silence this field exists to end.
 */
export const normalizePourMode = (value) => {
  const v = String(value || "").trim().toLowerCase();
  if (v === "btv") return "btb";
  return v === "btg" || v === "btb" ? v : null;
};

/** True when this seat carries a real pairing (anything but empty or "—"). */
export const seatHasPairing = (seat) => {
  const p = String(seat?.pairing || "").trim();
  return !!p && p !== "—";
};

/** The pour mode to SHOW for a seat — a pairing always wins. */
export const seatPourMode = (seat) =>
  seatHasPairing(seat) ? null : normalizePourMode(seat?.pourMode);

/** "BTG" / "BTB" for a chip or a ticket, or "" when the seat has neither. */
export const pourModeLabel = (seat) => POUR_MODE_LABEL[seatPourMode(seat)] || "";

/**
 * Tap BTG (or BTB) on a seat: turn it on, turn it off when it was already on,
 * and drop any pairing it replaces. Returns the seat unchanged when `mode` is
 * not a real pour mode, so a bad caller can never blank a pairing by accident.
 */
export const withPourMode = (seat, mode) => {
  const next = normalizePourMode(mode);
  if (!next) return seat;
  const current = normalizePourMode(seat?.pourMode);
  const chosen = current === next ? null : next;
  return { ...seat, pourMode: chosen, pairing: chosen ? "" : (seat?.pairing ?? "") };
};

/**
 * Set a seat's pairing: choosing a real one clears the pour mode, because a
 * paired guest is no longer drinking by the glass or the bottle. Choosing
 * "none" leaves the pour mode alone — clearing a pairing is not a statement
 * about how the guest drinks instead.
 */
export const withPairing = (seat, pairing) => {
  const value = pairing === "—" ? "" : String(pairing ?? "");
  const real = !!value.trim();
  return { ...seat, pairing: value, pourMode: real ? null : normalizePourMode(seat?.pourMode) };
};
