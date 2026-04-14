// Shared styles and constants for admin panel components
import { tokens } from "../../styles/tokens.js";
import { baseInput, fieldLabel as fieldLabelMixin } from "../../styles/mixins.js";

const c = tokens.colors;

export const FONT = tokens.font;
export const MOBILE_SAFE_INPUT_SIZE = tokens.mobileInputSize;

export const baseInp = { ...baseInput };

export const fieldLabel = { ...fieldLabelMixin };

export const sectionHeader = {
  fontFamily: FONT,
  fontSize: tokens.fontSize.sm,
  letterSpacing: 2,
  color: c.gray600,
  textTransform: "uppercase",
  marginBottom: 14,
};

export const panelBtn = (active = false) => ({
  fontFamily: FONT,
  fontSize: tokens.fontSize.sm,
  letterSpacing: 1,
  padding: "6px 14px",
  border: `1px solid ${active ? c.black : c.line}`,
  borderRadius: tokens.radius.sm,
  cursor: "pointer",
  background: active ? c.black : c.white,
  color: active ? c.white : c.gray600,
});

export const saveBtn = (saved = false) => ({
  fontFamily: FONT,
  fontSize: tokens.fontSize.sm,
  letterSpacing: 1,
  padding: "6px 14px",
  border: `1px solid ${saved ? c.gray450 : c.gray400}`,
  borderRadius: tokens.radius.sm,
  cursor: "pointer",
  background: saved ? c.gray750 : c.gray400,
  color: c.white,
});

export const dangerBtn = {
  fontFamily: FONT,
  fontSize: tokens.fontSize.sm,
  letterSpacing: 1,
  padding: "6px 14px",
  border: `1px solid ${c.lineStrong}`,
  borderRadius: tokens.radius.sm,
  cursor: "pointer",
  background: c.gray75,
  color: c.gray850,
};

export const primaryBtn = {
  fontFamily: FONT,
  fontSize: 10,
  letterSpacing: 2,
  padding: "8px 20px",
  border: `1px solid ${c.black}`,
  borderRadius: tokens.radius.sm,
  cursor: "pointer",
  background: c.black,
  color: c.white,
};
