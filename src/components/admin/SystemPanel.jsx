import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
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
  const [syncMsg, setSyncMsg] = useState("");
  const [syncConfigSaving, setSyncConfigSaving] = useState(false);

  const handleManualSync = async () => {
    setSyncResult("syncing");
    setSyncMsg("");
    try {
      const r = await onSyncWines();
      if (r?.ok) {
        setSyncResult("ok");
        const parts = [
          r.wines != null ? `${r.wines} wines` : null,
          r.cocktails != null ? `${r.cocktails} cocktails` : null,
          r.beers != null ? `${r.beers} beers` : null,
          r.spirits != null ? `${r.spirits} spirits` : null,
        ].filter(Boolean);
        const warn = r.failedCountries?.length ? ` (missed: ${r.failedCountries.join(", ")})` : "";
        setSyncMsg(`${parts.join(", ")}${warn}`);
      } else {
        setSyncResult("err");
        setSyncMsg(r?.error || "Unknown error");
      }
    } catch (e) {
      setSyncResult("err");
      setSyncMsg(e?.message || "Request failed");
    }
    setTimeout(() => { setSyncResult(null); setSyncMsg(""); }, 8000);
  };

  const statusColor = syncStatus === "live" ? tokens.green.text : syncStatus === "local-only" ? tokens.ink[3] : syncStatus === "connecting" ? tokens.ink[1] : tokens.red.text;
  const statusLabel = syncStatus === "live" ? "Connected" : syncStatus === "local-only" ? "Local Only" : syncStatus === "connecting" ? "Connecting..." : "Error";
  const activeProfile = safeProfiles.find(p => p.id === activeLayoutProfileId) || safeProfiles[0] || null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Connection Status */}
      <div>
        <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: tokens.ink[4], textTransform: "uppercase", marginBottom: 14 }}>Supabase Connection</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <div style={{ border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, padding: "12px 16px", minWidth: 160 }}>
            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: tokens.ink[4], textTransform: "uppercase", marginBottom: 6 }}>Status</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: 0, background: statusColor }} />
              <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: statusColor }}>{statusLabel}</span>
            </div>
          </div>
          <div style={{ border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, padding: "12px 16px", minWidth: 160 }}>
            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: tokens.ink[4], textTransform: "uppercase", marginBottom: 6 }}>Realtime</div>
            <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: syncStatus === "live" ? tokens.green.text : tokens.ink[3] }}>
              {syncStatus === "live" ? "Active" : "Inactive"}
            </span>
          </div>
          <div style={{ border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, padding: "12px 16px", minWidth: 160 }}>
            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: tokens.ink[4], textTransform: "uppercase", marginBottom: 6 }}>Environment</div>
            <span style={{ fontFamily: FONT, fontSize: 12, color: tokens.ink[1] }}>
              {hasSupabase ? "Production" : "Local"}
            </span>
          </div>
        </div>
      </div>

      {/* Manual Actions */}
      <div>
        <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: tokens.ink[4], textTransform: "uppercase", marginBottom: 14 }}>Manual Actions</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button onClick={handleManualSync} disabled={syncResult === "syncing"} style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "8px 16px",
            border: `1px solid ${syncResult === "ok" ? tokens.green.border : syncResult === "err" ? tokens.red.border : tokens.charcoal.default}`,
            borderRadius: 0, cursor: syncResult === "syncing" ? "not-allowed" : "pointer",
            background: tokens.neutral[0],
            color: syncResult === "ok" ? tokens.green.text : syncResult === "err" ? tokens.red.text : tokens.ink[0],
          }}>
            {syncResult === "syncing" ? "SYNCING..." : syncResult === "ok" ? "SYNCED" : syncResult === "err" ? "FAILED" : "RESYNC WINES"}
          </button>
          {syncMsg && (
            <span
              title={syncMsg}
              style={{
                fontFamily: FONT, fontSize: 10,
                color: syncResult === "ok" ? tokens.green.text : tokens.red.text,
                maxWidth: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {syncMsg}
            </span>
          )}
        </div>
      </div>

      {/* Logo */}
      <div>
        <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: tokens.ink[4], textTransform: "uppercase", marginBottom: 14 }}>Menu Logo</div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ width: 64, height: 64, border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, display: "flex", alignItems: "center", justifyContent: "center", background: tokens.ink.bg, flexShrink: 0 }}>
            {logoDataUri
              ? <img src={logoDataUri} alt="logo" style={{ width: 52, height: 52, objectFit: "contain" }} />
              : <span style={{ fontFamily: FONT, fontSize: 8, color: tokens.ink[4], letterSpacing: 1 }}>NO LOGO</span>
            }
          </div>
          <div>
            <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[3], marginBottom: 8 }}>
              Upload PNG, JPG, or SVG. Will be embedded in all printed menus.
            </div>
            <label style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px", border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[0], display: "inline-block" }}>
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
              <button onClick={() => onSaveLogo("")} style={{ marginLeft: 8, fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px", border: `1px solid ${tokens.red.border}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.red.text }}>
                REMOVE
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Layout profiles */}
      <div>
        <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: tokens.ink[4], textTransform: "uppercase", marginBottom: 14 }}>Print Layout</div>
        <div style={{ border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, padding: "16px 18px", background: tokens.ink.bg }}>
          <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[1], marginBottom: 6 }}>Layout versions</div>
          <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[3], marginBottom: 12 }}>
            No factory defaults. Each layout is an editable version with its own template + spacing.
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <select
              value={activeLayoutProfileId}
              onChange={(e) => onSelectLayoutProfile?.(e.target.value)}
              style={{ fontFamily: FONT, fontSize: 10, padding: "6px 8px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, minWidth: 220 }}
            >
              {safeProfiles.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <button onClick={() => onCreateLayoutProfile?.()} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 12px", border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[0] }}>NEW BLANK LAYOUT</button>
            <button
              onClick={() => activeProfile && onDeleteLayoutProfile?.(activeProfile.id)}
              disabled={safeProfiles.length <= 1}
              style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 12px", border: `1px solid ${tokens.red.border}`, borderRadius: 0, cursor: safeProfiles.length <= 1 ? "not-allowed" : "pointer", background: tokens.neutral[0], color: tokens.red.text, opacity: safeProfiles.length <= 1 ? 0.6 : 1 }}
            >
              DELETE LAYOUT
            </button>
          </div>
        </div>
      </div>

      {/* Wine sync configuration */}
      <div>
        <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: tokens.ink[4], textTransform: "uppercase", marginBottom: 14 }}>Wine Sync Configuration</div>
        <div style={{ border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, padding: "16px 18px", background: tokens.ink.bg, display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[2] }}>
            Countries (CSV: SI,AT,IT,FR,HR)
            <input
              value={(safeWineSyncConfig.wineCountries || []).join(",")}
              onChange={(e) => onUpdateWineSyncConfig?.({
                ...safeWineSyncConfig,
                wineCountries: e.target.value.split(",").map(v => v.trim().toUpperCase()).filter(Boolean),
              })}
              style={{ marginTop: 4, width: "100%", fontFamily: FONT, fontSize: 10, padding: "6px 8px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0 }}
            />
          </label>
          <label style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[2] }}>
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
              style={{ marginTop: 4, width: "100%", fontFamily: FONT, fontSize: 10, padding: "6px 8px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, resize: "vertical" }}
            />
          </label>
          <div>
            <button
              onClick={async () => { setSyncConfigSaving(true); try { await onSaveWineSyncConfig?.(); } finally { setSyncConfigSaving(false); } }}
              disabled={syncConfigSaving}
              style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 12px", border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0, cursor: syncConfigSaving ? "not-allowed" : "pointer", background: tokens.neutral[0], color: tokens.ink[0] }}
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
          style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: tokens.ink[4], background: "none", border: "none", cursor: "pointer", padding: 0, textTransform: "uppercase" }}
        >
          Debug Info {debugOpen ? "▲" : "▼"}
        </button>
        {debugOpen && (
          <div style={{ marginTop: 10, border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, padding: "14px 16px", background: tokens.ink.bg }}>
            <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], lineHeight: 1.8 }}>
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
