import { useMemo } from "react";
import { tokens } from "../../styles/tokens.js";
import { fmt } from "../../utils/tableHelpers.js";
import { restrLabel } from "../../constants/dietary.js";

const FONT = tokens.font;

/**
 * SHEET — high-detail live service intelligence view.
 * Renders a 3-column layout (active tables / selected sheet / alerts+timeline).
 * All content is derived from live synced state passed in; no local data store.
 */

const bracket = (label) => `[${label}]`;

const labelStyle = {
  fontFamily: FONT,
  fontSize: "9px",
  letterSpacing: "0.14em",
  color: tokens.ink[2],
  textTransform: "uppercase",
  fontWeight: 500,
};

const subLabelStyle = {
  fontFamily: FONT,
  fontSize: "8px",
  letterSpacing: "0.12em",
  color: tokens.ink[3],
  textTransform: "uppercase",
};

const valueStyle = {
  fontFamily: FONT,
  fontSize: "13px",
  color: tokens.ink[0],
  letterSpacing: "0.02em",
};

const hairline = { height: 1, background: tokens.ink[4], width: "100%" };

function SectionHeader({ label, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <span style={labelStyle}>{bracket(label)}</span>
      <div style={{ flex: 1, height: 1, background: tokens.ink[4] }} />
      {right && <span style={subLabelStyle}>{right}</span>}
    </div>
  );
}

function activeTablesList({ tables }) {
  return tables
    .filter(t => t.active || t.resName || t.resTime)
    .filter(t => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup))
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      return (a.arrivedAt || a.resTime || "99").localeCompare(b.arrivedAt || b.resTime || "99");
    });
}

function courseProgressionFor(table, menuCourses) {
  // Filter courses applicable to this table's menuType (or all if no menuType).
  // We pass the full activeMenuCourses; courses without menu name are skipped.
  const log = table.kitchenLog || {};
  const overrides = table.kitchenCourseNotes || {};
  return menuCourses
    .filter(c => c && c.course_key)
    .map((c, i) => {
      const fired = log[c.course_key]?.firedAt || null;
      const override = overrides[c.course_key] || {};
      const baseName = c?.menu?.name || c?.menu_si?.name || c.course_key;
      return {
        index: i + 1,
        key: c.course_key,
        name: override.name || baseName,
        sub: c?.menu?.sub || "",
        firedAt: fired,
      };
    });
}

function TableListItem({ t, selected, onClick }) {
  const status = t.active ? (t.arrivedAt ? "SEATED" : "ACTIVE") : "RESV";
  const statusColor = t.active ? tokens.green.text : tokens.ink[3];
  return (
    <button
      type="button"
      onClick={() => onClick(t.id)}
      style={{
        textAlign: "left",
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px",
        background: selected ? tokens.tint.parchment : tokens.neutral[0],
        border: `1px solid ${selected ? tokens.charcoal.default : tokens.ink[4]}`,
        borderRadius: 0,
        cursor: "pointer",
        fontFamily: FONT,
        width: "100%",
      }}
    >
      <span style={{ fontSize: "14px", fontWeight: 500, color: tokens.ink[0], minWidth: 28 }}>T{String(t.id).padStart(2, "0")}</span>
      <span style={{ flex: 1, fontSize: "11px", color: tokens.ink[1], overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {t.resName || "—"}
      </span>
      <span style={{ ...subLabelStyle, color: statusColor }}>{status}</span>
    </button>
  );
}

function CourseDot({ state }) {
  // state: 'done' | 'current' | 'pending'
  let bg = tokens.neutral[0];
  let border = tokens.ink[4];
  if (state === "done") { bg = tokens.green.text; border = tokens.green.text; }
  if (state === "current") { bg = tokens.signal.active; border = tokens.signal.active; }
  return (
    <span style={{
      display: "inline-block",
      width: 10, height: 10,
      borderRadius: "50%",
      background: bg,
      border: `1px solid ${border}`,
    }} />
  );
}

function CourseProgression({ courses }) {
  const firedCount = courses.filter(c => c.firedAt).length;
  const currentIdx = courses.findIndex(c => !c.firedAt);
  const total = courses.length;
  return (
    <div>
      <SectionHeader label="COURSE PROGRESSION" right={`${String(firedCount).padStart(2, "0")} / ${String(total).padStart(2, "0")}`} />
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        {courses.map((c, i) => {
          const state = c.firedAt ? "done" : i === currentIdx ? "current" : "pending";
          return <CourseDot key={c.key} state={state} />;
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 4 }}>
        {courses.map((c, i) => {
          const state = c.firedAt ? "done" : i === currentIdx ? "current" : "pending";
          const color = state === "done" ? tokens.ink[3] : state === "current" ? tokens.ink[0] : tokens.ink[3];
          const weight = state === "current" ? 500 : 400;
          return (
            <div key={c.key} style={{
              display: "grid",
              gridTemplateColumns: "32px 1fr 64px",
              alignItems: "baseline",
              gap: 8,
              padding: "4px 0",
              borderBottom: `1px solid ${tokens.ink[5]}`,
            }}>
              <span style={{ ...subLabelStyle, color: tokens.ink[3] }}>{String(c.index).padStart(2, "0")}</span>
              <span style={{ fontFamily: FONT, fontSize: "12px", color, fontWeight: weight, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {c.name}
              </span>
              <span style={{ fontFamily: FONT, fontSize: "11px", color: c.firedAt ? tokens.green.text : tokens.ink[4], textAlign: "right" }}>
                {c.firedAt ? `OUT ${c.firedAt}` : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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
    <div>
      <SectionHeader label="GUEST MATRIX" right={`${seats.length} PAX`} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 4 }}>
        {seats.map(seat => {
          const r = restrByPos.get(seat.id) || [];
          const water = seat.water && seat.water !== "—" ? seat.water : "";
          const pairing = seat.pairing && seat.pairing !== "—" ? seat.pairing : "";
          return (
            <div key={seat.id} style={{
              display: "grid",
              gridTemplateColumns: "40px 1fr 1fr 1fr",
              gap: 8,
              padding: "6px 0",
              borderBottom: `1px solid ${tokens.ink[5]}`,
              fontFamily: FONT,
              fontSize: "11px",
              alignItems: "baseline",
            }}>
              <span style={{ ...subLabelStyle, color: tokens.ink[2] }}>P{seat.id}</span>
              <span style={{ color: water ? tokens.ink[1] : tokens.ink[4] }}>{water || "—"}</span>
              <span style={{ color: pairing ? tokens.ink[1] : tokens.ink[4], textTransform: "uppercase", letterSpacing: "0.04em" }}>
                {pairing || "—"}
              </span>
              <span style={{ color: r.length ? tokens.red.text : tokens.ink[4], textTransform: "uppercase", letterSpacing: "0.04em", fontSize: "10px" }}>
                {r.length ? r.map(x => restrLabel(x.note) || x.note).join(" · ") : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AlertsPanel({ table }) {
  const restrictions = table.restrictions || [];
  const tableNotes = (table.notes || "").trim();
  const pace = table.pace || "";
  const birthday = !!table.birthday;
  const cake = (table.cakeNote || "").trim();

  const items = [];
  restrictions.forEach((r, i) => {
    items.push({
      kind: "restriction",
      tone: "alert",
      label: r?.pos != null ? `P${r.pos} · ${restrLabel(r.note) || r.note}` : (restrLabel(r.note) || r.note),
      key: `r${i}`,
    });
  });
  if (birthday) items.push({ kind: "celebration", tone: "warn", label: cake ? `BIRTHDAY · ${cake}` : "BIRTHDAY", key: "bday" });
  if (pace) items.push({ kind: "pace", tone: "warn", label: `PACE · ${String(pace).toUpperCase()}`, key: "pace" });
  if (tableNotes) items.push({ kind: "note", tone: "info", label: tableNotes, key: "note" });

  return (
    <div>
      <SectionHeader label="ALERTS · INTELLIGENCE" right={items.length ? `${items.length}` : "0"} />
      {items.length === 0 ? (
        <div style={{ ...subLabelStyle, color: tokens.ink[4], padding: "8px 0" }}>NO ACTIVE ALERTS</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {items.map(it => {
            const colors = it.tone === "alert"
              ? { bg: tokens.red.bg, border: tokens.red.border, text: tokens.red.text }
              : it.tone === "warn"
              ? { bg: tokens.neutral[50], border: tokens.ink[4], text: tokens.signal.warn }
              : { bg: tokens.neutral[0], border: tokens.ink[4], text: tokens.ink[1] };
            return (
              <div key={it.key} style={{
                fontFamily: FONT,
                fontSize: "11px",
                padding: "8px 10px",
                background: colors.bg,
                border: `1px solid ${colors.border}`,
                color: colors.text,
                letterSpacing: "0.04em",
                lineHeight: 1.35,
              }}>
                {it.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TimelinePanel({ table, courses }) {
  const events = [];
  if (table.arrivedAt) events.push({ at: table.arrivedAt, kind: "ARRIVED" });
  if (table.resTime && !table.arrivedAt) events.push({ at: table.resTime, kind: "RESV" });
  courses.forEach(c => {
    if (c.firedAt) events.push({ at: c.firedAt, kind: `OUT · ${c.name}` });
  });
  events.sort((a, b) => (a.at || "").localeCompare(b.at || ""));

  return (
    <div>
      <SectionHeader label="TIMELINE" right={`${events.length}`} />
      {events.length === 0 ? (
        <div style={{ ...subLabelStyle, color: tokens.ink[4], padding: "8px 0" }}>NO EVENTS YET</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {events.map((e, i) => (
            <div key={i} style={{
              display: "grid",
              gridTemplateColumns: "56px 1fr",
              gap: 8,
              padding: "6px 0",
              borderBottom: `1px solid ${tokens.ink[5]}`,
              fontFamily: FONT,
              fontSize: "11px",
            }}>
              <span style={{ color: tokens.ink[3], letterSpacing: "0.04em" }}>{e.at}</span>
              <span style={{ color: tokens.ink[1], textTransform: "uppercase", letterSpacing: "0.04em" }}>{e.kind}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function IdentityHeader({ table }) {
  const lines = [];
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "auto 1fr auto",
      alignItems: "end",
      gap: 16,
      paddingBottom: 12,
      borderBottom: `1px solid ${tokens.ink[3]}`,
      marginBottom: 16,
    }}>
      <div>
        <div style={{ ...subLabelStyle }}>[TABLE]</div>
        <div style={{ fontFamily: FONT, fontSize: "32px", fontWeight: 500, color: tokens.ink[0], lineHeight: 1, letterSpacing: "0.02em" }}>
          T{String(table.id).padStart(2, "0")}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 12 }}>
        <Meta label="NAME" value={table.resName || "—"} />
        <Meta label="PAX" value={table.guests || (table.seats?.length || 0) || "—"} />
        <Meta label="RESV" value={table.resTime || "—"} />
        <Meta label="ARRIVED" value={table.arrivedAt || "—"} valueColor={table.arrivedAt ? tokens.green.text : tokens.ink[3]} />
        <Meta label="MENU" value={table.menuType || "—"} />
        <Meta label="LANG" value={(table.lang || "en").toUpperCase()} />
      </div>
      <div style={{ textAlign: "right" }}>
        <div style={{ ...subLabelStyle }}>[STATE]</div>
        <div style={{
          fontFamily: FONT, fontSize: "12px", fontWeight: 500,
          color: table.active ? tokens.green.strong : tokens.ink[3],
          letterSpacing: "0.08em", textTransform: "uppercase",
        }}>
          {table.active ? (table.arrivedAt ? "● SEATED" : "● ACTIVE") : "○ RESERVED"}
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value, valueColor }) {
  return (
    <div>
      <div style={{ ...subLabelStyle }}>{label}</div>
      <div style={{ fontFamily: FONT, fontSize: "13px", color: valueColor || tokens.ink[1], textTransform: "uppercase", letterSpacing: "0.02em" }}>
        {value}
      </div>
    </div>
  );
}

function ActionsBar({ table, courses, onFireNext, onOpenDetail, onSeat, onUnseat, isMobile }) {
  const nextCourse = courses.find(c => !c.firedAt);
  const canFire = !!table.active && !!nextCourse;
  return (
    <div style={{
      display: "flex",
      flexWrap: "wrap",
      gap: 8,
      padding: "12px 0 0",
      borderTop: `1px solid ${tokens.ink[4]}`,
      marginTop: 16,
    }}>
      <ActionButton
        label={canFire ? `FIRE ${String(nextCourse.index).padStart(2, "0")} · ${nextCourse.name}` : "FIRE NEXT"}
        onClick={() => canFire && onFireNext(nextCourse.key)}
        disabled={!canFire}
        primary
      />
      {table.active ? (
        <ActionButton label="UNSEAT" onClick={() => onUnseat(table.id)} />
      ) : (
        <ActionButton label="SEAT" onClick={() => onSeat(table.id)} />
      )}
      <ActionButton label="EDIT · DETAIL" onClick={() => onOpenDetail(table.id)} />
    </div>
  );
}

function ActionButton({ label, onClick, disabled, primary }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        fontFamily: FONT,
        fontSize: "10px",
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        padding: "10px 14px",
        border: `1px solid ${primary ? tokens.charcoal.default : tokens.ink[4]}`,
        background: primary ? tokens.charcoal.default : tokens.neutral[0],
        color: primary ? tokens.neutral[0] : tokens.ink[1],
        borderRadius: 0,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
        touchAction: "manipulation",
      }}
    >
      {label}
    </button>
  );
}

function EmptySheet() {
  return (
    <div style={{
      padding: 48,
      textAlign: "center",
      fontFamily: FONT,
      fontSize: "11px",
      letterSpacing: "0.16em",
      color: tokens.ink[3],
      textTransform: "uppercase",
      border: `1px dashed ${tokens.ink[4]}`,
    }}>
      Select a table from the list to load its sheet.
    </div>
  );
}

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
  const list = useMemo(() => activeTablesList({ tables }), [tables]);
  const effectiveId = selectedId && list.some(t => t.id === selectedId)
    ? selectedId
    : (list[0]?.id ?? null);
  const table = useMemo(() => list.find(t => t.id === effectiveId) || null, [list, effectiveId]);

  const courses = useMemo(
    () => (table ? courseProgressionFor(table, menuCourses) : []),
    [table, menuCourses]
  );

  const containerStyle = isMobile
    ? { display: "flex", flexDirection: "column", gap: 16, padding: "0 12px 40px" }
    : {
        display: "grid",
        gridTemplateColumns: "240px minmax(0, 1fr) 320px",
        gap: 20,
        padding: "0 24px 48px",
        alignItems: "start",
      };

  // On mobile we hide the left sidebar and instead show a compact selector strip.
  return (
    <div style={containerStyle}>
      {!isMobile && (
        <aside style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          position: "sticky",
          top: 12,
          maxHeight: "calc(100vh - 160px)",
          overflowY: "auto",
        }}>
          <SectionHeader label="TABLES" right={`${list.length}`} />
          {list.length === 0 ? (
            <div style={{ ...subLabelStyle, color: tokens.ink[4], padding: "8px 0" }}>NO ACTIVE TABLES</div>
          ) : (
            list.map(t => (
              <TableListItem
                key={t.id}
                t={t}
                selected={t.id === effectiveId}
                onClick={onSelect}
              />
            ))
          )}
        </aside>
      )}

      {isMobile && list.length > 0 && (
        <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
          {list.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              style={{
                fontFamily: FONT,
                fontSize: "10px",
                letterSpacing: "0.10em",
                padding: "8px 10px",
                border: `1px solid ${t.id === effectiveId ? tokens.charcoal.default : tokens.ink[4]}`,
                background: t.id === effectiveId ? tokens.tint.parchment : tokens.neutral[0],
                color: tokens.ink[1],
                borderRadius: 0,
                flexShrink: 0,
                touchAction: "manipulation",
              }}
            >
              T{String(t.id).padStart(2, "0")} · {t.resName || "—"}
            </button>
          ))}
        </div>
      )}

      <main style={{
        background: tokens.neutral[0],
        border: `1px solid ${tokens.ink[4]}`,
        padding: isMobile ? 16 : 24,
        minWidth: 0,
      }}>
        {!table ? (
          <EmptySheet />
        ) : (
          <>
            <IdentityHeader table={table} />
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 24 }}>
              <CourseProgression courses={courses} />
              <GuestMatrix table={table} />
            </div>
            <ActionsBar
              table={table}
              courses={courses}
              onFireNext={(key) => onFireNext(table.id, key)}
              onOpenDetail={onOpenDetail}
              onSeat={onSeat}
              onUnseat={onUnseat}
              isMobile={isMobile}
            />
          </>
        )}
      </main>

      <aside style={{
        display: "flex",
        flexDirection: "column",
        gap: 20,
        position: isMobile ? "static" : "sticky",
        top: 12,
      }}>
        {table ? (
          <>
            <AlertsPanel table={table} />
            <TimelinePanel table={table} courses={courses} />
          </>
        ) : (
          <div style={{ ...subLabelStyle, color: tokens.ink[4] }}>—</div>
        )}
      </aside>
    </div>
  );
}
