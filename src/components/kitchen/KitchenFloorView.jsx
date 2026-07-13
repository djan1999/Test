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

// Kitchen floor view — the kitchen sees the room the way FOH sees it: terrace
// (default tab) + the active dining layout, ×pax, course progress C4/12 (the
// kitchen's core info — FOH drops it, we keep it), chair marks with
// restrictions in the app red, and the FOH SET markers. NO guest names, same
// as the FOH floor. The data is the same App state the kitchen board renders
// from (PowerSync sync stream / realtime safety net) — no new subscription.
//
// The TERRACE tab is interactive when the caller passes the service handlers
// (per Djan — a party can walk in and the kitchen, whose local-first writes
// work with the Wi-Fi down, must be able to seat/assign it, change its table,
// set it to the pass, swap seats and move restrictions — exactly like service
// mode). The dining tab stays read-only: a tap opens the restriction popover.
// With no handlers passed the whole view falls back to read-only.
export default function KitchenFloorView({
  // "terrace" | "dining": the header's flattened TICKETS/TERRACE/DINING ROOM
  // switch owns the map (11.07) — the inner tab row disappears. Unset →
  // legacy self-owned tabs.
  mapKind = null,
  floorMaps, floorStatus, reservations = [], tables = [], menuCourses = [],
  profiles = [], assignments = {}, isMobile,
  // Service actions (optional). When present the terrace tab acts like the
  // FOH floor; absent → the view is strictly read-only (its original mode).
  onAssign,             // (reservation, terraceLabel) — seat/assign or CHANGE
  onSwapSeats,          // (boardId, fromNo, toNo, positionKey) — swap chairs
  onCycleStatus,        // (mapId, label) — toggle the SET strip
  onSendSetToKitchen,   // (boardIds[]) — raise the "SET FOR …" kitchen banner
}) {
  const terraceMap = getTerraceMap(floorMaps);
  const diningMap = getActiveDiningMap(floorMaps);
  const mapTabs = [terraceMap, diningMap].filter(Boolean);
  const [tabId, setTabId] = useState(terraceMap?.id || diningMap?.id || null); // default TERRACE
  const [popover, setPopover] = useState(null); // dining read-only: { label, rows }
  const [sheetLabel, setSheetLabel] = useState(null); // terrace action sheet
  const [movingParty, setMovingParty] = useState(null); // CHANGE TABLE: party being re-seated
  const [toast, setToast] = useState(null);

  const forcedMap = mapKind === "terrace" ? terraceMap : mapKind === "dining" ? diningMap : null;
  const map = forcedMap || mapTabs.find((m) => m.id === tabId) || mapTabs[0];
  useEffect(() => {
    // leaving the map drops any open popover / sheet / pending CHANGE TABLE
    if (mapKind) { setPopover(null); setSheetLabel(null); setMovingParty(null); }
  }, [mapKind]);
  if (!map) return null;

  // The terrace tab is only interactive when the caller wired the handlers.
  const interactive = !!(onAssign || onSwapSeats || onCycleStatus);
  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); };
  const switchTab = (id) => { setTabId(id); setPopover(null); setSheetLabel(null); setMovingParty(null); };

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

  // A terrace party's live seats/restrictions live on its BOARD table (a merge
  // resolves to the group's primary); the reservation blob is only the fallback.
  const terracePartyBoardTable = (r) => {
    if (!r) return null;
    let bt = tables.find((x) => x.id === Number(r.table_id)) || null;
    if (bt?.tableGroup?.length) bt = tables.find((x) => x.id === Math.min(...bt.tableGroup)) || bt;
    return bt;
  };
  const diningLabelOf = (r) =>
    resolveReservationTable(diningMap, r.table_id).table?.label || `T${r.table_id}`;
  const primaryBoardIdOf = (r) => {
    const tid = Number(r.table_id);
    const bt = tables.find((x) => x.id === tid);
    return bt?.tableGroup?.length ? Math.min(...bt.tableGroup.map(Number)) : tid;
  };

  // Waiting parties eligible for a terrace assignment: anyone not yet on the
  // terrace and not cleared off the board. Same rule the FOH floor uses.
  const bookedParties = reservations.filter((r) =>
    visitStateOf(r.data) === "booked" && !r.data?.clearedFromBoard);

  const occ = map.kind === "terrace" ? terraceOccupancy(reservations) : {};

  const tableState = {};
  const restrictionsByLabel = {};
  const seatGendersByLabel = {};
  const seatLabelsByLabel = {};
  const popoverData = {};

  if (map.kind === "terrace") {
    for (const t of map.tables) {
      const r = occ[t.label];
      const strip = floorStatusOf(floorStatus, map.id, t.label);
      const positionKey = floorPositionKey(map.id, t.label);
      if (r) {
        // The party's LIVE restrictions (incl. seat assignments made in
        // service/kitchen) live on its board table — the reservation blob is
        // only the fallback, so terrace chairs mark by position exactly like
        // the dining tab's.
        const bt = terracePartyBoardTable(r);
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

  const terraceInteractive = interactive && map.kind === "terrace";

  // Drag a chair onto another chair of the same terrace party to swap those
  // two positions' guests (restrictions ride the guest — same as service).
  const swapSeatPositions = (label, aNo, bNo) => {
    if (!onSwapSeats) return;
    const bt = terracePartyBoardTable(occ[label]);
    if (!bt) return;
    const positionKey = floorPositionKey(map.id, label);
    onSwapSeats(bt.id, Number(aNo), Number(bNo), positionKey);
    flash(`${label} · P${aNo} ⇄ P${bNo}`);
  };

  // Terrace parties whose label vanished in a map edit — no tile means no
  // sheet, so this banner keeps CHANGE TABLE one tap away.
  const mapLabels = new Set((map.tables || []).map((t) => t.label));
  const stranded = terraceInteractive
    ? reservations.filter((r) =>
        visitStateOf(r.data) === "terrace" && !mapLabels.has(r.data?.terrace_table))
    : [];

  const actionBtn = (primary) => ({
    fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
    padding: "10px 14px", border: `1px solid ${primary ? tokens.ink[0] : tokens.ink[4]}`,
    background: primary ? tokens.ink[0] : tokens.neutral[0],
    color: primary ? tokens.neutral[0] : tokens.ink[2],
    borderRadius: 0, cursor: "pointer", touchAction: "manipulation", fontWeight: primary ? 600 : 400,
  });

  const handleTerraceTap = (t) => {
    // CHANGE TABLE in flight: the next FREE terrace tap re-seats the party.
    if (movingParty) {
      if (tableState[t.label]?.status === "occupied") { flash("Table occupied"); return; }
      onAssign?.(movingParty, t.label);
      flash(`${t.label} → ${(movingParty.data?.resName || "—").toUpperCase()}`);
      setMovingParty(null);
      return;
    }
    setSheetLabel(t.label);
  };

  const sheetParty = sheetLabel ? occ[sheetLabel] : null;
  const sheetStrip = sheetLabel ? floorStatusOf(floorStatus, map.id, sheetLabel) : null;

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: isMobile ? "0 10px" : 0 }}>
      {/* map tabs — only when this view still owns the map choice (legacy);
          with mapKind the header's switch owns it and the row is dead space */}
      {!mapKind && (
        <div style={{ display: "flex", gap: 0, marginBottom: 10 }}>
          {mapTabs.map((m) => {
            const on = m.id === map.id;
            return (
              <button key={m.id} onClick={() => switchTab(m.id)} style={{
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

      {/* live action toast */}
      {toast && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.green.text, letterSpacing: "0.08em", fontWeight: 700, marginRight: 10 }}>{toast}</span>
        </div>
      )}

      {/* CHANGE TABLE banner — armed until a free terrace table is tapped */}
      {terraceInteractive && movingParty && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          border: `1px solid ${tokens.ink[0]}`, background: tokens.neutral[0],
          padding: "8px 12px", marginBottom: 6,
        }}>
          <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700, color: tokens.ink[0] }}>
            TAP A FREE TABLE FOR {(movingParty.data?.resName || "—").toUpperCase()} ×{movingParty.data?.guests || "?"}
          </span>
          <span style={{ flex: 1 }} />
          <button style={actionBtn(false)} onClick={() => setMovingParty(null)}>CANCEL</button>
        </div>
      )}

      {/* stranded terrace parties — the label vanished in a map edit */}
      {stranded.map((r) => (
        <div key={r.id} style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          padding: "8px 12px", border: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[0], marginBottom: 6,
        }}>
          <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: tokens.ink[0] }}>
            {r.data?.resName || "—"} {r.data?.guests ? `×${r.data.guests}` : ""}
          </span>
          <span style={{ flex: 1 }} />
          <button style={actionBtn(false)} onClick={() => setMovingParty(r)}>CHANGE TABLE</button>
        </div>
      ))}

      {/* service mode: SET markers render; the kitchen now also drives the
          terrace taps (assign / change / set / swap) when handlers are wired */}
      <FloorMap
        map={map}
        mode="service"
        tableState={tableState}
        restrictionsByLabel={restrictionsByLabel}
        seatGendersByLabel={seatGendersByLabel}
        seatLabelsByLabel={seatLabelsByLabel}
        seatPositionLabels
        onSeatSwap={terraceInteractive && onSwapSeats ? swapSeatPositions : undefined}
        height={isMobile ? 300 : 440}
        onTableTap={(t) => {
          if (terraceInteractive) { handleTerraceTap(t); return; }
          // read-only: dining tab, or terrace with no handlers wired
          setPopover(popoverData[t.label] ? { label: t.label, ...popoverData[t.label] } : null);
        }}
      />

      {/* read-only restriction popover: seat → restriction → note (dining tab
          and the read-only fallback) */}
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

      {/* terrace action sheet — fixed bottom, thumb-first (interactive only) */}
      {terraceInteractive && sheetLabel && (
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
                {sheetParty ? diningLabelOf(sheetParty) : "free"}
              </span>
              <span style={{ flex: 1 }} />
              <button onClick={() => setSheetLabel(null)}
                style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, border: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[0], color: tokens.ink[2], width: 32, height: 32, cursor: "pointer", borderRadius: 0 }}>
                ✕
              </button>
            </div>

            {sheetParty ? (
              <div>
                {/* the kitchen's read-only restriction crib for this party */}
                {(() => {
                  const rows = popoverData[sheetLabel]?.rows || [];
                  if (rows.length === 0) return null;
                  return (
                    <div style={{ marginBottom: 10 }}>
                      {rows.map((r, i) => (
                        <div key={i} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "3px 0", borderBottom: `1px solid ${tokens.ink[5]}` }}>
                          <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: r.seat ? tokens.signal.alert : tokens.ink[1], minWidth: 44 }}>
                            {r.seat ? `SEAT ${r.seat}` : "TABLE"}
                          </span>
                          <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, color: tokens.signal.alert, minWidth: 34 }}>{r.code}</span>
                          <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[2] }}>{r.note}</span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {onAssign && (
                    <button style={actionBtn(false)} onClick={() => { setMovingParty(sheetParty); setSheetLabel(null); }}>
                      CHANGE TABLE
                    </button>
                  )}
                  {onCycleStatus && (sheetStrip === "SET" ? (
                    <button style={actionBtn(false)} onClick={() => { onCycleStatus(map.id, sheetLabel); setSheetLabel(null); }}>
                      UNSET
                    </button>
                  ) : (
                    <button style={actionBtn(true)} onClick={() => {
                      onSendSetToKitchen?.([primaryBoardIdOf(sheetParty)]);
                      onCycleStatus(map.id, sheetLabel);
                      flash(`${sheetLabel} SET → KITCHEN ✓`);
                      setSheetLabel(null);
                    }}>
                      SET → KITCHEN
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              // free terrace table → assign a waiting party
              <div>
                <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: "0.12em", color: tokens.ink[3], textTransform: "uppercase", margin: "2px 0 6px" }}>
                  ASSIGN PARTY
                </div>
                {sheetStrip === "SET" && onCycleStatus && (
                  <div style={{ marginBottom: 10 }}>
                    <button style={actionBtn(false)} onClick={() => { onCycleStatus(map.id, sheetLabel); setSheetLabel(null); }}>
                      UNSET
                    </button>
                  </div>
                )}
                {bookedParties.length === 0 && (
                  <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3] }}>no waiting parties</div>
                )}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {bookedParties.map((r) => (
                    <button key={r.id} style={actionBtn(false)}
                      onClick={() => {
                        onAssign?.(r, sheetLabel);
                        flash(`${sheetLabel} → ${(r.data?.resName || "—").toUpperCase()} ×${r.data?.guests || "?"}`);
                        setSheetLabel(null);
                      }}>
                      {r.data?.resName || "—"} ×{r.data?.guests || "?"}{r.data?.resTime ? ` · ${r.data.resTime}` : ""}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
