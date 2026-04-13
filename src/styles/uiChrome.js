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

/** Same visual language for every “on” toggle (extras, yes/no, tabs) — no green/black fills */
export const toggleOn = {
  background: "#ffffff",
  color: "#1a1a1a",
  border: "1px solid #1a1a1a",
};

export const toggleOff = {
  background: "#ffffff",
  color: "#888888",
  border: "1px solid #e0e0e0",
};

/** Selected list row / soft emphasis — still no dark fill */
export const toggleOnSoft = {
  background: "#f5f5f5",
  color: "#1a1a1a",
  border: "1px solid #1a1a1a",
};

/** Positive status: outline + text only (no filled buttons) */
export const statusOk = { color: "#2f7a45", border: "1px solid #2f7a45" };
export const statusErr = { color: "#c04040", border: "1px solid #c04040" };

/** Section chrome — one neutral strip everywhere */
export const panelHeaderBg = "#fafafa";
export const panelBorder = "#e8e8e8";
