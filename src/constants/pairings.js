import { tokens } from "../styles/tokens.js";

export const WATER_OPTS = ["—", "XC", "XW", "OC", "OW"];

export const waterStyle = (v) => {
  if (v === "XC" || v === "XW") return { color: tokens.text.primary, bg: tokens.neutral[100] };
  if (v === "OC" || v === "OW") return { color: tokens.text.primary, bg: tokens.neutral[200] };
  return { color: tokens.text.secondary, bg: "transparent" };
};

export const PAIRINGS = ["—", "Wine", "Non-Alc", "Premium", "Our Story"];

export const extraPairingLabel = (p) => {
  const v = String(p || "").trim();
  if (!v || v === "—") return "";
  return v;
};

// Resolves the pairing label for an optional-extra dish on a given seat.
// Returns the label (e.g. "Wine") or "" when the seat ordered the dish
// without a paired drink. Linked optional pairings (cheese, beetroot, …)
// drive the label via seat.optionalPairings[linkedKey].mode; otherwise we
// fall back to seat.extras[key].pairing.
export const extraPairingForSeat = (seat, dish, optionalPairings = []) => {
  const linked = (optionalPairings || []).find(
    (op) => op?.extraKey && (op.extraKey === dish?.key || op.extraKey === dish?.id)
  );
  if (linked) {
    const lp = seat?.optionalPairings?.[linked.key];
    if (lp?.mode === "alco")   return "Wine";
    if (lp?.mode === "nonalc") return "N/A";
    return "";
  }
  const ex = seat?.extras?.[dish?.key] || seat?.extras?.[dish?.id];
  return extraPairingLabel(ex?.pairing);
};

export const pairingStyle = {
  "—":         { color: tokens.text.secondary, border: tokens.neutral[300], bg: tokens.neutral[100] },
  "Non-Alc":   { color: tokens.text.body,      border: tokens.neutral[200], bg: tokens.neutral[50] },
  Wine:        { color: tokens.text.body,      border: tokens.neutral[200], bg: tokens.neutral[50] },
  Premium:     { color: tokens.text.body,      border: tokens.neutral[200], bg: tokens.neutral[50] },
  "Our Story": { color: tokens.text.body,      border: tokens.neutral[200], bg: tokens.neutral[50] },
};
