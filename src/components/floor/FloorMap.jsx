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
//   mode "service" FOH two-zone tables: body tap → onTableTap, bottom status
//                  strip (rendered ~30% of height, hit area ≥40%) →
//                  onStripTap cycling — → DIRTY → SET → —
//   mode "edit"    geometry editor: drag tables (unit snap, canvas clamp,
//                  commit on release via onTableMove), tap = select, drag a
//                  selected table's chair marks along the outline (onSeatMove)
//
// Geometry comes from utils/floorMaps.js (pure, tested); this file only
// paints. Design system: Roboto Mono, zero border-radius, ink grayscale,
// semantic color only (green = seated/SET, amber = DIRTY, alert = allergy ▲).

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
        const sw = (wall.dashed ? 0.55 : 0.85) * (blueprint ? 1.4 : 1) + (selected ? 0.3 : 0);
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

// Drafting-sheet title block (editor only) — the mockup's signature corner.
function TitleBlock({ name, idx }) {
  const x = 60.5, y = 78.5, w = 38, h = 12;
  const date = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
  return (
    <g pointerEvents="none">
      <rect x={x} y={y} width={w} height={h} fill={tokens.neutral[0]} stroke={tokens.ink[0]} strokeWidth={0.35} />
      <line x1={x} y1={y + 4} x2={x + w} y2={y + 4} stroke={tokens.ink[0]} strokeWidth={0.2} />
      <line x1={x} y1={y + 8} x2={x + w} y2={y + 8} stroke={tokens.ink[4]} strokeWidth={0.15} />
      <text x={x + 1.4} y={y + 2.9} fontFamily={tokens.font} fontSize={1.9} fontWeight={700} letterSpacing={0.25} fill={tokens.ink[0]}>
        MILKA — SERVICE BOARD
      </text>
      <text x={x + 1.4} y={y + 6.9} fontFamily={tokens.font} fontSize={1.9} fontWeight={700} letterSpacing={0.2} fill={tokens.ink[0]}>
        {name} · DWG {String((idx ?? 0) + 1).padStart(2, "0")}
      </text>
      <text x={x + 1.4} y={y + 10.9} fontFamily={tokens.font} fontSize={1.6} letterSpacing={0.2} fill={tokens.ink[3]}>
        SCALE 1:50 · {date}
      </text>
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
  // 'free'|'occupied'|'arriving'|'reserved', dirty: bool, strip:
  // 'SET'|'DIRTY'|null (service), allergy: bool, selectable: bool }
  tableState = {},
  restrictionsByLabel = {}, // { [label]: [{ pos, note }] } → amber seat dots
  onTableTap,
  onStripTap,               // (label) — service mode status strip
  onSeatTap,                // (label, seatIndex) — seats mode
  onTableMove,              // (label, x, y) — edit mode, on release
  onSeatMove,               // (label, seatIndex, {x, y}) — edit mode, on release
  seatsOverride = {},       // { [label]: seats[] } — seats-mode preview
  seatsEditLabel = null,    // seats mode: the table being renumbered
  selectedLabel = null,     // edit mode: highlighted table
  // SHEET editing (edit mode only): the active tool decides what a canvas
  // tap means; the editor owns tool state and commits through pure helpers.
  sheetTool = "move",       // 'move' | 'wall' | 'door' | 'zone' | 'plant'
  sheetDraft = null,        // wall-in-progress points [[x,y],…]
  sheetSel = null,          // { kind: 'wall'|'door'|'zone'|'planter', id }
  onCanvasTap,              // ({x, y}) — tap with a stamp/draw tool active
  onSheetSelect,            // (hit | null) — MOVE-tool tap
  onSheetMove,              // (kind, id, x, y) — zone/planter drag, on release
  titleIndex = null,        // blueprint modes: this map's DWG number (0-based)
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
  const stampTool = sheetEditing && sheetTool !== "move";
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
    gestureRef.current = { kind: "table", label: t.label, start: p, origin: { x: t.x, y: t.y } };
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
    if (g.kind === "table") setDrag({ label: g.label, dx, dy, moved });
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
    if (sheetTool === "move") {
      const hit = hitTestSheet(sheetData, p);
      if (hit && (hit.kind === "zone" || hit.kind === "planter")) {
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
    if (sheetTool === "move") onSheetSelect && onSheetSelect(g.hit || null);
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
      <style>{`
        @keyframes fmStripPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
        .fm-strip-pulse { animation: fmStripPulse 1.6s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .fm-strip-pulse { animation: none; } }
      `}</style>

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

      {(map.tables || []).map((t0, ti) => {
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
        const dirty = !!st.dirty;
        const strip = mode === "service" ? (st.strip || null) : null;
        const pickable = mode === "picker" ? st.selectable !== false && !occupied && !arriving : false;
        const seatEditing = mode === "seats" && seatsEditLabel === t.label;
        const selected = editing && selectedLabel === t.label;
        const dimmed = (mode === "picker" && !pickable) || (mode === "seats" && seatsEditLabel && !seatEditing);

        const fill = occupied ? tokens.green.bg : tokens.neutral[0];
        const stroke = arriving ? tokens.ink[1]
          : occupied ? tokens.green.border
          : reserved ? tokens.ink[3]
          : dirty ? tokens.signal.warn
          : blueprint ? tokens.ink[1]
          : tokens.ink[4];

        const cx = t.x + t.w / 2;
        const restr = restrictionsByLabel[t.label] || [];
        const seatPts = seatDisplayPoints(t);

        // service-mode strip geometry: rendered ~30% of table height, the
        // invisible hit rect ≥40% so a thumb can't miss it on a phone.
        const stripH = Math.max(t.h * 0.3, 2.2);
        const hitH = Math.max(t.h * 0.4, 4);
        const clipId = `fm-strip-${ti}`;

        return (
          <g
            key={t.label}
            data-table={t.label}
            opacity={dimmed ? 0.4 : stampTool ? 0.35 : 1}
            pointerEvents={stampTool ? "none" : undefined}
            style={{ cursor: editing ? "grab" : pickable || (mode !== "seats" && onTableTap) ? "pointer" : "default" }}
            onPointerDown={onTablePointerDown(t0)}
            onPointerMove={editing ? onPointerMove : undefined}
            onPointerUp={editing ? onPointerUp(t0) : undefined}
            onClick={() => {
              if (editing || mode === "seats") return; // taps handled elsewhere
              if (mode === "picker" && !pickable) return;
              onTableTap && onTableTap(t0);
            }}
          >
            {/* DIRTY (view modes): amber band along the top edge */}
            <TableShape t={t} fill={fill} stroke={stroke} strokeWidth={blueprint ? 0.45 : 0.35}
              dash={arriving || reserved ? "1.4 1" : undefined} />
            {dirty && !strip && (
              <rect x={t.x} y={t.y} width={t.w} height={1.6} fill={tokens.signal.warn} />
            )}
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

            {/* label + party */}
            <text x={cx} y={t.y + (occupied || arriving || reserved ? 3.4 : t.h / 2 + 1)} textAnchor="middle"
              fontFamily={FONT} fontSize={2.8} fontWeight={700}
              fill={arriving ? tokens.ink[0] : occupied ? tokens.green.text : tokens.ink[2]}>
              {t.label}
            </text>
            {(occupied || arriving || reserved) && (
              <text x={cx} y={t.y + 6.2} textAnchor="middle" fontFamily={FONT} fontSize={2.3} fill={tokens.ink[1]}>
                {truncate(st.name, 12)}{st.pax ? ` ×${st.pax}` : ""}
              </text>
            )}
            {(occupied || arriving || reserved) && st.sub && (
              <text x={cx} y={t.y + 8.6} textAnchor="middle" fontFamily={FONT} fontSize={2} fill={tokens.ink[2]}>
                {truncate(st.sub, 16)}
              </text>
            )}
            {/* allergy marker — the room's only red-adjacent signal */}
            {st.allergy && (
              <text x={t.x + t.w - 1.2} y={t.y + 3.2} textAnchor="end" fontFamily={FONT}
                fontSize={2.6} fontWeight={700} fill={tokens.signal.alert}>▲</text>
            )}
            {dirty && !occupied && !arriving && !strip && (
              <text x={cx} y={t.y + t.h - 1.4} textAnchor="middle" fontFamily={FONT} fontSize={2}
                fill={tokens.signal.warn} fontWeight={700}>DIRTY</text>
            )}
            {st.badge && (
              <g>
                <rect x={cx - 8} y={t.y + t.h + 0.8} width={16} height={3.4}
                  fill={st.badge.tone === "warn" ? tokens.signal.warn : tokens.ink[0]} />
                <text x={cx} y={t.y + t.h + 3.2} textAnchor="middle" fontFamily={FONT} fontSize={2}
                  fill={tokens.neutral[0]} letterSpacing={0.2}>
                  {st.badge.text}
                </text>
              </g>
            )}

            {/* service-mode status strip — the second tap zone */}
            {mode === "service" && (
              <g>
                {t.shape === "round" && (
                  <clipPath id={clipId}>
                    <circle cx={cx} cy={t.y + t.h / 2} r={Math.min(t.w, t.h) / 2 - 0.2} />
                  </clipPath>
                )}
                <g clipPath={t.shape === "round" ? `url(#${clipId})` : undefined}>
                  <rect
                    className={strip === "DIRTY" ? "fm-strip-pulse" : undefined}
                    x={t.x} y={t.y + t.h - stripH} width={t.w} height={stripH}
                    fill={strip === "SET" ? tokens.green.strong : strip === "DIRTY" ? tokens.signal.warn : tokens.ink[5]} />
                  <text x={cx} y={t.y + t.h - stripH / 2 + 0.8} textAnchor="middle" fontFamily={FONT}
                    fontSize={1.9} fontWeight={700} letterSpacing={0.3}
                    fill={strip ? tokens.neutral[0] : tokens.ink[3]}>
                    {strip || "···"}
                  </text>
                </g>
                <rect
                  x={t.x} y={t.y + t.h - hitH} width={t.w} height={hitH}
                  fill="transparent"
                  style={{ cursor: "pointer" }}
                  data-strip={t.label}
                  onClick={(e) => {
                    e.stopPropagation();
                    onStripTap && onStripTap(t.label);
                  }}
                />
              </g>
            )}

            {/* chair marks. Two registers: the editing contexts (seats
                renumber, edit mode) keep numbered dots — the number IS the
                thing being edited — while the presentation modes (view,
                picker, service) draw the mockup's chair bars along the edge,
                numbers hidden except on restricted seats (amber + code). */}
            {seatPts.map((p, i) => {
              const seatRestr = restr.filter((r) => Number(r.pos) === Number(p.no) && p.no != null);
              const hasRestr = seatRestr.length > 0;
              const draggingSeat = seatDrag?.moved && seatDrag.label === t.label && seatDrag.index === i;
              const sx = draggingSeat ? seatDrag.x : p.x + p.out.x * 2.4;
              const sy = draggingSeat ? seatDrag.y : p.y + p.out.y * 2.4;
              const seatDraggable = editing && selectedLabel === t.label;
              const numbered = mode === "seats" || editing;
              const deg = Math.atan2(p.out.y, p.out.x) * 180 / Math.PI;
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
                        fill={hasRestr ? tokens.signal.warn : tokens.neutral[0]}
                        stroke={hasRestr ? tokens.signal.warn : seatEditing || seatDraggable ? tokens.ink[1] : tokens.ink[3]}
                        strokeWidth={0.3} />
                      <text x={sx} y={sy + 0.75} textAnchor="middle" fontFamily={FONT} fontSize={2}
                        fill={hasRestr ? tokens.neutral[0] : tokens.ink[1]} fontWeight={700}>
                        {p.no == null ? "·" : `${p.no}${p.confirm ? "?" : ""}`}
                      </text>
                    </>
                  ) : (
                    <g transform={`translate(${sx},${sy}) rotate(${deg})`}>
                      <rect x={-0.55} y={-1.7} width={1.1} height={3.4}
                        fill={hasRestr ? tokens.signal.warn : tokens.ink[5]}
                        stroke={hasRestr ? tokens.signal.warn : tokens.ink[4]}
                        strokeWidth={0.25} />
                    </g>
                  )}
                  {hasRestr && (
                    <text x={sx + p.out.x * 3.2} y={sy + p.out.y * 3.2 + 0.7}
                      textAnchor="middle" fontFamily={FONT} fontSize={1.8}
                      fill={tokens.signal.warn} fontWeight={700}>
                      {restrictionCode(seatRestr[0].note)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}

      {blueprint && titleIndex != null && <TitleBlock name={map.name} idx={titleIndex} />}

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
