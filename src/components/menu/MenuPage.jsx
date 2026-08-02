import { DEFAULT_MENU_RULES } from "../../utils/menuGenerator.js";
import { tokens } from "../../styles/tokens.js";
import MenuWorkspace from "./MenuWorkspace.jsx";

const FONT = tokens.font;
const { ink, rule, neutral } = tokens;

const headerBtn = {
  fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase",
  padding: "6px 14px", border: `${rule.hairline} solid ${ink[4]}`, borderRadius: 0,
  cursor: "pointer", background: neutral[0], color: ink[2],
};

export default function MenuPage({ tables, menuCourses, upd, logoDataUri = "", wines = [], cocktails = [], spirits = [], beers = [], aperitifOptions = [], menuRules = DEFAULT_MENU_RULES, profiles = [], assignments = {}, onExit }) {
  return (
    <div style={{ minHeight: "100vh", height: "100vh", background: ink.bg, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ background: neutral[0], borderBottom: `${rule.hairline} solid ${ink[4]}`, padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <span style={{ fontFamily: FONT, fontSize: "9px", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: ink[0] }}>[MENU]</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em", textTransform: "uppercase", color: ink[3] }}>PREVIEW + PRINT</span>
          <button onClick={onExit} style={headerBtn}>EXIT</button>
        </div>
      </div>

      {/* The workspace IS the menu screen — one engine (generateMenuHTML)
          behind preview, print, and the per-seat editing that used to live in
          the separate full-screen generator. */}
      <MenuWorkspace
        tables={tables}
        menuCourses={menuCourses}
        upd={upd}
        logoDataUri={logoDataUri}
        wines={wines}
        cocktails={cocktails}
        spirits={spirits}
        beers={beers}
        aperitifOptions={aperitifOptions}
        menuRules={menuRules}
        profiles={profiles}
        assignments={assignments}
      />
    </div>
  );
}
