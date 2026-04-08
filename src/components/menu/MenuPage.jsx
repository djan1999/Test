import { useState } from "react";
import { DEFAULT_MENU_RULES } from "../../utils/menuGenerator.js";
import { tokens } from "../../styles/tokens.js";

const FONT = tokens.font;

// ── Menu Page — preview + print only ─────────────────────────────────────────
export default function MenuPage({ tables, menuCourses, upd, logoDataUri = "", wines = [], cocktails = [], spirits = [], beers = [], globalLayout = {}, menuTemplate = null, aperitifOptions = [], menuRules = DEFAULT_MENU_RULES, onExit }) {
  const [menuGenTable, setMenuGenTable] = useState(null);

  return (
    <div style={{ minHeight: "100vh", background: "#fafafa", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e8e8e8", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: 3, color: "#1a1a1a" }}>MENU</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, color: "#aaa" }}>PREVIEW + PRINT</span>
          <button onClick={onExit} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 14px", border: "1px solid #e8e8e8", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#888" }}>EXIT</button>
        </div>
      </div>

      {/* Content — table selection for menu generation */}
      <div style={{ flex: 1, overflowY: "auto", padding: "28px 24px", maxWidth: 740, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <div style={{ fontFamily: FONT, fontSize: 10, color: "#888", letterSpacing: 1, marginBottom: 20 }}>
          SELECT A TABLE TO GENERATE MENUS
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
          {tables.map(t => {
            const hasData = t.active || t.resName || t.resTime;
            return (
              <div
                key={t.id}
                onClick={() => setMenuGenTable(t)}
                style={{
                  border: `1px solid ${hasData ? "#e0e0e0" : "#f0f0f0"}`,
                  borderRadius: 6, padding: "14px 16px",
                  background: hasData ? "#fff" : "#fafafa",
                  cursor: "pointer", boxShadow: hasData ? "0 1px 4px rgba(0,0,0,0.06)" : "none",
                  opacity: hasData ? 1 : 0.5, transition: "box-shadow 0.15s",
                }}
              >
                <div style={{ fontFamily: FONT, fontSize: 20, fontWeight: 800, color: "#111", letterSpacing: -1, lineHeight: 1 }}>T{t.id}</div>
                {t.resName && <div style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, color: "#333", marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.resName}</div>}
                {t.resTime && <div style={{ fontFamily: FONT, fontSize: 9, color: "#888", marginTop: 2 }}>{t.resTime}</div>}
                {t.seats?.length > 0 && <div style={{ fontFamily: FONT, fontSize: 9, color: "#aaa", marginTop: 4 }}>{t.seats.length} pax</div>}
                {t.active && <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#4a9a6a", marginTop: 4, fontWeight: 700 }}>SEATED</div>}
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
          defaultLayoutStyles={globalLayout}
          menuTemplate={menuTemplate}
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
