export const WATER_OPTS = ["—", "XC", "XW", "OC", "OW"];

export const waterStyle = (v) => {
  if (v === "XC" || v === "XW") return { color: "#2a4a6e", bg: "#eef3f9" };
  if (v === "OC" || v === "OW") return { color: "#6a4818", bg: "#fdf6ea" };
  return { color: "#555", bg: "transparent" };
};

export const PAIRINGS = ["—", "Wine", "Non-Alc", "Premium", "Our Story"];

export const pairingStyle = {
  "—": { color: "#666", border: "#d8d8d8", bg: "#f5f5f5" },
  "Non-Alc": { color: "#1f5f73", border: "#7fc6db88", bg: "#7fc6db12" },
  Wine: { color: "#8a6030", border: "#c8a06088", bg: "#c8a06008" },
  Premium: { color: "#5a5a8a", border: "#8888bb88", bg: "#8888bb08" },
  "Our Story": { color: "#3a7a5a", border: "#5aaa7a88", bg: "#5aaa7a08" },
};
