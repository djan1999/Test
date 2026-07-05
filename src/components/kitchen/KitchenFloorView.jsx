import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import FloorMap, { restrictionCode } from "../floor/FloorMap.jsx";
import {
  getActiveDiningMap, getTerraceMap, terraceOccupancy, isTerraceDirty, boardIdsOf,
} from "../../utils/floorMaps.js";
import { visitStateOf, isArmed } from "../../utils/terraceFlow.js";
import { getVisibleCoursesForTable, getCourseProgressState } from "../../utils/courseProgress.js";

const FONT = tokens.font;

// Kitchen floor view — STRICTLY read-only. The kitchen sees the room the way
// FOH sees it: terrace (default tab) + the active dining layout, party name,
// pax, course progress C4/12, LAST BITE ✓ arming, and numbered seat dots with
// restrictions filled amber. No status strips, no quick access, no drag; the
// data is the same App state the kitchen board renders from (PowerSync sync
// stream / realtime safety net) — no new subscription.
export default function KitchenFloorView({
  floorMaps, terraceState, reservations = [], tables = [], menuCourses = [],
  profiles = [], assignments = {}, isMobile,
}) {
  const terraceMap = getTerraceMap(floorMaps);
  const diningMap = getActiveDiningMap(floorMaps);
  const mapTabs = [terraceMap, diningMap].filter(Boolean);
  const [tabId, setTabId] = useState(terraceMap?.id || diningMap?.id || null); // default TERRACE
  const [popover, setPopover] = useState(null); // { label, name, rows: [{seat, code, note}] }

  const map = mapTabs.find((m) => m.id === tabId) || mapTabs[0];
  if (!map) return null;

  const progressOf = (boardTable) => {
    if (!boardTable) return "";
    const visible = getVisibleCoursesForTable(boardTable, menuCourses, { profiles, assignments });
    const p = getCourseProgressState(boardTable, visible);
    return p.total ? `C${p.firedCount}/${p.total}` : "";
  };

  const restrRows = (restrictions) =>
    (restrictions || []).filter((r) => r && r.note).map((r) => ({
      seat: r.pos || null, code: restrictionCode(r.note), note: r.note,
    }));

  const tableState = {};
  const restrictionsByLabel = {};
  const popoverData = {};

  if (map.kind === "terrace") {
    const occ = terraceOccupancy(reservations);
    for (const t of map.tables) {
      const r = occ[t.label];
      if (r) {
        const boardTable = tables.find((bt) => bt.id === Number(r.table_id)) || null;
        tableState[t.label] = {
          status: "occupied",
          name: r.data?.resName || "—",
          pax: r.data?.guests || undefined,
          sub: progressOf(boardTable),
          badge: isArmed(r.data) ? { text: "LAST BITE ✓" } : undefined,
        };
        const restr = (r.data?.restrictions || []).filter((x) => x && x.note);
        if (restr.length) restrictionsByLabel[t.label] = restr;
        popoverData[t.label] = { name: r.data?.resName || "—", rows: restrRows(r.data?.restrictions) };
      } else {
        tableState[t.label] = { status: "free", dirty: isTerraceDirty(terraceState, t.label) };
      }
    }
  } else {
    // dining tab — arriving parties visible (kitchen sees who is mid-visit)
    const arrivingByTable = {};
    for (const r of reservations) {
      if (visitStateOf(r.data) !== "arriving") continue;
      arrivingByTable[Number(r.table_id)] = r;
    }
    for (const t of map.tables) {
      const boardId = boardIdsOf(t)[0];
      const bt = tables.find((x) => x.id === boardId) || null;
      const arriving = arrivingByTable[boardId];
      if (bt?.active) {
        tableState[t.label] = {
          status: "occupied",
          name: bt.resName || "—",
          pax: bt.guests || undefined,
          sub: progressOf(bt),
        };
      } else if (arriving) {
        tableState[t.label] = {
          status: "arriving",
          name: arriving.data?.resName || "—",
          pax: arriving.data?.guests || undefined,
          badge: { text: "ARRIVING · KV" },
        };
      } else {
        tableState[t.label] = { status: "free" };
      }
      const restr = (bt?.restrictions || []).filter((x) => x && x.note);
      if (restr.length) restrictionsByLabel[t.label] = restr;
      if (bt?.active || arriving) {
        popoverData[t.label] = {
          name: (bt?.active ? bt.resName : arriving?.data?.resName) || "—",
          rows: restrRows(bt?.active ? bt.restrictions : arriving?.data?.restrictions),
        };
      }
    }
  }

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: isMobile ? "0 10px" : 0 }}>
      {/* map tabs — identical set to FOH, TERRACE first/default */}
      <div style={{ display: "flex", gap: 0, marginBottom: 10 }}>
        {mapTabs.map((m) => {
          const on = m.id === map.id;
          return (
            <button key={m.id} onClick={() => { setTabId(m.id); setPopover(null); }} style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase",
              padding: "8px 16px", marginLeft: -1, borderRadius: 0, cursor: "pointer",
              border: `1px solid ${on ? tokens.charcoal.default : tokens.ink[4]}`,
              background: on ? tokens.charcoal.default : tokens.neutral[0],
              color: on ? tokens.neutral[0] : tokens.ink[2], fontWeight: on ? 600 : 400,
            }}>{m.name}</button>
          );
        })}
      </div>

      <FloorMap
        map={map}
        mode="view"
        tableState={tableState}
        restrictionsByLabel={restrictionsByLabel}
        height={isMobile ? 300 : 440}
        onTableTap={(t) => setPopover(popoverData[t.label] ? { label: t.label, ...popoverData[t.label] } : null)}
      />

      {/* read-only restriction popover: seat → restriction → note */}
      {popover && (
        <div style={{ border: `1px solid ${tokens.ink[4]}`, borderTop: "none", background: tokens.neutral[0], padding: "10px 14px" }}>
          <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: tokens.ink[3], marginBottom: 6 }}>
            [{popover.label}] {popover.name}
          </div>
          {popover.rows.length === 0 && (
            <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3] }}>no restrictions</div>
          )}
          {popover.rows.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "3px 0", borderBottom: `1px solid ${tokens.ink[5]}` }}>
              <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: r.seat ? tokens.signal.warn : tokens.ink[1], minWidth: 44 }}>
                {r.seat ? `SEAT ${r.seat}` : "TABLE"}
              </span>
              <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, color: tokens.signal.warn, minWidth: 34 }}>{r.code}</span>
              <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[2] }}>{r.note}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
