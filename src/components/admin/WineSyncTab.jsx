import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { outlineBtn } from "../../styles/uiChrome.js";

const FONT = tokens.font;

export default function WineSyncTab({ onSyncWines }) {
  const [status, setStatus] = useState(null);
  const [msg, setMsg] = useState("");

  const handleSync = async () => {
    setStatus("syncing");
    setMsg("");
    try {
      const r = await onSyncWines();
      if (r?.ok) {
        const parts = [
          r.wines != null ? `${r.wines} wines` : null,
          r.cocktails != null ? `${r.cocktails} cocktails` : null,
          r.beers != null ? `${r.beers} beers` : null,
          r.spirits != null ? `${r.spirits} spirits` : null,
        ].filter(Boolean);
        const warn = r.failedCountries?.length ? ` (missed: ${r.failedCountries.join(", ")})` : "";
        setStatus("ok");
        setMsg(`${parts.join(", ")}${warn}`);
      } else {
        setStatus("err");
        setMsg(r?.error || "Failed");
      }
    } catch (e) {
      setStatus("err");
      setMsg(e.message);
    }
  };

  return (
    <div>
      <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#888", textTransform: "uppercase", marginBottom: 16 }}>
        Wine &amp; beverage sync from hotel website
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          onClick={handleSync}
          disabled={status === "syncing"}
          style={{
            fontFamily: FONT,
            fontSize: 9,
            letterSpacing: 2,
            padding: "10px 20px",
            borderRadius: 2,
            cursor: status === "syncing" ? "not-allowed" : "pointer",
            opacity: status === "syncing" ? 0.65 : 1,
            fontWeight: 600,
            ...outlineBtn,
          }}
        >
          {status === "syncing" ? "SYNCING…" : "SYNC WINES & BEVERAGES"}
        </button>
        {msg && <span style={{ fontFamily: FONT, fontSize: 10, color: status === "ok" ? "#2a7a2a" : "#c04040" }}>{msg}</span>}
      </div>
    </div>
  );
}
