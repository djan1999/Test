// Shared styles and constants for admin panel components
import { tokens } from "../../styles/tokens.js";
import { baseInput, fieldLabel as fieldLabelMixin } from "../../styles/mixins.js";

export const FONT = tokens.font;
export const MOBILE_SAFE_INPUT_SIZE = tokens.mobileInputSize;

export const baseInp = { ...baseInput };
export const fieldLabel = { ...fieldLabelMixin };

export const sectionHeader = {
  fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 2,
  color: tokens.text.muted, textTransform: "uppercase", marginBottom: 14,
};

// Tab button (admin nav).
// Active: charcoal fill + white text. Inactive: white fill + muted text.
export const panelBtn = (active = false) => ({
  fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1, padding: "6px 14px",
  border: `1px solid ${active ? tokens.charcoal.default : tokens.neutral[200]}`,
  borderRadius: tokens.radius, cursor: "pointer",
  background: active ? tokens.charcoal.default : tokens.surface.card,
  color: active ? tokens.text.inverse : tokens.text.muted,
});

// Primary action (SAVE, SYNC, SUBMIT). Charcoal fill.
export const primaryBtn = {
  fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "8px 20px",
  border: `1px solid ${tokens.charcoal.default}`, borderRadius: tokens.radius, cursor: "pointer",
  background: tokens.charcoal.default, color: tokens.text.inverse,
};

// Save/confirm button with status states:
//   idle    → charcoal primary
//   saving  → disabled, muted
//   saved   → green (positive signal)
//   error   → red (destructive signal)
export const saveBtn = (status = "idle") => {
  const base = {
    fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1,
    padding: "6px 14px", borderRadius: tokens.radius,
    cursor: status === "saving" ? "not-allowed" : "pointer",
    color: tokens.text.inverse, transition: "background 0.15s, border-color 0.15s",
  };
  if (status === "saved") return { ...base, background: tokens.green.border, border: `1px solid ${tokens.green.border}` };
  if (status === "error") return { ...base, background: tokens.red.border, border: `1px solid ${tokens.red.border}` };
  if (status === "saving") return { ...base, background: tokens.neutral[400], border: `1px solid ${tokens.neutral[400]}` };
  return { ...base, background: tokens.charcoal.default, border: `1px solid ${tokens.charcoal.default}` };
};

// Destructive action (REMOVE, DELETE, END SERVICE).
// White fill + red border + red text.
export const dangerBtn = {
  fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1, padding: "6px 14px",
  border: `1px solid ${tokens.red.border}`, borderRadius: tokens.radius, cursor: "pointer",
  background: tokens.surface.card, color: tokens.red.text,
};

// Toggle ON/OFF.
// ON  → green border + green.bg fill + green.text.
// OFF → neutral border + white fill + muted text.
export const toggleBtn = (on = false) => ({
  fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1,
  padding: "4px 10px", borderRadius: tokens.radius, cursor: "pointer",
  border: `1px solid ${on ? tokens.green.border : tokens.neutral[300]}`,
  background: on ? tokens.green.bg : tokens.surface.card,
  color: on ? tokens.green.text : tokens.text.muted,
});
