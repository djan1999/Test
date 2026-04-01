/**
 * MenuLayoutBuilder — visual drag-and-drop layout composition tool.
 *
 * Two-zone canvas (Left Column / Right Column) backed by @dnd-kit/sortable.
 * A block palette lets users add blocks; placed blocks are sortable within
 * their zone and can be dragged across zones.  A config panel appears on the
 * right when a block is selected.
 */

import { useState, useCallback, useEffect } from "react";
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
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useDroppable } from "@dnd-kit/core";
import { FONT, baseInp } from "./adminStyles.js";
import { BLOCK_TYPES, SPACER_SIZES, makeBlockId } from "../../utils/visualLayout.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function blockLabel(block, menuCourses) {
  if (block.type === "course") {
    const c = menuCourses.find(mc => mc.course_key === block.courseKey);
    return c?.menu?.name || block.courseKey || "(no course selected)";
  }
  if (block.type === "spacer") return `Spacer — ${SPACER_SIZES[block.size || "md"]?.label || "md"}`;
  if (block.type === "heading" || block.type === "divider") return block.text || `(${block.type})`;
  if (block.type === "pairing") return block.text || "Pairing (auto)";
  return BLOCK_TYPES[block.type]?.label || block.type;
}

function blockSubLabel(block, menuCourses) {
  if (block.type === "course") {
    const c = menuCourses.find(mc => mc.course_key === block.courseKey);
    const sub = c?.menu?.sub || "";
    return [c?.course_key && `key: ${c.course_key}`, sub && sub.slice(0, 40)].filter(Boolean).join(" · ") || "";
  }
  if (block.type === "pairing")     return "wine/non-alc/premium · per seat selection";
  if (block.type === "byGlass")     return "pulled from seat · by-the-glass queue";
  if (block.type === "quickAccess") return "aperitif buttons · quick access config";
  return "";
}

// ── SortableBlock — a block card that lives in a zone ────────────────────────

function SortableBlock({ block, menuCourses, isSelected, onSelect, onRemove }) {
  const {
    attributes, listeners, setNodeRef,
    transform, transition, isDragging,
  } = useSortable({ id: block.id });

  const cfg = BLOCK_TYPES[block.type] || {};
  const label   = blockLabel(block, menuCourses);
  const subLabel = blockSubLabel(block, menuCourses);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <BlockCard
        block={block}
        label={label}
        subLabel={subLabel}
        cfg={cfg}
        isSelected={isSelected}
        onSelect={() => onSelect(block.id)}
        onRemove={() => onRemove(block.id)}
        dragProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

// ── BlockCard — the visual card (also used inside DragOverlay) ────────────────

function BlockCard({ block, label, subLabel, cfg, isSelected, onSelect, onRemove, dragProps = {}, isOverlay = false }) {
  const accentColor = cfg.color || "#888";
  const bgColor = isSelected ? accentColor : (cfg.bg || "#f8f8f8");
  const textColor = isSelected ? "#fff" : "#1a1a1a";
  const subColor  = isSelected ? "rgba(255,255,255,0.65)" : "#888";

  return (
    <div
      style={{
        background: bgColor,
        border: `2px solid ${isSelected ? accentColor : "transparent"}`,
        borderLeft: `4px solid ${accentColor}`,
        borderRadius: 6,
        padding: "9px 10px 9px 12px",
        marginBottom: 6,
        display: "flex",
        alignItems: "center",
        gap: 10,
        cursor: isOverlay ? "grabbing" : "default",
        boxShadow: isOverlay ? "0 8px 24px rgba(0,0,0,0.18)" : isSelected ? "0 2px 8px rgba(0,0,0,0.12)" : "none",
        userSelect: "none",
      }}
    >
      {/* Drag handle */}
      <div
        {...dragProps}
        style={{
          cursor: "grab",
          color: isSelected ? "rgba(255,255,255,0.5)" : "#bbb",
          fontSize: 16,
          lineHeight: 1,
          flexShrink: 0,
          touchAction: "none",
          padding: "2px 0",
        }}
        title="Drag to reorder"
      >
        ⠿
      </div>

      {/* Type badge */}
      <div style={{
        fontFamily: FONT, fontSize: 9, letterSpacing: 1,
        color: isSelected ? "rgba(255,255,255,0.7)" : accentColor,
        background: isSelected ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.04)",
        border: `1px solid ${isSelected ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.08)"}`,
        borderRadius: 3, padding: "2px 5px",
        flexShrink: 0, textTransform: "uppercase",
      }}>{cfg.icon || "·"} {cfg.label || block.type}</div>

      {/* Labels */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: FONT, fontSize: 11, fontWeight: 700,
          color: textColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{label}</div>
        {subLabel && (
          <div style={{
            fontFamily: FONT, fontSize: 9, color: subColor,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            marginTop: 1,
          }}>{subLabel}</div>
        )}
      </div>

      {/* Select / remove buttons */}
      {!isOverlay && (
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          <button
            onClick={e => { e.stopPropagation(); onSelect && onSelect(); }}
            title="Configure"
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: isSelected ? "rgba(255,255,255,0.8)" : "#aaa",
              fontSize: 14, padding: "2px 4px", lineHeight: 1,
            }}
          >⚙</button>
          <button
            onClick={e => { e.stopPropagation(); onRemove && onRemove(); }}
            title="Remove block"
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: isSelected ? "rgba(255,255,255,0.7)" : "#ccc",
              fontSize: 15, padding: "2px 4px", lineHeight: 1,
            }}
          >×</button>
        </div>
      )}
    </div>
  );
}

// ── DropZone — a column that accepts dropped blocks ───────────────────────────

function DropZone({ id, items, menuCourses, selectedId, onSelect, onRemove, label, accentColor, emptyHint }) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
      {/* Zone header */}
      <div style={{
        fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: accentColor,
        textTransform: "uppercase", fontWeight: 700, marginBottom: 10,
        paddingBottom: 8, borderBottom: `2px solid ${accentColor}22`,
        display: "flex", alignItems: "center", gap: 6,
      }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: accentColor, display: "inline-block" }} />
        {label}
        <span style={{ marginLeft: "auto", fontWeight: 400, color: "#bbb", fontSize: 8 }}>
          {items.length} block{items.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Sortable list */}
      <SortableContext items={items.map(b => b.id)} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          style={{
            flex: 1,
            minHeight: 100,
            padding: items.length === 0 ? "0" : "0",
            background: isOver ? "#f8f8ff" : "transparent",
            borderRadius: 8,
            transition: "background 0.15s",
          }}
        >
          {items.map(block => (
            <SortableBlock
              key={block.id}
              block={block}
              menuCourses={menuCourses}
              isSelected={selectedId === block.id}
              onSelect={onSelect}
              onRemove={onRemove}
            />
          ))}

          {items.length === 0 && (
            <div style={{
              border: `2px dashed ${isOver ? accentColor : "#ddd"}`,
              borderRadius: 8,
              padding: "28px 16px",
              textAlign: "center",
              color: isOver ? accentColor : "#ccc",
              fontFamily: FONT, fontSize: 10, letterSpacing: 1,
              transition: "all 0.15s",
            }}>
              {emptyHint}
            </div>
          )}
        </div>
      </SortableContext>
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

// ── MenuLayoutBuilder (main component) ───────────────────────────────────────

export default function MenuLayoutBuilder({
  visualLayout,
  menuCourses = [],
  onUpdateLayout,
  onSaveLayout,
  saving = false,
  saved  = false,
}) {
  // Local column state — synced from prop on mount / external change
  const [leftColumn,  setLeftColumn]  = useState(() => visualLayout?.leftColumn  || []);
  const [rightColumn, setRightColumn] = useState(() => visualLayout?.rightColumn || []);
  const [activeBlock,   setActiveBlock]   = useState(null);
  const [selectedId,    setSelectedId]    = useState(null);

  // Sync from parent when prop changes externally (e.g. after load from Supabase)
  useEffect(() => {
    if (visualLayout?.leftColumn)  setLeftColumn(visualLayout.leftColumn);
    if (visualLayout?.rightColumn) setRightColumn(visualLayout.rightColumn);
  }, [visualLayout]);

  // Propagate local changes up
  const propagate = useCallback((left, right) => {
    onUpdateLayout({ leftColumn: left, rightColumn: right });
  }, [onUpdateLayout]);

  const setLeft = useCallback((fn) => {
    setLeftColumn(prev => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      propagate(next, rightColumn);
      return next;
    });
  }, [rightColumn, propagate]);

  const setRight = useCallback((fn) => {
    setRightColumn(prev => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      propagate(leftColumn, next);
      return next;
    });
  }, [leftColumn, propagate]);

  // ── DnD sensors ──────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ── Container resolution ─────────────────────────────────────────────────
  const findContainer = useCallback((id) => {
    if (id === "leftColumn" || id === "rightColumn") return id;
    if (leftColumn.some(b => b.id === id))  return "leftColumn";
    if (rightColumn.some(b => b.id === id)) return "rightColumn";
    return null;
  }, [leftColumn, rightColumn]);

  // ── Drag handlers ─────────────────────────────────────────────────────────
  const onDragStart = ({ active }) => {
    const all = [...leftColumn, ...rightColumn];
    setActiveBlock(all.find(b => b.id === active.id) || null);
  };

  const onDragOver = ({ active, over }) => {
    if (!over) return;
    const activeContainer = findContainer(active.id);
    const overContainer   = findContainer(over.id);
    if (!activeContainer || !overContainer || activeContainer === overContainer) return;

    const sourceItems = activeContainer === "leftColumn" ? leftColumn : rightColumn;
    const destItems   = overContainer   === "leftColumn" ? leftColumn : rightColumn;
    const activeIdx   = sourceItems.findIndex(b => b.id === active.id);
    const block       = sourceItems[activeIdx];
    if (!block) return;

    const overIdx  = destItems.findIndex(b => b.id === over.id);
    const insertAt = overIdx >= 0 ? overIdx : destItems.length;

    const newSource = sourceItems.filter(b => b.id !== active.id);
    const newDest   = [
      ...destItems.slice(0, insertAt),
      block,
      ...destItems.slice(insertAt),
    ];

    if (activeContainer === "leftColumn") {
      setLeftColumn(newSource);
      setRightColumn(newDest);
      propagate(newSource, newDest);
    } else {
      setRightColumn(newSource);
      setLeftColumn(newDest);
      propagate(newDest, newSource);
    }
  };

  const onDragEnd = ({ active, over }) => {
    setActiveBlock(null);
    if (!over) return;

    const activeContainer = findContainer(active.id);
    const overContainer   = findContainer(over.id);
    if (!activeContainer || !overContainer || activeContainer !== overContainer) return;

    const items    = activeContainer === "leftColumn" ? leftColumn : rightColumn;
    const oldIndex = items.findIndex(b => b.id === active.id);
    const newIndex = items.findIndex(b => b.id === over.id);
    if (oldIndex === newIndex) return;

    const reordered = arrayMove(items, oldIndex, newIndex);
    if (activeContainer === "leftColumn") {
      setLeftColumn(reordered);
      propagate(reordered, rightColumn);
    } else {
      setRightColumn(reordered);
      propagate(leftColumn, reordered);
    }
  };

  // ── Block mutations ───────────────────────────────────────────────────────
  const addToLeft = (type) => {
    const block = { id: makeBlockId(type), type, ...(type === "spacer" ? { size: "md" } : {}) };
    const next = [...leftColumn, block];
    setLeftColumn(next);
    propagate(next, rightColumn);
    setSelectedId(block.id);
  };

  const addToRight = (type) => {
    const block = { id: makeBlockId(type), type };
    const next = [...rightColumn, block];
    setRightColumn(next);
    propagate(leftColumn, next);
    setSelectedId(block.id);
  };

  const removeBlock = (id) => {
    const inLeft = leftColumn.some(b => b.id === id);
    if (inLeft) {
      const next = leftColumn.filter(b => b.id !== id);
      setLeftColumn(next);
      propagate(next, rightColumn);
    } else {
      const next = rightColumn.filter(b => b.id !== id);
      setRightColumn(next);
      propagate(leftColumn, next);
    }
    if (selectedId === id) setSelectedId(null);
  };

  const updateBlock = (updated) => {
    const inLeft = leftColumn.some(b => b.id === updated.id);
    if (inLeft) {
      const next = leftColumn.map(b => b.id === updated.id ? updated : b);
      setLeftColumn(next);
      propagate(next, rightColumn);
    } else {
      const next = rightColumn.map(b => b.id === updated.id ? updated : b);
      setRightColumn(next);
      propagate(leftColumn, next);
    }
  };

  const selectedBlock = [...leftColumn, ...rightColumn].find(b => b.id === selectedId) || null;

  // ── Active drag overlay data ──────────────────────────────────────────────
  const overlayBlock = activeBlock || null;
  const overlayCfg   = overlayBlock ? (BLOCK_TYPES[overlayBlock.type] || {}) : {};
  const overlayLabel = overlayBlock ? blockLabel(overlayBlock, menuCourses) : "";

  return (
    <div style={{ fontFamily: FONT }}>
      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 20, paddingBottom: 16, borderBottom: "1px solid #f0f0f0",
      }}>
        <div>
          <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: "#1a1a1a", letterSpacing: 0.5 }}>
            Menu Layout Builder
          </div>
          <div style={{ fontFamily: FONT, fontSize: 9, color: "#aaa", letterSpacing: 1, marginTop: 2 }}>
            DRAG TO REORDER · CLICK ⚙ TO CONFIGURE · SAVE APPLIES ORDERING TO COURSES
          </div>
        </div>
        <button
          onClick={onSaveLayout}
          disabled={saving}
          style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "8px 20px",
            border: `1px solid ${saved ? "#4a9a6a" : "#4b4b88"}`,
            borderRadius: 4, cursor: saving ? "default" : "pointer",
            background: saved ? "#4a9a6a" : "#4b4b88", color: "#fff",
            fontWeight: 600,
          }}
        >
          {saving ? "SAVING..." : saved ? "✓ SAVED" : "SAVE LAYOUT"}
        </button>
      </div>

      {/* Three-panel layout */}
      <div style={{ display: "grid", gridTemplateColumns: "190px 1fr 260px", gap: 20, alignItems: "start" }}>

        {/* ── Left: Block palette ────────────────────────────────────────── */}
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
            types={["course", "spacer", "divider", "heading"]}
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
            <br />Drag blocks to reorder or move between zones
          </div>
        </div>

        {/* ── Center: Layout canvas ──────────────────────────────────────── */}
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <DropZone
              id="leftColumn"
              items={leftColumn}
              menuCourses={menuCourses}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onRemove={removeBlock}
              label="Left Column — Course Structure"
              accentColor="#4b4b88"
              emptyHint="Drop course, spacer, or divider blocks here"
            />
            <DropZone
              id="rightColumn"
              items={rightColumn}
              menuCourses={menuCourses}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onRemove={removeBlock}
              label="Right Column — Beverage Structure"
              accentColor="#c8a06e"
              emptyHint="Drop pairing, by-glass, or quick access blocks here"
            />
          </div>

          <DragOverlay dropAnimation={{ duration: 150, easing: "cubic-bezier(0.18,0.67,0.6,1.22)" }}>
            {overlayBlock && (
              <BlockCard
                block={overlayBlock}
                label={overlayLabel}
                subLabel=""
                cfg={overlayCfg}
                isSelected={false}
                isOverlay
              />
            )}
          </DragOverlay>
        </DndContext>

        {/* ── Right: Config panel ───────────────────────────────────────── */}
        <div style={{ position: "sticky", top: 20 }}>
          <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#999", textTransform: "uppercase", marginBottom: 10 }}>
            Configure Block
          </div>
          <BlockConfigPanel
            block={selectedBlock}
            menuCourses={menuCourses}
            onUpdate={updateBlock}
            onClose={() => setSelectedId(null)}
          />

          {/* Layout stats */}
          <div style={{
            marginTop: 16, padding: "12px 14px",
            background: "#fafafa", border: "1px solid #f0f0f0",
            borderRadius: 8,
          }}>
            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 8 }}>
              Layout Summary
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {[
                { label: "Course blocks",    val: leftColumn.filter(b => b.type === "course").length,      color: "#4b4b88" },
                { label: "Spacers",          val: leftColumn.filter(b => b.type === "spacer").length,      color: "#999" },
                { label: "Pairing blocks",   val: rightColumn.filter(b => b.type === "pairing").length,    color: "#c8a06e" },
                { label: "By-Glass blocks",  val: rightColumn.filter(b => b.type === "byGlass").length,    color: "#5a9e6e" },
                { label: "Quick Access",     val: rightColumn.filter(b => b.type === "quickAccess").length, color: "#7a6e9e" },
                { label: "Total courses",    val: menuCourses.length,                                      color: "#888" },
              ].map(({ label, val, color }) => (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={{ fontFamily: FONT, fontSize: 9, color: "#888" }}>{label}</span>
                  <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color }}>{val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
