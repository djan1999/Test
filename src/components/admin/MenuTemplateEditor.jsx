/**
 * MenuTemplateEditor — row-based A5 canvas template editor for menu layout v2.
 *
 * Template shape (saved to service_settings id: "menu_layout_v2"):
 *   { version: 2, rows: RowDef[] }
 *   RowDef: { id: string, left: BlockDef | null, right: BlockDef | null }
 *
 * Three-panel layout:
 *   Left:   block palette grouped by category
 *   Center: A5-proportioned canvas — draggable rows, two cells each
 *   Right:  inspector for the selected cell's block
 */

import { useState, useCallback } from "react";
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor,
  useSensor, useSensors, closestCenter,
} from "@dnd-kit/core";
import {
  SortableContext, sortableKeyboardCoordinates,
  arrayMove, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { FONT, baseInp } from "./adminStyles.js";
import {
  BLOCK_META, BLOCK_GROUPS, makeRowId, makeBlock, buildDefaultTemplate,
} from "../../utils/menuTemplateSchema.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const GOLD = "#c8a96e";
const CANVAS_BG = "#fdfcf8";
const CELL_EMPTY_BG = "#f7f6f2";
const CELL_EMPTY_BORDER = "#e4e2dc";
const SELECTED_RING = "#4b4b88";

// ── Block content preview ─────────────────────────────────────────────────────

function BlockPreview({ block, menuCourses = [], logoDataUri }) {
  if (!block) return null;
  const meta = BLOCK_META[block.type] || {};
  const col = meta.color || "#888";

  const tiny = { fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, textTransform: "uppercase" };
  const label = { fontFamily: FONT, fontSize: 9, letterSpacing: 2, textTransform: "uppercase", fontWeight: 700 };
  const body  = { fontFamily: FONT, fontSize: 9.5, color: "#333", lineHeight: 1.5 };

  switch (block.type) {
    case "course": {
      const course = menuCourses.find(c => c.course_key === block.courseKey);
      const name = course?.menu?.name || block.courseKey || "(no course)";
      const desc = course?.menu?.description || "";
      return (
        <div>
          <div style={{ ...label, color: "#1a1a1a" }}>{name}</div>
          {desc && <div style={{ ...body, fontSize: 8.5, color: "#666", marginTop: 2 }}>{desc}</div>}
        </div>
      );
    }
    case "pairing":
      return <div style={{ ...tiny, color: GOLD }}>◎ WINE / DRINK PAIRING</div>;
    case "pairing_label":
      return <div style={{ ...label, color: GOLD }}>{block.text || "WINE PAIRING"}</div>;
    case "by_the_glass":
      return <div style={{ ...tiny, color: "#5a9e6e" }}>◷ BY THE GLASS</div>;
    case "bottle":
      return <div style={{ ...tiny, color: "#5a9e6e" }}>◫ BOTTLE WINE</div>;
    case "aperitif":
      return <div style={{ ...tiny, color: "#7a6e9e" }}>◇ APERITIF</div>;
    case "spacer":
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ flex: 1, borderTop: "1px dashed #ccc" }} />
          <span style={{ ...tiny, color: "#aaa" }}>{block.height || 8}pt</span>
          <div style={{ flex: 1, borderTop: "1px dashed #ccc" }} />
        </div>
      );
    case "divider":
      return <div style={{ borderTop: `1px solid ${col}`, width: "100%", margin: "2px 0" }} />;
    case "logo":
      return logoDataUri
        ? <img src={logoDataUri} alt="logo" style={{ height: 22, objectFit: "contain" }} />
        : <div style={{ ...tiny, color: "#bbb" }}>▣ LOGO</div>;
    case "title":
      return <div style={{ ...label, fontSize: 11, letterSpacing: 4, color: "#1a1a1a" }}>{block.text || "WINTER MENU"}</div>;
    case "team":
      return <div style={{ ...tiny, color: "#888" }}>◆ TEAM NAMES</div>;
    case "goodbye":
      return <div style={{ ...body, fontStyle: "italic", color: "#666" }}>{block.text || "Hvala za vaš obisk."}</div>;
    case "text":
      return <div style={{ ...body, fontWeight: block.bold ? 700 : 400 }}>{block.text || "(empty text)"}</div>;
    default:
      return <div style={{ ...tiny, color: "#999" }}>{meta.label || block.type}</div>;
  }
}

// ── Row cell ──────────────────────────────────────────────────────────────────

function RowCell({ block, rowId, side, isSelected, onSelect, onRemove, onAdd, menuCourses, logoDataUri }) {
  const meta = block ? (BLOCK_META[block.type] || {}) : null;
  const isEmpty = !block;

  if (isEmpty) {
    return (
      <div
        onClick={() => onAdd(rowId, side)}
        style={{
          flex: side === "left" ? "0 0 55%" : "0 0 45%",
          minHeight: 36, borderRadius: 3,
          border: `1.5px dashed ${CELL_EMPTY_BORDER}`,
          background: CELL_EMPTY_BG,
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", transition: "all 0.12s",
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = "#c8a96e"; e.currentTarget.style.background = "#fdf8f0"; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = CELL_EMPTY_BORDER; e.currentTarget.style.background = CELL_EMPTY_BG; }}
      >
        <span style={{ fontFamily: FONT, fontSize: 11, color: "#ccc", fontWeight: 700 }}>+</span>
      </div>
    );
  }

  const accentCol = meta?.color || "#888";
  const isLayout = meta?.group === "layout";

  return (
    <div
      onClick={() => onSelect(rowId, side)}
      style={{
        flex: side === "left" ? "0 0 55%" : "0 0 45%",
        borderRadius: 3, cursor: "pointer",
        border: `1.5px solid ${isSelected ? SELECTED_RING : "#e8e6e0"}`,
        background: isSelected ? "#f4f3fb" : (meta?.bg || "#fafafa"),
        boxShadow: isSelected ? `0 0 0 2px ${SELECTED_RING}22` : "none",
        display: "flex", flexDirection: "column",
        transition: "all 0.1s", overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Accent strip */}
      {!isLayout && (
        <div style={{
          position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
          background: accentCol, borderRadius: "3px 0 0 3px",
        }} />
      )}

      {/* Content */}
      <div style={{ padding: isLayout ? "5px 8px" : "7px 8px 7px 12px", flex: 1 }}>
        <BlockPreview block={block} menuCourses={menuCourses} logoDataUri={logoDataUri} />
      </div>

      {/* Remove button */}
      <button
        onClick={e => { e.stopPropagation(); onRemove(rowId, side); }}
        style={{
          position: "absolute", top: 2, right: 2,
          fontFamily: FONT, fontSize: 9, padding: "1px 4px",
          border: "none", borderRadius: 2, cursor: "pointer",
          background: "transparent", color: "#bbb",
          lineHeight: 1,
        }}
        onMouseEnter={e => { e.currentTarget.style.color = "#e05050"; e.currentTarget.style.background = "#fff0f0"; }}
        onMouseLeave={e => { e.currentTarget.style.color = "#bbb"; e.currentTarget.style.background = "transparent"; }}
      >×</button>
    </div>
  );
}

// ── Sortable row ──────────────────────────────────────────────────────────────

function SortableRow({ row, selectedCell, onSelectCell, onRemoveBlock, onAddBlock, onRemoveRow, menuCourses, logoDataUri }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.35 : 1,
  };

  const leftSelected  = selectedCell?.rowId === row.id && selectedCell?.side === "left";
  const rightSelected = selectedCell?.rowId === row.id && selectedCell?.side === "right";

  return (
    <div ref={setNodeRef} style={{ ...style, display: "flex", alignItems: "stretch", gap: 6, marginBottom: 5 }}>
      {/* Drag handle */}
      <div
        {...attributes} {...listeners}
        style={{
          width: 16, flexShrink: 0, cursor: "grab", borderRadius: 2,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#ccc", fontSize: 11, userSelect: "none",
          background: isDragging ? "#e8e8e8" : "transparent",
        }}
        title="Drag to reorder"
      >⋮⋮</div>

      {/* Left cell */}
      <RowCell
        block={row.left}
        rowId={row.id}
        side="left"
        isSelected={leftSelected}
        onSelect={onSelectCell}
        onRemove={onRemoveBlock}
        onAdd={onAddBlock}
        menuCourses={menuCourses}
        logoDataUri={logoDataUri}
      />

      {/* Right cell */}
      <RowCell
        block={row.right}
        rowId={row.id}
        side="right"
        isSelected={rightSelected}
        onSelect={onSelectCell}
        onRemove={onRemoveBlock}
        onAdd={onAddBlock}
        menuCourses={menuCourses}
        logoDataUri={logoDataUri}
      />

      {/* Delete row button */}
      <button
        onClick={() => onRemoveRow(row.id)}
        style={{
          width: 20, flexShrink: 0, border: "none", background: "transparent",
          cursor: "pointer", color: "#ddd", fontSize: 13, borderRadius: 2,
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: 0,
        }}
        title="Delete row"
        onMouseEnter={e => { e.currentTarget.style.color = "#e05050"; e.currentTarget.style.background = "#fff0f0"; }}
        onMouseLeave={e => { e.currentTarget.style.color = "#ddd"; e.currentTarget.style.background = "transparent"; }}
      >⊗</button>
    </div>
  );
}

// ── Drag overlay row (ghost while dragging) ───────────────────────────────────

function OverlayRow({ row }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      background: "#fff", border: "1.5px solid #4b4b88",
      borderRadius: 4, padding: "6px 8px", opacity: 0.9,
      boxShadow: "0 4px 16px rgba(75,75,136,0.18)",
    }}>
      <span style={{ fontFamily: FONT, fontSize: 9, color: "#4b4b88", letterSpacing: 1 }}>
        {row.left ? (BLOCK_META[row.left.type]?.label || row.left.type) : "—"}
        {" / "}
        {row.right ? (BLOCK_META[row.right.type]?.label || row.right.type) : "—"}
      </span>
    </div>
  );
}

// ── Block picker modal ────────────────────────────────────────────────────────

function BlockPickerModal({ onPick, onClose }) {
  const [hoveredType, setHoveredType] = useState(null);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.35)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#fff", borderRadius: 6, padding: "24px 28px",
          width: 520, maxHeight: "80vh", overflowY: "auto",
          boxShadow: "0 8px 40px rgba(0,0,0,0.2)",
          fontFamily: FONT,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 20 }}>
          <span style={{ fontSize: 10, letterSpacing: 3, textTransform: "uppercase", color: "#1a1a1a", fontWeight: 700 }}>
            ADD BLOCK
          </span>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, color: "#bbb" }}>×</button>
        </div>

        {BLOCK_GROUPS.map(group => (
          <div key={group.id} style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 8, letterSpacing: 3, color: "#bbb", textTransform: "uppercase", marginBottom: 10 }}>
              {group.label}
              <span style={{ marginLeft: 8, fontSize: 7.5, color: "#ddd", letterSpacing: 1 }}>{group.desc}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {Object.entries(BLOCK_META)
                .filter(([, m]) => m.group === group.id)
                .map(([type, meta]) => (
                  <button
                    key={type}
                    onClick={() => onPick(type)}
                    onMouseEnter={() => setHoveredType(type)}
                    onMouseLeave={() => setHoveredType(null)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10,
                      padding: "10px 12px", border: "1.5px solid",
                      borderColor: hoveredType === type ? meta.color : "#eeeceb",
                      borderRadius: 4, cursor: "pointer",
                      background: hoveredType === type ? (meta.bg || "#f8f8f8") : "#fafafa",
                      textAlign: "left", transition: "all 0.1s",
                    }}
                  >
                    <span style={{ fontSize: 14, color: meta.color, width: 20, textAlign: "center", flexShrink: 0 }}>
                      {meta.icon}
                    </span>
                    <div>
                      <div style={{ fontSize: 9, letterSpacing: 1, fontWeight: 700, color: "#1a1a1a", marginBottom: 2 }}>
                        {meta.label}
                      </div>
                      <div style={{ fontSize: 7.5, color: "#999", lineHeight: 1.4, letterSpacing: 0 }}>
                        {meta.desc}
                      </div>
                    </div>
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Block inspector (right panel) ─────────────────────────────────────────────

function BlockInspector({ block, onUpdate }) {
  if (!block) return (
    <div style={{ fontFamily: FONT, fontSize: 9, color: "#ccc", letterSpacing: 1, padding: "20px 0", textAlign: "center" }}>
      SELECT A CELL TO CONFIGURE
    </div>
  );

  const meta = BLOCK_META[block.type] || {};
  const fields = meta.fields || [];

  if (fields.length === 0) return (
    <div>
      <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 10 }}>
        {meta.label}
      </div>
      <div style={{ fontFamily: FONT, fontSize: 9, color: "#aaa", lineHeight: 1.6 }}>{meta.desc}</div>
      <div style={{ marginTop: 12, fontFamily: FONT, fontSize: 8, color: "#ccc", letterSpacing: 1 }}>
        NO CONFIGURABLE FIELDS
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: meta.color || "#888", textTransform: "uppercase", marginBottom: 14 }}>
        {meta.icon} {meta.label}
      </div>

      {fields.map(field => (
        <div key={field.key} style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#888", textTransform: "uppercase", marginBottom: 6 }}>
            {field.label}
          </div>

          {field.type === "textarea" ? (
            <textarea
              value={block[field.key] ?? field.placeholder ?? ""}
              onChange={e => onUpdate({ ...block, [field.key]: e.target.value })}
              rows={3}
              style={{ ...baseInp, fontSize: 11, resize: "vertical" }}
              placeholder={field.placeholder || ""}
            />
          ) : field.type === "number" ? (
            <input
              type="number"
              value={block[field.key] ?? ""}
              min={field.min}
              max={field.max}
              step={field.step || 1}
              onChange={e => onUpdate({ ...block, [field.key]: parseFloat(e.target.value) || 0 })}
              style={{ ...baseInp, fontSize: 12 }}
            />
          ) : field.type === "checkbox" ? (
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!!block[field.key]}
                onChange={e => onUpdate({ ...block, [field.key]: e.target.checked })}
              />
              <span style={{ fontFamily: FONT, fontSize: 9, color: "#555" }}>{field.label}</span>
            </label>
          ) : field.type === "course_select" ? (
            <div style={{ fontFamily: FONT, fontSize: 9, color: "#888", padding: "8px 0" }}>
              {/* Populated from parent via block.courseKey — rendered as text */}
              Course key: <code style={{ color: "#4b4b88" }}>{block[field.key] || "(none)"}</code>
              <div style={{ fontSize: 7.5, color: "#ccc", marginTop: 4, letterSpacing: 0.5 }}>
                Set via Rebuild from Courses or use the text field
              </div>
            </div>
          ) : (
            <input
              type="text"
              value={block[field.key] ?? ""}
              onChange={e => onUpdate({ ...block, [field.key]: e.target.value })}
              style={{ ...baseInp, fontSize: 12 }}
              placeholder={field.placeholder || ""}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function MenuTemplateEditor({
  menuTemplate,
  onUpdateTemplate,
  onSaveTemplate,
  saving = false,
  saved  = false,
  menuCourses = [],
  logoDataUri = "",
}) {
  const [selectedCell, setSelectedCell] = useState(null); // { rowId, side }
  const [pickerTarget, setPickerTarget] = useState(null); // { rowId, side }
  const [activeRowId,  setActiveRowId]  = useState(null);

  const template = menuTemplate || { version: 2, rows: [] };
  const rows = template.rows || [];

  const update = useCallback(newRows => {
    onUpdateTemplate({ ...template, rows: newRows });
  }, [template, onUpdateTemplate]);

  // ── DnD ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragStart({ active }) { setActiveRowId(active.id); }

  function handleDragEnd({ active, over }) {
    setActiveRowId(null);
    if (!over || active.id === over.id) return;
    const oldIdx = rows.findIndex(r => r.id === active.id);
    const newIdx = rows.findIndex(r => r.id === over.id);
    if (oldIdx !== -1 && newIdx !== -1) update(arrayMove(rows, oldIdx, newIdx));
  }

  // ── Row mutations ──
  const addRow = () => {
    const newRow = { id: makeRowId("row"), left: null, right: null };
    update([...rows, newRow]);
  };

  const removeRow = rowId => {
    update(rows.filter(r => r.id !== rowId));
    if (selectedCell?.rowId === rowId) setSelectedCell(null);
  };

  const removeBlock = (rowId, side) => {
    update(rows.map(r => r.id === rowId ? { ...r, [side]: null } : r));
    if (selectedCell?.rowId === rowId && selectedCell?.side === side) setSelectedCell(null);
  };

  const pickBlock = (type) => {
    if (!pickerTarget) return;
    const { rowId, side } = pickerTarget;
    const block = makeBlock(type);
    update(rows.map(r => r.id === rowId ? { ...r, [side]: block } : r));
    setSelectedCell({ rowId, side });
    setPickerTarget(null);
  };

  const updateSelectedBlock = (newBlock) => {
    if (!selectedCell) return;
    const { rowId, side } = selectedCell;
    update(rows.map(r => r.id === rowId ? { ...r, [side]: newBlock } : r));
  };

  const selectedBlock = selectedCell
    ? rows.find(r => r.id === selectedCell.rowId)?.[selectedCell.side] ?? null
    : null;

  const rebuild = () => {
    const fresh = buildDefaultTemplate(menuCourses);
    onUpdateTemplate(fresh);
    setSelectedCell(null);
  };

  const activeRow = activeRowId ? rows.find(r => r.id === activeRowId) : null;

  // ── Render ──
  return (
    <div style={{ display: "flex", gap: 0, height: "calc(100vh - 130px)", minHeight: 500, fontFamily: FONT }}>

      {/* ── Left: block palette ── */}
      <aside style={{
        width: 200, flexShrink: 0, borderRight: "1px solid #f0f0f0",
        padding: "16px 12px", overflowY: "auto", background: "#fafafa",
      }}>
        <div style={{ fontSize: 8, letterSpacing: 3, color: "#bbb", textTransform: "uppercase", marginBottom: 14 }}>
          BLOCK TYPES
        </div>

        {BLOCK_GROUPS.map(group => (
          <div key={group.id} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 7.5, letterSpacing: 2, color: "#ccc", textTransform: "uppercase", marginBottom: 8 }}>
              {group.label}
            </div>
            {Object.entries(BLOCK_META)
              .filter(([, m]) => m.group === group.id)
              .map(([type, meta]) => (
                <div
                  key={type}
                  title={meta.desc}
                  style={{
                    display: "flex", alignItems: "center", gap: 7,
                    padding: "6px 8px", marginBottom: 2, borderRadius: 3,
                    border: "1px solid #eeeceb", background: "#fff",
                    cursor: "default",
                  }}
                >
                  <span style={{ color: meta.color, fontSize: 11, width: 14, textAlign: "center", flexShrink: 0 }}>{meta.icon}</span>
                  <span style={{ fontSize: 8, color: "#555", letterSpacing: 0.5 }}>{meta.label}</span>
                </div>
              ))}
          </div>
        ))}

        <div style={{ marginTop: 8, borderTop: "1px solid #f0f0f0", paddingTop: 14 }}>
          <button
            onClick={rebuild}
            style={{
              width: "100%", fontFamily: FONT, fontSize: 8, letterSpacing: 1,
              padding: "8px 0", border: "1px solid #e8e8e8", borderRadius: 3,
              cursor: "pointer", background: "#fff", color: "#888",
              textTransform: "uppercase",
            }}
            title="Generate default template from current courses"
          >
            ↺ Rebuild from Courses
          </button>
        </div>
      </aside>

      {/* ── Center: canvas ── */}
      <section style={{ flex: 1, overflowY: "auto", padding: "20px 24px", background: "#f5f4f0" }}>

        {/* Column headers */}
        <div style={{ display: "flex", gap: 6, marginBottom: 8, paddingLeft: 22, paddingRight: 26 }}>
          <div style={{ flex: "0 0 55%", fontSize: 7.5, letterSpacing: 2, color: "#bbb", textTransform: "uppercase" }}>LEFT</div>
          <div style={{ flex: "0 0 45%", fontSize: 7.5, letterSpacing: 2, color: "#bbb", textTransform: "uppercase" }}>RIGHT</div>
        </div>

        {/* A5 canvas */}
        <div style={{
          background: CANVAS_BG, borderRadius: 4,
          border: "1px solid #e8e6e0",
          padding: "14px 10px 14px 6px",
          boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
          minHeight: 400,
        }}>
          {rows.length === 0 && (
            <div style={{
              textAlign: "center", padding: "40px 0",
              fontSize: 9, color: "#ccc", letterSpacing: 2, textTransform: "uppercase",
            }}>
              NO ROWS — CLICK ↺ REBUILD OR ADD A ROW BELOW
            </div>
          )}

          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={rows.map(r => r.id)} strategy={verticalListSortingStrategy}>
              {rows.map(row => (
                <SortableRow
                  key={row.id}
                  row={row}
                  selectedCell={selectedCell}
                  onSelectCell={(rowId, side) => setSelectedCell({ rowId, side })}
                  onRemoveBlock={removeBlock}
                  onAddBlock={(rowId, side) => setPickerTarget({ rowId, side })}
                  onRemoveRow={removeRow}
                  menuCourses={menuCourses}
                  logoDataUri={logoDataUri}
                />
              ))}
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {activeRow ? <OverlayRow row={activeRow} /> : null}
            </DragOverlay>
          </DndContext>
        </div>

        {/* Add row */}
        <button
          onClick={addRow}
          style={{
            marginTop: 10, width: "100%",
            fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "10px 0",
            border: "1.5px dashed #d8d6d0", borderRadius: 4, cursor: "pointer",
            background: "transparent", color: "#bbb", textTransform: "uppercase",
            transition: "all 0.12s",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.color = GOLD; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "#d8d6d0"; e.currentTarget.style.color = "#bbb"; }}
        >
          + ADD ROW
        </button>
      </section>

      {/* ── Right: inspector + save ── */}
      <aside style={{
        width: 260, flexShrink: 0, borderLeft: "1px solid #f0f0f0",
        padding: "16px 16px", overflowY: "auto", background: "#fff",
        display: "flex", flexDirection: "column", gap: 0,
      }}>
        {/* Save controls */}
        <div style={{ marginBottom: 20 }}>
          <button
            onClick={onSaveTemplate}
            disabled={saving}
            style={{
              width: "100%", fontFamily: FONT, fontSize: 9, letterSpacing: 2,
              padding: "9px 0", border: "none", borderRadius: 3, cursor: saving ? "wait" : "pointer",
              background: saved ? "#4a9a6a" : GOLD, color: "#fff",
              textTransform: "uppercase", transition: "background 0.2s",
            }}
          >
            {saving ? "SAVING…" : saved ? "✓ SAVED" : "SAVE TEMPLATE"}
          </button>
          <div style={{ fontSize: 7.5, color: "#ccc", letterSpacing: 1, textTransform: "uppercase", marginTop: 6, textAlign: "center" }}>
            {rows.length} row{rows.length !== 1 ? "s" : ""}
          </div>
        </div>

        <div style={{ borderTop: "1px solid #f4f4f4", paddingTop: 16 }}>
          <BlockInspector block={selectedBlock} onUpdate={updateSelectedBlock} />
        </div>
      </aside>

      {/* Block picker modal */}
      {pickerTarget && (
        <BlockPickerModal
          onPick={pickBlock}
          onClose={() => setPickerTarget(null)}
        />
      )}
    </div>
  );
}
