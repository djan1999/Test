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
// Active: faint green tint + green border. Inactive: white + gray border.
export const panelBtn = (active = false) => ({
  fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1, padding: "6px 14px",
  border: `1px solid ${active ? tokens.green.border : tokens.neutral[300]}`,
  borderRadius: tokens.radius, cursor: "pointer",
  background: active ? tokens.green.bg : tokens.surface.card,
  color: active ? tokens.green.text : tokens.text.muted,
});

// Primary action (SAVE, SYNC, SUBMIT). White fill, dark border, bold text.
export const primaryBtn = {
  fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "8px 20px",
  border: `1px solid ${tokens.charcoal.default}`, borderRadius: tokens.radius, cursor: "pointer",
  background: tokens.surface.card, color: tokens.text.primary, fontWeight: 600,
};

// Save/confirm button with status states — tint fill + border together signal state.
export const saveBtn = (status = "idle") => {
  const base = {
    fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1,
    padding: "6px 14px", borderRadius: tokens.radius,
    cursor: status === "saving" ? "not-allowed" : "pointer",
    transition: "background 0.15s, border-color 0.15s, color 0.15s",
  };
  if (status === "saved")  return { ...base, background: tokens.green.bg,    border: `1px solid ${tokens.green.border}`,   color: tokens.green.text };
  if (status === "error")  return { ...base, background: tokens.red.bg,      border: `1px solid ${tokens.red.border}`,     color: tokens.red.text };
  if (status === "saving") return { ...base, background: tokens.surface.card, border: `1px solid ${tokens.neutral[300]}`,  color: tokens.text.muted };
  return { ...base, background: tokens.surface.card, border: `1px solid ${tokens.charcoal.default}`, color: tokens.text.primary };
};

// Destructive action (REMOVE, DELETE, END SERVICE).
export const dangerBtn = {
  fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1, padding: "6px 14px",
  border: `1px solid ${tokens.red.border}`, borderRadius: tokens.radius, cursor: "pointer",
  background: tokens.red.bg, color: tokens.red.text,
};

// Toggle ON/OFF. ON: green tint. OFF: white + gray border.
export const toggleBtn = (on = false) => ({
  fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1,
  padding: "4px 10px", borderRadius: tokens.radius, cursor: "pointer",
  border: `1px solid ${on ? tokens.green.border : tokens.neutral[300]}`,
  background: on ? tokens.green.bg : tokens.surface.card,
  color: on ? tokens.green.text : tokens.text.muted,
});
