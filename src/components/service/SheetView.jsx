import { useEffect, useMemo, useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { useIsMobile, BP } from "../../hooks/useIsMobile.js";
import { parseHHMM } from "../../utils/tableHelpers.js";
import { restrLabel } from "../../constants/dietary.js";
import { getVisibleCoursesForTable, getCourseProgressState } from "../../utils/courseProgress.js";
import { fireGapsForTable, estimateNextFire } from "../../utils/fireCadence.js";

const F = tokens.font;

// ── Shared micro-styles ────────────────────────────────────────
const lbl = { fontFamily: F, fontSize: "8px", letterSpacing: "0.14em", color: tokens.ink[3], textTransform: "uppercase" };
const val = { fontFamily: F, fontSize: "11px", color: tokens.ink[0], textTransform: "uppercase", letterSpacing: "0.03em" };
const hr  = { height: 1, background: tokens.ink[4] };
// Every variable-length text cell gets this — grid/flex children default to
// min-width:auto, which is what made long values overlap adjacent columns.
const clip = { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

function SecHead({ label, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <span style={{ ...lbl, color: tokens.ink[2], fontWeight: 500, flexShrink: 0 }}>[{label}]</span>
      <div style={{ flex: 1, ...hr }} />
      {right != null && <span style={{ ...lbl, flexShrink: 0 }}>{right}</span>}
    </div>
  );
}

// ── Data helpers ──────────────────────────────────────────────
// Minutes elapsed since an HH:MM timestamp. Negative values (clock skew, or a
// service that crossed midnight) are normalised into 0…24h.
function minutesSince(hhmm, now = new Date()) {
  const t = parseHHMM(hhmm);
  if (t == null) return null;
  let diff = (now.getHours() * 60 + now.getMinutes()) - t;
  if (diff < 0) diff += 24 * 60;
  return diff;
}

const fmtDur = m =>
  m < 60 ? `${m} MIN` : `${Math.floor(m / 60)}H ${String(m % 60).padStart(2, "0")}M`;

function sortedTableList(tables) {
  return tables
    .filter(t => t.active || t.resName || t.resTime)
    .filter(t => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup))
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return (a.arrivedAt || a.resTime || "99").localeCompare(b.arrivedAt || b.resTime || "99");
    });
}

// ── Left: compact table list ───────────────────────────────────
function TableListItem({ t, selected, onClick }) {
  const active = t.active;
  const statusColor = active ? tokens.green.text : tokens.ink[3];
  return (
    <button
      type="button"
      onClick={() => onClick(t.id)}
      style={{
        textAlign: "left", display: "grid",
        gridTemplateColumns: "30px minmax(0,1fr) auto",
        alignItems: "center", gap: 6,
        padding: "7px 10px",
        background: selected ? tokens.tint.parchment : "transparent",
        border: `1px solid ${selected ? tokens.charcoal.default : "transparent"}`,
        borderBottom: `1px solid ${tokens.ink[5]}`,
        borderRadius: 0, cursor: "pointer", width: "100%", fontFamily: F,
        touchAction: "manipulation",
      }}
    >
      <span style={{ fontSize: "11px", fontWeight: 600, color: tokens.ink[0] }}>
        T{String(t.id).padStart(2, "0")}
      </span>
      <span style={{ fontSize: "10px", color: tokens.ink[1], ...clip }}>
        {t.resName || "—"}
      </span>
      <span style={{ fontSize: "8px", letterSpacing: "0.10em", textTransform: "uppercase", color: statusColor, flexShrink: 0 }}>
        {active ? (t.arrivedAt ? "●SIT" : "●ACT") : "○RES"}
      </span>
    </button>
  );
}

// ── Center: identity strip ────────────────────────────────────
// Big table number anchors the sheet (per the R.I.S design reference);
// menu type + language sit under it, descriptive cells flow to the right.
function IdentityStrip({ table, isMobile }) {
  const cells = [
    ["NAME",    table.resName || "—"],
    ["PAX",     table.guests || table.seats?.length || "—"],
    ["RESV",    table.resTime || "—"],
    ["ARRIVED", table.arrivedAt || "—", table.arrivedAt ? tokens.green.text : tokens.ink[3]],
    ["STATE",   table.active ? "SEATED" : "RESERVED", table.active ? tokens.green.strong : tokens.ink[3]],
  ];
  return (
    <div style={{
      display: "flex", alignItems: "flex-end", gap: isMobile ? 14 : 20,
      borderBottom: `1px solid ${tokens.ink[3]}`,
      paddingBottom: 10, marginBottom: 12,
    }}>
      <div style={{ flexShrink: 0 }}>
        <div style={{
          fontFamily: F, fontSize: isMobile ? "32px" : "44px", fontWeight: 600,
          lineHeight: 1, letterSpacing: "0.01em", color: tokens.ink[0],
        }}>
          T{String(table.id).padStart(2, "0")}
        </div>
        <div style={{ ...lbl, fontSize: "9px", color: tokens.ink[2], marginTop: 3 }}>
          {(table.menuType || "—")} · {(table.lang || "en")}
        </div>
      </div>
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "repeat(3, minmax(0,1fr))" : "repeat(5, minmax(0,auto))",
        gap: isMobile ? "6px 8px" : "4px 18px",
        flex: 1, minWidth: 0, paddingBottom: 2,
      }}>
        {cells.map(([label, value, color]) => (
          <div key={label} style={{ minWidth: 0 }}>
            <div style={{ ...lbl, ...clip }}>{label}</div>
            <div style={{ ...val, ...clip, color: color || tokens.ink[0] }}>
              {value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Center: course progression dots ───────────────────────────
// The full-service map from the design reference: one numbered dot per
// course — filled = out, ringed = current (latest out), empty = pending.
function CourseDots({ courses, isMobile }) {
  if (courses.length === 0) return null;
  let currentIdx = -1;
  for (let i = courses.length - 1; i >= 0; i--) {
    if (courses[i].firedAt) { currentIdx = i; break; }
  }
  const dotSize = isMobile ? 9 : 10;
  const legend = [
    ["●", "OUT", tokens.green.text],
    ["◉", "CURRENT", tokens.ink[0]],
    ["○", "PENDING", tokens.ink[3]],
  ];
  return (
    <div style={{ marginBottom: 14 }}>
      <SecHead label="COURSE PROGRESSION" />
      <div style={{ display: "flex", flexWrap: "wrap", gap: isMobile ? "8px 7px" : "8px 9px", padding: "6px 0 4px" }}>
        {courses.map((c, i) => {
          const fired = !!c.firedAt;
          const isCur = i === currentIdx;
          return (
            <div key={c.key} title={`${String(c.index).padStart(2, "0")} ${c.name}${c.firedAt ? ` · OUT ${c.firedAt}` : ""}`}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, width: isMobile ? 16 : 18 }}>
              <span style={{
                fontFamily: F, fontSize: "7px", letterSpacing: "0.06em",
                color: isCur ? tokens.ink[0] : fired ? tokens.ink[2] : tokens.ink[4],
                fontWeight: isCur ? 600 : 400,
              }}>
                {String(c.index).padStart(2, "0")}
              </span>
              <span style={{
                width: dotSize, height: dotSize, borderRadius: "50%", boxSizing: "border-box",
                background: fired ? tokens.green.text : "transparent",
                border: isCur
                  ? `2px solid ${tokens.ink[0]}`
                  : `1px solid ${fired ? tokens.green.text : tokens.ink[4]}`,
              }} />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 14, paddingTop: 2 }}>
        {legend.map(([glyph, text, color]) => (
          <span key={text} style={{ ...lbl, fontSize: "7.5px", color }}>
            {glyph} {text}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Center: compact course state window ───────────────────────
// Shows PREVIOUS / CURRENT / NEXT FIRE derived from getCourseProgressState().
function CourseSection({ progressState, isMobile }) {
  const { previous, current, nextFire, allComplete, firedCount, total } = progressState;

  const Row = ({ label, c, emphasis, placeholder }) => {
    const isStrong = emphasis === "strong";
    const isMuted  = emphasis === "muted";
    const labelColor = isStrong ? tokens.ink[1] : tokens.ink[3];
    const numColor   = isStrong ? tokens.ink[0] : isMuted ? tokens.ink[3] : tokens.ink[2];
    const nameColor  = isStrong ? tokens.ink[0] : isMuted ? tokens.ink[3] : tokens.ink[1];
    const nameWeight = isStrong ? 600 : isMuted ? 400 : 500;
    const rowHeight  = isStrong ? 34 : 30;
    const nameSize   = isStrong ? (isMobile ? "12px" : "13px") : "11px";

    return (
      <div style={{
        display: "grid",
        gridTemplateColumns: isMobile ? "52px 22px minmax(0,1fr) 62px" : "80px 28px minmax(0,1fr) 84px",
        alignItems: "center", gap: isMobile ? 6 : 8,
        height: rowHeight,
        borderBottom: `1px solid ${tokens.ink[5]}`,
        fontFamily: F,
      }}>
        <span style={{ ...lbl, ...clip, color: labelColor, fontWeight: isStrong ? 600 : 500 }}>
          {label}
        </span>
        <span style={{ fontSize: "10px", color: numColor, letterSpacing: "0.06em", fontWeight: isStrong ? 600 : 400 }}>
          {c ? String(c.index).padStart(2, "0") : "—"}
        </span>
        <span style={{
          ...clip,
          fontSize: nameSize, color: nameColor, fontWeight: nameWeight,
          textTransform: "uppercase", letterSpacing: "0.04em",
        }}>
          {c ? c.name : (placeholder || "—")}
        </span>
        <span style={{ ...clip, fontSize: isMobile ? "9px" : "10px", color: c?.firedAt ? tokens.green.text : tokens.ink[4], textAlign: "right", letterSpacing: "0.04em" }}>
          {c?.firedAt ? `OUT ${c.firedAt}` : "—"}
        </span>
      </div>
    );
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <SecHead
        label="COURSE STATE"
        right={`${String(firedCount).padStart(2, "0")} / ${String(total).padStart(2, "0")} OUT`}
      />
      {/* PREVIOUS = fired course before current */}
      <Row label={isMobile ? "PREV" : "PREVIOUS"} c={previous} emphasis="muted" />
      {/* CURRENT = latest fired course / what is on the table */}
      <Row
        label={isMobile ? "NOW" : "CURRENT"}
        c={current}
        emphasis="strong"
        placeholder={total === 0 ? "—" : "WAITING"}
      />
      {/* NEXT FIRE = first unfired after current */}
      <Row
        label={isMobile ? "NEXT" : "NEXT FIRE"}
        c={allComplete ? null : nextFire}
        emphasis="default"
        placeholder={allComplete ? "COMPLETE" : "—"}
      />
    </div>
  );
}

// ── Center: guest matrix ──────────────────────────────────────
function GuestMatrix({ table, isMobile }) {
  const seats = table.seats || [];
  const restrByPos = new Map();
  (table.restrictions || []).forEach(r => {
    if (r?.pos != null) {
      const arr = restrByPos.get(r.pos) || [];
      arr.push(r);
      restrByPos.set(r.pos, arr);
    }
  });
  const cols = isMobile
    ? "26px minmax(0,1fr) 52px minmax(0,72px)"
    : "32px minmax(0,1fr) 80px minmax(0,96px)";
  return (
    <div style={{ marginBottom: 14 }}>
      <SecHead label="GUEST MATRIX" right={`${seats.length} PAX`} />
      {/* column headers */}
      <div style={{ display: "grid", gridTemplateColumns: cols, gap: isMobile ? 6 : 8, height: 22, alignItems: "center", borderBottom: `1px solid ${tokens.ink[4]}`, marginBottom: 2 }}>
        {["SEAT","NOTES","WATER","PAIRING"].map(h => (
          <span key={h} style={{ ...lbl, ...clip, fontSize: "7.5px" }}>{h}</span>
        ))}
      </div>
      {seats.length === 0 && (
        <div style={{ ...lbl, color: tokens.ink[4], padding: "6px 0" }}>NO SEATS</div>
      )}
      {seats.map(seat => {
        const r = restrByPos.get(seat.id) || [];
        const rText = r.length ? r.map(x => restrLabel(x.note) || x.note).join(" · ") : "—";
        const water   = (seat.water   && seat.water   !== "—") ? seat.water   : "—";
        const pairing = (seat.pairing && seat.pairing !== "—") ? seat.pairing : "—";
        return (
          <div key={seat.id} style={{
            display: "grid", gridTemplateColumns: cols,
            alignItems: "center", gap: isMobile ? 6 : 8, height: 28,
            borderBottom: `1px solid ${tokens.ink[5]}`, fontFamily: F,
          }}>
            <span style={{ fontSize: "10px", color: tokens.ink[2], fontWeight: 500 }}>P{seat.id}</span>
            <span style={{ ...clip, fontSize: "10px", color: r.length ? tokens.red.text : tokens.ink[3], textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {rText}
            </span>
            <span style={{ ...clip, fontSize: "10px", color: water !== "—" ? tokens.ink[1] : tokens.ink[4], textTransform: "uppercase" }}>{water}</span>
            <span style={{ ...clip, fontSize: "10px", color: pairing !== "—" ? tokens.ink[1] : tokens.ink[4], textTransform: "uppercase", letterSpacing: "0.03em" }}>
              {pairing}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Center: action strip ──────────────────────────────────────
function ActionStrip({ table, progressState, onFireNext, onUndoFire, onOpenDetail, onSeat, onUnseat, isMobile }) {
  const { nextFire, current } = progressState;
  const canFire = table.active && !!nextFire;

  const btn = (label, onClick, opts = {}) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      disabled={!!opts.disabled}
      style={{
        fontFamily: F, fontSize: "9px", letterSpacing: "0.10em", textTransform: "uppercase",
        padding: isMobile ? "10px 12px" : "7px 10px",
        border: `1px solid ${opts.primary ? tokens.charcoal.default : tokens.ink[4]}`,
        background: opts.primary ? tokens.charcoal.default : tokens.neutral[0],
        color: opts.primary ? tokens.neutral[0] : tokens.ink[1],
        borderRadius: 0, cursor: opts.disabled ? "not-allowed" : "pointer",
        opacity: opts.disabled ? 0.4 : 1, touchAction: "manipulation",
        // Long course names must truncate inside the button, never push the
        // strip wider than the viewport.
        maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        flexShrink: 1, minWidth: 0,
      }}
    >
      {label}
    </button>
  );

  const fireLabel = canFire
    ? (isMobile
        ? `FIRE C${String(nextFire.index).padStart(2, "0")}`
        : `FIRE C${String(nextFire.index).padStart(2, "0")} · ${nextFire.name}`)
    : "FIRE NEXT";

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingTop: 10, borderTop: `1px solid ${tokens.ink[4]}`, marginBottom: 14 }}>
      {btn(fireLabel, () => canFire && onFireNext(nextFire.key), { primary: true, disabled: !canFire })}
      {current && btn("UNDO LAST FIRE", () => onUndoFire(current.key))}
      {table.active
        ? btn("UNSEAT", () => onUnseat(table.id))
        : btn("SEAT",   () => onSeat(table.id))
      }
      {btn("EDIT · DETAIL", () => onOpenDetail(table.id))}
    </div>
  );
}

// ── Right: alerts rail ────────────────────────────────────────
// `intel` = live computed signals (seated duration, fire cadence, room pace)
// rendered as plain glyph rows; boxed items are reserved for true alerts.
function AlertsRail({ table, intel = [] }) {
  const items = [];
  (table.restrictions || []).forEach((r, i) => {
    const desc = r?.pos != null
      ? `P${r.pos} · ${restrLabel(r.note) || r.note}`
      : (restrLabel(r.note) || r.note);
    items.push({ key: `r${i}`, tone: "alert", text: desc });
  });
  if (table.birthday) items.push({ key: "bday", tone: "warn", text: table.cakeNote ? `BIRTHDAY · ${table.cakeNote}` : "BIRTHDAY" });
  if (table.pace)     items.push({ key: "pace", tone: "warn", text: `PACE · ${String(table.pace).toUpperCase()}` });
  if (table.notes?.trim()) items.push({ key: "note", tone: "info", text: table.notes.trim() });

  return (
    <div style={{ marginBottom: 14, minWidth: 0 }}>
      <SecHead label="ALERTS · INTELLIGENCE" right={String(items.length)} />
      {items.length === 0 && intel.length === 0
        ? <div style={{ ...lbl, color: tokens.ink[4], padding: "4px 0" }}>NO ACTIVE ALERTS</div>
        : items.map(it => {
            const { bg, border, color } =
              it.tone === "alert" ? { bg: tokens.red.bg,      border: tokens.red.border,  color: tokens.red.text   } :
              it.tone === "warn"  ? { bg: tokens.neutral[50], border: tokens.ink[4],       color: tokens.signal.warn } :
                                    { bg: "transparent",      border: tokens.ink[4],       color: tokens.ink[1]     };
            return (
              <div key={it.key} style={{
                fontFamily: F, fontSize: "10px", padding: "6px 8px",
                background: bg, border: `1px solid ${border}`, color, letterSpacing: "0.04em",
                lineHeight: 1.3, marginBottom: 4, overflowWrap: "anywhere",
              }}>
                {it.text}
              </div>
            );
          })
      }
      {intel.map(sig => {
        const color = sig.tone === "warn" ? tokens.signal.warn
          : sig.tone === "ok" ? tokens.green.text
          : tokens.ink[2];
        return (
          <div key={sig.key} style={{
            display: "grid", gridTemplateColumns: "16px minmax(0,1fr) auto",
            alignItems: "center", gap: 6, height: 26,
            borderBottom: `1px solid ${tokens.ink[5]}`, fontFamily: F,
          }}>
            <span style={{ fontSize: "10px", color, textAlign: "center" }}>{sig.glyph}</span>
            <span style={{ ...clip, fontSize: "10px", letterSpacing: "0.06em", textTransform: "uppercase", color: sig.tone === "warn" ? tokens.signal.warn : tokens.ink[1] }}>
              {sig.text}
            </span>
            {sig.detail != null && (
              <span style={{ fontSize: "9px", letterSpacing: "0.04em", color: tokens.ink[3], flexShrink: 0 }}>{sig.detail}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Right: timeline rail ──────────────────────────────────────
function TimelineRail({ table, courses }) {
  const events = [];
  if (table.resTime && !table.arrivedAt) events.push({ at: table.resTime, label: "RESV" });
  if (table.arrivedAt)                   events.push({ at: table.arrivedAt, label: "ARRIVED" });
  courses.forEach(c => {
    if (c.firedAt) events.push({ at: c.firedAt, label: `C${String(c.index).padStart(2,"0")} OUT · ${c.name}` });
  });
  events.sort((a, b) => (a.at || "").localeCompare(b.at || ""));

  return (
    <div style={{ minWidth: 0 }}>
      <SecHead label="TIMELINE" right={String(events.length)} />
      {events.length === 0
        ? <div style={{ ...lbl, color: tokens.ink[4], padding: "4px 0" }}>NO COURSE TIMESTAMPS YET</div>
        : events.map((e, i) => (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "42px minmax(0,1fr)",
              alignItems: "center", gap: 8, height: 28,
              borderBottom: `1px solid ${tokens.ink[5]}`, fontFamily: F,
            }}>
              <span style={{ fontSize: "9px", color: tokens.ink[3], letterSpacing: "0.06em" }}>{e.at}</span>
              <span style={{ ...clip, fontSize: "10px", color: tokens.ink[1], textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {e.label}
              </span>
            </div>
          ))
      }
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────
function EmptySheet() {
  return (
    <div style={{
      fontFamily: F, fontSize: "10px", letterSpacing: "0.14em", color: tokens.ink[3],
      textTransform: "uppercase", textAlign: "center", padding: "32px 16px",
      border: `1px dashed ${tokens.ink[4]}`,
    }}>
      Select a table from the list
    </div>
  );
}

// ── Root export ───────────────────────────────────────────────
export default function SheetView({
  tables,
  menuCourses,
  selectedId,
  onSelect,
  onOpenDetail,
  onFireNext,
  onUndoFire,
  onSeat,
  onUnseat,
  profiles = [],
  assignments = {},
}) {
  // Three tiers: phone (single column), tablet (list + sheet, rails fold into
  // the sheet), desktop (full three-column layout from the design reference).
  const isMobile  = useIsMobile(BP.md);   // < 700
  const isCompact = useIsMobile(1080);    // < 1080 — not enough room for 3 cols

  const list = useMemo(() => sortedTableList(tables), [tables]);

  // Auto-select first table if nothing selected yet (or selection vanished)
  const effectiveId = selectedId != null && list.some(t => t.id === selectedId)
    ? selectedId
    : (list[0]?.id ?? null);

  const table = useMemo(() => list.find(t => t.id === effectiveId) || null, [list, effectiveId]);

  // Use shared helper so course list matches KitchenBoard exactly. When a
  // kitchen profile is assigned for this table.menuType, the profile's
  // row-based menuTemplate drives course visibility/order; otherwise the
  // legacy show_on_short / position path is used.
  const courses = useMemo(
    () => (table
      ? getVisibleCoursesForTable(table, menuCourses, { profiles, assignments })
      : []),
    [table, menuCourses, profiles, assignments],
  );

  const progressState = useMemo(() => getCourseProgressState(table, courses), [table, courses]);

  // Live clock — re-derives elapsed-time intelligence every 30s while open.
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setClockTick(t => t + 1), 30 * 1000);
    return () => clearInterval(id);
  }, []);

  // One pass over the room's active tables feeds both pace comparison and
  // the pooled fire-interval cadence used when this table lacks history.
  const roomStats = useMemo(() => {
    const gaps = [];
    const otherFracs = [];
    tables.filter(t => t.active).forEach(t => {
      const cs = getVisibleCoursesForTable(t, menuCourses, { profiles, assignments });
      gaps.push(...fireGapsForTable(t, cs));
      if (table && t.id !== table.id && cs.length) {
        otherFracs.push(cs.filter(c => c.firedAt).length / cs.length);
      }
    });
    return { gaps, otherFracs };
  }, [tables, menuCourses, profiles, assignments, table]);

  // ── Intelligence signals — derived live, no stored state ────
  //  · SEATED <duration>      — time since arrival
  //  · LAST FIRE <n> MIN AGO  — fire recency
  //  · C0X DUE IN ~N MIN      — next course extrapolated from tonight's
  //                             fire rhythm (table's own, else the room's)
  //  · AHEAD/BEHIND ROOM      — this table's progress vs. other active tables
  const intel = useMemo(() => {
    if (!table) return [];
    const out = [];
    const { nextFire, firedCount, total, allComplete } = progressState;
    const now = new Date();

    if (table.active && table.arrivedAt) {
      const m = minutesSince(table.arrivedAt, now);
      if (m != null) out.push({ key: "seated", glyph: "●", tone: "ok", text: `SEATED ${fmtDur(m)}`, detail: table.arrivedAt });
    }

    // Prediction beats the static "NO FIRE" threshold, so the dumb warning
    // only fires when no estimate could be derived.
    const est = (table.active && nextFire)
      ? estimateNextFire({ table, courses, roomGaps: roomStats.gaps, now })
      : null;
    // An estimate more than 45 min overdue means stale data, not a late
    // course (e.g. reviewing an old service) — say nothing rather than nag.
    const showEst = est && est.dueInMin >= -45;

    if (allComplete && total > 0) {
      out.push({ key: "complete", glyph: "✓", tone: "ok", text: "ALL COURSES OUT" });
    } else if (firedCount > 0) {
      const lastFiredAt = courses.filter(c => c.firedAt).map(c => c.firedAt).sort().pop();
      const m = minutesSince(lastFiredAt, now);
      if (m != null) {
        const stuck = m >= 25 && !showEst;
        out.push({
          key: "cadence", glyph: stuck ? "!" : "↻",
          tone: stuck ? "warn" : "info",
          text: stuck ? `NO FIRE FOR ${fmtDur(m)}` : `LAST FIRE ${fmtDur(m)} AGO`,
          detail: lastFiredAt,
        });
      }
    }

    if (showEst) {
      const cLabel = `C${String(nextFire.index).padStart(2, "0")}`;
      const pace = `~${est.cadenceMin}M ${est.basis === "room" ? "ROOM" : "TBL"} PACE`;
      if (est.dueInMin > 1) {
        out.push({ key: "due", glyph: "◷", tone: "info", text: `${cLabel} DUE IN ~${est.dueInMin} MIN`, detail: pace });
      } else if (est.dueInMin >= -2) {
        out.push({ key: "due", glyph: "◷", tone: "ok", text: `${cLabel} DUE NOW`, detail: pace });
      } else {
        out.push({ key: "due", glyph: "!", tone: "warn", text: `${cLabel} OVERDUE ~${-est.dueInMin} MIN`, detail: pace });
      }
    }

    if (table.active && total > 0 && !allComplete && roomStats.otherFracs.length > 0) {
      const room = roomStats.otherFracs.reduce((a, b) => a + b, 0) / roomStats.otherFracs.length;
      const diff = Math.round((firedCount / total - room) * total);
      if (diff >= 1)       out.push({ key: "pace", glyph: "↗", tone: "info", text: `AHEAD OF ROOM · ${diff} COURSE${diff > 1 ? "S" : ""}` });
      else if (diff <= -1) out.push({ key: "pace", glyph: "↘", tone: "warn", text: `BEHIND ROOM · ${-diff} COURSE${diff < -1 ? "S" : ""}` });
      else                 out.push({ key: "pace", glyph: "→", tone: "ok",   text: "ON PACE WITH ROOM" });
    }
    return out;
  }, [table, courses, progressState, roomStats, clockTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const sheetBody = table && (
    <>
      <IdentityStrip table={table} isMobile={isMobile} />
      <CourseDots courses={courses} isMobile={isMobile} />
      {isCompact ? (
        <CourseSection progressState={progressState} isMobile={isMobile} />
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }}>
          <CourseSection progressState={progressState} isMobile={false} />
          <GuestMatrix table={table} isMobile={false} />
        </div>
      )}
      <ActionStrip
        table={table}
        progressState={progressState}
        onFireNext={key => onFireNext(table.id, key)}
        onUndoFire={key => onUndoFire(table.id, key)}
        onOpenDetail={onOpenDetail}
        onSeat={onSeat}
        onUnseat={onUnseat}
        isMobile={isMobile}
      />
      {isCompact && <GuestMatrix table={table} isMobile={isMobile} />}
    </>
  );

  const rails = table && (
    <>
      <AlertsRail table={table} intel={intel} />
      <TimelineRail table={table} courses={courses} />
    </>
  );

  // ── MOBILE: chip selector + single stacked column ───────────
  if (isMobile) {
    return (
      <div style={{ padding: "0 12px 40px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        {/* horizontal table selector */}
        <div style={{ display: "flex", gap: 4, overflowX: "auto", paddingBottom: 4, WebkitOverflowScrolling: "touch" }}>
          {list.map(t => {
            const on = t.id === effectiveId;
            return (
              <button key={t.id} type="button" onClick={() => onSelect(t.id)} style={{
                fontFamily: F, fontSize: "9px", letterSpacing: "0.10em", textTransform: "uppercase",
                padding: "8px 10px", flexShrink: 0, borderRadius: 0,
                border: `1px solid ${on ? tokens.charcoal.default : tokens.ink[4]}`,
                background: on ? tokens.tint.parchment : tokens.neutral[0],
                color: t.active ? tokens.ink[0] : tokens.ink[2],
                fontWeight: on ? 600 : 400,
                maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                touchAction: "manipulation",
              }}>
                T{String(t.id).padStart(2, "0")}{t.resName ? ` · ${t.resName}` : ""}
              </button>
            );
          })}
        </div>
        {!table ? <EmptySheet /> : (
          <div style={{ background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}`, padding: 12, minWidth: 0 }}>
            {sheetBody}
            {rails}
          </div>
        )}
      </div>
    );
  }

  // ── TABLET: table index + sheet (rails fold into the sheet) ─
  if (isCompact) {
    return (
      <div style={{
        display: "grid",
        gridTemplateColumns: "190px minmax(0,1fr)",
        gap: 12,
        padding: "0 16px 48px",
        alignItems: "start",
      }}>
        <aside style={{
          position: "sticky", top: 12,
          maxHeight: "calc(100vh - 150px)", overflowY: "auto",
          background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}`,
        }}>
          <div style={{ padding: "8px 10px", borderBottom: `1px solid ${tokens.ink[4]}` }}>
            <SecHead label="TABLES" right={String(list.length)} />
          </div>
          {list.length === 0
            ? <div style={{ ...lbl, color: tokens.ink[4], padding: "10px" }}>NO TABLES</div>
            : list.map(t => (
                <TableListItem key={t.id} t={t} selected={t.id === effectiveId} onClick={onSelect} />
              ))
          }
        </aside>
        <main style={{ background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}`, padding: 14, minWidth: 0 }}>
          {!table ? <EmptySheet /> : (
            <>
              {sheetBody}
              <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 16 }}>
                {rails}
              </div>
            </>
          )}
        </main>
      </div>
    );
  }

  // ── DESKTOP: 3-column grid ──────────────────────────────────
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "220px minmax(0,1fr) 280px",
      gap: 16,
      padding: "0 24px 48px",
      alignItems: "start",
    }}>

      {/* LEFT — table index */}
      <aside style={{
        position: "sticky", top: 12,
        maxHeight: "calc(100vh - 150px)", overflowY: "auto",
        background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}`,
      }}>
        <div style={{ padding: "8px 10px", borderBottom: `1px solid ${tokens.ink[4]}` }}>
          <SecHead label="TABLES" right={String(list.length)} />
        </div>
        {list.length === 0
          ? <div style={{ ...lbl, color: tokens.ink[4], padding: "10px" }}>NO TABLES</div>
          : list.map(t => (
              <TableListItem key={t.id} t={t} selected={t.id === effectiveId} onClick={onSelect} />
            ))
        }
      </aside>

      {/* CENTER — selected table sheet */}
      <main style={{
        background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}`, padding: 16, minWidth: 0,
      }}>
        {!table ? <EmptySheet /> : sheetBody}
      </main>

      {/* RIGHT — intelligence rail */}
      <aside style={{
        position: "sticky", top: 12,
        background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}`,
        padding: 14, minWidth: 0,
      }}>
        {table ? rails : <div style={{ ...lbl, color: tokens.ink[4] }}>SELECT A TABLE</div>}
      </aside>

    </div>
  );
}
