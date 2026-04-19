import { useEffect } from "react";
import { tokens } from "../../styles/tokens.js";

export default function FullModal({ title, onClose, actions, children }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, background: tokens.surface.card, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 20px",
          height: 54,
          borderBottom: tokens.border.default,
          background: tokens.surface.card,
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: tokens.font, fontSize: 9, letterSpacing: 4, color: tokens.text.muted, textTransform: "uppercase" }}>{title}</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {actions}
          <button
            onClick={onClose}
            style={{
              fontFamily: tokens.font,
              fontSize: 9,
              letterSpacing: 2,
              padding: "8px 16px",
              border: tokens.border.subtle,
              borderRadius: 0,
              cursor: "pointer",
              background: tokens.surface.card,
              color: tokens.text.secondary,
            }}
          >
            ✕ CLOSE
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "28px 20px 60px" }}>{children}</div>
    </div>
  );
}
