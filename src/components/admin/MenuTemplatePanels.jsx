import { FONT, baseInp } from "./adminStyles.js";
import { UI, outlineBtn } from "../../styles/uiChrome.js";
import { DEFAULT_MENU_RULES, normalizeMenuRules } from "../../utils/menuGenerator.js";

export function MenuRulesPanel({
  menuRules = DEFAULT_MENU_RULES,
  onUpdateMenuRules,
  onSaveMenuRules,
  menuRulesSaving = false,
  menuRulesSaved = false,
  open = false,
  onToggle,
}) {
  const rules = normalizeMenuRules(menuRules);
  const setRule = (key, value) => {
    if (!onUpdateMenuRules) return;
    onUpdateMenuRules({ ...rules, [key]: value });
  };

  return (
    <div style={{ borderBottom: `1px solid ${UI.border}`, background: UI.surface2, flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", borderBottom: open ? `1px solid ${UI.border}` : "none" }}>
        <button
          onClick={onToggle}
          style={{ fontFamily: FONT, fontSize: 7.5, letterSpacing: 2, color: UI.ink, background: "none", border: "none", cursor: "pointer", padding: 0, textTransform: "uppercase" }}
        >{open ? "▾ MENU RULES" : "▸ MENU RULES"}</button>
        <span style={{ fontFamily: FONT, fontSize: 7.5, color: "#aaa" }}>Global behavior controls used by preview + print</span>
        {onSaveMenuRules && (
          <button
            onClick={onSaveMenuRules}
            disabled={menuRulesSaving}
            style={{
              marginLeft: "auto", fontFamily: FONT, fontSize: 8, letterSpacing: 1.2,
              padding: "4px 10px", borderRadius: 3, cursor: menuRulesSaving ? "wait" : "pointer",
              textTransform: "uppercase", fontWeight: 600,
              ...(menuRulesSaved ? { background: UI.okSoft, color: UI.okText, border: `1px solid ${UI.okBorder}` } : outlineBtn),
            }}
          >
            {menuRulesSaving ? "Saving..." : menuRulesSaved ? "Saved" : "Save Rules"}
          </button>
        )}
      </div>
      {open && (
        <div style={{ padding: "10px 12px 12px", display: "grid", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 8 }}>
            <label style={{ fontFamily: FONT, fontSize: 9, color: "#555", display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="checkbox"
                checked={rules.overwriteTitleAndThankYouOnLanguageSwitch !== false}
                onChange={e => setRule("overwriteTitleAndThankYouOnLanguageSwitch", e.target.checked)}
              />
              Overwrite title/thank-you when language changes (menu generator)
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Layout Styles panel ───────────────────────────────────────────────────────

/**
 * One reusable number-input row for a layoutStyles key.
 * Renders inline — no hooks.
 */
function StyleInput({ label, lkey, def, step, unit, min, layoutStyles, onUpdateLayoutStyles }) {
  const current = lkey in layoutStyles ? layoutStyles[lkey] : def;
  const isOverridden = lkey in layoutStyles;
  return (
    <div>
      <div style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 1.2, color: "#aaa", textTransform: "uppercase", marginBottom: 3 }}>
        {label}
        {!isOverridden && <span style={{ color: "#ddd", marginLeft: 4 }}>· default {def}{unit}</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <input
          type="number"
          step={step ?? 0.5}
          min={min ?? 0}
          value={current}
          onChange={e => {
            const n = parseFloat(e.target.value);
            const next = { ...layoutStyles };
            if (!Number.isFinite(n)) delete next[lkey];
            else next[lkey] = n;
            onUpdateLayoutStyles(next);
          }}
          style={{
            fontFamily: FONT, fontSize: 9, padding: "2px 5px",
            border: `1px solid ${isOverridden ? "#9090c0" : "#ddd"}`,
            borderRadius: 2, width: 52, textAlign: "center",
            background: isOverridden ? "#f4f3fb" : "#fff",
          }}
        />
        <span style={{ fontFamily: FONT, fontSize: 8, color: "#aaa" }}>{unit}</span>
        {isOverridden && (
          <button
            onClick={() => { const next = { ...layoutStyles }; delete next[lkey]; onUpdateLayoutStyles(next); }}
            title="Reset to default"
            style={{ fontFamily: FONT, fontSize: 9, color: "#bbb", background: "none", border: "none", cursor: "pointer", padding: "0 2px" }}
          >↺</button>
        )}
      </div>
    </div>
  );
}

export function LayoutStylesPanel({ layoutStyles, onUpdateLayoutStyles, onSaveLayoutStyles, open, onToggle }) {
  const si = (props) => <StyleInput layoutStyles={layoutStyles} onUpdateLayoutStyles={onUpdateLayoutStyles} {...props} />;
  return (
    <div style={{ borderBottom: `1px solid ${UI.border}`, background: UI.surface2, flexShrink: 0 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", borderBottom: open ? `1px solid ${UI.border}` : "none" }}>
        <button
          onClick={onToggle}
          style={{ fontFamily: FONT, fontSize: 7.5, letterSpacing: 2, color: UI.ink, background: "none", border: "none", cursor: "pointer", padding: 0, textTransform: "uppercase" }}
        >{open ? "▾ SPACING SETTINGS" : "▸ SPACING SETTINGS"}</button>
        <span style={{ fontFamily: FONT, fontSize: 7.5, color: "#aaa" }}>
          Page margins · columns · row gaps · footer — all configurable
        </span>
        {onSaveLayoutStyles && (
          <button
            onClick={onSaveLayoutStyles}
            style={{
              marginLeft: "auto", fontFamily: FONT, fontSize: 8, letterSpacing: 1.2,
              padding: "4px 10px", borderRadius: 3, cursor: "pointer",
              textTransform: "uppercase", fontWeight: 600, ...outlineBtn, background: UI.surface2,
            }}
          >Save Styles</button>
        )}
      </div>

      {open && (
        <div style={{ padding: "12px 14px 14px", display: "flex", flexDirection: "column", gap: 14 }}>

          {/* Page margins */}
          <div>
            <div style={{ fontFamily: FONT, fontSize: 7.5, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 8 }}>Page Margins</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px" }}>
              {si({ label: "Top",    lkey: "padTop",    def: 8.4, step: 0.1, unit: "mm" })}
              {si({ label: "Right",  lkey: "padRight",  def: 12,  step: 0.5, unit: "mm" })}
              {si({ label: "Bottom", lkey: "padBottom", def: 8.2, step: 0.1, unit: "mm" })}
              {si({ label: "Left",   lkey: "padLeft",   def: 12,  step: 0.5, unit: "mm" })}
            </div>
          </div>

          {/* Columns */}
          <div>
            <div style={{ fontFamily: FONT, fontSize: 7.5, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 8 }}>Columns</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px" }}>
              {si({ label: "Column gap",           lkey: "colGap",       def: 9,   step: 0.5, unit: "mm" })}
              {si({ label: "Header gap (title↔logo)", lkey: "headerColGap", def: 8.6, step: 0.1, unit: "mm" })}
              <div>
                <div style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 1.2, color: "#aaa", textTransform: "uppercase", marginBottom: 3 }}>
                  Course split (dish / wine)
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    type="number"
                    step={1}
                    min={20}
                    max={80}
                    value={layoutStyles.courseColSplit ?? 55}
                    onChange={e => {
                      const n = parseInt(e.target.value, 10);
                      const next = { ...layoutStyles };
                      if (isNaN(n)) delete next.courseColSplit;
                      else next.courseColSplit = Math.min(80, Math.max(20, n));
                      onUpdateLayoutStyles(next);
                    }}
                    style={{
                      fontFamily: FONT, fontSize: 9, padding: "2px 5px",
                      border: `1px solid ${"courseColSplit" in layoutStyles ? "#9090c0" : "#ddd"}`,
                      borderRadius: 2, width: 52, textAlign: "center",
                      background: "courseColSplit" in layoutStyles ? "#f4f3fb" : "#fff",
                    }}
                  />
                  <span style={{ fontFamily: FONT, fontSize: 8, color: "#aaa" }}>
                    / {100 - (layoutStyles.courseColSplit ?? 55)} %
                  </span>
                  {"courseColSplit" in layoutStyles && (
                    <button
                      onClick={() => { const next = { ...layoutStyles }; delete next.courseColSplit; onUpdateLayoutStyles(next); }}
                      title="Reset to default (55)"
                      style={{ fontFamily: FONT, fontSize: 9, color: "#bbb", background: "none", border: "none", cursor: "pointer", padding: "0 2px" }}
                    >↺</button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Row spacing */}
          <div>
            <div style={{ fontFamily: FONT, fontSize: 7.5, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 8 }}>Row Spacing</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px" }}>
              {si({ label: "Between rows",      lkey: "rowSpacing",     def: 3.15, step: 0.05, unit: "pt" })}
              {si({ label: "Between wine rows", lkey: "wineRowSpacing", def: 4.5,  step: 0.05, unit: "pt" })}
            </div>
          </div>

          {/* Header / footer */}
          <div>
            <div style={{ fontFamily: FONT, fontSize: 7.5, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 8 }}>Header &amp; Footer</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px" }}>
              {si({ label: "Header → content gap", lkey: "headerSpacing",   def: 7, step: 0.5, unit: "mm" })}
              {si({ label: "Thank-you top gap",     lkey: "thankYouSpacing", def: 7, step: 0.5, unit: "pt" })}
            </div>
          </div>

          {/* Micro spacing */}
          <div>
            <div style={{ fontFamily: FONT, fontSize: 7.5, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 8 }}>Micro Spacing</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 12px" }}>
              {si({ label: "Title → date gap",          lkey: "menuDateMarginTop",     def: 0.8,  step: 0.05, unit: "mm" })}
              {si({ label: "Main → sub gap",            lkey: "menuSubMarginTop",      def: 0.75, step: 0.05, unit: "pt" })}
              {si({ label: "Section label padding-top", lkey: "sectionLabelPaddingTop", def: 0.6,  step: 0.05, unit: "pt" })}
              {si({ label: "Min autoscale (fit)",       lkey: "minScale",              def: 0.58, step: 0.01, unit: "" , min: 0.1 })}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

