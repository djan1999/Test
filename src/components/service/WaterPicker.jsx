import { useEffect, useRef, useState } from "react";
import { WATER_OPTS, waterStyle } from "../../constants/pairings.js";
import { tokens } from "../../styles/tokens.js";

export default function WaterPicker({ value, onChange }) {
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
  const ws = waterStyle(value);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          fontFamily: tokens.font,
          fontSize: 12,
          fontWeight: 500,
          padding: "6px 10px",
          border: "1px solid #e8e8e8",
          borderRadius: 0,
          cursor: "pointer",
          width: "100%",
          background: ws.bg,
          color: ws.color,
          letterSpacing: 1,
        }}
      >
        {value}
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 3px)",
            left: 0,
            background: "#fff",
            border: "1px solid #e8e8e8",
            borderRadius: 0,
            zIndex: 200,
            overflow: "hidden",
            boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
            minWidth: 70,
          }}
        >
          {WATER_OPTS.map((opt) => (
            <div
              key={opt}
              onMouseDown={() => {
                onChange(opt);
                setOpen(false);
              }}
              style={{
                padding: "8px 14px",
                cursor: "pointer",
                fontFamily: tokens.font,
                fontSize: 12,
                letterSpacing: 1,
                color: value === opt ? "#1a1a1a" : "#999",
                background: value === opt ? "#f8f8f8" : "#fff",
                fontWeight: value === opt ? 500 : 400,
                borderBottom: "1px solid #f5f5f5",
              }}
            >
              {opt}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
