import { useState } from "react";
import { DEFAULT_MENU_RULES } from "../../utils/menuGenerator.js";
import { tokens } from "../../styles/tokens.js";
import MenuGenerator from "./MenuGenerator.jsx";

const FONT = tokens.font;
const { ink, rule, neutral, green } = tokens;

export default function MenuPage({ tables, menuCourses, upd, logoDataUri = "", wines = [], cocktails = [], spirits = [], beers = [], aperitifOptions = [], menuRules = DEFAULT_MENU_RULES, profiles = [], assignments = {}, onExit }) {
  const [menuGenTable, setMenuGenTable] = useState(null);

  return (
    <div style={{ minHeight: "100vh", background: ink.bg, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ background: neutral[0], borderBottom: `${rule.hairline} solid ${ink[4]}`, padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <span style={{ fontFamily: FONT, fontSize: "9px", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: ink[0] }}>[MENU]</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em", textTransform: "uppercase", color: ink[3] }}>PREVIEW + PRINT</span>
          <button onClick={onExit} style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase", padding: "6px 14px", border: `${rule.hairline} solid ${ink[4]}`, borderRadius: 0, cursor: "pointer", background: neutral[0], color: ink[2] }}>EXIT</button>
        </div>
      </div>

      {/* Content — table selection */}
      <div style={{ flex: 1, overflowY: "auto", padding: "28px 24px", maxWidth: 740, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <div style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.18em", textTransform: "uppercase", color: ink[3], marginBottom: 20 }}>
          SELECT A TABLE TO GENERATE MENUS
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
          {tables
            .filter(t => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup))
            .map(t => {
            const hasData = t.active || t.resName || t.resTime;
            const groupLabel = t.tableGroup?.length > 1
              ? `T${Math.min(...t.tableGroup)}-${Math.max(...t.tableGroup)}`
              : `T${t.id}`;
            return (
              <div
                key={t.id}
                onClick={() => setMenuGenTable(t)}
                style={{
                  borderTop:    `${rule.hairline} solid ${hasData ? ink[4] : ink[5]}`,
                  borderRight:  `${rule.hairline} solid ${hasData ? ink[4] : ink[5]}`,
                  borderBottom: `${rule.hairline} solid ${hasData ? ink[4] : ink[5]}`,
                  borderLeft:   `3px solid ${hasData ? ink[3] : ink[5]}`,
                  borderRadius: 0, padding: "14px 16px",
                  background: neutral[0],
                  cursor: "pointer",
                  opacity: hasData ? 1 : 0.4, transition: "opacity 0.15s",
                }}
              >
                <div style={{ fontFamily: FONT, fontSize: t.tableGroup?.length > 1 ? "14px" : "20px", fontWeight: 800, color: ink[0], letterSpacing: "-0.02em", lineHeight: 1 }}>{groupLabel}</div>
                {t.resName && <div style={{ fontFamily: FONT, fontSize: "10px", fontWeight: 600, color: ink[1], marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.resName}</div>}
                {t.resTime && <div style={{ fontFamily: FONT, fontSize: "9px", color: ink[3], marginTop: 2 }}>{t.resTime}</div>}
                {t.seats?.length > 0 && <div style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.08em", color: ink[3], marginTop: 4 }}>{t.seats.length} pax</div>}
                {t.active && <div style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.12em", textTransform: "uppercase", color: green.text, marginTop: 4, fontWeight: 700 }}>SEATED</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* MenuGenerator overlay */}
      {menuGenTable && (
        <MenuGenerator
          table={tables.find(t => t.id === menuGenTable.id) || menuGenTable}
          menuCourses={menuCourses}
          upd={upd}
          profiles={profiles}
          assignments={assignments}
          logoDataUri={logoDataUri}
          wines={wines}
          cocktails={cocktails}
          spirits={spirits}
          beers={beers}
          aperitifOptions={aperitifOptions}
          menuRules={menuRules}
          onClose={() => setMenuGenTable(null)}
        />
      )}
    </div>
  );
}
