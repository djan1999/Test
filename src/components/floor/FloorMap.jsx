import { useRef, useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { seatDisplayPoints, MAP_W, MAP_H } from "../../utils/floorMaps.js";

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
  height = 340,
}) {
  const svgRef = useRef(null);
  // Transient drag preview — geometry commits only on pointer release, so a
  // drag causes exactly one updateFloorMaps persist, not one per move event.
  const [drag, setDrag] = useState(null);     // { label, dx, dy, moved }
  const [seatDrag, setSeatDrag] = useState(null); // { label, index, x, y }
  const gestureRef = useRef(null);            // pointer bookkeeping between events

  if (!map) return null;
  const editing = mode === "edit";

  const toMapUnits = (e) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !r.width || !r.height) return null;
    return { x: ((e.clientX - r.left) / r.width) * MAP_W, y: ((e.clientY - r.top) / r.height) * MAP_H };
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
    else setSeatDrag({ label: g.label, index: g.index, x: p.x, y: p.y, moved });
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
        width: "100%", height, display: "block", background: tokens.ink.bg,
        border: `1px solid ${tokens.ink[4]}`,
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

      {editing && (
        <g>
          <defs>
            <pattern id="fm-grid" width="10" height="10" patternUnits="userSpaceOnUse">
              <path d="M10 0H0V10" fill="none" stroke={tokens.ink[5]} strokeWidth="0.25" />
            </pattern>
          </defs>
          <rect width={MAP_W} height={MAP_H} fill="url(#fm-grid)" />
        </g>
      )}

      {(map.tables || []).map((t0, ti) => {
        let t = seatsOverride[t0.label] ? { ...t0, seats: seatsOverride[t0.label] } : t0;
        // live drag preview (edit mode)
        if (drag?.moved && drag.label === t.label) {
          t = {
            ...t,
            x: clampPos(snap(t0.x + drag.dx), t0.w, MAP_W),
            y: clampPos(snap(t0.y + drag.dy), t0.h, MAP_H),
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
            opacity={dimmed ? 0.4 : 1}
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
            <TableShape t={t} fill={fill} stroke={stroke} dash={arriving || reserved ? "1.4 1" : undefined} />
            {dirty && !strip && (
              <rect x={t.x} y={t.y} width={t.w} height={1.6} fill={tokens.signal.warn} />
            )}
            {selected && (
              <TableShape t={{ ...t, x: t.x - 1.2, y: t.y - 1.2, w: t.w + 2.4, h: t.h + 2.4 }}
                fill="none" stroke={tokens.ink[0]} strokeWidth={0.4} dash="1.6 1.2" />
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
    </svg>
  );
}
