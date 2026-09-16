import { useEffect, useState } from "react";
import { useModalEscape } from "../../hooks/useModalEscape.js";
import { tokens } from "../../styles/tokens.js";

const FONT = tokens.font;

/**
 * The subcategory chooser for one digestivo button.
 *
 * A BOTTOM SHEET, the shape iOS and Android use for "pick one of these":
 * anchored to the bottom edge, full width, one option per row. On a service
 * tablet held one-handed that is the half of the screen a thumb can actually
 * reach — a centred dialog puts the choices where the hand is not.
 *
 * The button used to scroll its subcategories, one tap per step. Fine for a
 * pairing's four fixed types and wrong for a coffee list: reaching Filter past
 * espresso, latte, cappuccino and decaf was five taps, and a guest who says
 * "no, the decaf" has to be scrolled to rather than picked. NONE is always the
 * last row, so taking a drink back off is never a scroll to the end.
 */
export default function DigestivoPicker({ label, variants = [], current = "off", onPick, onClose }) {
  useModalEscape(onClose, true);
  const on = current !== "off";

  // Slide up on mount. Skipped for a reader who asked for less motion, and
  // harmless where matchMedia is missing (jsdom) — the sheet simply appears.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const still = typeof window !== "undefined" && window.matchMedia
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) { setShown(true); return; }
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const row = (key, text, selected, last = false) => (
    <button
      key={key ?? "none"}
      type="button"
      aria-pressed={selected}
      onClick={() => onPick(key)}
      style={{
        fontFamily: FONT, fontSize: 13, letterSpacing: "0.04em", textTransform: "uppercase",
        minHeight: 56, padding: "14px 20px", width: "100%", textAlign: "left",
        border: "none", borderBottom: last ? "none" : `1px solid ${tokens.ink[5]}`,
        borderLeft: `3px solid ${selected ? tokens.charcoal.default : "transparent"}`,
        background: selected ? tokens.tint.parchment : tokens.neutral[0],
        color: selected ? tokens.ink[0] : tokens.ink[1],
        fontWeight: selected ? 700 : 400,
        cursor: "pointer", touchAction: "manipulation",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
      }}
    >
      <span>{text}</span>
      {selected && <span style={{ fontSize: 14, color: tokens.ink[2] }}>✓</span>}
    </button>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: tokens.surface.overlay,
        display: "flex", alignItems: "flex-end", justifyContent: "center",
        zIndex: 400,
      }}
    >
      <div
        role="dialog"
        aria-label={`Choose ${label}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: tokens.neutral[0], width: "100%", maxWidth: 560,
          maxHeight: "72vh", display: "flex", flexDirection: "column",
          borderTop: `1px solid ${tokens.ink[4]}`,
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          transform: shown ? "translateY(0)" : "translateY(14px)",
          opacity: shown ? 1 : 0,
          transition: "transform 160ms ease-out, opacity 160ms ease-out",
        }}
      >
        {/* The grab handle every sheet on a phone has — it says "this came up
            from the bottom and goes back down" without a word. */}
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 0 4px" }}>
          <div style={{ width: 36, height: 4, background: tokens.ink[4] }} />
        </div>

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "4px 20px 10px", borderBottom: `1px solid ${tokens.ink[4]}`,
        }}>
          <span style={{
            fontFamily: FONT, fontSize: 10, fontWeight: 700, letterSpacing: "0.16em",
            textTransform: "uppercase", color: tokens.ink[3],
          }}>{label}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
              border: "none", background: "none", color: tokens.ink[3], cursor: "pointer",
              padding: "6px 0", touchAction: "manipulation",
            }}
          >Cancel</button>
        </div>

        <div style={{ overflowY: "auto", overscrollBehavior: "contain", flex: 1 }}>
          {variants.map((v) => row(v, v, current === v))}
          {row(null, on ? "✕ None" : "None", !on, true)}
        </div>
      </div>
    </div>
  );
}
