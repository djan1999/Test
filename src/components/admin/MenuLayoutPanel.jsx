import { useMemo, useState } from "react";
import { tokens } from "../../styles/tokens.js";
import {
  isProfileAssigned,
  canDeleteProfile,
} from "../../utils/menuLayoutProfiles.js";
import MenuTemplateEditor from "./MenuTemplateEditor.jsx";

const FONT = tokens.font;

// A single slot: which guest profile is currently live (printed for guests).
// Each profile carries BOTH its Long and Short version internally (switched by
// the LONG/SHORT toggle in the editor), so a separate "Short Menu" profile
// assignment is no longer needed — it was dead (nothing read it) and only
// caused edits to bleed between the two. A previous version also included a
// "Kitchen Profile" slot whose target was never recognized; both have been
// removed to stop offering dropdowns that don't drive anything.
const ASSIGNMENT_ROWS = [
  { slot: "longMenuProfileId", label: "Live menu — every booking gets this unless it picks another layout", target: "guest_menu" },
];

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
  longMenuProfileId: "Live",
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
  ticketTemplate = null,
  onUpdateTicketTemplate = null,
  shortTicketTemplate = null,
  onUpdateShortTicketTemplate = null,
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
  onSetLayoutProfileBadge,
  // { [profileId]: { count, guests, dates } } — upcoming bookings per layout
  layoutBookings = {},
  onDuplicateLayoutProfile,
  onDuplicateAndAssignProfile,
  onDeleteLayoutProfile,
  layoutAssignments = {},
  onSetProfileAssignment,
  // Short menu template — embedded in same profile as menuTemplate.
  // LONG/SHORT toggle in the editor switches between editing these two.
  shortMenuTemplate = null,
  onUpdateShortMenuTemplate = null,
}) {
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const active = useMemo(
    () => layoutProfiles.find(p => p.id === activeLayoutProfileId) || layoutProfiles[0] || null,
    [layoutProfiles, activeLayoutProfileId]
  );

  const guestProfiles = layoutProfiles.filter(p => (p.target || "guest_menu") === "guest_menu");
  const liveId = layoutAssignments?.longMenuProfileId || null;
  const liveProfiles = guestProfiles.filter(p => p.id === liveId);
  const specialProfiles = guestProfiles.filter(p => p.id !== liveId);
  const activeIsLive = !!active && active.id === liveId;
  const activeBookings = active ? layoutBookings?.[active.id] : null;

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

  const handleCreate = () => {
    onCreateLayoutProfile?.({
      name: active ? `${active.name} (copy)` : "New Menu Layout",
      target: "guest_menu",
      cloneFromActive: !!active,
    });
  };

  // A layout built from scratch: header, drink scaffolding, EMPTY course slots
  // and footer — fill each slot with any dish (ours or a guest chef's).
  const handleCreateBlank = () => {
    onCreateLayoutProfile?.({
      name: "New Event Menu",
      target: "guest_menu",
      blank: true,
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
          ? "Make a different layout live first — this one is currently the live menu."
          : "At least one profile must remain."
      );
      return;
    }
    const booked = activeBookings?.count || 0;
    const warning = booked > 0
      ? `\n\n${booked} upcoming booking${booked === 1 ? " is" : "s are"} on this layout — ${booked === 1 ? "it" : "they"} will fall back to the live menu.`
      : "";
    // eslint-disable-next-line no-alert
    if (!confirm(`Delete layout "${active.name}"?${warning}`)) return;
    onDeleteLayoutProfile?.(active.id);
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
              ▨ Menu Layouts
            </div>
            <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], marginTop: 4, lineHeight: 1.5, maxWidth: 640 }}>
              The <b>live</b> layout is the regular menu — every booking gets it. Every other layout
              is a <b>special menu</b> (a four-hands dinner, an event): pick it on a reservation under
              “Menu layout” and that party’s printed menu, kitchen ticket and course flow all follow it.
              To build one, add any guest chef dishes in Dishes first, then “+ Empty layout” and fill
              each course slot with ours or theirs. Each layout has its own Long and Short version
              (LONG / SHORT toggle below). Edits auto-save.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <button onClick={handleCreateBlank} style={btn(false)}>+ Empty layout</button>
            <button onClick={handleCreate} style={btn(false)} disabled={!active}
              title={active ? `Start from a copy of ${active.name}` : undefined}>+ Copy of current</button>
          </div>
        </div>

        {/* Profile selector — live first, then the special layouts */}
        <div style={{ marginBottom: 14 }}>
          {guestProfiles.length === 0 && (
            <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], padding: 6 }}>None yet.</div>
          )}
          {liveProfiles.length > 0 && (
            <>
              <div style={lbl}>Live menu</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 10 }}>
                {liveProfiles.map(p => (
                  <ProfileButton
                    key={p.id} profile={p} active={active?.id === p.id}
                    assignments={layoutAssignments}
                    onClick={() => onSelectLayoutProfile?.(p.id)}
                  />
                ))}
              </div>
            </>
          )}
          {specialProfiles.length > 0 && (
            <>
              <div style={lbl}>Special layouts — pick on a reservation ({specialProfiles.length})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {specialProfiles.map(p => (
                  <ProfileButton
                    key={p.id} profile={p} active={active?.id === p.id}
                    assignments={layoutAssignments}
                    bookings={layoutBookings?.[p.id]}
                    special
                    onClick={() => onSelectLayoutProfile?.(p.id)}
                  />
                ))}
              </div>
            </>
          )}
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
                <button onClick={() => { setRenameDraft(active.name); setRenaming(true); }} style={btn(false)}>Rename</button>
                <button onClick={handleDuplicate} style={btn(false)}>Duplicate</button>
                <button
                  onClick={handleDelete}
                  disabled={!canDeleteProfile(active.id, layoutProfiles, layoutAssignments)}
                  title={
                    isProfileAssigned(active.id, layoutAssignments)
                      ? "Make a different layout live before deleting this one"
                      : "Delete this layout"
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

        {/* Kitchen badge — only meaningful for a special layout */}
        {active && !activeIsLive && (
          <div style={{
            display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
            padding: 10, background: tokens.ink.bg, border: `1px solid ${tokens.ink[5]}`, marginBottom: 14,
          }}>
            <label style={{ ...lbl, marginBottom: 0 }} htmlFor="layout-badge">Kitchen badge</label>
            <BadgeInput
              key={active.id}
              id="layout-badge"
              value={active.badge || ""}
              placeholder={active.name}
              onCommit={(v) => onSetLayoutProfileBadge?.(active.id, v)}
            />
            <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], flex: "1 1 220px" }}>
              Short tag on the kitchen ticket and reservation list for parties on this layout
              (e.g. “4 HANDS”). Empty uses the layout name.
            </span>
            {activeBookings?.count > 0 && (
              <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[1], width: "100%" }}>
                Booked: {bookingSummary(activeBookings)}
              </span>
            )}
          </div>
        )}

        {/* Active menu profile selector — which profile is live (printed for guests) */}
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
                    No profiles yet — create one above.
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
          key={active.id}
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
          logoDataUri={logoDataUri}
          layoutStyles={layoutStyles}
          wines={wines}
          cocktails={cocktails}
          spirits={spirits}
          beers={beers}
          aperitifOptions={aperitifOptions}
          profileLabel={profileLabel}
          shortMenuTemplate={shortMenuTemplate}
          onUpdateShortMenuTemplate={onUpdateShortMenuTemplate}
          profileTarget={active?.target || "guest_menu"}
          ticketTemplate={ticketTemplate}
          onUpdateTicketTemplate={onUpdateTicketTemplate}
          shortTicketTemplate={shortTicketTemplate}
          onUpdateShortTicketTemplate={onUpdateShortTicketTemplate}
        />
      ) : (
        <div style={{
          fontFamily: FONT, fontSize: 11, color: tokens.ink[3], padding: 24,
          border: `1px dashed ${tokens.ink[4]}`, textAlign: "center",
        }}>
          No layout yet. Click "+ Empty layout" above to create one.
        </div>
      )}
    </div>
  );
}

const fmtDay = (iso) => {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : `${d.getDate()}.${d.getMonth() + 1}.`;
};

function bookingSummary(b) {
  if (!b?.count) return "";
  const dates = (b.dates || []).slice(0, 3).map(fmtDay).join(", ") + ((b.dates || []).length > 3 ? "…" : "");
  return `${b.count} booking${b.count === 1 ? "" : "s"} · ${b.guests} guests · ${dates}`;
}

// Commits on blur / Enter so every keystroke isn't a synced write.
function BadgeInput({ id, value, placeholder, onCommit }) {
  const [draft, setDraft] = useState(value);
  const commit = () => { if (draft.trim() !== value) onCommit(draft.trim()); };
  return (
    <input
      id={id}
      value={draft}
      maxLength={24}
      placeholder={placeholder}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
      style={{ ...inp, width: 160, textTransform: "uppercase" }}
    />
  );
}

function ProfileButton({ profile, active, assignments, onClick, bookings = null, special = false }) {
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
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {slots.map(slot => <Badge key={slot} text={SLOT_BADGE[slot] || slot} />)}
        {special && (
          <span style={{
            fontSize: 8, letterSpacing: "0.12em", padding: "1px 5px", textTransform: "uppercase",
            background: tokens.charcoal.default, color: tokens.neutral[0], fontWeight: 700,
          }}>{String(profile.badge || profile.name || "").trim()}</span>
        )}
        {special && (
          <span style={{ fontSize: 9, color: tokens.ink[3] }}>
            {bookings?.count ? bookingSummary(bookings) : "No upcoming bookings"}
          </span>
        )}
      </div>
    </button>
  );
}
