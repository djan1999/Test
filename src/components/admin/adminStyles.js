// Shared styles and constants for admin panel components
import { tokens } from "../../styles/tokens.js";
import { baseInput, fieldLabel as fieldLabelMixin } from "../../styles/mixins.js";

export const FONT = tokens.font;
export const MOBILE_SAFE_INPUT_SIZE = tokens.mobileInputSize;

export const baseInp = { ...baseInput };

export const fieldLabel = { ...fieldLabelMixin };

export const sectionHeader = {
  fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 2,
  color: "#bbb", textTransform: "uppercase", marginBottom: 14,
};

export const panelBtn = (active = false) => ({
  fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1, padding: "6px 14px",
  border: `1px solid ${active ? tokens.colors.black : "#e8e8e8"}`,
  borderRadius: 0, cursor: "pointer",
  background: active ? tokens.colors.black : tokens.colors.white,
  color: active ? tokens.colors.white : tokens.colors.gray500,
});

export const saveBtn = (saved = false) => ({
  fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1, padding: "6px 14px",
  border: `1px solid ${saved ? "#4a9a6a" : "#c8a06e"}`, borderRadius: 0,
  cursor: "pointer",
  background: saved ? "#4a9a6a" : "#c8a06e", color: tokens.colors.white,
});

export const dangerBtn = {
  fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1, padding: "6px 14px",
  border: "1px solid #ffcccc", borderRadius: 0, cursor: "pointer",
  background: "#fff9f9", color: "#c04040",
};

export const primaryBtn = {
  fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "8px 20px",
  border: `1px solid ${tokens.colors.black}`, borderRadius: 0, cursor: "pointer",
  background: tokens.colors.black, color: tokens.colors.white,
};
