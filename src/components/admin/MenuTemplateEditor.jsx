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

// ── Preview data constants ─────────────────────────────────────────────────────

const PREVIEW_PAIRINGS = [
  { value: "—",         label: "None"      },
  { value: "Wine",      label: "Wine"      },
  { value: "Non-Alc",   label: "Non-Alc"   },
  { value: "Our Story", label: "Our Story" },
  { value: "Premium",   label: "Premium"   },
];

const PREVIEW_RESTRICTIONS = [
  { key: "veg",         label: "Veg"        },
  { key: "vegan",       label: "Vegan"      },
  { key: "gluten",      label: "Gluten-Free"},
  { key: "dairy",       label: "Dairy-Free" },
  { key: "nut",         label: "Nut-Free"   },
  { key: "no_pork",     label: "No Pork"    },
  { key: "no_red_meat", label: "No Red Meat"},
  { key: "no_game",     label: "No Game"    },
  { key: "no_alcohol",  label: "No Alcohol" },
  { key: "shellfish",   label: "Shellfish"  },
];

const APERITIF_QUICK_KEYS = ["SFSC", "Slapšak", "Clandestin", "Krug"];

/** Create a fresh blank preview seat for a given 1-based position. */
const makePreviewSeat = (id) => ({
  id, pairing: "Wine", extras: {},
  aperitifs: [], glasses: [], cocktails: [], beers: [],
  restrictions: [],
});

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
  const pinned = !!row.pinToBottom;
  return (
    <div style={{ padding: "10px 10px 10px 24px", background: "#f8f7f3", borderTop: "1px solid #ede9e0" }}>
      <div style={{ fontFamily: FONT, fontSize: 7.5, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 8 }}>
        ROW SETTINGS
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ fontFamily: FONT, fontSize: 7.5, color: "#999", letterSpacing: 1 }}>GAP ABOVE (pt)</div>
          <input
            type="number"
            value={gap}
            step={0.5}
            onChange={e => onUpdate({ ...row, gap: parseFloat(e.target.value) || 0 })}
            style={{ ...baseInp, width: 50, fontSize: 10, padding: "2px 4px" }}
          />
        </div>
        <button
          onClick={() => onUpdate({ ...row, pinToBottom: !pinned })}
          title="Pin this row to the bottom of the page (margin-top: auto)"
          style={{
            fontFamily: FONT, fontSize: 7.5, letterSpacing: 1, padding: "3px 9px",
            border: `1px solid ${pinned ? SELECTED_RING : "#ddd"}`,
            borderRadius: 2, cursor: "pointer",
            background: pinned ? "#f0f0f8" : "#fff",
            color: pinned ? SELECTED_RING : "#999",
            textTransform: "uppercase",
          }}
        >⤓ {pinned ? "PINNED TO BOTTOM" : "PIN TO BOTTOM"}</button>
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
          {row.pinToBottom && <span title="Pinned to bottom" style={{ fontFamily: FONT, fontSize: 9, color: SELECTED_RING, padding: "0 2px" }}>⤓</span>}
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
const A5_RATIO = A5_PX_W / A5_PX_H; // ≈ 0.705

function LivePreview({ previewHtml, loading, label = "A5" }) {
  const containerRef = useRef(null);
  const [scale, setScale] = useState(0.62);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const avH = el.clientHeight - 50; // header label + padding
      const avW = el.clientWidth - 32;
      const fitH = Math.min(avH / A5_PX_H, avW / A5_PX_W);
      setScale(Math.max(0.35, Math.min(1, fitH)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={containerRef} style={{
      flex: 1, overflow: "hidden", background: "#e8e6e0",
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "20px 16px",
    }}>
      <div style={{
        fontFamily: FONT, fontSize: 7.5, letterSpacing: 3, color: "#aaa",
        textTransform: "uppercase", marginBottom: 14, flexShrink: 0,
      }}>
        LIVE PREVIEW {loading ? "· updating…" : `· ${label}`}
      </div>

      {/* Paper wrapper */}
      <div style={{
        width: A5_PX_W * scale,
        height: A5_PX_H * scale,
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
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
          title="Menu preview"
          sandbox="allow-scripts"
        />
      </div>
    </div>
  );
}

// ── Preview helpers ───────────────────────────────────────────────────────────

/** Compact removable tag for items in preview drink lists */
function DrinkPill({ label, sub, onRemove }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 4,
      background: "#f0f0f8", border: "1px solid #d8d8e8", borderRadius: 2,
      padding: "2px 6px", fontFamily: FONT, fontSize: 8,
    }}>
      <span style={{ color: "#444", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}{sub ? ` · ${sub}` : ""}
      </span>
      <button
        onClick={onRemove}
        style={{ border: "none", background: "transparent", cursor: "pointer", color: "#bbb", fontSize: 10, padding: 0, lineHeight: 1 }}
        onMouseEnter={e => { e.currentTarget.style.color = "#e05050"; }}
        onMouseLeave={e => { e.currentTarget.style.color = "#bbb"; }}
      >×</button>
    </div>
  );
}

/** Inline search dropdown for wines and cocktails in the preview data panel */
function MiniSearch({ wines = [], cocktails = [], spirits = [], beers = [], byGlass = false, bottleOnly = false, placeholder = "search…", onAdd }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const results = (() => {
    if (!q.trim()) return [];
    const lq = q.toLowerCase();
    const out = [];
    const winePool = byGlass ? wines.filter(w => w.byGlass) : wines;
    winePool.forEach(w => {
      if ((w.name || "").toLowerCase().includes(lq) || (w.producer || "").toLowerCase().includes(lq) || (w.vintage || "").includes(lq))
        out.push({ __type: "wine", name: w.name, producer: w.producer, vintage: w.vintage, country: w.country, region: w.region });
    });
    if (!bottleOnly && !byGlass) {
      cocktails.forEach(c => {
        if ((c.name || "").toLowerCase().includes(lq) || (c.notes || "").toLowerCase().includes(lq))
          out.push({ __type: "cocktail", name: c.name, notes: c.notes });
      });
      spirits.forEach(s => {
        if ((s.name || "").toLowerCase().includes(lq) || (s.notes || "").toLowerCase().includes(lq))
          out.push({ __type: "spirit", name: s.name, notes: s.notes });
      });
      beers.forEach(b => {
        if ((b.name || "").toLowerCase().includes(lq) || (b.notes || "").toLowerCase().includes(lq))
          out.push({ __type: "beer", name: b.name, notes: b.notes });
      });
    }
    return out.slice(0, 8);
  })();

  const pick = item => { onAdd(item); setQ(""); setOpen(false); };

  return (
    <div ref={ref} style={{ position: "relative", flex: 1 }}>
      <input
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(e.target.value.trim().length > 0); }}
        placeholder={placeholder}
        style={{ ...baseInp, fontSize: 9, padding: "3px 7px", width: "100%" }}
        autoComplete="off"
      />
      {open && results.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 2px)", left: 0, right: 0, zIndex: 500,
          background: "#fff", border: "1px solid #e0e0e0", borderRadius: 3,
          boxShadow: "0 4px 16px rgba(0,0,0,0.12)", maxHeight: 180, overflowY: "auto",
        }}>
          {results.map((r, i) => (
            <div key={i} onMouseDown={() => pick(r)} style={{
              padding: "6px 10px", cursor: "pointer", fontFamily: FONT,
              borderBottom: "1px solid #f4f4f4",
            }}
              onMouseEnter={e => { e.currentTarget.style.background = "#f4f3fb"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "#fff"; }}
            >
              <div style={{ fontSize: 9, fontWeight: 700, color: "#222" }}>{r.name}</div>
              <div style={{ fontSize: 8, color: "#999" }}>
                {r.__type === "wine" ? [r.producer, r.vintage, r.country].filter(Boolean).join(" · ") : (r.notes || "")}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The collapsible preview data configuration panel */
function PreviewDataPanel({
  wines, cocktails, spirits, beers,
  guests, onGuestsChange,
  seatIdx, onSeatIdxChange,
  seats, onUpdateSeat,
  bottleWines, onBottleWinesChange,
  lang, onLangChange,
  menuType, onMenuTypeChange,
  open, onToggle,
}) {
  const seat = seats[seatIdx] || makePreviewSeat(seatIdx + 1);

  const updSeat = patch => onUpdateSeat(seatIdx, patch);

  const addGlass  = item => updSeat({ glasses:   [...seat.glasses,   item] });
  const addAp     = item => updSeat({ aperitifs: [...seat.aperitifs, { ...item, __type: item.__type || "wine" }] });
  const addCock   = item => updSeat({ cocktails: [...seat.cocktails, item] });
  const addBottle = item => onBottleWinesChange([...bottleWines, item]);

  const apQuickAdd = label => {
    const q = label.toLowerCase();
    const w = wines.find(x => (x.name || "").toLowerCase().includes(q));
    if (w) { addAp({ __type: "wine", name: w.name, producer: w.producer, vintage: w.vintage, country: w.country, region: w.region }); return; }
    const sp = spirits.find(x => (x.name || "").toLowerCase().includes(q));
    if (sp) { addAp({ __type: "cocktail", name: sp.name, notes: sp.notes || "" }); return; }
    const ck = cocktails.find(x => (x.name || "").toLowerCase().includes(q));
    if (ck) { addAp({ __type: "cocktail", name: ck.name, notes: ck.notes || "" }); return; }
    const b = beers.find(x => (x.name || "").toLowerCase().includes(q));
    if (b) { addAp({ __type: "beer", name: b.name, notes: b.notes || "" }); return; }
    // No catalog match — do NOT add a bare text label
  };

  const toggleRestriction = key => {
    const cur = seat.restrictions || [];
    updSeat({ restrictions: cur.includes(key) ? cur.filter(k => k !== key) : [...cur, key] });
  };

  const btnStyle = (active) => ({
    fontFamily: FONT, fontSize: 8, letterSpacing: 0.5,
    padding: "3px 8px", border: `1px solid ${active ? SELECTED_RING : "#ddd"}`,
    borderRadius: 2, cursor: "pointer",
    background: active ? "#f0f0f8" : "#fff",
    color: active ? SELECTED_RING : "#666",
  });

  const seatTabStyle = (i) => ({
    fontFamily: FONT, fontSize: 8.5, letterSpacing: 1, padding: "3px 10px",
    border: "none", borderBottom: `2px solid ${seatIdx === i ? SELECTED_RING : "transparent"}`,
    background: "transparent", cursor: "pointer",
    color: seatIdx === i ? SELECTED_RING : "#aaa", fontWeight: seatIdx === i ? 700 : 400,
  });

  return (
    <div style={{
      borderBottom: "1px solid #ede9e0", background: "#fdf9f4",
      flexShrink: 0, overflow: "hidden",
    }}>
      {/* Header strip — always visible */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "5px 12px", borderBottom: open ? "1px solid #ede9e0" : "none",
      }}>
        <button
          onClick={onToggle}
          style={{ fontFamily: FONT, fontSize: 7.5, letterSpacing: 2, color: "#c8a96e", background: "none", border: "none", cursor: "pointer", padding: 0, textTransform: "uppercase" }}
        >{open ? "▾ PREVIEW DATA" : "▸ PREVIEW DATA"}</button>

        <div style={{ width: 1, height: 14, background: "#e8e4dc", flexShrink: 0 }} />

        {/* Seat tabs */}
        {Array.from({ length: guests }, (_, i) => (
          <button key={i} style={seatTabStyle(i)} onClick={() => onSeatIdxChange(i)}>
            P{i + 1}
          </button>
        ))}

        {/* Guests stepper */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 2 }}>
          <span style={{ fontFamily: FONT, fontSize: 7.5, color: "#aaa", letterSpacing: 1 }}>GUESTS</span>
          <button onClick={() => onGuestsChange(guests - 1)} disabled={guests <= 1} style={{ ...btnStyle(false), padding: "2px 6px", fontSize: 10 }}>-</button>
          <span style={{ fontFamily: FONT, fontSize: 9, color: "#444", minWidth: 14, textAlign: "center" }}>{guests}</span>
          <button onClick={() => onGuestsChange(guests + 1)} disabled={guests >= 8} style={{ ...btnStyle(false), padding: "2px 6px", fontSize: 10 }}>+</button>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          {/* Lang toggle */}
          <span style={{ fontFamily: FONT, fontSize: 7.5, color: "#aaa" }}>LANG</span>
          {["en","si"].map(l => (
            <button key={l} onClick={() => onLangChange(l)} style={btnStyle(lang === l)}>{l.toUpperCase()}</button>
          ))}
          {/* Menu type toggle */}
          <span style={{ fontFamily: FONT, fontSize: 7.5, color: "#aaa", marginLeft: 4 }}>MENU</span>
          <button onClick={() => onMenuTypeChange("")}      style={btnStyle(menuType === "")}>FULL</button>
          <button onClick={() => onMenuTypeChange("short")} style={btnStyle(menuType === "short")}>SHORT</button>
        </div>
      </div>

      {/* Expanded body */}
      {open && (
        <div style={{ display: "flex", gap: 0, padding: "10px 12px", overflowX: "auto" }}>

          {/* Column 1: Pairing + Restrictions */}
          <div style={{ minWidth: 190, marginRight: 16 }}>
            <div style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>
              P{seatIdx + 1} PAIRING
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 12 }}>
              {PREVIEW_PAIRINGS.map(p => (
                <button key={p.value} onClick={() => updSeat({ pairing: p.value })} style={btnStyle(seat.pairing === p.value)}>
                  {p.label}
                </button>
              ))}
            </div>
            <div style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>
              P{seatIdx + 1} RESTRICTIONS
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 12 }}>
              {PREVIEW_RESTRICTIONS.map(r => (
                <button key={r.key} onClick={() => toggleRestriction(r.key)} style={btnStyle((seat.restrictions || []).includes(r.key))}>
                  {r.label}
                </button>
              ))}
            </div>
            <div style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>
              P{seatIdx + 1} EXTRAS
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {[{ id: 1, label: "Beetroot" }, { id: 2, label: "Cheese" }].map(ex => {
                const active = !!(seat.extras || {})[ex.id]?.ordered;
                return (
                  <button key={ex.id} onClick={() => {
                    const cur = { ...(seat.extras || {}) };
                    cur[ex.id] = { ordered: !active };
                    updSeat({ extras: cur });
                  }} style={btnStyle(active)}>{ex.label}</button>
                );
              })}
              <button
                onClick={() => updSeat({ _birthday: !seat._birthday })}
                style={btnStyle(!!seat._birthday)}
              >Birthday / Cake</button>
            </div>
          </div>

          {/* Divider */}
          <div style={{ width: 1, background: "#ede9e0", flexShrink: 0, marginRight: 16 }} />

          {/* Column 2: By-glass + Aperitifs */}
          <div style={{ minWidth: 200, marginRight: 16 }}>
            <div style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 5 }}>
              P{seatIdx + 1} BY-THE-GLASS
            </div>
            <div style={{ display: "flex", gap: 4, marginBottom: 5 }}>
              <MiniSearch wines={wines} cocktails={[]} spirits={[]} beers={[]} byGlass placeholder="search wine…" onAdd={addGlass} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 10 }}>
              {seat.glasses.map((w, i) => (
                <DrinkPill key={i} label={w.name} sub={w.vintage} onRemove={() => updSeat({ glasses: seat.glasses.filter((_, j) => j !== i) })} />
              ))}
            </div>

            <div style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 5 }}>
              P{seatIdx + 1} APERITIFS
            </div>
            <div style={{ display: "flex", gap: 3, flexWrap: "wrap", marginBottom: 4 }}>
              {APERITIF_QUICK_KEYS.map(k => (
                <button key={k} onClick={() => apQuickAdd(k)} style={{ ...btnStyle(false), fontSize: 7.5 }}>{k}</button>
              ))}
            </div>
            <div style={{ display: "flex", gap: 4, marginBottom: 5 }}>
              <MiniSearch wines={wines} cocktails={cocktails} spirits={spirits} beers={beers} placeholder="search aperitif…" onAdd={addAp} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {seat.aperitifs.map((a, i) => (
                <DrinkPill key={i} label={a.name} sub={a.vintage} onRemove={() => updSeat({ aperitifs: seat.aperitifs.filter((_, j) => j !== i) })} />
              ))}
            </div>
          </div>

          {/* Divider */}
          <div style={{ width: 1, background: "#ede9e0", flexShrink: 0, marginRight: 16 }} />

          {/* Column 3: Cocktails + Bottle wines */}
          <div style={{ minWidth: 200 }}>
            <div style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 5 }}>
              P{seatIdx + 1} COCKTAILS
            </div>
            <div style={{ display: "flex", gap: 4, marginBottom: 5 }}>
              <MiniSearch wines={[]} cocktails={cocktails} spirits={spirits} beers={beers} placeholder="search cocktail…" onAdd={addCock} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 10 }}>
              {seat.cocktails.map((c, i) => (
                <DrinkPill key={i} label={c.name || c.label} onRemove={() => updSeat({ cocktails: seat.cocktails.filter((_, j) => j !== i) })} />
              ))}
            </div>

            <div style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 5 }}>
              TABLE BOTTLE WINES
            </div>
            <div style={{ display: "flex", gap: 4, marginBottom: 5 }}>
              <MiniSearch wines={wines} cocktails={[]} spirits={[]} beers={[]} bottleOnly placeholder="search bottle wine…" onAdd={addBottle} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
              {bottleWines.map((w, i) => (
                <DrinkPill key={i} label={w.name} sub={w.vintage} onRemove={() => onBottleWinesChange(bottleWines.filter((_, j) => j !== i))} />
              ))}
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export default function MenuTemplateEditor({
  menuTemplate,
  onUpdateTemplate,
  onSaveTemplate,
  onUpdateLayoutStyles,
  onSaveLayoutStyles,
  saving  = false,
  saved   = false,
  menuCourses = [],
  logoDataUri = "",
  layoutStyles = {},
  wines = [],
  cocktails = [],
  spirits = [],
  beers = [],
}) {
  const [selectedCell, setSelectedCell] = useState(null); // { rowId, side }
  const [pickerTarget, setPickerTarget] = useState(null); // { rowId, side }
  const [activeRowId,  setActiveRowId]  = useState(null);
  const [previewHtml,  setPreviewHtml]  = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [leftOpen,    setLeftOpen]    = useState(true);
  const [rightOpen,   setRightOpen]   = useState(true);
  const [previewOpen, setPreviewOpen] = useState(true);
  const previewTimer = useRef(null);

  // ── Preview data state — configurable dummy seat (not persisted) ──
  const [previewDataOpen, setPreviewDataOpen] = useState(false);
  const [previewGuests,   setPreviewGuestsRaw] = useState(1);
  const [previewSeatIdx,  setPreviewSeatIdx]   = useState(0);
  const [previewSeats,    setPreviewSeats]      = useState([makePreviewSeat(1)]);
  const [previewBottles,  setPreviewBottles]    = useState([]);
  const [previewLang,     setPreviewLang]       = useState("en");
  const [previewMenuType, setPreviewMenuType]   = useState("");

  const setPreviewGuests = (n) => {
    const count = Math.max(1, Math.min(8, n));
    setPreviewGuestsRaw(count);
    setPreviewSeats(prev => Array.from({ length: count }, (_, i) => prev[i] || makePreviewSeat(i + 1)));
    setPreviewSeatIdx(prev => prev >= count ? count - 1 : prev);
  };

  const updatePreviewSeat = (idx, patch) => {
    setPreviewSeats(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  };

  const template = menuTemplate || { version: 2, rows: [] };
  const rows = template.rows || [];

  // ── Derive menu title / thank-you from template blocks (lang-aware) ──
  const pickLangText = (block, enFallback, siFallback) => {
    if (!block) return previewLang === "si" ? siFallback : enFallback;
    return previewLang === "si"
      ? (block.text_si?.trim() || block.text?.trim() || siFallback)
      : (block.text?.trim() || enFallback);
  };
  const menuTitle = (() => {
    for (const r of rows) {
      const tb = r.left?.type === "title" ? r.left : r.right?.type === "title" ? r.right : null;
      if (tb) return pickLangText(tb, "WINTER MENU", "ZIMSKI MENI");
    }
    return previewLang === "si" ? "ZIMSKI MENI" : "WINTER MENU";
  })();
  const thankYouNote = (() => {
    for (const r of rows) {
      const gb = r.left?.type === "goodbye" ? r.left : r.right?.type === "goodbye" ? r.right : null;
      if (gb) return pickLangText(gb, "Thank you for your visit.", "Hvala za vaš obisk.");
    }
    return previewLang === "si" ? "Hvala za vaš obisk." : "Thank you for your visit.";
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

  // ── Live preview (debounced 250ms) — uses configurable dummy seat ──
  useEffect(() => {
    clearTimeout(previewTimer.current);
    setPreviewLoading(true);
    previewTimer.current = setTimeout(() => {
      try {
        const seat = previewSeats[previewSeatIdx] || makePreviewSeat(previewSeatIdx + 1);
        const table = {
          menuType: previewMenuType,
          restrictions: (seat.restrictions || []).map(key => ({ note: key, pos: seat.id })),
          bottleWines: previewBottles,
          birthday: !!seat._birthday,
        };
        const html = generateMenuHTML({
          seat,
          table,
          menuCourses,
          menuTemplate: template,
          _logo: logoDataUri,
          menuTitle,
          thankYouNote,
          teamNames: "Service Team",
          lang: previewLang,
          beerChoice: null,
          layoutStyles,
        });
        setPreviewHtml(html);
      } catch {}
      setPreviewLoading(false);
    }, 250);
    return () => clearTimeout(previewTimer.current);
  }, [template, menuCourses, logoDataUri, layoutStyles, previewSeats, previewSeatIdx, previewBottles, previewLang, previewMenuType]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback(newRows => {
    onUpdateTemplate({ ...template, rows: newRows });
  }, [template, onUpdateTemplate]);

  // ── Short-menu row filter ──
  const isShortFilter = previewMenuType === "short";
  const rowMatchesShort = (row) => {
    const hasCourse = b => b?.type === "course";
    if (!hasCourse(row.left) && !hasCourse(row.right)) return true;
    const ok = b => hasCourse(b) && !!menuCourses.find(c => c.course_key === b.courseKey)?.show_on_short;
    return ok(row.left) || ok(row.right);
  };
  const visibleRows = isShortFilter ? rows.filter(rowMatchesShort) : rows;

  // In short mode, display rows in short_order to match the preview order.
  const displayRows = (() => {
    if (!isShortFilter) return visibleRows;
    const isCourseRow = r => r.left?.type === "course" || r.right?.type === "course";
    const courseIdxs = visibleRows.reduce((acc, r, i) => { if (isCourseRow(r)) acc.push(i); return acc; }, []);
    if (courseIdxs.length === 0) return visibleRows;
    const withOrder = courseIdxs.map(i => {
      const cb = visibleRows[i].left?.type === "course" ? visibleRows[i].left : visibleRows[i].right;
      const mc = menuCourses.find(c => c.course_key === (cb?.courseKey || ""));
      return { i, order: Number(mc?.short_order) ?? 9999 };
    });
    const sorted = [...withOrder].sort((a, b) => a.order - b.order);
    const reordered = [...visibleRows];
    courseIdxs.forEach((origIdx, slot) => { reordered[origIdx] = visibleRows[sorted[slot].i]; });
    return reordered;
  })();

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
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 130px)", minHeight: 500, fontFamily: FONT }}>

      {/* ── Preview Data Panel (collapsible strip above 3 panels) ── */}
      <PreviewDataPanel
        wines={wines} cocktails={cocktails} spirits={spirits} beers={beers}
        guests={previewGuests}     onGuestsChange={setPreviewGuests}
        seatIdx={previewSeatIdx}   onSeatIdxChange={setPreviewSeatIdx}
        seats={previewSeats}       onUpdateSeat={updatePreviewSeat}
        bottleWines={previewBottles} onBottleWinesChange={setPreviewBottles}
        lang={previewLang}         onLangChange={setPreviewLang}
        menuType={previewMenuType} onMenuTypeChange={setPreviewMenuType}
        open={previewDataOpen}     onToggle={() => setPreviewDataOpen(v => !v)}
      />

      {/* ── Three-panel layout ── */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, gap: 0 }}>

      {/* ── Left: Row editor ── */}
      <aside style={{
        width: leftOpen ? 288 : 28, flexShrink: 0, borderRight: "1px solid #ede9e0",
        background: "#faf9f7", display: "flex", flexDirection: "column",
        overflow: "hidden", transition: "width 0.18s ease",
      }}>
        {/* Header */}
        <div style={{ padding: leftOpen ? "12px 12px 8px" : "8px 4px", borderBottom: "1px solid #ede9e0", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: leftOpen ? 8 : 0 }}>
            {leftOpen && (
              <span style={{ fontSize: 7.5, letterSpacing: 3, color: "#bbb", textTransform: "uppercase" }}>
                LAYOUT EDITOR
              </span>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: leftOpen ? 0 : "auto", marginRight: leftOpen ? 0 : "auto" }}>
              {leftOpen && (
                <span style={{ fontSize: 7.5, color: "#ccc", fontFamily: FONT }}>
                  {rows.length} row{rows.length !== 1 ? "s" : ""}
                </span>
              )}
              <button
                onClick={() => setLeftOpen(v => !v)}
                title={leftOpen ? "Collapse panel" : "Expand panel"}
                style={{
                  border: "none", background: "transparent", cursor: "pointer",
                  color: "#ccc", fontSize: 12, padding: "2px 4px", lineHeight: 1,
                  fontFamily: FONT,
                }}
                onMouseEnter={e => { e.currentTarget.style.color = GOLD; }}
                onMouseLeave={e => { e.currentTarget.style.color = "#ccc"; }}
              >{leftOpen ? "◂" : "▸"}</button>
            </div>
          </div>

          {/* Save button */}
          {leftOpen && <button
            onClick={onSaveTemplate}
            disabled={saving}
            style={{
              width: "100%", fontFamily: FONT, fontSize: 8, letterSpacing: 2,
              padding: "7px 0", border: "none", borderRadius: 3, cursor: saving ? "wait" : "pointer",
              background: saved ? "#4a9a6a" : GOLD, color: "#fff",
              textTransform: "uppercase", marginBottom: 6,
            }}
          >{saving ? "SAVING…" : saved ? "✓ SAVED" : "SAVE TEMPLATE"}</button>}

          {/* Rebuild button */}
          {leftOpen && (
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
          )}

          {/* Column gap control */}
          {leftOpen && onUpdateLayoutStyles && (
            <div style={{ marginTop: 10, borderTop: "1px solid #ede9e0", paddingTop: 8 }}>
              <div style={{ fontFamily: FONT, fontSize: 7.5, letterSpacing: 1, color: "#bbb", textTransform: "uppercase", marginBottom: 5 }}>Column Gap</div>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <input
                  type="number"
                  step="0.5"
                  value={layoutStyles.colGap ?? ""}
                  placeholder="9"
                  onChange={e => {
                    const raw = e.target.value;
                    const next = { ...layoutStyles };
                    if (raw === "" || isNaN(parseFloat(raw))) delete next.colGap;
                    else next.colGap = parseFloat(raw);
                    onUpdateLayoutStyles(next);
                  }}
                  style={{ fontFamily: FONT, fontSize: 10, padding: "4px 6px", border: "1px solid #ddd", borderRadius: 3, width: 54, textAlign: "center" }}
                />
                <span style={{ fontFamily: FONT, fontSize: 9, color: "#aaa" }}>mm</span>
                {onSaveLayoutStyles && (
                  <button onClick={onSaveLayoutStyles} style={{
                    fontFamily: FONT, fontSize: 8, letterSpacing: 1, padding: "4px 8px",
                    border: "1px solid #4b4b88", borderRadius: 2, cursor: "pointer",
                    background: "#4b4b88", color: "#fff", marginLeft: "auto",
                  }}>SAVE</button>
                )}
              </div>
              {"colGap" in layoutStyles && (
                <button onClick={() => { const next = { ...layoutStyles }; delete next.colGap; onUpdateLayoutStyles(next); }}
                  style={{ fontFamily: FONT, fontSize: 7.5, color: "#bbb", background: "none", border: "none", cursor: "pointer", padding: "2px 0", marginTop: 2 }}>
                  reset to default
                </button>
              )}
            </div>
          )}
        </div>

        {/* Scrollable row list */}
        {leftOpen && <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px 0" }}>
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
            {isShortFilter && (
              <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#7a5020", background: "#fff8ee", border: "1px solid #f0d080", borderRadius: 3, padding: "5px 8px", margin: "0 0 6px", textTransform: "uppercase" }}>
                Short menu — {displayRows.length} blocks · Switch to FULL to see all
              </div>
            )}
            <SortableContext items={displayRows.map(r => r.id)} strategy={verticalListSortingStrategy}>
              {displayRows.map(row => (
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
        </div>}

        {/* Add row */}
        {leftOpen && <div style={{ padding: "8px", flexShrink: 0, borderTop: "1px solid #ede9e0" }}>
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
        </div>}
      </aside>

      {/* ── Center: Live A5 preview (collapsible, click to deselect) ── */}
      <div style={{
        flex: previewOpen ? 1 : 0,
        display: "flex", flexDirection: "column",
        transition: "flex 0.18s ease",
        minWidth: previewOpen ? 200 : 28,
        borderLeft: "1px solid #ede9e0", borderRight: "1px solid #ede9e0",
      }}>
        {!previewOpen && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 8 }}>
            <button
              onClick={() => setPreviewOpen(true)}
              title="Show preview"
              style={{ border: "none", background: "transparent", cursor: "pointer", color: "#ccc", fontSize: 12, padding: "2px 4px", lineHeight: 1, fontFamily: FONT }}
              onMouseEnter={e => { e.currentTarget.style.color = GOLD; }}
              onMouseLeave={e => { e.currentTarget.style.color = "#ccc"; }}
            >◂▸</button>
            <span style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 1, color: "#ccc", writingMode: "vertical-lr", marginTop: 8 }}>PREVIEW</span>
          </div>
        )}
        {previewOpen && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative" }} onClick={() => setSelectedCell(null)}>
            <button
              onClick={(e) => { e.stopPropagation(); setPreviewOpen(false); }}
              title="Collapse preview"
              style={{ position: "absolute", top: 6, right: 6, zIndex: 2, border: "none", background: "transparent", cursor: "pointer", color: "#ccc", fontSize: 10, padding: "2px 4px", lineHeight: 1, fontFamily: FONT }}
              onMouseEnter={e => { e.currentTarget.style.color = GOLD; }}
              onMouseLeave={e => { e.currentTarget.style.color = "#ccc"; }}
            >✕</button>
            <LivePreview
              previewHtml={previewHtml}
              loading={previewLoading}
              label={`P${previewSeatIdx + 1} · ${(previewSeats[previewSeatIdx]?.pairing || "—")} · ${previewLang.toUpperCase()}${previewMenuType === "short" ? " · SHORT" : ""}`}
            />
          </div>
        )}
      </div>

      {/* ── Right: Block inspector ── */}
      <aside style={{
        width: rightOpen ? 240 : 28, flexShrink: 0, borderLeft: "1px solid #ede9e0",
        overflowY: rightOpen ? "auto" : "hidden", background: "#fff",
        display: "flex", flexDirection: "column",
        transition: "width 0.18s ease",
      }}>
        {/* Collapse toggle */}
        <div style={{ padding: rightOpen ? "10px 14px 6px" : "8px 4px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: rightOpen ? "space-between" : "center" }}>
          {rightOpen && (
            <span style={{ fontFamily: FONT, fontSize: 7.5, letterSpacing: 3, color: "#bbb", textTransform: "uppercase" }}>
              BLOCK INSPECTOR
            </span>
          )}
          <button
            onClick={() => setRightOpen(v => !v)}
            title={rightOpen ? "Collapse panel" : "Expand panel"}
            style={{
              border: "none", background: "transparent", cursor: "pointer",
              color: "#ccc", fontSize: 12, padding: "2px 4px", lineHeight: 1,
              fontFamily: FONT,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = GOLD; }}
            onMouseLeave={e => { e.currentTarget.style.color = "#ccc"; }}
          >{rightOpen ? "▸" : "◂"}</button>
        </div>
        {rightOpen && (
          <div style={{ padding: "0 14px 14px", flex: 1, overflowY: "auto" }}>
            <BlockInspector
              block={selectedBlock}
              onUpdate={updateSelectedBlock}
              menuCourses={menuCourses}
            />
          </div>
        )}
      </aside>

      {/* Block picker modal */}
      {pickerTarget && (
        <BlockPickerModal
          onPick={pickBlock}
          onClose={() => setPickerTarget(null)}
          menuCourses={menuCourses}
        />
      )}
      </div>{/* end three-panel */}
    </div>
  );
}
