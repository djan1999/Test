import { tokens } from "./tokens.js";

export const baseInput = {
  fontFamily: tokens.font,
  fontSize: tokens.mobileInputSize,
  padding: "10px 12px",
  border: "1px solid #e8e8e8",
  borderRadius: 0,
  outline: "none",
  color: tokens.colors.black,
  background: tokens.colors.white,
  boxSizing: "border-box",
  width: "100%",
  minWidth: 0,
  WebkitAppearance: "none",
};

export const fieldLabel = {
  fontFamily: tokens.font,
  fontSize: tokens.fontSize.sm,
  letterSpacing: 3,
  color: "#444",
  textTransform: "uppercase",
  marginBottom: 8,
};

export const chip = {
  fontFamily: tokens.font,
  fontSize: 10,
  color: tokens.colors.black,
  letterSpacing: 1,
  padding: "6px 10px",
  border: "1px solid #e8e8e8",
  borderRadius: 0,
  background: tokens.colors.white,
  whiteSpace: "nowrap",
};

export const circleButton = {
  width: 36,
  height: 36,
  borderRadius: 0,
  border: "1px solid #e8e8e8",
  background: tokens.colors.white,
  color: "#444",
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
  background: "rgba(0,0,0,0.45)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 2000,
};

export const modalContent = {
  width: "min(960px, 96vw)",
  maxHeight: "90vh",
  overflow: "auto",
  background: tokens.colors.white,
  border: "1px solid #e8e8e8",
  boxShadow: "0 14px 40px rgba(0,0,0,0.22)",
};

export const headerBar = {
  borderBottom: "1px solid #f0f0f0",
  padding: "10px 14px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  background: tokens.colors.white,
  position: "sticky",
  top: 0,
  zIndex: 1,
};
