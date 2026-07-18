import { useEffect, useMemo, useRef, useState } from "react";
import { tokens } from "../../styles/tokens.js";
import FloorMap from "../floor/FloorMap.jsx";
import {
  getActiveDiningMap, getTerraceMap, resolveReservationTable, emptySheet,
} from "../../utils/floorMaps.js";
import {
  floorPositionKey, seatFloorPosition, restrictionsAtFloorPositions,
} from "../../utils/tableHelpers.js";

// KitchenMinimap — a small, always-on room map docked in the board's spare
// bottom-right, so the pass reads WHERE a dish goes (room, table, guests)
// without leaving the ticket wall. It is NOT the full interactive kitchen
// floor view (no seating actions, no tabs, no walls), but it renders through
// the SAME FloorMap component that view uses, so it looks and highlights
// exactly like the kitchen floor map: occupied tables solid, guest positions
// labelled at every chair, restricted chairs in the app red. The architecture
// layer (walls/zones/planters) is stripped — a corner crib wants the tables,
// not the blueprint.
//
// It stays live at all times (occupied tables + guest labels always drawn,
// like the floor map), and the ticket the chef is touching gets an extra ring
// so "this one" is unmistakable; the map also follows that party into the room
// it's actually in (terrace vs. dining). Swipe or tap the header to browse the
// other room; the last room is remembered across reloads.

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

export default function KitchenMinimap({ floorMaps, tables = [], focusedTableId = null }) {
  const diningMap = getActiveDiningMap(floorMaps);
  const terraceMap = getTerraceMap(floorMaps);
  const [kind, setKind] = useState(readStoredKind);

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

  const setKindManual = (next) => { setKind(next); storeKind(next); };
  const toggleKind = () => setKindManual(kind === "dining" ? "terrace" : "dining");

  // Horizontal swipe → switch rooms. A short flick with no vertical bias, so a
  // scroll of the board underneath never reads as a room change.
  const swipe = useRef(null);
  const onPointerDown = (e) => { swipe.current = { x: e.clientX, y: e.clientY }; };
  const onPointerUp = (e) => {
    const s = swipe.current; swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) > 26 && Math.abs(dx) > Math.abs(dy)) toggleKind();
  };

  const map = kind === "terrace" ? terraceMap : diningMap;
  const otherAvailable = !!(diningMap && terraceMap);

  // Live occupancy for THIS room, keyed by tile label. Terrace tiles match a
  // party through its `_visit.terraceLabel`; dining tiles through the active
  // layout resolution. Built before the early return so hooks stay ordered.
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

  // The focused ticket's tile — only when it lives on the room now showing —
  // gets the "you are here" ring on top of the normal occupied highlight.
  const focusLabel = located && located.kind === kind ? located.label : null;

  // Same per-tile presentation the kitchen floor view feeds FloorMap: occupied
  // status, guest labels at the physical chairs, restrictions projected onto
  // those chairs, gender outlines. Empty tiles fall back to the layout's own
  // seat numbers, so every chair shows its P-label like the floor map.
  //
  // An OCCUPIED terrace tile takes the party's DINING label as its name (per
  // Djan): a terrace position is only a waiting spot — its identity for the
  // kitchen is which table's party is out there, so tile "A" with T8's party
  // reads "T8". The rename happens on the display copy of the map; the stored
  // floorPositions stay keyed by the REAL tile label. Empty tiles keep their
  // own name. The architecture layer is stripped (emptySheet) — the crib
  // wants tables + guests, not walls.
  const { bareMap, tableState, restrictionsByLabel, seatLabelsByLabel, seatGendersByLabel } = useMemo(() => {
    if (!map) return { bareMap: null, tableState: {}, restrictionsByLabel: {}, seatLabelsByLabel: {}, seatGendersByLabel: {} };
    const ts = {}, rb = {}, sl = {}, sg = {};
    const ownLabels = new Set((map.tables || []).map(t => t.label));
    const displayTables = (map.tables || []).map((mt) => {
      const live = liveByLabel[mt.label] || null;
      // display name: terrace tiles borrow the party's dining label, unless it
      // would collide with another tile's real name
      let dLabel = mt.label;
      if (live && map.kind === "terrace") {
        const dining = resolveReservationTable(diningMap, live.id).table?.label || `T${live.id}`;
        if (dining === mt.label || !ownLabels.has(dining)) dLabel = dining;
      }
      ts[dLabel] = { status: live ? "occupied" : "free", ...(mt.label === focusLabel ? { sent: true } : {}) };
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
    };
  }, [map, diningMap, liveByLabel, focusLabel]);

  if (!map || !bareMap) return null;

  return (
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
          swiping the map) switches — no always-on toggle chrome. */}
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
        <span style={{ flex: 1 }} />
        {otherAvailable && ["dining", "terrace"].map(k => (
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
        height={230}
      />
    </div>
  );
}
