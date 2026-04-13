/**
 * App-wide chrome: neutral surfaces + semantic color (green good, red bad, blue info).
 * Avoid heavy black fills; use soft tints + colored borders for state.
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
  selectedBg: "#f0f0f0",
  selectedBorder: "#1a1a1a",
  radius: 0,

  /** Success / on / confirmed */
  ok: "#2f7a45",
  okSoft: "#eef8f1",
  okBorder: "#8fc39f",
  okText: "#1e5a32",

  /** Danger / error / destructive */
  err: "#c04040",
  errSoft: "#fff5f5",
  errBorder: "#e89898",
  errText: "#a02828",

  /** Info / neutral-accent (pairing, documents, water) */
  info: "#2a5580",
  infoSoft: "#eef4fa",
  infoBorder: "#a8c4dc",
  infoText: "#1a4060",

  /** Default action buttons (not harsh black ring) */
  neutralBtnBorder: "#c8c8c8",
};

/** Secondary toolbar / nav actions — white + neutral border */
export const outlineBtn = {
  background: "#ffffff",
  color: UI.ink,
  border: `1px solid ${UI.neutralBtnBorder}`,
};

export const outlineBtnActive = {
  background: UI.surface3,
  color: UI.ink,
  border: `1px solid ${UI.line}`,
};

export const outlineBtnGhost = {
  background: "#ffffff",
  color: "#555555",
  border: `1px solid ${UI.border}`,
};

/** Positive primary (save, add, confirm) */
export const primaryAction = {
  background: UI.okSoft,
  color: UI.okText,
  border: `1px solid ${UI.okBorder}`,
};

/** Toggle / chip ON — green = active (universal) */
export const toggleOn = {
  background: UI.okSoft,
  color: UI.okText,
  border: `1px solid ${UI.okBorder}`,
};

export const toggleOnSoft = {
  background: "#f4fbf6",
  color: UI.okText,
  border: `1px solid ${UI.okBorder}`,
};

export const toggleOff = {
  background: "#ffffff",
  color: UI.textMuted,
  border: `1px solid ${UI.border}`,
};

export const statusOk = { color: UI.ok, border: `1px solid ${UI.okBorder}` };
export const statusErr = { color: UI.err, border: `1px solid ${UI.errBorder}` };

export const panelHeaderBg = UI.surface2;
export const panelBorder = UI.border;
