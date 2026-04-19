import { tokens } from "../../styles/tokens.js";

export default function StatusButton({
  status = "idle",
  labels,
  onClick,
  variant = "primary",
  disabled = false,
  style: styleOverride,
  children,
}) {
  const label = labels?.[status] ?? children ?? "";

  const base = {
    fontFamily: tokens.font,
    fontSize: tokens.fontSize.sm,
    letterSpacing: 2,
    padding: "8px 18px",
    borderRadius: tokens.radius,
    cursor: status === "loading" || disabled ? "not-allowed" : "pointer",
    background: tokens.surface.card,
    color: tokens.text.primary,
    transition: "border-color 0.15s, color 0.15s",
    minWidth: 120,
    textAlign: "center",
  };

  let state;
  if (disabled) {
    state = { border: `1px solid ${tokens.neutral[300]}`, color: tokens.text.disabled };
  } else if (status === "loading") {
    state = { border: `1px solid ${tokens.neutral[300]}`, color: tokens.text.muted };
  } else if (status === "success") {
    state = { border: `1px solid ${tokens.green.border}`, color: tokens.green.text };
  } else if (status === "error") {
    state = { border: `1px solid ${tokens.red.border}`, color: tokens.red.text };
  } else if (variant === "danger") {
    state = { border: `1px solid ${tokens.red.border}`, color: tokens.red.text };
  } else {
    state = { border: `1px solid ${tokens.charcoal.default}`, color: tokens.text.primary };
  }

  return (
    <button
      onClick={onClick}
      disabled={status === "loading" || disabled}
      style={{ ...base, ...state, ...styleOverride }}
    >
      {label}
    </button>
  );
}
