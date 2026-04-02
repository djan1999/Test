/**
 * MenuLayoutCanvas — WYSIWYG visual canvas for the Menu Layout Builder.
 *
 * Renders the two-column menu layout as an interactive visual surface.
 * Blocks are displayed as menu-content-like visual elements (not admin cards).
 * Uses @dnd-kit SortableContext + useDroppable — must be nested inside a DndContext.
 */

import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { FONT } from "./adminStyles.js";
import { BLOCK_TYPES, SPACER_SIZES } from "../../utils/visualLayout.js";

// ── Block content renderers (visual menu-like styles) ─────────────────────────

function CourseContent({ block, menuCourses }) {
  const course = menuCourses.find(c => c.course_key === block.courseKey);
  if (!course) {
    return (
      <div style={{ fontFamily: FONT, fontSize: 9, color: "#bbb", fontStyle: "italic" }}>
        {block.courseKey ? `key: ${block.courseKey} — not found` : "(no course selected)"}
      </div>
    );
  }
  return (
    <div>
      <div style={{
        fontFamily: FONT, fontSize: 10.5, fontWeight: 700,
        letterSpacing: 1, color: "#1a1a1a", textTransform: "uppercase",
        lineHeight: 1.25,
      }}>
        {course.menu?.name || course.course_key}
      </div>
      {course.menu?.sub && (
        <div style={{ fontFamily: FONT, fontSize: 8.5, color: "#777", marginTop: 2, fontStyle: "italic", lineHeight: 1.3 }}>
          {course.menu.sub.slice(0, 72)}
        </div>
      )}
    </div>
  );
}

function SpacerContent({ block }) {
  const size = block.size || "md";
  const label = SPACER_SIZES[size]?.label || size;
  const ptVal = SPACER_SIZES[size]?.pt || 14;
  const lineH = Math.max(6, Math.min(ptVal * 0.9, 22));
  return (
    <div style={{ padding: `${lineH * 0.3}px 0` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ flex: 1, borderTop: "1px dashed #d0ccc4" }} />
        <div style={{
          fontFamily: FONT, fontSize: 7, letterSpacing: 1.5,
          color: "#c0bcb4", whiteSpace: "nowrap", textTransform: "uppercase",
        }}>{label}</div>
        <div style={{ flex: 1, borderTop: "1px dashed #d0ccc4" }} />
      </div>
    </div>
  );
}

function DividerContent({ block }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
      <div style={{ flex: 1, height: 1, background: "#d8d4cc" }} />
      {block.text && (
        <>
          <div style={{
            fontFamily: FONT, fontSize: 7.5, letterSpacing: 2, color: "#999",
            whiteSpace: "nowrap", textTransform: "uppercase",
          }}>{block.text}</div>
          <div style={{ flex: 1, height: 1, background: "#d8d4cc" }} />
        </>
      )}
    </div>
  );
}

function HeadingContent({ block }) {
  return (
    <div style={{
      fontFamily: FONT, fontSize: 9, fontWeight: 700,
      letterSpacing: 3.5, color: "#1a1a1a",
      textTransform: "uppercase", textAlign: "center",
      padding: "2px 0",
    }}>
      {block.text || "(heading text)"}
    </div>
  );
}

function PairingContent({ block }) {
  return (
    <div>
      <div style={{
        fontFamily: FONT, fontSize: 10, fontWeight: 700,
        letterSpacing: 1.5, color: "#c8a06e", textTransform: "uppercase",
      }}>
        {block.text || "Wine Pairing"}
      </div>
      <div style={{ fontFamily: FONT, fontSize: 7.5, color: "#c8a06e88", marginTop: 3, letterSpacing: 0.5 }}>
        wp · na · os · premium — per seat
      </div>
    </div>
  );
}

function ByGlassContent() {
  return (
    <div>
      <div style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: "#5a9e6e", textTransform: "uppercase" }}>
        By the Glass
      </div>
      <div style={{ fontFamily: FONT, fontSize: 7.5, color: "#5a9e6e88", marginTop: 3 }}>
        from Danube Salmon onwards
      </div>
    </div>
  );
}

function QuickAccessContent() {
  return (
    <div>
      <div style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: "#7a6e9e", textTransform: "uppercase" }}>
        Quick Access
      </div>
      <div style={{ fontFamily: FONT, fontSize: 7.5, color: "#7a6e9e88", marginTop: 3 }}>
        aperitif buttons
      </div>
    </div>
  );
}

function renderContent(block, menuCourses) {
  switch (block.type) {
    case "course":      return <CourseContent block={block} menuCourses={menuCourses} />;
    case "spacer":      return <SpacerContent block={block} />;
    case "divider":     return <DividerContent block={block} />;
    case "heading":     return <HeadingContent block={block} />;
    case "pairing":     return <PairingContent block={block} />;
    case "byGlass":     return <ByGlassContent />;
    case "quickAccess": return <QuickAccessContent />;
    default:            return <div style={{ fontFamily: FONT, fontSize: 9, color: "#888" }}>{block.type}</div>;
  }
}

// ── SortableCanvasBlock ───────────────────────────────────────────────────────

function SortableCanvasBlock({ block, menuCourses, isSelected, onSelect, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: block.id });
  const cfg = BLOCK_TYPES[block.type] || {};
  const accentColor = cfg.color || "#888";
  const isSpacer  = block.type === "spacer";
  const isDivider = block.type === "divider";
  const isHeading = block.type === "heading";
  const isInline  = isSpacer || isDivider || isHeading;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0 : 1,
        marginBottom: isInline ? 3 : 6,
      }}
    >
      {isInline ? (
        /* ── Compact inline blocks (spacer, divider, heading) ── */
        <div style={{
          display: "flex", alignItems: "center", gap: 0,
          background: isSelected ? `${accentColor}12` : "#f7f5f0",
          border: `1px solid ${isSelected ? accentColor + "55" : "#e4e0d8"}`,
          borderRadius: 4,
          overflow: "hidden",
        }}>
          {/* Drag handle strip */}
          <div
            {...attributes}
            {...listeners}
            onClick={e => e.stopPropagation()}
            style={{
              cursor: "grab",
              padding: "5px 8px",
              color: "#aaa",
              fontSize: 13,
              flexShrink: 0,
              touchAction: "none",
              borderRight: "1px solid #e4e0d8",
              alignSelf: "stretch",
              display: "flex",
              alignItems: "center",
              background: "transparent",
            }}
            title="Drag to reorder"
          >⠿</div>

          {/* Content */}
          <div style={{ flex: 1, padding: "5px 10px" }}>
            {renderContent(block, menuCourses)}
          </div>

          {/* Config + remove — always visible */}
          <div style={{ display: "flex", alignItems: "center", borderLeft: "1px solid #e4e0d8" }}>
            <button
              onClick={e => { e.stopPropagation(); onSelect(block.id); }}
              title="Configure"
              style={{
                background: isSelected ? `${accentColor}18` : "none",
                border: "none", cursor: "pointer",
                color: isSelected ? accentColor : "#bbb",
                fontSize: 11, padding: "5px 7px", lineHeight: 1,
              }}
            >⚙</button>
            <button
              onClick={e => { e.stopPropagation(); onRemove(block.id); }}
              title="Remove"
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "#ccc", fontSize: 15, padding: "5px 7px", lineHeight: 1,
                borderLeft: "1px solid #e4e0d8",
              }}
            >×</button>
          </div>
        </div>
      ) : (
        /* ── Standard content blocks (course, pairing, byGlass, quickAccess) ── */
        <div
          onClick={() => onSelect(block.id)}
          style={{
            display: "flex", alignItems: "stretch",
            borderRadius: 6,
            border: `1.5px solid ${isSelected ? accentColor : "#e4e0d8"}`,
            background: isSelected ? `${accentColor}0d` : "#ffffff",
            boxShadow: isSelected
              ? `0 0 0 3px ${accentColor}20, 0 2px 8px rgba(0,0,0,0.06)`
              : "0 1px 3px rgba(0,0,0,0.05)",
            cursor: "pointer",
            overflow: "hidden",
            transition: "border-color 0.12s, background 0.12s, box-shadow 0.12s",
            minHeight: 44,
          }}
        >
          {/* Left accent bar + drag handle */}
          <div
            {...attributes}
            {...listeners}
            onClick={e => e.stopPropagation()}
            style={{
              cursor: "grab",
              width: 28,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: isSelected ? accentColor : `${accentColor}22`,
              color: isSelected ? "rgba(255,255,255,0.8)" : accentColor,
              fontSize: 14,
              touchAction: "none",
              borderRight: `1px solid ${isSelected ? "transparent" : `${accentColor}22`}`,
              transition: "background 0.12s",
              userSelect: "none",
            }}
            title="Drag to reorder"
          >⠿</div>

          {/* Block content */}
          <div style={{ flex: 1, minWidth: 0, padding: "9px 12px", display: "flex", alignItems: "center" }}>
            {renderContent(block, menuCourses)}
          </div>

          {/* Config + remove — always visible */}
          <div style={{
            display: "flex", flexDirection: "column",
            borderLeft: `1px solid ${isSelected ? `${accentColor}33` : "#ede9e0"}`,
            flexShrink: 0,
          }}>
            <button
              onClick={e => { e.stopPropagation(); onSelect(block.id); }}
              title="Configure"
              style={{
                flex: 1,
                background: isSelected ? `${accentColor}12` : "#fafaf8",
                border: "none",
                borderBottom: `1px solid ${isSelected ? `${accentColor}22` : "#ede9e0"}`,
                cursor: "pointer",
                color: isSelected ? accentColor : "#bbb",
                fontSize: 11,
                padding: "0 9px",
                lineHeight: 1,
              }}
            >⚙</button>
            <button
              onClick={e => { e.stopPropagation(); onRemove(block.id); }}
              title="Remove"
              style={{
                flex: 1,
                background: "#fafaf8",
                border: "none",
                cursor: "pointer",
                color: "#ccc",
                fontSize: 15,
                padding: "0 9px",
                lineHeight: 1,
              }}
            >×</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── CanvasZone ────────────────────────────────────────────────────────────────

function CanvasZone({ id, items, menuCourses, selectedId, onSelect, onRemove, label, accentColor, emptyHint }) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {/* Zone header */}
      <div style={{
        fontFamily: FONT, fontSize: 7.5, letterSpacing: 2.5, color: accentColor,
        textTransform: "uppercase", fontWeight: 700,
        borderBottom: `2px solid ${accentColor}`,
        paddingBottom: 7, marginBottom: 12,
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span>{label}</span>
        <span style={{ fontWeight: 400, color: "#c0bcb4", fontSize: 7 }}>
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
            padding: "4px 2px",
            borderRadius: 6,
            background: isOver ? `${accentColor}06` : "transparent",
            transition: "background 0.15s",
          }}
        >
          {items.map(block => (
            <SortableCanvasBlock
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
              border: `2px dashed ${isOver ? accentColor : "#d8d4cc"}`,
              borderRadius: 6, padding: "28px 16px",
              textAlign: "center",
              color: isOver ? accentColor : "#c8c4bc",
              fontFamily: FONT, fontSize: 9, letterSpacing: 1,
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

// ── MenuLayoutCanvas (main export) ────────────────────────────────────────────

export default function MenuLayoutCanvas({
  leftColumn,
  rightColumn,
  menuCourses,
  selectedId,
  onSelect,
  onRemove,
}) {
  return (
    <div style={{
      background: "#fdfcf8",
      border: "1px solid #e4e0d8",
      borderRadius: 10,
      padding: "18px 20px 20px",
      boxShadow: "inset 0 1px 4px rgba(0,0,0,0.03), 0 2px 10px rgba(0,0,0,0.05)",
    }}>
      {/* Canvas label */}
      <div style={{
        fontFamily: FONT, fontSize: 7, letterSpacing: 3,
        color: "#b8b4ac", textTransform: "uppercase",
        marginBottom: 16, paddingBottom: 10,
        borderBottom: "1px solid #ece8e0",
        display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
      }}>
        <span>Menu Canvas</span>
        <span style={{ color: "#d8d4cc" }}>·</span>
        <span>⠿ drag to reorder</span>
        <span style={{ color: "#d8d4cc" }}>·</span>
        <span>⚙ configure</span>
        <span style={{ color: "#d8d4cc" }}>·</span>
        <span>× remove</span>
      </div>

      {/* Two-column layout */}
      <div style={{ display: "grid", gridTemplateColumns: "55fr 45fr", gap: 20 }}>
        <CanvasZone
          id="leftColumn"
          items={leftColumn}
          menuCourses={menuCourses}
          selectedId={selectedId}
          onSelect={onSelect}
          onRemove={onRemove}
          label="Left Column — Courses"
          accentColor="#4b4b88"
          emptyHint="Use ↺ REBUILD FROM COURSES to populate, or add blocks from the palette"
        />
        <CanvasZone
          id="rightColumn"
          items={rightColumn}
          menuCourses={menuCourses}
          selectedId={selectedId}
          onSelect={onSelect}
          onRemove={onRemove}
          label="Right Column — Beverage"
          accentColor="#c8a06e"
          emptyHint="Add Pairing, By the Glass, or Quick Access blocks from the palette"
        />
      </div>
    </div>
  );
}
