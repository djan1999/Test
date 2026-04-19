import { tokens } from "../../styles/tokens.js";

/**
 * Unified status button. One component for every SAVE/SYNC/SEND/CONFIRM pattern.
 *
 * Props:
 *   status:    "idle" | "loading" | "success" | "error"
 *   labels:    { idle, loading, success, error }
 *   onClick:   () => void
 *   variant:   "primary" (default) | "danger"
 *   disabled:  boolean
 */
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
    color: tokens.text.inverse,
    transition: "background 0.15s, border-color 0.15s",
    minWidth: 120,
    textAlign: "center",
  };

  let state;
  if (disabled) {
    state = { background: tokens.neutral[300], border: `1px solid ${tokens.neutral[300]}`, color: tokens.text.muted };
  } else if (status === "loading") {
    state = { background: tokens.neutral[400], border: `1px solid ${tokens.neutral[400]}` };
  } else if (status === "success") {
    state = { background: tokens.green.border, border: `1px solid ${tokens.green.border}` };
  } else if (status === "error") {
    state = { background: tokens.red.border, border: `1px solid ${tokens.red.border}` };
  } else if (variant === "danger") {
    state = { background: tokens.surface.card, border: `1px solid ${tokens.red.border}`, color: tokens.red.text };
  } else {
    state = { background: tokens.charcoal.default, border: `1px solid ${tokens.charcoal.default}` };
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
