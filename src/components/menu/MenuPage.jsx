import { useState } from "react";
import { DEFAULT_MENU_RULES } from "../../utils/menuGenerator.js";
import { tokens } from "../../styles/tokens.js";
import MenuGenerator from "./MenuGenerator.jsx";
import MenuWorkspace from "./MenuWorkspace.jsx";

const FONT = tokens.font;
const { ink, rule, neutral } = tokens;

const headerBtn = {
  fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase",
  padding: "6px 14px", border: `${rule.hairline} solid ${ink[4]}`, borderRadius: 0,
  cursor: "pointer", background: neutral[0], color: ink[2],
};

export default function MenuPage({ tables, menuCourses, upd, logoDataUri = "", wines = [], cocktails = [], spirits = [], beers = [], aperitifOptions = [], menuRules = DEFAULT_MENU_RULES, profiles = [], assignments = {}, wordmark = "MILKA", onExit }) {
  // The full generator stays reachable for the beverage-level work (glasses,
  // bottles, optional extras) that the preparation workspace deliberately
  // leaves alone. It opens on whichever party the workspace has selected.
  const [generatorTableId, setGeneratorTableId] = useState(null);
  const [selectedTableId, setSelectedTableId] = useState(null);
  const generatorTable = tables.find(t => t.id === generatorTableId) || null;

  return (
    <div style={{ minHeight: "100vh", height: "100vh", background: ink.bg, display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ background: neutral[0], borderBottom: `${rule.hairline} solid ${ink[4]}`, padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <span style={{ fontFamily: FONT, fontSize: "9px", fontWeight: 700, letterSpacing: "0.22em", textTransform: "uppercase", color: ink[0] }}>[MENU]</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em", textTransform: "uppercase", color: ink[3] }}>PREVIEW + PRINT</span>
          {selectedTableId != null && (
            <button onClick={() => setGeneratorTableId(selectedTableId)} style={headerBtn}>FULL EDITOR</button>
          )}
          <button onClick={onExit} style={headerBtn}>EXIT</button>
        </div>
      </div>

      {/* Preparation workspace */}
      <MenuWorkspace
        tables={tables}
        menuCourses={menuCourses}
        aperitifOptions={aperitifOptions}
        wordmark={wordmark}
        onSelectTable={setSelectedTableId}
      />

      {/* Full generator overlay — beverages, extras, layout profiles */}
      {generatorTable && (
        <MenuGenerator
          table={generatorTable}
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
          onClose={() => setGeneratorTableId(null)}
        />
      )}
    </div>
  );
}
