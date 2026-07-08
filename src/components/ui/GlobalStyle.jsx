import { tokens } from "../../styles/tokens.js";

// Shared body/input baseline styles used across modes (App, Gate, Login, ReservationManager).
// Keep this minimal — only normalise box-sizing, prevent iOS auto-zoom on inputs,
// and opt EVERY element into manipulation touch-action: the app's tap targets
// are mostly clickable divs/SVG shapes, and anything outside the rule gets
// iOS's ~350ms double-tap-to-zoom wait (rapid second taps land on a delay).
// Inline touch-action on gesture surfaces (floor editor) still wins.
export default function GlobalStyle() {
  return (
    <style>{`
      * { box-sizing: border-box; touch-action: manipulation; }
      html { -webkit-tap-highlight-color: rgba(0, 0, 0, 0); }
      body { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; color: ${tokens.text.primary}; }
      input, textarea, select { font-size: ${tokens.mobileInputSize}px; }
    `}</style>
  );
}
