import { useEffect, useMemo, useRef, useState } from "react";
import { useIsMobile, BP } from "../../hooks/useIsMobile.js";
import { useModalEscape } from "../../hooks/useModalEscape.js";
import { tokens } from "../../styles/tokens.js";
import { RESTRICTIONS, RESTRICTION_GROUPS, restrCompact } from "../../constants/dietary.js";
import { fmt } from "../../utils/tableHelpers.js";
import { getVisibleCoursesForTable } from "../../utils/courseProgress.js";
import {
  ARRIVAL_DELAY_ALARM_MIN,
  arrivalDelayMinutes,
  courseFireState,
  minutesOfDay,
  sheetActionAvailability,
  tableBadgeState,
} from "../../utils/tableSheetState.js";
import TablePickerModal from "./TablePickerModal.jsx";
import ConfirmDialog from "./ConfirmDialog.jsx";

const FONT = tokens.font;
// Desktop width. Exported so App can RESERVE it beside the board rather than
// letting the sheet overlap the room the operator is reading.
export const TABLE_SHEET_WIDTH = 460;
export const TABLE_SHEET_BP = BP.lg;
const TAP = 44;               // minimum touch target, everywhere
const TICK_MS = 20000;        // how often the two alarm clocks re-read

// ── shared inline-style grammar ───────────────────────────────────────────────
const micro = {
  fontFamily: FONT, fontSize: 8, letterSpacing: "0.16em",
  textTransform: "uppercase", color: tokens.ink[3], fontWeight: 400,
};

const chip = (on, { danger = false } = {}) => ({
  fontFamily: FONT, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase",
  minHeight: TAP, padding: "6px 12px",
  border: `1px solid ${on ? (danger ? tokens.red.border : tokens.charcoal.default) : tokens.ink[4]}`,
  borderRadius: 0, cursor: "pointer",
  background: on ? (danger ? tokens.red.bg : tokens.tint.parchment) : tokens.neutral[0],
  color: on ? (danger ? tokens.red.text : tokens.ink[0]) : tokens.ink[3],
  fontWeight: on ? 700 : 400,
  touchAction: "manipulation",
});

const darkButton = (inert = false) => ({
  fontFamily: FONT, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase",
  width: "100%", minHeight: TAP, padding: "12px 14px",
  border: `1px solid ${inert ? tokens.ink[4] : tokens.charcoal.default}`,
  borderRadius: 0, cursor: inert ? "default" : "pointer",
  background: inert ? tokens.neutral[50] : tokens.charcoal.default,
  color: inert ? tokens.ink[4] : tokens.neutral[0],
  fontWeight: 700, touchAction: "manipulation",
});

const quietButton = (danger = false) => ({
  fontFamily: FONT, fontSize: 9, letterSpacing: "0.10em", textTransform: "uppercase",
  minHeight: TAP, padding: "10px 8px",
  border: `1px solid ${danger ? tokens.red.border : tokens.ink[4]}`,
  borderRadius: 0, cursor: "pointer",
  background: tokens.neutral[0],
  color: danger ? tokens.red.text : tokens.ink[1],
  fontWeight: danger ? 700 : 500, touchAction: "manipulation",
});

const textareaStyle = (kitchen = false) => ({
  fontFamily: FONT, fontSize: tokens.mobileInputSize,
  width: "100%", minHeight: 68, padding: "10px 12px", lineHeight: 1.5,
  border: `1px solid ${kitchen ? tokens.red.border : tokens.ink[4]}`,
  borderRadius: 0, background: tokens.neutral[0], color: tokens.ink[0],
  resize: "vertical", boxSizing: "border-box", WebkitAppearance: "none",
});

// Type badge for a search hit. Deliberately NOT BEV_TYPES, whose `wine` label
// is "Glass" — that read as an answer sitting next to the GLASS button that
// asks the question.
const BEV_LABEL = { wine: "WINE", cocktail: "COCKTAIL", spirit: "SPIRIT", beer: "BEER" };

const Section = ({ label, children, right = null }) => (
  <div style={{ padding: "16px 16px 0" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
      <span style={micro}>[{label}]</span>
      {right}
    </div>
    {children}
  </div>
);

// A textarea that only writes on blur. The sheet has no save button, so every
// commit is a real reservation write — one per keystroke would flood the
// queue and fight the operator's cursor on the next sync echo.
function BlurTextarea({ value, onCommit, placeholder, kitchen = false, ariaLabel }) {
  const [local, setLocal] = useState(value ?? "");
  const committed = useRef(value);
  if (committed.current !== value) {
    committed.current = value;
    setLocal(value ?? "");
  }
  return (
    <textarea
      value={local}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { if (local !== (value ?? "")) onCommit(local); }}
      style={textareaStyle(kitchen)}
    />
  );
}

/**
 * The table side sheet.
 *
 * It slides in over the board and the board stays mounted and live behind it —
 * the operator keeps their peripheral read of the room while working one table.
 * There is no save button and no dirty state: every control writes immediately
 * through the handlers below and confirms with a toast.
 */
export default function TableSheet({
  table,
  tables = [],
  reservations = [],
  menuCourses = [],
  profiles = [],
  assignments = {},
  wines = [],
  cocktails = [],
  spirits = [],
  beers = [],
  reservationOnTable,
  seatCapOf,
  onClose,
  upd,
  updSeat,
  updBooking,
  onFire,
  onUnfire,
  onMarkSeated,
  onMarkArriving,
  onSetKitchen,
  onUnsetKitchen,
  onMoveTable,
  onJoinTable,
  onSplitTable,
  onOpenTicket,
  onClearTable,
}) {
  const isMobile = useIsMobile(TABLE_SHEET_BP);
  const [toast, setToast] = useState(null);
  const [picker, setPicker] = useState(null);        // "move" | "swap" | "join"
  const [confirmClear, setConfirmClear] = useState(false);
  const [addRestrSeat, setAddRestrSeat] = useState(null); // seat id while the add panel is open
  const [addRestrOpen, setAddRestrOpen] = useState(false);
  const [drinkQuery, setDrinkQuery] = useState("");
  // Where a pick lands: as an aperitif, or with the menu. Same decision the
  // old detail view made per seat — here it applies to the whole party.
  const [drinkPhase, setDrinkPhase] = useState("aperitif");
  // Who the next pick is for: null = the whole party, or one seat id. Drinks
  // are ordered per person as often as per table, and the sheet was writing
  // every pick to all four guests with no way to say "just P2".
  const [drinkSeat, setDrinkSeat] = useState(null);
  const [nowMin, setNowMin] = useState(() => minutesOfDay());
  const scrollRef = useRef(null);
  const toastTimer = useRef(null);

  // Esc closes the sheet — but a picker or confirm raised FROM the sheet
  // registers after it and therefore takes the key first.
  useModalEscape(onClose, true);

  const flash = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // The two alarms (party late, pass gone quiet) are clock-driven, so the
  // sheet has to re-read the wall clock on its own — nothing else re-renders it.
  useEffect(() => {
    const id = setInterval(() => setNowMin(minutesOfDay()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  // Selecting a different table swaps the sheet content in place. Reset the
  // transient panels and scroll to the top so the new party doesn't inherit
  // the previous one's half-finished restriction pick.
  useEffect(() => {
    setPicker(null);
    setConfirmClear(false);
    setAddRestrOpen(false);
    setAddRestrSeat(null);
    setDrinkQuery("");
    setDrinkPhase("aperitif");
    setDrinkSeat(null);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [table?.id]);

  const courses = useMemo(
    () => getVisibleCoursesForTable(table, menuCourses, { profiles, assignments }),
    [table, menuCourses, profiles, assignments],
  );

  // The WHOLE catalog, not just wine: a table asking for a Negroni or a beer
  // should not need a different surface from a table asking for Rebula.
  const drinkMatches = useMemo(() => {
    const q = drinkQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    const hit = (x, ...extra) =>
      [x?.name, ...extra].some(v => String(v || "").toLowerCase().includes(q));
    const out = [];
    (wines || []).forEach(w => {
      if (hit(w, w.producer, w.vintage)) {
        out.push({ key: `w:${w.id || w.name}`, type: "wine", item: w,
          sub: [w.producer, w.vintage].filter(Boolean).join(" · ") });
      }
    });
    [["cocktail", cocktails], ["spirit", spirits], ["beer", beers]].forEach(([type, list]) => {
      (list || []).forEach(d => {
        if (hit(d, d.notes)) out.push({ key: `${type}:${d.id || d.name}`, type, item: d, sub: d.notes || "" });
      });
    });
    return out.slice(0, 4);
  }, [drinkQuery, wines, cocktails, spirits, beers]);

  if (!table) return null;

  const visit = table._visit || null;
  const badge = tableBadgeState(table, { visit });
  const delayMin = arrivalDelayMinutes(table, nowMin);
  const fireState = courseFireState(table, courses, nowMin);
  const group = Array.isArray(table.tableGroup) ? table.tableGroup.map(Number).sort((a, b) => a - b) : [];
  const isGrouped = group.length > 1;
  const can = sheetActionAvailability(table, { visit, isGrouped });
  const seats = table.seats || [];
  const covers = Number(table._groupGuests || table.guests) || seats.length || 0;
  const nextCourse = courses.find(c => !c.firedAt) || null;
  const lastFired = [...courses].filter(c => c.firedAt).pop() || null;

  const primaryLabel = `TABLE_${String(table.id).padStart(2, "0")}`;
  const joinedLabels = group.filter(id => id !== Number(table.id))
    .map(id => `+T${String(id).padStart(2, "0")}`).join(" ");

  // ── writes ────────────────────────────────────────────────────────────────
  const write = (field, value, msg) => { upd(field, value); if (msg) flash(msg); };
  const writeBooking = (field, value, msg) => { updBooking(field, value); if (msg) flash(msg); };

  const fireNext = () => {
    if (!nextCourse) return;
    onFire(nextCourse.key);
    flash(`FIRED — ${String(nextCourse.name).toUpperCase()}`);
  };
  const undoFire = () => {
    if (!lastFired) return;
    onUnfire(lastFired.key);
    flash(`UNDONE — ${String(lastFired.name).toUpperCase()}`);
  };

  const removeRestriction = (index) => {
    write("restrictions", (table.restrictions || []).filter((_, i) => i !== index), "RESTRICTION REMOVED");
  };
  const addRestriction = (key) => {
    const next = [...(table.restrictions || []), { pos: addRestrSeat, note: key }];
    updBooking("restrictions", next);
    setAddRestrOpen(false);
    setAddRestrSeat(null);
    flash(`${restrCompact(key).toUpperCase()} — SEAT_${addRestrSeat}`);
  };

  // Which per-seat list a with-menu pick belongs to.
  const MENU_FIELD = { wine: "glasses", cocktail: "cocktails", spirit: "spirits", beer: "beers" };
  const targetSeats = drinkSeat == null ? seats : seats.filter(s => s.id === drinkSeat);

  /**
   * Add a beverage to the party.
   *
   * A BOTTLE is shared, so it lands on the table's bottle list. Everything else
   * is per-person and lands on every seat — as an aperitif or with the menu,
   * per the phase chip. A glass poured by the glass must NEVER land in
   * bottleWines: that list is what the menu, the summary and the archive read
   * as "bottles for the table", so a glass sent there came back as a bottle.
   */
  const addDrink = (match, how) => {
    const { type, item } = match;
    const name = String(item?.name || "").toUpperCase();
    if (how === "bottle") {
      write("bottleWines", [...(table.bottleWines || []), { ...item, byGlass: false }],
        `BOTTLE — ${name}`);
      setDrinkQuery("");
      return;
    }
    const stored = type === "wine" ? { ...item, byGlass: true } : item;
    const field = drinkPhase === "aperitif" ? "aperitifs" : (MENU_FIELD[type] || "cocktails");
    targetSeats.forEach(s => updSeat(s.id, field, [...(s[field] || []), stored]));
    const who = drinkSeat == null ? "PARTY" : `SEAT_${drinkSeat}`;
    flash(`${drinkPhase === "aperitif" ? "APERITIF" : "WITH MENU"} · ${who} — ${name}`);
    setDrinkQuery("");
  };

  /**
   * What the list reads back, scoped to whoever is selected.
   *
   * On the party view a drink can legitimately be on some seats and not
   * others — Quick Access edits one guest, and so does this panel — so party
   * rows carry how many seats hold them instead of pretending the table is
   * uniform. On a single seat there is nothing to count, and removing takes
   * the drink off that seat alone.
   */
  const chosenDrinks = (() => {
    // The table's bottles are shared, so they show under every scope.
    const out = (table.bottleWines || []).map((w, i) => ({
      key: `bottle-${i}`,
      tag: "BOTTLE",
      name: w?.name || "—",
      sub: w?.producer || "",
      count: null,
      onRemove: () => write("bottleWines", (table.bottleWines || []).filter((_, j) => j !== i), "DRINK REMOVED"),
    }));
    const FIELDS = [
      ["aperitifs", "APERITIF"],
      ["glasses", "GLASS"],
      ["cocktails", "COCKTAIL"],
      ["spirits", "SPIRIT"],
      ["beers", "BEER"],
    ];
    for (const [field, tag] of FIELDS) {
      if (drinkSeat != null) {
        const s = seats.find(x => x.id === drinkSeat);
        (s?.[field] || []).forEach((x, i) => out.push({
          key: `${field}-${drinkSeat}-${i}`,
          tag,
          name: x?.name || "—",
          sub: x?.producer || x?.notes || "",
          count: null,
          onRemove: () => {
            updSeat(drinkSeat, field, (s[field] || []).filter((_, j) => j !== i));
            flash(`REMOVED · SEAT_${drinkSeat}`);
          },
        }));
        continue;
      }
      const byName = new Map();
      seats.forEach(s => (s[field] || []).forEach(x => {
        const name = x?.name || "—";
        const e = byName.get(name) || { name, sub: x?.producer || x?.notes || "", count: 0 };
        e.count += 1;
        byName.set(name, e);
      }));
      byName.forEach(e => out.push({
        key: `${field}-${e.name}`,
        tag,
        name: e.name,
        sub: e.sub,
        count: e.count,
        onRemove: () => {
          seats.forEach(s => updSeat(s.id, field, (s[field] || []).filter(x => (x?.name || "—") !== e.name)));
          flash("DRINK REMOVED");
        },
      }));
    }
    return out;
  })();

  // ── picker plumbing ───────────────────────────────────────────────────────
  const isFreeTable = (t, owner) => !t.active && !t.arrivedAt && !t.resName && !t.resTime && !owner;
  const pickerPickable = {
    move: (t) => !t.active,          // a live table is a SWAP, not a MOVE
    swap: () => true,
    join: (t, owner) => isFreeTable(t, owner),
  }[picker] || (() => true);

  // A refused pick leaves the picker OPEN: the usual refusal is a failed
  // write on a bad connection, and the operator's next move is to try the same
  // table again — closing the picker would make them re-open it from scratch.
  const onPickTable = async (toId) => {
    const label = `T${String(toId).padStart(2, "0")}`;
    if (picker === "join") {
      const r = await onJoinTable(toId);
      if (r?.ok === false) { flash("JOIN REFUSED"); return; }
      setPicker(null);
      flash(`JOINED — ${label}`);
      return;
    }
    const r = await onMoveTable(toId, picker === "swap" ? "swap" : "auto");
    if (r?.ok === false) { flash("MOVE REFUSED"); return; }
    setPicker(null);
    flash(`${r?.swapped ? "SWAPPED" : "MOVED"} — ${label}`);
  };

  // ── chrome ────────────────────────────────────────────────────────────────
  const badgeTone = {
    live:     { bg: tokens.green.bg,     border: tokens.green.border, color: tokens.green.text },
    arriving: { bg: tokens.ink[0],       border: tokens.ink[0],       color: tokens.neutral[0] },
    set:      { bg: tokens.tint.parchment, border: tokens.charcoal.default, color: tokens.ink[0] },
    terrace:  { bg: tokens.ink[5],       border: tokens.ink[4],       color: tokens.ink[2] },
    reserved: { bg: tokens.neutral[50],  border: tokens.ink[4],       color: tokens.ink[3] },
    cleared:  { bg: tokens.neutral[50],  border: tokens.ink[4],       color: tokens.ink[4] },
  }[badge.key] || { bg: tokens.neutral[50], border: tokens.ink[4], color: tokens.ink[3] };

  const metaParts = [
    `${covers} COVERS`,
    `${table.resTime || "—"} → ${table.arrivedAt || "—"}`,
    table.source || (table.guestType === "hotel" ? "HOTEL" : null),
    table.reference || null,
  ].filter(Boolean);

  const rooms = Array.isArray(table.rooms) && table.rooms.length
    ? table.rooms.filter(Boolean)
    : (table.room ? [table.room] : []);

  return (
    <>
      <style>{`
        @keyframes tableSheetIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes tableSheetScrim { from { opacity: 0; } to { opacity: 1; } }
        @keyframes tableSheetAlarm { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        [data-table-sheet] :is(button, input, textarea, [tabindex]):focus-visible {
          outline: 2px solid ${tokens.ink[0]};
          outline-offset: 2px;
        }
        @media (prefers-reduced-motion: reduce) {
          [data-table-sheet], [data-table-sheet-scrim], [data-sheet-alarm] { animation: none !important; }
        }
      `}</style>

      <div
        data-table-sheet-scrim=""
        role="presentation"
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, background: tokens.surface.overlay,
          zIndex: 300, animation: "tableSheetScrim 200ms ease",
        }}
      />

      <aside
        data-table-sheet=""
        role="dialog"
        aria-modal="true"
        aria-label={`${primaryLabel} details`}
        ref={scrollRef}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0,
          width: isMobile ? "100%" : TABLE_SHEET_WIDTH,
          maxWidth: "100%",
          background: tokens.neutral[0],
          borderLeft: `1px solid ${tokens.ink[4]}`,
          boxShadow: "-8px 0 28px rgba(26,25,23,0.12)",
          zIndex: 310,
          overflowY: "auto", overflowX: "hidden",
          fontFamily: FONT,
          animation: "tableSheetIn 200ms ease",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {/* ── 1. STICKY HEADER ───────────────────────────────────────────── */}
        <header style={{
          position: "sticky", top: 0, zIndex: 3,
          background: tokens.neutral[0],
          borderBottom: `1px solid ${tokens.ink[4]}`,
          padding: "12px 12px 12px 16px",
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", color: tokens.ink[0] }}>
                  {primaryLabel}
                </span>
                {joinedLabels && (
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: tokens.ink[2] }}>
                    {joinedLabels}
                  </span>
                )}
                <span style={{
                  fontSize: 8, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700,
                  padding: "3px 8px", border: `1px solid ${badgeTone.border}`,
                  background: badgeTone.bg, color: badgeTone.color,
                }}>
                  {badge.label}{badge.at ? ` ${badge.at}` : ""}
                </span>
                {delayMin != null && (
                  <span
                    data-sheet-alarm=""
                    style={{
                      fontSize: 8, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700,
                      padding: "3px 8px", border: `1px solid ${tokens.red.border}`,
                      background: tokens.red.bg, color: tokens.red.text,
                      animation: delayMin >= ARRIVAL_DELAY_ALARM_MIN
                        ? "tableSheetAlarm 1.8s ease-in-out infinite" : "none",
                    }}
                  >DELAYED {delayMin} MIN</span>
                )}
              </div>

              <div style={{
                fontSize: 17, fontWeight: 600, color: tokens.ink[0], lineHeight: 1.25,
                marginTop: 7, overflowWrap: "anywhere",
              }}>
                {table.resName || "—"}
              </div>

              <div style={{ ...micro, marginTop: 5, letterSpacing: "0.10em", lineHeight: 1.5 }}>
                {metaParts.join(" · ")}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close table sheet"
              style={{
                width: 40, height: 40, flexShrink: 0,
                border: `1px solid ${tokens.ink[4]}`, borderRadius: 0,
                background: tokens.neutral[0], color: tokens.ink[1],
                fontFamily: FONT, fontSize: 16, lineHeight: 1, cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                touchAction: "manipulation",
              }}
            >×</button>
          </div>
        </header>

        {/* ── 2. PRIMARY ACTION — only when it is the obvious next move ───── */}
        {can.markSeated && (
          <div style={{ padding: "14px 16px 0" }}>
            <button
              type="button"
              onClick={() => { onMarkSeated(); flash("SEATED"); }}
              style={darkButton()}
            >MARK SEATED — {fmt(new Date())}</button>
          </div>
        )}

        {/* ── 3. COURSES ─────────────────────────────────────────────────── */}
        <Section label="COURSES">
          <div style={{ border: `1px solid ${tokens.ink[4]}` }}>
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
              padding: "9px 10px", borderBottom: `1px solid ${tokens.ink[4]}`,
              background: tokens.neutral[50], flexWrap: "wrap",
            }}>
              <span style={{ fontSize: 9, letterSpacing: "0.10em", color: tokens.ink[1], fontWeight: 700 }}>
                COURSE_{String(fireState.nextIndex).padStart(2, "0")}/{String(fireState.total).padStart(2, "0")}
              </span>
              <span
                data-sheet-alarm=""
                style={{
                  fontSize: 8, letterSpacing: "0.10em", textTransform: "uppercase",
                  color: fireState.alarm ? tokens.red.text : tokens.ink[3],
                  fontWeight: fireState.alarm ? 700 : 400,
                  animation: fireState.alarm ? "tableSheetAlarm 2.2s ease-in-out infinite" : "none",
                }}
              >
                {fireState.lastFiredAt
                  ? `LAST FIRE ${fireState.minsSinceFire ?? 0} MIN AGO`
                  : "NO FIRE YET"}
              </span>
            </div>

            <div style={{ maxHeight: 250, overflowY: "auto" }}>
              {courses.length === 0 && (
                <div style={{ padding: "14px 10px", ...micro }}>NO MENU LOADED</div>
              )}
              {courses.map(c => {
                const fired = !!c.firedAt;
                const isNext = !fired && nextCourse?.key === c.key;
                const guestWording = c.rawCourse?.menu?.name && c.rawCourse.menu.name !== c.name
                  ? c.rawCourse.menu.name : "";
                return (
                  <div key={c.key} style={{
                    display: "flex", alignItems: "center", gap: 9,
                    padding: "8px 10px", borderBottom: `1px solid ${tokens.ink[5]}`,
                    background: isNext ? tokens.tint.parchment : tokens.neutral[0],
                    opacity: fired ? 0.55 : 1,
                  }}>
                    <span aria-hidden="true" style={{
                      width: 9, height: 9, flexShrink: 0,
                      background: fired ? tokens.green.border : isNext ? tokens.charcoal.default : "transparent",
                      border: `1px solid ${fired ? tokens.green.border : tokens.ink[4]}`,
                    }} />
                    <span style={{ fontSize: 9, color: tokens.ink[3], minWidth: 18, flexShrink: 0 }}>
                      {String(c.index).padStart(2, "0")}
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{
                        fontSize: 11, color: fired ? tokens.ink[3] : tokens.ink[0],
                        fontWeight: isNext ? 700 : 400, display: "block", lineHeight: 1.3,
                      }}>{c.name}</span>
                      {guestWording && (
                        <span style={{ fontSize: 9, color: tokens.ink[3], display: "block", lineHeight: 1.4 }}>
                          {guestWording}
                        </span>
                      )}
                    </span>
                    {isNext && (
                      <span style={{ fontSize: 8, letterSpacing: "0.12em", fontWeight: 700, color: tokens.ink[0], flexShrink: 0 }}>
                        NEXT
                      </span>
                    )}
                    <span style={{ fontSize: 9, color: fired ? tokens.green.text : tokens.ink[4], flexShrink: 0, minWidth: 34, textAlign: "right" }}>
                      {c.firedAt || "—"}
                    </span>
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", gap: 8, padding: 8, borderTop: `1px solid ${tokens.ink[4]}` }}>
              <div style={{ flex: 1 }}>
                <button
                  type="button"
                  disabled={!nextCourse}
                  onClick={fireNext}
                  style={darkButton(!nextCourse)}
                >{nextCourse ? `FIRE — ${nextCourse.name}` : "ALL COURSES FIRED"}</button>
              </div>
              <button
                type="button"
                disabled={!lastFired}
                onClick={undoFire}
                style={{ ...quietButton(), minWidth: 72, opacity: lastFired ? 1 : 0.4, cursor: lastFired ? "pointer" : "default" }}
              >UNDO</button>
            </div>
          </div>
        </Section>

        {/* ── 4. BOOKING CHIPS — written straight back to the reservation ── */}
        <Section label="BOOKING">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[["long", "LONG"], ["short", "SHORT"]].map(([v, l]) => (
              <button key={v} type="button" style={chip(table.menuType === v)}
                onClick={() => writeBooking("menuType", table.menuType === v ? "" : v, `MENU — ${l}`)}
              >{l}</button>
            ))}
            <span style={{ width: 1, background: tokens.ink[5], alignSelf: "stretch" }} />
            {[["en", "EN"], ["si", "SLO"]].map(([v, l]) => (
              <button key={v} type="button" style={chip((table.lang || "en") === v)}
                onClick={() => writeBooking("lang", v, `LANGUAGE — ${l}`)}
              >{l}</button>
            ))}
            <span style={{ width: 1, background: tokens.ink[5], alignSelf: "stretch" }} />
            {[["", "REGULAR"], ["hotel", "HOTEL"]].map(([v, l]) => (
              <button key={v || "regular"} type="button" style={chip((table.guestType || "") === v)}
                onClick={() => {
                  writeBooking("guestType", v, `GUEST — ${l}`);
                  if (v !== "hotel") { updBooking("rooms", []); updBooking("room", ""); }
                }}
              >{l}</button>
            ))}
            <span style={{ width: 1, background: tokens.ink[5], alignSelf: "stretch" }} />
            <button type="button" style={chip(!!table.birthday)}
              onClick={() => writeBooking("birthday", !table.birthday, table.birthday ? "CAKE OFF" : "CAKE ON")}
            >[CAKE]</button>
          </div>

          {table.guestType === "hotel" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <span style={micro}>ROOM</span>
              <input
                defaultValue={rooms.join(", ")}
                key={`rooms-${table.id}-${rooms.join(",")}`}
                aria-label="Hotel room number"
                placeholder="room no."
                onBlur={e => {
                  const next = e.target.value.split(",").map(s => s.trim()).filter(Boolean);
                  if (next.join(",") === rooms.join(",")) return;
                  updBooking("rooms", next);
                  updBooking("room", next[0] || "");
                  flash(next.length ? `ROOM — ${next.join(", ")}` : "ROOM CLEARED");
                }}
                style={{
                  fontFamily: FONT, fontSize: tokens.mobileInputSize, minHeight: TAP,
                  padding: "8px 10px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0,
                  background: tokens.neutral[0], color: tokens.ink[0], flex: 1, minWidth: 0,
                  boxSizing: "border-box", WebkitAppearance: "none",
                }}
              />
            </div>
          )}
        </Section>

        {/* ── 5. RESTRICTIONS — BY SEAT ──────────────────────────────────── */}
        <Section
          label="RESTRICTIONS — BY SEAT"
          right={
            <button
              type="button"
              onClick={() => { setAddRestrOpen(o => !o); setAddRestrSeat(null); }}
              style={{ ...quietButton(), padding: "6px 12px" }}
            >{addRestrOpen ? "CLOSE" : "+ ADD"}</button>
          }
        >
          {(table.restrictions || []).length === 0 ? (
            <div style={{ ...micro, letterSpacing: "0.10em" }}>NONE RECORDED</div>
          ) : (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {(table.restrictions || []).map((r, i) => (
                <button
                  key={`${r.note}-${r.pos ?? "x"}-${i}`}
                  type="button"
                  onClick={() => removeRestriction(i)}
                  aria-label={`Remove ${restrCompact(r.note)}${r.pos ? ` from seat ${r.pos}` : ""}`}
                  style={{
                    fontFamily: FONT, fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase",
                    minHeight: TAP, padding: "6px 10px",
                    border: `1px solid ${tokens.red.border}`, borderRadius: 0,
                    background: tokens.red.bg, color: tokens.red.text, fontWeight: 600,
                    cursor: "pointer", touchAction: "manipulation",
                  }}
                >
                  [{restrCompact(r.note)}] {r.pos ? `SEAT_${r.pos}` : "TABLE"} ×
                </button>
              ))}
            </div>
          )}

          {addRestrOpen && (
            <div style={{ border: `1px solid ${tokens.ink[4]}`, marginTop: 10, background: tokens.neutral[50] }}>
              <div style={{ padding: "10px 10px 0" }}>
                <div style={{ ...micro, marginBottom: 6 }}>SEAT</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                  {(seats.length ? seats.map(s => Number(s.id)) : Array.from({ length: covers }, (_, i) => i + 1))
                    .map(id => (
                      <button key={id} type="button" style={chip(addRestrSeat === id)}
                        aria-label={`Restriction for seat ${id}`}
                        onClick={() => setAddRestrSeat(id)}
                      >S{id}</button>
                    ))}
                </div>
              </div>
              <div style={{ padding: 10, opacity: addRestrSeat == null ? 0.4 : 1, pointerEvents: addRestrSeat == null ? "none" : "auto" }}>
                {Object.entries(RESTRICTION_GROUPS).map(([groupKey, groupLabel]) => {
                  const items = RESTRICTIONS.filter(r => (r.group || "other") === groupKey);
                  if (items.length === 0) return null;
                  return (
                    <div key={groupKey} style={{ marginBottom: 10 }}>
                      <div style={{ ...micro, marginBottom: 5 }}>{groupLabel}</div>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                        {items.map(r => (
                          <button key={r.key} type="button" style={chip(false)}
                            onClick={() => addRestriction(r.key)}
                          >{r.label}</button>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {addRestrSeat == null && (
                  <div style={{ ...micro, letterSpacing: "0.10em" }}>PICK A SEAT FIRST</div>
                )}
              </div>
            </div>
          )}
        </Section>

        {/* ── 6. BEVERAGES ──────────────────────────────────────────────
            Searches the WHOLE catalog, not just wine. The phase chip decides
            where a pick lands — as an aperitif, or with the menu — exactly as
            the old detail view did per seat; here it applies to the party.
            A GLASS is per-person and lands in each guest's glasses; a BOTTLE
            is shared and lands on the table's bottle list. Sending a glass to
            the bottle list is what made a by-the-glass pour read as a bottle
            everywhere downstream. */}
        <Section
          label="BEVERAGES"
          right={
            <div style={{ display: "flex", gap: 4 }}>
              {[["aperitif", "APERITIF"], ["menu", "WITH MENU"]].map(([ph, label]) => (
                <button
                  key={ph}
                  type="button"
                  aria-pressed={drinkPhase === ph}
                  onClick={() => setDrinkPhase(ph)}
                  style={{ ...chip(drinkPhase === ph), minHeight: 34, fontSize: 8, padding: "6px 9px" }}
                >{label}</button>
              ))}
            </div>
          }
        >
          {/* Who the pick is for. A drink is ordered per person as often as
              per table, so the panel has to be able to say "just P2". */}
          {seats.length > 1 && (
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
              <button type="button" style={{ ...chip(drinkSeat == null), minHeight: 36 }}
                aria-label="Drinks for the whole party"
                onClick={() => setDrinkSeat(null)}>PARTY</button>
              {seats.map(s => (
                <button key={s.id} type="button" style={{ ...chip(drinkSeat === s.id), minHeight: 36 }}
                  aria-label={`Drinks for seat ${s.id}`}
                  onClick={() => setDrinkSeat(drinkSeat === s.id ? null : s.id)}
                >S{s.id}</button>
              ))}
            </div>
          )}

          <input
            value={drinkQuery}
            onChange={e => setDrinkQuery(e.target.value)}
            aria-label="Search beverages"
            placeholder="search wine, cocktail, spirit, beer…"
            style={{
              fontFamily: FONT, fontSize: tokens.mobileInputSize, width: "100%", minHeight: TAP,
              padding: "9px 12px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0,
              background: tokens.neutral[0], color: tokens.ink[0], boxSizing: "border-box",
              WebkitAppearance: "none",
            }}
          />
          {drinkMatches.length > 0 && (
            <div style={{ border: `1px solid ${tokens.ink[4]}`, borderTop: "none" }}>
              {drinkMatches.map(m => (
                <div key={m.key} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "7px 10px", borderBottom: `1px solid ${tokens.ink[5]}`,
                }}>
                  <span style={{
                    fontSize: 8, letterSpacing: "0.08em", textTransform: "uppercase", flexShrink: 0,
                    padding: "2px 5px", color: tokens.ink[2], background: tokens.neutral[50],
                    border: `1px solid ${tokens.ink[4]}`,
                  }}>{BEV_LABEL[m.type] || "DRINK"}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: tokens.ink[0], lineHeight: 1.35 }}>
                    {m.item.name}
                    {m.sub && <span style={{ color: tokens.ink[3] }}> · {m.sub}</span>}
                  </span>
                  {m.type === "wine" ? (
                    <>
                      {/* GLASS only when the catalog actually pours it by the
                          glass — same rule the beverage search has always
                          used. A bottle-only wine offers BOTTLE alone. */}
                      {m.item.byGlass && (
                        <button type="button" style={{ ...quietButton(), padding: "6px 10px" }}
                          onClick={() => addDrink(m, "glass")}>GLASS</button>
                      )}
                      <button type="button" style={{ ...quietButton(), padding: "6px 10px" }}
                        onClick={() => addDrink(m, "bottle")}>BOTTLE</button>
                    </>
                  ) : (
                    <button type="button" style={{ ...quietButton(), padding: "6px 12px" }}
                      onClick={() => addDrink(m, "each")}>ADD</button>
                  )}
                </div>
              ))}
            </div>
          )}

          {chosenDrinks.length === 0 ? (
            <div style={{ ...micro, letterSpacing: "0.10em", marginTop: 10 }}>
              {drinkSeat == null ? "NONE ORDERED" : `NONE ON SEAT_${drinkSeat}`}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 10 }}>
              {chosenDrinks.map(d => (
                <div key={d.key} data-drink-row={d.tag} style={{
                  display: "flex", alignItems: "center", gap: 8,
                  border: `1px solid ${tokens.ink[4]}`, padding: "5px 5px 5px 10px",
                  background: tokens.neutral[0],
                }}>
                  <span style={{ fontSize: 8, letterSpacing: "0.10em", color: tokens.ink[3], flexShrink: 0 }}>
                    {d.tag}
                  </span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: tokens.ink[0], overflowWrap: "anywhere" }}>
                    {d.name}{d.sub ? ` · ${d.sub}` : ""}
                    {d.count != null && (
                      <span style={{ color: tokens.ink[3] }}> · {d.count}/{seats.length}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${d.name}`}
                    onClick={d.onRemove}
                    style={{
                      width: TAP, height: TAP, flexShrink: 0, border: "none", background: "none",
                      color: tokens.ink[3], fontSize: 15, lineHeight: 1, cursor: "pointer",
                      fontFamily: FONT, touchAction: "manipulation",
                    }}
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ── 7. NOTES ───────────────────────────────────────────────────── */}
        <Section label="STAFF NOTE">
          <BlurTextarea
            value={table.notes || ""}
            ariaLabel="Staff note"
            placeholder="VIP, pace, special requests…"
            onCommit={v => writeBooking("notes", v, "STAFF NOTE SAVED")}
          />
        </Section>

        {/* ── 8. ACTION GRID ─────────────────────────────────────────────── */}
        <Section label="ACTIONS">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {can.markArriving && (
              <button type="button" style={quietButton()}
                onClick={() => { onMarkArriving(); flash("MARKED ARRIVING"); }}
              >MARK ARRIVING</button>
            )}
            {can.unsetKitchen ? (
              <button type="button" style={quietButton()}
                onClick={() => { onUnsetKitchen(); flash("UNSET"); }}
              >UNSET</button>
            ) : can.setKitchen ? (
              <button type="button" style={quietButton()}
                onClick={() => { onSetKitchen(); flash("SET → KITCHEN"); }}
              >SET → KITCHEN</button>
            ) : null}
            {can.moveTable && (
              <button type="button" style={quietButton()} onClick={() => setPicker("move")}>MOVE TABLE</button>
            )}
            {can.swapTable && (
              <button type="button" style={quietButton()} onClick={() => setPicker("swap")}>SWAP TABLES</button>
            )}
            {can.joinTable && (
              <button type="button" style={quietButton()} onClick={() => setPicker("join")}>JOIN TABLE +</button>
            )}
            {can.splitTable && (
              <button type="button" style={quietButton()}
                onClick={async () => { await onSplitTable(); flash("SPLIT"); }}
              >SPLIT {group.map(id => `T${String(id).padStart(2, "0")}`).join("+")}</button>
            )}
            {can.ticket && (
              <button type="button" style={quietButton()} onClick={onOpenTicket}>TICKET &amp; MENUS</button>
            )}
            {can.clearTable && (
              <button type="button" style={quietButton(true)} onClick={() => setConfirmClear(true)}>CLEAR TABLE</button>
            )}
          </div>
        </Section>

        <div style={{ height: 28 }} />

        {/* Live write confirmation — there is no save button, so the toast is
            the only receipt an action actually landed. */}
        {toast && (
          <div
            role="status"
            aria-live="polite"
            style={{
              position: "sticky", bottom: 12, margin: "0 16px",
              background: tokens.ink[0], color: tokens.neutral[0],
              fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
              padding: "11px 14px", textAlign: "center",
            }}
          >{toast}</div>
        )}
      </aside>

      {picker && (
        <TablePickerModal
          mode={picker}
          currentTable={table}
          tables={tables}
          reservations={reservations}
          reservationOnTable={reservationOnTable}
          seatCapOf={seatCapOf}
          pickable={pickerPickable}
          onPick={onPickTable}
          onCancel={() => setPicker(null)}
        />
      )}

      {confirmClear && (
        <ConfirmDialog
          danger
          label="[CLEAR TABLE]"
          confirmLabel="CLEAR TABLE"
          body={`Clearing ${primaryLabel}${joinedLabels ? ` ${joinedLabels}` : ""} takes ${table.resName || "this party"} off the live board: orders, seats, fired courses and notes all leave the service.`}
          reassurance="The booking itself is kept for the planner and the archive, and the kitchen ticket can be restored from Archive."
          onCancel={() => setConfirmClear(false)}
          onConfirm={async () => {
            setConfirmClear(false);
            await onClearTable();
          }}
        />
      )}
    </>
  );
}
