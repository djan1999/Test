import { useEffect } from "react";
import { tokens } from "../../styles/tokens.js";
import { useModalEscape } from "../../hooks/useModalEscape.js";
import { useIsMobile, BP } from "../../hooks/useIsMobile.js";

export default function FullModal({ title, onClose, actions, children }) {
  const isMobile = useIsMobile(BP.sm);
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  useModalEscape(onClose);
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 500,
      background: tokens.ink.bg,
      display: "flex", flexDirection: "column",
      // Use dynamic viewport height so the mobile URL bar doesn't clip content.
      height: "100dvh",
    }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: isMobile ? "0 12px" : "0 20px",
          paddingTop: "env(safe-area-inset-top)",
          height: isMobile ? 52 + "px" : 54,
          minHeight: isMobile ? "calc(52px + env(safe-area-inset-top))" : "calc(54px + env(safe-area-inset-top))",
          borderBottom: `1px solid ${tokens.ink[4]}`,
          background: tokens.neutral[0],
          flexShrink: 0,
          gap: 8,
        }}
      >
        <span style={{
          fontFamily: tokens.font,
          fontSize: "8px",
          letterSpacing: isMobile ? "0.18em" : "0.22em",
          color: tokens.ink[3],
          textTransform: "uppercase",
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>{title}</span>
        <div style={{ display: "flex", gap: isMobile ? 6 : 8, alignItems: "center", flexShrink: 0 }}>
          {actions}
          <button
            onClick={onClose}
            style={{
              fontFamily: tokens.font,
              fontSize: isMobile ? 10 : 9,
              letterSpacing: 2,
              padding: isMobile ? "8px 12px" : "8px 16px",
              border: `1px solid ${tokens.ink[4]}`,
              borderRadius: 0,
              cursor: "pointer",
              background: tokens.neutral[0],
              color: tokens.ink[2],
              minHeight: isMobile ? 36 : undefined,
            }}
          >
            {isMobile ? "✕" : "✕ CLOSE"}
          </button>
        </div>
      </div>
      <div style={{
        flex: 1,
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        padding: isMobile ? "20px 12px" : "28px 20px 60px",
        paddingBottom: isMobile ? "calc(40px + env(safe-area-inset-bottom))" : 60,
      }}>{children}</div>
    </div>
  );
}
