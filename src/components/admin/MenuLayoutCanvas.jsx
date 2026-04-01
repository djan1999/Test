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
  const isStructural = block.type === "spacer" || block.type === "divider";

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0 : 1,
        marginBottom: isStructural ? 2 : 5,
      }}
    >
      <div
        onClick={() => onSelect(block.id)}
        style={{
          position: "relative",
          padding: isStructural ? "5px 8px" : "8px 10px",
          borderRadius: isStructural ? 2 : 5,
          background: isSelected
            ? `${cfg.color}10`
            : isStructural ? "transparent" : "#ffffff",
          border: isSelected
            ? `1.5px solid ${cfg.color}55`
            : isStructural ? "none" : "1px solid #e8e4dc",
          borderLeft: isStructural
            ? "none"
            : `3px solid ${isSelected ? cfg.color : (cfg.color || "#888") + "55"}`,
          boxShadow: isSelected
            ? `0 0 0 2px ${cfg.color}18, 0 2px 8px rgba(0,0,0,0.06)`
            : isStructural ? "none" : "0 1px 3px rgba(0,0,0,0.04)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 8,
          minHeight: isStructural ? undefined : 38,
          transition: "border-color 0.1s, background 0.1s, box-shadow 0.1s",
        }}
      >
        {/* Drag handle */}
        <div
          {...attributes}
          {...listeners}
          onClick={e => e.stopPropagation()}
          style={{
            cursor: "grab",
            color: isSelected ? (cfg.color || "#888") + "88" : "#ccc8c0",
            fontSize: 14,
            flexShrink: 0,
            touchAction: "none",
            padding: "0 1px",
            lineHeight: 1,
          }}
          title="Drag to reorder"
        >⠿</div>

        {/* Block content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {renderContent(block, menuCourses)}
        </div>

        {/* Action buttons — fade in on hover */}
        <div
          className="canvas-block-actions"
          style={{
            display: "flex",
            gap: 1,
            flexShrink: 0,
            opacity: isSelected ? 1 : 0,
            transition: "opacity 0.12s",
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = "1"}
          onMouseLeave={e => e.currentTarget.style.opacity = isSelected ? "1" : "0"}
        >
          <button
            onClick={e => { e.stopPropagation(); onSelect(block.id); }}
            title="Configure"
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: cfg.color || "#888", fontSize: 11, padding: "2px 4px", lineHeight: 1,
            }}
          >⚙</button>
          <button
            onClick={e => { e.stopPropagation(); onRemove(block.id); }}
            title="Remove block"
            style={{
              background: "none", border: "none", cursor: "pointer",
              color: "#bbb8b0", fontSize: 14, padding: "2px 4px", lineHeight: 1,
            }}
          >×</button>
        </div>
      </div>
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
        fontFamily: FONT, fontSize: 7, letterSpacing: 3.5,
        color: "#c0bcb4", textTransform: "uppercase",
        textAlign: "center", marginBottom: 16,
        paddingBottom: 10, borderBottom: "1px solid #ece8e0",
      }}>
        Menu Canvas — drag blocks to arrange · click to configure
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
          label="Left — Course Structure"
          accentColor="#4b4b88"
          emptyHint="Drop course, spacer or heading blocks here"
        />
        <CanvasZone
          id="rightColumn"
          items={rightColumn}
          menuCourses={menuCourses}
          selectedId={selectedId}
          onSelect={onSelect}
          onRemove={onRemove}
          label="Right — Beverage"
          accentColor="#c8a06e"
          emptyHint="Drop pairing, by-glass or quick access blocks here"
        />
      </div>
    </div>
  );
}
