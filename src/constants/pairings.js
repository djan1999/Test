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
  if (!v || v === "—") return "N/A";
  return v;
};

// Resolves the pairing label for an optional-extra dish on a given seat.
// When the dish has a linked optional pairing course (e.g. cheese pairing),
// the seat's optionalPairings drives the label (alco → wine name, nonalc →
// non-alc name). Otherwise we fall back to the seat's direct extras.pairing.
export const extraPairingForSeat = (seat, dish, optionalPairings = []) => {
  const linked = (optionalPairings || []).find(
    (op) => op?.extraKey && (op.extraKey === dish?.key || op.extraKey === dish?.id)
  );
  if (linked) {
    const lp = seat?.optionalPairings?.[linked.key];
    const ordered = lp?.ordered ?? linked.defaultOn !== false;
    if (!ordered) return "N/A";
    if (lp?.mode === "alco")   return linked.alcoName    || "Wine";
    if (lp?.mode === "nonalc") return linked.nonAlcoName || "N/A";
    const sp = String(seat?.pairing || "").trim();
    if (sp && sp !== "—") return sp === "Non-Alc" ? "N/A" : sp;
    return "Wine";
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
