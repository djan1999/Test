import { tokens } from "../../styles/tokens.js";
import { useRef } from "react";
import { useModalEscape } from "../../hooks/useModalEscape.js";
import { useDialog } from "../../hooks/useDialog.js";
import { ModalDismissContext } from "./ModalDismissContext.js";

const FONT = tokens.font;

/**
 * Centered modal overlay with a dimmed + blurred backdrop. Content sits in the
 * middle of the screen when short, and scrolls within the overlay when tall.
 * Clicking the backdrop calls onClose; clicks inside the panel are ignored.
 */
export default function CenteredModal({ children, onClose, label, maxWidth = 560 }) {
  const beforeClose = useRef(null);
  const dialogRef = useDialog();
  const close = () => { if (!beforeClose.current || beforeClose.current()) onClose(); };
  useModalEscape(close);
  return (
    <div
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
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
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={label || "Dialog"} tabIndex={-1} onClick={e => e.stopPropagation()} style={{ width: "100%", maxWidth, margin: "auto 0" }}>
        {label && (
          <div style={{
            fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em",
            color: tokens.neutral[0], marginBottom: 6, textTransform: "uppercase",
          }}>{label}</div>
        )}
        <ModalDismissContext.Provider value={beforeClose}>{children}</ModalDismissContext.Provider>
      </div>
    </div>
  );
}
