// ─────────────────────────────────────────────────────────────
// Milka Service Board — Design Tokens
// Single source of truth for colors, typography, spacing.
// RULE: No raw hex values anywhere else in the codebase.
//       If you catch yourself typing `#` outside this file, stop.
// ─────────────────────────────────────────────────────────────

// ── Neutral scale ─────────────────────────────────────────────
// The canvas. Warm off-white base drifting to warm near-black.
const neutral = {
  0:   "#ffffff",   // pure white — input fill, card fill on canvas
  50:  "#fafaf9",   // faintest warm tint — zebra rows, subtle hover
  100: "#f4f3f1",   // canvas — page background
  150: "#ececea",   // card bg when on canvas and needs contrast
  200: "#e4e3e0",   // subtle divider
  300: "#d4d3cf",   // standard border
  400: "#a8a7a3",   // disabled element, muted icon
  500: "#85847f",   // secondary text, metadata
  600: "#5f5e5a",   // body text
  700: "#3d3c38",   // strong body, label
  900: "#1a1917",   // pure heading, maximum emphasis
};

// ── Charcoal ──────────────────────────────────────────────────
// The tying color. Primary actions, headings, focus states.
// Softer than pure black so it doesn't feel aggressive on white.
const charcoal = {
  default:  "#2a2a28",
  hover:    "#1a1917",
  disabled: "#a8a7a3",
  border:   "#2a2a28",
};

// ── Green (semantic) ──────────────────────────────────────────
// Active, enabled, saved, confirmed, arrived, success.
const green = {
  bg:     "#ecf4ee",
  border: "#8fb69b",
  text:   "#3e6b4b",
  strong: "#2d5438",
};

// ── Red (semantic) ────────────────────────────────────────────
// Destructive, remove, error, stop, warning.
const red = {
  bg:     "#f6ecec",
  border: "#c08080",
  text:   "#8a3a3a",
  strong: "#6b2828",
};

// ── Tints (tertiary wash, NEVER signal) ───────────────────────
const tint = {
  sage:      "#eef2ea",   // just-saved flash
  parchment: "#f2ede3",   // archived / historical
};

// ── Surface levels ────────────────────────────────────────────
const surface = {
  canvas:  neutral[100],
  card:    neutral[0],
  raised:  neutral[0],
  overlay: "rgba(26,25,23,0.45)",
  hover:   neutral[50],
};

// ── Text hierarchy ────────────────────────────────────────────
const text = {
  heading:   charcoal.default,
  primary:   neutral[900],
  body:      neutral[700],
  secondary: neutral[600],
  muted:     neutral[500],
  disabled:  neutral[400],
  inverse:   neutral[0],
};

// ── Borders ───────────────────────────────────────────────────
const border = {
  subtle:  `1px solid ${neutral[200]}`,
  default: `1px solid ${neutral[300]}`,
  strong:  `1px solid ${charcoal.border}`,
  active:  `1px solid ${green.border}`,
  danger:  `1px solid ${red.border}`,
};

// ── Typography ────────────────────────────────────────────────
const font = "'Roboto Mono', 'JetBrains Mono', 'IBM Plex Mono', monospace";

const fontSize = {
  xs:  8,
  sm:  9,
  base: 11,
  md:  12,
  lg:  14,
  xl:  18,
  xxl: 24,
};

// ── Spacing ───────────────────────────────────────────────────
const spacing = {
  xs:   4,
  sm:   8,
  md:  12,
  lg:  16,
  xl:  24,
  xxl: 32,
  xxxl: 48,
};

// ── Beverage glyphs ───────────────────────────────────────────
// Replaces old BEV_TYPES color-coding. All rendered in neutral[500].
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
  // Existing imports (tokens.colors.gold, tokens.colors.wine, etc.)
  // still work but map to the new palette. Do NOT remove these —
  // they keep old imports working mid-migration.
  colors: {
    gold:      charcoal.default,     // GOLD RETIRED — maps to charcoal
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
