import { useEffect } from "react";
import { tokens } from "../../styles/tokens.js";
import { useModalEscape } from "../../hooks/useModalEscape.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";

export default function FullModal({ title, onClose, actions, children }) {
  const isMobile = useIsMobile(tokens.breakpoints.md);
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
      background: tokens.surface.card,
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
          height: isMobile ? "56px" : 60,
          minHeight: isMobile ? "calc(56px + env(safe-area-inset-top))" : "calc(60px + env(safe-area-inset-top))",
          borderBottom: tokens.border.default,
          background: tokens.surface.card,
          flexShrink: 0,
          gap: 8,
        }}
      >
        <span style={{
          fontFamily: tokens.font,
          fontSize: isMobile ? 10 : 11,
          letterSpacing: isMobile ? 3 : 4,
          color: tokens.text.muted,
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
          fontSize: isMobile ? 12 : 11,
              letterSpacing: 2,
              padding: isMobile ? "8px 12px" : "8px 16px",
              border: tokens.border.subtle,
              borderRadius: 0,
              cursor: "pointer",
              background: tokens.surface.card,
              color: tokens.text.secondary,
              minHeight: tokens.mobile.touchTargetMin,
            }}
          >
            {isMobile ? "CLOSE" : "✕ CLOSE"}
          </button>
        </div>
      </div>
      <div style={{
        flex: 1,
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
        padding: isMobile ? "20px 14px" : "28px 24px 60px",
        paddingBottom: isMobile ? "calc(40px + env(safe-area-inset-bottom))" : 60,
      }}>{children}</div>
    </div>
  );
}
