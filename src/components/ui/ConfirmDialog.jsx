import { useModalEscape } from "../../hooks/useModalEscape.js";
import { tokens } from "../../styles/tokens.js";

const FONT = tokens.font;

/**
 * Consequence-first confirm. The body states what the action does and what
 * survives it — a destructive tap in the middle of service is only safe when
 * the operator can read the way back before they commit.
 */
export default function ConfirmDialog({
  label,
  body,
  reassurance = "",
  confirmLabel = "CONFIRM",
  danger = false,
  onConfirm,
  onCancel,
}) {
  useModalEscape(onCancel, true);
  const accent = danger ? tokens.red.text : tokens.charcoal.default;
  return (
    <div
      role="presentation"
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, background: tokens.surface.overlay,
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 400, padding: 16,
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={label}
        onClick={e => e.stopPropagation()}
        style={{
          background: tokens.neutral[0], border: `1px solid ${tokens.ink[3]}`,
          maxWidth: 380, width: "100%", padding: 18, fontFamily: FONT,
        }}
      >
        <div style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: accent, marginBottom: 8 }}>
          {label}
        </div>
        <div style={{ fontSize: 12, color: tokens.ink[0], lineHeight: 1.55, marginBottom: reassurance ? 8 : 16 }}>
          {body}
        </div>
        {reassurance && (
          <div style={{ fontSize: 10, color: tokens.ink[3], lineHeight: 1.5, marginBottom: 16 }}>
            {reassurance}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
              minHeight: 44, padding: "8px 18px", border: `1px solid ${tokens.ink[4]}`,
              borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[2],
            }}
          >CANCEL</button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
              minHeight: 44, padding: "8px 18px", border: `1px solid ${accent}`,
              borderRadius: 0, cursor: "pointer", background: accent, color: tokens.neutral[0],
              fontWeight: 700,
            }}
          >{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
