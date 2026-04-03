/**
 * MenuTemplateEditor — three-panel template editor for menu layout v2.
 *
 * Layout:
 *   Left  (280px) : Row list editor — drag to reorder, add/delete/duplicate rows,
 *                   per-row width preset and gap settings
 *   Center (flex) : Live A5 preview iframe — renders the exact same HTML/CSS as
 *                   the final print output via generateMenuHTML()
 *   Right  (240px): Block inspector — type-specific field controls including a
 *                   real course selector dropdown
 *
 * Template shape (saved to service_settings id: "menu_layout_v2"):
 *   { version: 2, rows: RowDef[] }
 *   RowDef: { id, left, right, widthPreset, gap }
 */

import { useState, useCallback, useEffect, useRef } from "react";
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
  BLOCK_META, BLOCK_GROUPS, makeRowId, makeBlock, makeRow, buildDefaultTemplate,
} from "../../utils/menuTemplateSchema.js";
import { generateMenuHTML } from "../../utils/menuGenerator.js";

// ── Constants ─────────────────────────────────────────────────────────────────

const GOLD = "#c8a96e";
const SELECTED_RING = "#4b4b88";
const CELL_EMPTY_BG = "#f7f6f2";
const CELL_EMPTY_BORDER = "#e4e2dc";

// Preview seat/table stubs — real courses + template drive the actual content
const PREVIEW_SEAT = { id: 1, pairing: "Wine", extras: {}, glasses: [], cocktails: [], beers: [], aperitifs: [] };
const PREVIEW_TABLE = { menuType: "full", restrictions: [], bottleWines: [], birthday: false };

// ── Helpers ───────────────────────────────────────────────────────────────────

function chipLabel(block, menuCourses) {
  if (!block) return null;
  const meta = BLOCK_META[block.type] || {};
  let detail = "";
  if (block.type === "course") {
    const c = menuCourses.find(c => c.course_key === block.courseKey);
    detail = c?.menu?.name || block.courseKey || "?";
  } else if (block.type === "spacer") {
    detail = `${block.height ?? 8}pt`;
  } else if (block.type === "divider") {
    detail = `${block.thickness ?? 0.5}pt`;
  } else if (block.text) {
    detail = block.text.slice(0, 16) + (block.text.length > 16 ? "…" : "");
  }
  return `${meta.icon || ""} ${meta.label || block.type}${detail ? ` · ${detail}` : ""}`;
}

// ── Block chip (in row list) ──────────────────────────────────────────────────

function BlockChip({ block, rowId, side, isSelected, onSelect, onRemove, onAdd, onMove, menuCourses }) {
  const meta = block ? (BLOCK_META[block.type] || {}) : null;

  if (!block) {
    return (
      <div
        onClick={() => onAdd(rowId, side)}
        style={{
          flex: 1, minWidth: 0, height: 28, borderRadius: 3,
          border: `1.5px dashed ${CELL_EMPTY_BORDER}`,
          background: CELL_EMPTY_BG,
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer",
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = GOLD; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = CELL_EMPTY_BORDER; }}
      >
        <span style={{ fontFamily: FONT, fontSize: 11, color: "#bbb", fontWeight: 700 }}>+</span>
      </div>
    );
  }

  const accentCol = meta?.color || "#888";

  return (
    <div
      onClick={() => onSelect(rowId, side)}
      style={{
        flex: 1, minWidth: 0, height: 28, borderRadius: 3, cursor: "pointer",
        border: `1.5px solid ${isSelected ? SELECTED_RING : "#e8e6e0"}`,
        background: isSelected ? "#f4f3fb" : (meta?.bg || "#fafafa"),
        display: "flex", alignItems: "center", gap: 0,
        overflow: "hidden", position: "relative",
        transition: "border-color 0.1s",
      }}
    >
      <div style={{ width: 3, alignSelf: "stretch", background: accentCol, flexShrink: 0 }} />
      <span style={{
        fontFamily: FONT, fontSize: 8, color: isSelected ? SELECTED_RING : "#444",
        padding: "0 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        flex: 1, letterSpacing: 0.3,
      }}>
        {chipLabel(block, menuCourses)}
      </span>
      {/* Move to other cell */}
      <button
        onClick={e => { e.stopPropagation(); onMove(rowId, side); }}
        title={side === "left" ? "Move to right cell" : "Move to left cell"}
        style={{
          flexShrink: 0, border: "none", background: "transparent",
          cursor: "pointer", color: "#ccc", fontSize: 9, padding: "0 3px", height: "100%",
        }}
        onMouseEnter={e => { e.currentTarget.style.color = "#4b4b88"; }}
        onMouseLeave={e => { e.currentTarget.style.color = "#ccc"; }}
      >{side === "left" ? "→" : "←"}</button>
      <button
        onClick={e => { e.stopPropagation(); onRemove(rowId, side); }}
        style={{
          flexShrink: 0, border: "none", background: "transparent",
          cursor: "pointer", color: "#ccc", fontSize: 9, padding: "0 4px", height: "100%",
        }}
        onMouseEnter={e => { e.currentTarget.style.color = "#e05050"; }}
        onMouseLeave={e => { e.currentTarget.style.color = "#ccc"; }}
      >×</button>
    </div>
  );
}

// ── Row settings (width preset + gap) ────────────────────────────────────────

function RowSettings({ row, onUpdate }) {
  const gap = row.gap ?? 0;
  return (
    <div style={{ padding: "10px 10px 10px 24px", background: "#f8f7f3", borderTop: "1px solid #ede9e0" }}>
      <div style={{ fontFamily: FONT, fontSize: 7.5, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 8 }}>
        ROW SETTINGS
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ fontFamily: FONT, fontSize: 7.5, color: "#999", letterSpacing: 1 }}>GAP ABOVE (pt)</div>
        <input
          type="number"
          value={gap}
          min={0}
          max={40}
          step={0.5}
          onChange={e => onUpdate({ ...row, gap: parseFloat(e.target.value) || 0 })}
          style={{ ...baseInp, width: 50, fontSize: 10, padding: "2px 4px" }}
        />
      </div>
    </div>
  );
}

// ── Sortable row (in left panel) ──────────────────────────────────────────────

function SortableRow({
  row, selectedCell, onSelectCell, onRemoveBlock, onAddBlock, onMoveBlock, onRemoveRow,
  onDuplicateRow, onInsertAbove, onInsertBelow, onUpdateRow,
  menuCourses,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });
  const [settingsOpen, setSettingsOpen] = useState(false);

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  const leftSelected  = selectedCell?.rowId === row.id && selectedCell?.side === "left";
  const rightSelected = selectedCell?.rowId === row.id && selectedCell?.side === "right";

  return (
    <div ref={setNodeRef} style={{ ...style, marginBottom: 2 }}>
      {/* Row strip */}
      <div style={{
        display: "flex", alignItems: "center", gap: 4,
        padding: "3px 4px",
        background: (leftSelected || rightSelected) ? "#f4f3fb" : "#fff",
        border: `1px solid ${(leftSelected || rightSelected) ? "#c8c6e8" : "#ede9e0"}`,
        borderRadius: settingsOpen ? "3px 3px 0 0" : 3,
      }}>
        {/* Drag handle */}
        <div
          {...attributes} {...listeners}
          style={{
            width: 14, cursor: "grab", color: "#ccc", fontSize: 10,
            userSelect: "none", textAlign: "center", flexShrink: 0,
          }}
          title="Drag to reorder"
        >⋮⋮</div>

        {/* Left chip */}
        <BlockChip
          block={row.left} rowId={row.id} side="left"
          isSelected={leftSelected}
          onSelect={onSelectCell} onRemove={onRemoveBlock} onAdd={onAddBlock} onMove={onMoveBlock}
          menuCourses={menuCourses}
        />

        {/* Right chip */}
        <BlockChip
          block={row.right} rowId={row.id} side="right"
          isSelected={rightSelected}
          onSelect={onSelectCell} onRemove={onRemoveBlock} onAdd={onAddBlock} onMove={onMoveBlock}
          menuCourses={menuCourses}
        />

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 1, flexShrink: 0 }}>
          <RowActionBtn title="Insert row above" onClick={() => onInsertAbove(row.id)}>↑</RowActionBtn>
          <RowActionBtn title="Insert row below" onClick={() => onInsertBelow(row.id)}>↓</RowActionBtn>
          <RowActionBtn title="Duplicate row" onClick={() => onDuplicateRow(row.id)}>⎘</RowActionBtn>
          <RowActionBtn title="Row settings" onClick={() => setSettingsOpen(v => !v)} active={settingsOpen}>⚙</RowActionBtn>
          <RowActionBtn title="Delete row" onClick={() => onRemoveRow(row.id)} danger>⊗</RowActionBtn>
        </div>
      </div>

      {/* Inline row settings */}
      {settingsOpen && (
        <RowSettings row={row} onUpdate={onUpdateRow} onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}

function RowActionBtn({ children, onClick, title, danger = false, active = false }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick} title={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 20, height: 22, border: "none", borderRadius: 2, cursor: "pointer",
        fontFamily: FONT, fontSize: 10, padding: 0, lineHeight: 1,
        background: active ? "#f0f0f8" : hov ? (danger ? "#fff0f0" : "#f4f3fb") : "transparent",
        color: active ? SELECTED_RING : hov ? (danger ? "#e05050" : SELECTED_RING) : "#bbb",
        transition: "all 0.1s",
      }}
    >{children}</button>
  );
}

// ── Drag overlay ──────────────────────────────────────────────────────────────

function OverlayRow({ row }) {
  return (
    <div style={{
      background: "#fff", border: `1.5px solid ${SELECTED_RING}`, borderRadius: 3,
      padding: "5px 10px", opacity: 0.9, boxShadow: "0 4px 16px rgba(75,75,136,0.18)",
      fontFamily: FONT, fontSize: 8.5, color: SELECTED_RING, letterSpacing: 1,
    }}>
      {row.left ? (BLOCK_META[row.left.type]?.label || row.left.type) : "—"}
      {" · "}
      {row.right ? (BLOCK_META[row.right.type]?.label || row.right.type) : "—"}
    </div>
  );
}

// ── Block picker modal ────────────────────────────────────────────────────────

function BlockPickerModal({ onPick, onClose, menuCourses }) {
  const [hov, setHov] = useState(null);
  const [filter, setFilter] = useState("");

  const filtered = filter.trim()
    ? Object.entries(BLOCK_META).filter(([t, m]) =>
        m.label.toLowerCase().includes(filter.toLowerCase()) ||
        m.desc.toLowerCase().includes(filter.toLowerCase()) ||
        t.includes(filter.toLowerCase()))
    : null;

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
          background: "#fff", borderRadius: 6, padding: "20px 24px",
          width: 500, maxHeight: "75vh", overflowY: "auto",
          boxShadow: "0 8px 40px rgba(0,0,0,0.2)", fontFamily: FONT,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: "#1a1a1a", fontWeight: 700 }}>
            ADD BLOCK
          </span>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, color: "#bbb" }}>×</button>
        </div>

        <input
          autoFocus
          type="text"
          placeholder="Filter blocks…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ ...baseInp, width: "100%", marginBottom: 14, fontSize: 11 }}
        />

        {(filtered ? [{ id: "search", label: "Results", desc: "" }] : BLOCK_GROUPS).map(group => {
          const entries = filtered
            ? filtered
            : Object.entries(BLOCK_META).filter(([, m]) => m.group === group.id);
          if (entries.length === 0) return null;
          return (
            <div key={group.id} style={{ marginBottom: 16 }}>
              {!filtered && (
                <div style={{ fontSize: 7.5, letterSpacing: 3, color: "#bbb", textTransform: "uppercase", marginBottom: 8 }}>
                  {group.label}
                  <span style={{ marginLeft: 8, fontSize: 7, color: "#ddd", letterSpacing: 1 }}>{group.desc}</span>
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                {entries.map(([type, meta]) => (
                  <button
                    key={type}
                    onClick={() => onPick(type)}
                    onMouseEnter={() => setHov(type)}
                    onMouseLeave={() => setHov(null)}
                    style={{
                      display: "flex", alignItems: "center", gap: 9,
                      padding: "9px 11px", border: "1.5px solid",
                      borderColor: hov === type ? meta.color : "#eeeceb",
                      borderRadius: 4, cursor: "pointer",
                      background: hov === type ? (meta.bg || "#f8f8f8") : "#fafafa",
                      textAlign: "left", transition: "all 0.1s",
                    }}
                  >
                    <span style={{ fontSize: 13, color: meta.color, width: 18, textAlign: "center", flexShrink: 0 }}>
                      {meta.icon}
                    </span>
                    <div>
                      <div style={{ fontSize: 8.5, letterSpacing: 0.5, fontWeight: 700, color: "#1a1a1a", marginBottom: 2 }}>
                        {meta.label}
                      </div>
                      <div style={{ fontSize: 7, color: "#999", lineHeight: 1.4 }}>
                        {meta.desc}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Block inspector (right panel) ─────────────────────────────────────────────

function AlignButtons({ value, onChange }) {
  const opts = [
    { v: "left",   icon: "⟵" },
    { v: "center", icon: "↔" },
    { v: "right",  icon: "⟶" },
  ];
  return (
    <div style={{ display: "flex", gap: 3 }}>
      {opts.map(o => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          title={o.v}
          style={{
            width: 32, height: 26, border: `1px solid ${value === o.v ? SELECTED_RING : "#ddd"}`,
            borderRadius: 2, cursor: "pointer", fontFamily: FONT, fontSize: 11,
            background: value === o.v ? "#f0f0f8" : "#fff",
            color: value === o.v ? SELECTED_RING : "#666",
          }}
        >{o.icon}</button>
      ))}
    </div>
  );
}

function BlockInspector({ block, onUpdate, menuCourses }) {
  if (!block) return (
    <div style={{ fontFamily: FONT, fontSize: 8.5, color: "#ccc", letterSpacing: 1, padding: "24px 0", textAlign: "center", lineHeight: 2 }}>
      SELECT A CELL<br />TO CONFIGURE
    </div>
  );

  const meta = BLOCK_META[block.type] || {};
  const fields = meta.fields || [];

  const setField = (key, val) => onUpdate({ ...block, [key]: val });

  if (fields.length === 0) return (
    <div>
      <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: meta.color || "#888", textTransform: "uppercase", marginBottom: 8 }}>
        {meta.icon} {meta.label}
      </div>
      <div style={{ fontFamily: FONT, fontSize: 8.5, color: "#aaa", lineHeight: 1.6 }}>{meta.desc}</div>
      <div style={{ marginTop: 10, fontFamily: FONT, fontSize: 7.5, color: "#ccc", letterSpacing: 1 }}>
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
          <div style={{ fontFamily: FONT, fontSize: 7.5, letterSpacing: 1.5, color: "#999", textTransform: "uppercase", marginBottom: 5 }}>
            {field.label}
          </div>

          {field.type === "course_select" ? (
            <select
              value={block[field.key] || ""}
              onChange={e => setField(field.key, e.target.value)}
              style={{ ...baseInp, fontSize: 10.5, width: "100%" }}
            >
              <option value="">(none)</option>
              {menuCourses.map(c => (
                <option key={c.course_key} value={c.course_key}>
                  {c.menu?.name || c.course_key}
                </option>
              ))}
            </select>
          ) : field.type === "select" ? (
            field.key === "align" ? (
              <AlignButtons value={block[field.key] || "left"} onChange={v => setField(field.key, v)} />
            ) : (
              <select
                value={block[field.key] || (field.options?.[0] || "")}
                onChange={e => setField(field.key, e.target.value)}
                style={{ ...baseInp, fontSize: 10.5, width: "100%" }}
              >
                {(field.options || []).map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            )
          ) : field.type === "textarea" ? (
            <textarea
              value={block[field.key] ?? ""}
              onChange={e => setField(field.key, e.target.value)}
              rows={3}
              style={{ ...baseInp, fontSize: 11, resize: "vertical" }}
              placeholder={field.placeholder || ""}
            />
          ) : field.type === "number" ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                type="number"
                value={block[field.key] ?? ""}
                min={field.min}
                max={field.max}
                step={field.step || 1}
                onChange={e => setField(field.key, parseFloat(e.target.value) || 0)}
                style={{ ...baseInp, fontSize: 12, flex: 1 }}
              />
              {field.min !== undefined && (
                <span style={{ fontFamily: FONT, fontSize: 7, color: "#ccc", letterSpacing: 0 }}>
                  {field.min}–{field.max}
                </span>
              )}
            </div>
          ) : field.type === "checkbox" ? (
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!!block[field.key]}
                onChange={e => setField(field.key, e.target.checked)}
              />
              <span style={{ fontFamily: FONT, fontSize: 9, color: "#555" }}>{field.label}</span>
            </label>
          ) : (
            <input
              type="text"
              value={block[field.key] ?? ""}
              onChange={e => setField(field.key, e.target.value)}
              style={{ ...baseInp, fontSize: 12 }}
              placeholder={field.placeholder || ""}
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ── A5 preview panel ──────────────────────────────────────────────────────────

// A5 at 96 dpi: 148mm × 210mm ≈ 559px × 793px
const A5_PX_W = 559;
const A5_PX_H = 793;
const PREVIEW_SCALE = 0.72;

function LivePreview({ previewHtml, loading }) {
  return (
    <div style={{
      flex: 1, overflowY: "auto", background: "#e8e6e0",
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "20px 16px",
    }}>
      <div style={{
        fontFamily: FONT, fontSize: 7.5, letterSpacing: 3, color: "#aaa",
        textTransform: "uppercase", marginBottom: 14,
      }}>
        LIVE PREVIEW {loading ? "· updating…" : "· A5"}
      </div>

      {/* Paper wrapper */}
      <div style={{
        width: A5_PX_W * PREVIEW_SCALE,
        height: A5_PX_H * PREVIEW_SCALE,
        overflow: "hidden",
        flexShrink: 0,
        boxShadow: "0 4px 24px rgba(0,0,0,0.22)",
        borderRadius: 1,
        position: "relative",
        background: "#fff",
      }}>
        <iframe
          srcDoc={previewHtml || "<html><body style='background:#fff'></body></html>"}
          style={{
            width: A5_PX_W,
            height: A5_PX_H,
            border: "none",
            display: "block",
            transform: `scale(${PREVIEW_SCALE})`,
            transformOrigin: "top left",
          }}
          title="Menu preview"
          sandbox="allow-scripts"
        />
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function MenuTemplateEditor({
  menuTemplate,
  onUpdateTemplate,
  onSaveTemplate,
  saving  = false,
  saved   = false,
  menuCourses = [],
  logoDataUri = "",
}) {
  const [selectedCell, setSelectedCell] = useState(null); // { rowId, side }
  const [pickerTarget, setPickerTarget] = useState(null); // { rowId, side }
  const [activeRowId,  setActiveRowId]  = useState(null);
  const [previewHtml,  setPreviewHtml]  = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const previewTimer = useRef(null);

  const template = menuTemplate || { version: 2, rows: [] };
  const rows = template.rows || [];

  // ── Derive menu title from template's title block ──
  const menuTitle = (() => {
    for (const r of rows) {
      if (r.left?.type === "title")  return r.left.text  || "WINTER MENU";
      if (r.right?.type === "title") return r.right.text || "WINTER MENU";
    }
    return "WINTER MENU";
  })();

  const thankYouNote = (() => {
    for (const r of rows) {
      if (r.left?.type  === "goodbye") return r.left.text  || "Hvala za vaš obisk.";
      if (r.right?.type === "goodbye") return r.right.text || "Hvala za vaš obisk.";
    }
    return "Hvala za vaš obisk.";
  })();

  // ── Keyboard: Escape deselects / closes picker ──
  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape") {
        setPickerTarget(null);
        setSelectedCell(null);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // ── Live preview (debounced 250ms) ──
  useEffect(() => {
    clearTimeout(previewTimer.current);
    setPreviewLoading(true);
    previewTimer.current = setTimeout(() => {
      try {
        const html = generateMenuHTML({
          seat:       PREVIEW_SEAT,
          table:      PREVIEW_TABLE,
          menuCourses,
          menuTemplate: template,
          _logo:      logoDataUri,
          menuTitle,
          thankYouNote,
          teamNames: "Service Team",
        });
        setPreviewHtml(html);
      } catch {}
      setPreviewLoading(false);
    }, 250);
    return () => clearTimeout(previewTimer.current);
  }, [template, menuCourses, logoDataUri]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const oi = rows.findIndex(r => r.id === active.id);
    const ni = rows.findIndex(r => r.id === over.id);
    if (oi !== -1 && ni !== -1) update(arrayMove(rows, oi, ni));
  }

  // ── Row mutations ──
  const addRow = () => update([...rows, makeRow()]);

  const removeRow = rowId => {
    update(rows.filter(r => r.id !== rowId));
    if (selectedCell?.rowId === rowId) setSelectedCell(null);
  };

  const duplicateRow = rowId => {
    const idx = rows.findIndex(r => r.id === rowId);
    if (idx === -1) return;
    const orig = rows[idx];
    const copy = { ...orig, id: makeRowId("row"), left: orig.left ? { ...orig.left } : null, right: orig.right ? { ...orig.right } : null };
    const next = [...rows];
    next.splice(idx + 1, 0, copy);
    update(next);
  };

  const insertAbove = rowId => {
    const idx = rows.findIndex(r => r.id === rowId);
    if (idx === -1) return;
    const next = [...rows];
    next.splice(idx, 0, makeRow());
    update(next);
  };

  const insertBelow = rowId => {
    const idx = rows.findIndex(r => r.id === rowId);
    if (idx === -1) return;
    const next = [...rows];
    next.splice(idx + 1, 0, makeRow());
    update(next);
  };

  const updateRow = updatedRow => {
    update(rows.map(r => r.id === updatedRow.id ? updatedRow : r));
  };

  const removeBlock = (rowId, side) => {
    update(rows.map(r => r.id === rowId ? { ...r, [side]: null } : r));
    if (selectedCell?.rowId === rowId && selectedCell?.side === side) setSelectedCell(null);
  };

  // Swap a block to the other cell (left↔right)
  const moveBlock = (rowId, fromSide) => {
    const toSide = fromSide === "left" ? "right" : "left";
    update(rows.map(r => {
      if (r.id !== rowId) return r;
      return { ...r, [toSide]: r[fromSide], [fromSide]: r[toSide] };
    }));
    // Update selection to follow the moved block
    if (selectedCell?.rowId === rowId && selectedCell?.side === fromSide) {
      setSelectedCell({ rowId, side: toSide });
    }
  };

  const pickBlock = type => {
    if (!pickerTarget) return;
    const { rowId, side } = pickerTarget;
    const block = makeBlock(type);
    update(rows.map(r => r.id === rowId ? { ...r, [side]: block } : r));
    setSelectedCell({ rowId, side });
    setPickerTarget(null);
  };

  const updateSelectedBlock = newBlock => {
    if (!selectedCell) return;
    const { rowId, side } = selectedCell;
    update(rows.map(r => r.id === rowId ? { ...r, [side]: newBlock } : r));
  };

  const selectedBlock = selectedCell
    ? rows.find(r => r.id === selectedCell.rowId)?.[selectedCell.side] ?? null
    : null;

  const rebuild = () => {
    onUpdateTemplate(buildDefaultTemplate(menuCourses));
    setSelectedCell(null);
  };

  const activeRow = activeRowId ? rows.find(r => r.id === activeRowId) : null;

  // ── Render ──
  return (
    <div style={{ display: "flex", height: "calc(100vh - 130px)", minHeight: 500, fontFamily: FONT, gap: 0 }}>

      {/* ── Left: Row editor ── */}
      <aside style={{
        width: 288, flexShrink: 0, borderRight: "1px solid #ede9e0",
        background: "#faf9f7", display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{ padding: "12px 12px 8px", borderBottom: "1px solid #ede9e0", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 7.5, letterSpacing: 3, color: "#bbb", textTransform: "uppercase" }}>
              LAYOUT EDITOR
            </span>
            <span style={{ fontSize: 7.5, color: "#ccc", fontFamily: FONT }}>
              {rows.length} row{rows.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* Save button */}
          <button
            onClick={onSaveTemplate}
            disabled={saving}
            style={{
              width: "100%", fontFamily: FONT, fontSize: 8, letterSpacing: 2,
              padding: "7px 0", border: "none", borderRadius: 3, cursor: saving ? "wait" : "pointer",
              background: saved ? "#4a9a6a" : GOLD, color: "#fff",
              textTransform: "uppercase", marginBottom: 6,
            }}
          >{saving ? "SAVING…" : saved ? "✓ SAVED" : "SAVE TEMPLATE"}</button>

          {/* Rebuild button */}
          <button
            onClick={rebuild}
            style={{
              width: "100%", fontFamily: FONT, fontSize: 7.5, letterSpacing: 1,
              padding: "5px 0", border: "1px solid #e0ddd6", borderRadius: 3,
              cursor: "pointer", background: "#fff", color: "#888",
              textTransform: "uppercase",
            }}
            title="Rebuild template from current courses"
          >↺ REBUILD FROM COURSES</button>
        </div>

        {/* Scrollable row list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px 0" }}>
          {rows.length === 0 && (
            <div style={{
              textAlign: "center", padding: "32px 16px",
              fontSize: 8.5, color: "#ccc", letterSpacing: 1.5, lineHeight: 2.2,
              textTransform: "uppercase",
            }}>
              NO ROWS YET
              <br />
              <button
                onClick={rebuild}
                style={{
                  marginTop: 10, fontFamily: FONT, fontSize: 8, letterSpacing: 1,
                  padding: "8px 16px", border: `1.5px solid ${GOLD}`, borderRadius: 3,
                  cursor: "pointer", background: "transparent", color: GOLD,
                  textTransform: "uppercase",
                }}
              >↺ Generate Default Template</button>
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
                  onMoveBlock={moveBlock}
                  onRemoveRow={removeRow}
                  onDuplicateRow={duplicateRow}
                  onInsertAbove={insertAbove}
                  onInsertBelow={insertBelow}
                  onUpdateRow={updateRow}
                  menuCourses={menuCourses}
                />
              ))}
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {activeRow ? <OverlayRow row={activeRow} /> : null}
            </DragOverlay>
          </DndContext>
        </div>

        {/* Add row */}
        <div style={{ padding: "8px", flexShrink: 0, borderTop: "1px solid #ede9e0" }}>
          <button
            onClick={addRow}
            style={{
              width: "100%", fontFamily: FONT, fontSize: 8, letterSpacing: 2, padding: "8px 0",
              border: "1.5px dashed #d0cec8", borderRadius: 3, cursor: "pointer",
              background: "transparent", color: "#bbb", textTransform: "uppercase",
              transition: "all 0.12s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.color = GOLD; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "#d0cec8"; e.currentTarget.style.color = "#bbb"; }}
          >+ ADD ROW</button>
        </div>
      </aside>

      {/* ── Center: Live A5 preview (click to deselect) ── */}
      <div style={{ flex: 1, display: "flex" }} onClick={() => setSelectedCell(null)}>
        <LivePreview previewHtml={previewHtml} loading={previewLoading} />
      </div>

      {/* ── Right: Block inspector ── */}
      <aside style={{
        width: 240, flexShrink: 0, borderLeft: "1px solid #ede9e0",
        padding: "14px 14px", overflowY: "auto", background: "#fff",
      }}>
        <div style={{ fontSize: 7.5, letterSpacing: 3, color: "#bbb", textTransform: "uppercase", marginBottom: 14 }}>
          BLOCK INSPECTOR
        </div>
        <BlockInspector
          block={selectedBlock}
          onUpdate={updateSelectedBlock}
          menuCourses={menuCourses}
        />
      </aside>

      {/* Block picker modal */}
      {pickerTarget && (
        <BlockPickerModal
          onPick={pickBlock}
          onClose={() => setPickerTarget(null)}
          menuCourses={menuCourses}
        />
      )}
    </div>
  );
}
