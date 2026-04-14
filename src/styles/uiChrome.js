/**
 * App-wide chrome: white / neutral gray surfaces, black (#1a1a1a) for text & outlines only.
 * No black-filled bars or primary buttons — use light fills + border instead.
 */
export const UI = {
  ink: "#1a1a1a",
  line: "#1a1a1a",
  textMuted: "#888",
  textSoft: "#aaa",
  surface: "#ffffff",
  surface2: "#fafafa",
  surface3: "#f0f0f0",
  border: "#e0e0e0",
  borderLight: "#eaeaea",
  /** Selected / emphasis: never full black fill */
  selectedBg: "#f0f0f0",
  selectedBorder: "#1a1a1a",
  radius: 0,
};

/** White fill + black outline — default for action buttons app-wide */
export const outlineBtn = {
  background: "#ffffff",
  color: "#1a1a1a",
  border: "1px solid #1a1a1a",
};

export const outlineBtnActive = {
  background: "#f5f5f5",
  color: "#1a1a1a",
  border: "1px solid #1a1a1a",
};

/** Softer outline for secondary actions */
export const outlineBtnGhost = {
  background: "#ffffff",
  color: "#555555",
  border: "1px solid #d0d0d0",
};
