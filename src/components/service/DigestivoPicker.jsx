import { useModalEscape } from "../../hooks/useModalEscape.js";
import { tokens } from "../../styles/tokens.js";

const FONT = tokens.font;

/**
 * The subcategory chooser for one digestivo button.
 *
 * The button used to SCROLL its subcategories, one tap per step. That is fine
 * for a pairing's four fixed types and wrong for a coffee list: reaching Filter
 * past espresso, latte, cappuccino and decaf is five taps, and a guest who says
 * "no, the decaf" has to be scrolled to rather than picked. Here every option
 * is on screen at once and the right one is one tap away, in either direction.
 *
 * NONE is always offered, so taking a drink back off never means scrolling
 * through the whole list to reach the end of the cycle.
 */
export default function DigestivoPicker({ label, variants = [], current = "off", onPick, onClose }) {
  useModalEscape(onClose, true);
  const on = current !== "off";

  const option = (key, text, selected) => (
    <button
      key={key}
      type="button"
      aria-pressed={selected}
      onClick={() => onPick(key)}
      style={{
        fontFamily: FONT, fontSize: 11, letterSpacing: "0.04em", textTransform: "uppercase",
        minHeight: 48, padding: "10px 14px", borderRadius: 0, cursor: "pointer",
        border: `1px solid ${selected ? tokens.charcoal.default : tokens.ink[4]}`,
        background: selected ? tokens.tint.parchment : tokens.neutral[0],
        color: selected ? tokens.ink[0] : tokens.ink[2],
        fontWeight: selected ? 700 : 400,
        touchAction: "manipulation", textAlign: "left",
      }}
    >{text}</button>
  );

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: tokens.surface.overlay,
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 400, padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-label={`Choose ${label}`}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}`,
          borderRadius: 0, width: "100%", maxWidth: 420, maxHeight: "80vh",
          display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "12px 14px", borderBottom: `1px solid ${tokens.ink[4]}`,
        }}>
          <span style={{
            fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: "0.14em",
            textTransform: "uppercase", color: tokens.ink[0],
          }}>{label}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              fontFamily: FONT, fontSize: 15, lineHeight: 1, width: 34, height: 34,
              border: "none", background: "none", color: tokens.ink[3], cursor: "pointer",
              touchAction: "manipulation",
            }}
          >×</button>
        </div>

        <div style={{
          padding: 12, overflowY: "auto", display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 6,
        }}>
          {variants.map((v) => option(v, v, current === v))}
        </div>

        {/* NONE spans the footer rather than sitting as one orphaned cell of
            the grid above — it is not a sixth kind of coffee. */}
        <div style={{ padding: "0 12px 12px", display: "grid", borderTop: `1px solid ${tokens.ink[5]}`, paddingTop: 12 }}>
          {option(null, on ? "✕ None" : "None", !on)}
        </div>
      </div>
    </div>
  );
}
