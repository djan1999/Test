import { useEffect, useRef, useState } from "react";
import { TABLES, supabase } from "../../lib/supabaseClient.js";
import { COUNTRY_NAMES } from "../../constants/countries.js";
import { tokens } from "../../styles/tokens.js";
import { baseInput } from "../../styles/mixins.js";
import FullModal from "../ui/FullModal.jsx";

const FONT = tokens.font;
const baseInp = { ...baseInput };
const INV_LS_KEY = "milka-inventory-counts";
const INV_SETTINGS_ID = "inventory";

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
  const myId = useRef(getDeviceId());
  const stRef = useRef(null);
  const saveTimer = useRef(null);
  const [syncSt, setSyncSt] = useState("loading");
  const [search, setSearch] = useState("");

  const [fullState, setFullState] = useState(() => {
    let myCountsLS = {};
    try { myCountsLS = JSON.parse(localStorage.getItem(INV_LS_KEY) || "{}"); } catch {}
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

  const flushToSupabase = async (state) => {
    if (!supabase || !navigator.onLine) { setSyncSt("offline"); return; }
    const { error } = await supabase.from(TABLES.SERVICE_SETTINGS).upsert(
      { id: INV_SETTINGS_ID, state, updated_at: new Date().toISOString() },
      { onConflict: "id" },
    );
    setSyncSt(error ? "error" : "synced");
  };

  const applyUpdate = (updater) => {
    setFullState((prev) => {
      const prevMy = prev.d[myId.current]?.counts || {};
      const nextMy = typeof updater === "function" ? updater(prevMy) : updater;
      try { localStorage.setItem(INV_LS_KEY, JSON.stringify(nextMy)); } catch {}
      const next = { d: { ...prev.d, [myId.current]: { ...prev.d[myId.current], counts: nextMy } } };
      stRef.current = next;
      if (supabase) {
        clearTimeout(saveTimer.current);
        setSyncSt((st) => (st === "offline" ? "offline" : "saving"));
        saveTimer.current = setTimeout(() => flushToSupabase(stRef.current), 1500);
      }
      return next;
    });
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

  useEffect(() => {
    if (!supabase) { setSyncSt(navigator.onLine ? "synced" : "offline"); return; }
    supabase.from(TABLES.SERVICE_SETTINGS).select("state").eq("id", INV_SETTINGS_ID).single()
      .then(({ data, error }) => {
        const remoteD = (!error && data?.state?.d) ? data.state.d : {};
        const myRemote = remoteD[myId.current];
        const myLabel = myRemote?.label || `Device ${Object.keys(remoteD).length + 1}`;
        const myLocalCounts = (() => { try { return JSON.parse(localStorage.getItem(INV_LS_KEY) || "{}"); } catch { return {}; } })();
        const baseCounts = myRemote?.counts || {};
        const mergedMyCounts = { ...baseCounts };
        Object.entries(myLocalCounts).forEach(([id, n]) => { if (n > 0) mergedMyCounts[id] = n; });
        const fullD = { ...remoteD, [myId.current]: { label: myLabel, counts: mergedMyCounts } };
        const next = { d: fullD };
        stRef.current = next;
        setFullState(next);
        try { localStorage.setItem(INV_LS_KEY, JSON.stringify(mergedMyCounts)); } catch {}
        if (!myRemote?.label || Object.keys(myLocalCounts).length > 0) flushToSupabase(next);
        setSyncSt(navigator.onLine ? "synced" : "offline");
      });
  }, []);

  useEffect(() => {
    const goOnline = () => {
      setSyncSt("saving");
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => flushToSupabase(stRef.current), 500);
    };
    const goOffline = () => { clearTimeout(saveTimer.current); setSyncSt("offline"); };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  useEffect(() => {
    if (!supabase) return;
    const ch = supabase.channel("milka-inventory")
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: TABLES.SERVICE_SETTINGS,
        filter: `id=eq.${INV_SETTINGS_ID}`,
      }, (payload) => {
        const remoteD = payload.new?.state?.d;
        if (!remoteD) return;
        setFullState((prev) => ({ d: { ...remoteD, [myId.current]: prev.d[myId.current] } }));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? wines.filter((w) =>
        (w.name || "").toLowerCase().includes(q)
        || (w.producer || "").toLowerCase().includes(q)
        || (w.vintage || "").toLowerCase().includes(q))
    : wines;

  const syncChip = (() => {
    if (syncSt === "loading") return { label: "LOADING...", color: "#aaa", bg: "#f8f8f8", border: "#e8e8e8" };
    if (syncSt === "saving") return { label: "SAVING...", color: "#a07020", bg: "#fffbe8", border: "#e8d888" };
    if (syncSt === "offline") return { label: "OFFLINE · SAVED", color: "#c06020", bg: "#fff4ee", border: "#e8c8a8" };
    if (syncSt === "error") return { label: "SYNC ERROR", color: "#c02020", bg: "#fff0f0", border: "#e8a8a8" };
    return { label: "SYNCED", color: "#2f7a45", bg: "#eef8f1", border: "#8fc39f" };
  })();

  const handlePrint = () => {
    const byCountry = {};
    wines.forEach((w) => {
      const country = COUNTRY_NAMES[w.country] || w.country || "Other";
      if (!byCountry[country]) byCountry[country] = [];
      byCountry[country].push(w);
    });
    const dateStr = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const deviceSummary = deviceTotals.map((d) => `${d.label}: ${fmtCount(d.total)}`).join(" · ");
    const rows = (ws) => ws.map((w) => {
      const n = displayCounts[w.id] || 0;
      const rawVin = String(w.vintage || "").trim();
      const vin = rawVin.match(/^\d{4}$/) ? `'${rawVin.slice(2)}` : rawVin;
      const sub = [w.region, COUNTRY_NAMES[w.country] || w.country].filter(Boolean).join(", ");
      return `<tr>
        <td style="padding:5px 4px;border-bottom:1px solid #f0f0f0;vertical-align:top;">
          <div style="font-weight:600;">${w.producer} ${w.name} <span style="font-weight:400;color:#888;">${vin}</span></div>
          ${sub ? `<div style="font-size:9px;color:#aaa;margin-top:1px;">${sub}</div>` : ""}
        </td>
        <td style="padding:5px 4px;border-bottom:1px solid #f0f0f0;text-align:right;font-size:15px;font-weight:700;color:${n > 0 ? "#1a1a1a" : "#ddd"};white-space:nowrap;width:48px;">${fmtCount(n)}</td>
      </tr>`;
    }).join("");
    const sections = Object.entries(byCountry).sort(([a], [b]) => a.localeCompare(b)).map(([country, ws]) => `
      <div style="margin-bottom:20px;">
        <div style="font-size:9px;letter-spacing:3px;color:#888;text-transform:uppercase;border-bottom:1px solid #e0e0e0;padding-bottom:4px;margin-bottom:6px;">${country}</div>
        <table style="width:100%;border-collapse:collapse;">${rows(ws)}</table>
      </div>`).join("");
    const html = `<html><head><title>Wine Inventory · ${dateStr}</title>
      <style>body{font-family:'Roboto Mono',monospace;font-size:11px;padding:24px;color:#1a1a1a;}@media print{body{padding:12px;}}</style>
      </head><body>
        <div style="font-size:14px;font-weight:600;letter-spacing:4px;margin-bottom:4px;">WINE INVENTORY</div>
        <div style="font-size:9px;letter-spacing:2px;color:#888;margin-bottom:4px;">${dateStr}</div>
        ${deviceTotals.length > 1 ? `<div style="font-size:9px;color:#888;margin-bottom:20px;">${deviceSummary} · TOTAL: ${fmtCount(grandTotal)}</div>` : `<div style="font-size:9px;color:#888;margin-bottom:20px;">Total: ${fmtCount(grandTotal)} bottles</div>`}
        ${sections}
        <div style="font-size:11px;font-weight:700;text-align:right;padding-top:12px;border-top:1px solid #e0e0e0;">TOTAL: ${fmtCount(grandTotal)} bottles</div>
      </body></html>`;
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 500);
  };

  const actions = (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{
        fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, padding: "4px 10px",
        border: `1px solid ${syncChip.border}`, borderRadius: 999,
        background: syncChip.bg, color: syncChip.color, whiteSpace: "nowrap",
      }}>{syncChip.label}</span>
      <button onClick={clearAll} style={{
        fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 12px",
        border: "1px solid #e8e8e8", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#888",
      }}>CLEAR ALL</button>
      <button onClick={handlePrint} style={{
        fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 14px",
        border: "1px solid #3060a0", borderRadius: 2, cursor: "pointer", background: "#f0f6ff", color: "#3060a0",
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
          <div style={{ fontFamily: FONT, fontSize: 11, color: "#bbb", padding: "40px 0", textAlign: "center" }}>No wines found</div>
        )}
        {filtered.map((w) => {
          const myCount = myCounts[w.id] || 0;
          const fullBtls = Math.floor(myCount);
          const isPartial = myCount % 1 >= 0.5;
          const rawVin = String(w.vintage || "").trim();
          const vin = rawVin.match(/^\d{4}$/) ? `'${rawVin.slice(2)}` : rawVin;
          const sub = [w.region, COUNTRY_NAMES[w.country] || w.country].filter(Boolean).join(", ");
          const othersRaw = Object.entries(allDevices).filter(([did]) => did !== myId.current).reduce((s, [, dev]) => s + (dev.counts?.[w.id] || 0), 0);
          const othersLabel = othersRaw > 0 ? (othersRaw % 1 >= 0.5 ? `${Math.floor(othersRaw)}½` : String(othersRaw)) : null;
          return (
            <div key={w.id} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "10px 4px", borderBottom: "1px solid #f5f5f5",
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: "#1a1a1a" }}>
                  {w.producer} <span style={{ fontWeight: 400 }}>{w.name}</span>
                  <span style={{ color: "#aaa", marginLeft: 6, fontSize: 11 }}>{vin}</span>
                </div>
                {sub && <div style={{ fontFamily: FONT, fontSize: 9, color: "#bbb", marginTop: 2 }}>{sub}</div>}
              </div>
              {othersLabel && (
                <span style={{
                  fontFamily: FONT, fontSize: 9, color: "#4a80c0", background: "#eaf0fc",
                  border: "1px solid #c8d8f0", borderRadius: 3, padding: "2px 7px", flexShrink: 0,
                }}>{othersLabel}</span>
              )}
              <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                <button onClick={() => dec(w.id)} style={{
                  fontFamily: FONT, fontSize: 18, width: 38, height: 38,
                  border: "1px solid #e8e8e8", borderRadius: "2px 0 0 2px", borderRight: "none",
                  cursor: "pointer", background: "#fff", color: "#888",
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
                    border: "1px solid #e8e8e8", outline: "none", textAlign: "center",
                    color: myCount > 0 ? "#1a1a1a" : "#ccc", fontWeight: myCount > 0 ? 700 : 400,
                    boxSizing: "border-box", WebkitAppearance: "none", MozAppearance: "textfield",
                  }}
                />
                <button onClick={() => inc(w.id)} style={{
                  fontFamily: FONT, fontSize: 18, width: 38, height: 38,
                  border: "1px solid #3060a0", borderRight: "none",
                  cursor: "pointer", background: "#f0f6ff", color: "#3060a0",
                  display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
                }}>+</button>
                <button onClick={() => togglePartial(w.id)} style={{
                  fontFamily: FONT, fontSize: 10, width: 32, height: 38,
                  border: isPartial ? "1px solid #e07840" : "1px solid #e8e8e8",
                  borderRadius: "0 2px 2px 0", borderLeft: "none",
                  cursor: "pointer", background: isPartial ? "#fff4ee" : "#fafafa",
                  color: isPartial ? "#e07840" : "#ccc",
                  display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
                }}>½</button>
              </div>
            </div>
          );
        })}

        {wines.length > 0 && (
          <div style={{ padding: "16px 4px 0", borderTop: "1px solid #f0f0f0", marginTop: 8 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
              {deviceTotals.map((d) => (
                <span key={d.id} style={{
                  fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "3px 10px",
                  borderRadius: 999, border: d.isMe ? "1px solid #3060a0" : "1px solid #e0e0e0",
                  background: d.isMe ? "#f0f6ff" : "#f8f8f8",
                  color: d.isMe ? "#3060a0" : "#888",
                }}>
                  {d.label}{d.isMe ? " (you)" : ""}: {fmtCount(d.total)}
                </span>
              ))}
              <span style={{
                fontFamily: FONT, fontSize: 10, fontWeight: 700, color: "#1a1a1a",
                padding: "3px 10px", borderRadius: 999, border: "1px solid #1a1a1a", background: "#fff",
              }}>TOTAL: {fmtCount(grandTotal)}</span>
            </div>
          </div>
        )}
      </div>
    </FullModal>
  );
}
