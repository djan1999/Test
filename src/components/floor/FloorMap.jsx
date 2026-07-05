import { tokens } from "../../styles/tokens.js";
import { seatDisplayPoints } from "../../utils/floorMaps.js";

// FloorMap — THE floor renderer. Every spatial surface (FOH terrace picker,
// kitchen floor view, admin seats editor) renders through this one component;
// do not fork it — add a mode instead.
//
//   mode "view"   read-only room (kitchen floor view)
//   mode "picker" free tables tappable, occupied/inert tables dimmed
//   mode "seats"  chair marks tappable for SEATS renumbering
//
// Geometry comes from utils/floorMaps.js (pure, tested); this file only
// paints. Design system: Roboto Mono, zero border-radius, ink grayscale,
// semantic color only (green = seated/SET, amber = DIRTY / restriction).

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

export default function FloorMap({
  map,
  mode = "view",
  // per-label presentation: { name, pax, sub, badge: {text, tone}, status:
  // 'free'|'occupied'|'arriving', dirty: bool, selectable: bool }
  tableState = {},
  restrictionsByLabel = {}, // { [label]: [{ pos, note }] } → amber seat dots
  onTableTap,
  onSeatTap,                // (label, seatIndex) — seats mode
  seatsOverride = {},       // { [label]: seats[] } — seats-mode preview
  seatsEditLabel = null,    // seats mode: the table being renumbered
  height = 340,
}) {
  if (!map) return null;
  const W = 100, H = 92;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height, display: "block", background: tokens.ink.bg, border: `1px solid ${tokens.ink[4]}` }}
      role="img"
      aria-label={`${map.name} floor map`}
    >
      {(map.tables || []).map((t0) => {
        const t = seatsOverride[t0.label] ? { ...t0, seats: seatsOverride[t0.label] } : t0;
        const st = tableState[t.label] || {};
        const occupied = st.status === "occupied";
        const arriving = st.status === "arriving";
        const dirty = !!st.dirty;
        const pickable = mode === "picker" ? st.selectable !== false && !occupied && !arriving : false;
        const seatEditing = mode === "seats" && seatsEditLabel === t.label;
        const dimmed = (mode === "picker" && !pickable) || (mode === "seats" && seatsEditLabel && !seatEditing);

        const fill = occupied ? tokens.green.bg : tokens.neutral[0];
        const stroke = arriving ? tokens.ink[1]
          : occupied ? tokens.green.border
          : dirty ? tokens.signal.warn
          : tokens.ink[4];

        const cx = t.x + t.w / 2;
        const restr = restrictionsByLabel[t.label] || [];
        const seatPts = seatDisplayPoints(t);

        return (
          <g
            key={t.label}
            opacity={dimmed ? 0.4 : 1}
            style={{ cursor: pickable || (mode !== "seats" && onTableTap) ? "pointer" : "default" }}
            onClick={() => {
              if (mode === "seats") return; // taps belong to the chair marks
              if (mode === "picker" && !pickable) return;
              onTableTap && onTableTap(t);
            }}
          >
            {/* DIRTY strip: amber band along the top edge, spec's semantic amber */}
            <TableShape t={t} fill={fill} stroke={stroke} dash={arriving ? "1.4 1" : undefined} />
            {dirty && (
              <rect x={t.x} y={t.y} width={t.w} height={1.6} fill={tokens.signal.warn} />
            )}

            {/* label + party */}
            <text x={cx} y={t.y + (occupied || arriving ? 3.4 : t.h / 2 + 1)} textAnchor="middle"
              fontFamily={FONT} fontSize={2.8} fontWeight={700}
              fill={arriving ? tokens.ink[0] : occupied ? tokens.green.text : tokens.ink[2]}>
              {t.label}
            </text>
            {(occupied || arriving) && (
              <text x={cx} y={t.y + 6.2} textAnchor="middle" fontFamily={FONT} fontSize={2.3} fill={tokens.ink[1]}>
                {truncate(st.name, 12)}{st.pax ? ` ×${st.pax}` : ""}
              </text>
            )}
            {(occupied || arriving) && st.sub && (
              <text x={cx} y={t.y + 8.6} textAnchor="middle" fontFamily={FONT} fontSize={2} fill={tokens.ink[2]}>
                {truncate(st.sub, 16)}
              </text>
            )}
            {dirty && !occupied && !arriving && (
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

            {/* seat dots — chair marks numbered per the house diagrams */}
            {seatPts.map((p, i) => {
              const seatRestr = restr.filter((r) => Number(r.pos) === Number(p.no) && p.no != null);
              const hasRestr = seatRestr.length > 0;
              const sx = p.x + p.out.x * 2.4;
              const sy = p.y + p.out.y * 2.4;
              return (
                <g key={i}
                  style={{ cursor: seatEditing ? "pointer" : "default" }}
                  onClick={(e) => {
                    if (!seatEditing) return;
                    e.stopPropagation();
                    onSeatTap && onSeatTap(t.label, i);
                  }}>
                  <circle cx={sx} cy={sy} r={1.7}
                    fill={hasRestr ? tokens.signal.warn : tokens.neutral[0]}
                    stroke={hasRestr ? tokens.signal.warn : seatEditing ? tokens.ink[1] : tokens.ink[3]}
                    strokeWidth={0.3} />
                  <text x={sx} y={sy + 0.75} textAnchor="middle" fontFamily={FONT} fontSize={2}
                    fill={hasRestr ? tokens.neutral[0] : tokens.ink[1]} fontWeight={700}>
                    {p.no == null ? "·" : `${p.no}${p.confirm ? "?" : ""}`}
                  </text>
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
