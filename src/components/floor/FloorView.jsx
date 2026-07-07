import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import FloorMap from "./FloorMap.jsx";
import {
  getActiveDiningMap, getTerraceMap, terraceOccupancy, boardIdsOf,
  resolveReservationTable, floorStatusOf, mapTicker,
} from "../../utils/floorMaps.js";
import { visitStateOf, isArmed } from "../../utils/terraceFlow.js";
import { getVisibleCoursesForTable, getCourseProgressState } from "../../utils/courseProgress.js";

const FONT = tokens.font;

// FloorView — the FOH floor surface (serviceView "floor"). One spatial
// projection of the same App state the board renders: map tabs (active dining
// layout + terrace), a ticker strip, and the shared FloorMap renderer in
// `service` mode.
//
// Tap model (per Djan): a DINING table is one big status button — tapping it
// (body or strip) cycles — → DIRTY → SET → —; the board stays the place for
// guest details, no quick-access sheet on the floor. Exceptions that DO open
// a sheet, because they carry an action the tap can't mean: an ARRIVING
// dining table (MARK SEATED) and every terrace table (the old TerracePanel's
// assign / MOVE / CLEAR leg).
//
// STRICTLY service — geometry editing is an admin concern and lives in the
// Floor & Terrace panel (FloorEditor), not here.

const btn = (on) => ({
  fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
  padding: "8px 14px", marginLeft: -1, borderRadius: 0, cursor: "pointer",
  border: `1px solid ${on ? tokens.charcoal.default : tokens.ink[4]}`,
  background: on ? tokens.charcoal.default : tokens.neutral[0],
  color: on ? tokens.neutral[0] : tokens.ink[2], fontWeight: on ? 600 : 400,
  touchAction: "manipulation",
});

const actionBtn = (primary) => ({
  fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
  padding: "10px 14px", border: `1px solid ${primary ? tokens.ink[0] : tokens.ink[4]}`,
  background: primary ? tokens.ink[0] : tokens.neutral[0],
  color: primary ? tokens.neutral[0] : tokens.ink[2],
  borderRadius: 0, cursor: "pointer", touchAction: "manipulation", fontWeight: primary ? 600 : 400,
});

export default function FloorView({
  floorMaps, floorStatus, reservations = [], tables = [],
  menuCourses = [], profiles = [], assignments = {},
  onCycleStatus,
  onAssign, onClear, onMove, onMarkSeated,
  isMobile,
}) {
  const diningMap = getActiveDiningMap(floorMaps);
  const terraceMap = getTerraceMap(floorMaps);
  const tabs = [diningMap, terraceMap].filter(Boolean);

  const [tabId, setTabId] = useState(null);
  const [sheetLabel, setSheetLabel] = useState(null);
  const [toast, setToast] = useState(null);

  const map = tabs.find((m) => m.id === tabId) || tabs[0];
  if (!map) return null;

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };
  const switchTab = (id) => { setTabId(id); setSheetLabel(null); };

  const progressOf = (boardTable) => {
    if (!boardTable) return "";
    const visible = getVisibleCoursesForTable(boardTable, menuCourses, { profiles, assignments });
    const p = getCourseProgressState(boardTable, visible);
    return p.total ? `C${p.firedCount}/${p.total}` : "";
  };

  const diningLabelOf = (r) =>
    resolveReservationTable(diningMap, r.table_id).table?.label || `T${r.table_id}`;

  // A merge's slots point at the group's PRIMARY board table — the one whose
  // card the board shows (same rule as DisplayBoard's isPrimary).
  const boardTableOf = (mapTable) => {
    const id = boardIdsOf(mapTable)[0];
    const bt = tables.find((x) => x.id === id) || null;
    if (bt?.tableGroup?.length) {
      const primary = Math.min(...bt.tableGroup);
      return tables.find((x) => x.id === primary) || bt;
    }
    return bt;
  };

  const arrivingOf = (mapTable) => {
    const ids = boardIdsOf(mapTable);
    return reservations.find((r) =>
      visitStateOf(r.data) === "arriving" && ids.includes(Number(r.table_id))) || null;
  };

  // ── per-table presentation for the visible map ────────────────────────────
  const occ = map.kind === "terrace" ? terraceOccupancy(reservations) : {};
  const tableState = {};
  const restrictionsByLabel = {};
  for (const t of map.tables || []) {
    const strip = floorStatusOf(floorStatus, map.id, t.label);
    if (map.kind === "terrace") {
      const r = occ[t.label];
      const restr = (r?.data?.restrictions || []).filter((x) => x && x.note);
      tableState[t.label] = r
        ? {
            status: "occupied",
            name: r.data?.resName || "—",
            pax: r.data?.guests || undefined,
            sub: r.data?.resTime || "",
            badge: isArmed(r.data) ? { text: "LAST BITE ✓" } : undefined,
            allergy: restr.length > 0,
            strip,
          }
        : { status: "free", strip };
      if (restr.length) restrictionsByLabel[t.label] = restr;
    } else {
      const bt = boardTableOf(t);
      const arriving = arrivingOf(t);
      const restr = (bt?.restrictions || []).filter((x) => x && x.note);
      if (bt?.active) {
        tableState[t.label] = {
          status: "occupied",
          name: bt.resName || "—",
          pax: bt.guests || undefined,
          sub: progressOf(bt),
          allergy: restr.length > 0,
          strip,
        };
      } else if (arriving) {
        tableState[t.label] = {
          status: "arriving",
          name: arriving.data?.resName || "—",
          pax: arriving.data?.guests || undefined,
          badge: { text: "ARRIVING · KV" },
          strip,
        };
      } else if (bt && (bt.resName || bt.resTime)) {
        tableState[t.label] = {
          status: "reserved",
          name: bt.resName || "—",
          pax: bt.guests || undefined,
          sub: bt.resTime || "",
          allergy: restr.length > 0,
          strip,
        };
      } else {
        tableState[t.label] = { status: "free", strip };
      }
      if (restr.length) restrictionsByLabel[t.label] = restr;
    }
  }

  const ticker = mapTicker(Object.values(tableState));

  // Parties the terrace tab must keep reachable even without a table: an
  // armed party whose terrace table was cleared mid-visit has no shape on
  // any map, but its MOVE action must stay one tap away.
  const strandedArmed = map.kind === "terrace"
    ? reservations.filter((r) => isArmed(r.data) && !r.data?.terrace_table)
    : [];

  // Parties eligible for a terrace assignment (TerracePanel's exact rule).
  const seatedIds = new Set(tables.filter((t) => t.active).map((t) => t.id));
  const bookedParties = reservations.filter((r) =>
    visitStateOf(r.data) === "booked" && !r.data?.clearedFromBoard && !seatedIds.has(Number(r.table_id)));

  // ── sheet content for the tapped table ────────────────────────────────────
  const sheetTable = sheetLabel ? (map.tables || []).find((t) => t.label === sheetLabel) : null;
  const sheetParty = sheetTable && map.kind === "terrace" ? occ[sheetLabel] : null;
  const sheetBoard = sheetTable && map.kind !== "terrace" ? boardTableOf(sheetTable) : null;
  const sheetArriving = sheetTable && map.kind !== "terrace" ? arrivingOf(sheetTable) : null;

  const sheetBody = () => {
    if (map.kind === "terrace") {
      if (sheetParty) {
        return (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={actionBtn(true)} onClick={() => { onMove(sheetParty); setSheetLabel(null); }}>
              MOVE TO {diningLabelOf(sheetParty)} →
            </button>
            <button style={actionBtn(false)} onClick={() => { onClear(sheetParty); setSheetLabel(null); }}>
              CLEAR TABLE
            </button>
          </div>
        );
      }
      return (
        <div>
          <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: "0.12em", color: tokens.ink[3], textTransform: "uppercase", margin: "2px 0 6px" }}>
            ASSIGN PARTY
          </div>
          {bookedParties.length === 0 && (
            <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3] }}>no waiting parties</div>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {bookedParties.map((r) => (
              <button key={r.id} style={actionBtn(false)}
                onClick={() => {
                  onAssign(r, sheetLabel);
                  flash(`${sheetLabel} → ${(r.data?.resName || "—").toUpperCase()} ×${r.data?.guests || "?"}`);
                  setSheetLabel(null);
                }}>
                {r.data?.resName || "—"} ×{r.data?.guests || "?"}{r.data?.resTime ? ` · ${r.data.resTime}` : ""}
              </button>
            ))}
          </div>
        </div>
      );
    }
    if (sheetArriving && !sheetBoard?.active) {
      return (
        <button style={actionBtn(true)} onClick={() => { onMarkSeated(sheetArriving); setSheetLabel(null); }}>
          MARK SEATED · {sheetLabel}
        </button>
      );
    }
    return null; // dining taps cycle status instead — no sheet
  };

  return (
    <div style={{ margin: isMobile ? "0 12px 40px" : "0 24px 48px" }}>
      {/* map tabs */}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0, marginBottom: 8 }}>
        {tabs.map((m) => (
          <button key={m.id} style={btn(m.id === map.id)} onClick={() => switchTab(m.id)}>
            {m.name}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {toast && (
          <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.green.text, letterSpacing: "0.08em", fontWeight: 700, marginRight: 10 }}>{toast}</span>
        )}
      </div>

      {/* ticker — the visible map's live counts */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: "2px 14px", alignItems: "baseline",
        borderTop: `1px solid ${tokens.ink[4]}`, borderBottom: `1px solid ${tokens.ink[4]}`,
        padding: "6px 2px", marginBottom: 8,
        fontFamily: FONT, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase",
      }}>
        <span style={{ color: tokens.ink[0], fontWeight: 700 }}>COVERS {ticker.covers}</span>
        <span style={{ color: tokens.ink[2] }}>SEATED {ticker.seated}</span>
        <span style={{ color: tokens.ink[2] }}>RES {ticker.reserved}</span>
        <span style={{ color: tokens.green.text }}>SET {ticker.set}</span>
        <span style={{ color: tokens.signal.warn }}>DIRTY {ticker.dirty}</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: tokens.ink[3], fontSize: 8 }}>TAP TABLE → DIRTY / SET · TERRACE → SHEET</span>
      </div>

      {/* stranded armed parties — no table on any map, action must stay reachable */}
      {strandedArmed.map((r) => (
        <div key={r.id} style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          padding: "8px 12px", border: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[0], marginBottom: 6,
        }}>
          <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: tokens.ink[0] }}>
            {r.data?.resName || "—"} {r.data?.guests ? `×${r.data.guests}` : ""}
          </span>
          <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: "0.1em", background: tokens.ink[0], color: tokens.neutral[0], padding: "2px 6px" }}>LAST BITE ✓</span>
          <span style={{ flex: 1 }} />
          <button style={actionBtn(true)} onClick={() => onMove(r)}>MOVE TO {diningLabelOf(r)} →</button>
        </div>
      ))}

      <FloorMap
        map={map}
        mode="service"
        tableState={tableState}
        restrictionsByLabel={restrictionsByLabel}
        height={isMobile ? 380 : 480}
        onTableTap={(t) => {
          // terrace tables and ARRIVING dining tables carry actions → sheet;
          // every other dining table is one big DIRTY/SET button.
          if (map.kind === "terrace" || tableState[t.label]?.status === "arriving") setSheetLabel(t.label);
          else onCycleStatus(map.id, t.label);
        }}
        onStripTap={(label) => onCycleStatus(map.id, label)}
      />

      {/* table sheet — fixed bottom, thumb-first */}
      {sheetTable && (
        <>
          <div onClick={() => setSheetLabel(null)}
            style={{ position: "fixed", inset: 0, background: tokens.surface.overlay, zIndex: 40 }} />
          <div style={{
            position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 50,
            maxWidth: 760, margin: "0 auto", background: tokens.neutral[0],
            borderTop: `2px solid ${tokens.ink[0]}`, maxHeight: "74vh", overflowY: "auto",
            padding: isMobile ? "12px 12px 24px" : "14px 18px 28px",
          }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
              <span style={{ fontFamily: FONT, fontSize: 20, fontWeight: 700, color: tokens.ink[0], letterSpacing: "-0.02em" }}>
                {sheetLabel}
              </span>
              <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.14em", color: tokens.ink[3], textTransform: "uppercase" }}>
                {map.kind === "terrace"
                  ? (sheetParty ? `${sheetParty.data?.resName || "—"} ×${sheetParty.data?.guests || "?"}${isArmed(sheetParty.data) ? " · LAST BITE ✓" : ""}` : "free")
                  : (tableState[sheetLabel]?.status || "free")}
              </span>
              <span style={{ flex: 1 }} />
              <button onClick={() => setSheetLabel(null)}
                style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, border: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[0], color: tokens.ink[2], width: 32, height: 32, cursor: "pointer", borderRadius: 0 }}>
                ✕
              </button>
            </div>
            {sheetBody()}
          </div>
        </>
      )}
    </div>
  );
}
