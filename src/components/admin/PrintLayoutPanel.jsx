import { useState, useRef, useEffect, useMemo } from "react";
import { FONT } from "./adminStyles.js";
import { generateMenuHTML, DEFAULT_COURSE_GAPS } from "../../utils/menuGenerator.js";

const LAYOUT_GROUPS = [
  { label: "PAGE", props: [
    { key: "padTop",    label: "Top",    def: 8.4, step: 0.5, unit: "mm" },
    { key: "padBottom", label: "Bottom", def: 8.2, step: 0.5, unit: "mm" },
    { key: "padLeft",   label: "Left",   def: 12,  step: 0.5, unit: "mm" },
    { key: "padRight",  label: "Right",  def: 12,  step: 0.5, unit: "mm" },
  ]},
  { label: "TYPE", props: [
    { key: "fontSize",      label: "Size",       def: 6.75, step: 0.05, unit: "pt" },
    { key: "headerSpacing", label: "Header gap",  def: 7,    step: 0.5,  unit: "mm" },
  ]},
  { label: "LOGO", props: [
    { key: "logoSize",    label: "Size",     def: 10.5, step: 0.5, unit: "mm" },
    { key: "logoOffsetX", label: "Offset X", def: 0,    step: 0.5, unit: "mm" },
    { key: "logoOffsetY", label: "Offset Y", def: 0,    step: 0.5, unit: "mm" },
  ]},
  { label: "GAPS", props: [
    { key: "rowSpacing",      label: "Row",      def: 3.15, step: 0.25, unit: "pt" },
    { key: "wineRowSpacing",  label: "Wine row", def: 4.5,  step: 0.25, unit: "pt" },
    { key: "sectionSpacing",  label: "Section",  def: 6.8,  step: 0.5,  unit: "pt" },
    { key: "thankYouSpacing", label: "Thank-you", def: 7,    step: 0.5,  unit: "pt" },
  ]},
];

// ── PrintLayoutPanel — print layout editor (margins, fonts, gaps, row editing, preview) ──
export default function PrintLayoutPanel({
  menuCourses = [],
  logoDataUri = "",
  globalLayout,
  onSetGlobalLayout,
  onSaveGlobalLayout,
  layoutSaving,
  layoutSaved,
}) {
  const [selectedCKs, setSelectedCKs] = useState([]);
  const [activeCell, setActiveCell] = useState(null);
  const lastClickedCK = useRef(null);
  const layoutIframeRef = useRef(null);

  const adjustGlobal = (key, def, step) => (dir) => {
    onSetGlobalLayout(prev => {
      const cur = key in prev ? prev[key] : def;
      return { ...prev, [key]: Math.round((cur + dir * step) * 1000) / 1000 };
    });
  };

  const getCourseGap = (courseKey) => {
    return globalLayout.courseGaps?.[courseKey] ?? DEFAULT_COURSE_GAPS[courseKey] ?? null;
  };

  const setCourseGap = (courseKey, value) => {
    onSetGlobalLayout(prev => {
      const defaultVal = DEFAULT_COURSE_GAPS[courseKey] ?? (prev.sectionSpacing ?? 6.8);
      const gaps = { ...(prev.courseGaps || {}) };
      if (value === defaultVal || value === "" || isNaN(value)) {
        delete gaps[courseKey];
      } else {
        gaps[courseKey] = value;
      }
      const next = { ...prev };
      if (Object.keys(gaps).length > 0) next.courseGaps = gaps;
      else delete next.courseGaps;
      return next;
    });
  };

  const previewRows = useMemo(() => {
    const dummySeat = { id: 1, pairing: "Wine", extras: {}, glasses: [], cocktails: [], beers: [] };
    return generateMenuHTML({
      seat: dummySeat,
      table: { menuType: "", restrictions: [], bottleWines: [], birthday: false },
      menuCourses, lang: "en", layoutStyles: globalLayout, _rowsOnly: true,
    });
  }, [globalLayout, menuCourses]);

  const editorRows = useMemo(() => {
    const result = [];
    previewRows.forEach(row => {
      result.push({ ...row, _isGap: false });
      if (row.type === "course" && row.courseKey && !row.courseKey.startsWith("_gap_")) {
        const gt = globalLayout.gapTexts?.[row.courseKey];
        if (gt && (gt.leftTitle || gt.leftSub || gt.rightTitle || gt.rightSub)) {
          result.push({
            type: "gap", _afterCK: row.courseKey, _isGap: true,
            left: { title: gt.leftTitle || "", sub: gt.leftSub || "" },
            right: { title: gt.rightTitle || "", sub: gt.rightSub || "" },
          });
        }
      }
    });
    return result;
  }, [previewRows, globalLayout.gapTexts]);

  const handleRowClick = (ck, e) => {
    if (!ck) return;
    if (e.shiftKey && lastClickedCK.current) {
      const allCKs = editorRows.filter(r => r.type === "course" && r.courseKey).map(r => r.courseKey);
      const from = allCKs.indexOf(lastClickedCK.current);
      const to = allCKs.indexOf(ck);
      if (from >= 0 && to >= 0) {
        const lo = Math.min(from, to), hi = Math.max(from, to);
        setSelectedCKs(allCKs.slice(lo, hi + 1));
      }
    } else if (e.ctrlKey || e.metaKey) {
      setSelectedCKs(prev => prev.includes(ck) ? prev.filter(k => k !== ck) : [...prev, ck]);
    } else {
      setSelectedCKs([ck]);
    }
    lastClickedCK.current = ck;
  };

  const setEditorOverride = (ck, field, value) => {
    onSetGlobalLayout(prev => {
      const ovs = { ...(prev.editorOverrides || {}) };
      const entry = { ...(ovs[ck] || {}) };
      if (value === "") delete entry[field]; else entry[field] = value;
      if (Object.keys(entry).length > 0) ovs[ck] = entry; else delete ovs[ck];
      const next = { ...prev };
      if (Object.keys(ovs).length > 0) next.editorOverrides = ovs; else delete next.editorOverrides;
      return next;
    });
  };

  const setGapText = (afterCK, field, value) => {
    onSetGlobalLayout(prev => {
      const gts = { ...(prev.gapTexts || {}) };
      const entry = { ...(gts[afterCK] || {}) };
      if (value === "") delete entry[field]; else entry[field] = value;
      if (Object.keys(entry).length > 0) gts[afterCK] = entry; else delete gts[afterCK];
      const next = { ...prev };
      if (Object.keys(gts).length > 0) next.gapTexts = gts; else delete next.gapTexts;
      return next;
    });
  };

  const globalPreviewHtml = useMemo(() => {
    const dummySeat = { id: 1, pairing: "Wine", extras: {}, glasses: [], cocktails: [], beers: [] };
    return generateMenuHTML({
      seat: dummySeat,
      table: { menuType: "", restrictions: [], bottleWines: [], birthday: false },
      menuTitle: "WINTER MENU", teamNames: "", menuCourses, lang: "en", thankYouNote: "",
      layoutStyles: globalLayout, _logo: logoDataUri,
    });
  }, [globalLayout, menuCourses, logoDataUri]);

  return (
    <div tabIndex={0} style={{ outline: "none" }} onKeyDown={e => {
      if (selectedCKs.length === 0) return;
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        const dir = e.key === "ArrowUp" ? -1 : 1;
        const step = 0.5;
        onSetGlobalLayout(prev => {
          const gaps = { ...(prev.courseGaps || {}) };
          selectedCKs.forEach(ck => {
            const cur = gaps[ck] ?? DEFAULT_COURSE_GAPS[ck] ?? 0;
            gaps[ck] = Math.max(0, Math.round((cur + dir * step) * 100) / 100);
          });
          return { ...prev, courseGaps: gaps };
        });
      }
      if (e.key === "Escape") { setSelectedCKs([]); setActiveCell(null); }
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ fontFamily: FONT, fontSize: 10, color: "#888", letterSpacing: 1 }}>PRINT LAYOUT</div>
        <button onClick={onSaveGlobalLayout} disabled={layoutSaving} style={{
          fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 12px",
          border: `1px solid ${layoutSaved ? "#4a9a6a" : "#1a1a1a"}`, borderRadius: 2,
          cursor: layoutSaving ? "default" : "pointer",
          background: layoutSaved ? "#4a9a6a" : "#1a1a1a", color: "#fff",
        }}>{layoutSaving ? "SAVING..." : layoutSaved ? "SAVED" : "SAVE AS DEFAULT"}</button>
      </div>

      <div style={{ display: "flex", gap: 0, border: "1px solid #e8e8e8", borderRadius: 4, background: "#fff", height: "calc(100vh - 180px)", minHeight: 400 }}>
        {/* Controls column */}
        <div style={{ flex: "0 0 200px", padding: "8px 10px", borderRight: "1px solid #f0f0f0", overflowY: "auto" }}>
          {LAYOUT_GROUPS.map(group => (
            <div key={group.label} style={{ marginBottom: 8 }}>
              <div style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 3 }}>{group.label}</div>
              {group.props.map(({ key, label, def, step, unit }) => {
                const val = key in globalLayout ? globalLayout[key] : def;
                const isCustom = key in globalLayout;
                const btnSt = { fontFamily: FONT, fontSize: 10, width: 18, height: 18, border: "1px solid #e0e0e0", borderRadius: 2, cursor: "pointer", background: "#fafafa", color: "#555", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0 };
                return (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 2, marginBottom: 1 }}>
                    <span style={{ fontFamily: FONT, fontSize: 7.5, color: "#999", flex: "0 0 55px", whiteSpace: "nowrap" }}>{label}</span>
                    <button style={btnSt} onClick={() => adjustGlobal(key, def, step)(-1)}>-</button>
                    <span style={{ fontFamily: FONT, fontSize: 7.5, minWidth: 38, textAlign: "center", color: isCustom ? "#7a5020" : "#aaa", fontWeight: isCustom ? 700 : 400 }}>{val}{unit}</span>
                    <button style={btnSt} onClick={() => adjustGlobal(key, def, step)(+1)}>+</button>
                  </div>
                );
              })}
            </div>
          ))}

          {/* Selection panel */}
          {selectedCKs.length > 0 && (() => {
            const gapVals = selectedCKs.map(ck => globalLayout.courseGaps?.[ck] ?? DEFAULT_COURSE_GAPS[ck] ?? 0);
            const allSame = gapVals.every(v => v === gapVals[0]);
            const displayGap = allSame ? gapVals[0] : "mixed";
            const btnSt = { fontFamily: FONT, fontSize: 10, width: 18, height: 18, border: "1px solid #d0d8f0", borderRadius: 2, cursor: "pointer", background: "#f0f4ff", color: "#3b6fd6", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, padding: 0 };
            return (
              <div style={{ borderTop: "2px solid #3b82f6", marginTop: 4, paddingTop: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontFamily: FONT, fontSize: 7.5, letterSpacing: 1, color: "#3b82f6", fontWeight: 700 }}>
                    {selectedCKs.length === 1 ? (menuCourses.find(c => c.course_key === selectedCKs[0])?.menu?.name || selectedCKs[0]) : `${selectedCKs.length} SELECTED`}
                  </span>
                  <button onClick={() => { setSelectedCKs([]); setActiveCell(null); }} style={{ background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: 11, lineHeight: 1, padding: 0 }}>x</button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 2, marginBottom: 4 }}>
                  <span style={{ fontFamily: FONT, fontSize: 7, color: "#666", flex: "0 0 55px" }}>Gap before</span>
                  <button style={btnSt} onClick={() => {
                    const v = (allSame ? gapVals[0] : 0) - 0.5;
                    selectedCKs.forEach(ck => setCourseGap(ck, Math.max(0, Math.round(v * 100) / 100)));
                  }}>-</button>
                  <span style={{ fontFamily: FONT, fontSize: 7.5, minWidth: 38, textAlign: "center", color: "#3b6fd6", fontWeight: 700 }}>
                    {typeof displayGap === "number" ? `${displayGap}pt` : displayGap}
                  </span>
                  <button style={btnSt} onClick={() => {
                    const v = (allSame ? gapVals[0] : 0) + 0.5;
                    selectedCKs.forEach(ck => setCourseGap(ck, Math.round(v * 100) / 100));
                  }}>+</button>
                </div>

                {/* Active cell editing */}
                {activeCell && (() => {
                  const isGapCell = activeCell.ck.startsWith("_gap_");
                  const realCK = isGapCell ? activeCell.ck.replace("_gap_", "") : activeCell.ck;
                  const sideLabel = activeCell.side === "left" ? "Dish" : "Drink";
                  const titleField = activeCell.side === "left" ? "leftTitle" : "rightTitle";
                  const subField = activeCell.side === "left" ? "leftSub" : "rightSub";
                  const source = isGapCell ? (globalLayout.gapTexts?.[realCK] || {}) : (globalLayout.editorOverrides?.[realCK] || {});
                  const setFn = isGapCell ? (f, v) => setGapText(realCK, f, v) : (f, v) => setEditorOverride(realCK, f, v);
                  const curRow = editorRows.find(r => (r.courseKey === activeCell.ck) || (r._isGap && r._afterCK === realCK && isGapCell));
                  const placeholder = curRow ? (activeCell.side === "left" ? curRow.left : curRow.right) : {};
                  return (
                    <div style={{ borderTop: "1px solid #e8e8e8", marginTop: 4, paddingTop: 4 }}>
                      <div style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 1, color: "#888", marginBottom: 2 }}>
                        {isGapCell ? "GAP ROW" : sideLabel.toUpperCase()} - {activeCell.side}
                      </div>
                      <input
                        value={source[titleField] || ""}
                        onChange={e => setFn(titleField, e.target.value)}
                        placeholder={placeholder?.title || "title"}
                        style={{ fontFamily: FONT, fontSize: 8.5, width: "100%", padding: "2px 4px", border: "1px solid #d0d8f0", borderRadius: 2, marginBottom: 2, boxSizing: "border-box" }}
                      />
                      <input
                        value={source[subField] || ""}
                        onChange={e => setFn(subField, e.target.value)}
                        placeholder={placeholder?.sub || "sub"}
                        style={{ fontFamily: FONT, fontSize: 8.5, width: "100%", padding: "2px 4px", border: "1px solid #d0d8f0", borderRadius: 2, boxSizing: "border-box" }}
                      />
                    </div>
                  );
                })()}

                <div style={{ fontFamily: FONT, fontSize: 6.5, color: "#aaa", marginTop: 4 }}>
                  Arrows nudge gap, Shift+click range, Esc clear
                </div>
              </div>
            );
          })()}
        </div>

        {/* Row editor - middle column */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", borderRight: "1px solid #f0f0f0" }}>
          <div style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 1, color: "#ccc", textTransform: "uppercase", padding: "6px 8px 3px", flexShrink: 0 }}>
            ROWS
          </div>
          <div style={{ flex: 1, overflowY: "auto", padding: "0 6px 6px" }}>
            {editorRows.map((row, idx) => {
              if (row.type === "section") {
                return (
                  <div key={`s-${idx}`} style={{ fontFamily: FONT, fontSize: 7, fontWeight: 700, letterSpacing: 1, color: "#888", padding: "5px 4px 2px", textTransform: "uppercase" }}>
                    {row.label}
                  </div>
                );
              }
              if (row.type === "thankyou" || row.type === "team") return null;
              if (row.type === "wine-only") {
                return (
                  <div key={`w-${idx}`} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, padding: "1px 0" }}>
                    <div style={{ fontFamily: FONT, fontSize: 7, color: "#ccc", padding: "2px 4px" }} />
                    <div style={{ fontFamily: FONT, fontSize: 7, color: "#666", padding: "2px 4px", background: "#fafafa", borderRadius: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 6.5, textTransform: "uppercase" }}>{row.right?.title}</div>
                      {row.right?.sub && <div style={{ fontSize: 6.5, color: "#999" }}>{row.right.sub}</div>}
                    </div>
                  </div>
                );
              }

              const isGap = row._isGap;
              const ck = isGap ? `_gap_${row._afterCK}` : row.courseKey;
              const isSel = !isGap && selectedCKs.includes(ck);
              const hasGapContent = isGap && (row.left?.title || row.right?.title);
              const canAddGap = !isGap && row.type === "course" && row.courseKey && !row.courseKey.startsWith("_gap_")
                && !globalLayout.gapTexts?.[row.courseKey];
              const courseGapVal = !isGap && row.courseKey ? (globalLayout.courseGaps?.[row.courseKey] ?? DEFAULT_COURSE_GAPS[row.courseKey] ?? null) : null;
              const cellStyle = (side) => {
                const isActive = activeCell?.ck === ck && activeCell?.side === side;
                return {
                  fontFamily: FONT, fontSize: 7, padding: "2px 4px", borderRadius: 2, cursor: "pointer",
                  minHeight: isGap ? 16 : undefined,
                  background: isActive ? "#e8f0ff" : isSel ? "#f0f4ff" : isGap ? "#fcfcfc" : "#fff",
                  border: isActive ? "1.5px solid #3b82f6" : isGap && !hasGapContent ? "1px dashed #e0e0e0" : isSel ? "1px solid #c0d4f0" : "1px solid transparent",
                  transition: "background 0.1s, border 0.1s",
                };
              };
              const renderCell = (side) => {
                const data = side === "left" ? row.left : row.right;
                if (isGap && !data?.title && !data?.sub) {
                  return <div style={cellStyle(side)} onClick={e => { e.stopPropagation(); setActiveCell({ ck, side }); }} />;
                }
                return (
                  <div style={cellStyle(side)} onClick={e => { e.stopPropagation(); setActiveCell({ ck, side }); if (!isGap) handleRowClick(ck, e); }}>
                    {data?.title && <div style={{ fontWeight: 700, fontSize: 6.5, textTransform: "uppercase", lineHeight: 1.15 }}>{data.title}</div>}
                    {data?.sub && <div style={{ fontSize: 6.5, color: "#888", lineHeight: 1.15, marginTop: 1 }}>{data.sub}</div>}
                  </div>
                );
              };

              return (
                <div key={isGap ? `gap-${row._afterCK}` : `r-${ck}-${idx}`}>
                  {courseGapVal != null && courseGapVal > 0 && (
                    <div style={{ height: Math.min(courseGapVal * 0.8, 12), borderBottom: "1px dashed #e8e8e8", margin: "0 4px" }} />
                  )}
                  <div onClick={e => { if (!isGap && ck) handleRowClick(ck, e); }}
                    style={{ display: "grid", gridTemplateColumns: isGap ? "1fr 1fr 14px" : "1fr 1fr", gap: 2, padding: "1px 0", cursor: isGap ? "default" : "pointer" }}>
                    {renderCell("left")}
                    {renderCell("right")}
                    {isGap && (
                      <button onClick={() => {
                        onSetGlobalLayout(prev => {
                          const gts = { ...(prev.gapTexts || {}) };
                          delete gts[row._afterCK];
                          const next = { ...prev };
                          if (Object.keys(gts).length > 0) next.gapTexts = gts; else delete next.gapTexts;
                          return next;
                        });
                      }}
                        style={{ fontFamily: FONT, fontSize: 9, color: "#ccc", background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1, alignSelf: "center" }}
                        title="Remove gap row">x</button>
                    )}
                  </div>
                  {canAddGap && (
                    <div style={{ display: "flex", justifyContent: "center", padding: "0" }}>
                      <button onClick={() => setGapText(row.courseKey, "leftTitle", " ")}
                        style={{ fontFamily: FONT, fontSize: 7, color: "#ddd", background: "none", border: "none", cursor: "pointer", padding: "0 4px", lineHeight: 1 }}
                        title="Insert gap row below">+</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Preview - right column */}
        <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "center", padding: "6px 8px", overflow: "hidden" }}>
          <div style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 1, color: "#ccc", textTransform: "uppercase", marginBottom: 4, alignSelf: "flex-start" }}>PREVIEW</div>
          {(() => {
            const containerH = Math.max(350, (typeof window !== "undefined" ? window.innerHeight : 800) - 250);
            const a5W = 559;
            const a5H = 793;
            const scale = containerH / a5H;
            const containerW = Math.round(a5W * scale);
            return (
              <div style={{ width: containerW, height: containerH, overflow: "hidden", border: "1px solid #e8e8e8", borderRadius: 2, flexShrink: 0 }}>
                <iframe ref={layoutIframeRef} srcDoc={globalPreviewHtml} title="layout preview"
                  style={{ width: a5W, height: a5H, border: "none", transform: `scale(${scale})`, transformOrigin: "top left", pointerEvents: "none" }} />
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}
