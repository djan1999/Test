import { tokens } from "../styles/tokens.js";

// All beverage types share the same neutral appearance.
// Differentiation is communicated by the `glyph` character + the
// `label`, not by color. This removes the decorative per-type coloring
// that was fighting the semantic contract (green = saved, red = delete).
const base = {
  color:  tokens.text.body,
  bg:     tokens.surface.card,
  border: tokens.neutral[300],
  dot:    tokens.neutral[500],
};

export const BEV_TYPES = {
  wine:     { ...base, label: "Glass",    glyph: tokens.bevGlyph.wine },
  cocktail: { ...base, label: "Cocktail", glyph: tokens.bevGlyph.cocktail },
  spirit:   { ...base, label: "Spirit",   glyph: tokens.bevGlyph.spirit },
  beer:     { ...base, label: "Beer",     glyph: tokens.bevGlyph.beer },
  aperitif: { ...base, label: "Aperitif", glyph: tokens.bevGlyph.aperitif },
};
