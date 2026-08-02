import { useEffect, useMemo, useRef, useState } from "react";
import { tokens } from "../../styles/tokens.js";
import FloorMap from "../floor/FloorMap.jsx";
import {
  getActiveDiningMap, getTerraceMap, resolveReservationTable, emptySheet,
  floorStatusOf, terraceOccupancy,
} from "../../utils/floorMaps.js";
import {
  floorPositionKey, seatFloorPosition, restrictionsAtFloorPositions,
  reservationTableIds,
} from "../../utils/tableHelpers.js";
import { visitStateOf } from "../../utils/terraceFlow.js";

// KitchenMinimap — a small, always-on room map docked in the board's spare
// bottom-right, so the pass reads WHERE a dish goes (room, table, guests)
// without leaving the ticket wall. It renders through the SAME FloorMap
// component the kitchen floor view uses, so it looks and highlights exactly
// like that view: occupied tables solid, guest positions labelled at every
// chair, restricted chairs in the app red, SET strips. The architecture layer
// (walls/zones/planters) is stripped — a corner crib wants the tables, not
// the blueprint.
//
// It is INTERACTIVE the same way the kitchen floor view is (per Djan, 18.07)
// when the caller wires the service handlers: chairs drag to swap seats
// (terrace = cosmetic chair move, dining = real renumber), and a terrace tile
// tap opens a compact action sheet — CHANGE TABLE / SET → KITCHEN on an
// occupied tile, a party picker on a free one. The picker deliberately shows
// ONLY parties that are physically in the house (seated inside), each as just
// "NAME · TABLE · TIME" — a not-yet-arrived booking can never be seated onto
// the terrace by a mis-tap here. With no handlers the map is read-only.
//
// An OCCUPIED terrace tile takes the party's DINING label as its name: a
// terrace position is only a waiting spot — its identity for the kitchen is
// which table's party is out there. Swipe the map (or tap the header) to
// switch rooms; the last room is remembered across reloads. The swipe only
// arms on the map's dead space — a drag that starts on a chair or a table
// belongs to the seat-swap / tap gesture and must never flip the room
// underneath it mid-drag.

const FONT = tokens.font;
const LS_KEY = "milka_kitchen_minimap_map"; // "dining" | "terrace"

const readStoredKind = () => {
  try { return localStorage.getItem(LS_KEY) === "terrace" ? "terrace" : "dining"; }
  catch { return "dining"; }
};
const storeKind = (kind) => { try { localStorage.setItem(LS_KEY, kind); } catch {} };

// Where a live ticket sits right now. A party out on the terrace carries its
// terrace label on the derived `_visit` decoration (App builds it); a seated
// party resolves to a dining tile through the active layout, exactly as FOH
// does. Anything else (upcoming banner, between rooms) has no place yet → null.
function locateTable(table, diningMap) {
  if (!table) return null;
  if (table._visit?.visit === "terrace") {
    const label = table._visit.terraceLabel;
    return label ? { kind: "terrace", label } : null;
  }
  if (table.active) {
    const label = resolveReservationTable(diningMap, table.id).table?.label || null;
    return label ? { kind: "dining", label } : null;
  }
  return null;
}

export default function KitchenMinimap({
  floorMaps, tables = [], focusedTableId = null,
  floorStatus = null, reservations = [],
  // Service actions (all optional — absent → read-only, exactly like the
  // kitchen floor view's contract).
  onAssign,             // (reservation, terraceLabel)
  onSwapSeats,          // (boardId, fromNo, toNo, positionKey, opts?)
  onCycleStatus,        // (mapId, label) — SET strip toggle
  onSendSetToKitchen,   // (boardIds[])
}) {
  const diningMap = getActiveDiningMap(floorMaps);
  const terraceMap = getTerraceMap(floorMaps);
  const [kind, setKind] = useState(readStoredKind);
  const [sheetLabel, setSheetLabel] = useState(null);   // REAL terrace tile label
  const [movingParty, setMovingParty] = useState(null); // CHANGE TABLE in flight

  const focusedTable = focusedTableId != null
    ? tables.find(t => t.id === focusedTableId) || null
    : null;
  const located = useMemo(() => locateTable(focusedTable, diningMap), [focusedTable, diningMap]);

  // The map follows the focused party into its room — the point is that the
  // chef sees where THIS ticket's food goes, not whichever room they last
  // browsed. Manual swipes (below) still win until the next ticket is touched.
  useEffect(() => {
    if (located && located.kind !== kind) { setKind(located.kind); storeKind(located.kind); }
  }, [located]); // eslint-disable-line react-hooks/exhaustive-deps

  const setKindManual = (next) => {
    setKind(next); storeKind(next);
    setSheetLabel(null); setMovingParty(null); // leaving the room drops its sheet
  };
  const toggleKind = () => setKindManual(kind === "dining" ? "terrace" : "dining");

  // Horizontal swipe → switch rooms — but ONLY from the map's dead space. A
  // pointer that goes down on a chair or a table belongs to the seat-swap
  // drag / tile tap; letting it also arm the swipe meant a long chair drag
  // could flip the room mid-gesture and drop the seat on the wrong map.
  const swipe = useRef(null);
  const onPointerDown = (e) => {
    swipe.current = e.target.closest?.("[data-seat],[data-table]")
      ? null
      : { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e) => {
    const s = swipe.current; swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) > 26 && Math.abs(dx) > Math.abs(dy)) toggleKind();
  };

  const map = kind === "terrace" ? terraceMap : diningMap;
  const otherAvailable = !!(diningMap && terraceMap);
  const interactive = !!(onAssign || onSwapSeats || onCycleStatus);

  // Live occupancy for THIS room, keyed by the REAL tile label. Terrace tiles
  // match a party through its `_visit.terraceLabel`; dining tiles through the
  // active layout resolution. Built before the early return so hooks stay
  // ordered.
  const liveByLabel = useMemo(() => {
    const out = {};
    if (!map) return out;
    for (const t of tables) {
      let label = null;
      if (map.kind === "terrace") {
        if (t._visit?.visit === "terrace") label = t._visit.terraceLabel;
      } else if (t.active) {
        label = resolveReservationTable(diningMap, t.id).table?.label || null;
      }
      if (label) out[label] = t;
    }
    return out;
  }, [tables, map, diningMap]);

  const diningLabelOfBoard = (boardId) =>
    resolveReservationTable(diningMap, boardId).table?.label || `T${boardId}`;

  // The focused ticket's tile — only when it lives on the room now showing —
  // gets the "you are here" ring on top of the normal occupied highlight.
  const focusLabel = located && located.kind === kind ? located.label : null;

  // Same per-tile presentation the kitchen floor view feeds FloorMap. Occupied
  // terrace tiles are RENAMED to the party's dining label on the display copy
  // of the map; all keyed state follows the display label, while stored
  // floorPositions stay keyed by the REAL tile label. realByDisplay maps a
  // FloorMap callback's label back to the real tile + its board table.
  const { bareMap, tableState, restrictionsByLabel, seatLabelsByLabel, seatGendersByLabel, realByDisplay } = useMemo(() => {
    if (!map) return { bareMap: null, tableState: {}, restrictionsByLabel: {}, seatLabelsByLabel: {}, seatGendersByLabel: {}, realByDisplay: {} };
    const ts = {}, rb = {}, sl = {}, sg = {}, rd = {};
    const ownLabels = new Set((map.tables || []).map(t => t.label));
    const displayTables = (map.tables || []).map((mt) => {
      const live = liveByLabel[mt.label] || null;
      let dLabel = mt.label;
      if (live && map.kind === "terrace") {
        const dining = diningLabelOfBoard(live.id);
        if (dining === mt.label || !ownLabels.has(dining)) dLabel = dining;
      }
      rd[dLabel] = { realLabel: mt.label, live };
      ts[dLabel] = {
        status: live ? "occupied" : "free",
        strip: floorStatusOf(floorStatus, map.id, mt.label),
        ...(mt.label === focusLabel ? { sent: true } : {}),
      };
      if (live) {
        const pk = floorPositionKey(map.id, mt.label); // REAL tile label — positions live under it
        const restr = restrictionsAtFloorPositions(live.seats || [], live.restrictions || [], pk)
          .filter(r => r && r.note);
        if (restr.length) rb[dLabel] = restr;
        sl[dLabel] = Object.fromEntries((live.seats || []).map(s => [seatFloorPosition(s, pk), Number(s.id)]));
        const g = {};
        for (const s of live.seats || []) {
          if (s.gender === "Mr" || s.gender === "Mrs") g[seatFloorPosition(s, pk)] = s.gender;
        }
        if (Object.keys(g).length) sg[dLabel] = g;
      }
      return dLabel === mt.label ? mt : { ...mt, label: dLabel };
    });
    return {
      bareMap: { ...map, sheet: emptySheet(), tables: displayTables },
      tableState: ts, restrictionsByLabel: rb, seatLabelsByLabel: sl, seatGendersByLabel: sg,
      realByDisplay: rd,
    };
  }, [map, diningMap, liveByLabel, focusLabel, floorStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Parties offered by the free-tile picker: ONLY parties physically in the
  // house — seated inside ('dining', they may head out for dessert) or a
  // legacy-flow row whose board table is already live. A plain 'booked'
  // reservation is a party that has not arrived; offering it here is how a
  // no-show ends up "seated" on the terrace by a mis-tap (per Djan, 18.07).
  const seatedParties = useMemo(() => {
    if (!interactive) return [];
    return (reservations || []).filter((r) => {
      if (r.data?.clearedFromBoard) return false;
      const s = visitStateOf(r.data);
      if (s === "dining") return true;
      if (s !== "booked") return false;
      return reservationTableIds(r.data, r.table_id)
        .some((id) => !!tables.find((t) => Number(t.id) === Number(id))?.active);
    });
  }, [interactive, reservations, tables]);

  const occ = useMemo(
    () => (map?.kind === "terrace" ? terraceOccupancy(reservations) : {}),
    [map, reservations]
  );

  // Chair drag → swap, exactly the kitchen floor view's rules: TERRACE keeps
  // the guest's P-number (only the aperitif chair changes); DINING is a real
  // renumber (the chair is the plate position). FloorMap hands us the DISPLAY
  // label — resolve back to the real tile and its board table.
  const swapSeatPositions = (displayLabel, aNo, bNo) => {
    if (!onSwapSeats) return;
    const hit = realByDisplay[displayLabel];
    const bt = hit?.live;
    if (!bt) return;
    const pk = floorPositionKey(map.id, hit.realLabel);
    if (map.kind === "terrace") onSwapSeats(bt.id, Number(aNo), Number(bNo), pk);
    else onSwapSeats(bt.id, Number(aNo), Number(bNo), pk, { identity: true });
  };

  const terraceInteractive = interactive && map?.kind === "terrace";

  const handleTableTap = (t) => {
    if (!terraceInteractive) return;
    const hit = realByDisplay[t.label];
    if (!hit) return;
    if (movingParty) {
      // CHANGE TABLE in flight: the next FREE tile tap re-seats the party.
      if (hit.live) return; // occupied — ignore
      onAssign?.(movingParty, hit.realLabel);
      setMovingParty(null);
      return;
    }
    setSheetLabel(hit.realLabel);
  };

  const sheetParty = sheetLabel ? occ[sheetLabel] || null : null;
  const sheetOccupied = sheetLabel ? !!liveByLabel[sheetLabel] : false;
  const sheetStrip = sheetLabel ? floorStatusOf(floorStatus, map?.id, sheetLabel) : null;
  useEffect(() => {
    // the tile's party left (moved inside / cleared elsewhere) — close a
    // sheet that no longer matches reality
    if (sheetLabel && sheetOccupied && !sheetParty) setSheetLabel(null);
  }, [sheetLabel, sheetOccupied, sheetParty]);

  const primaryBoardIdOf = (r) => {
    const ids = reservationTableIds(r.data, r.table_id);
    return Math.min(...ids.map(Number));
  };

  if (!map || !bareMap) return null;

  const btn = (primary) => ({
    fontFamily: FONT, fontSize: 9, letterSpacing: "0.10em", textTransform: "uppercase",
    padding: "9px 12px", border: `1px solid ${primary ? tokens.ink[0] : tokens.ink[4]}`,
    background: primary ? tokens.ink[0] : tokens.neutral[0],
    color: primary ? tokens.neutral[0] : tokens.ink[2],
    borderRadius: 0, cursor: "pointer", touchAction: "manipulation", fontWeight: primary ? 600 : 400,
  });

  return (
    <>
    <div
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      style={{
        width: 260, maxWidth: "42vw",
        display: "flex", flexDirection: "column", gap: 4,
        background: tokens.ink.bg, border: `1px solid ${tokens.ink[4]}`,
        padding: 6, touchAction: "pan-y", userSelect: "none", WebkitUserSelect: "none",
      }}
      aria-label="Kitchen minimap"
    >
      {/* header: room name + which of the two rooms is showing. Tapping it (or
          swiping the map's dead space) switches — no always-on toggle chrome. */}
      <div
        onClick={otherAvailable ? toggleKind : undefined}
        style={{
          display: "flex", alignItems: "center", gap: 6,
          cursor: otherAvailable ? "pointer" : "default", padding: "0 1px",
        }}
      >
        <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: tokens.ink[3], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {map.name}
        </span>
        {movingParty && (
          <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase", color: tokens.ink[0], fontWeight: 700, whiteSpace: "nowrap" }}>
            TAP FREE TABLE
          </span>
        )}
        <span style={{ flex: 1 }} />
        {movingParty ? (
          <button onClick={(e) => { e.stopPropagation(); setMovingParty(null); }}
            style={{ ...btn(false), padding: "3px 7px", fontSize: 8 }}>✕</button>
        ) : otherAvailable && ["dining", "terrace"].map(k => (
          <span key={k} aria-hidden style={{
            width: 5, height: 5, borderRadius: 5,
            background: k === kind ? tokens.ink[2] : tokens.ink[4],
          }} />
        ))}
      </div>

      <FloorMap
        map={bareMap}
        mode="service"
        tableState={tableState}
        restrictionsByLabel={restrictionsByLabel}
        seatLabelsByLabel={seatLabelsByLabel}
        seatGendersByLabel={seatGendersByLabel}
        seatPositionLabels
        seatCodes
        showPartyLines={false}
        onSeatSwap={interactive && onSwapSeats ? swapSeatPositions : undefined}
        onTableTap={terraceInteractive ? handleTableTap : undefined}
        height={230}
      />
    </div>

    {/* compact terrace action sheet — same flows as the kitchen floor view,
        stripped to what fits a corner tool */}
    {terraceInteractive && sheetLabel && (
      <>
        <div onClick={() => setSheetLabel(null)}
          style={{ position: "fixed", inset: 0, background: tokens.surface.overlay, zIndex: 70 }} />
        <div role="dialog" aria-label="Terrace table actions" style={{
          position: "fixed", right: 16, bottom: 16, zIndex: 71,
          width: 300, maxWidth: "calc(100vw - 32px)", background: tokens.neutral[0],
          border: `1px solid ${tokens.ink[0]}`, padding: "12px 14px 14px",
        }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
            <span style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: tokens.ink[0], letterSpacing: "-0.02em" }}>
              {sheetParty ? diningLabelOfBoard(primaryBoardIdOf(sheetParty)) : sheetLabel}
            </span>
            {sheetParty && (
              <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[2], overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                {sheetParty.data?.resName || "—"}{sheetParty.data?.resTime ? ` · ${sheetParty.data.resTime}` : ""}
              </span>
            )}
            <span style={{ flex: 1 }} />
            <button onClick={() => setSheetLabel(null)} aria-label="Close"
              style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, border: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[0], color: tokens.ink[2], width: 28, height: 28, cursor: "pointer", borderRadius: 0 }}>
              ✕
            </button>
          </div>
          {sheetParty ? (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {onAssign && (
                <button style={btn(false)} onClick={() => { setMovingParty(sheetParty); setSheetLabel(null); }}>
                  CHANGE TABLE
                </button>
              )}
              {onCycleStatus && (sheetStrip === "SET" ? (
                <button style={btn(false)} onClick={() => { onCycleStatus(map.id, sheetLabel); setSheetLabel(null); }}>
                  UNSET
                </button>
              ) : (
                <button style={btn(true)} onClick={() => {
                  onSendSetToKitchen?.([primaryBoardIdOf(sheetParty)]);
                  onCycleStatus(map.id, sheetLabel);
                  setSheetLabel(null);
                }}>
                  SET → KITCHEN
                </button>
              ))}
            </div>
          ) : (
            // Free tile → seat a party that is IN THE HOUSE. Each row is just
            // name · dining table · time — nothing else (per Djan).
            <div>
              <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: "0.12em", color: tokens.ink[3], textTransform: "uppercase", margin: "0 0 6px" }}>
                ASSIGN PARTY
              </div>
              {sheetStrip === "SET" && onCycleStatus && (
                <div style={{ marginBottom: 8 }}>
                  <button style={btn(false)} onClick={() => { onCycleStatus(map.id, sheetLabel); setSheetLabel(null); }}>
                    UNSET
                  </button>
                </div>
              )}
              {seatedParties.length === 0 && (
                <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3] }}>no seated parties</div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 180, overflowY: "auto" }}>
                {seatedParties.map((r) => (
                  <button key={r.id} style={{ ...btn(false), display: "flex", gap: 8, alignItems: "baseline", textTransform: "none", letterSpacing: 0 }}
                    onClick={() => {
                      onAssign?.(r, sheetLabel);
                      setSheetLabel(null);
                    }}>
                    <span style={{ fontWeight: 700, color: tokens.ink[0] }}>{r.data?.resName || "—"}</span>
                    <span>{diningLabelOfBoard(primaryBoardIdOf(r))}</span>
                    {r.data?.resTime && <span style={{ color: tokens.ink[3] }}>{r.data.resTime}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </>
    )}
    </>
  );
}
