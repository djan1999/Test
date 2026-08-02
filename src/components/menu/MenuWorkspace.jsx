import { useEffect, useMemo, useRef, useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { useIsMobile, BP } from "../../hooks/useIsMobile.js";
import {
  PAIRING_SETS,
  buildSeatMenu,
  seatRestrictionKeys,
  restrictionTag,
  defaultMenuTitle,
  defaultThankYou,
} from "../../utils/seatMenuPlan.js";
import { renderSeatMenuHTML, printSeatMenu, PAGE_W_PX, PAGE_H_PX } from "../../utils/seatMenuPrint.js";

const FONT = tokens.font;
const { ink, neutral, red, rule, signal } = tokens;

const RAIL_W = 270;
const RAIL_STRIP_MAX_H = 200;
const PREVIEW_W = 280;
const PREVIEW_SCALE = PREVIEW_W / PAGE_W_PX;

// ── Shared chrome, built from the app's existing scale/colours ───────────────
const railHeader = {
  fontFamily: FONT, fontSize: "8px", letterSpacing: "0.16em",
  textTransform: "uppercase", color: ink[3],
};

const fieldLabel = {
  fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em",
  textTransform: "uppercase", color: ink[3], marginBottom: 6,
};

const textInput = {
  fontFamily: FONT, fontSize: "11px", padding: "8px 10px",
  border: `${rule.hairline} solid ${ink[4]}`, borderRadius: 0, outline: "none",
  background: neutral[0], color: ink[0], width: "100%", boxSizing: "border-box",
};

const chip = (active) => ({
  fontFamily: FONT, fontSize: "9px", letterSpacing: "0.08em", textTransform: "uppercase",
  padding: "5px 12px", borderRadius: 0, cursor: "pointer",
  border: `${rule.hairline} solid ${active ? tokens.charcoal.default : ink[4]}`,
  background: active ? tokens.tint.parchment : neutral[0],
  color: active ? ink[1] : ink[3],
});

const button = (strong = false) => ({
  fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase",
  padding: "7px 14px", borderRadius: 0, cursor: "pointer",
  border: `${rule.hairline} solid ${strong ? tokens.charcoal.default : ink[4]}`,
  background: strong ? tokens.charcoal.default : neutral[0],
  color: strong ? neutral[0] : ink[2],
});

const pad2 = (n) => String(n).padStart(2, "0");

/** Only the head of a joined group represents the party. */
const isPartyHead = (t) => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup);
const isLiveParty = (t) => Boolean(t.active || t.arrivedAt || t.resName || t.resTime);

const tableLabelOf = (t) =>
  t.displayGroupLabel || t.displayLabel ||
  (t.tableGroup?.length > 1
    ? `T${Math.min(...t.tableGroup)}-${Math.max(...t.tableGroup)}`
    : `T${pad2(t.id)}`);

const menuTypeOf = (t) =>
  String(t?.menuType || "").trim().toLowerCase() === "short" ? "short" : "long";

const langOf = (t) => (String(t?.lang || "").trim().toLowerCase() === "si" ? "si" : "en");

const langTag = (lang) => (lang === "si" ? "SL" : "EN");

const statusOf = (t) => (t.active || t.arrivedAt ? "SEATED" : "RESERVED");

/** "CV_02 · LONG · SL · SEATED" */
const metaLineOf = (t) => [
  `CV_${pad2((t.seats || []).length)}`,
  menuTypeOf(t).toUpperCase(),
  langTag(langOf(t)),
  statusOf(t),
].join(" · ");

/**
 * The courses this print run covers. SHORT is the booking's short menu — the
 * courses flagged for it, in their short order. A menu with nothing flagged
 * falls back to the full list rather than printing an empty sheet.
 */
const coursesForMenuType = (courses, menuType) => {
  const all = (courses || []).filter((c) => c && c.menu?.name);
  if (menuType !== "short") return all;
  const short = all.filter((c) => c.show_on_short);
  if (short.length === 0) return all;
  return [...short].sort(
    (a, b) => (Number(a.short_order) || 0) - (Number(b.short_order) || 0),
  );
};

/**
 * MENU workspace — per-guest printed menus generated from the live service.
 *
 * A menu belongs to a SEAT, not a table: the seat tabs below the options are
 * the unit of work, and PRINT ALL walks them. Every option change re-runs
 * generation immediately, so there is no generate button to forget to press.
 * Nothing on this screen writes to the master menu — substitutions come from
 * the course records, and one-time edits live in local state only.
 */
export default function MenuWorkspace({
  tables = [],
  menuCourses = [],
  aperitifOptions = [],
  wordmark = "MILKA",
  onSelectTable,
}) {
  const isNarrow = useIsMobile(BP.lg);

  const parties = useMemo(
    () => (tables || []).filter((t) => isPartyHead(t) && isLiveParty(t)),
    [tables],
  );

  const [selectedId, setSelectedId] = useState(null);
  const table = useMemo(
    () => parties.find((t) => t.id === selectedId) || null,
    [parties, selectedId],
  );

  // ── Print-run options — seeded from the booking, scoped to this run ────────
  const [menuType, setMenuType] = useState("long");
  const [lang, setLang] = useState("en");
  const [pairingSet, setPairingSet] = useState("");
  const [aperitif, setAperitif] = useState("");
  const [title, setTitle] = useState("");
  const [thankYou, setThankYou] = useState("");
  const [seatIndex, setSeatIndex] = useState(0);
  // One-time edits — { [seatId]: { [courseKey]: { name } } }. Seat + course
  // scoped, never persisted, and wiped by CLEAR EDITS.
  const [edits, setEdits] = useState({});
  const [openCourse, setOpenCourse] = useState(null);
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  const flash = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // Selecting a party reseeds every option from that booking and drops the
  // previous party's one-time edits — they were scoped to seats that are gone.
  useEffect(() => {
    if (!table) return;
    const nextLang = langOf(table);
    setMenuType(menuTypeOf(table));
    setLang(nextLang);
    setPairingSet("");
    setAperitif("");
    setTitle(defaultMenuTitle(nextLang));
    setThankYou(defaultThankYou(nextLang));
    setSeatIndex(0);
    setEdits({});
    setOpenCourse(null);
  }, [table?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Language drives the pre-filled copy, so switching it refreshes both fields.
  const changeLang = (next) => {
    setLang(next);
    setTitle(defaultMenuTitle(next));
    setThankYou(defaultThankYou(next));
  };

  // Aperitif shortcuts come from the workspace's Quick Access config, so this
  // screen offers the same bottles the floor does rather than a private list.
  const aperitifShortcuts = useMemo(() => {
    const labels = (aperitifOptions || [])
      .map((o) => String(o?.label || o || "").trim().toUpperCase())
      .filter(Boolean);
    return [...new Set(labels)].slice(0, 4);
  }, [aperitifOptions]);

  const seats = table?.seats || [];
  const restrictions = table?.restrictions || [];
  const courses = useMemo(
    () => coursesForMenuType(menuCourses, menuType),
    [menuCourses, menuType],
  );

  const activeSeat = seats[Math.min(seatIndex, Math.max(seats.length - 1, 0))] || null;

  const planFor = (seat, i) => buildSeatMenu({
    seat,
    seatNumber: i + 1,
    seatCount: seats.length,
    restrictions,
    courses,
    lang,
    pairingSet,
    menuTitle: title,
    thankYou,
    aperitif,
    edits: edits[seat?.id] || {},
    wordmark,
  });

  // Regenerated on every render — every option change is already live here.
  const activePlan = activeSeat ? planFor(activeSeat, seats.indexOf(activeSeat)) : null;
  const previewHtml = activePlan ? renderSeatMenuHTML(activePlan) : "";

  const hasEdits = Object.values(edits).some((m) => Object.keys(m || {}).length > 0);

  const saveEdit = (seatId, courseKey, value) => {
    const text = String(value || "").trim();
    setEdits((prev) => {
      const forSeat = { ...(prev[seatId] || {}) };
      if (!text) delete forSeat[courseKey];
      else forSeat[courseKey] = { name: text };
      const next = { ...prev };
      if (Object.keys(forSeat).length === 0) delete next[seatId];
      else next[seatId] = forSeat;
      return next;
    });
    setOpenCourse(null);
  };

  const printOne = (seat, i) => {
    const ok = printSeatMenu(planFor(seat, i));
    flash(ok ? `SEAT ${i + 1} SENT TO PRINT` : "POP-UP BLOCKED — ALLOW POP-UPS TO PRINT");
    return ok;
  };

  const printAll = () => {
    if (seats.length === 0) return;
    // Staggered: browsers drop print windows opened in the same tick.
    seats.forEach((seat, i) => setTimeout(() => printSeatMenu(planFor(seat, i)), i * 700));
    flash(`${seats.length} SEAT MENUS SENT TO PRINT`);
  };

  // ── Left rail ─────────────────────────────────────────────────────────────
  const rail = (
    <div
      style={{
        width: isNarrow ? "100%" : RAIL_W,
        flexShrink: 0,
        maxHeight: isNarrow ? RAIL_STRIP_MAX_H : "none",
        borderRight: isNarrow ? "none" : `${rule.hairline} solid ${ink[4]}`,
        borderBottom: isNarrow ? `${rule.hairline} solid ${ink[4]}` : "none",
        background: neutral[0],
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div style={{ ...railHeader, padding: "12px 14px", borderBottom: `${rule.hairline} solid ${ink[5]}`, flexShrink: 0 }}>
        ACTIVE TABLES — TAP TO PREPARE MENUS
      </div>
      <div
        style={{
          // Narrow: a horizontal strip so the rail never eats the workspace.
          display: "flex",
          flexDirection: isNarrow ? "row" : "column",
          overflowX: isNarrow ? "auto" : "hidden",
          overflowY: isNarrow ? "hidden" : "auto",
          flex: 1,
        }}
      >
        {parties.length === 0 && (
          <div style={{ ...railHeader, padding: "14px", color: ink[4] }}>NO LIVE PARTIES</div>
        )}
        {parties.map((t) => {
          const selected = t.id === selectedId;
          const restrCount = (t.restrictions || []).filter((r) => r && r.note).length;
          return (
            <button
              key={t.id}
              onClick={() => { setSelectedId(t.id); onSelectTable?.(t.id); }}
              style={{
                display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                padding: "11px 12px",
                minWidth: isNarrow ? 230 : 0,
                flexShrink: 0,
                cursor: "pointer",
                borderTop: "none", borderRight: "none",
                borderBottom: `${rule.hairline} solid ${ink[5]}`,
                borderLeft: `3px solid ${selected ? tokens.charcoal.default : "transparent"}`,
                background: selected ? tokens.tint.parchment : neutral[0],
                borderRadius: 0,
                width: isNarrow ? "auto" : "100%",
              }}
            >
              <span style={{
                width: 64, flexShrink: 0, fontFamily: FONT, fontSize: "13px", fontWeight: 700,
                letterSpacing: "-0.01em", color: ink[0],
              }}>{tableLabelOf(t)}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  display: "block", fontFamily: FONT, fontSize: "12px", color: ink[1],
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{t.resName || "—"}</span>
                <span style={{
                  display: "block", marginTop: 3, fontFamily: FONT, fontSize: "8px",
                  letterSpacing: "0.1em", textTransform: "uppercase", color: ink[3],
                }}>{metaLineOf(t)}</span>
              </span>
              {restrCount > 0 && (
                <span style={{
                  flexShrink: 0, fontFamily: FONT, fontSize: "9px", fontWeight: 700,
                  color: red.text,
                }}>[{restrCount}]</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );

  // ── Empty state ───────────────────────────────────────────────────────────
  if (!table) {
    return (
      <div style={{ display: "flex", flexDirection: isNarrow ? "column" : "row", flex: 1, minHeight: 0 }}>
        {rail}
        <div style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
          padding: 24,
        }}>
          <span style={{
            fontFamily: FONT, fontSize: "10px", letterSpacing: "0.18em",
            textTransform: "uppercase", color: ink[3], textAlign: "center",
          }}>CHOOSE A TABLE — THEN GENERATE MENUS</span>
        </div>
      </div>
    );
  }

  const seatedAt = table.arrivedAt || table.resTime || "";
  const partyMeta = [
    tableLabelOf(table),
    `CV_${pad2(seats.length)}`,
    seatedAt ? `${statusOf(table)} ${seatedAt}` : statusOf(table),
  ].join(" · ");

  return (
    <div style={{ display: "flex", flexDirection: isNarrow ? "column" : "row", flex: 1, minHeight: 0 }}>
      {rail}

      <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: isNarrow ? "16px" : "20px 24px" }}>

        {/* 1 — Party line */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
          <span style={{ fontFamily: FONT, fontSize: "15px", color: ink[0] }}>{table.resName || "—"}</span>
          <span style={{
            fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em",
            textTransform: "uppercase", color: ink[3],
          }}>{partyMeta}</span>
          {hasEdits && (
            <>
              <span style={{
                fontFamily: FONT, fontSize: "8px", fontWeight: 600, letterSpacing: "0.1em",
                textTransform: "uppercase", padding: "3px 7px",
                border: `${rule.hairline} solid ${signal.warn}`, color: signal.warn,
                background: neutral[0],
              }}>EDITED — ONE-TIME CHANGES</span>
              <button onClick={() => { setEdits({}); setOpenCourse(null); flash("ONE-TIME EDITS CLEARED"); }}
                style={button()}>CLEAR EDITS</button>
            </>
          )}
        </div>

        {/* 2 — Menu type + language. Defaults come from the booking; changing
            them here affects only this print run. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          {[["long", "LONG MENU"], ["short", "SHORT MENU"]].map(([val, label]) => (
            <button key={val} onClick={() => setMenuType(val)} style={chip(menuType === val)}>{label}</button>
          ))}
          <span style={{ color: ink[4], fontFamily: FONT, fontSize: "9px" }}>·</span>
          {[["en", "EN"], ["si", "SLO"]].map(([val, label]) => (
            <button key={val} onClick={() => changeLang(val)} style={chip(lang === val)}>{label}</button>
          ))}
        </div>

        {/* 3 — Pairing set + aperitif shortcuts. The pairing set rewrites the
            grey line under every course. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
          {PAIRING_SETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPairingSet(pairingSet === p.key ? "" : p.key)}
              style={chip(pairingSet === p.key)}
            >{p.label}</button>
          ))}
          <span style={{ color: ink[4], fontFamily: FONT, fontSize: "9px" }}>·</span>
          {aperitifShortcuts.map((label) => (
            <button
              key={label}
              onClick={() => setAperitif(aperitif === label ? "" : label)}
              style={chip(aperitif === label)}
            >{label}</button>
          ))}
        </div>

        {/* 4 — Title + thank-you */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <div style={fieldLabel}>MENU TITLE</div>
            <input value={title} onChange={(e) => setTitle(e.target.value)} style={textInput} />
          </div>
          <div style={{ flex: "1 1 240px", minWidth: 0 }}>
            <div style={fieldLabel}>THANK-YOU LINE</div>
            <input value={thankYou} onChange={(e) => setThankYou(e.target.value)} style={textInput} />
          </div>
        </div>

        {/* 5 — Seat tabs + print actions */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 18 }}>
          {seats.map((seat, i) => {
            const tags = seatRestrictionKeys(restrictions, seat.id).map(restrictionTag);
            const active = seat.id === activeSeat?.id;
            return (
              <button key={seat.id} onClick={() => { setSeatIndex(i); setOpenCourse(null); }}
                style={{ ...chip(active), padding: "6px 10px", textAlign: "left" }}>
                <span style={{ display: "block" }}>SEAT {i + 1}</span>
                {tags.length > 0 && (
                  <span style={{
                    display: "block", marginTop: 3, fontSize: "7px", letterSpacing: "0.06em",
                    color: red.text, fontWeight: 600,
                  }}>{tags.join(" · ")}</span>
                )}
              </button>
            );
          })}
          {seats.length === 0 && (
            <span style={{ ...railHeader, color: ink[4] }}>NO SEATS ON THIS PARTY</span>
          )}
          {seats.length > 0 && (
            <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
              <button onClick={() => printOne(activeSeat, seats.indexOf(activeSeat))} style={button()}>
                PRINT THIS SEAT
              </button>
              <button onClick={printAll} style={button(true)}>
                PRINT ALL {seats.length} SEATS
              </button>
            </div>
          )}
        </div>

        {/* Course list + live preview */}
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: isNarrow ? "wrap" : "nowrap" }}>

          {/* Course list */}
          <div style={{ flex: "1 1 320px", minWidth: 0 }}>
            {(activePlan?.courses || []).map((course) => {
              const open = openCourse === course.courseKey;
              const accent = course.substituted ? red.border : course.edited ? signal.warn : ink[4];
              return (
                <div
                  key={course.courseKey}
                  onClick={() => {
                    if (open) return;
                    setOpenCourse(course.courseKey);
                    setDraft(course.name);
                  }}
                  style={{
                    // Both children below are flex: 1 1 100% — the edit input
                    // and the course text must each own a full line. Sharing a
                    // line collapses the text column to one word per line.
                    display: "flex", flexWrap: "wrap",
                    border: `${rule.hairline} solid ${accent}`,
                    borderLeft: `3px solid ${accent}`,
                    background: neutral[0], padding: "10px 12px", marginBottom: 8,
                    cursor: open ? "default" : "pointer",
                  }}
                >
                  <div style={{ flex: "1 1 100%", minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
                      <span style={{
                        fontFamily: FONT, fontSize: "9px", color: ink[3], flexShrink: 0,
                      }}>{pad2(course.index)}</span>
                      <span style={{
                        fontFamily: FONT, fontSize: "12px", color: ink[0], lineHeight: 1.35,
                        minWidth: 0,
                      }}>{course.name}{course.sub ? ` — ${course.sub}` : ""}</span>
                    </div>

                    {course.substituted && (
                      <div style={{
                        marginTop: 6, fontFamily: FONT, fontSize: "8px", letterSpacing: "0.06em",
                        color: red.text, lineHeight: 1.4,
                      }}>
                        SUBSTITUTED FOR [{course.substitutedForTag}] — WAS: {course.wasName}
                      </div>
                    )}
                    {course.edited && (
                      <div style={{
                        marginTop: 6, fontFamily: FONT, fontSize: "8px", letterSpacing: "0.06em",
                        color: signal.warn, lineHeight: 1.4,
                      }}>✎ ONE-TIME EDIT — THIS SEAT ONLY</div>
                    )}
                    {course.pairing && (
                      <div style={{
                        marginTop: 6, fontFamily: FONT, fontSize: "9px", color: ink[3], lineHeight: 1.4,
                      }}>{course.pairing}</div>
                    )}
                  </div>

                  {open && (
                    <div style={{ flex: "1 1 100%", display: "flex", gap: 8, marginTop: 10, minWidth: 0 }}>
                      <input
                        autoFocus
                        value={draft}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit(activeSeat.id, course.courseKey, draft);
                          if (e.key === "Escape") setOpenCourse(null);
                        }}
                        style={{ ...textInput, flex: 1, minWidth: 0 }}
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); saveEdit(activeSeat.id, course.courseKey, draft); }}
                        style={{ ...button(true), flexShrink: 0 }}
                      >SAVE</button>
                    </div>
                  )}
                </div>
              );
            })}
            {(activePlan?.courses || []).length === 0 && (
              <div style={{ ...railHeader, color: ink[4] }}>NO COURSES ON THIS MENU</div>
            )}
          </div>

          {/* Live preview — the actual printed page, scaled down */}
          {activePlan && (
            <div style={{ flexShrink: 0, width: PREVIEW_W }}>
              <div style={{ ...fieldLabel, marginBottom: 8 }}>PREVIEW · SEAT {activePlan.seatNumber} OF {activePlan.seatCount}</div>
              <div style={{
                width: PREVIEW_W, height: PAGE_H_PX * PREVIEW_SCALE,
                overflow: "hidden", border: `${rule.hairline} solid ${ink[4]}`, background: neutral[0],
              }}>
                <iframe
                  title={`Seat ${activePlan.seatNumber} menu preview`}
                  srcDoc={previewHtml}
                  scrolling="no"
                  style={{
                    width: PAGE_W_PX, height: PAGE_H_PX, border: "none",
                    transform: `scale(${PREVIEW_SCALE})`, transformOrigin: "top left",
                  }}
                />
              </div>
            </div>
          )}
        </div>

        <div style={{ height: 28 }} />
      </div>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed", bottom: 18, left: "50%", transform: "translateX(-50%)",
            background: ink[0], color: neutral[0], fontFamily: FONT, fontSize: 9,
            letterSpacing: "0.12em", textTransform: "uppercase", padding: "11px 16px",
            zIndex: 50,
          }}
        >{toast}</div>
      )}
    </div>
  );
}
