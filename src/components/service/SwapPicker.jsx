import { useEffect, useRef, useState } from "react";
import { tokens } from "../../styles/tokens.js";

export default function SwapPicker({ seatId, totalSeats, onSwap }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    document.addEventListener("touchstart", h, { passive: true });
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("touchstart", h);
    };
  }, []);
  const others = Array.from({ length: totalSeats }, (_, i) => i + 1).filter((n) => n !== seatId);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Swap position"
        style={{
          width: 36,
          height: 36,
          borderRadius: 0,
          border: `1px solid ${tokens.neutral[200]}`,
          background: open ? tokens.neutral[100] : tokens.neutral[0],
          color: tokens.neutral[600],
          cursor: "pointer",
          fontSize: 13,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ⇅
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 3px)",
            right: 0,
            background: tokens.neutral[0],
            border: `1px solid ${tokens.neutral[200]}`,
            borderRadius: 0,
            zIndex: 300,
            overflow: "hidden",
            minWidth: 80,
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
          }}
        >
          <div
            style={{
              fontFamily: tokens.font,
              fontSize: 9,
              letterSpacing: 2,
              color: tokens.neutral[600],
              padding: "7px 12px 4px",
              textTransform: "uppercase",
            }}
          >
            swap with
          </div>
          {others.map((n) => (
            <div
              key={n}
              onMouseDown={() => {
                onSwap(n);
                setOpen(false);
              }}
              style={{
                padding: "8px 14px",
                cursor: "pointer",
                fontFamily: tokens.font,
                fontSize: 12,
                color: tokens.neutral[900],
                borderTop: `1px solid ${tokens.neutral[100]}`,
              }}
            >
              P{n}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
