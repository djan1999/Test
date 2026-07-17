import { useEffect, useMemo, useRef, useState } from "react";
import { tokens } from "../../styles/tokens.js";
import {
  getActiveDiningMap, getTerraceMap, seatDisplayPoints,
  resolveReservationTable, MAP_W, MAP_H,
} from "../../utils/floorMaps.js";

// KitchenMinimap — a persistent spatial-awareness crib for the pass. It sits
// in the empty bottom-right of the ticket board (never over a ticket) so a
// chef plating a dish knows WHERE it goes without reading table numbers or
// leaving the board. It is NOT the interactive kitchen floor view: no walls,
// no chairs-as-controls, no seating actions — just the room's tables, their
// numbers, and guest positions, rendered as small as it can be while staying
// legible. The heavy renderer (FloorMap) draws the architecture layer and a
// dozen chair registers; reusing it here would fight the "extremely minimal"
// brief and cost renders the board can't spare — so this paints its own tiny
// SVG straight from the SAME pure geometry (seatDisplayPoints) FloorMap uses.
//
// Interaction, per Djan's brief: the chef touches/hovers a ticket → that
// table lights up here with its guest positions, everything else dims, and
// the map follows the party into the room it's actually in (a terrace party's
// ticket shows the terrace; a seated party shows the dining layout). Swipe
// left/right (or tap the header) to browse the other room; the last room
// browsed is remembered across reloads.

const FONT = tokens.font;
const LS_KEY = "milka_kitchen_minimap_map"; // "dining" | "terrace"

const readStoredKind = () => {
  try { return localStorage.getItem(LS_KEY) === "terrace" ? "terrace" : "dining"; }
  catch { return "dining"; }
};
const storeKind = (kind) => { try { localStorage.setItem(LS_KEY, kind); } catch {} };

// Where does a live ticket sit right now? A party out on the terrace carries
// its terrace label on the derived `_visit` decoration (App builds it); an
// active dining party resolves to a tile through the active layout exactly
// like FOH does. Anything else (an upcoming banner, a party between rooms)
// has no place on the map yet → null, and the minimap just stays put.
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

function TableGlyph({ t, focused, dimmed, liveSeatNos }) {
  const cx = t.x + t.w / 2;
  const cy = t.y + t.h / 2;
  // Focused = solid green (matches the seated-table register on the real
  // floor); otherwise a quiet hairline outline. Dim the rest so the lit table
  // is the only thing the eye lands on.
  const stroke = focused ? tokens.green.strong : tokens.ink[4];
  const fill = focused ? tokens.green.strong : "none";
  const labelFill = focused ? tokens.neutral[0] : tokens.ink[3];
  const shape = t.shape === "round"
    ? <circle cx={cx} cy={cy} r={Math.min(t.w, t.h) / 2} fill={fill} stroke={stroke} strokeWidth={focused ? 0.7 : 0.4} />
    : <rect x={t.x} y={t.y} width={t.w} height={t.h} fill={fill} stroke={stroke} strokeWidth={focused ? 0.7 : 0.4} />;

  // Table number without the "T" so it stays legible at this size ("8", not
  // "T8"); merges keep their compound label.
  const num = String(t.label || "").replace(/^T/i, "");

  return (
    <g opacity={dimmed ? 0.28 : 1}>
      {shape}
      <text x={cx} y={cy + 1} textAnchor="middle" fontFamily={FONT}
        fontSize={t.label.length > 3 ? 2.6 : 3.4} fontWeight={700} fill={labelFill}>
        {num}
      </text>
      {/* Guest positions. On the focused table the seats a guest actually
          occupies (matched by P-number to the live cover) light up with their
          number — "T8, guests 2 and 4" reads straight off the map; empty
          chairs of the tile stay faint. Off the focused table the dots are
          just quiet position markers. */}
      {seatDisplayPoints(t).map((p, i) => {
        const sx = p.x + p.out.x * 1.9;
        const sy = p.y + p.out.y * 1.9;
        const live = focused && p.no != null && liveSeatNos.has(Number(p.no));
        if (focused) {
          return (
            <g key={i}>
              <circle cx={sx} cy={sy} r={live ? 1.7 : 1}
                fill={live ? tokens.green.border : "none"}
                stroke={live ? tokens.green.strong : tokens.ink[4]} strokeWidth={0.3} />
              {live && (
                <text x={sx} y={sy + 0.7} textAnchor="middle" fontFamily={FONT}
                  fontSize={1.8} fontWeight={700} fill={tokens.neutral[0]}>
                  {p.no}
                </text>
              )}
            </g>
          );
        }
        return <circle key={i} cx={sx} cy={sy} r={0.7} fill={tokens.ink[4]} />;
      })}
    </g>
  );
}

export default function KitchenMinimap({ floorMaps, tables = [], focusedTableId = null }) {
  const diningMap = getActiveDiningMap(floorMaps);
  const terraceMap = getTerraceMap(floorMaps);
  const [kind, setKind] = useState(readStoredKind);

  const focusedTable = focusedTableId != null
    ? tables.find(t => t.id === focusedTableId) || null
    : null;
  const located = useMemo(() => locateTable(focusedTable, diningMap), [focusedTable, diningMap]);

  // The map follows the focused party into its room — the whole point is that
  // the chef sees where THIS ticket's food goes, not whichever room they last
  // browsed. Manual swipes (below) still win until the next ticket is touched.
  useEffect(() => {
    if (located && located.kind !== kind) { setKind(located.kind); storeKind(located.kind); }
  }, [located]); // eslint-disable-line react-hooks/exhaustive-deps

  const setKindManual = (next) => { setKind(next); storeKind(next); };
  const toggleKind = () => setKindManual(kind === "dining" ? "terrace" : "dining");

  // Horizontal swipe → switch rooms. A short flick, no vertical bias, so a
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
  if (!map) return null;

  // Only the focused table (when it lives on the room now showing) drives the
  // highlight/dim split — browsing the other room shows a calm, undimmed plan.
  const activeLabel = located && located.kind === kind ? located.label : null;
  const liveSeatNos = new Set((focusedTable?.seats || []).map(s => Number(s.id)));

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      style={{
        width: 150, maxWidth: "100%",
        display: "flex", flexDirection: "column", gap: 3,
        touchAction: "pan-y", userSelect: "none", WebkitUserSelect: "none",
      }}
      aria-label="Kitchen minimap"
    >
      {/* header: room name + which of the two rooms is showing. Tapping it (or
          swiping the map) switches — no always-on toggle chrome. */}
      <div
        onClick={otherAvailable ? toggleKind : undefined}
        style={{
          display: "flex", alignItems: "center", gap: 5,
          cursor: otherAvailable ? "pointer" : "default",
        }}
      >
        <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: "0.12em", textTransform: "uppercase", color: tokens.ink[3], whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {map.name}
        </span>
        <span style={{ flex: 1 }} />
        {otherAvailable && ["dining", "terrace"].map(k => (
          <span key={k} aria-hidden style={{
            width: 4, height: 4, borderRadius: 4,
            background: k === kind ? tokens.ink[2] : tokens.ink[4],
          }} />
        ))}
      </div>

      <svg
        viewBox={`0 0 ${MAP_W} ${MAP_H}`}
        style={{
          width: "100%", aspectRatio: `${MAP_W} / ${MAP_H}`, display: "block",
          background: tokens.ink.bg, border: `1px solid ${tokens.ink[4]}`,
        }}
        role="img"
        aria-label={`${map.name} minimap`}
      >
        {(map.tables || []).map((t) => (
          <TableGlyph
            key={t.label}
            t={t}
            focused={activeLabel === t.label}
            dimmed={!!activeLabel && activeLabel !== t.label}
            liveSeatNos={liveSeatNos}
          />
        ))}
      </svg>
    </div>
  );
}
