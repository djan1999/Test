import { tokens } from "./tokens.js";

export const baseInput = {
  fontFamily: tokens.font,
  fontSize: tokens.mobileInputSize,
  padding: "10px 12px",
  border: tokens.border.default,
  borderRadius: tokens.radius,
  outline: "none",
  color: tokens.text.body,
  background: tokens.surface.card,
  boxSizing: "border-box",
  width: "100%",
  minWidth: 0,
  WebkitAppearance: "none",
};

export const fieldLabel = {
  fontFamily: tokens.font,
  fontSize: tokens.fontSize.sm,
  letterSpacing: 3,
  color: tokens.text.secondary,
  textTransform: "uppercase",
  marginBottom: tokens.spacing.sm,
};

export const chip = {
  fontFamily: tokens.font,
  fontSize: 10,
  color: tokens.text.primary,
  letterSpacing: 1,
  padding: "6px 10px",
  border: tokens.border.default,
  borderRadius: tokens.radius,
  background: tokens.surface.card,
  whiteSpace: "nowrap",
};

export const circleButton = {
  width: 44,
  height: 44,
  borderRadius: tokens.radius,
  border: `1px solid ${tokens.neutral[300]}`,
  background: tokens.surface.card,
  color: tokens.text.primary,
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
  background: tokens.surface.raised,
  border: tokens.border.default,
  boxShadow: "0 14px 40px rgba(26,25,23,0.22)",
};

export const headerBar = {
  borderBottom: tokens.border.subtle,
  padding: "10px 14px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  background: tokens.surface.card,
  position: "sticky",
  top: 0,
  zIndex: 1,
};
