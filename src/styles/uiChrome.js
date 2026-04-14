/**
 * Universal chrome: white + gray surfaces, black for text & subtle accents only.
 * Semantic color repeats everywhere for the same job (save = green, on = green, danger = red, cycle pick = blue).
 */
export const UI = {
  ink: "#1a1a1a",
  /** Accent: text weight, nav tick, rare emphasis — not default button rings */
  accent: "#1a1a1a",
  /** Neutral button / chip outline (no harsh black ring on white) */
  line: "#c4c4c4",
  lineStrong: "#a8a8a8",
  textMuted: "#888",
  textSoft: "#aaa",
  surface: "#ffffff",
  surface2: "#f5f5f5",
  surface3: "#ebebeb",
  border: "#e0e0e0",
  borderLight: "#eaeaea",
  selectedBg: "#ebebeb",
  selectedBorder: "#a8a8a8",
  radius: 0,

  ok: "#2f7a45",
  okSoft: "#eef8f1",
  okBorder: "#8fc39f",
  okText: "#1e5a32",

  err: "#c04040",
  errSoft: "#fff5f5",
  errBorder: "#e89898",
  errText: "#a02828",

  info: "#2a5580",
  infoSoft: "#eef4fa",
  infoBorder: "#a8c4dc",
  infoText: "#1a4060",
};

/** Default toolbar / secondary action — gray fill, soft border (not white + black outline) */
export const outlineBtn = {
  background: UI.surface2,
  color: UI.ink,
  border: `1px solid ${UI.line}`,
};

export const outlineBtnActive = {
  background: UI.surface3,
  color: UI.ink,
  border: `1px solid ${UI.lineStrong}`,
};

export const outlineBtnGhost = {
  background: UI.surface,
  color: "#666666",
  border: `1px solid ${UI.border}`,
};

/** Save, confirm, +add primary — always this */
export const primaryAction = {
  background: UI.okSoft,
  color: UI.okText,
  border: `1px solid ${UI.okBorder}`,
};

/** Ordered / enabled / on — always this */
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

/** Off / inactive toggle */
export const toggleOff = {
  background: UI.surface2,
  color: UI.textMuted,
  border: `1px solid ${UI.border}`,
};

/**
 * One-of-many / cycling selection (pairing step, menu long/short, water row when not “all same”) — always blue family.
 */
export const cycleSelected = {
  background: UI.infoSoft,
  color: UI.infoText,
  border: `1px solid ${UI.infoBorder}`,
};

export const cycleIdle = {
  background: UI.surface2,
  color: UI.textMuted,
  border: `1px solid ${UI.border}`,
};

export const statusOk = { color: UI.ok, border: `1px solid ${UI.okBorder}` };
export const statusErr = { color: UI.err, border: `1px solid ${UI.errBorder}` };

export const panelHeaderBg = UI.surface2;
export const panelBorder = UI.border;

/** Bordered panels (aperitif blocks, etc.) — gray surface, not white + black ring */
export const neutralPanel = {
  background: UI.surface2,
  border: `1px solid ${UI.border}`,
};

/** Read-only / meta chips (pace slow, hotel room) */
export const neutralChip = {
  background: UI.surface2,
  color: UI.ink,
  border: `1px solid ${UI.line}`,
};

