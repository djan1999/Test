import { tokens } from "../../styles/tokens.js";

// Shared body/input baseline styles used across modes (App, Gate, Login, ReservationManager).
// Keep this minimal — only normalise box-sizing, prevent iOS auto-zoom on inputs,
// and opt buttons/links into manipulation touch-action so taps don't double-fire.
export default function GlobalStyle() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      body { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; color: ${tokens.text.primary}; }
      input, textarea, select { font-size: ${tokens.mobileInputSize}px; }
      button, a, label { touch-action: manipulation; }
    `}</style>
  );
}
