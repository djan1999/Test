import { useMemo, useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { generateMenuHTML } from "../../utils/menuGenerator.js";
import {
  LAYOUT_ITEM_TYPES,
  SPACER_SIZES,
  makeLayout,
  makeLayoutItem,
  duplicateLayout,
  renameLayout,
  isLayoutAssigned,
  canDeleteLayout,
  resolveMenuLayout,
  getAssignedLayout,
  moveLayoutItem,
} from "../../utils/menuLayouts.js";

const FONT = tokens.font;

const ITEM_LABELS = {
  course:        "Course",
  staticText:    "Static text",
  sectionHeader: "Section header",
  spacer:        "Spacer",
  divider:       "Divider",
  optionalNote:  "Optional note",
};

const btnStyle = (active = false) => ({
  fontFamily: FONT,
  fontSize: 9,
  letterSpacing: "0.10em",
  textTransform: "uppercase",
  padding: "6px 10px",
  border: `1px solid ${active ? tokens.charcoal.default : tokens.ink[4]}`,
  background: active ? tokens.tint.parchment : tokens.neutral[0],
  color: active ? tokens.ink[0] : tokens.ink[2],
  cursor: "pointer",
  borderRadius: 0,
});

const inputStyle = {
  fontFamily: FONT,
  fontSize: 11,
  padding: "6px 8px",
  border: `1px solid ${tokens.ink[4]}`,
  borderRadius: 0,
  outline: "none",
  background: tokens.neutral[0],
  color: tokens.ink[0],
  boxSizing: "border-box",
};

const labelStyle = {
  fontFamily: FONT,
  fontSize: 8,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: tokens.ink[3],
  marginBottom: 4,
  display: "block",
};

/**
 * Layout Manager + Editor — manages the named Menu Layouts list and lets the
 * user edit one layout at a time. Long Menu and Short Menu each pick which
 * layout to use, persisted in the parent.
 */
export default function MenuLayoutsEditor({
  menuLayouts = [],
  layoutAssignments = {},
  onUpdateMenuLayouts,
  menuCourses = [],
  menuTemplate = null,
  layoutStyles = {},
  menuRules,
  logoDataUri = "",
}) {
  const [selectedId, setSelectedId] = useState(() => menuLayouts[0]?.id || null);
  const [previewMode, setPreviewMode] = useState(""); // "" | "long" | "short"
  const [renameDraft, setRenameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);

  const selected = useMemo(
    () => menuLayouts.find(l => l.id === selectedId) || menuLayouts[0] || null,
    [menuLayouts, selectedId]
  );

  // Course options for the course picker (sorted by position).
  const courseOptions = useMemo(() => {
    return (menuCourses || [])
      .filter(c => c?.course_key && c.is_active !== false && !c.is_snack)
      .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))
      .map(c => ({
        key: c.course_key,
        name: c?.menu?.name || c.course_key,
      }));
  }, [menuCourses]);

  const replaceLayouts = (mutator) => {
    if (typeof onUpdateMenuLayouts !== "function") return;
    onUpdateMenuLayouts(prev => {
      const next = mutator({
        layouts: Array.isArray(prev?.layouts) ? prev.layouts : [],
        assignments: prev?.assignments || {},
      });
      return next;
    });
  };

  const assign = (kind, id) => {
    replaceLayouts(({ layouts, assignments }) => ({
      layouts,
      assignments: {
        ...assignments,
        [kind === "long" ? "longMenuLayoutId" : "shortMenuLayoutId"]: id || null,
      },
    }));
  };

  const handleCreate = () => {
    const created = makeLayout(`Layout ${(menuLayouts.length || 0) + 1}`);
    replaceLayouts(({ layouts, assignments }) => ({
      layouts: [...layouts, created],
      assignments,
    }));
    setSelectedId(created.id);
  };

  const handleDuplicate = () => {
    if (!selected) return;
    const copy = duplicateLayout(selected, `${selected.name} (copy)`);
    replaceLayouts(({ layouts, assignments }) => ({
      layouts: [...layouts, copy],
      assignments,
    }));
    setSelectedId(copy.id);
  };

  const handleRename = (next) => {
    if (!selected) return;
    replaceLayouts(({ layouts, assignments }) => ({
      layouts: renameLayout(layouts, selected.id, next),
      assignments,
    }));
  };

  const handleDelete = () => {
    if (!selected) return;
    if (!canDeleteLayout(selected.id, menuLayouts, layoutAssignments)) {
      const reason = isLayoutAssigned(selected.id, layoutAssignments)
        ? "Reassign Long/Short to a different layout first."
        : "At least one layout must remain.";
      // eslint-disable-next-line no-alert
      alert(`Cannot delete this layout. ${reason}`);
      return;
    }
    // eslint-disable-next-line no-alert
    if (!confirm(`Delete layout "${selected.name}"?`)) return;
    replaceLayouts(({ layouts, assignments }) => {
      const nextLayouts = layouts.filter(l => l.id !== selected.id);
      return { layouts: nextLayouts, assignments };
    });
    const fallback = menuLayouts.find(l => l.id !== selected.id);
    setSelectedId(fallback ? fallback.id : null);
  };

  const updateSelectedItems = (mutator) => {
    if (!selected) return;
    replaceLayouts(({ layouts, assignments }) => ({
      layouts: layouts.map(l => l.id === selected.id ? { ...l, items: mutator(l.items || []) } : l),
      assignments,
    }));
  };

  const addItem = (type, fields = {}) => {
    updateSelectedItems(items => [...items, makeLayoutItem(type, fields)]);
  };
  const removeItem = (id) => updateSelectedItems(items => items.filter(it => it.id !== id));
  const updateItem = (id, patch) =>
    updateSelectedItems(items => items.map(it => (it.id === id ? { ...it, ...patch } : it)));
  const moveItem = (idx, dir) => {
    const target = idx + dir;
    updateSelectedItems(items => moveLayoutItem(items, idx, target));
  };

  // ── Preview HTML ───────────────────────────────────────────────────────────
  const previewLayout = previewMode
    ? getAssignedLayout(previewMode, menuLayouts, layoutAssignments)
    : null;

  const previewHtml = useMemo(() => {
    if (!previewLayout) return "";
    return generateMenuHTML({
      seat: { id: 1, pairing: "Wine", aperitifs: [], glasses: [], cocktails: [], beers: [] },
      table: { menuType: previewMode, restrictions: [], bottleWines: [] },
      menuTitle: "MENU",
      teamNames: "",
      menuCourses,
      lang: "en",
      thankYouNote: "",
      layoutStyles,
      menuTemplate,
      menuLayout: previewLayout,
      menuRules,
      _logo: logoDataUri,
    });
  }, [previewLayout, previewMode, menuCourses, layoutStyles, menuTemplate, menuRules, logoDataUri]);

  return (
    <div style={{
      border: `1px solid ${tokens.ink[4]}`,
      borderRadius: 0,
      background: tokens.neutral[0],
      padding: 14,
      marginBottom: 18,
    }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 12, paddingBottom: 10, borderBottom: `1px solid ${tokens.ink[5]}`, flexWrap: "wrap", gap: 10,
      }}>
        <div>
          <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.16em", color: tokens.charcoal.default, textTransform: "uppercase", fontWeight: 700 }}>
            ▨ Menu Layouts
          </div>
          <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], marginTop: 4, lineHeight: 1.5 }}>
            Each layout is an ordered list of items (courses + static blocks).
            Long Menu and Short Menu pick which layout they render. Course content stays in Courses.
          </div>
        </div>
        <button onClick={handleCreate} style={btnStyle(false)}>+ New Layout</button>
      </div>

      {/* Long/Short assignment */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: 12, marginBottom: 14,
        background: tokens.ink.bg, border: `1px solid ${tokens.ink[5]}`, padding: 12,
      }}>
        <div>
          <label style={labelStyle}>Long Menu uses</label>
          <select
            value={layoutAssignments?.longMenuLayoutId || ""}
            onChange={(e) => assign("long", e.target.value || null)}
            style={{ ...inputStyle, width: "100%" }}
          >
            <option value="">— None —</option>
            {menuLayouts.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Short Menu uses</label>
          <select
            value={layoutAssignments?.shortMenuLayoutId || ""}
            onChange={(e) => assign("short", e.target.value || null)}
            style={{ ...inputStyle, width: "100%" }}
          >
            <option value="">— None —</option>
            {menuLayouts.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      </div>

      {/* Layout list / actions */}
      <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 14, alignItems: "start" }}>
        <div style={{ borderRight: `1px solid ${tokens.ink[5]}`, paddingRight: 12 }}>
          <div style={{ ...labelStyle, marginBottom: 6 }}>Layouts ({menuLayouts.length})</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {menuLayouts.length === 0 && (
              <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], padding: 8 }}>
                No layouts yet. Click "+ New Layout" to create one.
              </div>
            )}
            {menuLayouts.map(l => {
              const isLong = layoutAssignments?.longMenuLayoutId === l.id;
              const isShort = layoutAssignments?.shortMenuLayoutId === l.id;
              const active = selected?.id === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => { setSelectedId(l.id); setRenaming(false); }}
                  style={{
                    textAlign: "left", padding: "8px 10px",
                    fontFamily: FONT, fontSize: 11,
                    border: `1px solid ${active ? tokens.charcoal.default : tokens.ink[5]}`,
                    background: active ? tokens.tint.parchment : tokens.neutral[0],
                    color: tokens.ink[0],
                    cursor: "pointer", borderRadius: 0,
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 2 }}>{l.name}</div>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {isLong && <span style={{ fontSize: 8, letterSpacing: "0.12em", padding: "1px 5px", border: `1px solid ${tokens.charcoal.default}`, color: tokens.ink[1] }}>LONG</span>}
                    {isShort && <span style={{ fontSize: 8, letterSpacing: "0.12em", padding: "1px 5px", border: `1px solid ${tokens.charcoal.default}`, color: tokens.ink[1] }}>SHORT</span>}
                    <span style={{ fontSize: 9, color: tokens.ink[3] }}>{(l.items || []).length} items</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Editor */}
        {selected ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              {renaming ? (
                <>
                  <input
                    autoFocus
                    value={renameDraft}
                    onChange={e => setRenameDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter") { handleRename(renameDraft); setRenaming(false); }
                      if (e.key === "Escape") { setRenaming(false); }
                    }}
                    style={{ ...inputStyle, fontSize: 14, fontWeight: 600, flex: 1, minWidth: 200 }}
                  />
                  <button onClick={() => { handleRename(renameDraft); setRenaming(false); }} style={btnStyle(true)}>Save</button>
                  <button onClick={() => setRenaming(false)} style={btnStyle(false)}>Cancel</button>
                </>
              ) : (
                <>
                  <div style={{ fontFamily: FONT, fontSize: 14, fontWeight: 600, color: tokens.ink[0], flex: 1, minWidth: 200 }}>
                    {selected.name}
                  </div>
                  <button onClick={() => { setRenameDraft(selected.name); setRenaming(true); }} style={btnStyle(false)}>Rename</button>
                  <button onClick={handleDuplicate} style={btnStyle(false)}>Duplicate</button>
                  <button
                    onClick={handleDelete}
                    disabled={!canDeleteLayout(selected.id, menuLayouts, layoutAssignments)}
                    title={
                      isLayoutAssigned(selected.id, layoutAssignments)
                        ? "Reassign Long/Short before deleting"
                        : (menuLayouts.length <= 1 ? "At least one layout must remain" : "Delete this layout")
                    }
                    style={{
                      ...btnStyle(false),
                      color: canDeleteLayout(selected.id, menuLayouts, layoutAssignments) ? tokens.red.text : tokens.ink[4],
                      borderColor: canDeleteLayout(selected.id, menuLayouts, layoutAssignments) ? tokens.red.border : tokens.ink[5],
                      cursor: canDeleteLayout(selected.id, menuLayouts, layoutAssignments) ? "pointer" : "not-allowed",
                    }}
                  >Delete</button>
                </>
              )}
            </div>

            {/* Add item buttons */}
            <div style={{
              display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12,
              padding: 10, border: `1px dashed ${tokens.ink[5]}`,
            }}>
              <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[3], letterSpacing: "0.10em", textTransform: "uppercase", marginRight: 6, alignSelf: "center" }}>Add:</span>
              {LAYOUT_ITEM_TYPES.map(t => (
                <button key={t} onClick={() => addItem(t)} style={btnStyle(false)}>
                  + {ITEM_LABELS[t] || t}
                </button>
              ))}
            </div>

            {/* Items list */}
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {(selected.items || []).length === 0 && (
                <div style={{ fontFamily: FONT, fontSize: 11, color: tokens.ink[3], padding: 14, textAlign: "center" }}>
                  This layout has no items yet. Use the buttons above to add courses or static blocks.
                </div>
              )}
              {(selected.items || []).map((item, idx) => (
                <LayoutItemRow
                  key={item.id}
                  item={item}
                  index={idx}
                  total={selected.items.length}
                  courseOptions={courseOptions}
                  onMove={(dir) => moveItem(idx, dir)}
                  onRemove={() => removeItem(item.id)}
                  onUpdate={(patch) => updateItem(item.id, patch)}
                />
              ))}
            </div>

            {/* Preview controls */}
            <div style={{
              marginTop: 18, paddingTop: 12, borderTop: `1px solid ${tokens.ink[5]}`,
              display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
            }}>
              <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[3], letterSpacing: "0.14em", textTransform: "uppercase", marginRight: 6 }}>Preview:</span>
              <button onClick={() => setPreviewMode(previewMode === "long" ? "" : "long")} style={btnStyle(previewMode === "long")}>Long Menu</button>
              <button onClick={() => setPreviewMode(previewMode === "short" ? "" : "short")} style={btnStyle(previewMode === "short")}>Short Menu</button>
              {previewMode && previewLayout && (
                <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[2] }}>→ {previewLayout.name}</span>
              )}
              {previewMode && !previewLayout && (
                <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.red.text }}>No layout assigned to {previewMode}</span>
              )}
            </div>
            {previewMode && previewLayout && (
              <div style={{
                marginTop: 10, padding: 10, background: tokens.ink.bg, border: `1px solid ${tokens.ink[5]}`,
              }}>
                <iframe
                  title={`menu-layout-preview-${previewMode}`}
                  srcDoc={previewHtml}
                  style={{ width: "100%", height: 760, border: `1px solid ${tokens.ink[5]}`, background: tokens.neutral[0] }}
                />
              </div>
            )}
          </div>
        ) : (
          <div style={{ fontFamily: FONT, fontSize: 11, color: tokens.ink[3], padding: 14 }}>
            Select a layout from the list, or create a new one.
          </div>
        )}
      </div>
    </div>
  );
}

function LayoutItemRow({ item, index, total, courseOptions, onMove, onRemove, onUpdate }) {
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const itemLabel = ITEM_LABELS[item.type] || item.type;

  const displayName = (() => {
    if (item.type === "course") {
      const found = courseOptions.find(c => c.key === item.courseKey);
      return found?.name || (item.courseKey ? `[unknown course: ${item.courseKey}]` : "[no course selected]");
    }
    if (item.type === "spacer") return `${itemLabel} · ${item.size || "medium"}`;
    if (item.type === "divider") return itemLabel;
    if (item.type === "sectionHeader" || item.type === "staticText" || item.type === "optionalNote") {
      return item.text || `(empty ${itemLabel.toLowerCase()})`;
    }
    return itemLabel;
  })();

  const isMissing = item.type === "course" && (!item.courseKey || !courseOptions.find(c => c.key === item.courseKey));

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "auto 1fr auto",
      alignItems: "center", gap: 8,
      padding: "8px 10px",
      border: `1px solid ${isMissing ? tokens.red.border : tokens.ink[5]}`,
      background: isMissing ? tokens.red.bg : tokens.neutral[0],
    }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <button onClick={() => onMove(-1)} disabled={isFirst} title="Move up"
          style={{ ...btnStyle(false), padding: "2px 6px", opacity: isFirst ? 0.3 : 1, cursor: isFirst ? "not-allowed" : "pointer" }}>▲</button>
        <button onClick={() => onMove(1)} disabled={isLast} title="Move down"
          style={{ ...btnStyle(false), padding: "2px 6px", opacity: isLast ? 0.3 : 1, cursor: isLast ? "not-allowed" : "pointer" }}>▼</button>
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", color: tokens.ink[3], textTransform: "uppercase", marginBottom: 4 }}>
          {itemLabel}
        </div>
        <ItemFields item={item} courseOptions={courseOptions} onUpdate={onUpdate} displayName={displayName} />
      </div>

      <button onClick={onRemove} title="Remove" style={{ ...btnStyle(false), color: tokens.red.text, borderColor: tokens.red.border }}>×</button>
    </div>
  );
}

function ItemFields({ item, courseOptions, onUpdate, displayName }) {
  if (item.type === "course") {
    return (
      <select
        value={item.courseKey || ""}
        onChange={e => onUpdate({ courseKey: e.target.value })}
        style={{ ...inputStyle, width: "100%" }}
      >
        <option value="">— Select a course —</option>
        {courseOptions.map(c => (
          <option key={c.key} value={c.key}>{c.name} ({c.key})</option>
        ))}
        {/* Preserve dangling refs so the user can see them */}
        {item.courseKey && !courseOptions.find(c => c.key === item.courseKey) && (
          <option value={item.courseKey}>[missing] {item.courseKey}</option>
        )}
      </select>
    );
  }
  if (item.type === "spacer") {
    return (
      <select
        value={item.size || "medium"}
        onChange={e => onUpdate({ size: e.target.value })}
        style={{ ...inputStyle, width: 160 }}
      >
        {SPACER_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
      </select>
    );
  }
  if (item.type === "divider") {
    return <div style={{ fontFamily: FONT, fontSize: 11, color: tokens.ink[2] }}>{displayName}</div>;
  }
  // staticText / sectionHeader / optionalNote — text + alignment
  const showAlign = item.type !== "optionalNote";
  return (
    <div style={{ display: "grid", gridTemplateColumns: showAlign ? "1fr 120px" : "1fr", gap: 6 }}>
      <input
        value={item.text || ""}
        placeholder={`${ITEM_LABELS[item.type]} text…`}
        onChange={e => onUpdate({ text: e.target.value })}
        style={{ ...inputStyle, width: "100%" }}
      />
      {showAlign && (
        <select
          value={item.align || "left"}
          onChange={e => onUpdate({ align: e.target.value })}
          style={{ ...inputStyle }}
        >
          <option value="left">left</option>
          <option value="center">center</option>
          <option value="right">right</option>
        </select>
      )}
    </div>
  );
}
