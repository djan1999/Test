// Shared styles and constants for admin panel components
import { tokens } from "../../styles/tokens.js";
import { baseInput, fieldLabel as fieldLabelMixin } from "../../styles/mixins.js";

export const FONT = tokens.font;
export const MOBILE_SAFE_INPUT_SIZE = tokens.mobileInputSize;

export const baseInp = { ...baseInput };

export const fieldLabel = { ...fieldLabelMixin };

export const sectionHeader = {
  fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 2,
  color: tokens.colors.gray400, textTransform: "uppercase", marginBottom: 14,
};

export const panelBtn = (active = false) => ({
  fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1, padding: "6px 14px",
  border: `1px solid ${active ? tokens.colors.ink : tokens.colors.gray200}`,
  borderRadius: tokens.radius.sm, cursor: "pointer",
  background: active ? tokens.colors.ink : tokens.colors.elevated,
  color: active ? tokens.colors.white : tokens.colors.gray500,
  boxShadow: active ? tokens.shadow.sm : "none",
});

export const saveBtn = (saved = false) => ({
  fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1, padding: "6px 14px",
  border: `1px solid ${saved ? tokens.colors.greenSoft : tokens.colors.gold}`, borderRadius: tokens.radius.sm,
  cursor: "pointer",
  background: saved ? tokens.colors.greenSoft : tokens.colors.gold, color: tokens.colors.white,
  boxShadow: tokens.shadow.sm,
});

export const dangerBtn = {
  fontFamily: FONT, fontSize: tokens.fontSize.sm, letterSpacing: 1, padding: "6px 14px",
  border: `1px solid ${tokens.colors.redBorder}`, borderRadius: tokens.radius.sm, cursor: "pointer",
  background: tokens.colors.redMuted, color: tokens.colors.red,
};

export const primaryBtn = {
  fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "8px 20px",
  border: `1px solid ${tokens.colors.ink}`, borderRadius: tokens.radius.sm, cursor: "pointer",
  background: tokens.colors.ink, color: tokens.colors.white,
  boxShadow: tokens.shadow.sm,
};
