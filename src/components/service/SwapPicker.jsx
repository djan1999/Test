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
          width: 28,
          height: 28,
          borderRadius: 2,
          border: "1px solid #e8e8e8",
          background: open ? "#f5f5f5" : "#fff",
          color: "#555",
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
            background: "#fff",
            border: "1px solid #e8e8e8",
            borderRadius: 2,
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
              color: "#555",
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
                color: "#1a1a1a",
                borderTop: "1px solid #f5f5f5",
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
