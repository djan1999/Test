import { useState } from "react";
import { DEFAULT_MENU_RULES } from "../../utils/menuGenerator.js";
import { tokens } from "../../styles/tokens.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import MenuGenerator from "./MenuGenerator.jsx";

const FONT = tokens.font;

// ── Menu Page — preview + print only ─────────────────────────────────────────
export default function MenuPage({ tables, menuCourses, upd, logoDataUri = "", wines = [], cocktails = [], spirits = [], beers = [], globalLayout = {}, menuTemplate = null, aperitifOptions = [], menuRules = DEFAULT_MENU_RULES, onExit }) {
  const [menuGenTable, setMenuGenTable] = useState(null);
  const isMobile = useIsMobile(tokens.breakpoints.md);

  return (
    <div style={{ minHeight: "100dvh", background: tokens.neutral[50], display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{
        background: tokens.neutral[0],
        borderBottom: `1px solid ${tokens.neutral[200]}`,
        padding: isMobile ? "10px 12px" : "12px 24px",
        paddingTop: `max(${isMobile ? 10 : 12}px, env(safe-area-inset-top))`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
        gap: 8,
        flexWrap: "wrap",
        position: "sticky",
        top: 0,
        zIndex: 40,
      }}>
        <span style={{ fontFamily: FONT, fontSize: isMobile ? 13 : 11, fontWeight: 700, letterSpacing: isMobile ? 2 : 3, color: tokens.text.primary }}>MENU</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
          {!isMobile && <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, color: tokens.text.muted }}>PREVIEW + PRINT</span>}
          <button onClick={onExit} style={{ fontFamily: FONT, fontSize: isMobile ? 10 : 9, letterSpacing: 2, padding: isMobile ? "8px 14px" : "6px 14px", border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, cursor: "pointer", background: tokens.neutral[0], color: tokens.text.muted, minHeight: isMobile ? tokens.mobile.touchTargetMin : undefined }}>EXIT</button>
        </div>
      </div>

      {/* Content — table selection for menu generation */}
      <div style={{ flex: 1, overflowY: "auto", padding: isMobile ? "18px 12px calc(32px + env(safe-area-inset-bottom))" : "28px 24px", maxWidth: 900, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <div style={{ fontFamily: FONT, fontSize: isMobile ? 12 : 10, color: tokens.text.muted, letterSpacing: 1, marginBottom: 16 }}>
          SELECT A TABLE TO GENERATE MENUS
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(220px, 1fr))", gap: isMobile ? 10 : 12 }}>
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
                  border: `1px solid ${hasData ? tokens.neutral[200] : tokens.neutral[100]}`,
                  borderRadius: 0, padding: isMobile ? "14px 14px" : "14px 16px",
                  background: hasData ? tokens.neutral[0] : tokens.neutral[50],
                  cursor: "pointer", boxShadow: hasData ? "0 1px 4px rgba(0,0,0,0.06)" : "none",
                  opacity: hasData ? 1 : 0.5, transition: "box-shadow 0.15s",
                  minHeight: isMobile ? tokens.mobile.touchTargetMin : undefined,
                }}
              >
                <div style={{ fontFamily: FONT, fontSize: t.tableGroup?.length > 1 ? (isMobile ? 18 : 14) : (isMobile ? 24 : 20), fontWeight: 800, color: tokens.text.primary, letterSpacing: -1, lineHeight: 1 }}>{groupLabel}</div>
                {t.resName && <div style={{ fontFamily: FONT, fontSize: isMobile ? 12 : 10, fontWeight: 700, color: tokens.text.body, marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.resName}</div>}
                {t.resTime && <div style={{ fontFamily: FONT, fontSize: isMobile ? 11 : 9, color: tokens.text.muted, marginTop: 2 }}>{t.resTime}</div>}
                {t.seats?.length > 0 && <div style={{ fontFamily: FONT, fontSize: isMobile ? 11 : 9, color: tokens.text.muted, marginTop: 4 }}>{t.seats.length} pax</div>}
                {t.active && <div style={{ fontFamily: FONT, fontSize: isMobile ? 10 : 8, letterSpacing: 1, color: tokens.green.border, marginTop: 4, fontWeight: 700 }}>SEATED</div>}
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
