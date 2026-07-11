import { useEffect, useState } from "react";
import { tokens } from "../../styles/tokens.js";
import FloorMap, { restrictionCode } from "../floor/FloorMap.jsx";
import {
  getActiveDiningMap, getTerraceMap, terraceOccupancy, floorStatusOf, boardIdsOf,
  resolveReservationTable,
} from "../../utils/floorMaps.js";
import { visitStateOf } from "../../utils/terraceFlow.js";
import { getVisibleCoursesForTable, getCourseProgressState } from "../../utils/courseProgress.js";
import {
  floorPositionKey, seatFloorPosition, restrictionsAtFloorPositions,
} from "../../utils/tableHelpers.js";

const FONT = tokens.font;

// Kitchen floor view — STRICTLY read-only. The kitchen sees the room the way
// FOH sees it: terrace (default tab) + the active dining layout, ×pax,
// course progress C4/12 (the kitchen's core info — FOH drops it, we keep
// it), chair marks with restrictions in the app red,
// and the FOH SET markers (service mode with no tap handlers — the kitchen
// watches hands-calls, never sets them). NO guest names, same as
// the FOH floor. The
// data is the same App state the kitchen board renders from (PowerSync sync
// stream / realtime safety net) — no new subscription.
export default function KitchenFloorView({
  // "terrace" | "dining": the header's flattened TICKETS/TERRACE/DINING ROOM
  // switch owns the map (11.07) — the inner tab row disappears. Unset →
  // legacy self-owned tabs.
  mapKind = null,
  floorMaps, floorStatus, reservations = [], tables = [], menuCourses = [],
  profiles = [], assignments = {}, isMobile,
}) {
  const terraceMap = getTerraceMap(floorMaps);
  const diningMap = getActiveDiningMap(floorMaps);
  const mapTabs = [terraceMap, diningMap].filter(Boolean);
  const [tabId, setTabId] = useState(terraceMap?.id || diningMap?.id || null); // default TERRACE
  const [popover, setPopover] = useState(null); // { label, name, rows: [{seat, code, note}] }

  const forcedMap = mapKind === "terrace" ? terraceMap : mapKind === "dining" ? diningMap : null;
  const map = forcedMap || mapTabs.find((m) => m.id === tabId) || mapTabs[0];
  useEffect(() => {
    if (mapKind) setPopover(null); // leaving the map drops its open popover
  }, [mapKind]);
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

  // Chair outlines carry the seat's gender (Mr blue / Mrs pink) so the
  // kitchen can plate for the right guest.
  const seatGendersOf = (bt, positionKey) => {
    const out = {};
    for (const s of bt?.seats || []) {
      if (s.gender === "Mr" || s.gender === "Mrs") out[seatFloorPosition(s, positionKey)] = s.gender;
    }
    return Object.keys(out).length ? out : null;
  };

  const seatLabelsOf = (bt, positionKey) => Object.fromEntries(
    (bt?.seats || []).map((seat) => [seatFloorPosition(seat, positionKey), Number(seat.id)])
  );

  const tableState = {};
  const restrictionsByLabel = {};
  const seatGendersByLabel = {};
  const seatLabelsByLabel = {};
  const popoverData = {};

  if (map.kind === "terrace") {
    const occ = terraceOccupancy(reservations);
    for (const t of map.tables) {
      const r = occ[t.label];
      const strip = floorStatusOf(floorStatus, map.id, t.label);
      const positionKey = floorPositionKey(map.id, t.label);
      if (r) {
        // The party's LIVE restrictions (incl. seat assignments made in
        // service/kitchen) live on its board table — the reservation blob is
        // only the fallback, so terrace chairs mark by position exactly like
        // the dining tab's.
        let bt = tables.find((x) => x.id === Number(r.table_id)) || null;
        if (bt?.tableGroup?.length) bt = tables.find((x) => x.id === Math.min(...bt.tableGroup)) || bt;
        const restrSource = bt?.restrictions?.length ? bt.restrictions : (r.data?.restrictions || []);
        tableState[t.label] = {
          status: "occupied",
          // a terrace party's identity is its DINING table (per Djan):
          // terrace B occupied by T8's party reads "B / T8" — no pax/course
          name: resolveReservationTable(diningMap, r.table_id).table?.label || `T${r.table_id}`,
          strip,
        };
        const restr = restrictionsAtFloorPositions(bt?.seats || [], restrSource, positionKey)
          .filter((x) => x && x.note);
        if (restr.length) restrictionsByLabel[t.label] = restr;
        const genders = seatGendersOf(bt, positionKey);
        if (genders) seatGendersByLabel[t.label] = genders;
        if (bt) seatLabelsByLabel[t.label] = seatLabelsOf(bt, positionKey);
        popoverData[t.label] = { rows: restrRows(restrSource) };
      } else {
        tableState[t.label] = { status: "free", strip };
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
      const strip = floorStatusOf(floorStatus, map.id, t.label);
      const positionKey = floorPositionKey(map.id, t.label);
      const genders = seatGendersOf(bt, positionKey);
      if (genders) seatGendersByLabel[t.label] = genders;
      if (bt) seatLabelsByLabel[t.label] = seatLabelsOf(bt, positionKey);
      if (bt?.active) {
        tableState[t.label] = {
          status: "occupied",
          pax: bt.guests || undefined,
          sub: progressOf(bt),
          strip,
        };
      } else if (arriving) {
        tableState[t.label] = {
          status: "arriving",
          pax: arriving.data?.guests || undefined,
          badge: { text: "ARRIVING · KV" },
          strip,
        };
      } else {
        tableState[t.label] = { status: "free", strip };
      }
      const restr = restrictionsAtFloorPositions(bt?.seats || [], bt?.restrictions || [], positionKey)
        .filter((x) => x && x.note);
      if (restr.length) restrictionsByLabel[t.label] = restr;
      if (bt?.active || arriving) {
        popoverData[t.label] = {
          rows: restrRows(bt?.active ? bt.restrictions : arriving?.data?.restrictions),
        };
      }
    }
  }

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: isMobile ? "0 10px" : 0 }}>
      {/* map tabs — only when this view still owns the map choice (legacy);
          with mapKind the header's switch owns it and the row is dead space */}
      {!mapKind && (
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
      )}

      {/* service mode with no tap handlers beyond the popover: the SET
          markers render read-only — the kitchen never writes them */}
      <FloorMap
        map={map}
        mode="service"
        tableState={tableState}
        restrictionsByLabel={restrictionsByLabel}
        seatGendersByLabel={seatGendersByLabel}
        seatLabelsByLabel={seatLabelsByLabel}
        seatPositionLabels
        height={isMobile ? 300 : 440}
        onTableTap={(t) => setPopover(popoverData[t.label] ? { label: t.label, ...popoverData[t.label] } : null)}
      />

      {/* read-only restriction popover: seat → restriction → note */}
      {popover && (
        <div style={{ border: `1px solid ${tokens.ink[4]}`, borderTop: "none", background: tokens.neutral[0], padding: "10px 14px" }}>
          <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: tokens.ink[3], marginBottom: 6 }}>
            [{popover.label}]
          </div>
          {popover.rows.length === 0 && (
            <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3] }}>no restrictions</div>
          )}
          {popover.rows.map((r, i) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "3px 0", borderBottom: `1px solid ${tokens.ink[5]}` }}>
              <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: r.seat ? tokens.signal.alert : tokens.ink[1], minWidth: 44 }}>
                {r.seat ? `SEAT ${r.seat}` : "TABLE"}
              </span>
              <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, color: tokens.signal.alert, minWidth: 34 }}>{r.code}</span>
              <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[2] }}>{r.note}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
