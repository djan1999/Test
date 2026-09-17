import { useModalEscape } from "../../hooks/useModalEscape.js";
import { tokens } from "../../styles/tokens.js";

const FONT = tokens.font;

/**
 * The subcategory chooser for one digestivo button.
 *
 * A small panel in the middle of the screen — near where the button was
 * tapped, no bigger than the list it holds. It replaced a cycle because
 * reaching Filter past espresso, latte, cappuccino and decaf was five taps,
 * and a guest saying "no, the decaf" had to be scrolled to rather than picked.
 * It is not a full-screen or bottom-anchored sheet: this is a choice between a
 * handful of coffees, and it should cost the screen about that much.
 */
export default function DigestivoPicker({ label, variants = [], current = "off", onPick, onClose }) {
  useModalEscape(onClose, true);
  const on = current !== "off";

  const chip = (key, text, selected) => (
    <button
      key={key ?? "none"}
      type="button"
      aria-pressed={selected}
      onClick={() => onPick(key)}
      style={{
        fontFamily: FONT, fontSize: 10, letterSpacing: "0.04em", textTransform: "uppercase",
        minHeight: 38, padding: "8px 12px", borderRadius: 0, cursor: "pointer",
        border: `1px solid ${selected ? tokens.charcoal.default : tokens.ink[4]}`,
        background: selected ? tokens.tint.parchment : tokens.neutral[0],
        color: selected ? tokens.ink[0] : tokens.ink[2],
        fontWeight: selected ? 700 : 400,
        touchAction: "manipulation", textAlign: "left", whiteSpace: "nowrap",
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
          background: tokens.neutral[0], border: `1px solid ${tokens.charcoal.default}`,
          borderRadius: 0, width: "auto", minWidth: 200, maxWidth: 340,
          maxHeight: "70vh", display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14,
          padding: "8px 10px", borderBottom: `1px solid ${tokens.ink[4]}`,
        }}>
          <span style={{
            fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: "0.14em",
            textTransform: "uppercase", color: tokens.ink[2],
          }}>{label}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              fontFamily: FONT, fontSize: 13, lineHeight: 1, width: 22, height: 22,
              border: "none", background: "none", color: tokens.ink[3], cursor: "pointer",
              padding: 0, touchAction: "manipulation",
            }}
          >×</button>
        </div>

        <div style={{
          padding: 8, overflowY: "auto", display: "flex", flexWrap: "wrap", gap: 5,
          alignContent: "flex-start",
        }}>
          {variants.map((v) => chip(v, v, current === v))}
          {chip(null, on ? "✕ None" : "None", !on)}
        </div>
      </div>
    </div>
  );
}
