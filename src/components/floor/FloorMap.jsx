import { useRef, useState } from "react";
import { tokens } from "../../styles/tokens.js";
import {
  seatDisplayPoints, MAP_W, MAP_H,
  sheetOf, wallSegments, segmentRuns, doorGeometry, hitTestSheet,
} from "../../utils/floorMaps.js";

// FloorMap — THE floor renderer. Every spatial surface (FOH floor view,
// terrace picker, kitchen floor view, admin seats editor, geometry editor)
// renders through this one component; do not fork it — add a mode instead.
//
//   mode "view"    read-only room (kitchen floor view)
//   mode "picker"  free tables tappable, occupied/inert tables dimmed
//   mode "seats"   chair marks tappable for SEATS renumbering
//   mode "service" FOH tables: body tap → onTableTap (the caller decides —
//                  dining tables toggle SET, terrace opens the sheet); the
//                  status draws as a colored border + chip under the table
//   mode "edit"    geometry editor: drag tables (unit snap, canvas clamp,
//                  commit on release via onTableMove), tap = select, drag a
//                  selected table's chair marks along the outline (onSeatMove)
//
// Geometry comes from utils/floorMaps.js (pure, tested); this file only
// paints. Design system: Roboto Mono, zero border-radius, ink grayscale,
// semantic color only (green = seated/SET, alert red = allergy/restriction).

const FONT = tokens.font;

// Short code for a restriction note on a seat dot ("3 · SHF"). Known service
// vocabulary first, deterministic first-3-letters fallback for the rest.
const RESTRICTION_CODES = {
  shellfish: "SHF", gluten: "GLU", lactose: "LAC", dairy: "DAI", nut: "NUT",
  nuts: "NUT", vegetarian: "VEG", vegan: "VGN", pescetarian: "PSC",
  pregnant: "PRG", alcohol: "ALC", pork: "PRK", garlic: "GAR", egg: "EGG",
};
export function restrictionCode(note) {
  const clean = String(note || "").trim().toLowerCase();
  if (!clean) return "";
  for (const [word, code] of Object.entries(RESTRICTION_CODES)) {
    if (clean.includes(word)) return code;
  }
  return clean.replace(/[^a-z]/g, "").slice(0, 3).toUpperCase() || "?";
}

const truncate = (s, n) => {
  const t = String(s || "");
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

// Fit a line INSIDE its table: Roboto Mono advances ~0.62em, so shrink the
// font until the string fits the available width (floor 1.5), then truncate
// whatever still overflows. Stops party names spilling over the chair marks.
const CHAR_W = 0.62;
const fitText = (s, maxFont, availW) => {
  const text = String(s || "");
  if (!text) return { text, font: maxFont };
  let font = Math.min(maxFont, availW / (text.length * CHAR_W));
  if (font >= 1.5) return { text, font };
  return { text: truncate(text, Math.max(3, Math.floor(availW / (1.5 * CHAR_W)))), font: 1.5 };
};

// The architecture layer — walls with openings cut out (door leaf + swing
// arc, or passage jamb ticks), hatched zones, planters. Rendered in EVERY
// mode (the kitchen and FOH see the room, not floating tables); pointer
// events stay off — interaction belongs to the edit-mode canvas rect.
function SheetLayer({ sheet, sel, drag, blueprint = false }) {
  const wallInk = blueprint ? tokens.ink[0] : tokens.ink[1];
  const off = (el, kind) =>
    drag?.moved && drag.kind === kind && drag.id === el.id
      ? { x: el.x + drag.dx, y: el.y + drag.dy }
      : { x: el.x, y: el.y };

  return (
    <g pointerEvents="none">
      {sheet.zones.map((z) => {
        const p = off(z, "zone");
        const selected = sel?.kind === "zone" && sel.id === z.id;
        const showLabel = z.w > 14 && z.label;
        const boxW = showLabel ? z.label.length * 1.05 + 2.6 : 0;
        return (
          <g key={z.id}>
            <rect x={p.x} y={p.y} width={z.w} height={z.h} fill="url(#fm-hatch)" opacity={0.55} />
            <rect x={p.x} y={p.y} width={z.w} height={z.h} fill="none" stroke={tokens.ink[2]} strokeWidth={0.3} />
            {showLabel && (
              <g>
                <rect x={p.x + z.w / 2 - boxW / 2} y={p.y + z.h / 2 - 1.7} width={boxW} height={3.4}
                  fill={tokens.neutral[0]} stroke={tokens.ink[2]} strokeWidth={0.3} />
                <text x={p.x + z.w / 2} y={p.y + z.h / 2 + 0.75} textAnchor="middle" fontFamily={tokens.font}
                  fontSize={1.9} fontWeight={700} letterSpacing={0.3} fill={tokens.ink[1]}>{z.label}</text>
              </g>
            )}
            {selected && (
              <rect x={p.x - 1} y={p.y - 1} width={z.w + 2} height={z.h + 2} fill="none"
                stroke={tokens.ink[0]} strokeWidth={0.35} strokeDasharray="1.4 1" />
            )}
          </g>
        );
      })}

      {sheet.planters.map((pl) => {
        const p = off(pl, "planter");
        const selected = sel?.kind === "planter" && sel.id === pl.id;
        return (
          <g key={pl.id} fill="none" stroke={tokens.ink[3]} strokeWidth={0.35}>
            <circle cx={p.x} cy={p.y} r={pl.r} />
            <circle cx={p.x} cy={p.y} r={pl.r * 0.4} opacity={0.6} />
            {selected && <circle cx={p.x} cy={p.y} r={pl.r + 1.4} stroke={tokens.ink[0]} strokeDasharray="1.4 1" />}
          </g>
        );
      })}

      {sheet.walls.map((wall) => {
        const selected = sel?.kind === "wall" && sel.id === wall.id;
        const sw = (wall.dashed ? 0.3 : 0.85) * (blueprint ? 1.4 : 1) + (selected ? 0.3 : 0);
        return wallSegments(wall).map(({ p1, p2, i }) => {
          const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
          if (!L) return null;
          const dir = [(p2[0] - p1[0]) / L, (p2[1] - p1[1]) / L];
          return segmentRuns(wall, i, sheet.openings, L).map(([a, b], k) => (
            <line key={`${wall.id}-${i}-${k}`}
              x1={p1[0] + dir[0] * a} y1={p1[1] + dir[1] * a}
              x2={p1[0] + dir[0] * b} y2={p1[1] + dir[1] * b}
              stroke={selected ? tokens.ink[0] : wallInk} strokeWidth={sw}
              strokeDasharray={wall.dashed ? "3.2 2" : undefined} />
          ));
        });
      })}

      {sheet.openings.map((o) => {
        const g = doorGeometry(o, sheet.walls);
        if (!g) return null;
        const selected = sel?.kind === "door" && sel.id === o.id;
        return (
          <g key={o.id} stroke={wallInk} fill="none">
            {o.kind === "door" ? (
              <>
                <line x1={g.h[0]} y1={g.h[1]} x2={g.leafEnd[0]} y2={g.leafEnd[1]} strokeWidth={0.45} />
                <path d={`M ${g.j[0]} ${g.j[1]} A ${o.width} ${o.width} 0 0 ${g.sweep} ${g.leafEnd[0]} ${g.leafEnd[1]}`}
                  strokeWidth={0.3} strokeDasharray="1 1" />
              </>
            ) : (
              <>
                <line x1={g.A[0] - g.n0[0] * 1.6} y1={g.A[1] - g.n0[1] * 1.6} x2={g.A[0] + g.n0[0] * 1.6} y2={g.A[1] + g.n0[1] * 1.6} strokeWidth={0.45} />
                <line x1={g.B[0] - g.n0[0] * 1.6} y1={g.B[1] - g.n0[1] * 1.6} x2={g.B[0] + g.n0[0] * 1.6} y2={g.B[1] + g.n0[1] * 1.6} strokeWidth={0.45} />
              </>
            )}
            {selected && <circle cx={g.center[0]} cy={g.center[1]} r={5} stroke={tokens.ink[0]} strokeWidth={0.35} strokeDasharray="1.4 1" />}
          </g>
        );
      })}
    </g>
  );
}

function TableShape({ t, fill, stroke, strokeWidth = 0.35, dash }) {
  if (t.shape === "round") {
    const r = Math.min(t.w, t.h) / 2;
    return <circle cx={t.x + t.w / 2} cy={t.y + t.h / 2} r={r} fill={fill} stroke={stroke}
      strokeWidth={strokeWidth} strokeDasharray={dash} />;
  }
  return <rect x={t.x} y={t.y} width={t.w} height={t.h} fill={fill} stroke={stroke}
    strokeWidth={strokeWidth} strokeDasharray={dash} />;
}

const snap = (v) => Math.round(v);
const clampPos = (v, size, max) => Math.min(Math.max(v, 0), max - size);

export default function FloorMap({
  map,
  mode = "view",
  // per-label presentation: { name, pax, sub, badge: {text, tone}, status:
  // 'free'|'occupied'|'arriving'|'reserved', strip: 'SET'|null (service),
  // allergy: bool, selectable: bool }
  tableState = {},
  restrictionsByLabel = {}, // { [label]: [{ pos, note }] } → amber seat dots
  onTableTap,
  onSeatTap,                // (label, seatIndex) — seats mode
  onTableMove,              // (label, x, y) — edit mode, on release
  onSeatMove,               // (label, seatIndex, {x, y}) — edit mode, on release
  seatsOverride = {},       // { [label]: seats[] } — seats-mode preview
  seatsEditLabel = null,    // seats mode: the table being renumbered
  selectedLabel = null,     // edit mode: highlighted table
  // SHEET editing (edit mode only): the active tool decides what a canvas
  // tap means; the editor owns tool state and commits through pure helpers.
  sheetTool = "move",       // 'select' | 'move' | 'wall' | 'door' | 'zone' | 'plant'
                            // — only MOVE drags tables/zones/planters; SELECT
                            // is tap-to-edit only (accidental-drag guard)
  sheetDraft = null,        // wall-in-progress points [[x,y],…]
  sheetSel = null,          // { kind: 'wall'|'door'|'zone'|'planter', id }
  onCanvasTap,              // ({x, y}) — tap with a stamp/draw tool active
  onSheetSelect,            // (hit | null) — MOVE-tool tap
  onSheetMove,              // (kind, id, x, y) — zone/planter drag, on release
  seatCodes = true,         // restriction code text beside restricted chairs
                            // (kitchen needs it; the FOH floor keeps just the
                            // amber chair + the label's ▲)
  seatNotesByLabel = {},    // { [label]: { [seatNo]: "XC·W" } } — per-seat
                            // beverage annotations at the chair positions
  showPartyLines = true,    // false (FOH floor): tables render label + ▲
                            // only — no ×pax, no course; the chairs carry
                            // the per-seat info
  height = 340,
}) {
  const svgRef = useRef(null);
  // Transient drag preview — geometry commits only on pointer release, so a
  // drag causes exactly one updateFloorMaps persist, not one per move event.
  const [drag, setDrag] = useState(null);     // { label, dx, dy, moved }
  const [seatDrag, setSeatDrag] = useState(null); // { label, index, x, y }
  const [sheetDrag, setSheetDrag] = useState(null); // { kind, id, dx, dy, moved }
  const gestureRef = useRef(null);            // pointer bookkeeping between events

  if (!map) return null;
  const editing = mode === "edit";
  const sheetData = sheetOf(map);
  const sheetEditing = editing && !!onCanvasTap;
  const moveTool = sheetTool === "move";
  const stampTool = sheetEditing && !moveTool && sheetTool !== "select";
  // The editor is the only consumer of the edit/seats modes, so the mockup's
  // blueprint register (paper sheet, dual drafting grid, heavy ink, title
  // block) lives on these modes — the FOH/kitchen views keep the quiet look.
  const blueprint = editing || mode === "seats";

  // Client px → viewBox units. getScreenCTM is exact whatever the element's
  // box does (zoom, borders, letterboxing); the manual fallback (jsdom has no
  // CTM) still accounts for preserveAspectRatio's centered "meet" scaling —
  // naive width/height ratios made drags run at the wrong scale on any
  // element whose box didn't match the drawing's aspect.
  const toMapUnits = (e) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM?.();
    if (ctm) {
      const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
      return { x: pt.x, y: pt.y };
    }
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const scale = Math.min(r.width / MAP_W, r.height / MAP_H);
    const ox = (r.width - MAP_W * scale) / 2;
    const oy = (r.height - MAP_H * scale) / 2;
    return { x: (e.clientX - r.left - ox) / scale, y: (e.clientY - r.top - oy) / scale };
  };

  const onTablePointerDown = (t) => (e) => {
    if (!editing) return;
    const p = toMapUnits(e);
    if (!p) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    // dragging is armed by the MOVE tool only — with SELECT active a table
    // gesture can never move geometry, it resolves as a tap on release
    gestureRef.current = { kind: "table", label: t.label, start: p, origin: { x: t.x, y: t.y }, movable: moveTool };
    setDrag({ label: t.label, dx: 0, dy: 0, moved: false });
  };

  const onSeatPointerDown = (t, i) => (e) => {
    if (!editing || t.label !== selectedLabel) return;
    e.stopPropagation();
    const p = toMapUnits(e);
    if (!p) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    gestureRef.current = { kind: "seat", label: t.label, index: i, start: p };
    setSeatDrag({ label: t.label, index: i, x: p.x, y: p.y, moved: false });
  };

  const onPointerMove = (e) => {
    const g = gestureRef.current;
    if (!g) return;
    const p = toMapUnits(e);
    if (!p) return;
    const dx = p.x - g.start.x, dy = p.y - g.start.y;
    const moved = Math.abs(dx) + Math.abs(dy) > 0.5;
    if (g.kind === "table") { if (g.movable) setDrag({ label: g.label, dx, dy, moved }); }
    else if (g.kind === "seat") setSeatDrag({ label: g.label, index: g.index, x: p.x, y: p.y, moved });
    else if (g.kind === "sheetEl") setSheetDrag({ ...g.hit, dx, dy, moved });
  };

  // Canvas rect (edit mode, sits under the tables): stamp-tool taps place
  // walls/doors/zones/planters; MOVE-tool taps select the sheet element under
  // the finger, and zones/planters drag with commit-on-release.
  const onCanvasPointerDown = (e) => {
    if (!sheetEditing) return;
    const p = toMapUnits(e);
    if (!p) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (sheetTool === "move" || sheetTool === "select") {
      const hit = hitTestSheet(sheetData, p);
      // SELECT never drags — the tap resolves to a selection on release
      if (moveTool && hit && (hit.kind === "zone" || hit.kind === "planter")) {
        const el = hit.kind === "zone"
          ? sheetData.zones.find((z) => z.id === hit.id)
          : sheetData.planters.find((x) => x.id === hit.id);
        gestureRef.current = { kind: "sheetEl", hit, start: p, origin: { x: el.x, y: el.y } };
        setSheetDrag({ ...hit, dx: 0, dy: 0, moved: false });
        return;
      }
      gestureRef.current = { kind: "canvasTap", start: p, hit };
    } else {
      gestureRef.current = { kind: "canvasTap", start: p };
    }
  };

  const onCanvasPointerUp = () => {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (!g) return;
    if (g.kind === "sheetEl") {
      const d = sheetDrag;
      setSheetDrag(null);
      if (d?.moved && onSheetMove) onSheetMove(g.hit.kind, g.hit.id, snap(g.origin.x + d.dx), snap(g.origin.y + d.dy));
      else onSheetSelect && onSheetSelect(g.hit);
      return;
    }
    if (g.kind !== "canvasTap") return;
    if (sheetTool === "move" || sheetTool === "select") onSheetSelect && onSheetSelect(g.hit || null);
    else onCanvasTap(g.start);
  };

  const onPointerUp = (t) => () => {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (!g) return;
    if (g.kind === "table") {
      const d = drag;
      setDrag(null);
      if (d?.moved && onTableMove) {
        onTableMove(t.label,
          clampPos(snap(g.origin.x + d.dx), t.w, MAP_W),
          clampPos(snap(g.origin.y + d.dy), t.h, MAP_H));
      } else if (onTableTap) {
        onTableTap(t); // tap = select
      }
    } else {
      const s = seatDrag;
      setSeatDrag(null);
      if (s?.moved && onSeatMove) onSeatMove(g.label, g.index, { x: s.x, y: s.y });
    }
  };

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${MAP_W} ${MAP_H}`}
      style={{
        // The element keeps the drawing's aspect (no letterboxed dead zones):
        // full width up to the cap that makes it `height` tall, centered.
        width: "100%", maxWidth: Math.round((height * MAP_W) / MAP_H),
        aspectRatio: `${MAP_W} / ${MAP_H}`,
        display: "block", margin: "0 auto", background: tokens.ink.bg,
        border: blueprint ? `1.5px solid ${tokens.ink[0]}` : `1px solid ${tokens.ink[4]}`,
        boxShadow: blueprint ? `6px 6px 0 ${tokens.ink[5]}` : undefined,
        touchAction: editing ? "none" : undefined,
      }}
      role="img"
      aria-label={`${map.name} floor map`}
    >
      <defs>
        <pattern id="fm-hatch" width="2.6" height="2.6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="2.6" stroke={tokens.ink[4]} strokeWidth="0.3" />
        </pattern>
        {blueprint && (
          <>
            {/* the mockup's dual drafting grid: fine unit squares + coarse frame */}
            <pattern id="fm-grid-s" width="2" height="2" patternUnits="userSpaceOnUse">
              <path d="M2 0H0V2" fill="none" stroke={tokens.ink[5]} strokeWidth="0.12" />
            </pattern>
            <pattern id="fm-grid-l" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M10 0H0V10" fill="none" stroke={tokens.ink[4]} strokeWidth="0.14" opacity="0.5" />
            </pattern>
          </>
        )}
      </defs>
      {blueprint && (
        <>
          <rect width={MAP_W} height={MAP_H} fill="url(#fm-grid-s)" />
          <rect width={MAP_W} height={MAP_H} fill="url(#fm-grid-l)" />
        </>
      )}

      {/* architecture below the tables, in every mode */}
      <SheetLayer sheet={sheetData} sel={sheetEditing ? sheetSel : null} drag={sheetDrag} blueprint={blueprint} />

      {/* edit-mode canvas: under the tables, so table gestures win unless a
          stamp tool is active (then the tables go inert below) */}
      {sheetEditing && (
        <rect
          width={MAP_W} height={MAP_H} fill="transparent"
          data-sheet-canvas="1"
          style={{ cursor: stampTool ? "crosshair" : "default" }}
          onPointerDown={onCanvasPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onCanvasPointerUp}
        />
      )}

      {(map.tables || []).map((t0) => {
        let t = seatsOverride[t0.label] ? { ...t0, seats: seatsOverride[t0.label] } : t0;
        // live drag preview (edit mode) — tracks the pointer exactly; the
        // grid snap happens once, on release, so the drag never steps.
        if (drag?.moved && drag.label === t.label) {
          t = {
            ...t,
            x: clampPos(t0.x + drag.dx, t0.w, MAP_W),
            y: clampPos(t0.y + drag.dy, t0.h, MAP_H),
          };
        }
        const st = tableState[t.label] || {};
        const occupied = st.status === "occupied";
        const arriving = st.status === "arriving";
        const reserved = st.status === "reserved";
        const strip = mode === "service" ? (st.strip || null) : null;
        const pickable = mode === "picker" ? st.selectable !== false && !occupied && !arriving : false;
        const seatEditing = mode === "seats" && seatsEditLabel === t.label;
        const selected = editing && selectedLabel === t.label;
        const dimmed = (mode === "picker" && !pickable) || (mode === "seats" && seatsEditLabel && !seatEditing);

        const fill = occupied ? tokens.green.bg : tokens.neutral[0];
        // service mode: the status owns the border — SET reads as a strong
        // green outline; no band inside the shape (it clipped the course
        // line and looked wrong inside circles).
        const stroke = strip === "SET" ? tokens.green.strong
          : arriving ? tokens.ink[1]
          : occupied ? tokens.green.border
          : reserved ? tokens.ink[3]
          : blueprint ? tokens.ink[1]
          : tokens.ink[4];

        const cx = t.x + t.w / 2;
        const restr = restrictionsByLabel[t.label] || [];
        const seatPts = seatDisplayPoints(t);

        // usable text width inside the shape (a circle narrows off-center)
        const availW = t.shape === "round" ? t.w * 0.78 : t.w - 1.2;
        // the party line renders whatever the caller supplies — FOH omits the
        // name (per Djan) so it reads "×2"; the kitchen keeps names
        const partyStr = [st.name ? truncate(st.name, 14) : "", st.pax ? `×${st.pax}` : ""].filter(Boolean).join(" ");
        const nameLine = fitText(partyStr, 2.3, availW);
        const subLine = fitText(st.sub, 2, availW);
        // badges/chips drop below the chair band when chairs sit on the
        // bottom edge (deep enough to clear a stacked two-line note pill) —
        // nothing renders through a chair mark
        const belowY = t.y + t.h + (seatPts.some((p) => p.out.y > 0.5) ? 5.6 : 0.8);

        return (
          <g
            key={t.label}
            data-table={t.label}
            opacity={dimmed ? 0.4 : stampTool ? 0.35 : 1}
            pointerEvents={stampTool ? "none" : undefined}
            style={{ cursor: editing ? (moveTool ? "grab" : "pointer") : pickable || (mode !== "seats" && onTableTap) ? "pointer" : "default" }}
            onPointerDown={onTablePointerDown(t0)}
            onPointerMove={editing ? onPointerMove : undefined}
            onPointerUp={editing ? onPointerUp(t0) : undefined}
            onClick={() => {
              if (editing || mode === "seats") return; // taps handled elsewhere
              if (mode === "picker" && !pickable) return;
              onTableTap && onTableTap(t0);
            }}
          >
            <TableShape t={t} fill={fill} stroke={stroke}
              strokeWidth={strip ? 0.7 : blueprint ? 0.45 : 0.35}
              dash={arriving || reserved ? "1.4 1" : undefined} />
            {selected && (
              <>
                <TableShape t={{ ...t, x: t.x - 1.2, y: t.y - 1.2, w: t.w + 2.4, h: t.h + 2.4 }}
                  fill="none" stroke={tokens.ink[0]} strokeWidth={0.5} dash="1.6 1.2" />
                {/* the mockup's live size badge, pinned to the table's corner */}
                <g pointerEvents="none">
                  <rect x={t.x} y={t.y} width={9.5} height={3} fill={tokens.ink[0]} />
                  <text x={t.x + 4.75} y={t.y + 2.15} textAnchor="middle" fontFamily={FONT}
                    fontSize={1.9} fontWeight={700} fill={tokens.neutral[0]}>
                    {t0.w}×{t0.h}
                  </text>
                </g>
              </>
            )}

            {/* label + party — the ▲ rides the label line so it stays inside
                round shapes instead of floating off the corner. In label-only
                mode (FOH) a provided `sub` still renders — it carries the
                party's DINING table on the terrace, their identity there. */}
            {(() => {
              const busy = occupied || arriving || reserved;
              const second = busy && (showPartyLines ? (nameLine.text || subLine.text) : subLine.text);
              return (
                <>
                  <text x={cx}
                    y={t.y + (second ? 3.4 : t.h / 2 + 1)}
                    textAnchor="middle"
                    fontFamily={FONT} fontSize={2.8} fontWeight={700}
                    fill={arriving ? tokens.ink[0] : occupied ? tokens.green.text : tokens.ink[2]}>
                    {t.label}
                    {st.allergy && <tspan fill={tokens.signal.alert}> ▲</tspan>}
                  </text>
                  {showPartyLines && busy && nameLine.text && (
                    <text x={cx} y={t.y + 6.2} textAnchor="middle" fontFamily={FONT} fontSize={nameLine.font} fill={tokens.ink[1]}>
                      {nameLine.text}
                    </text>
                  )}
                  {busy && subLine.text && (
                    <text x={cx} y={t.y + (showPartyLines && nameLine.text ? 8.6 : 6.2)} textAnchor="middle"
                      fontFamily={FONT} fontSize={subLine.font} fontWeight={showPartyLines ? 400 : 700}
                      fill={tokens.ink[1]}>
                      {subLine.text}
                    </text>
                  )}
                </>
              );
            })()}
            {st.badge && (
              <g>
                <rect x={cx - 8} y={belowY} width={16} height={3.4}
                  fill={st.badge.tone === "warn" ? tokens.signal.warn : tokens.ink[0]} />
                <text x={cx} y={belowY + 2.4} textAnchor="middle" fontFamily={FONT} fontSize={2}
                  fill={tokens.neutral[0]} letterSpacing={0.2}>
                  {st.badge.text}
                </text>
              </g>
            )}

            {/* status chip below the table (badge slot wins when both exist) —
                never inside the shape, so nothing clips or crowds the text */}
            {strip && !st.badge && (
              <g pointerEvents="none">
                <rect x={cx - 5} y={belowY} width={10} height={3.2} fill={tokens.green.strong} />
                <text x={cx} y={belowY + 2.3} textAnchor="middle" fontFamily={FONT} fontSize={2}
                  fontWeight={700} letterSpacing={0.3} fill={tokens.neutral[0]}>
                  {strip}
                </text>
              </g>
            )}

            {/* chair marks. Two registers: the editing contexts (seats
                renumber, edit mode) keep numbered dots — the number IS the
                thing being edited — while the presentation modes (view,
                picker, service) draw chair bars along the edge. A seat with
                a beverage note grows into a pill with the note INSIDE it —
                one element, nothing floating. Restrictions highlight in the
                app's red. */}
            {seatPts.map((p, i) => {
              const seatRestr = restr.filter((r) => Number(r.pos) === Number(p.no) && p.no != null);
              const hasRestr = seatRestr.length > 0;
              const draggingSeat = seatDrag?.moved && seatDrag.label === t.label && seatDrag.index === i;
              const sx = draggingSeat ? seatDrag.x : p.x + p.out.x * 2.4;
              const sy = draggingSeat ? seatDrag.y : p.y + p.out.y * 2.4;
              const seatDraggable = editing && selectedLabel === t.label;
              const numbered = mode === "seats" || editing;
              const deg = Math.atan2(p.out.y, p.out.x) * 180 / Math.PI;
              const note = !numbered ? seatNotesByLabel[t.label]?.[p.no] : null;
              // notes stack vertically (water over pairing) → a narrow pill
              const noteLines = note ? (Array.isArray(note) ? note : String(note).split("·")) : [];
              // note pills hug the table edge so neighbouring tables' chairs
              // don't meet in the aisle
              const nx = p.x + p.out.x * 2.6, ny = p.y + p.out.y * 2.6;
              const pillW = noteLines.length ? Math.max(...noteLines.map((l) => l.length)) * 1.05 + 1.4 : 0;
              const pillH = noteLines.length * 1.9 + 1;
              return (
                <g key={i}
                  data-seat={i}
                  style={{ cursor: seatEditing || seatDraggable ? "pointer" : "default" }}
                  onPointerDown={seatDraggable ? onSeatPointerDown(t0, i) : undefined}
                  onClick={(e) => {
                    if (!seatEditing) return;
                    e.stopPropagation();
                    onSeatTap && onSeatTap(t.label, i);
                  }}>
                  {numbered ? (
                    <>
                      <circle cx={sx} cy={sy} r={1.7}
                        fill={hasRestr ? tokens.signal.alert : tokens.neutral[0]}
                        stroke={hasRestr ? tokens.signal.alert : seatEditing || seatDraggable ? tokens.ink[1] : tokens.ink[3]}
                        strokeWidth={0.3} />
                      <text x={sx} y={sy + 0.75} textAnchor="middle" fontFamily={FONT} fontSize={2}
                        fill={hasRestr ? tokens.neutral[0] : tokens.ink[1]} fontWeight={700}>
                        {p.no == null ? "·" : `${p.no}${p.confirm ? "?" : ""}`}
                      </text>
                    </>
                  ) : noteLines.length ? (
                    <g>
                      <rect x={nx - pillW / 2} y={ny - pillH / 2} width={pillW} height={pillH}
                        fill={hasRestr ? tokens.signal.alert : tokens.ink[5]}
                        stroke={hasRestr ? tokens.signal.alert : tokens.ink[4]}
                        strokeWidth={0.25} />
                      {noteLines.map((line, li) => (
                        <text key={li} x={nx}
                          y={ny - ((noteLines.length - 1) * 1.9) / 2 + li * 1.9 + 0.55}
                          textAnchor="middle" fontFamily={FONT} fontSize={1.5}
                          fill={hasRestr ? tokens.neutral[0] : tokens.ink[1]} fontWeight={700}>
                          {line}
                        </text>
                      ))}
                    </g>
                  ) : (
                    <g transform={`translate(${sx},${sy}) rotate(${deg})`}>
                      <rect x={-0.55} y={-1.7} width={1.1} height={3.4}
                        fill={hasRestr ? tokens.signal.alert : tokens.ink[5]}
                        stroke={hasRestr ? tokens.signal.alert : tokens.ink[4]}
                        strokeWidth={0.25} />
                    </g>
                  )}
                  {hasRestr && seatCodes && (
                    <text x={sx + p.out.x * 3.2} y={sy + p.out.y * 3.2 + 0.7}
                      textAnchor="middle" fontFamily={FONT} fontSize={1.8}
                      fill={tokens.signal.alert} fontWeight={700}>
                      {restrictionCode(seatRestr[0].note)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}

      {/* wall in progress — points placed so far (ortho snap lives in the editor) */}
      {sheetEditing && sheetDraft && sheetDraft.length > 0 && (
        <g pointerEvents="none">
          <polyline points={sheetDraft.map((p) => p.join(",")).join(" ")} fill="none"
            stroke={tokens.ink[0]} strokeWidth={0.6} strokeDasharray="1.6 1.2" />
          {sheetDraft.map((p, i) => (
            <rect key={i} x={p[0] - 1} y={p[1] - 1} width={2} height={2}
              fill={i === 0 ? tokens.ink[0] : tokens.neutral[0]} stroke={tokens.ink[0]} strokeWidth={0.3} />
          ))}
        </g>
      )}
    </svg>
  );
}
