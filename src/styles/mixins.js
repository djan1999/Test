import { tokens } from "./tokens.js";

export const baseInput = {
  fontFamily: tokens.font,
  fontSize: tokens.mobileInputSize,
  padding: "10px 12px",
  border: tokens.borderSubtle,
  borderRadius: tokens.radius.sm,
  outline: "none",
  color: tokens.colors.ink,
  background: tokens.colors.elevated,
  boxSizing: "border-box",
  width: "100%",
  minWidth: 0,
  WebkitAppearance: "none",
  boxShadow: tokens.shadow.sm,
};

export const fieldLabel = {
  fontFamily: tokens.font,
  fontSize: tokens.fontSize.sm,
  letterSpacing: 3,
  color: tokens.colors.gray700,
  textTransform: "uppercase",
  marginBottom: 8,
};

export const chip = {
  fontFamily: tokens.font,
  fontSize: 10,
  color: tokens.colors.ink,
  letterSpacing: 1,
  padding: "6px 10px",
  border: tokens.borderSubtle,
  borderRadius: tokens.radius.sm,
  background: tokens.colors.elevated,
  whiteSpace: "nowrap",
  boxShadow: tokens.shadow.sm,
};

export const circleButton = {
  width: 36,
  height: 36,
  borderRadius: tokens.radius.sm,
  border: tokens.borderSubtle,
  background: tokens.colors.elevated,
  color: tokens.colors.gray700,
  fontSize: 18,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: tokens.font,
  lineHeight: 1,
  touchAction: "manipulation",
  boxShadow: tokens.shadow.sm,
};

export const modalOverlay = {
  position: "fixed",
  inset: 0,
  background: "rgba(23, 20, 18, 0.48)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 2000,
};

export const modalContent = {
  width: "min(960px, 96vw)",
  maxHeight: "90vh",
  overflow: "auto",
  background: tokens.colors.elevated,
  border: tokens.borderSubtle,
  borderRadius: tokens.radius.md,
  boxShadow: tokens.shadow.lg,
};

export const headerBar = {
  borderBottom: tokens.borderSubtle,
  padding: "10px 14px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  background: tokens.colors.elevated,
  position: "sticky",
  top: 0,
  zIndex: 1,
};
