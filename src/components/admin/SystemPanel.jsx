import { useEffect, useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { FONT } from "./adminStyles.js";
import { isUpdateReady, onUpdateReady, applyUpdate } from "../../lib/swUpdate.js";
import { clearClientDiagnostics, readClientDiagnostics } from "../../lib/clientDiagnostics.js";

// Baked in at build time (vite define) — "which version is this tablet
// actually running" must be answerable from a phone screenshot.
const BUILD_ID = typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev";

// ── SystemPanel — Supabase connection status, realtime, environment, debug ──
export default function SystemPanel({
  syncStatus,
  powerSync = null,
  sqlitePrimary = false,
  lastSyncError = null,
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
  onStartTestService,
  onRestoreBoard,
  onReadEventLog,
  onCheckLogParity,
  onRestoreToMoment,
}) {
  const safeProfiles = Array.isArray(layoutProfiles) ? layoutProfiles : [];
  const safeWineSyncConfig = wineSyncConfig || { wineCountries: [], beveragePages: [] };
  const [debugOpen, setDebugOpen] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [resyncState, setResyncState] = useState(null);
  const [syncMsg, setSyncMsg] = useState("");
  const [syncConfigSaving, setSyncConfigSaving] = useState(false);
  const [diagnostics, setDiagnostics] = useState(() => readClientDiagnostics());
  // A deployed build waiting for activation (PWA updates never force-reload
  // mid-service; the kitchen display never closes, so this button is its
  // only update path). Applying reloads THIS device deliberately.
  const [updateReady, setUpdateReady] = useState(isUpdateReady());
  useEffect(() => onUpdateReady(() => setUpdateReady(true)), []);
  // Board time machine (see the block below): rewind the live board to its
  // recorded state N minutes ago. Destructive-looking but fully reversible —
  // the restore writes through the normal row path and is itself recorded.
  const [restoreMinutes, setRestoreMinutes] = useState("10");
  // The logbook's proof of life (facts recorded server-side for the live
  // service + facts still queued on this device), plus the story tail —
  // the night's last moves in sentences. Loaded on mount and on demand.
  const [eventLog, setEventLog] = useState(null);
  useEffect(() => {
    if (!onReadEventLog) return;
    let mounted = true;
    onReadEventLog().then((status) => { if (mounted) setEventLog(status); }).catch(() => {});
    return () => { mounted = false; };
  }, [onReadEventLog]);
  const refreshEventLog = () => {
    if (!onReadEventLog) return;
    onReadEventLog().then(setEventLog).catch(() => {});
  };
  // Parity: fold the whole log with the Phase-4 reducer and compare it with
  // the live board. Green means the logbook alone could rebuild tonight.
  const [parityState, setParityState] = useState(null);
  const [parityMsg, setParityMsg] = useState("");
  const handleCheckParity = async () => {
    if (!onCheckLogParity || parityState === "running") return;
    setParityState("running");
    setParityMsg("");
    const result = await onCheckLogParity().catch((error) => ({ ok: false, error }));
    if (!result?.ok) {
      setParityState("error");
      setParityMsg(String(result?.error?.message || result?.error || "The parity check did not complete."));
    } else if (result.divergentTables?.length) {
      setParityState("divergent");
      setParityMsg(
        `DIVERGENCE at table(s) ${result.divergentTables.join(", ")} — `
        + `${result.matches}/${result.compared} match across ${result.events} fact(s). `
        + "Details recorded in Device Diagnostics.",
      );
    } else {
      setParityState("ok");
      setParityMsg(
        result.compared === 0
          ? `Log and board agree (nothing worked yet — ${result.events} fact(s)).`
          : `${result.events} fact(s) replay into the live board exactly — ${result.matches}/${result.compared} table(s) match.`,
      );
    }
  };
  // Moment restore: rewind the whole board to just BEFORE a story line.
  const [momentBusyId, setMomentBusyId] = useState(null);
  const [momentState, setMomentState] = useState(null);
  const [momentMsg, setMomentMsg] = useState("");
  const handleRestoreToMoment = async (row) => {
    if (!onRestoreToMoment || !row?.recordedAt || momentBusyId != null) return;
    if (typeof window !== "undefined" && !window.confirm(
      `Rewind the LIVE board to just BEFORE this moment?\n\n${row.line}\n\n`
      + "Every device follows within seconds. The restore is itself recorded, "
      + "so it can be undone by restoring again.",
    )) return;
    setMomentBusyId(row.id);
    setMomentState("running");
    setMomentMsg("");
    const result = await onRestoreToMoment(row.recordedAt);
    setMomentBusyId(null);
    if (result?.ok) {
      setMomentState("done");
      setMomentMsg(`Restored ${result.restored} table(s) to just before that moment.`);
    } else {
      setMomentState("error");
      setMomentMsg(String(result?.error?.message || result?.error || "The restore did not complete."));
    }
  };
  const [restoreState, setRestoreState] = useState(null);
  const [restoreMsg, setRestoreMsg] = useState("");
  const handleRestoreBoard = async () => {
    const minutes = Number(restoreMinutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      setRestoreState("error");
      setRestoreMsg("Enter how many minutes to rewind.");
      return;
    }
    if (typeof window !== "undefined" && !window.confirm(
      `Rewind the LIVE board to its state ${minutes} minute(s) ago?\n\n`
      + "Every device follows within seconds. The restore is itself recorded, "
      + "so it can be undone by restoring again.",
    )) return;
    setRestoreState("running");
    setRestoreMsg("");
    const result = await onRestoreBoard(minutes);
    if (result?.ok) {
      setRestoreState("done");
      setRestoreMsg(`Restored ${result.restored} table(s) to ${minutes} min ago.`);
    } else {
      setRestoreState("error");
      setRestoreMsg(String(result?.error?.message || result?.error || "The restore did not complete."));
    }
  };
  useEffect(() => {
    const refresh = () => setDiagnostics(readClientDiagnostics());
    window.addEventListener("milka:diagnostic", refresh);
    window.addEventListener("milka:diagnostics-cleared", refresh);
    return () => {
      window.removeEventListener("milka:diagnostic", refresh);
      window.removeEventListener("milka:diagnostics-cleared", refresh);
    };
  }, []);

  const handleManualSync = async () => {
    if (!onSyncWines) return;
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
      {/* Test service — a full, live-feeling service that persists NOTHING */}
      {onStartTestService && (
        <div style={{ border: `1px solid ${tokens.signal.warn}`, borderRadius: 0, padding: "14px 16px", background: tokens.neutral[0] }}>
          <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: tokens.ink[4], textTransform: "uppercase", marginBottom: 8 }}>Test Service</div>
          <div style={{ fontFamily: FONT, fontSize: 11, color: tokens.ink[2], lineHeight: 1.5, marginBottom: 12, maxWidth: 520 }}>
            Open a fully-working service on a blank board for today. Seat tables, fire courses,
            work the floor — everything behaves exactly like a live service, but <strong style={{ color: tokens.ink[0] }}>nothing
            is saved</strong> and the real service data is never touched. Tap END TEST (bottom bar) to discard it.
          </div>
          <button
            onClick={onStartTestService}
            style={{
              fontFamily: FONT, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase",
              fontWeight: 700, padding: "10px 18px", border: `1px solid ${tokens.ink[0]}`,
              background: tokens.signal.warn, color: tokens.ink[0], borderRadius: 0, cursor: "pointer",
              touchAction: "manipulation",
            }}
          >
            ▶ Start Test Service
          </button>
        </div>
      )}

      {onRestoreBoard && (
        <div style={{ border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, padding: "14px 16px", background: tokens.neutral[0] }}>
          <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: tokens.ink[4], textTransform: "uppercase", marginBottom: 8 }}>Board Time Machine</div>
          <div style={{ fontFamily: FONT, fontSize: 11, color: tokens.ink[2], lineHeight: 1.5, marginBottom: 12, maxWidth: 520 }}>
            The database records every version of every table on the live board.
            If something ever wipes or corrupts the service, rewind the whole board
            to how it was N minutes ago — every device follows within seconds, and
            the restore is itself recorded, so it can be rewound again.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <input
              type="number"
              min="1"
              max="720"
              value={restoreMinutes}
              onChange={(e) => setRestoreMinutes(e.target.value)}
              aria-label="Minutes to rewind"
              style={{
                fontFamily: FONT, fontSize: 12, width: 80, padding: "9px 10px",
                border: `1px solid ${tokens.ink[3]}`, borderRadius: 0, background: tokens.neutral[0],
              }}
            />
            <span style={{ fontFamily: FONT, fontSize: 10, letterSpacing: 1, color: tokens.ink[3], textTransform: "uppercase" }}>minutes ago</span>
            <button
              onClick={handleRestoreBoard}
              disabled={restoreState === "running"}
              style={{
                fontFamily: FONT, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase",
                fontWeight: 700, padding: "10px 18px", border: `1px solid ${tokens.ink[0]}`,
                background: tokens.neutral[0], color: tokens.ink[0], borderRadius: 0,
                cursor: restoreState === "running" ? "wait" : "pointer", touchAction: "manipulation",
              }}
            >
              {restoreState === "running" ? "RESTORING…" : "⟲ Restore Board"}
            </button>
            {restoreMsg && (
              <span style={{ fontFamily: FONT, fontSize: 11, color: restoreState === "error" ? tokens.red.text : tokens.green.text }}>
                {restoreMsg}
              </span>
            )}
          </div>
        </div>
      )}

      {onReadEventLog && (
        <div style={{ border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, padding: "14px 16px", background: tokens.neutral[0] }}>
          <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: tokens.ink[4], textTransform: "uppercase", marginBottom: 8 }}>Logbook</div>
          <div style={{ fontFamily: FONT, fontSize: 11, color: tokens.ink[2], lineHeight: 1.5, maxWidth: 520 }}>
            {eventLog == null && "Reading the event log…"}
            {eventLog != null && !eventLog.live && "No live service — the logbook records during service."}
            {eventLog != null && eventLog.live && (
              <>
                <strong style={{ color: tokens.ink[0] }}>
                  {eventLog.recorded == null ? "?" : eventLog.recorded}
                </strong> fact(s) recorded for the live service
                {eventLog.pending > 0 ? ` · ${eventLog.pending} queued on this device` : " · nothing queued"}
              </>
            )}
          </div>
          {eventLog?.live && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
              {onCheckLogParity && (
                <button
                  onClick={handleCheckParity}
                  disabled={parityState === "running"}
                  title="Replay every recorded fact and compare the result with the live board"
                  style={{
                    fontFamily: FONT, fontSize: 9, letterSpacing: 2, textTransform: "uppercase",
                    fontWeight: 700, padding: "8px 16px",
                    border: `1px solid ${parityState === "ok" ? tokens.green.border : parityState === "divergent" || parityState === "error" ? tokens.red.border : tokens.ink[0]}`,
                    background: tokens.neutral[0],
                    color: parityState === "ok" ? tokens.green.text : parityState === "divergent" || parityState === "error" ? tokens.red.text : tokens.ink[0],
                    borderRadius: 0, cursor: parityState === "running" ? "wait" : "pointer", touchAction: "manipulation",
                  }}
                >
                  {parityState === "running" ? "CHECKING…" : "CHECK PARITY"}
                </button>
              )}
              <button
                onClick={refreshEventLog}
                style={{
                  fontFamily: FONT, fontSize: 9, letterSpacing: 2, textTransform: "uppercase",
                  padding: "8px 16px", border: `1px solid ${tokens.ink[3]}`, background: tokens.neutral[0],
                  color: tokens.ink[1], borderRadius: 0, cursor: "pointer", touchAction: "manipulation",
                }}
              >
                Refresh
              </button>
              {parityMsg && (
                <span style={{ fontFamily: FONT, fontSize: 11, maxWidth: 520, color: parityState === "ok" ? tokens.green.text : tokens.red.text }}>
                  {parityMsg}
                </span>
              )}
            </div>
          )}
          {eventLog?.live && eventLog.story?.length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${tokens.ink[4]}` }}>
              <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: tokens.ink[4], textTransform: "uppercase", marginBottom: 8 }}>
                The night so far — last {eventLog.story.length} moment(s)
              </div>
              {eventLog.story.map((row) => (
                <div key={row.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                  <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[1], flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {row.line}
                  </span>
                  <span style={{ fontFamily: FONT, fontSize: 8, color: tokens.ink[4], letterSpacing: 1, flexShrink: 0 }}>{row.device}</span>
                  {onRestoreToMoment && row.recordedAt && (
                    <button
                      onClick={() => handleRestoreToMoment(row)}
                      disabled={momentBusyId != null}
                      title="Rewind the whole board to just before this moment"
                      style={{
                        fontFamily: FONT, fontSize: 8, letterSpacing: 1, padding: "3px 8px", flexShrink: 0,
                        border: `1px solid ${tokens.ink[3]}`, background: tokens.neutral[0], color: tokens.ink[1],
                        borderRadius: 0, cursor: momentBusyId != null ? "wait" : "pointer", touchAction: "manipulation",
                      }}
                    >
                      {momentBusyId === row.id ? "…" : "⟲ TO BEFORE"}
                    </button>
                  )}
                </div>
              ))}
              {momentMsg && (
                <div style={{ fontFamily: FONT, fontSize: 11, marginTop: 6, color: momentState === "error" ? tokens.red.text : tokens.green.text }}>
                  {momentMsg}
                </div>
              )}
            </div>
          )}
          {eventLog?.record?.length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: `1px solid ${tokens.ink[4]}` }}>
              <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: tokens.ink[4], textTransform: "uppercase", marginBottom: 8 }}>
                End-of-night parity record
              </div>
              {eventLog.record.slice(0, 6).map((entry) => {
                const green = (entry.divergentTables || []).length === 0;
                return (
                  <div key={`${entry.serviceId}-${entry.endedAt}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3px 0" }}>
                    <span style={{ fontFamily: FONT, fontSize: 10, color: green ? tokens.green.text : tokens.red.text, flexShrink: 0 }}>●</span>
                    <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[1], flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {entry.label || entry.serviceId}
                      {" — "}
                      {green
                        ? `MATCH · ${entry.matches}/${entry.compared} table(s), ${entry.events} fact(s)`
                        : `DIVERGED at T${(entry.divergentTables || []).join(", T")} · ${entry.matches}/${entry.compared} match`}
                    </span>
                    <span style={{ fontFamily: FONT, fontSize: 8, color: tokens.ink[4], letterSpacing: 1, flexShrink: 0 }}>
                      {entry.endedAt ? new Date(entry.endedAt).toLocaleDateString("sl-SI", { day: "2-digit", month: "2-digit" }) : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

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
          {/* Storage mode + build — the two facts every remote diagnosis needs:
              is this device local-first or on the direct fallback, and which
              build is it actually running (installed PWAs cache old bundles). */}
          <div style={{ border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, padding: "12px 16px", minWidth: 160 }}>
            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: tokens.ink[4], textTransform: "uppercase", marginBottom: 6 }}>Storage Mode</div>
            <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: sqlitePrimary ? tokens.green.text : tokens.ink[1] }}>
              {sqlitePrimary ? "Local-first (SQLite)" : "Direct (fallback)"}
            </span>
          </div>
          <div style={{ border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, padding: "12px 16px", minWidth: 200 }}>
            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: tokens.ink[4], textTransform: "uppercase", marginBottom: 6 }}>App Build</div>
            <span style={{ fontFamily: FONT, fontSize: 11, color: tokens.ink[1], wordBreak: "break-word" }}>{BUILD_ID}</span>
            {updateReady && (
              <div style={{ marginTop: 8 }}>
                <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[2], marginBottom: 6 }}>
                  New build downloaded — waiting. Applies on next app reopen.
                </div>
                <button
                  onClick={() => applyUpdate()}
                  style={{
                    fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
                    padding: "7px 12px", border: `1px solid ${tokens.ink[0]}`, background: tokens.ink[0],
                    color: tokens.neutral[0], borderRadius: 0, cursor: "pointer", fontWeight: 600,
                  }}
                >
                  Apply update now (reloads)
                </button>
              </div>
            )}
          </div>
          {lastSyncError && (
            <div style={{ border: `1px solid ${tokens.red.border}`, background: tokens.red.bg, borderRadius: 0, padding: "12px 16px", minWidth: 220, maxWidth: 420 }}>
              <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: tokens.red.text, textTransform: "uppercase", marginBottom: 6 }}>Last Sync Error</div>
              <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.red.text, wordBreak: "break-word" }}>
                <span style={{ color: tokens.ink[2] }}>
                  [{new Date(lastSyncError.at).toLocaleTimeString("sl-SI", { hour: "2-digit", minute: "2-digit" })}] {lastSyncError.source}:{" "}
                </span>
                {lastSyncError.msg}
              </div>
            </div>
          )}
          <div style={{ border: `1px solid ${diagnostics.length ? tokens.red.border : tokens.ink[4]}`, background: diagnostics.length ? tokens.red.bg : tokens.neutral[0], borderRadius: 0, padding: "12px 16px", minWidth: 220, maxWidth: 420 }}>
            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: diagnostics.length ? tokens.red.text : tokens.ink[4], textTransform: "uppercase", marginBottom: 6 }}>Device Diagnostics</div>
            {diagnostics.length ? (
              <>
                <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.red.text, wordBreak: "break-word", marginBottom: 8 }}>
                  {diagnostics.length} recorded issue{diagnostics.length === 1 ? "" : "s"}. Latest: {diagnostics[0].message}
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(JSON.stringify(diagnostics, null, 2))}
                    style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, padding: "5px 8px", border: `1px solid ${tokens.ink[3]}`, background: tokens.neutral[0], cursor: "pointer" }}
                  >COPY REPORT</button>
                  <button
                    type="button"
                    onClick={clearClientDiagnostics}
                    style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, padding: "5px 8px", border: `1px solid ${tokens.red.border}`, background: tokens.neutral[0], color: tokens.red.text, cursor: "pointer" }}
                  >CLEAR</button>
                </div>
              </>
            ) : (
              <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.green.text }}>No browser crashes recorded on this device.</div>
            )}
          </div>
          {/* Sync engine (PowerSync) — the STREAM's own state and, crucially,
              its last error string, so a device stuck on LINK/ERROR tells us
              WHY from this panel alone (no DevTools needed on a phone). */}
          {powerSync && (
            <div style={{ border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, padding: "12px 16px", minWidth: 220, maxWidth: 420 }}>
              <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: tokens.ink[4], textTransform: "uppercase", marginBottom: 6 }}>Sync Stream</div>
              <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: powerSync.connected ? tokens.green.text : tokens.red.text }}>
                {powerSync.connected ? "Connected" : "Down"}
              </span>
              <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[3], marginTop: 5 }}>
                last sync: {powerSync.lastSyncedAt
                  ? new Date(powerSync.lastSyncedAt).toLocaleString("sl-SI", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
                  : "never"}
              </div>
              {powerSync.streamError && (
                <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.red.text, marginTop: 5, wordBreak: "break-word" }}>
                  {powerSync.streamErrorAt && (
                    <span style={{ color: tokens.ink[3] }}>
                      [{new Date(powerSync.streamErrorAt).toLocaleTimeString("sl-SI", { hour: "2-digit", minute: "2-digit" })}]{" "}
                    </span>
                  )}
                  {powerSync.streamError}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Manual Actions */}
      <div>
        <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: tokens.ink[4], textTransform: "uppercase", marginBottom: 14 }}>Manual Actions</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {onSyncWines && <button onClick={handleManualSync} disabled={syncResult === "syncing"} style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "8px 16px",
              border: `1px solid ${syncResult === "ok" ? tokens.green.border : syncResult === "err" ? tokens.red.border : tokens.charcoal.default}`,
              borderRadius: 0, cursor: syncResult === "syncing" ? "not-allowed" : "pointer",
              background: tokens.neutral[0],
              color: syncResult === "ok" ? tokens.green.text : syncResult === "err" ? tokens.red.text : tokens.ink[0],
            }}>
              {syncResult === "syncing" ? "SYNCING..." : syncResult === "ok" ? "SYNCED" : syncResult === "err" ? "FAILED" : "RESYNC CATALOGUE"}
            </button>}
          {onSyncWines && syncMsg && (
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
          {/* Recovery for a wedged upload queue: one permanently-rejected op
              on a protected table blocks every later write on this device
              while the UI keeps accepting input. This was the designed
              recovery primitive (powersync/system.js clearLocalAndResync)
              with no product surface — a wedged tablet needed DevTools. */}
          {sqlitePrimary && (
            <button
              onClick={async () => {
                if (typeof window !== "undefined" && !window.confirm(
                  "Reset this device's LOCAL sync database and re-download everything from the server?\n\n"
                  + "Un-uploaded local changes on THIS device are discarded. Use when the sync stream shows a permanent error and writes stopped uploading.",
                )) return;
                setResyncState("working");
                try {
                  const { clearLocalAndResync } = await import("../../powersync/system.js");
                  await clearLocalAndResync();
                  setResyncState("done");
                  setTimeout(() => { if (typeof window !== "undefined") window.location.reload(); }, 400);
                } catch (e) {
                  console.error("Local resync failed:", e);
                  setResyncState("err");
                }
              }}
              disabled={resyncState === "working"}
              style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "8px 16px",
                border: `1px solid ${resyncState === "err" ? tokens.red.border : tokens.ink[3]}`,
                borderRadius: 0, cursor: resyncState === "working" ? "not-allowed" : "pointer",
                background: tokens.neutral[0],
                color: resyncState === "err" ? tokens.red.text : tokens.ink[1],
              }}
            >
              {resyncState === "working" ? "RESETTING…" : resyncState === "err" ? "RESET FAILED" : "RESET LOCAL SYNC DB"}
            </button>
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
              value={activeLayoutProfileId || ""}
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

      {/* External catalogue sync configuration */}
      <div>
        <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: tokens.ink[4], textTransform: "uppercase", marginBottom: 14 }}>Catalogue Sync</div>
        <div style={{ border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, padding: "16px 18px", background: tokens.ink.bg, display: "flex", flexDirection: "column", gap: 10 }}>
          {!safeWineSyncConfig.provider ? (
            <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[2], lineHeight: 1.6, maxWidth: 620 }}>
              Automated catalogue sync is not configured for this restaurant. Wines and drinks remain restaurant-owned and can be managed manually. A platform operator must assign an approved external source before sync controls appear.
            </div>
          ) : <>
            <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[3] }}>
              Provider: {safeWineSyncConfig.provider}
            </div>
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
          </>}
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
