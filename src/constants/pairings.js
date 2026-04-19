import { tokens } from "../styles/tokens.js";

export const WATER_OPTS = ["—", "XC", "XW", "OC", "OW"];

export const waterStyle = (v) => {
  if (v === "XC" || v === "XW") return { color: tokens.text.primary, bg: tokens.neutral[100] };
  if (v === "OC" || v === "OW") return { color: tokens.text.primary, bg: tokens.neutral[200] };
  return { color: tokens.text.secondary, bg: "transparent" };
};

export const PAIRINGS = ["—", "Wine", "Non-Alc", "Premium", "Our Story"];

export const pairingStyle = {
  "—":         { color: tokens.text.secondary, border: tokens.neutral[300], bg: tokens.neutral[100] },
  "Non-Alc":   { color: tokens.text.body,      border: tokens.neutral[200], bg: tokens.neutral[50] },
  Wine:        { color: tokens.text.body,      border: tokens.neutral[200], bg: tokens.neutral[50] },
  Premium:     { color: tokens.text.body,      border: tokens.neutral[200], bg: tokens.neutral[50] },
  "Our Story": { color: tokens.text.body,      border: tokens.neutral[200], bg: tokens.neutral[50] },
};
