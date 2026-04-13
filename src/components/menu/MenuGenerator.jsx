import { useEffect, useMemo, useRef, useState } from "react";
import { generateMenuHTML, DEFAULT_MENU_RULES, normalizeMenuRules } from "../../utils/menuGenerator.js";
import { writeTeamNames, readTeamNames, writeMenuTitle, readMenuTitle, writeThankYouNote, readThankYouNote } from "../../utils/storage.js";
import { applyMenuOverride, applyCourseRestriction, RESTRICTION_PRIORITY_KEYS, RESTRICTION_COLUMN_MAP, optionalExtrasFromCourses, optionalPairingsFromCourses } from "../../utils/menuUtils.js";
import { TABLES, supabase } from "../../lib/supabaseClient.js";
import { BEV_TYPES } from "../../constants/beverageTypes.js";
import { COUNTRY_NAMES } from "../../constants/countries.js";
import { restrLabel } from "../../constants/dietary.js";
import { waterStyle } from "../../constants/pairings.js";
import { tokens } from "../../styles/tokens.js";
import { UI } from "../../styles/uiChrome.js";
import FullModal from "../ui/FullModal.jsx";
import BlurInput from "../ui/BlurInput.jsx";
import BeverageSearch from "../service/BeverageSearch.jsx";

const FONT = tokens.font;
const baseInp = {
  fontFamily: FONT,
  fontSize: tokens.mobileInputSize,
  padding: "10px 12px",
  border: "1px solid #e8e8e8",
  borderRadius: tokens.radius,
  outline: "none",
  color: UI.ink,
  background: "#fff",
  boxSizing: "border-box",
  width: "100%",
  minWidth: 0,
  WebkitAppearance: "none",
};

// ── Menu Generator ────────────────────────────────────────────────────────────
const PAIRING_MAP = { "Wine": "wp", "Non-Alc": "na", "Our Story": "os", "Premium": "premium" };


export default function MenuGenerator({ table, menuCourses = [], upd, onClose, defaultLayoutStyles = {}, menuTemplate = null, logoDataUri = "", wines: winesCatalog = [], cocktails: cocktailsCatalog = [], spirits: spiritsCatalog = [], beers: beersCatalog = [], aperitifOptions = [], menuRules = DEFAULT_MENU_RULES }) {
  const [teamNames, setTeamNames] = useState(readTeamNames);
  const [menuTitle, setMenuTitle] = useState(() => readMenuTitle(table.lang || "en"));
  const [thankYouNote, setThankYouNote] = useState(() => readThankYouNote(table.lang || "en"));
  const [lang, setLang] = useState(table.lang || "en");
  // Per-seat ephemeral one-time edits — { [seatId]: { [courseKey]: { name?, sub? } } }
  // Cleared automatically after the PDF for that seat is generated.
  const [seatEdits, setSeatEdits] = useState({});
  const [expandedSeatId, setExpandedSeatId] = useState(null);
  const [expandedDrinksId, setExpandedDrinksId] = useState(null);
  const [previewSeatId, setPreviewSeatId] = useState(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const genLoaded = useRef(false);

  const optionalExtras   = useMemo(() => optionalExtrasFromCourses(menuCourses),  [menuCourses]);
  const optionalPairings = useMemo(() => optionalPairingsFromCourses(menuCourses), [menuCourses]);

  const updSeat = (seatId, field, valueOrFn) => {
    if (!upd) return;
    upd(table.id, "seats", prev => (prev || []).map(s =>
      s.id === seatId ? { ...s, [field]: typeof valueOrFn === "function" ? valueOrFn(s[field], s) : valueOrFn } : s
    ));
  };
  // Atomically update multiple fields (or the whole seat) from latest committed state.
  // fn receives the latest seat object and returns the updated seat.
  const updSeatFull = (seatId, fn) => {
    if (!upd) return;
    upd(table.id, "seats", prev => (prev || []).map(s => s.id === seatId ? fn(s) : s));
  };

  // Load team names, menu title, and thank-you note from Supabase on mount.
  // Title and thank-you are stored as { en, si } so both languages persist
  // independently — storing a single value caused the last-switched language
  // to overwrite the other language on the next open.
  useEffect(() => {
    if (!supabase) { genLoaded.current = true; return; }
    const currentLang = lang;
    Promise.all([
      supabase.from(TABLES.SERVICE_SETTINGS).select("state").eq("id", "menu_gen_team").single(),
      supabase.from(TABLES.SERVICE_SETTINGS).select("state").eq("id", "menu_gen_title").single(),
      supabase.from(TABLES.SERVICE_SETTINGS).select("state").eq("id", "menu_gen_thankyou").single(),
    ]).then(([teamRes, titleRes, thankYouRes]) => {
      if (teamRes.data?.state?.value) setTeamNames(teamRes.data.state.value);

      // Only apply Supabase values when in the new bilingual { en, si } format.
      // The legacy { value } format has no language tag — applying it blindly
      // would overwrite the correct language's localStorage value (e.g. showing
      // the SI title when opening in EN mode). If the row is still in the old
      // format, leave the state as-is (already seeded from localStorage in useState).
      const titleState = titleRes.data?.state;
      if (titleState && (typeof titleState.en === "string" || typeof titleState.si === "string")) {
        const val = titleState[currentLang] ?? "";
        if (val) setMenuTitle(val);
        // Hydrate the other language into localStorage so lang-switch works offline.
        const otherLang = currentLang === "en" ? "si" : "en";
        if (titleState[otherLang]) writeMenuTitle(otherLang, titleState[otherLang]);
      }

      const thankYouState = thankYouRes.data?.state;
      if (thankYouState && (typeof thankYouState.en === "string" || typeof thankYouState.si === "string")) {
        const val = thankYouState[currentLang] ?? "";
        if (val) setThankYouNote(val);
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
    supabase.from(TABLES.SERVICE_SETTINGS)
      .upsert({ id: "menu_gen_team", state: { value: teamNames }, updated_at: new Date().toISOString() }, { onConflict: "id" })
      .then(() => {});
  }, [teamNames]);

  // Save menu title to Supabase when changed — store both languages so switching
  // lang never clobbers the other language's stored value.
  // Note: localStorage writes happen directly in onChange and setLanguageWithDefaults
  // (not here) to avoid a React batching race where lang changes before menuTitle.
  useEffect(() => {
    if (!genLoaded.current || !supabase) return;
    supabase.from(TABLES.SERVICE_SETTINGS)
      .upsert({ id: "menu_gen_title", state: { en: readMenuTitle("en"), si: readMenuTitle("si") }, updated_at: new Date().toISOString() }, { onConflict: "id" })
      .then(() => {});
  }, [menuTitle]);

  // Save thank-you note to Supabase when changed — same multi-lang approach.
  useEffect(() => {
    if (!genLoaded.current || !supabase) return;
    supabase.from(TABLES.SERVICE_SETTINGS)
      .upsert({ id: "menu_gen_thankyou", state: { en: readThankYouNote("en"), si: readThankYouNote("si") }, updated_at: new Date().toISOString() }, { onConflict: "id" })
      .then(() => {});
  }, [thankYouNote]);

  const seats        = table.seats        || [];
  const restrictions = table.restrictions || [];
  const tableBottles = table.bottleWines  || [];

  // Table-wide persistent overrides (applied silently, managed via Admin panel)
  const courseOverrides = table.courseOverrides || {};

  // Get the restriction+override-applied dish text for a course as it would appear for a seat.
  // Used to pre-populate the per-seat editor with the already-adjusted menu.
  const getSeatDish = (course, seatId) => {
    const withOv = applyMenuOverride(course, courseOverrides, seatId);
    const seatRestrKeys = restrictions.filter(r => r.pos === seatId).map(r => r.note);
    const resolved = lang === "si" && withOv.menu_si?.name ? { ...withOv, menu: withOv.menu_si } : withOv;
    return applyCourseRestriction(resolved, seatRestrKeys, lang) || { name: withOv.menu?.name || "", sub: withOv.menu?.sub || "" };
  };

  const setSeatEditField = (seatId, courseKey, field, value) => {
    setSeatEdits(prev => {
      const seatData = { ...(prev[seatId] || {}) };
      const courseEdit = { ...(seatData[courseKey] || {}) };
      if (value === "") {
        delete courseEdit[field];
      } else {
        courseEdit[field] = value;
      }
      if (Object.keys(courseEdit).length === 0) {
        delete seatData[courseKey];
      } else {
        seatData[courseKey] = courseEdit;
      }
      return { ...prev, [seatId]: seatData };
    });
  };

  const clearSeatAllEdits = (seatId) => {
    setSeatEdits(prev => { const n = { ...prev }; delete n[seatId]; return n; });
  };

  const normalizedMenuRules = normalizeMenuRules(menuRules);

  const setLanguageWithDefaults = (nextLang) => {
    writeMenuTitle(lang, menuTitle);
    writeThankYouNote(lang, thankYouNote);
    setLang(nextLang);
    if (normalizedMenuRules?.overwriteTitleAndThankYouOnLanguageSwitch !== false) {
      setMenuTitle(readMenuTitle(nextLang));
      setThankYouNote(readThankYouNote(nextLang));
    }
  };

  // ── Layout styles (global default, read-only in this view) ───────────────
  const layoutStyles = defaultLayoutStyles || {};

  const isPrintable = () => true;
  const seatBottles = () => tableBottles;

  const openPrint = (seat) => {
    const seatCourses = menuCourses.map(c => applyMenuOverride(c, courseOverrides, seat.id));
    const html = generateMenuHTML({
      seat,
      table: { menuType: table.menuType || "", restrictions, bottleWines: tableBottles, birthday: table.birthday || false },
      menuTitle,
      teamNames,
      menuCourses: seatCourses,
      beerChoice: seat.pairing === "Non-Alc" ? "nonalc" : "alco",
      lang,
      seatOutputOverrides: seatEdits[seat.id] || {},
      thankYouNote,
      layoutStyles,
      menuRules: normalizedMenuRules,
      menuTemplate,
      catalog: { wines: winesCatalog, cocktails: cocktailsCatalog, spirits: spiritsCatalog, beers: beersCatalog },
      _logo: logoDataUri,
    });
    const w = window.open("", "_blank", "width=620,height=880");
    if (!w) { alert("Pop-up blocked — allow pop-ups for this site."); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 600);
    // One-time: clear this seat's edits and collapse its editor after printing
    clearSeatAllEdits(seat.id);
    setExpandedSeatId(null);
    setPreviewSeatId(null);
    setPreviewHtml("");
  };

  const printSelected = async (selectedSeatIds) => {
    const selected = seats.filter(s => selectedSeatIds.includes(s.id));
    if (selected.length === 0) return;
    selected.forEach((s, i) => {
      setTimeout(() => openPrint(s), i * 700);
    });
  };

  const openPreview = (seat) => {
    const seatCourses = menuCourses.map(c => applyMenuOverride(c, courseOverrides, seat.id));
    const html = generateMenuHTML({
      seat,
      table: { menuType: table.menuType || "", restrictions, bottleWines: tableBottles, birthday: table.birthday || false },
      menuTitle,
      teamNames,
      menuCourses: seatCourses,
      beerChoice: seat.pairing === "Non-Alc" ? "nonalc" : "alco",
      lang,
      seatOutputOverrides: seatEdits[seat.id] || {},
      thankYouNote,
      layoutStyles,
      menuRules: normalizedMenuRules,
      menuTemplate,
      catalog: { wines: winesCatalog, cocktails: cocktailsCatalog, spirits: spiritsCatalog, beers: beersCatalog },
      _logo: logoDataUri,
    });
    setPreviewHtml(html);
    setPreviewSeatId(seat.id);
    setExpandedSeatId(null);
    setExpandedDrinksId(null);
  };

  const pairingColor = { Wine: "#7a5020", "Non-Alc": "#3a6a2a", Premium: "#4a3a7a", "Our Story": "#2a5a6a" };
  const pairingBg   = { Wine: "#fdf4e8", "Non-Alc": "#edf8e8", Premium: "#f0eeff", "Our Story": "#e8f5f8" };


  return (
    <FullModal title="Generate Menus" onClose={onClose}>
      <div style={{ maxWidth: 580, margin: "0 auto" }}>

        {/* Language + Title + Team */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
          <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#888", textTransform: "uppercase" }}>Language</div>
          {[{val:"en",label:"EN"},{val:"si",label:"SLO"}].map(opt => (
            <button key={opt.val} onClick={() => {
              setLanguageWithDefaults(opt.val);
            }} style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 12px",
              border: `1px solid ${lang === opt.val ? UI.line : "#e0e0e0"}`,
              borderRadius: tokens.radius, cursor: "pointer",
              background: lang === opt.val ? UI.selectedBg : "#fff",
              color: lang === opt.val ? UI.ink : "#aaa",
            }}>{opt.label}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#888", textTransform: "uppercase", marginBottom: 6 }}>Menu Title</div>
            <input value={menuTitle} onChange={e => { setMenuTitle(e.target.value); writeMenuTitle(lang, e.target.value); }}
              style={{ fontFamily: FONT, fontSize: 11, padding: "8px 10px", border: "1px solid #e0e0e0", borderRadius: 2, outline: "none", width: "100%" }} />
          </div>
          <div style={{ flex: 2, minWidth: 220 }}>
            <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#888", textTransform: "uppercase", marginBottom: 6 }}>Team</div>
            <input value={teamNames} onChange={e => setTeamNames(e.target.value)}
              style={{ fontFamily: FONT, fontSize: 11, padding: "8px 10px", border: "1px solid #e0e0e0", borderRadius: 2, outline: "none", width: "100%" }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#888", textTransform: "uppercase", marginBottom: 6 }}>Thank You Note</div>
            <input value={thankYouNote} onChange={e => { setThankYouNote(e.target.value); writeThankYouNote(lang, e.target.value); }}
              style={{ fontFamily: FONT, fontSize: 11, padding: "8px 10px", border: "1px solid #e0e0e0", borderRadius: 2, outline: "none", width: "100%" }} />
          </div>
        </div>

        {/* Menu behavior rules (in-app configurable) */}
        {/* Seat rows */}
        <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#888", textTransform: "uppercase", marginBottom: 10 }}>Seats</div>

        {seats.map(s => {
          const seatRestr  = restrictions.filter(r => r.pos === s.id);
          const printable  = isPrintable(s);
          const orderedExtras = optionalExtras.filter(d => !!(s.extras?.[d.key] || s.extras?.[d.id])?.ordered);
          const glasses    = s.glasses || [];
          const cocktails  = s.cocktails || [];
          const bottles    = seatBottles(s);

          const spirits    = s.spirits  || [];
          const beers      = s.beers    || [];

          const seatHasEdits = Object.keys(seatEdits[s.id] || {}).length > 0;
          const isExpanded = expandedSeatId === s.id;

          return (
            <div key={s.id} style={{
              border: `1px solid ${seatHasEdits ? "#f0c060" : "#f0f0f0"}`, borderRadius: 4, marginBottom: 8,
              background: seatHasEdits ? "#fffdf4" : "#fff",
            }}>
              {/* Main row */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", flexWrap: "wrap" }}>
                <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: "#999", minWidth: 28 }}>P{s.id}</span>

                {/* Pairing badge */}
                {s.pairing && s.pairing !== "—"
                  ? <span style={{ fontFamily: FONT, fontSize: 10, padding: "3px 9px", borderRadius: 2, background: pairingBg[s.pairing] || "#f5f5f5", color: pairingColor[s.pairing] || "#555", border: "1px solid #e0e0e0", fontWeight: 500 }}>{s.pairing}</span>
                  : glasses.length > 0 || cocktails.length > 0 || tableBottles.length > 0
                    ? <span style={{ fontFamily: FONT, fontSize: 10, padding: "3px 9px", borderRadius: 2, background: "#f5f5f5", color: "#888", border: "1px solid #e8e8e8" }}>drinks</span>
                    : <span style={{ fontFamily: FONT, fontSize: 10, color: "#ccc" }}>no pairing</span>}

                {seatRestr.map((r, i) => {
                  const isDietary = ["veg","vegan","pescetarian"].includes(r.note);
                  return (
                    <span key={i} style={{ fontFamily: FONT, fontSize: 9, padding: "2px 7px", borderRadius: 2,
                      background: isDietary ? "#edf8e8" : "#fef0f0",
                      color: isDietary ? "#2a6a2a" : "#b04040",
                      border: `1px solid ${isDietary ? "#88cc88" : "#e09090"}` }}>
                      {isDietary ? restrLabel(r.note) : `⚠ ${restrLabel(r.note)}`}
                    </span>
                  );
                })}
                {orderedExtras.map(d => (
                  <span key={d.key} style={{ fontFamily: FONT, fontSize: 9, padding: "2px 7px", borderRadius: 2, background: "#fdf4e8", color: "#7a5020", border: "1px solid #e0c898" }}>+{String(d.name).toUpperCase()}</span>
                ))}

                {/* Manually added beverages */}
                {glasses.map((w, i) => (
                  <span key={`g${i}`} style={{ fontFamily: FONT, fontSize: 9, padding: "2px 7px", borderRadius: 2, background: "#fdf4e8", color: "#7a5020", border: "1px solid #c8a060", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    🍷 {w.name}
                  </span>
                ))}
                {cocktails.map((c, i) => (
                  <span key={`c${i}`} style={{ fontFamily: FONT, fontSize: 9, padding: "2px 7px", borderRadius: 2, background: "#f5eeff", color: "#5a3878", border: "1px solid #b898d8", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    🍹 {c.name}
                  </span>
                ))}
                {spirits.map((sp, i) => (
                  <span key={`s${i}`} style={{ fontFamily: FONT, fontSize: 9, padding: "2px 7px", borderRadius: 2, background: "#fff3e0", color: "#7a5020", border: "1px solid #d4a870", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    🥃 {sp.name}
                  </span>
                ))}
                {beers.map((b, i) => (
                  <span key={`b${i}`} style={{ fontFamily: FONT, fontSize: 9, padding: "2px 7px", borderRadius: 2, background: "#edf8e8", color: "#3a6a2a", border: "1px solid #88bb70", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    🍺 {b.name}
                  </span>
                ))}

                {/* Edit button — opens per-seat ephemeral course editor */}
                <button onClick={() => { setExpandedSeatId(isExpanded ? null : s.id); setExpandedDrinksId(null); setPreviewSeatId(null); }} style={{
                  fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 10px",
                  border: `1px solid ${seatHasEdits ? "#f0c060" : "#e0e0e0"}`, borderRadius: 2, cursor: "pointer",
                  background: seatHasEdits ? "#fff8e0" : "#fafafa",
                  color: seatHasEdits ? "#a07020" : "#aaa",
                }}>{isExpanded ? "▲" : (seatHasEdits ? "✎ EDITED" : "✎")}</button>

                {/* Drinks edit button */}
                {upd && (
                  <button onClick={() => { setExpandedDrinksId(expandedDrinksId === s.id ? null : s.id); setExpandedSeatId(null); setPreviewSeatId(null); }} style={{
                    fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 10px",
                    border: `1px solid ${expandedDrinksId === s.id ? "#6a9abf" : "#e0e0e0"}`, borderRadius: 2, cursor: "pointer",
                    background: expandedDrinksId === s.id ? "#eef4fa" : "#fafafa",
                    color: expandedDrinksId === s.id ? "#2a5a80" : "#aaa",
                  }}>🍷</button>
                )}

                {/* Preview button */}
                <button onClick={() => previewSeatId === s.id ? setPreviewSeatId(null) : openPreview(s)} style={{
                  fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 10px",
                  border: `1px solid ${previewSeatId === s.id ? "#4a7a9a" : "#e0e0e0"}`, borderRadius: 2, cursor: "pointer",
                  background: previewSeatId === s.id ? "#e8f0f8" : "#fafafa",
                  color: previewSeatId === s.id ? "#2a5a80" : "#aaa",
                }}>👁</button>

                <button onClick={() => openPrint(s)} style={{
                  marginLeft: "auto", fontFamily: FONT, fontSize: 9, letterSpacing: 2,
                  padding: "8px 16px", border: "1px solid #c8a96e",
                  borderRadius: 2, cursor: "pointer",
                  background: "#c8a96e", color: "#fff",
                }}>PDF</button>
              </div>

              {/* Per-seat ephemeral course editor — shows restriction-applied menu for this position */}
              {isExpanded && (
                <div style={{ borderTop: "1px solid #f5f5f5", padding: "10px 16px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, color: "#aaa", textTransform: "uppercase" }}>
                      Menu edit for P{s.id} — one-time, auto-cleared on PDF
                    </span>
                    {seatHasEdits && (
                      <button onClick={() => clearSeatAllEdits(s.id)} style={{
                        fontFamily: FONT, fontSize: 9, padding: "2px 8px",
                        border: "1px solid #ffcccc", borderRadius: 2, cursor: "pointer",
                        background: "#fff9f9", color: "#c04040",
                      }}>clear all</button>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {(() => { const pkey = PAIRING_MAP[s.pairing]; const hasPair = !!pkey; return menuCourses.filter(c => !c.is_snack).map(course => {
                      const key = course.course_key;
                      const baseDish = getSeatDish(course, s.id);
                      const edit = seatEdits[s.id]?.[key] || {};
                      const hasEdit = "name" in edit || "sub" in edit || "drinkName" in edit || "drinkSub" in edit;
                      const inpStyle = { ...baseInp, padding: "3px 6px", fontSize: 11 };
                      const baseDrink = hasPair ? (lang === "si" ? (course[`${pkey}_si`] || course[pkey]) : course[pkey]) : null;
                      return (
                        <div key={key} style={{
                          display: "grid", gridTemplateColumns: hasPair ? "100px 1fr 1.2fr 44px 1fr 1.2fr 20px" : "120px 1fr 1.6fr 20px",
                          gap: 5, alignItems: "center",
                          borderRadius: 2, padding: "2px 4px",
                          background: hasEdit ? "#fffdf0" : "transparent",
                        }}>
                          <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, color: hasEdit ? "#a07020" : "#bbb",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {baseDish?.name || "—"}
                          </span>
                          <BlurInput
                            committedValue={"name" in edit ? edit.name : ""}
                            onCommit={v => setSeatEditField(s.id, key, "name", v)}
                            placeholder={"name" in edit ? "" : (baseDish?.name || "")}
                            style={inpStyle}
                          />
                          <BlurInput
                            committedValue={"sub" in edit ? edit.sub : ""}
                            onCommit={v => setSeatEditField(s.id, key, "sub", v)}
                            placeholder={"sub" in edit ? "" : (baseDish?.sub || "—")}
                            style={inpStyle}
                          />
                          {hasPair && <>
                            <span style={{ fontFamily: FONT, fontSize: 7, color: "#8a8a6a", textAlign: "center", whiteSpace: "nowrap" }}>
                              {s.pairing}
                            </span>
                            <BlurInput
                              committedValue={"drinkName" in edit ? edit.drinkName : ""}
                              onCommit={v => setSeatEditField(s.id, key, "drinkName", v)}
                              placeholder={"drinkName" in edit ? "" : (baseDrink?.name || "")}
                              style={inpStyle}
                            />
                            <BlurInput
                              committedValue={"drinkSub" in edit ? edit.drinkSub : ""}
                              onCommit={v => setSeatEditField(s.id, key, "drinkSub", v)}
                              placeholder={"drinkSub" in edit ? "" : (baseDrink?.sub || "")}
                              style={inpStyle}
                            />
                          </>}
                          {hasEdit
                            ? <button onClick={() => setSeatEdits(prev => {
                                const sd = { ...(prev[s.id] || {}) };
                                delete sd[key];
                                return { ...prev, [s.id]: Object.keys(sd).length ? sd : undefined };
                              })} style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                            : <span />}
                        </div>
                      );
                    }); })()}
                  </div>
                </div>
              )}

              {/* Drinks editor */}
              {expandedDrinksId === s.id && (
                <div style={{ borderTop: "1px solid #e8f0f8", padding: "12px 16px 14px", background: "#f7fafd" }}>
                  <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, color: "#6a9abf", textTransform: "uppercase", marginBottom: 12 }}>Drinks & Pairing — P{s.id}</div>
                  {/* Pairing selector */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>Pairing</div>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {["—", "Wine", "Non-Alc", "Premium", "Our Story"].map(p => {
                        const active = (s.pairing || "—") === p;
                        return (
                          <button key={p} onClick={() => updSeat(s.id, "pairing", p === "—" ? "—" : p)} style={{
                            fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 12px",
                            border: `1px solid ${active ? "#2a5a80" : "#e0e0e0"}`, borderRadius: 2, cursor: "pointer",
                            background: active ? "#2a5a80" : "#fff",
                            color: active ? "#fff" : "#888",
                          }}>{p}</button>
                        );
                      })}
                    </div>
                  </div>
                  {/* ── Aperitif — generates above Sour Soup ── */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, color: "#a07040", textTransform: "uppercase", marginBottom: 6 }}>Aperitif</div>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                      {aperitifOptions.map(ap => {
                        const label = ap.label ?? ap;
                        const sk = (ap.searchKey ?? ap).toLowerCase();
                        const type = ap.type || "wine";
                        return (
                          <button key={label} onClick={() => {
                            const wHit = (w) => { const wn=(w.name||"").toLowerCase(),wp=(w.producer||"").toLowerCase(); return wn.includes(sk)||wp.includes(sk)||(wn.length>=4&&sk.includes(wn))||(wp.length>=4&&sk.includes(wp)); };
                            const found = type === "wine"
                              ? (winesCatalog.find(w => w.byGlass && wHit(w)) || winesCatalog.find(wHit))
                              : cocktailsCatalog?.find(c => { const cn=(c.name||"").toLowerCase(); return cn.includes(sk)||(cn.length>=4&&sk.includes(cn)); });
                            const item = found || { name: label, notes: "", __cocktail: true };
                            updSeat(s.id, "aperitifs", [...(s.aperitifs || []), item]);
                          }} style={{
                            fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: "4px 9px",
                            border: "1px solid #d0c0a8", borderRadius: 3, cursor: "pointer",
                            background: "#fff", color: "#7a5020",
                          }}>{label}</button>
                        );
                      })}
                    </div>
                    <BeverageSearch
                      wines={winesCatalog} cocktails={cocktailsCatalog} spirits={spiritsCatalog} beers={beersCatalog}
                      onAdd={({ type, item }) => {
                        updSeat(s.id, "aperitifs", [...(s.aperitifs || []), item]);
                      }}
                    />
                    {(s.aperitifs || []).length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                        {(s.aperitifs || []).map((x, i) => {
                          const ts = BEV_TYPES.aperitif;
                          const label = x?.name || x?.producer || "?";
                          const sub = x?.producer && x?.name ? x.producer : (x?.notes || "");
                          return (
                            <div key={`ap${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px 4px 10px", borderRadius: tokens.radius, background: ts.bg, border: `1px solid ${ts.border}` }}>
                              <span style={{ fontFamily: FONT, fontSize: 11, color: ts.color, fontWeight: 500, whiteSpace: "nowrap" }}>{label}{sub ? ` · ${sub}` : ""}</span>
                              <button onClick={() => updSeat(s.id, "aperitifs", (s.aperitifs||[]).filter((_,idx)=>idx!==i))} style={{ background: "none", border: "none", color: ts.color, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 0 0 2px", opacity: 0.7 }}>×</button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {/* ── By the Glass — generates from Danube Salmon ── */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>By the Glass</div>
                    <BeverageSearch
                      wines={winesCatalog} cocktails={cocktailsCatalog} spirits={spiritsCatalog} beers={beersCatalog}
                      onAdd={({ type, item }) => {
                        if (type === "wine")     updSeat(s.id, "glasses",   [...(s.glasses   || []), item]);
                        if (type === "cocktail") updSeat(s.id, "cocktails", [...(s.cocktails || []), item]);
                        if (type === "spirit")   updSeat(s.id, "spirits",   [...(s.spirits   || []), item]);
                        if (type === "beer")     updSeat(s.id, "beers",     [...(s.beers     || []), item]);
                      }}
                    />
                    {(() => {
                      const allBevs = [
                        ...(s.glasses   || []).map((x, i) => ({ key: `g${i}`, type: "wine",     label: x?.name, sub: x?.producer, onRemove: () => updSeat(s.id, "glasses",   (s.glasses  ||[]).filter((_,idx)=>idx!==i)) })),
                        ...(s.cocktails || []).map((x, i) => ({ key: `c${i}`, type: "cocktail", label: x?.name, sub: x?.notes,    onRemove: () => updSeat(s.id, "cocktails", (s.cocktails||[]).filter((_,idx)=>idx!==i)) })),
                        ...(s.spirits   || []).map((x, i) => ({ key: `sp${i}`,type: "spirit",   label: x?.name, sub: x?.notes,    onRemove: () => updSeat(s.id, "spirits",   (s.spirits  ||[]).filter((_,idx)=>idx!==i)) })),
                        ...(s.beers     || []).map((x, i) => ({ key: `b${i}`, type: "beer",     label: x?.name, sub: x?.notes,    onRemove: () => updSeat(s.id, "beers",     (s.beers    ||[]).filter((_,idx)=>idx!==i)) })),
                      ];
                      if (allBevs.length === 0) return null;
                      return (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                          {allBevs.map(bev => {
                            const ts = BEV_TYPES[bev.type];
                            return (
                              <div key={bev.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px 4px 10px", borderRadius: tokens.radius, background: ts.bg, border: `1px solid ${ts.border}` }}>
                                <span style={{ fontFamily: FONT, fontSize: 11, color: ts.color, fontWeight: 500, whiteSpace: "nowrap" }}>{bev.label}{bev.sub ? ` · ${bev.sub}` : ""}</span>
                                <button onClick={bev.onRemove} style={{ background: "none", border: "none", color: ts.color, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 0 0 2px", opacity: 0.7 }}>×</button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                  {/* Optional pairings — always-on dishes, drink is optional */}
                  {optionalPairings.filter(opt => !opt.extraKey).length > 0 && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #e8f0f8" }}>
                      <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>Optional Pairings</div>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                        {optionalPairings.filter(opt => !opt.extraKey).map((opt, oi) => {
                          const raw = s.optionalPairings?.[opt.key];
                          const active = raw?.ordered !== undefined ? !!raw.ordered : opt.defaultOn !== false;
                          const mode = raw?.mode || null;
                          const seatIsNonAlc = String(s.pairing || "").trim() === "Non-Alc";
                          const seatSet = !["", "—", "-"].includes(String(s.pairing || "").trim());
                          const states = ["off", ...(opt.hasAlco ? ["alco"] : []), ...(opt.hasNonAlco ? ["nonalc"] : [])];
                          let cur;
                          if (!active) cur = "off";
                          else if (mode === "alco") cur = "alco";
                          else if (mode === "nonalc") cur = "nonalc";
                          else cur = (seatSet && !seatIsNonAlc) ? "alco" : "nonalc";
                          if (!states.includes(cur)) cur = states[1] || "off";
                          // applyNext reads latest committed seat state inside the updater — no stale closure
                          const applyNext = () => updSeatFull(s.id, seat => {
                            const r = seat.optionalPairings?.[opt.key];
                            const a = r?.ordered !== undefined ? !!r.ordered : opt.defaultOn !== false;
                            const m = r?.mode || null;
                            const sNonAlc = String(seat.pairing || "").trim() === "Non-Alc";
                            const sSet = !["", "—", "-"].includes(String(seat.pairing || "").trim());
                            let c;
                            if (!a) c = "off";
                            else if (m === "alco") c = "alco";
                            else if (m === "nonalc") c = "nonalc";
                            else c = (sSet && !sNonAlc) ? "alco" : "nonalc";
                            if (!states.includes(c)) c = states[1] || "off";
                            const nx = states[(states.indexOf(c) + 1) % states.length];
                            return { ...seat, optionalPairings: {
                              ...(seat.optionalPairings || {}),
                              [opt.key]: { ...(r || {}), ordered: nx !== "off", ...(nx === "alco" ? { mode: "alco" } : nx === "nonalc" ? { mode: "nonalc" } : { mode: null }) },
                            }};
                          });
                          const btnStyleMap = {
                            off:    { border: "#d0d0d0", bg: "#f5f5f5", color: "#aaa" },
                            alco:   { border: "#c8a060", bg: "#fdf4e8", color: "#7a5020" },
                            nonalc: { border: "#60a8c8", bg: "#e8f4fd", color: "#205a7a" },
                          };
                          const btnLabelMap = { off: "off", alco: "alco", nonalc: "n/a" };
                          const st = btnStyleMap[cur];
                          return (
                            <div key={opt.key} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                              {oi > 0 && <div style={{ width: 1, height: 18, background: "#e0e0e0", marginRight: 2 }} />}
                              <span style={{ fontFamily: FONT, fontSize: 9, color: "#888", letterSpacing: 0.3, whiteSpace: "nowrap" }}>{opt.label}</span>
                              <button onClick={applyNext} style={{
                                fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: "3px 8px",
                                border: `1px solid ${st.border}`, borderRadius: 2, cursor: "pointer",
                                background: st.bg, color: st.color,
                              }}>{btnLabelMap[cur]}</button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  {/* Extras — optional dishes (some have optional drink pairings) */}
                  {optionalExtras.length > 0 && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #e8f0f8" }}>
                      <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>Extras</div>
                      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                        {(() => {
                          const pairingByExtraKey = new Map();
                          optionalPairings.forEach(opt => { if (opt.extraKey) pairingByExtraKey.set(opt.extraKey, opt); });
                          return optionalExtras.map((dish, di) => {
                            const extra = s.extras?.[dish.key] || s.extras?.[dish.id] || { ordered: false, pairing: dish.pairings[0] };
                            const dishOn = !!extra.ordered;
                            const linked = pairingByExtraKey.get(dish.key);

                            if (linked) {
                              // Cycling button: off → on → on·ALCO → on·N/A → off
                              const raw = s.optionalPairings?.[linked.key];
                              const pairingOrdered = raw?.ordered !== undefined ? !!raw.ordered : false;
                              const pmode = raw?.mode || null;
                              const states = ["off", "on"];
                              if (linked.hasAlco) states.push("alco");
                              if (linked.hasNonAlco) states.push("nonalc");
                              // Determine current state
                              let cur;
                              if (!dishOn) cur = "off";
                              else if (!pairingOrdered) cur = "on";
                              else if (pmode === "alco") cur = "alco";
                              else if (pmode === "nonalc") cur = "nonalc";
                              else cur = "on";
                              // Single atomic update — reads latest committed seat state, no stale closure
                              const applyNext = () => updSeatFull(s.id, seat => {
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
                              const labels = { off: `${dish.name} off`, on: `${dish.name} ✓`, alco: `${dish.name.slice(0,4)} · ALCO`, nonalc: `${dish.name.slice(0,4)} · N/A` };
                              const colors = {
                                off:    { border: "#d0d0d0", bg: "#f5f5f5", color: "#aaa" },
                                on:     { border: "#a0c060", bg: "#f4f8e8", color: "#5a7820" },
                                alco:   { border: "#c8a060", bg: "#fdf4e8", color: "#7a5020" },
                                nonalc: { border: "#60a8c8", bg: "#e8f4fd", color: "#205a7a" },
                              }[cur];
                              return (
                                <div key={dish.key} style={{ display: "flex", gap: 3, alignItems: "center" }}>
                                  {di > 0 && <div style={{ width: 1, height: 18, background: "#e0e0e0", marginRight: 2 }} />}
                                  <button onClick={applyNext} style={{
                                    fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: "4px 10px",
                                    border: `1px solid ${colors.border}`, borderRadius: 2, cursor: "pointer",
                                    background: colors.bg, color: colors.color,
                                  }}>{labels[cur]}</button>
                                </div>
                              );
                            }

                            // Plain extra (no linked drink pairing) — single cycling button
                            const pStates = ["off", ...dish.pairings];
                            const curP = !dishOn ? "off" : (extra.pairing || dish.pairings[0]);
                            const applyNextP = () => updSeatFull(s.id, seat => {
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
                              ? { border: "#d0d0d0", bg: "#f5f5f5", color: "#aaa" }
                              : curP === "—"
                              ? { border: "#a0c060", bg: "#f4f8e8", color: "#5a7820" }
                              : { border: "#60a8c8", bg: "#e8f4fd", color: "#205a7a" };
                            return (
                              <div key={dish.key} style={{ display: "flex", gap: 3, alignItems: "center" }}>
                                {di > 0 && <div style={{ width: 1, height: 18, background: "#e0e0e0", marginRight: 2 }} />}
                                <button onClick={applyNextP} style={{
                                  fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: "4px 10px",
                                  border: `1px solid ${pColors.border}`, borderRadius: 2, cursor: "pointer",
                                  background: pColors.bg, color: pColors.color,
                                }}>{pLabel}</button>
                              </div>
                            );
                          });
                        })()}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Menu preview */}
              {previewSeatId === s.id && (
                <div style={{ borderTop: "1px solid #e0eaf4", padding: "12px 16px 14px", background: "#f7fafd" }}>
                  <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, color: "#6a9abf", textTransform: "uppercase", marginBottom: 10 }}>Preview — P{s.id}</div>
                  {(() => {
                    const containerW = 280;
                    const a5W = 559, a5H = 793;
                    const scale = containerW / a5W;
                    return (
                      <div style={{ width: containerW, height: Math.round(a5H * scale), overflow: "hidden", border: "1px solid #d0dce8", borderRadius: 2 }}>
                        <iframe
                          srcDoc={previewHtml}
                          title={`preview-p${s.id}`}
                          style={{ width: a5W, height: a5H, border: "none", transform: `scale(${scale})`, transformOrigin: "top left", pointerEvents: "none" }}
                        />
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Bottles preview */}
              {bottles.length > 0 && (
                <div style={{ padding: "0 16px 10px", display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {bottles.map((b, i) => (
                    <span key={i} style={{ fontFamily: FONT, fontSize: 9, padding: "2px 8px", borderRadius: 2, border: "1px solid #ddd", color: "#555", background: "#fafafa" }}>
                      🍾 {b.name}{b.vintage ? ` · ${b.vintage}` : ""}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {seats.length === 0 && (
          <div style={{ fontFamily: FONT, fontSize: 11, color: "#ccc", textAlign: "center", padding: "40px 0" }}>No seats yet</div>
        )}

        {seats.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => printSelected(seats.map(s => s.id))} style={{
                flex: 1, fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "12px",
                border: `1px solid ${UI.line}`, borderRadius: tokens.radius, cursor: "pointer",
                background: UI.surface2, color: UI.ink, fontWeight: 600,
              }}>PRINT ALL SEATS</button>
            </div>
          </div>
        )}
      </div>
    </FullModal>
  );
}
