export const WATER_OPTS = ["—", "XC", "XW", "OC", "OW"];

export const waterStyle = (v) => {
  if (v === "XC" || v === "XW") return { color: "#1a1a1a", bg: "#f0f0f0" };
  if (v === "OC" || v === "OW") return { color: "#1a1a1a", bg: "#e8e8e8" };
  return { color: "#555", bg: "transparent" };
};

export const PAIRINGS = ["—", "Wine", "Non-Alc", "Premium", "Our Story"];

export const pairingStyle = {
  "—": { color: "#666", border: "#d8d8d8", bg: "#f5f5f5" },
  "Non-Alc": { color: "#555", border: "#c8c8c8aa", bg: "#ebebeb33" },
  Wine: { color: "#666", border: "#c8c8c8aa", bg: "#ebebeb22" },
  Premium: { color: "#555", border: "#b0b0b0aa", bg: "#e8e8e822" },
  "Our Story": { color: "#555", border: "#a8a8a8aa", bg: "#e0e0e022" },
};
