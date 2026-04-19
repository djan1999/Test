// ─────────────────────────────────────────────────────────────
// Milka Service Board — Design Tokens
// Aesthetic: rawlab.co — dark, minimal, precise, high-contrast.
// Deep warm-black surfaces, warm off-white text, zero radius.
// RULE: No raw hex values anywhere else in the codebase.
//       If you catch yourself typing `#` outside this file, stop.
// ─────────────────────────────────────────────────────────────

// ── Neutral scale ─────────────────────────────────────────────
// Warm dark foundation. 0 = lightest point of scale (warm white).
// 100 = page canvas (near-black). 900 = heading (warm off-white).
const neutral = {
  0:   "#f8f7f4",   // warm white — kept for pure-white contexts
  50:  "#1e1e1b",   // subtle hover/zebra lift on dark surfaces
  100: "#0e0e0c",   // canvas — page background (deep warm black)
  150: "#161613",   // card bg sitting on canvas
  200: "#1e1e1b",   // subtle divider
  300: "#2c2c28",   // standard border
  400: "#4e4e4a",   // disabled element, muted icon
  500: "#7a7a74",   // secondary text, metadata
  600: "#a8a7a0",   // body text
  700: "#c8c7c0",   // strong body, label
  900: "#f0efe9",   // pure heading, maximum emphasis (warm off-white)
};

// ── Charcoal ──────────────────────────────────────────────────
// Primary action color. Inverted for dark theme — bright fill
// with dark text reads as the dominant call-to-action.
const charcoal = {
  default:  "#f0efe9",   // warm off-white — primary action bg
  hover:    "#ffffff",
  disabled: "#4e4e4a",
  border:   "#f0efe9",
};

// ── Green (semantic) ──────────────────────────────────────────
// Active, enabled, saved, confirmed, arrived, success.
const green = {
  bg:     "#0a1a0e",   // very dark green tint
  border: "#3a7d4a",   // desaturated green border
  text:   "#5ec073",   // readable on dark backgrounds
  strong: "#4aad63",
};

// ── Red (semantic) ────────────────────────────────────────────
// Destructive, remove, error, stop, warning.
const red = {
  bg:     "#1a0a0a",   // very dark red tint
  border: "#7a4040",   // desaturated red border
  text:   "#d47070",   // readable on dark backgrounds
  strong: "#c05050",
};

// ── Tints (tertiary wash, NEVER signal) ───────────────────────
const tint = {
  sage:      "#0e1a0e",   // just-saved flash (dark green wash)
  parchment: "#1a170e",   // archived / historical (dark warm sepia)
};

// ── Surface levels ────────────────────────────────────────────
const surface = {
  canvas:  neutral[100],          // #0e0e0c — deepest dark page bg
  card:    neutral[150],          // #161613 — dark card surface
  raised:  neutral[200],          // #1e1e1b — elevated (modals, dropdowns)
  overlay: "rgba(0,0,0,0.82)",
  hover:   neutral[50],           // #1e1e1b — hover state on cards
};

// ── Text hierarchy ────────────────────────────────────────────
const text = {
  heading:   neutral[900],         // #f0efe9 — warm off-white
  primary:   neutral[900],         // #f0efe9
  body:      neutral[700],         // #c8c7c0
  secondary: neutral[600],         // #a8a7a0
  muted:     neutral[500],         // #7a7a74
  disabled:  neutral[400],         // #4e4e4a
  inverse:   "#0e0e0c",            // dark — text on bright charcoal buttons
};

// ── Borders ───────────────────────────────────────────────────
const border = {
  subtle:  `1px solid ${neutral[200]}`,        // #1e1e1b
  default: `1px solid ${neutral[300]}`,        // #2c2c28
  strong:  `1px solid ${charcoal.border}`,     // #f0efe9 — bright
  active:  `1px solid ${green.border}`,        // #3a7d4a
  danger:  `1px solid ${red.border}`,          // #7a4040
};

// ── Typography ────────────────────────────────────────────────
const font = "'Roboto Mono', 'JetBrains Mono', 'IBM Plex Mono', monospace";

const fontSize = {
  xs:   8,
  sm:   9,
  base: 11,
  md:   12,
  lg:   14,
  xl:   18,
  xxl:  24,
};

// ── Spacing ───────────────────────────────────────────────────
const spacing = {
  xs:   4,
  sm:   8,
  md:   12,
  lg:   16,
  xl:   24,
  xxl:  32,
  xxxl: 48,
};

// ── Beverage glyphs ───────────────────────────────────────────
const bevGlyph = {
  wine:     "●",
  cocktail: "◆",
  spirit:   "■",
  beer:     "▲",
  aperitif: "◐",
};

// ── Public export ─────────────────────────────────────────────
export const tokens = {
  neutral,
  charcoal,
  green,
  red,
  tint,
  surface,
  text,
  border,
  bevGlyph,

  font,
  fontSize,
  spacing,
  radius: 0,
  mobileInputSize: 16,

  // ── Legacy aliases for gradual migration ─────────────────
  colors: {
    gold:      charcoal.default,
    goldLight: tint.parchment,
    black:     neutral[900],
    white:     neutral[0],
    offWhite:  neutral[100],
    gray100:   neutral[100],
    gray300:   neutral[300],
    gray500:   neutral[500],
    gray700:   neutral[700],
    red:       red.text,
    green:     green.text,
    wine:      neutral[500],
    cocktail:  neutral[500],
    spirit:    neutral[500],
    beer:      neutral[500],
    blue:      neutral[500],
  },
};
