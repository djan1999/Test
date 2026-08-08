import { useEffect, useMemo, useRef, useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { useIsMobile, BP } from "../../hooks/useIsMobile.js";
import { generateMenuHTML, DEFAULT_MENU_RULES, normalizeMenuRules } from "../../utils/menuGenerator.js";
import { getAssignedGuestProfile } from "../../utils/menuLayoutProfiles.js";
import { writeTeamNames, readTeamNames, writeMenuTitle, readMenuTitle, writeThankYouNote, readThankYouNote } from "../../utils/storage.js";
import { optionalExtrasFromCourses, optionalPairingsFromCourses, resolveSeatRestrictionKeys } from "../../utils/menuUtils.js";
import { supabase } from "../../lib/supabaseClient.js";
import { readStateKey, saveStateKey } from "../../lib/stateStore.js";
import { BEV_TYPES } from "../../constants/beverageTypes.js";
import { PAIRINGS } from "../../constants/pairings.js";
import BeverageSearch from "../service/BeverageSearch.jsx";
import { resolveAperitifFromQuickAccessOption } from "../../utils/quickAccessResolve.js";
import { addOne, groupDrinks, removeAll, removeOne } from "../../utils/drinkQuantities.js";
import { combineMenuPages } from "../../utils/printAllPages.js";
import {
  courseKeyOf,
  substitutionAttribution,
  restrictionTag,
  defaultMenuTitle,
  defaultThankYou,
} from "../../utils/seatMenuPlan.js";

const FONT = tokens.font;
const { ink, neutral, red, rule, signal } = tokens;

const RAIL_W = 270;
const RAIL_STRIP_MAX_H = 200;
// Preview sizing: the sheet grows into whatever width the course list leaves
// free, instead of pinning to a thumbnail and stranding the space.
const PREVIEW_MIN_W = 280;
// A5 portrait in CSS pixels at 96dpi — what generateMenuHTML's page measures.
const PAGE_W_PX = (148 / 25.4) * 96;
const PAGE_H_PX = (210 / 25.4) * 96;

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

/**
 * One drink on the seat, with the count next to it.
 *
 * Duplicates collapse into a single pill: a guest on their third glass of the
 * same wine used to be three identical pills, and a fourth meant going back
 * through the search box. − and + step the stored list by one entry, which is
 * the same edit the search box makes and the same one the table sheet's
 * counter makes.
 */
function DrinkPill({ ts, label, qty, onDec, onInc, onRemove }) {
  const step = {
    fontFamily: FONT, fontSize: 13, lineHeight: 1, fontWeight: 700, padding: "0 4px",
    background: "none", border: "none", color: ts.color, cursor: "pointer", opacity: 0.8,
  };
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px 4px 10px", borderRadius: 0, background: ts.bg, border: `1px solid ${ts.border}` }}>
      <span style={{ fontFamily: FONT, fontSize: 11, color: ts.color, fontWeight: 500, whiteSpace: "nowrap" }}>{label}</span>
      <button type="button" aria-label={`One less ${label}`} onClick={onDec} style={step}>−</button>
      <span style={{ fontFamily: FONT, fontSize: 11, color: ts.color, fontWeight: 700, fontVariantNumeric: "tabular-nums", minWidth: 8, textAlign: "center" }}>{qty}</span>
      <button type="button" aria-label={`One more ${label}`} onClick={onInc} style={step}>+</button>
      <button type="button" aria-label={`Remove ${label}`} onClick={onRemove} style={{ background: "none", border: "none", color: ts.color, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 0 0 2px", opacity: 0.7 }}>×</button>
    </div>
  );
}

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

// A stored template with zero rows renders a completely blank menu, so treat
// it as absent — the fallback chain (short → long → auto-built default in
// generateMenuHTML) then produces a printable menu instead of an empty page.
const nonEmptyTemplate = (t) => (t && Array.isArray(t.rows) && t.rows.length > 0) ? t : null;

/**
 * MENU workspace — per-guest printed menus generated from the live service.
 *
 * A menu belongs to a SEAT, not a table: the seat tabs below the options are
 * the unit of work, and PRINT ALL walks them. Every option change re-runs
 * generation immediately, so there is no generate button to forget to press.
 *
 * There is ONE menu engine in this app — generateMenuHTML — and this screen is
 * only a face on it: the preview iframe, the printed page, and the course
 * cards all come from that engine (the cards via `_rowsOnly: true`). The
 * assigned layout profile's template + layoutStyles drive everything, exactly
 * as they do everywhere else.
 *
 * Substitutions come from the course records; one-time edits live in local
 * state only, keyed by the engine's courseKey, and feed straight into
 * seatOutputOverrides. Nothing on this screen writes to the master menu —
 * per-seat pairing/drinks/extras write to the SEAT through `upd`, the same
 * path the service board uses, so the kitchen sees them too.
 */
export default function MenuWorkspace({
  tables = [],
  menuCourses = [],
  upd,
  logoDataUri = "",
  wines: winesCatalog = [],
  cocktails: cocktailsCatalog = [],
  spirits: spiritsCatalog = [],
  beers: beersCatalog = [],
  aperitifOptions = [],
  menuRules = DEFAULT_MENU_RULES,
  profiles = [],
  assignments = {},
  initialTableId = null,
}) {
  const isNarrow = useIsMobile(BP.lg);

  const parties = useMemo(
    () => (tables || []).filter((t) => isPartyHead(t) && isLiveParty(t)),
    [tables],
  );

  const [selectedId, setSelectedId] = useState(initialTableId);
  // Resolve from the full table list, not just the rail's live parties, so a
  // caller-preselected table (initialTableId) works even before it is "live".
  const table = useMemo(
    () => (tables || []).find((t) => t.id === selectedId) || null,
    [tables, selectedId],
  );

  // ── Print options ──────────────────────────────────────────────────────────
  // menuType/lang are seeded from the booking; changing them here affects only
  // this screen's output (menuType picks the profile's long/short template).
  const [menuType, setMenuType] = useState("long");
  const [lang, setLang] = useState("en");
  const [seatIndex, setSeatIndex] = useState(0);
  // One-time edits — { [seatId]: { [courseKey]: { name?, sub?, drinkName?, drinkSub? } } }.
  // Keyed by the ENGINE's courseKey and fed to generateMenuHTML as
  // seatOutputOverrides. Never persisted; wiped by CLEAR EDITS and consumed
  // (cleared for the seat) by printing that seat.
  const [seatEdits, setSeatEdits] = useState({});
  const [openCourse, setOpenCourse] = useState(null);
  const [draft, setDraft] = useState({ name: "", sub: "", drinkName: "", drinkSub: "" });
  const [drinksOpen, setDrinksOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);

  // ── Preview scale — fill the width the course column leaves free ──────────
  // The sheet scales to its container's live width, capped by the viewport
  // height (the whole page must stay visible) and by 1:1 (never blow the A5
  // page up past its print size).
  const previewBoxRef = useRef(null);
  const [previewScale, setPreviewScale] = useState(PREVIEW_MIN_W / PAGE_W_PX);
  useEffect(() => {
    const measure = () => {
      const el = previewBoxRef.current;
      if (!el) return;
      const w = el.clientWidth || PREVIEW_MIN_W;
      // ~90px of chrome above the sticky sheet: pane padding + preview label.
      const maxH = Math.max(window.innerHeight - 90, PAGE_H_PX * (PREVIEW_MIN_W / PAGE_W_PX));
      const scale = Math.min(w / PAGE_W_PX, maxH / PAGE_H_PX, 1);
      setPreviewScale((prev) => (Math.abs(prev - scale) > 0.005 ? scale : prev));
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro && previewBoxRef.current) ro.observe(previewBoxRef.current);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
    // Re-attach when the preview (re)mounts: a party is picked or the layout
    // flips between rail and strip.
  }, [selectedId, isNarrow]);

  const flash = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2400);
  };
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  // ── Team names / menu title / thank-you — persistence shared with the rest
  // of the app (localStorage seeds, Supabase state store as source of truth).
  // Title and thank-you are stored as { en, si } so both languages persist
  // independently — storing a single value caused the last-switched language
  // to overwrite the other language on the next open.
  const [teamNames, setTeamNames] = useState(readTeamNames);
  const [menuTitle, setMenuTitle] = useState(() => readMenuTitle("en") || defaultMenuTitle("en"));
  const [thankYouNote, setThankYouNote] = useState(() => readThankYouNote("en") || defaultThankYou("en"));
  const genLoaded = useRef(false);

  useEffect(() => {
    if (!supabase) { genLoaded.current = true; return; }
    const currentLang = lang;
    Promise.all([
      readStateKey("menu_gen_team").catch(() => null),
      readStateKey("menu_gen_title").catch(() => null),
      readStateKey("menu_gen_thankyou").catch(() => null),
    ]).then(([teamState, titleState, thankYouState]) => {
      if (teamState?.value) setTeamNames(teamState.value);

      // Only apply store values when in the new bilingual { en, si } format.
      // The legacy { value } format has no language tag — applying it blindly
      // would overwrite the correct language's localStorage value (e.g. showing
      // the SI title when opening in EN mode). If the row is still in the old
      // format, leave the state as-is (already seeded from localStorage in useState).
      if (titleState && (typeof titleState.en === "string" || typeof titleState.si === "string")) {
        const val = titleState[currentLang] ?? "";
        if (val) {
          writeMenuTitle(currentLang, val); // Hydrate current lang to localStorage so the menuTitle effect reads the correct value
          setMenuTitle(val);
        }
        const otherLang = currentLang === "en" ? "si" : "en";
        if (titleState[otherLang]) writeMenuTitle(otherLang, titleState[otherLang]);
      }

      if (thankYouState && (typeof thankYouState.en === "string" || typeof thankYouState.si === "string")) {
        const val = thankYouState[currentLang] ?? "";
        if (val) {
          writeThankYouNote(currentLang, val); // Same fix for thank-you note
          setThankYouNote(val);
        }
        const otherLang = currentLang === "en" ? "si" : "en";
        if (thankYouState[otherLang]) writeThankYouNote(otherLang, thankYouState[otherLang]);
      }

      genLoaded.current = true;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Save team names to localStorage + Supabase when changed
  useEffect(() => {
    writeTeamNames(teamNames);
    if (!genLoaded.current || !supabase) return;
    saveStateKey("menu_gen_team", { value: teamNames });
  }, [teamNames]);

  // Save menu title to Supabase when changed — store both languages so switching
  // lang never clobbers the other language's stored value.
  // Note: localStorage writes happen directly in onChange and setLanguageWithDefaults
  // (not here) to avoid a React batching race where lang changes before menuTitle.
  useEffect(() => {
    if (!genLoaded.current || !supabase) return;
    saveStateKey("menu_gen_title", { en: readMenuTitle("en"), si: readMenuTitle("si") });
  }, [menuTitle]);

  // Save thank-you note to Supabase when changed — same multi-lang approach.
  useEffect(() => {
    if (!genLoaded.current || !supabase) return;
    saveStateKey("menu_gen_thankyou", { en: readThankYouNote("en"), si: readThankYouNote("si") });
  }, [thankYouNote]);

  const normalizedMenuRules = normalizeMenuRules(menuRules);

  const setLanguageWithDefaults = (nextLang) => {
    writeMenuTitle(lang, menuTitle);
    writeThankYouNote(lang, thankYouNote);
    setLang(nextLang);
    if (normalizedMenuRules?.overwriteTitleAndThankYouOnLanguageSwitch !== false) {
      setMenuTitle(readMenuTitle(nextLang) || defaultMenuTitle(nextLang));
      setThankYouNote(readThankYouNote(nextLang) || defaultThankYou(nextLang));
    }
  };

  // ── Layout profile → template + styles (the app's ONE engine setup) ────────
  const assignedProfile = useMemo(
    () => getAssignedGuestProfile("", profiles, assignments),
    [profiles, assignments],
  );
  const isShortMenu = menuType === "short";
  const menuTemplate = isShortMenu
    ? (nonEmptyTemplate(assignedProfile?.shortMenuTemplate) || nonEmptyTemplate(assignedProfile?.menuTemplate) || null)
    : (nonEmptyTemplate(assignedProfile?.menuTemplate) || null);
  const layoutStyles = assignedProfile?.layoutStyles || {};

  // Selecting a party reseeds the options from that booking and drops the
  // previous party's one-time edits — they were scoped to seats that are gone.
  useEffect(() => {
    if (!table) return;
    setMenuType(menuTypeOf(table));
    const nextLang = langOf(table);
    if (nextLang !== lang) setLanguageWithDefaults(nextLang);
    setSeatIndex(0);
    setSeatEdits({});
    setOpenCourse(null);
    setDrinksOpen(false);
  }, [table?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const seats = table?.seats || [];
  const restrictions = table?.restrictions || [];
  const tableBottles = table?.bottleWines || [];
  const activeSeat = seats[Math.min(seatIndex, Math.max(seats.length - 1, 0))] || null;

  const optionalExtras   = useMemo(() => optionalExtrasFromCourses(menuCourses),   [menuCourses]);
  const optionalPairings = useMemo(() => optionalPairingsFromCourses(menuCourses), [menuCourses]);

  // Engine-keyed course lookup, for the attribution pass on the cards.
  const courseByKey = useMemo(() => {
    const m = new Map();
    (menuCourses || []).forEach((c, i) => m.set(courseKeyOf(c, i), c));
    return m;
  }, [menuCourses]);

  // ── Seat writes — the app's one seat-update path, through `upd` ───────────
  const updSeat = (seatId, field, valueOrFn) => {
    if (!upd || !table) return;
    upd(table.id, "seats", prev => (prev || []).map(s =>
      s.id === seatId ? { ...s, [field]: typeof valueOrFn === "function" ? valueOrFn(s[field], s) : valueOrFn } : s
    ));
  };
  // Atomically update multiple fields (or the whole seat) from latest committed state.
  const updSeatFull = (seatId, fn) => {
    if (!upd || !table) return;
    upd(table.id, "seats", prev => (prev || []).map(s => s.id === seatId ? fn(s) : s));
  };

  // ── The ONE generator — everything below renders through generateMenuHTML ──
  const engineArgs = (seat, overrides) => ({
    seat,
    table: {
      menuType: isShortMenu ? "short" : (table?.menuType || ""),
      restrictions,
      bottleWines: tableBottles,
      birthday: table?.birthday || false,
    },
    menuTitle,
    teamNames,
    menuCourses,
    beerChoice: seat.pairing === "Non-Alc" ? "nonalc" : "alco",
    lang,
    seatOutputOverrides: overrides,
    thankYouNote,
    layoutStyles,
    menuRules: normalizedMenuRules,
    menuTemplate,
    catalog: { wines: winesCatalog, cocktails: cocktailsCatalog, spirits: spiritsCatalog, beers: beersCatalog },
    _logo: logoDataUri,
  });

  const htmlFor = (seat) => generateMenuHTML(engineArgs(seat, seatEdits[seat.id] || {}));
  const courseRowsFor = (seat, overrides) =>
    generateMenuHTML({ ...engineArgs(seat, overrides), _rowsOnly: true })
      .filter((r) => r.type === "course" && r.courseKey);

  /**
   * The course cards — the engine's OWN row model for this seat (via
   * `_rowsOnly`), so the list can never diverge from the printed page. The
   * attribution pass runs alongside to explain WHY a wording differs.
   */
  const cardsFor = (seat) => {
    const edits = seatEdits[seat.id] || {};
    const rows = courseRowsFor(seat, edits);
    const baseRows = Object.keys(edits).length > 0 ? courseRowsFor(seat, {}) : rows;
    const baseByKey = new Map(baseRows.map((r) => [r.courseKey, r]));
    const seatKeys = resolveSeatRestrictionKeys(restrictions, seat.id);
    return rows.map((row, idx) => {
      const base = baseByKey.get(row.courseKey) || row;
      const course = courseByKey.get(row.courseKey) || null;
      const attribution = course ? substitutionAttribution(course, seatKeys, lang) : null;
      const edit = edits[row.courseKey] || null;
      return {
        index: idx + 1,
        courseKey: row.courseKey,
        name: row.left?.title || "",
        sub: row.left?.sub || "",
        drinkName: row.right?.title || "",
        drinkSub: row.right?.sub || "",
        pairing: row.right ? [row.right.title, row.right.sub].filter(Boolean).join(" · ") : null,
        baseName: base.left?.title || "",
        baseSub: base.left?.sub || "",
        baseDrinkName: base.right?.title || "",
        baseDrinkSub: base.right?.sub || "",
        substituted: !!attribution,
        substitutedForTag: attribution?.tag || "",
        wasName: attribution?.wasName || "",
        edited: !!edit && Object.keys(edit).length > 0,
      };
    });
  };

  // Regenerated on every render — every option change is already live here.
  const activeCards = activeSeat ? cardsFor(activeSeat) : [];
  const previewHtml = activeSeat ? htmlFor(activeSeat) : "";

  const hasEdits = Object.values(seatEdits).some((m) => Object.keys(m || {}).length > 0);

  const saveEdit = (seatId, card) => {
    setSeatEdits((prev) => {
      const forSeat = { ...(prev[seatId] || {}) };
      const baseline = {
        name: card.baseName, sub: card.baseSub,
        drinkName: card.baseDrinkName, drinkSub: card.baseDrinkSub,
      };
      const entry = {};
      ["name", "sub", "drinkName", "drinkSub"].forEach((f) => {
        const v = String(draft[f] ?? "").trim();
        if (v && v !== String(baseline[f] || "").trim()) entry[f] = v;
      });
      if (Object.keys(entry).length === 0) delete forSeat[card.courseKey];
      else forSeat[card.courseKey] = entry;
      const next = { ...prev };
      if (Object.keys(forSeat).length === 0) delete next[seatId];
      else next[seatId] = forSeat;
      return next;
    });
    setOpenCourse(null);
  };

  const clearCourseEdit = (seatId, courseKey) => {
    setSeatEdits((prev) => {
      const forSeat = { ...(prev[seatId] || {}) };
      delete forSeat[courseKey];
      const next = { ...prev };
      if (Object.keys(forSeat).length === 0) delete next[seatId];
      else next[seatId] = forSeat;
      return next;
    });
    setOpenCourse(null);
  };

  /**
   * Print = the engine's HTML in a print window, same as the preview.
   * Returns false when the browser blocked the pop-up so callers report the
   * sheet did NOT go out instead of toasting success for a print that never
   * happened. A printed seat's one-time edits are consumed by the print.
   */
  const openPrint = (seat) => {
    const html = htmlFor(seat);
    const w = window.open("", "_blank", "width=620,height=880");
    if (!w) { flash("POP-UP BLOCKED — ALLOW POP-UPS TO PRINT"); return false; }
    w.document.write(html);
    w.document.close();
    w.focus();
    // The webfont has to land before the page is measured, otherwise the first
    // sheet prints in the fallback monospace at a different metric.
    setTimeout(() => w.print(), 600);
    setSeatEdits((prev) => {
      if (!prev[seat.id]) return prev;
      const next = { ...prev };
      delete next[seat.id];
      return next;
    });
    setOpenCourse(null);
    return true;
  };

  const printOne = (seat, i) => {
    if (openPrint(seat)) flash(`SEAT ${i + 1} SENT TO PRINT`);
  };

  /**
   * PRINT ALL — ONE window, one A5 page per seat. Opening a window per seat
   * on a stagger meant only the first was inside the click gesture; strict
   * pop-up blockers silently ate seats 2..n while the toast claimed success.
   * One combined document is one gesture-blessed window and one print dialog,
   * and the printer collates the whole table.
   */
  const printAll = () => {
    if (seats.length === 0) return;
    const html = combineMenuPages(
      seats.map((seat) => htmlFor(seat)),
      { title: `${menuTitle} — ${tableLabelOf(table)}` },
    );
    if (!html) return;
    const w = window.open("", "_blank", "width=620,height=880");
    if (!w) { flash("POP-UP BLOCKED — ALLOW POP-UPS TO PRINT"); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 600);
    // Every seat printed, so every seat's one-time edits are consumed —
    // same contract as the single-seat path.
    setSeatEdits({});
    setOpenCourse(null);
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
              onClick={() => setSelectedId(t.id)}
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

  // ── Active-seat drink lists (for the drinks editor) ────────────────────────
  const seatAperitifs = activeSeat?.aperitifs || [];
  const seatGlasses   = activeSeat?.glasses   || [];
  const seatCocktails = activeSeat?.cocktails || [];
  const seatSpirits   = activeSeat?.spirits   || [];
  const seatBeers     = activeSeat?.beers     || [];

  return (
    <div style={{ display: "flex", flexDirection: isNarrow ? "column" : "row", flex: 1, minHeight: 0 }}>
      {rail}

      <div style={{ flex: 1, minWidth: 0, overflowY: "auto", padding: isNarrow ? "16px" : "20px 24px" }}>

        {/* 1 — Party line + menu type + language on one row: the identity and
            the run options are read together, and stacking them cost ~50px of
            workspace on every party. Defaults come from the booking; the type
            picks the assigned profile's long/short template; the language
            switch carries the bilingual title/thank-you store with it. */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
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
              <button onClick={() => { setSeatEdits({}); setOpenCourse(null); flash("ONE-TIME EDITS CLEARED"); }}
                style={button()}>CLEAR EDITS</button>
            </>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
            {[["long", "LONG MENU"], ["short", "SHORT MENU"]].map(([val, label]) => (
              <button key={val} onClick={() => setMenuType(val)} style={chip(menuType === val)}>{label}</button>
            ))}
            <span style={{ color: ink[4], fontFamily: FONT, fontSize: "9px" }}>·</span>
            {[["en", "EN"], ["si", "SLO"]].map(([val, label]) => (
              <button key={val} onClick={() => setLanguageWithDefaults(val)} style={chip(lang === val)}>{label}</button>
            ))}
          </div>
        </div>

        {/* 2 — Title + team + thank-you (persisted: localStorage + state store) */}
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          <div style={{ flex: "1 1 200px", minWidth: 0 }}>
            <div style={fieldLabel}>MENU TITLE</div>
            <input value={menuTitle}
              onChange={(e) => { setMenuTitle(e.target.value); writeMenuTitle(lang, e.target.value); }}
              style={textInput} />
          </div>
          <div style={{ flex: "1 1 200px", minWidth: 0 }}>
            <div style={fieldLabel}>TEAM</div>
            <input value={teamNames} onChange={(e) => setTeamNames(e.target.value)} style={textInput} />
          </div>
          <div style={{ flex: "1 1 200px", minWidth: 0 }}>
            <div style={fieldLabel}>THANK-YOU LINE</div>
            <input value={thankYouNote}
              onChange={(e) => { setThankYouNote(e.target.value); writeThankYouNote(lang, e.target.value); }}
              style={textInput} />
          </div>
        </div>

        {/* 3 — Seat tabs + print actions */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-start", marginBottom: 12 }}>
          {seats.map((seat, i) => {
            const tags = resolveSeatRestrictionKeys(restrictions, seat.id).map(restrictionTag);
            const active = seat.id === activeSeat?.id;
            const seatHasEdits = Object.keys(seatEdits[seat.id] || {}).length > 0;
            return (
              <button key={seat.id} onClick={() => { setSeatIndex(i); setOpenCourse(null); }}
                style={{ ...chip(active), padding: "6px 10px", textAlign: "left" }}>
                <span style={{ display: "block" }}>SEAT {i + 1}{seatHasEdits ? " ✎" : ""}</span>
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

        {/* 4 — Active seat's pairing + drinks. Pairing is per SEAT — the chips
            write seat.pairing through `upd`, the same field the kitchen reads. */}
        {activeSeat && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            <span style={{ ...railHeader }}>PAIRING · SEAT {seats.indexOf(activeSeat) + 1}</span>
            {PAIRINGS.map((p) => {
              const active = (activeSeat.pairing || "—") === p;
              return (
                <button key={p} onClick={() => updSeat(activeSeat.id, "pairing", p)} style={chip(active)}>
                  {p}
                </button>
              );
            })}
            <span style={{ color: ink[4], fontFamily: FONT, fontSize: "9px" }}>·</span>
            <button onClick={() => setDrinksOpen((v) => !v)} style={chip(drinksOpen)}>
              {drinksOpen ? "▲ DRINKS + EXTRAS" : "▼ DRINKS + EXTRAS"}
            </button>
          </div>
        )}

        {/* 5 — Drinks & extras editor for the active seat — writes through the
            same updSeat/updSeatFull paths the full generator used. */}
        {activeSeat && drinksOpen && (
          <div style={{
            border: `${rule.hairline} solid ${ink[4]}`, background: neutral[50],
            padding: "12px 16px 14px", marginBottom: 18,
          }}>
            {/* Aperitif — generates above the first course */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, color: tokens.text.body, textTransform: "uppercase", marginBottom: 6 }}>Aperitif</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                {aperitifOptions.map((ap) => {
                  const label = ap.label ?? ap;
                  return (
                    <button key={label} type="button" onClick={() => {
                      const found = resolveAperitifFromQuickAccessOption(ap, {
                        wines: winesCatalog,
                        cocktails: cocktailsCatalog,
                        spirits: spiritsCatalog,
                        beers: beersCatalog,
                      });
                      const item = found || { name: ap.searchKey || ap.label, notes: "", __cocktail: true };
                      updSeat(activeSeat.id, "aperitifs", [...seatAperitifs, item]);
                    }} style={{
                      fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: "4px 9px",
                      border: `1px solid ${tokens.neutral[300]}`, borderRadius: 0, cursor: "pointer",
                      background: tokens.neutral[0], color: tokens.text.body,
                    }}>{label}</button>
                  );
                })}
              </div>
              <BeverageSearch
                wines={winesCatalog} cocktails={cocktailsCatalog} spirits={spiritsCatalog} beers={beersCatalog}
                onAdd={({ item }) => {
                  updSeat(activeSeat.id, "aperitifs", [...seatAperitifs, item]);
                }}
              />
              {seatAperitifs.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  {groupDrinks(seatAperitifs).map(({ key, item: x, qty }) => {
                    const label = x?.name || x?.producer || "?";
                    const sub = x?.producer && x?.name ? x.producer : (x?.notes || "");
                    const set = (next) => updSeat(activeSeat.id, "aperitifs", next);
                    return (
                      <DrinkPill
                        key={key}
                        ts={BEV_TYPES.aperitif}
                        label={`${label}${sub ? ` · ${sub}` : ""}`}
                        qty={qty}
                        onDec={() => set(removeOne(seatAperitifs, key))}
                        onInc={() => set(addOne(seatAperitifs, x))}
                        onRemove={() => set(removeAll(seatAperitifs, key))}
                      />
                    );
                  })}
                </div>
              )}
            </div>

            {/* By the Glass — wines, cocktails, spirits, beers */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, color: tokens.text.disabled, textTransform: "uppercase", marginBottom: 6 }}>By the Glass</div>
              <BeverageSearch
                wines={winesCatalog} cocktails={cocktailsCatalog} spirits={spiritsCatalog} beers={beersCatalog}
                onAdd={({ type, item }) => {
                  if (type === "wine" || type === "bottle") updSeat(activeSeat.id, "glasses", [...seatGlasses, item]);
                  if (type === "cocktail") updSeat(activeSeat.id, "cocktails", [...seatCocktails, item]);
                  if (type === "spirit")   updSeat(activeSeat.id, "spirits",   [...seatSpirits,   item]);
                  if (type === "beer")     updSeat(activeSeat.id, "beers",     [...seatBeers,     item]);
                }}
              />
              {(() => {
                // One pill per drink, whatever list it lives in, each carrying
                // its own count and stepper.
                const pillsFor = (field, list, typeOf, subOf) => groupDrinks(list).map(({ key, item: x, qty }) => ({
                  key: `${field}-${key}`,
                  type: typeOf(x),
                  label: x?.name,
                  sub: subOf(x),
                  qty,
                  onDec: () => updSeat(activeSeat.id, field, removeOne(list, key)),
                  onInc: () => updSeat(activeSeat.id, field, addOne(list, x)),
                  onRemove: () => updSeat(activeSeat.id, field, removeAll(list, key)),
                }));
                const allBevs = [
                  ...pillsFor("glasses",   seatGlasses,   (x) => (x?.byGlass === false ? "bottle" : "wine"), (x) => x?.producer),
                  ...pillsFor("cocktails", seatCocktails, () => "cocktail", (x) => x?.notes),
                  ...pillsFor("spirits",   seatSpirits,   () => "spirit",   (x) => x?.notes),
                  ...pillsFor("beers",     seatBeers,     () => "beer",     (x) => x?.notes),
                ];
                if (allBevs.length === 0) return null;
                return (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                    {allBevs.map((bev) => (
                      <DrinkPill
                        key={bev.key}
                        ts={BEV_TYPES[bev.type]}
                        label={`${bev.label}${bev.sub ? ` · ${bev.sub}` : ""}`}
                        qty={bev.qty}
                        onDec={bev.onDec}
                        onInc={bev.onInc}
                        onRemove={bev.onRemove}
                      />
                    ))}
                  </div>
                );
              })()}
            </div>

            {/* Optional pairings without linked extra dish (e.g. Beer, Martini) */}
            {(() => {
              const standalones = optionalPairings.filter((opt) => !opt.extraKey);
              if (!standalones.length) return null;
              return (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${tokens.neutral[100]}` }}>
                  <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, color: tokens.text.disabled, textTransform: "uppercase", marginBottom: 6 }}>Pairings</div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                    {standalones.map((opt, oi) => {
                      const raw = activeSeat.optionalPairings?.[opt.key];
                      const ordered = raw?.ordered !== undefined ? !!raw.ordered : (opt.defaultOn !== false);
                      const mode = raw?.mode || null;
                      const states = ["off", ...(opt.hasAlco ? ["alco"] : []), ...(opt.hasNonAlco ? ["nonalc"] : [])];
                      let cur;
                      if (!ordered) cur = "off";
                      else if (mode === "alco") cur = "alco";
                      else if (mode === "nonalc") cur = "nonalc";
                      else cur = states[1] || "off";
                      const applyNext = () => updSeatFull(activeSeat.id, (seat) => {
                        const r = seat.optionalPairings?.[opt.key];
                        const o = r?.ordered !== undefined ? !!r.ordered : (opt.defaultOn !== false);
                        const m = r?.mode || null;
                        let c;
                        if (!o) c = "off";
                        else if (m === "alco") c = "alco";
                        else if (m === "nonalc") c = "nonalc";
                        else c = states[1] || "off";
                        const nx = states[(states.indexOf(c) + 1) % states.length];
                        return {
                          ...seat,
                          optionalPairings: {
                            ...(seat.optionalPairings || {}),
                            [opt.key]: {
                              ...(r || {}),
                              ordered: nx !== "off",
                              ...(nx === "alco" ? { mode: "alco" } : nx === "nonalc" ? { mode: "nonalc" } : { mode: null }),
                            },
                          },
                        };
                      });
                      const onlyOne = states.length === 2;
                      const shortLabel = opt.label.length > 6 ? opt.label.slice(0, 5) : opt.label;
                      const label =
                        cur === "off"    ? `${opt.label} off` :
                        cur === "alco"   ? (onlyOne ? `${opt.label} ✓` : `${shortLabel} · ALCO`) :
                        cur === "nonalc" ? (onlyOne ? `${opt.label} ✓` : `${shortLabel} · N/A`) :
                        `${opt.label} ✓`;
                      const colors =
                        cur === "off"    ? { border: tokens.neutral[300],    bg: tokens.neutral[50],    color: tokens.text.muted     } :
                        onlyOne          ? { border: tokens.green.border,     bg: tokens.green.bg,       color: tokens.green.text     } :
                        cur === "alco"   ? { border: tokens.charcoal.default, bg: tokens.tint.parchment, color: tokens.text.body      } :
                                           { border: tokens.neutral[400],    bg: tokens.neutral[100],   color: tokens.text.secondary };
                      return (
                        <div key={opt.key} style={{ display: "flex", gap: 3, alignItems: "center" }}>
                          {oi > 0 && <div style={{ width: 1, height: 18, background: tokens.neutral[200], marginRight: 2 }} />}
                          <button onClick={applyNext} style={{
                            fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: "4px 10px",
                            border: `1px solid ${colors.border}`, borderRadius: 0, cursor: "pointer",
                            background: colors.bg, color: colors.color,
                          }}>{label}</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Extras — optional dishes (some have optional drink pairings) */}
            {optionalExtras.length > 0 && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${tokens.neutral[100]}` }}>
                <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, color: tokens.text.disabled, textTransform: "uppercase", marginBottom: 6 }}>Extras</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                  {(() => {
                    const pairingByExtraKey = new Map();
                    optionalPairings.forEach((opt) => { if (opt.extraKey) pairingByExtraKey.set(opt.extraKey, opt); });
                    return optionalExtras.map((dish, di) => {
                      const extra = activeSeat.extras?.[dish.key] || activeSeat.extras?.[dish.id] || { ordered: false, pairing: dish.pairings[0] };
                      const dishOn = !!extra.ordered;
                      const linked = pairingByExtraKey.get(dish.key);

                      if (linked) {
                        // Cycling button: off → on → on·ALCO → on·N/A → off
                        const raw = activeSeat.optionalPairings?.[linked.key];
                        const pairingOrdered = raw?.ordered !== undefined ? !!raw.ordered : false;
                        const pmode = raw?.mode || null;
                        const states = ["off", "on"];
                        if (linked.hasAlco) states.push("alco");
                        if (linked.hasNonAlco) states.push("nonalc");
                        let cur;
                        if (!dishOn) cur = "off";
                        else if (!pairingOrdered) cur = "on";
                        else if (pmode === "alco") cur = "alco";
                        else if (pmode === "nonalc") cur = "nonalc";
                        else cur = "on";
                        // Single atomic update — reads latest committed seat state, no stale closure
                        const applyNext = () => updSeatFull(activeSeat.id, (seat) => {
                          const xtra = seat.extras?.[dish.key] || seat.extras?.[dish.id] || { ordered: false, pairing: dish.pairings[0] };
                          const r = seat.optionalPairings?.[linked.key];
                          const po = r?.ordered !== undefined ? !!r.ordered : false;
                          const pm = r?.mode || null;
                          let c;
                          if (!xtra.ordered) c = "off";
                          else if (!po) c = "on";
                          else if (pm === "alco") c = "alco";
                          else if (pm === "nonalc") c = "nonalc";
                          else c = "on";
                          const nx = states[(states.indexOf(c) + 1) % states.length];
                          return {
                            ...seat,
                            extras: { ...seat.extras, [dish.key]: { ordered: nx !== "off", pairing: dish.pairings[0] } },
                            optionalPairings: { ...(seat.optionalPairings || {}), [linked.key]: {
                              ...(r || {}),
                              ordered: nx === "alco" || nx === "nonalc",
                              ...(nx === "alco" ? { mode: "alco" } : nx === "nonalc" ? { mode: "nonalc" } : { mode: null }),
                            }},
                          };
                        });
                        const labels = { off: `${dish.name} off`, on: `${dish.name} ✓`, alco: `${dish.name.slice(0, 4)} · ALCO`, nonalc: `${dish.name.slice(0, 4)} · N/A` };
                        const colors = {
                          off:    { border: tokens.neutral[300],    bg: tokens.neutral[50],    color: tokens.text.muted },
                          on:     { border: tokens.green.border,     bg: tokens.green.bg,       color: tokens.green.text },
                          alco:   { border: tokens.charcoal.default, bg: tokens.tint.parchment, color: tokens.text.body },
                          nonalc: { border: tokens.neutral[400],    bg: tokens.neutral[100],   color: tokens.text.secondary },
                        }[cur];
                        return (
                          <div key={dish.key} style={{ display: "flex", gap: 3, alignItems: "center" }}>
                            {di > 0 && <div style={{ width: 1, height: 18, background: tokens.neutral[200], marginRight: 2 }} />}
                            <button onClick={applyNext} style={{
                              fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: "4px 10px",
                              border: `1px solid ${colors.border}`, borderRadius: 0, cursor: "pointer",
                              background: colors.bg, color: colors.color,
                            }}>{labels[cur]}</button>
                          </div>
                        );
                      }

                      // Plain extra (no linked drink pairing) — single cycling button
                      const pStates = ["off", ...dish.pairings];
                      const curP = !dishOn ? "off" : (extra.pairing || dish.pairings[0]);
                      const applyNextP = () => updSeatFull(activeSeat.id, (seat) => {
                        const xtra = seat.extras?.[dish.key] || seat.extras?.[dish.id] || { ordered: false, pairing: dish.pairings[0] };
                        const c = !xtra.ordered ? "off" : (xtra.pairing || dish.pairings[0]);
                        const nx = pStates[(pStates.indexOf(c) + 1) % pStates.length];
                        return { ...seat, extras: { ...seat.extras, [dish.key]: nx === "off"
                          ? { ordered: false, pairing: dish.pairings[0] }
                          : { ordered: true, pairing: nx },
                        }};
                      });
                      const pLabel = curP === "off"
                        ? `${dish.name} off`
                        : curP === "—"
                        ? `${dish.name} ✓`
                        : `${dish.name.slice(0, 4)} · ${curP}`;
                      const pColors = curP === "off"
                        ? { border: tokens.neutral[300], bg: tokens.neutral[50], color: tokens.text.muted }
                        : curP === "—"
                        ? { border: tokens.green.border, bg: tokens.green.bg, color: tokens.green.text }
                        : { border: tokens.neutral[400], bg: tokens.neutral[100], color: tokens.text.secondary };
                      return (
                        <div key={dish.key} style={{ display: "flex", gap: 3, alignItems: "center" }}>
                          {di > 0 && <div style={{ width: 1, height: 18, background: tokens.neutral[200], marginRight: 2 }} />}
                          <button onClick={applyNextP} style={{
                            fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: "4px 10px",
                            border: `1px solid ${pColors.border}`, borderRadius: 0, cursor: "pointer",
                            background: pColors.bg, color: pColors.color,
                          }}>{pLabel}</button>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            )}

            {/* Table bottles — shared by the whole table, printed when no pairing */}
            {tableBottles.length > 0 && (
              <div style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${tokens.neutral[100]}`, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {tableBottles.map((b, i) => (
                  <span key={i} style={{ fontFamily: FONT, fontSize: 9, padding: "2px 8px", borderRadius: 0, border: `1px solid ${tokens.neutral[300]}`, color: tokens.text.secondary, background: tokens.neutral[50] }}>
                    {BEV_TYPES.bottle.glyph} {b.name}{b.vintage ? ` · ${b.vintage}` : ""}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Course list + live preview */}
        <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexWrap: isNarrow ? "wrap" : "nowrap" }}>

          {/* Course list — the engine's own row model (see cardsFor). ONE
              column, reading top to bottom like the printed page; the free
              width on wide screens belongs to the preview, not to a second
              column of cards. Capped so lines stay readable. */}
          <div style={{ flex: "0 1 640px", minWidth: 0 }}>
            {activeCards.map((card) => {
              const open = openCourse === card.courseKey;
              const accent = card.substituted ? red.border : card.edited ? signal.warn : ink[4];
              return (
                <div
                  key={card.courseKey}
                  onClick={() => {
                    if (open) return;
                    setOpenCourse(card.courseKey);
                    setDraft({ name: card.name, sub: card.sub, drinkName: card.drinkName, drinkSub: card.drinkSub });
                  }}
                  style={{
                    // Every direct child below is flex: 1 1 100% — the edit
                    // rows and the course text must each own a full line.
                    // Sharing a line collapses the text column to one word
                    // per line.
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
                      }}>{pad2(card.index)}</span>
                      <span style={{
                        fontFamily: FONT, fontSize: "12px", color: ink[0], lineHeight: 1.35,
                        minWidth: 0,
                      }}>{card.name}{card.sub ? ` — ${card.sub}` : ""}</span>
                    </div>

                    {card.substituted && (
                      <div style={{
                        marginTop: 6, fontFamily: FONT, fontSize: "8px", letterSpacing: "0.06em",
                        color: red.text, lineHeight: 1.4,
                      }}>
                        SUBSTITUTED FOR [{card.substitutedForTag}] — WAS: {card.wasName}
                      </div>
                    )}
                    {card.edited && (
                      <div style={{
                        marginTop: 6, fontFamily: FONT, fontSize: "8px", letterSpacing: "0.06em",
                        color: signal.warn, lineHeight: 1.4,
                      }}>✎ ONE-TIME EDIT — THIS SEAT ONLY</div>
                    )}
                    {card.pairing && (
                      <div style={{
                        marginTop: 6, fontFamily: FONT, fontSize: "9px", color: ink[3], lineHeight: 1.4,
                      }}>{card.pairing}</div>
                    )}
                  </div>

                  {open && (
                    <div style={{ flex: "1 1 100%", display: "flex", gap: 8, marginTop: 10, minWidth: 0 }}>
                      <input
                        autoFocus
                        value={draft.name}
                        placeholder={card.baseName}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit(activeSeat.id, card);
                          if (e.key === "Escape") setOpenCourse(null);
                        }}
                        style={{ ...textInput, flex: 1, minWidth: 0 }}
                      />
                      <button
                        onClick={(e) => { e.stopPropagation(); saveEdit(activeSeat.id, card); }}
                        style={{ ...button(true), flexShrink: 0 }}
                      >SAVE</button>
                    </div>
                  )}
                  {open && (
                    <div style={{ flex: "1 1 100%", display: "flex", gap: 8, marginTop: 8, minWidth: 0, flexWrap: "wrap" }}
                      onClick={(e) => e.stopPropagation()}>
                      <input
                        value={draft.sub}
                        placeholder={card.baseSub || "SUB LINE"}
                        onChange={(e) => setDraft((d) => ({ ...d, sub: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit(activeSeat.id, card);
                          if (e.key === "Escape") setOpenCourse(null);
                        }}
                        style={{ ...textInput, flex: "1 1 100%", minWidth: 0 }}
                      />
                      <input
                        value={draft.drinkName}
                        placeholder={card.baseDrinkName || "DRINK"}
                        onChange={(e) => setDraft((d) => ({ ...d, drinkName: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit(activeSeat.id, card);
                          if (e.key === "Escape") setOpenCourse(null);
                        }}
                        style={{ ...textInput, flex: "1 1 46%", minWidth: 0 }}
                      />
                      <input
                        value={draft.drinkSub}
                        placeholder={card.baseDrinkSub || "DRINK SUB"}
                        onChange={(e) => setDraft((d) => ({ ...d, drinkSub: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveEdit(activeSeat.id, card);
                          if (e.key === "Escape") setOpenCourse(null);
                        }}
                        style={{ ...textInput, flex: "1 1 46%", minWidth: 0 }}
                      />
                      {card.edited && (
                        <button
                          onClick={(e) => { e.stopPropagation(); clearCourseEdit(activeSeat.id, card.courseKey); }}
                          style={button()}
                        >CLEAR THIS COURSE</button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            {activeCards.length === 0 && (
              <div style={{ ...railHeader, color: ink[4] }}>NO COURSES ON THIS MENU</div>
            )}
          </div>

          {/* Live preview — the engine's actual printed page. It owns ALL the
              width the course column doesn't use and scales the sheet up to
              fill it (bounded by the viewport height so the whole page stays
              on screen). Sticky, so the pass keeps sight of the sheet while
              scrolling a long course list. */}
          {activeSeat && (
            <div
              ref={previewBoxRef}
              style={{
                flex: `1 1 ${PREVIEW_MIN_W}px`, minWidth: PREVIEW_MIN_W, maxWidth: PAGE_W_PX,
                position: isNarrow ? "static" : "sticky", top: 0, alignSelf: "flex-start",
              }}
            >
              <div style={{ ...fieldLabel, marginBottom: 8 }}>PREVIEW · SEAT {seats.indexOf(activeSeat) + 1} OF {seats.length}</div>
              <div style={{
                width: PAGE_W_PX * previewScale, height: PAGE_H_PX * previewScale,
                overflow: "hidden", border: `${rule.hairline} solid ${ink[4]}`, background: neutral[0],
              }}>
                <iframe
                  title={`Seat ${seats.indexOf(activeSeat) + 1} menu preview`}
                  srcDoc={previewHtml}
                  scrolling="no"
                  style={{
                    width: PAGE_W_PX, height: PAGE_H_PX, border: "none",
                    transform: `scale(${previewScale})`, transformOrigin: "top left",
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
