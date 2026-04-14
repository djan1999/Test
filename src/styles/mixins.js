import { tokens } from "./tokens.js";

const c = tokens.colors;
const r = tokens.radius;

export const baseInput = {
  fontFamily: tokens.font,
  fontSize: tokens.mobileInputSize,
  padding: "10px 12px",
  border: `1px solid ${c.line}`,
  borderRadius: r.sm,
  outline: "none",
  color: c.black,
  background: c.white,
  boxSizing: "border-box",
  width: "100%",
  minWidth: 0,
  WebkitAppearance: "none",
};

export const fieldLabel = {
  fontFamily: tokens.font,
  fontSize: tokens.fontSize.sm,
  letterSpacing: 3,
  color: c.gray800,
  textTransform: "uppercase",
  marginBottom: 8,
};

export const chip = {
  fontFamily: tokens.font,
  fontSize: 10,
  color: c.black,
  letterSpacing: 1,
  padding: "6px 10px",
  border: `1px solid ${c.line}`,
  borderRadius: r.pill,
  background: c.white,
  whiteSpace: "nowrap",
};

export const circleButton = {
  width: 36,
  height: 36,
  borderRadius: "50%",
  border: `1px solid ${c.line}`,
  background: c.white,
  color: c.gray800,
  fontSize: 18,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: tokens.font,
  lineHeight: 1,
  touchAction: "manipulation",
};

export const modalOverlay = {
  position: "fixed",
  inset: 0,
  background: c.overlayScrim,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 2000,
};

export const modalContent = {
  width: "min(960px, 96vw)",
  maxHeight: "90vh",
  overflow: "auto",
  background: c.white,
  border: `1px solid ${c.line}`,
  boxShadow: tokens.shadow.modal,
};

export const headerBar = {
  borderBottom: `1px solid ${c.lineSubtle}`,
  padding: "10px 14px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  background: c.white,
  position: "sticky",
  top: 0,
  zIndex: 1,
};
