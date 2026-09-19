import { useLiveQuery } from "../../hooks/useLiveQuery.js";
import { useRef, useState } from "react";
import { supabase } from "../../lib/supabaseClient.js";
import { readStateKey, readStatePrefix, saveStateKey, pendingStateKeys } from "../../lib/stateStore.js";
import { workspaceKey } from "../../utils/storage.js";
import { COUNTRY_NAMES, stripCountryFromRegion, inferCountryFromRegion } from "../../constants/countries.js";
import { tokens } from "../../styles/tokens.js";
import { baseInput } from "../../styles/mixins.js";
import FullModal from "../ui/FullModal.jsx";
import { useIsMobile } from "../../hooks/useIsMobile.js";

const FONT = tokens.font;
const baseInp = { ...baseInput };
const INV_LS_KEY = "milka-inventory-counts";
const LEGACY_INV_SETTINGS_ID = "inventory";
const INV_SETTINGS_PREFIX = "inventory_device:";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const getDeviceId = () => {
  const KEY = "milka-inv-did";
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = Math.random().toString(36).slice(2, 10);
    localStorage.setItem(KEY, id);
  }
  return id;
};

export default function InventoryModal({ wines, onClose }) {
  const isMobile = useIsMobile(640);
  const myId = useRef(getDeviceId());
  const mySettingsId = `${INV_SETTINGS_PREFIX}${myId.current}`;
  const localCountsKey = workspaceKey(INV_LS_KEY);
  const stRef = useRef(null);
  const inventoryHydrated = useRef(false);
  const [syncSt, setSyncSt] = useState("loading");
  const [search, setSearch] = useState("");

  const [fullState, setFullState] = useState(() => {
    let myCountsLS = {};
    try { myCountsLS = JSON.parse(localStorage.getItem(localCountsKey) || "{}"); } catch {}
    const initial = { d: { [myId.current]: { label: "...", counts: myCountsLS } } };
    stRef.current = initial;
    return initial;
  });

  const myCounts = fullState.d[myId.current]?.counts || {};
  const allDevices = fullState.d || {};
  const displayCounts = {};

  Object.entries(allDevices).forEach(([did, dev]) => {
    if (did !== myId.current) {
      Object.entries(dev.counts || {}).forEach(([wid, n]) => {
        if (n > 0) displayCounts[wid] = n;
      });
    }
  });
  Object.entries(myCounts).forEach(([wid, n]) => {
    if (n > 0) displayCounts[wid] = n;
  });

  const fmtCount = (n) => (n % 1 >= 0.5 ? `${Math.floor(n)}½` : String(Math.floor(n)));

  const deviceTotals = Object.entries(allDevices)
    .map(([did, dev]) => ({
      id: did,
      label: dev.label || did,
      total: Object.values(dev.counts || {}).reduce((s, n) => s + (n || 0), 0),
      isMe: did === myId.current,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const grandTotal = Object.values(displayCounts).reduce((s, n) => s + n, 0);

  const flushToStore = async (state) => {
    // The local-SQLite path works offline (the write uploads later); only the
    // direct-Supabase fallback needs the network right now.
    if (!supabase) { setSyncSt("offline"); return; }
    const mine = state?.d?.[myId.current] || { label: "This device", counts: {} };
    const { ok } = await saveStateKey(mySettingsId, mine);
    setSyncSt(ok ? "synced" : "error");
  };

  const applyUpdate = (updater) => {
    const prev = stRef.current;
    const prevMy = prev.d[myId.current]?.counts || {};
    const nextMy = typeof updater === "function" ? updater(prevMy) : updater;
    try { localStorage.setItem(localCountsKey, JSON.stringify(nextMy)); } catch {}
    const next = { d: { ...prev.d, [myId.current]: { ...prev.d[myId.current], counts: nextMy } } };
    stRef.current = next;
    setFullState(next);
    setSyncSt("saving");
    // Queue immediately: closing the modal must not cancel somebody's count.
    void flushToStore(next);
  };

  const inc = (id) => applyUpdate((c) => {
    const cur = c[id] || 0;
    const half = cur % 1 >= 0.5 ? 0.5 : 0;
    return { ...c, [id]: Math.floor(cur) + 1 + half };
  });
  const dec = (id) => applyUpdate((c) => {
    const cur = c[id] || 0;
    const half = cur % 1 >= 0.5 ? 0.5 : 0;
    return { ...c, [id]: Math.max(0, Math.floor(cur) - 1) + half };
  });
  const setCount = (id, val) => {
    const n = parseInt(val, 10);
    applyUpdate((c) => {
      const half = (c[id] || 0) % 1 >= 0.5 ? 0.5 : 0;
      return { ...c, [id]: Number.isNaN(n) || n < 0 ? 0 + half : n + half };
    });
  };
  const togglePartial = (id) => applyUpdate((c) => {
    const cur = c[id] || 0;
    return { ...c, [id]: cur % 1 >= 0.5 ? Math.floor(cur) : cur + 0.5 };
  });
  const clearAll = () => {
    if (window.confirm("Clear YOUR counts on this device? Other devices are not affected.")) applyUpdate({});
  };

  useLiveQuery("inventory", () => Promise.all([
    readStatePrefix(INV_SETTINGS_PREFIX), readStateKey(LEGACY_INV_SETTINGS_ID),
  ]), ([deviceRows, legacyState]) => {
    const remote = { ...(legacyState?.d || {}) };
    for (const row of deviceRows) {
      const did = String(row.id || "").slice(INV_SETTINGS_PREFIX.length);
      if (did) remote[did] = row.state || {};
    }
    let mine = stRef.current.d[myId.current];
    let recoverLocal = false;
    if (!inventoryHydrated.current) {
      const saved = remote[myId.current];
      const local = localStorage.getItem(localCountsKey);
      // A locally saved zero or cleared count is intentional too.
      mine = { label: saved?.label || `Device ${Object.keys(remote).length + 1}`,
        counts: local != null ? mine.counts : (saved?.counts || {}),
      };
      recoverLocal = local != null && JSON.stringify(mine.counts) !== JSON.stringify(saved?.counts || {});
      inventoryHydrated.current = true;
    }
    const next = { d: { ...remote, [myId.current]: mine } };
    stRef.current = next;
    setFullState(next);
    if (recoverLocal) void flushToStore(next);
    else if (!pendingStateKeys().includes(mySettingsId)) setSyncSt(navigator.onLine ? "synced" : "offline");
  }, { tables: ["service_settings"], onError: () => setSyncSt("error") });

  const q = search.trim().toLowerCase();
  const filtered = q
    ? wines.filter((w) =>
        (w.name || "").toLowerCase().includes(q)
        || (w.producer || "").toLowerCase().includes(q)
        || (w.vintage || "").toLowerCase().includes(q))
    : wines;

  const syncChip = (() => {
    if (syncSt === "loading") return { label: "LOADING...", color: tokens.neutral[400], bg: tokens.neutral[50], border: tokens.neutral[200] };
    if (syncSt === "saving") return { label: "SAVING...", color: tokens.text.body, bg: tokens.tint.parchment, border: tokens.neutral[300] };
    if (syncSt === "offline") return { label: "OFFLINE · SAVED", color: tokens.text.body, bg: tokens.tint.parchment, border: tokens.neutral[300] };
    if (syncSt === "error") return { label: "SYNC ERROR", color: tokens.red.text, bg: tokens.red.bg, border: tokens.red.border };
    return { label: "SYNCED", color: tokens.green.text, bg: tokens.green.bg, border: tokens.green.border };
  })();

  const handlePrint = () => {
    const byCountry = {};
    wines.forEach((w) => {
      const country = COUNTRY_NAMES[w.country] || w.country || "Other";
      if (!byCountry[country]) byCountry[country] = [];
      byCountry[country].push(w);
    });
    const dateStr = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const deviceSummary = deviceTotals.map((d) => `${escapeHtml(d.label)}: ${fmtCount(d.total)}`).join(" · ");
    const rows = (ws) => ws.map((w) => {
      const n = displayCounts[w.id] || 0;
      const rawVin = String(w.vintage || "").trim();
      const vin = rawVin.match(/^\d{4}$/) ? `'${rawVin.slice(2)}` : rawVin;
      const rc = w.country || inferCountryFromRegion(w.region);
      const sub = [stripCountryFromRegion(w.region, rc), COUNTRY_NAMES[rc] || rc].filter(Boolean).join(", ");
      return `<tr>
        <td style="padding:5px 4px;border-bottom:1px solid ${tokens.neutral[200]};vertical-align:top;">
          <div style="font-weight:600;">${escapeHtml(w.producer)} ${escapeHtml(w.name)} <span style="font-weight:400;color:${tokens.neutral[500]};">${escapeHtml(vin)}</span></div>
          ${sub ? `<div style="font-size:9px;color:${tokens.neutral[400]};margin-top:1px;">${escapeHtml(sub)}</div>` : ""}
        </td>
        <td style="padding:5px 4px;border-bottom:1px solid ${tokens.neutral[200]};text-align:right;font-size:15px;font-weight:700;color:${n > 0 ? tokens.neutral[900] : tokens.neutral[300]};white-space:nowrap;width:48px;">${fmtCount(n)}</td>
      </tr>`;
    }).join("");
    const sections = Object.entries(byCountry).sort(([a], [b]) => a.localeCompare(b)).map(([country, ws]) => `
      <div style="margin-bottom:20px;">
        <div style="font-size:9px;letter-spacing:3px;color:${tokens.neutral[500]};text-transform:uppercase;border-bottom:1px solid ${tokens.neutral[200]};padding-bottom:4px;margin-bottom:6px;">${escapeHtml(country)}</div>
        <table style="width:100%;border-collapse:collapse;">${rows(ws)}</table>
      </div>`).join("");
    const html = `<html><head><title>Wine Inventory · ${dateStr}</title>
      <style>body{font-family:'Roboto Mono',monospace;font-size:11px;padding:24px;color:${tokens.neutral[900]};}@media print{body{padding:12px;}}</style>
      </head><body>
        <div style="font-size:14px;font-weight:600;letter-spacing:4px;margin-bottom:4px;">WINE INVENTORY</div>
        <div style="font-size:9px;letter-spacing:2px;color:${tokens.neutral[500]};margin-bottom:4px;">${dateStr}</div>
        ${deviceTotals.length > 1 ? `<div style="font-size:9px;color:${tokens.neutral[500]};margin-bottom:20px;">${deviceSummary} · TOTAL: ${fmtCount(grandTotal)}</div>` : `<div style="font-size:9px;color:${tokens.neutral[500]};margin-bottom:20px;">Total: ${fmtCount(grandTotal)} bottles</div>`}
        ${sections}
        <div style="font-size:11px;font-weight:700;text-align:right;padding-top:12px;border-top:1px solid ${tokens.neutral[200]};">TOTAL: ${fmtCount(grandTotal)} bottles</div>
      </body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 500);
  };

  const actions = (
    <div style={{ display: "flex", gap: isMobile ? 6 : 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
      <span style={{
        fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, padding: "4px 10px",
        border: `1px solid ${syncChip.border}`, borderRadius: 0,
        background: syncChip.bg, color: syncChip.color, whiteSpace: "nowrap",
      }}>{syncChip.label}</span>
      <button onClick={clearAll} style={{
        fontFamily: FONT, fontSize: 9, letterSpacing: isMobile ? 1.5 : 2, padding: isMobile ? "6px 10px" : "6px 12px",
        border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.neutral[500],
      }}>{isMobile ? "CLEAR" : "CLEAR ALL"}</button>
      <button onClick={handlePrint} style={{
        fontFamily: FONT, fontSize: 9, letterSpacing: isMobile ? 1.5 : 2, padding: isMobile ? "6px 10px" : "6px 14px",
        border: `1px solid ${tokens.neutral[300]}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[50], color: tokens.neutral[500],
      }}>PRINT</button>
    </div>
  );

  return (
    <FullModal title="Wine Inventory" onClose={onClose} actions={actions}>
      <div style={{ maxWidth: 700, margin: "0 auto" }}>
        <div style={{ marginBottom: 16 }}>
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search wine, producer, vintage..."
            style={{ ...baseInp, width: "100%", fontSize: 16, boxSizing: "border-box" }}
          />
        </div>

        {filtered.length === 0 && (
          <div style={{ fontFamily: FONT, fontSize: 11, color: tokens.neutral[400], padding: "40px 0", textAlign: "center" }}>No wines found</div>
        )}
        {filtered.map((w) => {
          const myCount = myCounts[w.id] || 0;
          const fullBtls = Math.floor(myCount);
          const isPartial = myCount % 1 >= 0.5;
          const rawVin = String(w.vintage || "").trim();
          const vin = rawVin.match(/^\d{4}$/) ? `'${rawVin.slice(2)}` : rawVin;
          const rc = w.country || inferCountryFromRegion(w.region);
          const sub = [stripCountryFromRegion(w.region, rc), COUNTRY_NAMES[rc] || rc].filter(Boolean).join(", ");
          const othersRaw = Object.entries(allDevices).filter(([did]) => did !== myId.current).reduce((s, [, dev]) => s + (dev.counts?.[w.id] || 0), 0);
          const othersLabel = othersRaw > 0 ? (othersRaw % 1 >= 0.5 ? `${Math.floor(othersRaw)}½` : String(othersRaw)) : null;
          return (
            <div key={w.id} style={{
              display: "flex", alignItems: "center", gap: isMobile ? 8 : 12,
              padding: "10px 4px", borderBottom: `1px solid ${tokens.neutral[100]}`,
              flexWrap: isMobile ? "wrap" : "nowrap",
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: tokens.neutral[900] }}>
                  {w.producer} <span style={{ fontWeight: 400 }}>{w.name}</span>
                  <span style={{ color: tokens.neutral[400], marginLeft: 6, fontSize: 11 }}>{vin}</span>
                </div>
                {sub && <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.neutral[400], marginTop: 2 }}>{sub}</div>}
              </div>
              {othersLabel && (
                <span style={{
                  fontFamily: FONT, fontSize: 9, color: tokens.neutral[500], background: tokens.neutral[100],
                  border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, padding: "2px 7px", flexShrink: 0,
                }}>{othersLabel}</span>
              )}
              <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                <button onClick={() => dec(w.id)} style={{
                  fontFamily: FONT, fontSize: 18, width: 38, height: 38,
                  border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, borderRight: "none",
                  cursor: "pointer", background: tokens.neutral[0], color: tokens.neutral[500],
                  display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
                }}>-</button>
                <input
                  type="number"
                  min={0}
                  value={fullBtls === 0 ? "" : fullBtls}
                  onChange={(e) => setCount(w.id, e.target.value)}
                  placeholder="0"
                  style={{
                    fontFamily: FONT, fontSize: 14, width: 46, height: 38,
                    border: `1px solid ${tokens.neutral[200]}`, outline: "none", textAlign: "center",
                    color: myCount > 0 ? tokens.neutral[900] : tokens.neutral[300], fontWeight: myCount > 0 ? 700 : 400,
                    boxSizing: "border-box", WebkitAppearance: "none", MozAppearance: "textfield",
                  }}
                />
                <button onClick={() => inc(w.id)} style={{
                  fontFamily: FONT, fontSize: 18, width: 38, height: 38,
                  border: `1px solid ${tokens.neutral[300]}`, borderRight: "none",
                  cursor: "pointer", background: tokens.neutral[50], color: tokens.neutral[500],
                  display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
                }}>+</button>
                <button onClick={() => togglePartial(w.id)} style={{
                  fontFamily: FONT, fontSize: 10, width: 32, height: 38,
                  border: isPartial ? `1px solid ${tokens.neutral[400]}` : `1px solid ${tokens.neutral[200]}`,
                  borderRadius: 0, borderLeft: "none",
                  cursor: "pointer", background: isPartial ? tokens.neutral[100] : tokens.neutral[50],
                  color: isPartial ? tokens.neutral[700] : tokens.neutral[300],
                  display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
                }}>½</button>
              </div>
            </div>
          );
        })}

        {wines.length > 0 && (
          <div style={{ padding: "16px 4px 0", borderTop: `1px solid ${tokens.neutral[200]}`, marginTop: 8 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
              {deviceTotals.map((d) => (
                <span key={d.id} style={{
                  fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "3px 10px",
                  borderRadius: 0, border: d.isMe ? `1px solid ${tokens.neutral[300]}` : `1px solid ${tokens.neutral[200]}`,
                  background: d.isMe ? tokens.neutral[50] : tokens.neutral[50],
                  color: d.isMe ? tokens.neutral[700] : tokens.neutral[500],
                }}>
                  {d.label}{d.isMe ? " (you)" : ""}: {fmtCount(d.total)}
                </span>
              ))}
              <span style={{
                fontFamily: FONT, fontSize: 10, fontWeight: 700, color: tokens.neutral[900],
                padding: "3px 10px", borderRadius: 0, border: `1px solid ${tokens.neutral[900]}`, background: tokens.neutral[0],
              }}>TOTAL: {fmtCount(grandTotal)}</span>
            </div>
          </div>
        )}
      </div>
    </FullModal>
  );
}
