import { tokens } from "../../../styles/tokens.js";
import CenteredModal from "../../ui/CenteredModal.jsx";
import { FONT, dangerButton, inputStyle, quietButton } from "./shared.js";

/**
 * Destructive transitions ask first. Where a reason is required it cannot be
 * skipped — the reason is what the reservation's audit trail keeps, and what
 * the guest is told when someone calls back.
 */
export default function ConfirmDialog({ prompt, onReason, onCancel, onConfirm }) {
  if (!prompt) return null;
  return (
    <CenteredModal onClose={onCancel} maxWidth={460} label={prompt.title}>
      <div style={{ background: tokens.neutral[0], border: `1px solid ${tokens.ink[3]}`, padding: 18, fontFamily: FONT }}>
        <div style={{ fontSize: 12, color: tokens.ink[0], lineHeight: 1.6, marginBottom: 12 }}>{prompt.message}</div>
        {prompt.needsReason && (
          <input
            autoFocus
            value={prompt.reason || ""}
            onChange={(event) => onReason(event.target.value)}
            placeholder="Reason (required, kept in the audit trail)"
            style={{ ...inputStyle, marginBottom: 12 }}
          />
        )}
        {prompt.error && (
          <div style={{ fontSize: 9, letterSpacing: "0.08em", color: tokens.red.text, marginBottom: 10, textTransform: "uppercase" }}>
            {prompt.error}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={onCancel} style={quietButton}>
            Back
          </button>
          <button type="button" onClick={onConfirm} style={dangerButton}>
            {prompt.confirmLabel}
          </button>
        </div>
      </div>
    </CenteredModal>
  );
}
