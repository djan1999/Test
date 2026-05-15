import { useMemo, useState } from "react";
import { tokens } from "../../styles/tokens.js";
import {
  isProfileAssigned,
  canDeleteProfile,
  PROFILE_TARGETS,
} from "../../utils/menuLayoutProfiles.js";
import MenuTemplateEditor from "./MenuTemplateEditor.jsx";

const FONT = tokens.font;

const ASSIGNMENT_ROWS = [
  { slot: "longMenuProfileId",     label: "Long Menu uses",     target: "guest_menu" },
  { slot: "shortMenuProfileId",    label: "Short Menu uses",    target: "guest_menu" },
  { slot: "longKitchenProfileId",  label: "Long Kitchen uses",  target: "kitchen_flow" },
  { slot: "shortKitchenProfileId", label: "Short Kitchen uses", target: "kitchen_flow" },
];

const TARGET_LABEL = { guest_menu: "Guest Menu", kitchen_flow: "Kitchen Flow" };

const btn = (active = false) => ({
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

const inp = {
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

const lbl = {
  fontFamily: FONT,
  fontSize: 8,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: tokens.ink[3],
  marginBottom: 4,
  display: "block",
};

const Badge = ({ text }) => (
  <span style={{
    fontSize: 8, letterSpacing: "0.12em", padding: "1px 5px",
    border: `1px solid ${tokens.charcoal.default}`, color: tokens.ink[1], borderRadius: 0,
    textTransform: "uppercase",
  }}>{text}</span>
);

const SLOT_BADGE = {
  longMenuProfileId:     "Long Menu",
  shortMenuProfileId:    "Short Menu",
  longKitchenProfileId:  "Long Kitchen",
  shortKitchenProfileId: "Short Kitchen",
};

/**
 * Menu Layout panel — single, unified layout editor.
 *
 * Top section: profile manager (list, create, rename, duplicate, delete,
 * target selector, assignment dropdowns).
 *
 * Bottom section: the existing MenuTemplateEditor, which edits the *active*
 * profile's row-based menuTemplate + layoutStyles. There is no second flat
 * editor anymore — guest menus and kitchen flows both use the row-based
 * template; the kitchen flow simply reads course blocks from it.
 */
export default function MenuLayoutPanel({
  menuCourses,
  // Active profile's template editor props (the row-based editor edits this)
  menuTemplate,
  onUpdateTemplate,
  onSaveTemplate,
  templateSaving,
  templateSaved,
  menuRules,
  onUpdateMenuRules,
  onSaveMenuRules,
  menuRulesSaving,
  menuRulesSaved,
  logoDataUri,
  layoutStyles = {},
  onUpdateLayoutStyles,
  onSaveLayoutStyles,
  wines = [],
  cocktails = [],
  spirits = [],
  beers = [],
  aperitifOptions = [],
  // Profile manager
  layoutProfiles = [],
  activeLayoutProfileId,
  onSelectLayoutProfile,
  onCreateLayoutProfile,
  onRenameLayoutProfile,
  onDuplicateLayoutProfile,
  onDeleteLayoutProfile,
  onSetProfileTarget,
  layoutAssignments = {},
  onSetProfileAssignment,
}) {
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [createTarget, setCreateTarget] = useState("guest_menu");

  const active = useMemo(
    () => layoutProfiles.find(p => p.id === activeLayoutProfileId) || layoutProfiles[0] || null,
    [layoutProfiles, activeLayoutProfileId]
  );

  const guestProfiles   = layoutProfiles.filter(p => (p.target || "guest_menu") === "guest_menu");
  const kitchenProfiles = layoutProfiles.filter(p => p.target === "kitchen_flow");

  const activeSlots = useMemo(() => {
    if (!active) return [];
    return Object.entries(layoutAssignments || {})
      .filter(([, id]) => id === active.id)
      .map(([slot]) => slot);
  }, [active, layoutAssignments]);

  const profileLabel = useMemo(() => {
    if (!active) return "";
    const slotNames = activeSlots.map(s => SLOT_BADGE[s] || s);
    if (slotNames.length > 0) return `Editing: ${active.name} — ${slotNames.join(", ")}`;
    return `Editing: ${active.name}`;
  }, [active, activeSlots]);

  const isShortMenuAssigned = activeSlots.includes("shortMenuProfileId");
  const menuCoursesForRebuild = useMemo(() => {
    if (!isShortMenuAssigned) return menuCourses;
    const shortCourses = menuCourses.filter(c => c.show_on_short);
    return shortCourses.length > 0 ? shortCourses : menuCourses;
  }, [isShortMenuAssigned, menuCourses]);

  const handleCreate = () => {
    onCreateLayoutProfile?.({
      name: createTarget === "kitchen_flow" ? "New Kitchen Layout" : "New Menu Layout",
      target: createTarget,
      cloneFromActive: !!active,
    });
  };

  const handleRename = () => {
    if (!active) return;
    onRenameLayoutProfile?.(active.id, renameDraft);
    setRenaming(false);
  };

  const handleDuplicate = () => {
    if (!active) return;
    onDuplicateLayoutProfile?.(active.id, `${active.name} (copy)`);
  };

  const handleDelete = () => {
    if (!active) return;
    if (!canDeleteProfile(active.id, layoutProfiles, layoutAssignments)) {
      // eslint-disable-next-line no-alert
      alert(
        isProfileAssigned(active.id, layoutAssignments)
          ? "Reassign Long/Short Menu and Long/Short Kitchen first — this profile is currently in use."
          : "At least one profile per category must remain."
      );
      return;
    }
    // eslint-disable-next-line no-alert
    if (!confirm(`Delete profile "${active.name}"?`)) return;
    onDeleteLayoutProfile?.(active.id);
  };

  const handleTargetChange = (target) => {
    if (!active) return;
    onSetProfileTarget?.(active.id, target);
  };

  return (
    <div>
      {/* ── Profile manager + assignments ─────────────────────────────────── */}
      <div style={{
        border: `1px solid ${tokens.ink[4]}`, borderRadius: 0,
        background: tokens.neutral[0], padding: 14, marginBottom: 14,
      }}>
        <div style={{
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
          marginBottom: 12, paddingBottom: 10, borderBottom: `1px solid ${tokens.ink[5]}`, flexWrap: "wrap", gap: 10,
        }}>
          <div>
            <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.16em", color: tokens.charcoal.default, textTransform: "uppercase", fontWeight: 700 }}>
              ▨ Menu Layout Profiles
            </div>
            <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], marginTop: 4, lineHeight: 1.5 }}>
              Each profile wraps the row-based template editor below with a name and target.
              Long Menu / Short Menu pick a guest profile; Long Kitchen / Short Kitchen pick a kitchen profile.
              Course content stays in Courses — these profiles only control layout, structure, and order.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <select value={createTarget} onChange={e => setCreateTarget(e.target.value)} style={{ ...inp, fontSize: 10 }}>
              {PROFILE_TARGETS.map(t => <option key={t} value={t}>{TARGET_LABEL[t]}</option>)}
            </select>
            <button onClick={handleCreate} style={btn(false)}>+ New Profile</button>
          </div>
        </div>

        {/* Profile selector — list with badges */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
          <div>
            <div style={lbl}>Guest Menu Profiles ({guestProfiles.length})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {guestProfiles.length === 0 && (
                <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], padding: 6 }}>None yet.</div>
              )}
              {guestProfiles.map(p => (
                <ProfileButton
                  key={p.id} profile={p} active={active?.id === p.id}
                  assignments={layoutAssignments}
                  onClick={() => onSelectLayoutProfile?.(p.id)}
                />
              ))}
            </div>
          </div>
          <div>
            <div style={lbl}>Kitchen Flow Profiles ({kitchenProfiles.length})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {kitchenProfiles.length === 0 && (
                <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], padding: 6 }}>None yet.</div>
              )}
              {kitchenProfiles.map(p => (
                <ProfileButton
                  key={p.id} profile={p} active={active?.id === p.id}
                  assignments={layoutAssignments}
                  onClick={() => onSelectLayoutProfile?.(p.id)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Active profile actions */}
        {active && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
            padding: 10, background: tokens.ink.bg, border: `1px solid ${tokens.ink[5]}`, marginBottom: 14,
          }}>
            <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[3], letterSpacing: "0.10em", textTransform: "uppercase" }}>Editing:</span>
            {renaming ? (
              <>
                <input
                  autoFocus value={renameDraft} onChange={e => setRenameDraft(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") handleRename(); if (e.key === "Escape") setRenaming(false); }}
                  style={{ ...inp, fontSize: 13, fontWeight: 600, flex: 1, minWidth: 200 }}
                />
                <button onClick={handleRename} style={btn(true)}>Save</button>
                <button onClick={() => setRenaming(false)} style={btn(false)}>Cancel</button>
              </>
            ) : (
              <>
                <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: tokens.ink[0], flex: 1 }}>{active.name}</span>
                <select
                  value={active.target || "guest_menu"}
                  onChange={e => handleTargetChange(e.target.value)}
                  title="Change target — guest profiles drive printed menus, kitchen profiles drive KitchenBoard / SheetView"
                  style={{ ...inp, fontSize: 10 }}
                >
                  {PROFILE_TARGETS.map(t => <option key={t} value={t}>{TARGET_LABEL[t]}</option>)}
                </select>
                <button onClick={() => { setRenameDraft(active.name); setRenaming(true); }} style={btn(false)}>Rename</button>
                <button onClick={handleDuplicate} style={btn(false)}>Duplicate</button>
                <button
                  onClick={handleDelete}
                  disabled={!canDeleteProfile(active.id, layoutProfiles, layoutAssignments)}
                  title={
                    isProfileAssigned(active.id, layoutAssignments)
                      ? "Reassign Long/Short Menu or Kitchen before deleting"
                      : "Delete this profile"
                  }
                  style={{
                    ...btn(false),
                    color: canDeleteProfile(active.id, layoutProfiles, layoutAssignments) ? tokens.red.text : tokens.ink[4],
                    borderColor: canDeleteProfile(active.id, layoutProfiles, layoutAssignments) ? tokens.red.border : tokens.ink[5],
                    cursor: canDeleteProfile(active.id, layoutProfiles, layoutAssignments) ? "pointer" : "not-allowed",
                  }}
                >Delete</button>
              </>
            )}
          </div>
        )}

        {/* Assignment dropdowns — Long/Short Menu + Long/Short Kitchen */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 12, padding: 12, background: tokens.ink.bg, border: `1px solid ${tokens.ink[5]}`,
        }}>
          {ASSIGNMENT_ROWS.map(({ slot, label, target }) => {
            const optionsForTarget = layoutProfiles.filter(p => (p.target || "guest_menu") === target);
            return (
              <div key={slot}>
                <label style={lbl}>{label}</label>
                <select
                  value={layoutAssignments?.[slot] || ""}
                  onChange={e => onSetProfileAssignment?.(slot, e.target.value || null)}
                  style={{ ...inp, width: "100%" }}
                >
                  <option value="">— None —</option>
                  {optionsForTarget.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                {optionsForTarget.length === 0 && (
                  <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.red.text, marginTop: 4 }}>
                    No {TARGET_LABEL[target]} profiles yet — create one above.
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Existing row-based template editor for the active profile ─── */}
      {active ? (
        <MenuTemplateEditor
          menuTemplate={menuTemplate}
          onUpdateTemplate={onUpdateTemplate}
          onSaveTemplate={onSaveTemplate}
          onUpdateLayoutStyles={onUpdateLayoutStyles}
          onSaveLayoutStyles={onSaveLayoutStyles}
          saving={templateSaving}
          saved={templateSaved}
          menuRules={menuRules}
          onUpdateMenuRules={onUpdateMenuRules}
          onSaveMenuRules={onSaveMenuRules}
          menuRulesSaving={menuRulesSaving}
          menuRulesSaved={menuRulesSaved}
          menuCourses={menuCourses}
          menuCoursesForRebuild={menuCoursesForRebuild}
          logoDataUri={logoDataUri}
          layoutStyles={layoutStyles}
          wines={wines}
          cocktails={cocktails}
          spirits={spirits}
          beers={beers}
          aperitifOptions={aperitifOptions}
          profileLabel={profileLabel}
        />
      ) : (
        <div style={{
          fontFamily: FONT, fontSize: 11, color: tokens.ink[3], padding: 24,
          border: `1px dashed ${tokens.ink[4]}`, textAlign: "center",
        }}>
          No layout profile yet. Click "+ New Profile" above to create one.
        </div>
      )}
    </div>
  );
}

function ProfileButton({ profile, active, assignments, onClick }) {
  const slots = Object.entries(assignments || {})
    .filter(([, id]) => id === profile.id)
    .map(([slot]) => slot);
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: "left", padding: "8px 10px",
        fontFamily: FONT, fontSize: 11,
        border: `1px solid ${active ? tokens.charcoal.default : tokens.ink[5]}`,
        background: active ? tokens.tint.parchment : tokens.neutral[0],
        color: tokens.ink[0],
        cursor: "pointer", borderRadius: 0,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{profile.name}</div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {slots.map(slot => <Badge key={slot} text={SLOT_BADGE[slot] || slot} />)}
      </div>
    </button>
  );
}
