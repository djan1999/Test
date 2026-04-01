/**
 * MenuLayoutBuilder — WYSIWYG menu layout composition tool.
 *
 * Three-panel layout:
 *   Left:   Block palette — add blocks to either column
 *   Center: MenuLayoutCanvas — visual WYSIWYG canvas (the build surface)
 *   Right:  Block config inspector + live preview iframe + print settings
 *
 * This is the single source of truth for menu structure.
 * The old PrintLayoutPanel is gone — print settings are embedded here.
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import {
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
import { FONT, baseInp } from "./adminStyles.js";
import { BLOCK_TYPES, SPACER_SIZES, makeBlockId } from "../../utils/visualLayout.js";
import { generateMenuHTML } from "../../utils/menuGenerator.js";
import MenuLayoutCanvas from "./MenuLayoutCanvas.jsx";

// ── DragOverlay card (used during active drag) ────────────────────────────────

function DragOverlayCard({ block, menuCourses }) {
  if (!block) return null;
  const cfg = BLOCK_TYPES[block.type] || {};
  let label = cfg.label || block.type;
  if (block.type === "course") {
    const c = menuCourses.find(mc => mc.course_key === block.courseKey);
    label = c?.menu?.name || block.courseKey || "(course)";
  } else if (block.type === "spacer") {
    label = `Spacer — ${SPACER_SIZES[block.size || "md"]?.label || "md"}`;
  } else if (block.text) {
    label = block.text;
  }
  return (
    <div style={{
      background: cfg.bg || "#f8f8f8",
      borderLeft: `4px solid ${cfg.color || "#888"}`,
      borderRadius: 6, padding: "10px 14px",
      display: "flex", alignItems: "center", gap: 10,
      boxShadow: "0 8px 28px rgba(0,0,0,0.18)",
      cursor: "grabbing", userSelect: "none", minWidth: 180,
    }}>
      <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, color: cfg.color, background: "rgba(0,0,0,0.06)", borderRadius: 3, padding: "2px 5px", flexShrink: 0, textTransform: "uppercase" }}>
        {cfg.icon} {cfg.label}
      </div>
      <div style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: "#1a1a1a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </div>
    </div>
  );
}

// ── PaletteSection — block type buttons to add to zones ──────────────────────

function PaletteSection({ title, types, onAddLeft, onAddRight }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 8 }}>
        {title}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {types.map(type => {
          const cfg = BLOCK_TYPES[type];
          const canLeft  = cfg.zone === "left"  || cfg.zone === "both";
          const canRight = cfg.zone === "right" || cfg.zone === "both";
          return (
            <div key={type} style={{
              background: cfg.bg,
              borderLeft: `3px solid ${cfg.color}`,
              borderRadius: 4, padding: "7px 10px",
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <span style={{ fontFamily: FONT, fontSize: 10, color: cfg.color, flex: 1, fontWeight: 600 }}>
                {cfg.icon} {cfg.label}
              </span>
              <div style={{ display: "flex", gap: 3 }}>
                {canLeft && (
                  <button
                    onClick={() => onAddLeft(type)}
                    title="Add to Left Column"
                    style={{
                      fontFamily: FONT, fontSize: 8, letterSpacing: 0.5,
                      padding: "3px 7px", border: `1px solid ${cfg.color}44`,
                      borderRadius: 3, cursor: "pointer",
                      background: "#fff", color: cfg.color,
                    }}
                  >← L</button>
                )}
                {canRight && (
                  <button
                    onClick={() => onAddRight(type)}
                    title="Add to Right Column"
                    style={{
                      fontFamily: FONT, fontSize: 8, letterSpacing: 0.5,
                      padding: "3px 7px", border: `1px solid ${cfg.color}44`,
                      borderRadius: 3, cursor: "pointer",
                      background: "#fff", color: cfg.color,
                    }}
                  >R →</button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── BlockConfigPanel — edit selected block properties ────────────────────────

function BlockConfigPanel({ block, menuCourses, onUpdate, onClose }) {
  if (!block) {
    return (
      <div style={{
        padding: "24px 16px", textAlign: "center",
        color: "#ccc", fontFamily: FONT, fontSize: 10, letterSpacing: 1,
        border: "1px dashed #e8e8e8", borderRadius: 8,
      }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>⚙</div>
        Select a block to configure it
      </div>
    );
  }

  const cfg = BLOCK_TYPES[block.type] || {};
  const inpSm = { ...baseInp, padding: "6px 10px", fontSize: 11 };
  const labelSm = { fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#999", textTransform: "uppercase", marginBottom: 4 };

  return (
    <div style={{
      border: `1px solid ${cfg.color}33`,
      borderTop: `3px solid ${cfg.color}`,
      borderRadius: 8,
      padding: "16px",
      background: "#fff",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: cfg.bg, border: `1px solid ${cfg.color}44`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontFamily: FONT, fontSize: 14, color: cfg.color,
        }}>{cfg.icon}</div>
        <div>
          <div style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: cfg.color }}>{cfg.label}</div>
          <div style={{ fontFamily: FONT, fontSize: 8, color: "#bbb", letterSpacing: 1, textTransform: "uppercase" }}>block config</div>
        </div>
        <button onClick={onClose} style={{
          marginLeft: "auto", background: "none", border: "none",
          cursor: "pointer", color: "#ccc", fontSize: 16,
        }}>×</button>
      </div>

      {/* Course block */}
      {block.type === "course" && (
        <div>
          <div style={labelSm}>Course</div>
          <select
            value={block.courseKey || ""}
            onChange={e => onUpdate({ ...block, courseKey: e.target.value })}
            style={{ ...inpSm, cursor: "pointer" }}
          >
            <option value="">(select a course)</option>
            {menuCourses.map(c => (
              <option key={c.course_key || c.position} value={c.course_key || ""}>
                {c.menu?.name || "(unnamed)"}{c.course_key ? ` [${c.course_key}]` : ""}
              </option>
            ))}
          </select>
          {block.courseKey && (
            <div style={{ marginTop: 8, padding: "8px 10px", background: "#f8f8f8", borderRadius: 4 }}>
              {(() => {
                const c = menuCourses.find(mc => mc.course_key === block.courseKey);
                if (!c) return <span style={{ fontFamily: FONT, fontSize: 9, color: "#ccc" }}>Course not found in data</span>;
                return (
                  <>
                    <div style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, color: "#1a1a1a" }}>{c.menu?.name}</div>
                    {c.menu?.sub && <div style={{ fontFamily: FONT, fontSize: 9, color: "#888" }}>{c.menu.sub}</div>}
                    <div style={{ fontFamily: FONT, fontSize: 8, color: "#aaa", marginTop: 4 }}>
                      key: {c.course_key} · pos: {c.position}
                      {c.is_snack ? " · snack" : ""}
                      {c.section_gap_before ? " · gap before" : ""}
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      )}

      {/* Spacer block */}
      {block.type === "spacer" && (
        <div>
          <div style={labelSm}>Spacing size</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {Object.entries(SPACER_SIZES).map(([key, { label }]) => (
              <button
                key={key}
                onClick={() => onUpdate({ ...block, size: key })}
                style={{
                  fontFamily: FONT, fontSize: 10, padding: "8px",
                  border: `1px solid ${(block.size || "md") === key ? cfg.color : "#e8e8e8"}`,
                  borderRadius: 4, cursor: "pointer",
                  background: (block.size || "md") === key ? cfg.bg : "#fff",
                  color: (block.size || "md") === key ? cfg.color : "#888",
                  fontWeight: (block.size || "md") === key ? 700 : 400,
                }}
              >{label}</button>
            ))}
          </div>
          <div style={{ fontFamily: FONT, fontSize: 9, color: "#bbb", marginTop: 8 }}>
            Spacer before a course sets section_gap_before on that course.
          </div>
        </div>
      )}

      {/* Heading block */}
      {block.type === "heading" && (
        <div>
          <div style={labelSm}>Heading text</div>
          <input
            value={block.text || ""}
            onChange={e => onUpdate({ ...block, text: e.target.value })}
            placeholder="Section heading..."
            style={inpSm}
          />
        </div>
      )}

      {/* Divider block */}
      {block.type === "divider" && (
        <div>
          <div style={labelSm}>Label (optional)</div>
          <input
            value={block.text || ""}
            onChange={e => onUpdate({ ...block, text: e.target.value })}
            placeholder="Optional divider label..."
            style={inpSm}
          />
          <div style={{ fontFamily: FONT, fontSize: 9, color: "#bbb", marginTop: 8 }}>
            Leave empty for a plain separator line.
          </div>
        </div>
      )}

      {/* Pairing block */}
      {block.type === "pairing" && (
        <div>
          <div style={labelSm}>Section label</div>
          <input
            value={block.text || ""}
            onChange={e => onUpdate({ ...block, text: e.target.value })}
            placeholder="e.g. Wine / Pairing"
            style={inpSm}
          />
          <div style={{ fontFamily: FONT, fontSize: 9, color: "#bbb", marginTop: 8, lineHeight: 1.5 }}>
            Pairing type (wp / na / os / premium) is selected per seat during service.
            This block marks where the pairing section renders on the right column.
          </div>
        </div>
      )}

      {/* By the Glass block */}
      {block.type === "byGlass" && (
        <div style={{ fontFamily: FONT, fontSize: 10, color: "#888", lineHeight: 1.6 }}>
          By-the-glass wines are pulled automatically from the seat&apos;s glass selections,
          starting from the Danube Salmon course onwards.
          <br /><br />
          No additional configuration needed.
        </div>
      )}

      {/* Quick Access block */}
      {block.type === "quickAccess" && (
        <div style={{ fontFamily: FONT, fontSize: 10, color: "#888", lineHeight: 1.6 }}>
          Quick access / aperitif buttons are driven by the
          <strong style={{ color: "#7a6e9e" }}> Admin → Quick Access</strong> panel.
          <br /><br />
          This block controls where quick access items appear in the layout.
          Placement and enabled state is managed separately.
        </div>
      )}
    </div>
  );
}

// ── PrintSettingsPanel — embedded compact print config ────────────────────────

const PRINT_GROUPS = [
  { label: "PAGE", props: [
    { key: "padTop",    label: "Top",    def: 8.4,  step: 0.5,  unit: "mm" },
    { key: "padBottom", label: "Bottom", def: 8.2,  step: 0.5,  unit: "mm" },
    { key: "padLeft",   label: "Left",   def: 12,   step: 0.5,  unit: "mm" },
    { key: "padRight",  label: "Right",  def: 12,   step: 0.5,  unit: "mm" },
  ]},
  { label: "TYPE", props: [
    { key: "fontSize",      label: "Size",      def: 6.75, step: 0.05, unit: "pt" },
    { key: "headerSpacing", label: "Hdr gap",   def: 7,    step: 0.5,  unit: "mm" },
  ]},
  { label: "GAPS", props: [
    { key: "rowSpacing",     label: "Row",     def: 3.15, step: 0.25, unit: "pt" },
    { key: "wineRowSpacing", label: "Wine row",def: 4.5,  step: 0.25, unit: "pt" },
    { key: "sectionSpacing", label: "Section", def: 6.8,  step: 0.5,  unit: "pt" },
  ]},
];

function PrintSettingsPanel({ globalLayout, onSetGlobalLayout, onSaveGlobalLayout, layoutSaving, layoutSaved }) {
  const [open, setOpen] = useState(false);
  if (!onSetGlobalLayout) return null;

  const adjust = (key, def, step) => (dir) => {
    onSetGlobalLayout(prev => {
      const cur = key in prev ? prev[key] : def;
      return { ...prev, [key]: Math.round((cur + dir * step) * 1000) / 1000 };
    });
  };

  const btnSt = {
    fontFamily: FONT, fontSize: 10, width: 18, height: 18,
    border: "1px solid #e0e0e0", borderRadius: 2, cursor: "pointer",
    background: "#fafafa", color: "#555",
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0, padding: 0,
  };

  return (
    <div style={{ marginTop: 16, borderTop: "1px solid #f0f0f0", paddingTop: 12 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", gap: 6, width: "100%",
          background: "none", border: "none", cursor: "pointer", padding: 0,
        }}
      >
        <span style={{ fontFamily: FONT, fontSize: 7.5, letterSpacing: 2, color: "#bbb", textTransform: "uppercase" }}>
          {open ? "▾" : "▸"} Print Settings
        </span>
        {onSaveGlobalLayout && (
          <button
            onClick={e => { e.stopPropagation(); onSaveGlobalLayout(); }}
            disabled={layoutSaving}
            style={{
              marginLeft: "auto", fontFamily: FONT, fontSize: 7, letterSpacing: 1,
              padding: "2px 8px", border: `1px solid ${layoutSaved ? "#4a9a6a" : "#ccc"}`,
              borderRadius: 2, cursor: layoutSaving ? "default" : "pointer",
              background: layoutSaved ? "#4a9a6a" : "#fff",
              color: layoutSaved ? "#fff" : "#888",
            }}
          >{layoutSaved ? "SAVED" : "SAVE"}</button>
        )}
      </button>

      {open && (
        <div style={{ marginTop: 10 }}>
          {PRINT_GROUPS.map(group => (
            <div key={group.label} style={{ marginBottom: 8 }}>
              <div style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 2, color: "#ccc", textTransform: "uppercase", marginBottom: 4 }}>
                {group.label}
              </div>
              {group.props.map(({ key, label, def, step, unit }) => {
                const val = key in (globalLayout || {}) ? globalLayout[key] : def;
                const isCustom = key in (globalLayout || {});
                return (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 3, marginBottom: 2 }}>
                    <span style={{ fontFamily: FONT, fontSize: 7.5, color: "#aaa", flex: "0 0 58px", whiteSpace: "nowrap" }}>{label}</span>
                    <button style={btnSt} onClick={() => adjust(key, def, step)(-1)}>-</button>
                    <span style={{ fontFamily: FONT, fontSize: 7.5, minWidth: 40, textAlign: "center", color: isCustom ? "#8a5020" : "#bbb", fontWeight: isCustom ? 700 : 400 }}>{val}{unit}</span>
                    <button style={btnSt} onClick={() => adjust(key, def, step)(+1)}>+</button>
                  </div>
                );
              })}
            </div>
          ))}
          <div style={{ fontFamily: FONT, fontSize: 7, color: "#ccc", marginTop: 6, lineHeight: 1.5 }}>
            These settings control PDF margins, font size, and row spacing. Defaults are production-tuned.
          </div>
        </div>
      )}
    </div>
  );
}

// ── MenuLayoutBuilder (main component) ───────────────────────────────────────

export default function MenuLayoutBuilder({
  visualLayout,
  menuCourses = [],
  onUpdateLayout,
  onSaveLayout,
  saving = false,
  saved  = false,
  // Print settings (optional — embedded panel)
  globalLayout,
  onSetGlobalLayout,
  onSaveGlobalLayout,
  layoutSaving,
  layoutSaved,
  logoDataUri = "",
}) {
  // ── Local column state — synced from prop on mount / external change ──────
  const [leftColumn,  setLeftColumn]  = useState(() => visualLayout?.leftColumn  || []);
  const [rightColumn, setRightColumn] = useState(() => visualLayout?.rightColumn || []);
  const [activeBlock, setActiveBlock] = useState(null);
  const [selectedId,  setSelectedId]  = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (visualLayout?.leftColumn)  setLeftColumn(visualLayout.leftColumn);
    if (visualLayout?.rightColumn) setRightColumn(visualLayout.rightColumn);
  }, [visualLayout]);

  // ── Propagate changes up ─────────────────────────────────────────────────
  const propagate = useCallback((left, right) => {
    onUpdateLayout({ leftColumn: left, rightColumn: right });
  }, [onUpdateLayout]);

  // ── DnD ──────────────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findContainer = useCallback((id) => {
    if (id === "leftColumn" || id === "rightColumn") return id;
    if (leftColumn.some(b => b.id === id))  return "leftColumn";
    if (rightColumn.some(b => b.id === id)) return "rightColumn";
    return null;
  }, [leftColumn, rightColumn]);

  const onDragStart = ({ active }) => {
    const all = [...leftColumn, ...rightColumn];
    setActiveBlock(all.find(b => b.id === active.id) || null);
  };

  const onDragOver = ({ active, over }) => {
    if (!over) return;
    const ac = findContainer(active.id);
    const oc = findContainer(over.id);
    if (!ac || !oc || ac === oc) return;

    const src  = ac === "leftColumn" ? leftColumn : rightColumn;
    const dest = oc === "leftColumn" ? leftColumn : rightColumn;
    const ai   = src.findIndex(b => b.id === active.id);
    const block = src[ai];
    if (!block) return;

    const oi  = dest.findIndex(b => b.id === over.id);
    const at  = oi >= 0 ? oi : dest.length;

    const newSrc  = src.filter(b => b.id !== active.id);
    const newDest = [...dest.slice(0, at), block, ...dest.slice(at)];

    if (ac === "leftColumn") {
      setLeftColumn(newSrc); setRightColumn(newDest);
      propagate(newSrc, newDest);
    } else {
      setRightColumn(newSrc); setLeftColumn(newDest);
      propagate(newDest, newSrc);
    }
  };

  const onDragEnd = ({ active, over }) => {
    setActiveBlock(null);
    if (!over) return;
    const ac = findContainer(active.id);
    const oc = findContainer(over.id);
    if (!ac || !oc || ac !== oc) return;

    const items = ac === "leftColumn" ? leftColumn : rightColumn;
    const oi    = items.findIndex(b => b.id === active.id);
    const ni    = items.findIndex(b => b.id === over.id);
    if (oi === ni) return;

    const reordered = arrayMove(items, oi, ni);
    if (ac === "leftColumn") { setLeftColumn(reordered); propagate(reordered, rightColumn); }
    else                     { setRightColumn(reordered); propagate(leftColumn, reordered); }
  };

  // ── Block mutations ───────────────────────────────────────────────────────
  const addToLeft = (type) => {
    const block = { id: makeBlockId(type), type, ...(type === "spacer" ? { size: "md" } : {}) };
    const next = [...leftColumn, block];
    setLeftColumn(next); propagate(next, rightColumn); setSelectedId(block.id);
  };

  const addToRight = (type) => {
    const block = { id: makeBlockId(type), type };
    const next = [...rightColumn, block];
    setRightColumn(next); propagate(leftColumn, next); setSelectedId(block.id);
  };

  const removeBlock = (id) => {
    const inLeft = leftColumn.some(b => b.id === id);
    if (inLeft) {
      const next = leftColumn.filter(b => b.id !== id);
      setLeftColumn(next); propagate(next, rightColumn);
    } else {
      const next = rightColumn.filter(b => b.id !== id);
      setRightColumn(next); propagate(leftColumn, next);
    }
    if (selectedId === id) setSelectedId(null);
  };

  const updateBlock = (updated) => {
    const inLeft = leftColumn.some(b => b.id === updated.id);
    if (inLeft) {
      const next = leftColumn.map(b => b.id === updated.id ? updated : b);
      setLeftColumn(next); propagate(next, rightColumn);
    } else {
      const next = rightColumn.map(b => b.id === updated.id ? updated : b);
      setRightColumn(next); propagate(leftColumn, next);
    }
  };

  const selectedBlock = [...leftColumn, ...rightColumn].find(b => b.id === selectedId) || null;

  // ── Live preview HTML (computed from current state) ───────────────────────
  const previewHtml = useMemo(() => {
    if (!showPreview || !menuCourses.length) return "";
    try {
      const dummySeat = { id: 1, pairing: "Wine", extras: {}, glasses: [], cocktails: [], beers: [] };
      return generateMenuHTML({
        seat: dummySeat,
        table: { menuType: "", restrictions: [], bottleWines: [], birthday: false },
        menuTitle: "WINTER MENU",
        teamNames: "",
        menuCourses,
        lang: "en",
        thankYouNote: "",
        layoutStyles: globalLayout || {},
        _logo: logoDataUri || "",
      });
    } catch (e) {
      return `<html><body style="font-family:monospace;padding:20px;color:#c04040">Preview error: ${e.message}</body></html>`;
    }
  }, [showPreview, menuCourses, globalLayout, logoDataUri]);

  return (
    <div style={{ fontFamily: FONT }}>
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid #f0f0f0",
      }}>
        <div>
          <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: "#1a1a1a", letterSpacing: 0.5 }}>
            Menu Layout Builder
          </div>
          <div style={{ fontFamily: FONT, fontSize: 9, color: "#aaa", letterSpacing: 1, marginTop: 2 }}>
            SINGLE SOURCE OF TRUTH · DRAG IN CANVAS · CLICK BLOCK TO CONFIGURE · SAVE APPLIES ORDER
          </div>
        </div>
        <button
          onClick={onSaveLayout}
          disabled={saving}
          style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "8px 20px",
            border: `1px solid ${saved ? "#4a9a6a" : "#4b4b88"}`,
            borderRadius: 4, cursor: saving ? "default" : "pointer",
            background: saved ? "#4a9a6a" : "#4b4b88", color: "#fff", fontWeight: 600,
          }}
        >
          {saving ? "SAVING..." : saved ? "✓ SAVED" : "SAVE LAYOUT"}
        </button>
      </div>

      {/* ── Three-panel layout ───────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "190px 1fr 270px", gap: 20, alignItems: "start" }}>

        {/* ── Left: Block palette ───────────────────────────────────────── */}
        <div style={{
          background: "#fafafa", border: "1px solid #f0f0f0",
          borderRadius: 8, padding: "14px 12px",
          position: "sticky", top: 20,
        }}>
          <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#999", textTransform: "uppercase", marginBottom: 14 }}>
            Block Palette
          </div>

          <PaletteSection
            title="Left column"
            types={["course", "spacer", "heading", "divider"]}
            onAddLeft={addToLeft}
            onAddRight={addToRight}
          />
          <PaletteSection
            title="Right column"
            types={["pairing", "byGlass", "quickAccess"]}
            onAddLeft={addToLeft}
            onAddRight={addToRight}
          />
          <PaletteSection
            title="Both zones"
            types={["divider", "heading"]}
            onAddLeft={addToLeft}
            onAddRight={addToRight}
          />

          <div style={{
            marginTop: 12, padding: "10px", background: "#fff",
            border: "1px solid #f0f0f0", borderRadius: 6,
            fontFamily: FONT, fontSize: 8, color: "#bbb", lineHeight: 1.6,
          }}>
            ← L adds to left column
            <br />R → adds to right column
            <br />Drag blocks in the canvas to reorder
          </div>
        </div>

        {/* ── Center: WYSIWYG canvas ────────────────────────────────────── */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          <MenuLayoutCanvas
            leftColumn={leftColumn}
            rightColumn={rightColumn}
            menuCourses={menuCourses}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onRemove={removeBlock}
          />

          <DragOverlay dropAnimation={{ duration: 150, easing: "cubic-bezier(0.18,0.67,0.6,1.22)" }}>
            <DragOverlayCard block={activeBlock} menuCourses={menuCourses} />
          </DragOverlay>
        </DndContext>

        {/* ── Right: Inspector + preview + print settings ───────────────── */}
        <div style={{ position: "sticky", top: 20 }}>
          {/* Config panel */}
          <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#999", textTransform: "uppercase", marginBottom: 10 }}>
            Configure Block
          </div>
          <BlockConfigPanel
            block={selectedBlock}
            menuCourses={menuCourses}
            onUpdate={updateBlock}
            onClose={() => setSelectedId(null)}
          />

          {/* Layout summary */}
          <div style={{ marginTop: 14, padding: "10px 12px", background: "#fafafa", border: "1px solid #f0f0f0", borderRadius: 8 }}>
            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 8 }}>
              Layout Summary
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {[
                { label: "Course blocks",  val: leftColumn.filter(b => b.type === "course").length,       color: "#4b4b88" },
                { label: "Spacers",        val: leftColumn.filter(b => b.type === "spacer").length,       color: "#999" },
                { label: "Pairing blocks", val: rightColumn.filter(b => b.type === "pairing").length,     color: "#c8a06e" },
                { label: "By-Glass",       val: rightColumn.filter(b => b.type === "byGlass").length,     color: "#5a9e6e" },
                { label: "Quick Access",   val: rightColumn.filter(b => b.type === "quickAccess").length, color: "#7a6e9e" },
                { label: "Total courses",  val: menuCourses.length,                                       color: "#888" },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontFamily: FONT, fontSize: 9, color: "#888" }}>{label}</span>
                  <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color }}>{val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Live preview toggle */}
          <div style={{ marginTop: 14, borderTop: "1px solid #f0f0f0", paddingTop: 12 }}>
            <button
              onClick={() => setShowPreview(p => !p)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "none", border: "none", cursor: "pointer", padding: 0,
              }}
            >
              <span style={{ fontFamily: FONT, fontSize: 7.5, letterSpacing: 2, color: "#bbb", textTransform: "uppercase" }}>
                {showPreview ? "▾" : "▸"} Live Preview
              </span>
              {showPreview && menuCourses.length === 0 && (
                <span style={{ fontFamily: FONT, fontSize: 7, color: "#e8b060" }}>no courses</span>
              )}
            </button>

            {showPreview && menuCourses.length > 0 && (
              <div style={{ marginTop: 10, overflow: "hidden" }}>
                {(() => {
                  const A5W = 559, A5H = 793;
                  const containerW = 246;
                  const scale = containerW / A5W;
                  const containerH = Math.round(A5H * scale);
                  return (
                    <div style={{
                      width: containerW, height: containerH,
                      border: "1px solid #e8e4dc", borderRadius: 4,
                      overflow: "hidden", background: "#fff",
                    }}>
                      <iframe
                        srcDoc={previewHtml}
                        title="menu preview"
                        style={{
                          width: A5W, height: A5H, border: "none",
                          transform: `scale(${scale})`,
                          transformOrigin: "top left",
                          pointerEvents: "none",
                        }}
                      />
                    </div>
                  );
                })()}
                <div style={{ fontFamily: FONT, fontSize: 7, color: "#c0bcb4", marginTop: 4, textAlign: "center" }}>
                  A5 preview — save to apply ordering
                </div>
              </div>
            )}
          </div>

          {/* Embedded print settings */}
          <PrintSettingsPanel
            globalLayout={globalLayout}
            onSetGlobalLayout={onSetGlobalLayout}
            onSaveGlobalLayout={onSaveGlobalLayout}
            layoutSaving={layoutSaving}
            layoutSaved={layoutSaved}
          />
        </div>

      </div>
    </div>
  );
}
