export const WATER_OPTS = ["—", "XC", "XW", "OC", "OW"];

export const waterStyle = (v) => {
  if (v === "XC" || v === "XW") return { color: "#1f5f73", bg: "#e8f4fa", border: "#7fc6db" };
  if (v === "OC" || v === "OW") return { color: "#6a4818", bg: "#fdf4e8", border: "#d4b888" };
  return { color: "#555", bg: "transparent" };
};

export const PAIRINGS = ["—", "Wine", "Non-Alc", "Premium", "Our Story"];

export const pairingStyle = {
  "—": { color: "#555555", border: "#c8c8c8", bg: "#f5f5f5" },
  "Non-Alc": { color: "#1f5f73", border: "#7fc6db", bg: "#e8f5fa" },
  Wine: { color: "#6a3a20", border: "#c8a060", bg: "#fdf4e8" },
  Premium: { color: "#4a3a7a", border: "#a8a0d0", bg: "#f0eeff" },
  "Our Story": { color: "#2a6a4a", border: "#7abf9a", bg: "#eaf5ee" },
};
