import { useMemo } from "react";
import { tokens } from "../../styles/tokens.js";
import { fmt } from "../../utils/tableHelpers.js";
import { restrLabel } from "../../constants/dietary.js";

const F = tokens.font;

// ── Shared micro-styles ────────────────────────────────────────
const lbl = { fontFamily: F, fontSize: "8px", letterSpacing: "0.14em", color: tokens.ink[3], textTransform: "uppercase" };
const val = { fontFamily: F, fontSize: "11px", color: tokens.ink[0], textTransform: "uppercase", letterSpacing: "0.03em" };
const hr  = { height: 1, background: tokens.ink[4] };

function SecHead({ label, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
      <span style={{ ...lbl, color: tokens.ink[2], fontWeight: 500 }}>[{label}]</span>
      <div style={{ flex: 1, ...hr }} />
      {right != null && <span style={{ ...lbl }}>{right}</span>}
    </div>
  );
}

// ── Data helpers ──────────────────────────────────────────────
function sortedTableList(tables) {
  return tables
    .filter(t => t.active || t.resName || t.resTime)
    .filter(t => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup))
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return (a.arrivedAt || a.resTime || "99").localeCompare(b.arrivedAt || b.resTime || "99");
    });
}

function buildCourses(table, menuCourses) {
  const log = table.kitchenLog || {};
  const overrides = table.kitchenCourseNotes || {};
  return menuCourses
    .filter(c => c?.course_key)
    .map((c, i) => ({
      index: i + 1,
      key: c.course_key,
      name: overrides[c.course_key]?.name || c?.menu?.name || c?.menu_si?.name || c.course_key,
      firedAt: log[c.course_key]?.firedAt || null,
    }));
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
        gridTemplateColumns: "30px 1fr auto",
        alignItems: "center", gap: 6,
        padding: "7px 10px",
        background: selected ? tokens.tint.parchment : "transparent",
        border: `1px solid ${selected ? tokens.charcoal.default : "transparent"}`,
        borderBottom: `1px solid ${tokens.ink[5]}`,
        borderRadius: 0, cursor: "pointer", width: "100%", fontFamily: F,
      }}
    >
      <span style={{ fontSize: "11px", fontWeight: 600, color: tokens.ink[0] }}>
        T{String(t.id).padStart(2, "0")}
      </span>
      <span style={{ fontSize: "10px", color: tokens.ink[1], overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {t.resName || "—"}
      </span>
      <span style={{ fontSize: "8px", letterSpacing: "0.10em", textTransform: "uppercase", color: statusColor, flexShrink: 0 }}>
        {active ? (t.arrivedAt ? "●SIT" : "●ACT") : "○RES"}
      </span>
    </button>
  );
}

// ── Center: identity strip ────────────────────────────────────
function IdentityStrip({ table }) {
  const cells = [
    ["TABLE",   `T${String(table.id).padStart(2, "0")}`],
    ["NAME",    table.resName || "—"],
    ["PAX",     table.guests || table.seats?.length || "—"],
    ["RESV",    table.resTime || "—"],
    ["ARRIVED", table.arrivedAt || "—", table.arrivedAt ? tokens.green.text : tokens.ink[3]],
    ["MENU",    table.menuType || "—"],
    ["LANG",    (table.lang || "en").toUpperCase()],
    ["STATE",   table.active ? "SEATED" : "RESERVED", table.active ? tokens.green.strong : tokens.ink[3]],
  ];
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: 0,
      borderBottom: `1px solid ${tokens.ink[3]}`,
      paddingBottom: 10, marginBottom: 12,
    }}>
      {cells.map(([label, value, color]) => (
        <div key={label} style={{ padding: "4px 14px 4px 0", minWidth: 72 }}>
          <div style={{ ...lbl }}>{label}</div>
          <div style={{ ...val, color: color || tokens.ink[0], fontWeight: label === "TABLE" ? 600 : 400, fontSize: label === "TABLE" ? "16px" : "11px" }}>
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Center: compact course state window ───────────────────────
// Shows only LAST OUT / NEXT / AFTER. Full history lives in TimelineRail.
function CourseSection({ courses }) {
  const total = courses.length;
  const firedCount = courses.filter(c => c.firedAt).length;

  // Latest OUT = the highest-index course that has a firedAt timestamp.
  // Walk from the end so we honour the menu order, not the time-of-press.
  let lastOutIdx = -1;
  for (let i = courses.length - 1; i >= 0; i--) {
    if (courses[i].firedAt) { lastOutIdx = i; break; }
  }
  const lastOut = lastOutIdx >= 0 ? courses[lastOutIdx] : null;

  // NEXT = first course after lastOut without a firedAt.
  // If nothing fired yet, NEXT = first course.
  let nextIdx = -1;
  for (let i = lastOutIdx + 1; i < courses.length; i++) {
    if (!courses[i].firedAt) { nextIdx = i; break; }
  }
  const next  = nextIdx >= 0 ? courses[nextIdx] : null;

  // AFTER = course following NEXT.
  let afterIdx = -1;
  if (nextIdx >= 0) {
    for (let i = nextIdx + 1; i < courses.length; i++) {
      if (!courses[i].firedAt) { afterIdx = i; break; }
    }
  }
  const after = afterIdx >= 0 ? courses[afterIdx] : null;

  const allComplete = total > 0 && firedCount === total;

  const Row = ({ label, c, emphasis, placeholder }) => {
    const isStrong = emphasis === "strong";
    const isMuted  = emphasis === "muted";
    const labelColor = isStrong ? tokens.ink[1] : tokens.ink[3];
    const numColor   = isStrong ? tokens.ink[0] : isMuted ? tokens.ink[3] : tokens.ink[2];
    const nameColor  = isStrong ? tokens.ink[0] : isMuted ? tokens.ink[3] : tokens.ink[1];
    const nameWeight = isStrong ? 600 : isMuted ? 400 : 500;
    const rowHeight  = isStrong ? 34 : 30;
    const nameSize   = isStrong ? "13px" : "11px";

    return (
      <div style={{
        display: "grid",
        gridTemplateColumns: "72px 28px 1fr 84px",
        alignItems: "center", gap: 8,
        height: rowHeight,
        borderBottom: `1px solid ${tokens.ink[5]}`,
        fontFamily: F,
      }}>
        <span style={{ ...lbl, color: labelColor, fontWeight: isStrong ? 600 : 500 }}>
          {label}
        </span>
        <span style={{ fontSize: "10px", color: numColor, letterSpacing: "0.06em", fontWeight: isStrong ? 600 : 400 }}>
          {c ? String(c.index).padStart(2, "0") : "—"}
        </span>
        <span style={{
          fontSize: nameSize, color: nameColor, fontWeight: nameWeight,
          textTransform: "uppercase", letterSpacing: "0.04em",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {c ? c.name : (placeholder || "—")}
        </span>
        <span style={{ fontSize: "10px", color: c?.firedAt ? tokens.green.text : tokens.ink[4], textAlign: "right", letterSpacing: "0.04em" }}>
          {c?.firedAt ? `OUT ${c.firedAt}` : "—"}
        </span>
      </div>
    );
  };

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ ...lbl, color: tokens.ink[2], fontWeight: 500 }}>[COURSE STATE]</span>
        <div style={{ flex: 1, ...hr }} />
        <span style={{ ...lbl }}>
          [PROGRESS] {String(firedCount).padStart(2, "0")} / {String(total).padStart(2, "0")} OUT
        </span>
      </div>
      <Row label="LAST OUT" c={lastOut} emphasis="strong" placeholder="—" />
      <Row
        label="NEXT"
        c={allComplete ? null : next}
        emphasis="default"
        placeholder={allComplete ? "COMPLETE" : "—"}
      />
      <Row label="AFTER" c={allComplete ? null : after} emphasis="muted" placeholder="—" />
    </div>
  );
}

// ── Center: guest matrix ──────────────────────────────────────
function GuestMatrix({ table }) {
  const seats = table.seats || [];
  const restrByPos = new Map();
  (table.restrictions || []).forEach(r => {
    if (r?.pos != null) {
      const arr = restrByPos.get(r.pos) || [];
      arr.push(r);
      restrByPos.set(r.pos, arr);
    }
  });
  return (
    <div style={{ marginBottom: 14 }}>
      <SecHead label="GUEST MATRIX" right={`${seats.length} PAX`} />
      {/* column headers */}
      <div style={{ display: "grid", gridTemplateColumns: "32px 1fr 80px 80px", gap: 8, height: 22, alignItems: "center", borderBottom: `1px solid ${tokens.ink[4]}`, marginBottom: 2 }}>
        {["SEAT","NOTES","WATER","PAIRING"].map(h => (
          <span key={h} style={{ ...lbl, fontSize: "7.5px" }}>{h}</span>
        ))}
      </div>
      {seats.map(seat => {
        const r = restrByPos.get(seat.id) || [];
        const rText = r.length ? r.map(x => restrLabel(x.note) || x.note).join(" · ") : "—";
        const water   = (seat.water   && seat.water   !== "—") ? seat.water   : "—";
        const pairing = (seat.pairing && seat.pairing !== "—") ? seat.pairing : "—";
        return (
          <div key={seat.id} style={{
            display: "grid", gridTemplateColumns: "32px 1fr 80px 80px",
            alignItems: "center", gap: 8, height: 28,
            borderBottom: `1px solid ${tokens.ink[5]}`, fontFamily: F,
          }}>
            <span style={{ fontSize: "10px", color: tokens.ink[2], fontWeight: 500 }}>P{seat.id}</span>
            <span style={{ fontSize: "10px", color: r.length ? tokens.red.text : tokens.ink[3], textTransform: "uppercase", letterSpacing: "0.04em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {rText}
            </span>
            <span style={{ fontSize: "10px", color: water !== "—" ? tokens.ink[1] : tokens.ink[4] }}>{water}</span>
            <span style={{ fontSize: "10px", color: pairing !== "—" ? tokens.ink[1] : tokens.ink[4], textTransform: "uppercase", letterSpacing: "0.03em" }}>
              {pairing}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Center: action strip ──────────────────────────────────────
function ActionStrip({ table, courses, onFireNext, onOpenDetail, onSeat, onUnseat }) {
  const nextCourse = courses.find(c => !c.firedAt);
  const canFire = table.active && !!nextCourse;

  const btn = (label, onClick, opts = {}) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      disabled={!!opts.disabled}
      style={{
        fontFamily: F, fontSize: "9px", letterSpacing: "0.10em", textTransform: "uppercase",
        padding: "7px 10px",
        border: `1px solid ${opts.primary ? tokens.charcoal.default : tokens.ink[4]}`,
        background: opts.primary ? tokens.charcoal.default : tokens.neutral[0],
        color: opts.primary ? tokens.neutral[0] : tokens.ink[1],
        borderRadius: 0, cursor: opts.disabled ? "not-allowed" : "pointer",
        opacity: opts.disabled ? 0.4 : 1, flexShrink: 0, touchAction: "manipulation",
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, paddingTop: 10, borderTop: `1px solid ${tokens.ink[4]}` }}>
      {btn(
        canFire ? `FIRE C${String(nextCourse.index).padStart(2,"0")} · ${nextCourse.name}` : "FIRE NEXT",
        () => canFire && onFireNext(nextCourse.key),
        { primary: true, disabled: !canFire },
      )}
      {table.active
        ? btn("UNSEAT", () => onUnseat(table.id))
        : btn("SEAT",   () => onSeat(table.id))
      }
      {btn("EDIT · DETAIL", () => onOpenDetail(table.id))}
    </div>
  );
}

// ── Right: alerts rail ────────────────────────────────────────
function AlertsRail({ table }) {
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
    <div style={{ marginBottom: 14 }}>
      <SecHead label="ALERTS · INTELLIGENCE" right={String(items.length)} />
      {items.length === 0
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
                lineHeight: 1.3, marginBottom: 4,
              }}>
                {it.text}
              </div>
            );
          })
      }
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
    <div>
      <SecHead label="TIMELINE" right={String(events.length)} />
      {events.length === 0
        ? <div style={{ ...lbl, color: tokens.ink[4], padding: "4px 0" }}>NO COURSE TIMESTAMPS YET</div>
        : events.map((e, i) => (
            <div key={i} style={{
              display: "grid", gridTemplateColumns: "42px 1fr",
              alignItems: "center", gap: 8, height: 28,
              borderBottom: `1px solid ${tokens.ink[5]}`, fontFamily: F,
            }}>
              <span style={{ fontSize: "9px", color: tokens.ink[3], letterSpacing: "0.06em" }}>{e.at}</span>
              <span style={{ fontSize: "10px", color: tokens.ink[1], textTransform: "uppercase", letterSpacing: "0.04em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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
  onSeat,
  onUnseat,
  isMobile = false,
}) {
  const list = useMemo(() => sortedTableList(tables), [tables]);

  // Auto-select first active table if nothing selected yet
  const effectiveId = selectedId && list.some(t => t.id === selectedId)
    ? selectedId
    : (list[0]?.id ?? null);

  const table  = useMemo(() => list.find(t => t.id === effectiveId) || null, [list, effectiveId]);
  const courses = useMemo(() => (table ? buildCourses(table, menuCourses) : []), [table, menuCourses]);

  // ── MOBILE layout ──────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ padding: "0 12px 40px", display: "flex", flexDirection: "column", gap: 14 }}>
        {/* horizontal table selector */}
        <div style={{ display: "flex", gap: 4, overflowX: "auto", paddingBottom: 4 }}>
          {list.map(t => (
            <button key={t.id} type="button" onClick={() => onSelect(t.id)} style={{
              fontFamily: F, fontSize: "9px", letterSpacing: "0.10em", textTransform: "uppercase",
              padding: "7px 10px", flexShrink: 0, borderRadius: 0,
              border: `1px solid ${t.id === effectiveId ? tokens.charcoal.default : tokens.ink[4]}`,
              background: t.id === effectiveId ? tokens.tint.parchment : tokens.neutral[0],
              color: tokens.ink[1], touchAction: "manipulation",
            }}>
              T{String(t.id).padStart(2, "0")} {t.resName ? `· ${t.resName}` : ""}
            </button>
          ))}
        </div>
        {!table ? <EmptySheet /> : (
          <div style={{ background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}`, padding: 14 }}>
            <IdentityStrip table={table} />
            <CourseSection courses={courses} />
            <GuestMatrix table={table} />
            <AlertsRail table={table} />
            <TimelineRail table={table} courses={courses} />
            <ActionStrip table={table} courses={courses}
              onFireNext={key => onFireNext(table.id, key)}
              onOpenDetail={onOpenDetail} onSeat={onSeat} onUnseat={onUnseat} />
          </div>
        )}
      </div>
    );
  }

  // ── DESKTOP layout: 3-column grid ─────────────────────────
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "240px minmax(0,1fr) 300px",
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
        {!table ? <EmptySheet /> : (
          <>
            <IdentityStrip table={table} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 14 }}>
              <CourseSection courses={courses} />
              <GuestMatrix table={table} />
            </div>
            <ActionStrip table={table} courses={courses}
              onFireNext={key => onFireNext(table.id, key)}
              onOpenDetail={onOpenDetail} onSeat={onSeat} onUnseat={onUnseat} />
          </>
        )}
      </main>

      {/* RIGHT — intelligence rail */}
      <aside style={{
        position: "sticky", top: 12,
        background: tokens.neutral[0], border: `1px solid ${tokens.ink[4]}`,
        padding: 14,
      }}>
        {table ? (
          <>
            <AlertsRail table={table} />
            <TimelineRail table={table} courses={courses} />
          </>
        ) : (
          <div style={{ ...lbl, color: tokens.ink[4] }}>SELECT A TABLE</div>
        )}
      </aside>

    </div>
  );
}
