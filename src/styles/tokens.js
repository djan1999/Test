/**
 * Design tokens — white / gray system.
 * Use these instead of ad-hoc hex in components; semantic keys describe role, not hue.
 */
export const tokens = {
  colors: {
    // Core
    ink: "#1a1a1a",
    white: "#ffffff",

    // Gray ramp (50 = lightest surfaces, 900 = strongest contrast)
    gray50: "#fafafa",
    gray75: "#f5f5f5",
    gray100: "#f0f0f0",
    gray125: "#ebebeb",
    gray150: "#e8e8e8",
    gray200: "#e0e0e0",
    gray250: "#d8d8d8",
    gray300: "#d0d0d0",
    gray350: "#c8c8c8",
    gray400: "#bdbdbd",
    gray450: "#b0b0b0",
    gray500: "#aaa",
    gray550: "#999",
    gray600: "#888",
    gray650: "#777",
    gray700: "#666",
    gray750: "#555",
    gray800: "#444",
    gray850: "#333",

    // Semantic (all neutrals — state is conveyed by weight + border, not chroma)
    text: "#1a1a1a",
    textSecondary: "#666",
    textMuted: "#888",
    textDisabled: "#aaa",
    line: "#e8e8e8",
    lineStrong: "#d0d0d0",
    lineSubtle: "#f0f0f0",
    surface: "#fafafa",
    surfaceAlt: "#f5f5f5",
    overlayScrim: "rgba(0,0,0,0.45)",

    /** Selected / emphasized control (replaces former green or purple accents) */
    accent: "#1a1a1a",
    accentContrast: "#ffffff",
    /** Secondary emphasis (badges, secondary buttons) */
    accentSoft: "#555",

    /** “On” / connected / success — still gray per palette */
    positiveFg: "#555",
    positiveBg: "#f0f0f0",
    positiveBorder: "#c8c8c8",

    /** Warning / pending — mid gray */
    warnFg: "#666",
    warnBg: "#f5f5f5",
    warnBorder: "#d0d0d0",

    /** Error / destructive — darker gray, no red fill */
    dangerFg: "#333",
    dangerBg: "#f5f5f5",
    dangerBorder: "#b0b0b0",

    // Legacy names (map to neutrals — keeps older imports working)
    black: "#1a1a1a",
    offWhite: "#f8f8f8",
    gray100_legacy: "#f0efed",
    gray300: "#d0d0d0",
    gray500: "#888",
    gray700: "#555",
    red: "#333",
    green: "#555",
    blue: "#666",
    wine: "#555",
    cocktail: "#666",
    spirit: "#666",
    beer: "#777",
    gold: "#9a9a9a",
    goldLight: "#e8e8e8",
  },

  /** Full border strings for quick inline use */
  border: "1px solid #e0e0e0",
  borderHairline: "1px solid #e8e8e8",
  borderBold: "1px solid #1a1a1a",
  borderLight: "1px solid #e8e8e8",

  font: "'Roboto Mono', monospace",
  fontSize: { xs: 8, sm: 9, base: 11, md: 12, lg: 14, xl: 18, xxl: 24 },
  /** Unified corner radius for cards, inputs, buttons */
  radius: { sm: 2, md: 4, pill: 999 },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 },
  shadow: {
    modal: "0 14px 40px rgba(0,0,0,0.12)",
  },
  mobileInputSize: 16,
};
