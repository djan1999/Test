// Shared styles and constants for admin panel components
import { tokens } from "../../styles/tokens.js";
import { baseInput, fieldLabel as fieldLabelMixin } from "../../styles/mixins.js";

export const FONT = tokens.font;
export const MOBILE_SAFE_INPUT_SIZE = tokens.mobileInputSize;

export const baseInp = { ...baseInput };
export const fieldLabel = { ...fieldLabelMixin };

export const sectionHeader = {
  fontFamily: FONT, fontSize: 9, letterSpacing: 2,
  color: tokens.ink[3], textTransform: "uppercase", marginBottom: 14,
};

// Tab button (admin nav).
// Active: faint green tint + green border. Inactive: white + hairline.
export const panelBtn = (active = false) => ({
  fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px",
  border: `1px solid ${active ? tokens.green.border : tokens.ink[4]}`,
  borderRadius: 0, cursor: "pointer",
  background: active ? tokens.green.bg : tokens.neutral[0],
  color: active ? tokens.green.text : tokens.ink[3],
});

// Primary action (SAVE, SYNC, SUBMIT). White fill, dark border, bold text.
export const primaryBtn = {
  fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "8px 20px",
  border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0, cursor: "pointer",
  background: tokens.neutral[0], color: tokens.ink[0], fontWeight: 600,
};

// Save/confirm button with status states — tint fill + border together signal state.
export const saveBtn = (status = "idle") => {
  const base = {
    fontFamily: FONT, fontSize: 9, letterSpacing: 1,
    padding: "6px 14px", borderRadius: 0,
    cursor: status === "saving" ? "not-allowed" : "pointer",
    transition: "background 0.15s, border-color 0.15s, color 0.15s",
  };
  if (status === "saved")  return { ...base, background: tokens.green.bg,   border: `1px solid ${tokens.green.border}`,        color: tokens.green.text };
  if (status === "error")  return { ...base, background: tokens.red.bg,     border: `1px solid ${tokens.red.border}`,          color: tokens.red.text };
  if (status === "saving") return { ...base, background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}`,              color: tokens.ink[3] };
  return                          { ...base, background: tokens.neutral[0], border: `1px solid ${tokens.charcoal.default}`,    color: tokens.ink[0] };
};

// Destructive action (REMOVE, DELETE, END SERVICE).
export const dangerBtn = {
  fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px",
  border: `1px solid ${tokens.red.border}`, borderRadius: 0, cursor: "pointer",
  background: tokens.red.bg, color: tokens.red.text,
};

// Toggle ON/OFF. ON: green tint. OFF: white + hairline.
export const toggleBtn = (on = false) => ({
  fontFamily: FONT, fontSize: 9, letterSpacing: 1,
  padding: "4px 10px", borderRadius: 0, cursor: "pointer",
  border: `1px solid ${on ? tokens.green.border : tokens.ink[4]}`,
  background: on ? tokens.green.bg : tokens.neutral[0],
  color: on ? tokens.green.text : tokens.ink[3],
});
