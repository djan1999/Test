export const WATER_OPTS = ["—", "XC", "XW", "OC", "OW"];

export const waterStyle = (v) => {
  if (v === "XC" || v === "XW") return { color: "#2a4a6e", bg: "#ffffff" };
  if (v === "OC" || v === "OW") return { color: "#333333", bg: "#ffffff" };
  return { color: "#555", bg: "transparent" };
};

export const PAIRINGS = ["—", "Wine", "Non-Alc", "Premium", "Our Story"];

export const pairingStyle = {
  "—": { color: "#444444", border: "#1a1a1a", bg: "#ffffff" },
  "Non-Alc": { color: "#1f5f73", border: "#1a1a1a", bg: "#ffffff" },
  Wine: { color: "#333333", border: "#1a1a1a", bg: "#ffffff" },
  Premium: { color: "#3a3a6a", border: "#1a1a1a", bg: "#ffffff" },
  "Our Story": { color: "#2a5a42", border: "#1a1a1a", bg: "#ffffff" },
};
