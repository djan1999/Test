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
    <div style={{ position: "fixed", inset: 0, zIndex: 500, background: tokens.colors.elevated, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 20px",
          height: 54,
          borderBottom: tokens.borderSubtle,
          background: tokens.colors.elevated,
          flexShrink: 0,
          boxShadow: tokens.shadow.sm,
        }}
      >
        <span style={{ fontFamily: tokens.font, fontSize: 9, letterSpacing: 4, color: tokens.colors.gray500, textTransform: "uppercase" }}>{title}</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {actions}
          <button
            onClick={onClose}
            style={{
              fontFamily: tokens.font,
              fontSize: 9,
              letterSpacing: 2,
              padding: "8px 16px",
              border: tokens.borderSubtle,
              borderRadius: tokens.radius.sm,
              cursor: "pointer",
              background: tokens.colors.elevated,
              color: tokens.colors.gray700,
              boxShadow: tokens.shadow.sm,
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
