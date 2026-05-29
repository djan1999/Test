import { tokens } from "./tokens.js";

export const baseInput = {
  fontFamily: tokens.font,
  fontSize: tokens.mobileInputSize,
  padding: "10px 12px",
  border: `1px solid ${tokens.ink[4]}`,
  borderRadius: 0,
  outline: "none",
  color: tokens.ink[1],
  background: tokens.neutral[0],
  boxSizing: "border-box",
  width: "100%",
  minWidth: 0,
  WebkitAppearance: "none",
};

export const fieldLabel = {
  fontFamily: tokens.font,
  fontSize: 9,
  letterSpacing: 3,
  color: tokens.ink[2],
  textTransform: "uppercase",
  marginBottom: tokens.spacing.sm,
};

export const chip = {
  fontFamily: tokens.font,
  fontSize: 10,
  color: tokens.ink[0],
  letterSpacing: 1,
  padding: "6px 10px",
  border: `1px solid ${tokens.ink[4]}`,
  borderRadius: 0,
  background: tokens.neutral[0],
  whiteSpace: "nowrap",
};

export const circleButton = {
  width: 44,
  height: 44,
  borderRadius: 0,
  border: `1px solid ${tokens.ink[4]}`,
  background: tokens.neutral[0],
  color: tokens.ink[0],
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
  background: tokens.surface.overlay,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 2000,
};

export const modalContent = {
  width: "min(960px, 96vw)",
  maxHeight: "90vh",
  overflow: "auto",
  background: tokens.neutral[0],
  border: `1px solid ${tokens.ink[4]}`,
};

export const headerBar = {
  borderBottom: `1px solid ${tokens.ink[4]}`,
  padding: "10px 14px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  background: tokens.neutral[0],
  position: "sticky",
  top: 0,
  zIndex: 1,
};
