// Shared styles and constants for admin panel components

export const FONT = "'Roboto Mono', monospace";
export const MOBILE_SAFE_INPUT_SIZE = 16;

export const baseInp = {
  fontFamily: FONT, fontSize: MOBILE_SAFE_INPUT_SIZE,
  padding: "10px 12px", border: "1px solid #e8e8e8",
  borderRadius: 2, outline: "none",
  color: "#1a1a1a", background: "#fff",
  boxSizing: "border-box", width: "100%", minWidth: 0,
  WebkitAppearance: "none",
};

export const fieldLabel = {
  fontFamily: FONT, fontSize: 9,
  letterSpacing: 3, color: "#444",
  textTransform: "uppercase", marginBottom: 8,
};

export const sectionHeader = {
  fontFamily: FONT, fontSize: 9, letterSpacing: 2,
  color: "#bbb", textTransform: "uppercase", marginBottom: 14,
};

export const panelBtn = (active = false) => ({
  fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px",
  border: `1px solid ${active ? "#1a1a1a" : "#e8e8e8"}`,
  borderRadius: 2, cursor: "pointer",
  background: active ? "#1a1a1a" : "#fff",
  color: active ? "#fff" : "#888",
});

export const saveBtn = (saved = false) => ({
  fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px",
  border: `1px solid ${saved ? "#4a9a6a" : "#c8a06e"}`, borderRadius: 2,
  cursor: "pointer",
  background: saved ? "#4a9a6a" : "#c8a06e", color: "#fff",
});

export const dangerBtn = {
  fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px",
  border: "1px solid #ffcccc", borderRadius: 2, cursor: "pointer",
  background: "#fff9f9", color: "#c04040",
};

export const primaryBtn = {
  fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "8px 20px",
  border: "1px solid #1a1a1a", borderRadius: 2, cursor: "pointer",
  background: "#1a1a1a", color: "#fff",
};
