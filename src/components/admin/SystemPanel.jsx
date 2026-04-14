import { useState } from "react";
import { FONT } from "./adminStyles.js";

// ── SystemPanel — Supabase connection status, realtime, environment, debug ──
export default function SystemPanel({
  syncStatus,
  supabaseUrl,
  hasSupabase,
  onSyncWines,
  logoDataUri = "",
  onSaveLogo,
  layoutStyles = {},
  onUpdateLayoutStyles,
  onSaveLayoutStyles,
  layoutProfiles = [],
  activeLayoutProfileId = "",
  onSelectLayoutProfile,
  onCreateLayoutProfile,
  onDeleteLayoutProfile,
  wineSyncConfig,
  onUpdateWineSyncConfig,
  onSaveWineSyncConfig,
}) {
  const safeProfiles = Array.isArray(layoutProfiles) ? layoutProfiles : [];
  const safeWineSyncConfig = wineSyncConfig || { wineCountries: [], beveragePages: [] };
  const [debugOpen, setDebugOpen] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [syncErrorDetail, setSyncErrorDetail] = useState(null);
  const [syncConfigSaving, setSyncConfigSaving] = useState(false);

  const handleManualSync = async () => {
    setSyncResult("syncing");
    setSyncErrorDetail(null);
    try {
      const r = await onSyncWines();
      setSyncResult(r?.ok ? "ok" : "err");
      if (!r?.ok && r?.error) setSyncErrorDetail(String(r.error));
    } catch (e) {
      setSyncResult("err");
      setSyncErrorDetail(e?.message || "Request failed");
    }
    setTimeout(() => { setSyncResult(null); setSyncErrorDetail(null); }, 8000);
  };

  const statusColor = syncStatus === "live" ? "#2a7a2a" : syncStatus === "local-only" ? "#888" : syncStatus === "connecting" ? "#c8a06e" : "#c04040";
  const statusLabel = syncStatus === "live" ? "Connected" : syncStatus === "local-only" ? "Local Only" : syncStatus === "connecting" ? "Connecting..." : "Error";
  const activeProfile = safeProfiles.find(p => p.id === activeLayoutProfileId) || safeProfiles[0] || null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Connection Status */}
      <div>
        <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 14 }}>Supabase Connection</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ border: "1px solid #e8e8e8", borderRadius: 4, padding: "12px 16px", minWidth: 160 }}>
            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>Status</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor }} />
              <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: statusColor }}>{statusLabel}</span>
            </div>
          </div>
          <div style={{ border: "1px solid #e8e8e8", borderRadius: 4, padding: "12px 16px", minWidth: 160 }}>
            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>Realtime</div>
            <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: syncStatus === "live" ? "#2a7a2a" : "#888" }}>
              {syncStatus === "live" ? "Active" : "Inactive"}
            </span>
          </div>
          <div style={{ border: "1px solid #e8e8e8", borderRadius: 4, padding: "12px 16px", minWidth: 160 }}>
            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>Environment</div>
            <span style={{ fontFamily: FONT, fontSize: 12, color: "#444" }}>
              {hasSupabase ? "Production" : "Local"}
            </span>
          </div>
        </div>
      </div>

      {/* Manual Actions */}
      <div>
        <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 14 }}>Manual Actions</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={handleManualSync} disabled={syncResult === "syncing"} style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "8px 16px",
            border: `1px solid ${syncResult === "ok" ? "#8fc39f" : syncResult === "err" ? "#e89898" : "#c8a06e"}`,
            borderRadius: 2, cursor: syncResult === "syncing" ? "not-allowed" : "pointer",
            background: syncResult === "ok" ? "#eef8f1" : syncResult === "err" ? "#fff0f0" : "#fffaf4",
            color: syncResult === "ok" ? "#2f7a45" : syncResult === "err" ? "#c04040" : "#8a6020",
          }}>
            {syncResult === "syncing" ? "SYNCING..." : syncResult === "ok" ? "SYNCED" : syncResult === "err" ? "FAILED" : "RESYNC WINES"}
          </button>
        </div>
        {syncErrorDetail ? (
          <div style={{ fontFamily: FONT, fontSize: 10, color: "#a03030", maxWidth: 420, lineHeight: 1.4 }}>
            {syncErrorDetail}
          </div>
        ) : null}
        </div>
      </div>

      {/* Logo */}
      <div>
        <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 14 }}>Menu Logo</div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 64, height: 64, border: "1px solid #e8e8e8", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", background: "#fafafa", flexShrink: 0 }}>
            {logoDataUri
              ? <img src={logoDataUri} alt="logo" style={{ width: 52, height: 52, objectFit: "contain" }} />
              : <span style={{ fontFamily: FONT, fontSize: 8, color: "#ccc", letterSpacing: 1 }}>NO LOGO</span>
            }
          </div>
          <div>
            <div style={{ fontFamily: FONT, fontSize: 9, color: "#888", marginBottom: 8 }}>
              Upload PNG, JPG, or SVG. Will be embedded in all printed menus.
            </div>
            <label style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px", border: "1px solid #1a1a1a", borderRadius: 2, cursor: "pointer", background: "#1a1a1a", color: "#fff", display: "inline-block" }}>
              UPLOAD LOGO
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => onSaveLogo(ev.target.result);
                reader.readAsDataURL(file);
              }} />
            </label>
            {logoDataUri && (
              <button onClick={() => onSaveLogo("")} style={{ marginLeft: 8, fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px", border: "1px solid #e08080", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#c04040" }}>
                REMOVE
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Layout profiles */}
      <div>
        <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 14 }}>Print Layout</div>
        <div style={{ border: "1px solid #e8e8e8", borderRadius: 4, padding: "16px 18px", background: "#fafafa" }}>
          <div style={{ fontFamily: FONT, fontSize: 10, color: "#444", marginBottom: 6 }}>Layout versions</div>
          <div style={{ fontFamily: FONT, fontSize: 9, color: "#888", marginBottom: 12 }}>
            No factory defaults. Each layout is an editable version with its own template + spacing.
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={activeLayoutProfileId}
              onChange={(e) => onSelectLayoutProfile?.(e.target.value)}
              style={{ fontFamily: FONT, fontSize: 10, padding: "6px 8px", border: "1px solid #ddd", borderRadius: 2, minWidth: 220 }}
            >
              {safeProfiles.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button onClick={() => onCreateLayoutProfile?.()} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 12px", border: "1px solid #1a1a1a", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#1a1a1a" }}>NEW BLANK LAYOUT</button>
            <button
              onClick={() => activeProfile && onDeleteLayoutProfile?.(activeProfile.id)}
              disabled={safeProfiles.length <= 1}
              style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 12px", border: "1px solid #e08080", borderRadius: 2, cursor: safeProfiles.length <= 1 ? "not-allowed" : "pointer", background: "#fff", color: "#c04040", opacity: safeProfiles.length <= 1 ? 0.6 : 1 }}
            >
              DELETE LAYOUT
            </button>
          </div>
        </div>
      </div>

      {/* Wine sync configuration */}
      <div>
        <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 14 }}>Wine Sync Configuration</div>
        <div style={{ border: "1px solid #e8e8e8", borderRadius: 4, padding: "16px 18px", background: "#fafafa", display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ fontFamily: FONT, fontSize: 9, color: "#666" }}>
            Countries (CSV: SI,AT,IT,FR,HR)
            <input
              value={(safeWineSyncConfig.wineCountries || []).join(",")}
              onChange={(e) => onUpdateWineSyncConfig?.({
                ...safeWineSyncConfig,
                wineCountries: e.target.value.split(",").map(v => v.trim().toUpperCase()).filter(Boolean),
              })}
              style={{ marginTop: 4, width: "100%", fontFamily: FONT, fontSize: 10, padding: "6px 8px", border: "1px solid #ddd", borderRadius: 2 }}
            />
          </label>
          <label style={{ fontFamily: FONT, fontSize: 9, color: "#666" }}>
            Beverage categories (one per line: label|url|category)
            <textarea
              value={(safeWineSyncConfig.beveragePages || []).map(p => `${p.label}|${p.url}|${p.category}`).join("\n")}
              onChange={(e) => onUpdateWineSyncConfig?.({
                ...safeWineSyncConfig,
                beveragePages: e.target.value
                  .split("\n")
                  .map(line => line.trim())
                  .filter(Boolean)
                  .map(line => {
                    const [label = "", url = "", category = ""] = line.split("|").map(s => s.trim());
                    return { label, url, category };
                  })
                  .filter(p => p.label && p.url && p.category),
              })}
              rows={6}
              style={{ marginTop: 4, width: "100%", fontFamily: FONT, fontSize: 10, padding: "6px 8px", border: "1px solid #ddd", borderRadius: 2, resize: "vertical" }}
            />
          </label>
          <div>
            <button
              onClick={async () => { setSyncConfigSaving(true); try { await onSaveWineSyncConfig?.(); } finally { setSyncConfigSaving(false); } }}
              disabled={syncConfigSaving}
              style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 12px", border: "1px solid #1a1a1a", borderRadius: 2, cursor: syncConfigSaving ? "not-allowed" : "pointer", background: "#1a1a1a", color: "#fff" }}
            >
              {syncConfigSaving ? "SAVING..." : "SAVE SYNC CONFIG"}
            </button>
          </div>
        </div>
      </div>

      {/* Debug panel (collapsed) */}
      <div>
        <button
          onClick={() => setDebugOpen(o => !o)}
          style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#bbb", background: "none", border: "none", cursor: "pointer", padding: 0, textTransform: "uppercase" }}
        >
          Debug Info {debugOpen ? "▲" : "▼"}
        </button>
        {debugOpen && (
          <div style={{ marginTop: 10, border: "1px solid #f0f0f0", borderRadius: 4, padding: "14px 16px", background: "#fafafa" }}>
            <div style={{ fontFamily: FONT, fontSize: 10, color: "#888", lineHeight: 1.8 }}>
              <div>Supabase URL: {supabaseUrl ? supabaseUrl.replace(/https?:\/\//, "").slice(0, 30) + "..." : "not configured"}</div>
              <div>Supabase Connected: {hasSupabase ? "yes" : "no"}</div>
              <div>Sync Status: {syncStatus}</div>
              <div>User Agent: {typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 60) + "..." : "N/A"}</div>
              <div>Timestamp: {new Date().toISOString()}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
