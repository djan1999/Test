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
// Active: green border. Inactive: gray border. Fill always white.
export const panelBtn = (active = false) => ({
  fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1, padding: "6px 14px",
  border: `1px solid ${active ? tokens.green.border : tokens.neutral[300]}`,
  borderRadius: tokens.radius, cursor: "pointer",
  background: tokens.surface.card,
  color: active ? tokens.green.text : tokens.text.muted,
});

// Primary action (SAVE, SYNC, SUBMIT). White fill, dark border.
export const primaryBtn = {
  fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "8px 20px",
  border: `1px solid ${tokens.charcoal.default}`, borderRadius: tokens.radius, cursor: "pointer",
  background: tokens.surface.card, color: tokens.text.primary,
};

// Save/confirm button with status states — border carries the signal.
export const saveBtn = (status = "idle") => {
  const base = {
    fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1,
    padding: "6px 14px", borderRadius: tokens.radius,
    cursor: status === "saving" ? "not-allowed" : "pointer",
    background: tokens.surface.card,
    transition: "border-color 0.15s, color 0.15s",
  };
  if (status === "saved")  return { ...base, border: `1px solid ${tokens.green.border}`,   color: tokens.green.text };
  if (status === "error")  return { ...base, border: `1px solid ${tokens.red.border}`,     color: tokens.red.text };
  if (status === "saving") return { ...base, border: `1px solid ${tokens.neutral[300]}`,   color: tokens.text.muted };
  return { ...base, border: `1px solid ${tokens.charcoal.default}`, color: tokens.text.primary };
};

// Destructive action (REMOVE, DELETE, END SERVICE). Red border.
export const dangerBtn = {
  fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1, padding: "6px 14px",
  border: `1px solid ${tokens.red.border}`, borderRadius: tokens.radius, cursor: "pointer",
  background: tokens.surface.card, color: tokens.red.text,
};

// Toggle ON/OFF. Border = on/off state.
export const toggleBtn = (on = false) => ({
  fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1,
  padding: "4px 10px", borderRadius: tokens.radius, cursor: "pointer",
  border: `1px solid ${on ? tokens.green.border : tokens.neutral[300]}`,
  background: tokens.surface.card,
  color: on ? tokens.green.text : tokens.text.muted,
});
