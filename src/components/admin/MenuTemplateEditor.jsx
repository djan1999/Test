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
import { tokens } from "../../styles/tokens.js";
import {
  BLOCK_META, BLOCK_GROUPS, makeRowId, makeBlock, makeRow, buildDefaultTemplate,
} from "../../utils/menuTemplateSchema.js";
import { generateMenuHTML, DEFAULT_MENU_RULES, normalizeMenuRules } from "../../utils/menuGenerator.js";
import { readMenuTitle, writeMenuTitle, readThankYouNote, writeThankYouNote, readTeamNames, writeTeamNames } from "../../utils/storage.js";
import { supabase, TABLES } from "../../lib/supabaseClient.js";
import { LayoutStylesPanel } from "./MenuTemplatePanels.jsx";
import { PreviewDataPanel } from "./MenuTemplatePreviewParts.jsx";

// ── Constants ─────────────────────────────────────────────────────────────────

const GOLD = tokens.charcoal.default;
const SELECTED_RING = tokens.charcoal.default;
const CELL_EMPTY_BG = tokens.ink[5];
const CELL_EMPTY_BORDER = tokens.ink[4];

// ── Preview data constants ─────────────────────────────────────────────────────

/** Create a fresh blank preview seat for a given 1-based position. */
const makePreviewSeat = (id) => ({
  id,
  pairing: "Wine",
  extras: {},
  aperitifs: [],
  glasses: [],
  cocktails: [],
  beers: [],
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
          flex: 1, minWidth: 0, height: 36, borderRadius: 0,
          border: `1.5px dashed ${CELL_EMPTY_BORDER}`,
          background: CELL_EMPTY_BG,
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer",
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = GOLD; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = CELL_EMPTY_BORDER; }}
      >
        <span style={{ fontFamily: FONT, fontSize: 13, color: tokens.ink[4], fontWeight: 700 }}>+</span>
      </div>
    );
  }

  const accentCol = meta?.color || tokens.ink[3];

  return (
    <div
      onClick={() => onSelect(rowId, side)}
      style={{
        flex: 1, minWidth: 0, height: 36, borderRadius: 0, cursor: "pointer",
        border: `1.5px solid ${isSelected ? SELECTED_RING : tokens.ink[4]}`,
        background: isSelected ? tokens.ink[5] : (meta?.bg || tokens.ink.bg),
        display: "flex", alignItems: "center", gap: 0,
        overflow: "hidden", position: "relative",
        transition: "border-color 0.1s",
      }}
    >
      <div style={{ width: 3, alignSelf: "stretch", background: accentCol, flexShrink: 0 }} />
      <span style={{
        fontFamily: FONT, fontSize: 10, color: isSelected ? SELECTED_RING : tokens.ink[1],
        padding: "0 7px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        flex: 1, letterSpacing: 0.2,
      }}>
        {chipLabel(block, menuCourses)}
      </span>
      {/* Move to other cell */}
      <button
        onClick={e => { e.stopPropagation(); onMove(rowId, side); }}
        title={side === "left" ? "Move to right cell" : "Move to left cell"}
        style={{
          flexShrink: 0, border: "none", background: "transparent",
          cursor: "pointer", color: tokens.ink[4], fontSize: 10, padding: "0 4px", height: "100%",
        }}
        onMouseEnter={e => { e.currentTarget.style.color = tokens.charcoal.default; }}
        onMouseLeave={e => { e.currentTarget.style.color = tokens.ink[4]; }}
      >{side === "left" ? "→" : "←"}</button>
      <button
        onClick={e => { e.stopPropagation(); onRemove(rowId, side); }}
        style={{
          flexShrink: 0, border: "none", background: "transparent",
          cursor: "pointer", color: tokens.ink[4], fontSize: 11, padding: "0 5px", height: "100%",
        }}
        onMouseEnter={e => { e.currentTarget.style.color = tokens.red.text; }}
        onMouseLeave={e => { e.currentTarget.style.color = tokens.ink[4]; }}
      >×</button>
    </div>
  );
}

// ── Row settings removed ─────────────────────────────────────────────────────

// ── Sortable row (in left panel) ──────────────────────────────────────────────

function SortableRow({
  row, selectedCell, onSelectCell, onRemoveBlock, onAddBlock, onMoveBlock, onRemoveRow,
  onDuplicateRow, onInsertAbove, onInsertBelow, onUpdateRow,
  menuCourses,
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: row.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

  const leftSelected  = selectedCell?.rowId === row.id && selectedCell?.side === "left";
  const rightSelected = selectedCell?.rowId === row.id && selectedCell?.side === "right";
  // Gap rows are explicit "spacing" rows: both cells empty AND gap > 0.
  // Empty content rows (both cells empty, gap = 0) should still allow adding blocks.
  const isGapRow = !row.left && !row.right && (Number(row.gap || 0) > 0);

  return (
    <div ref={setNodeRef} style={{ ...style, marginBottom: 3 }}>

      {isGapRow ? (
        /* ── Gap row — both cells empty, show gap inline ── */
        <div style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: "5px 6px",
          background: tokens.ink.bg,
          border: `1.5px dashed ${tokens.ink[4]}`,
          borderRadius: 0,
        }}>
          <div
            {...attributes} {...listeners}
            style={{ width: 14, cursor: "grab", color: tokens.ink[4], fontSize: 10, userSelect: "none", textAlign: "center", flexShrink: 0 }}
            title="Drag to reorder"
          >⋮⋮</div>
          <span style={{ fontFamily: FONT, fontSize: 7.5, letterSpacing: 2, color: tokens.ink[2], textTransform: "uppercase", flexShrink: 0 }}>
            GAP
          </span>
          <input
            type="number"
            value={row.gap ?? 0}
            step={0.5}
            min={0}
            onClick={e => e.stopPropagation()}
            onChange={e => onUpdateRow({ ...row, gap: parseFloat(e.target.value) || 0 })}
            style={{
              fontFamily: FONT, fontSize: 9, padding: "2px 4px",
              border: `1px solid ${tokens.ink[4]}`, borderRadius: 0,
              width: 46, textAlign: "center", background: tokens.neutral[0],
            }}
          />
          <span style={{ fontFamily: FONT, fontSize: 8, color: tokens.ink[4], flexShrink: 0 }}>pt</span>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 1, flexShrink: 0 }}>
            <RowActionBtn title="Insert row above" onClick={() => onInsertAbove(row.id)}>↑</RowActionBtn>
            <RowActionBtn title="Insert row below" onClick={() => onInsertBelow(row.id)}>↓</RowActionBtn>
            <RowActionBtn title="Duplicate gap row" onClick={() => onDuplicateRow(row.id)}>⎘</RowActionBtn>
            <RowActionBtn title="Delete gap row" onClick={() => onRemoveRow(row.id)} danger>⊗</RowActionBtn>
          </div>
        </div>
      ) : (
        /* ── Normal content row ── */
        <>
          <div style={{
            display: "flex", alignItems: "center", gap: 4,
            padding: "3px 6px 3px 4px",
            background: (leftSelected || rightSelected) ? tokens.ink[5] : tokens.neutral[0],
            border: `1px solid ${(leftSelected || rightSelected) ? tokens.ink[4] : tokens.ink[4]}`,
            borderRadius: 0,
          }}>
            {/* Drag handle */}
            <div
              {...attributes} {...listeners}
              style={{ width: 14, cursor: "grab", color: tokens.ink[4], fontSize: 10, userSelect: "none", textAlign: "center", flexShrink: 0 }}
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
              <RowActionBtn
                title={row.pinToBottom ? "Unpin from bottom" : "Pin to bottom"}
                onClick={() => onUpdateRow({ ...row, pinToBottom: !row.pinToBottom })}
                active={!!row.pinToBottom}
              >⤓</RowActionBtn>
              <RowActionBtn title="Delete row" onClick={() => onRemoveRow(row.id)} danger>⊗</RowActionBtn>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function RowActionBtn({ children, onClick, title, danger = false, active = false }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      onClick={onClick} title={title} aria-label={title}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        width: 32, height: 36, border: "none", borderRadius: 0, cursor: "pointer",
        fontFamily: FONT, fontSize: 12, padding: 0, lineHeight: 1,
        background: active ? tokens.ink[5] : hov ? (danger ? tokens.red.bg : tokens.ink[5]) : "transparent",
        color: active ? SELECTED_RING : hov ? (danger ? tokens.red.text : SELECTED_RING) : tokens.ink[4],
        transition: "all 0.1s",
        touchAction: "manipulation",
      }}
    >{children}</button>
  );
}

// ── Drag overlay ──────────────────────────────────────────────────────────────

function OverlayRow({ row }) {
  return (
    <div style={{
      background: tokens.neutral[0], border: `1.5px solid ${SELECTED_RING}`, borderRadius: 0,
      padding: "5px 10px", opacity: 0.9,
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
          background: tokens.neutral[0], borderRadius: 0, padding: "20px 24px",
          width: 500, maxHeight: "75vh", overflowY: "auto",
          fontFamily: FONT,
        }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
          <span style={{ fontSize: 9, letterSpacing: 3, textTransform: "uppercase", color: tokens.ink[0], fontWeight: 700 }}>
            ADD BLOCK
          </span>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, color: tokens.ink[4] }}>×</button>
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
                <div style={{ fontSize: 7.5, letterSpacing: 3, color: tokens.ink[4], textTransform: "uppercase", marginBottom: 8 }}>
                  {group.label}
                  <span style={{ marginLeft: 8, fontSize: 7, color: tokens.ink[4], letterSpacing: 1 }}>{group.desc}</span>
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
                      borderColor: hov === type ? meta.color : tokens.ink[4],
                      borderRadius: 0, cursor: "pointer",
                      background: hov === type ? (meta.bg || tokens.ink.bg) : tokens.ink.bg,
                      textAlign: "left", transition: "all 0.1s",
                    }}
                  >
                    <span style={{ fontSize: 13, color: meta.color, width: 18, textAlign: "center", flexShrink: 0 }}>
                      {meta.icon}
                    </span>
                    <div>
                      <div style={{ fontSize: 8.5, letterSpacing: 0.5, fontWeight: 700, color: tokens.ink[0], marginBottom: 2 }}>
                        {meta.label}
                      </div>
                      <div style={{ fontSize: 7, color: tokens.ink[3], lineHeight: 1.4 }}>
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
            width: 32, height: 26, border: `1px solid ${value === o.v ? SELECTED_RING : tokens.ink[4]}`,
            borderRadius: 0, cursor: "pointer", fontFamily: FONT, fontSize: 11,
            background: value === o.v ? tokens.ink[5] : tokens.neutral[0],
            color: value === o.v ? SELECTED_RING : tokens.ink[3],
          }}
        >{o.icon}</button>
      ))}
    </div>
  );
}

function BlockInspector({ block, onUpdate, menuCourses, wines = [], cocktails = [], spirits = [], beers = [] }) {
  if (!block) return (
    <div style={{ fontFamily: FONT, fontSize: 8.5, color: tokens.ink[4], letterSpacing: 1, padding: "24px 0", textAlign: "center", lineHeight: 2 }}>
      SELECT A CELL<br />TO CONFIGURE
    </div>
  );

  const meta = BLOCK_META[block.type] || {};
  const fields = meta.fields || [];

  const setField = (key, val) => onUpdate({ ...block, [key]: val });

  const isDrinks = block.type === "drinks";
  const drinkSource = isDrinks ? (block.drinkSource || "pairing") : null;

  if (fields.length === 0 && !isDrinks) return (
    <div>
      <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: meta.color || tokens.ink[3], textTransform: "uppercase", marginBottom: 8 }}>
        {meta.icon} {meta.label}
      </div>
      <div style={{ fontFamily: FONT, fontSize: 8.5, color: tokens.ink[3], lineHeight: 1.6 }}>{meta.desc}</div>
      <div style={{ marginTop: 10, fontFamily: FONT, fontSize: 7.5, color: tokens.ink[4], letterSpacing: 1 }}>
        NO CONFIGURABLE FIELDS
      </div>
    </div>
  );

  return (
    <div>
      <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: meta.color || tokens.ink[3], textTransform: "uppercase", marginBottom: 14 }}>
        {meta.icon} {meta.label}
      </div>

      {isDrinks && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: FONT, fontSize: 7.5, letterSpacing: 1.5, color: tokens.ink[3], textTransform: "uppercase", marginBottom: 5 }}>Source</div>
          <select
            value={drinkSource}
            onChange={e => setField("drinkSource", e.target.value)}
            style={{ ...baseInp, fontSize: 10.5, width: "100%", marginBottom: 12 }}
          >
            <option value="pairing">Pairing (Wine / Non-Alc / OS / Premium)</option>
            <option value="optional_pairing">Optional Pairing (course-owned)</option>
            <option value="by_the_glass">By the Glass</option>
            <option value="bottle">Bottle Wine</option>
          </select>

          {drinkSource === "pairing" && (<>
            <label style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[2], display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <input type="checkbox" checked={block.showByGlass !== false} onChange={e => setField("showByGlass", e.target.checked)} />
              By-the-glass fallback
            </label>
            <label style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[2], display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <input type="checkbox" checked={block.showBottle !== false} onChange={e => setField("showBottle", e.target.checked)} />
              Bottle wine fallback
            </label>
          </>)}

          {drinkSource === "optional_pairing" && (
            <div style={{ fontFamily: FONT, fontSize: 8.5, color: tokens.ink[3], lineHeight: 1.5 }}>
              Uses optional pairing data from the course editor (ALCO / N/A, EN / SI). Auto-selects based on seat pairing type.
            </div>
          )}

          {(drinkSource === "by_the_glass" || drinkSource === "bottle") && (
            <div style={{ fontFamily: FONT, fontSize: 8.5, color: tokens.ink[3], lineHeight: 1.5 }}>
              Consumes next {drinkSource === "by_the_glass" ? "by-the-glass wine" : "bottle wine"} from the seat/table queue.
            </div>
          )}
        </div>
      )}

      {fields.map(field => (
        <div key={field.key} style={{ marginBottom: 14 }}>
          <div style={{ fontFamily: FONT, fontSize: 7.5, letterSpacing: 1.5, color: tokens.ink[3], textTransform: "uppercase", marginBottom: 5 }}>
            {field.label}
          </div>

          {field.type === "course_select" ? (
            <select
              value={block[field.key] || ""}
              onChange={e => setField(field.key, e.target.value)}
              style={{ ...baseInp, fontSize: 10.5, width: "100%" }}
            >
              <option value="">(none)</option>
              {menuCourses.filter(c => c.course_key).map(c => (
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
                <span style={{ fontFamily: FONT, fontSize: 7, color: tokens.ink[4], letterSpacing: 0 }}>
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
              <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[2] }}>{field.label}</span>
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
      flex: 1, overflow: "hidden", background: tokens.ink[5],
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "20px 16px",
    }}>
      <div style={{
        fontFamily: FONT, fontSize: 7.5, letterSpacing: 3, color: tokens.ink[3],
        textTransform: "uppercase", marginBottom: 14, flexShrink: 0,
        width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
      }}>
        <span>LIVE PREVIEW {loading ? "· updating…" : `· ${label}`}</span>
      </div>

      {/* Paper wrapper */}
      <div style={{
        width: A5_PX_W * scale,
        height: A5_PX_H * scale,
        overflow: "hidden",
        flexShrink: 0,
        
        borderRadius: 0,
        position: "relative",
        background: tokens.neutral[0],
      }}>
        <iframe
          srcDoc={previewHtml || `<html><body style='background:${tokens.neutral[0]}'></body></html>`}
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
// ── Main export ───────────────────────────────────────────────────────────────

export default function MenuTemplateEditor({
  menuTemplate,
  onUpdateTemplate,
  onSaveTemplate,
  onUpdateLayoutStyles,
  onSaveLayoutStyles,
  saving  = false,
  saved   = false,
  menuRules = DEFAULT_MENU_RULES,
  onUpdateMenuRules,
  onSaveMenuRules,
  menuRulesSaving = false,
  menuRulesSaved = false,
  menuCourses = [],
  logoDataUri = "",
  layoutStyles = {},
  wines = [],
  cocktails = [],
  spirits = [],
  beers = [],
  aperitifOptions = [],
}) {
  const [selectedCell, setSelectedCell] = useState(null); // { rowId, side }
  const [pickerTarget, setPickerTarget] = useState(null); // { rowId, side }
  const [activeRowId,  setActiveRowId]  = useState(null);
  const [previewHtml,  setPreviewHtml]  = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [leftOpen,    setLeftOpen]    = useState(true);
  const [rightOpen,   setRightOpen]   = useState(true);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [layoutStylesOpen, setLayoutStylesOpen] = useState(false);
  const previewTimer = useRef(null);
  const didMigrateSpacersRef = useRef(false);
  const didNormalizeRowGapsRef = useRef(false);
  const didMigrateDrinksRef = useRef(false);

  // ── Preview data state — configurable dummy seat (not persisted) ──
  const [previewDataOpen, setPreviewDataOpen] = useState(false);
  const [previewGuests,   setPreviewGuestsRaw] = useState(1);
  const [previewSeatIdx,  setPreviewSeatIdx]   = useState(0);
  const [previewSeats,    setPreviewSeats]      = useState([makePreviewSeat(1)]);
  const [previewBottles,  setPreviewBottles]    = useState([]);
  const [previewLang,     setPreviewLang]       = useState("en");
  const [previewMenuType, setPreviewMenuType]   = useState("");

  // ── Menu title / thank-you note / team names — shared localStorage with MenuGenerator ──
  const [menuTitle,    setMenuTitle]    = useState(() => readMenuTitle("en"));
  const [thankYouNote, setThankYouNote] = useState(() => readThankYouNote("en"));
  const [teamNames,    setTeamNames]    = useState(readTeamNames);

  // Persist both languages to Supabase so MenuGenerator's on-mount load sees
  // the admin's latest edits and doesn't overwrite them with a stale value.
  const syncTitleToSupabase = () => {
    if (!supabase) return;
    supabase.from(TABLES.SERVICE_SETTINGS)
      .upsert({ id: "menu_gen_title", state: { en: readMenuTitle("en"), si: readMenuTitle("si") }, updated_at: new Date().toISOString() }, { onConflict: "id" })
      .then(() => {});
  };
  const syncThankYouToSupabase = () => {
    if (!supabase) return;
    supabase.from(TABLES.SERVICE_SETTINGS)
      .upsert({ id: "menu_gen_thankyou", state: { en: readThankYouNote("en"), si: readThankYouNote("si") }, updated_at: new Date().toISOString() }, { onConflict: "id" })
      .then(() => {});
  };

  // On mount, pull title / thank-you / team names from Supabase so the editor
  // shows correct values on a fresh device where localStorage isn't yet populated.
  // Without this, switching language or any sync call would overwrite Supabase
  // with empty strings from localStorage and permanently destroy saved values.
  useEffect(() => {
    if (!supabase) return;
    Promise.all([
      supabase.from(TABLES.SERVICE_SETTINGS).select("state").eq("id", "menu_gen_title").single(),
      supabase.from(TABLES.SERVICE_SETTINGS).select("state").eq("id", "menu_gen_thankyou").single(),
      supabase.from(TABLES.SERVICE_SETTINGS).select("state").eq("id", "menu_gen_team").single(),
    ]).then(([titleRes, thankYouRes, teamRes]) => {
      const titleState = titleRes.data?.state;
      if (titleState && (typeof titleState.en === "string" || typeof titleState.si === "string")) {
        const val = titleState["en"] ?? "";
        if (val) { writeMenuTitle("en", val); setMenuTitle(val); }
        if (titleState["si"]) writeMenuTitle("si", titleState["si"]);
      }
      const thankYouState = thankYouRes.data?.state;
      if (thankYouState && (typeof thankYouState.en === "string" || typeof thankYouState.si === "string")) {
        const val = thankYouState["en"] ?? "";
        if (val) { writeThankYouNote("en", val); setThankYouNote(val); }
        if (thankYouState["si"]) writeThankYouNote("si", thankYouState["si"]);
      }
      if (teamRes.data?.state?.value) {
        writeTeamNames(teamRes.data.state.value);
        setTeamNames(teamRes.data.state.value);
      }
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // When language is switched, save current lang to storage then load the next lang
  const handleLangChange = (nextLang) => {
    writeMenuTitle(previewLang, menuTitle);
    writeThankYouNote(previewLang, thankYouNote);
    syncTitleToSupabase();
    syncThankYouToSupabase();
    setPreviewLang(nextLang);
    setMenuTitle(readMenuTitle(nextLang));
    setThankYouNote(readThankYouNote(nextLang));
  };

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
  const rows = Array.isArray(template.rows) ? template.rows : [];

  // ── One-time migration: convert any old spacer-block rows to gap rows ──────
  // Old templates stored gaps as { left: { type: "spacer", height: N } } rows.
  // We silently fold the spacer height into row.gap so they render as gap rows.
  useEffect(() => {
    if (didMigrateSpacersRef.current) return;
    if (!Array.isArray(menuTemplate?.rows)) return;
    const hasSpacers = menuTemplate.rows.some(
      r => r.left?.type === "spacer" || r.right?.type === "spacer"
    );
    didMigrateSpacersRef.current = true;
    if (!hasSpacers) return;
    const migrated = {
      ...menuTemplate,
      rows: menuTemplate.rows.map(row => {
        const lSpacer = row.left?.type === "spacer";
        const rSpacer = row.right?.type === "spacer";
        if (!lSpacer && !rSpacer) return row;
        const spacerH = Math.max(
          lSpacer ? (row.left.height ?? 8) : 0,
          rSpacer ? (row.right.height ?? 8) : 0,
        );
        return {
          ...row,
          left:  lSpacer ? null : row.left,
          right: rSpacer ? null : row.right,
          gap:   (row.gap || 0) + spacerH,
        };
      }),
    };
    onUpdateTemplate(migrated);
  }, [menuTemplate, onUpdateTemplate]);

  // ── One-time migration: normalize row.gap into explicit gap rows ────────────
  // Older saved templates may have "gap above" stored directly on content rows.
  // Since gaps are now edited only via explicit gap-only rows, we convert:
  //   [ { gap: N, left/right: content } ] → [ { gapRow(N) }, { gap: 0, content } ]
  // This makes every gap visible/editable in the row list.
  useEffect(() => {
    if (didNormalizeRowGapsRef.current) return;
    if (!Array.isArray(menuTemplate?.rows)) return;
    const needsNormalize = menuTemplate.rows.some(r => (r?.gap || 0) > 0 && (r.left || r.right));
    didNormalizeRowGapsRef.current = true;
    if (!needsNormalize) return;
    const normalized = [];
    for (const r of menuTemplate.rows) {
      const g = Number(r?.gap || 0) || 0;
      const hasContent = !!(r?.left || r?.right);
      if (g > 0 && hasContent) {
        normalized.push({ ...makeRow(), left: null, right: null, widthPreset: "100/0", gap: g });
        normalized.push({ ...r, gap: 0 });
      } else {
        normalized.push(r);
      }
    }
    onUpdateTemplate({ ...menuTemplate, rows: normalized });
  }, [menuTemplate, onUpdateTemplate]);

  // ── One-time migration: convert legacy block types to unified drinks ─────────
  useEffect(() => {
    if (didMigrateDrinksRef.current) return;
    if (!Array.isArray(menuTemplate?.rows)) return;
    const LEGACY_TYPES = new Set(["pairing", "optional_pairing", "forced_pairing", "by_the_glass", "bottle"]);
    const hasLegacy = menuTemplate.rows.some(r =>
      LEGACY_TYPES.has(r.left?.type) || LEGACY_TYPES.has(r.right?.type)
    );
    didMigrateDrinksRef.current = true;
    if (!hasLegacy) return;
    const migrate = (b) => {
      if (!b || !LEGACY_TYPES.has(b.type)) return b;
      const source =
        b.type === "optional_pairing" || b.type === "forced_pairing" ? "optional_pairing"
        : b.type === "by_the_glass" ? "by_the_glass"
        : b.type === "bottle" ? "bottle"
        : "pairing";
      return {
        ...b,
        type: "drinks",
        drinkSource: source,
        catalogItemId: b.catalogItemId ?? b.catalogId ?? null,
      };
    };
    const migrated = {
      ...menuTemplate,
      rows: menuTemplate.rows.map(r => ({
        ...r,
        left: migrate(r.left),
        right: migrate(r.right),
      })),
    };
    onUpdateTemplate(migrated);
  }, [menuTemplate, onUpdateTemplate]);

  // menuTitle and thankYouNote come from state (shared localStorage with MenuGenerator)

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
          birthday: false,
        };
        const html = generateMenuHTML({
          seat,
          table,
          menuCourses,
          menuTemplate: template,
          _logo: logoDataUri,
          menuTitle,
          thankYouNote,
          teamNames,
          lang: previewLang,
          beerChoice: null,
          layoutStyles,
          menuRules,
          // Pass the same drink catalogs the final print uses so the Admin
          // preview can resolve drinks-column references identically.
          catalog: { wines, cocktails, spirits, beers },
          aperitifOptions,
        });
        setPreviewHtml(html);
      } catch {}
      setPreviewLoading(false);
    }, 250);
    return () => clearTimeout(previewTimer.current);
  }, [template, menuCourses, logoDataUri, layoutStyles, menuRules, previewSeats, previewSeatIdx, previewBottles, previewLang, previewMenuType, menuTitle, thankYouNote, teamNames]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback(newRows => {
    onUpdateTemplate({ ...template, rows: newRows });
  }, [template, onUpdateTemplate]);

  // The editor always shows the actual rows of the active profile. Long /
  // Short menu differences are now expressed by editing separate profiles
  // (assigned to Long Menu and Short Menu in the panel above), not by
  // filtering this template by show_on_short / short_order.
  const visibleRows = rows;
  const displayRows = rows;

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
  const addRow    = () => update([...rows, makeRow()]);
  const addGapRow = () => update([...rows, { ...makeRow(), gap: 12 }]);

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
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 500, fontFamily: FONT }}>

      {/* ── Preview Data Panel (collapsible strip above 3 panels) ── */}
      <PreviewDataPanel
        wines={wines} cocktails={cocktails} spirits={spirits} beers={beers}
        aperitifOptions={aperitifOptions}
        guests={previewGuests}     onGuestsChange={setPreviewGuests}
        seatIdx={previewSeatIdx}   onSeatIdxChange={setPreviewSeatIdx}
        seats={previewSeats}       onUpdateSeat={updatePreviewSeat}
        menuCourses={menuCourses}
        bottleWines={previewBottles} onBottleWinesChange={setPreviewBottles}
        lang={previewLang}         onLangChange={handleLangChange}
        menuType={previewMenuType} onMenuTypeChange={setPreviewMenuType}
        open={previewDataOpen}     onToggle={() => setPreviewDataOpen(v => !v)}
      />

      {/* ── Menu Title + Thank You Note (shared with MenuGenerator via localStorage) ── */}
      <div style={{ display: "flex", gap: 12, padding: "8px 14px", borderBottom: `1px solid ${tokens.ink[4]}`, background: tokens.ink.bg, alignItems: "center", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
          <span style={{ fontFamily: FONT, fontSize: 7.5, letterSpacing: 2, color: tokens.ink[4], textTransform: "uppercase", whiteSpace: "nowrap" }}>Menu Title</span>
          <input
            value={menuTitle}
            onChange={e => { setMenuTitle(e.target.value); writeMenuTitle(previewLang, e.target.value); syncTitleToSupabase(); }}
            style={{ fontFamily: FONT, fontSize: 10, padding: "4px 8px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, outline: "none", flex: 1, minWidth: 80 }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 2 }}>
          <span style={{ fontFamily: FONT, fontSize: 7.5, letterSpacing: 2, color: tokens.ink[4], textTransform: "uppercase", whiteSpace: "nowrap" }}>Thank You Note</span>
          <input
            value={thankYouNote}
            onChange={e => { setThankYouNote(e.target.value); writeThankYouNote(previewLang, e.target.value); syncThankYouToSupabase(); }}
            style={{ fontFamily: FONT, fontSize: 10, padding: "4px 8px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, outline: "none", flex: 1, minWidth: 140 }}
          />
        </div>
      </div>


      {/* ── Three-panel layout ── */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, gap: 0 }}>

      {/* ── Left: Row editor ── */}
      <aside style={{
        width: leftOpen ? 288 : 28, flexShrink: 0, borderRight: `1px solid ${tokens.ink[4]}`,
        background: tokens.ink.bg, display: "flex", flexDirection: "column",
        overflow: "hidden", transition: "width 0.18s ease",
      }}>
        {/* Header */}
        <div style={{ padding: leftOpen ? "12px 12px 8px" : "8px 4px", borderBottom: `1px solid ${tokens.ink[4]}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: leftOpen ? 8 : 0 }}>
            {leftOpen && (
              <span style={{ fontSize: 7.5, letterSpacing: 3, color: tokens.ink[4], textTransform: "uppercase" }}>
                LAYOUT EDITOR
              </span>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: leftOpen ? 0 : "auto", marginRight: leftOpen ? 0 : "auto" }}>
              {leftOpen && (
                <span style={{ fontSize: 7.5, color: tokens.ink[4], fontFamily: FONT }}>
                  {rows.length} row{rows.length !== 1 ? "s" : ""}
                </span>
              )}
              <button
                onClick={() => setLeftOpen(v => !v)}
                title={leftOpen ? "Collapse panel" : "Expand panel"}
                style={{
                  border: "none", background: "transparent", cursor: "pointer",
                  color: tokens.ink[4], fontSize: 12, padding: "2px 4px", lineHeight: 1,
                  fontFamily: FONT,
                }}
                onMouseEnter={e => { e.currentTarget.style.color = GOLD; }}
                onMouseLeave={e => { e.currentTarget.style.color = tokens.ink[4]; }}
              >{leftOpen ? "◂" : "▸"}</button>
            </div>
          </div>

          {/* Save button */}
          {leftOpen && <button
            onClick={onSaveTemplate}
            disabled={saving}
            style={{
              width: "100%", fontFamily: FONT, fontSize: 8, letterSpacing: 2,
              padding: "7px 0", border: "none", borderRadius: 0, cursor: saving ? "wait" : "pointer",
              background: saved ? tokens.green.border : GOLD, color: tokens.neutral[0],
              textTransform: "uppercase", marginBottom: 6,
            }}
          >{saving ? "SAVING…" : saved ? "✓ SAVED" : "SAVE TEMPLATE"}</button>}

          {/* Rebuild button */}
          {leftOpen && (
          <button
            onClick={rebuild}
            style={{
              width: "100%", fontFamily: FONT, fontSize: 7.5, letterSpacing: 1,
              padding: "5px 0", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0,
              cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[3],
              textTransform: "uppercase",
            }}
            title="Rebuild template from current courses"
          >↺ REBUILD FROM COURSES</button>
          )}

          {/* Spacing settings moved to the SPACING SETTINGS panel above the 3-panel area */}
        </div>

        {/* Scrollable row list */}
        {leftOpen && <div style={{ flex: 1, overflowY: "auto", padding: "8px 8px 0" }}>
          {rows.length === 0 && (
            <div style={{
              textAlign: "center", padding: "32px 16px",
              fontSize: 8.5, color: tokens.ink[4], letterSpacing: 1.5, lineHeight: 2.2,
              textTransform: "uppercase",
            }}>
              NO ROWS YET
              <br />
              <button
                onClick={rebuild}
                style={{
                  marginTop: 10, fontFamily: FONT, fontSize: 8, letterSpacing: 1,
                  padding: "8px 16px", border: `1.5px solid ${GOLD}`, borderRadius: 0,
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

        {/* Add row / add gap */}
        {leftOpen && <div style={{ padding: "8px", flexShrink: 0, borderTop: `1px solid ${tokens.ink[4]}`, display: "flex", gap: 4 }}>
          <button
            onClick={addRow}
            style={{
              flex: 1, fontFamily: FONT, fontSize: 8, letterSpacing: 2, padding: "8px 0",
              border: `1.5px dashed ${tokens.ink[4]}`, borderRadius: 0, cursor: "pointer",
              background: "transparent", color: tokens.ink[4], textTransform: "uppercase",
              transition: "all 0.12s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.color = GOLD; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = tokens.ink[4]; e.currentTarget.style.color = tokens.ink[4]; }}
          >+ ADD ROW</button>
          <button
            onClick={addGapRow}
            title="Add a gap-only row for section spacing"
            style={{
              flex: 1, fontFamily: FONT, fontSize: 8, letterSpacing: 2, padding: "8px 0",
              border: `1.5px dashed ${tokens.ink[4]}`, borderRadius: 0, cursor: "pointer",
              background: "transparent", color: tokens.ink[2], textTransform: "uppercase",
              transition: "all 0.12s",
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = GOLD; e.currentTarget.style.color = GOLD; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = tokens.ink[4]; e.currentTarget.style.color = tokens.ink[2]; }}
          >+ ADD GAP</button>
        </div>}
      </aside>

      {/* ── Center: Live A5 preview (collapsible, click to deselect) ── */}
      <div style={{
        flex: previewOpen ? 1 : 0,
        display: "flex", flexDirection: "column",
        transition: "flex 0.18s ease",
        minWidth: previewOpen ? 200 : 28,
        borderLeft: `1px solid ${tokens.ink[4]}`, borderRight: `1px solid ${tokens.ink[4]}`,
      }}>
        {!previewOpen && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", paddingTop: 8 }}>
            <button
              onClick={() => setPreviewOpen(true)}
              title="Show preview"
              style={{ border: "none", background: "transparent", cursor: "pointer", color: tokens.ink[4], fontSize: 12, padding: "2px 4px", lineHeight: 1, fontFamily: FONT }}
              onMouseEnter={e => { e.currentTarget.style.color = GOLD; }}
              onMouseLeave={e => { e.currentTarget.style.color = tokens.ink[4]; }}
            >◂▸</button>
            <span style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 1, color: tokens.ink[4], writingMode: "vertical-lr", marginTop: 8 }}>PREVIEW</span>
          </div>
        )}
        {previewOpen && (
          <div style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative" }} onClick={() => setSelectedCell(null)}>
            <button
              onClick={(e) => { e.stopPropagation(); setPreviewOpen(false); }}
              title="Collapse preview"
              style={{ position: "absolute", top: 6, right: 6, zIndex: 2, border: "none", background: "transparent", cursor: "pointer", color: tokens.ink[4], fontSize: 10, padding: "2px 4px", lineHeight: 1, fontFamily: FONT }}
              onMouseEnter={e => { e.currentTarget.style.color = GOLD; }}
              onMouseLeave={e => { e.currentTarget.style.color = tokens.ink[4]; }}
            >✕</button>
            <LivePreview
              previewHtml={previewHtml}
              loading={previewLoading}
              label={`P${previewSeatIdx + 1} · ${(previewSeats[previewSeatIdx]?.pairing || "—")} · ${previewLang.toUpperCase()}${previewMenuType === "short" ? " · SHORT" : ""}`}
            />
          </div>
        )}
      </div>

      {/* ── Right: Block inspector + Page Setup ── */}
      <aside style={{
        width: rightOpen ? 264 : 28, flexShrink: 0, borderLeft: `1px solid ${tokens.ink[4]}`,
        background: tokens.neutral[0],
        display: "flex", flexDirection: "column",
        overflow: "hidden",
        transition: "width 0.18s ease",
      }}>
        {/* Collapse toggle */}
        <div style={{ padding: rightOpen ? "10px 14px 6px" : "8px 4px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: rightOpen ? "space-between" : "center", borderBottom: rightOpen ? `1px solid ${tokens.ink[4]}` : "none" }}>
          {rightOpen && (
            <span style={{ fontFamily: FONT, fontSize: 7.5, letterSpacing: 3, color: tokens.ink[4], textTransform: "uppercase" }}>
              BLOCK INSPECTOR
            </span>
          )}
          <button
            onClick={() => setRightOpen(v => !v)}
            title={rightOpen ? "Collapse panel" : "Expand panel"}
            style={{
              border: "none", background: "transparent", cursor: "pointer",
              color: tokens.ink[4], fontSize: 12, padding: "2px 4px", lineHeight: 1,
              fontFamily: FONT,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = GOLD; }}
            onMouseLeave={e => { e.currentTarget.style.color = tokens.ink[4]; }}
          >{rightOpen ? "▸" : "◂"}</button>
        </div>
        {rightOpen && (
          <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "12px 14px 14px", flex: 1 }}>
              <BlockInspector
                block={selectedBlock}
                onUpdate={updateSelectedBlock}
                menuCourses={menuCourses}
                wines={wines}
                cocktails={cocktails}
                spirits={spirits}
                beers={beers}
              />
            </div>
            <LayoutStylesPanel
              layoutStyles={layoutStyles}
              onUpdateLayoutStyles={onUpdateLayoutStyles}
              onSaveLayoutStyles={onSaveLayoutStyles}
              open={layoutStylesOpen}
              onToggle={() => setLayoutStylesOpen(v => !v)}
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
