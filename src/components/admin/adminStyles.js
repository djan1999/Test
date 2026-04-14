// Shared styles and constants for admin panel components
import { tokens } from "../../styles/tokens.js";
import { UI } from "../../styles/uiChrome.js";
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
  border: `1px solid ${active ? UI.line : "#e8e8e8"}`,
  borderRadius: tokens.radius, cursor: "pointer",
  background: active ? UI.selectedBg : tokens.colors.white,
  color: active ? UI.ink : tokens.colors.gray500,
});

export const saveBtn = (saved = false) => ({
  fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1, padding: "6px 14px",
  border: `1px solid ${saved ? "#2f7a45" : UI.line}`, borderRadius: tokens.radius,
  cursor: "pointer",
  background: saved ? "#ffffff" : "#ffffff",
  color: saved ? "#2f7a45" : UI.ink,
  fontWeight: 600,
});

export const dangerBtn = {
  fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1, padding: "6px 14px",
  border: "1px solid #ffcccc", borderRadius: tokens.radius, cursor: "pointer",
  background: "#fff9f9", color: "#c04040",
};

export const primaryBtn = {
  fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "8px 20px",
  border: `1px solid ${UI.okBorder}`, borderRadius: tokens.radius, cursor: "pointer",
  background: UI.okSoft, color: UI.okText, fontWeight: 600,
};
