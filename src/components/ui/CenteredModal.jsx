import { tokens } from "../../styles/tokens.js";

const FONT = tokens.font;

/**
 * Centered modal overlay with a dimmed + blurred backdrop. Content sits in the
 * middle of the screen when short, and scrolls within the overlay when tall.
 * Clicking the backdrop calls onClose; clicks inside the panel are ignored.
 */
export default function CenteredModal({ children, onClose, label, maxWidth = 560 }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 600,
        background: "rgba(0,0,0,0.45)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        padding: "24px 12px",
        paddingTop: "calc(24px + env(safe-area-inset-top))",
        paddingBottom: "calc(24px + env(safe-area-inset-bottom))",
        overflowY: "auto",
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth, margin: "auto 0" }}>
        {label && (
          <div style={{
            fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em",
            color: tokens.neutral[0], marginBottom: 6, textTransform: "uppercase",
          }}>{label}</div>
        )}
        {children}
      </div>
    </div>
  );
}
