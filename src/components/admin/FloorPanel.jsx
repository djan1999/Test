import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { FONT } from "./adminStyles.js";
import FloorEditor from "../floor/FloorEditor.jsx";
import {
  planLayoutSwitch, layoutSwitchBlockers, isCurrentServiceRow,
  activeDiningMapIdForDay, setActiveDiningForDay,
} from "../../utils/floorMaps.js";

// ── FloorPanel — floor layouts, geometry editor, terrace flow config ─────────
// Three seams, all persisting through onUpdateFloorMaps → the stateStore seam:
//  · ACTIVE LAYOUT: exactly one dining map is active per service (manual
//    pre-service toggle). Switching re-resolves tonight's reservations and
//    shows the confirm diff (moves / conflicts / NEEDS TABLE) BEFORE applying.
//  · GEOMETRY: the FloorEditor — drag/resize/rename tables, seats (add,
//    remove, drag, tap-in-sequence renumber), merges, maps (duplicate =
//    "LAYOUT C" nights), RESET TO DEFAULTS. Editing is an admin concern;
//    the FOH floor view is service-only.
export default function FloorPanel({
  floorMaps, tableIds = [], reservations = [], serviceDay = null, boardTables = [], onUpdateFloorMaps, onApplyLayoutSwitch, isMobile,
}) {
  const [pendingSwitch, setPendingSwitch] = useState(null); // { mapId, rows }
  const [savingSwitch, setSavingSwitch] = useState(false);
  const [switchError, setSwitchError] = useState("");
  // The switch is FOR today's service: only TODAY's unresolved rows block it.
  // A future date's needs_table is a warning (that day resolves against its
  // own layout), so tonight's room is never held hostage by next week's book.
  const blockedBy = (rows) => layoutSwitchBlockers(rows, serviceDay);
  // Which room is in force for the service being set up — the day's binding
  // if it has one, otherwise the house default. Activating writes the binding
  // for THIS day only, so tomorrow keeps whatever it already had.
  const activeForDay = activeDiningMapIdForDay(floorMaps, serviceDay);

  const diningMaps = floorMaps.maps.filter((m) => m.kind === "dining");

  const label = { fontFamily: FONT, fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: tokens.ink[3], margin: "18px 0 8px" };
  const btn = (on) => ({
    fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
    padding: "8px 16px", marginLeft: -1, borderRadius: 0, cursor: "pointer",
    border: `1px solid ${on ? tokens.charcoal.default : tokens.ink[4]}`,
    background: on ? tokens.charcoal.default : tokens.neutral[0],
    color: on ? tokens.neutral[0] : tokens.ink[2], fontWeight: on ? 600 : 400,
  });

  const requestSwitch = (mapId) => {
    if (mapId === activeForDay) return;
    const nextMap = floorMaps.maps.find((m) => m.id === mapId);
    setSwitchError("");
    setPendingSwitch({ mapId, rows: planLayoutSwitch(nextMap, reservations, boardTables) });
  };

  const confirmSwitch = async () => {
    if (!pendingSwitch || savingSwitch) return;
    // Re-plan against the LIVE board/reservations at confirm time: the dialog
    // can sit open while another device seats a walk-in — applying the stale
    // plan silently blocked or mis-moved those rows. The refreshed rows also
    // repaint the dialog if the confirm is refused below.
    const nextMap = floorMaps.maps.find((m) => m.id === pendingSwitch.mapId);
    const rows = nextMap ? planLayoutSwitch(nextMap, reservations, boardTables) : pendingSwitch.rows;
    if (blockedBy(rows).length) {
      setPendingSwitch({ mapId: pendingSwitch.mapId, rows });
      setSwitchError("Resolve today's conflicts and NEEDS TABLE assignments before activating this layout.");
      return;
    }
    setSavingSwitch(true);
    setSwitchError("");
    try {
      const result = await onApplyLayoutSwitch?.(rows);
      if (result?.ok === false) {
        setSwitchError(result.error?.message || result.error || "The layout switch could not be saved.");
        return;
      }
      onUpdateFloorMaps(serviceDay
        ? setActiveDiningForDay(floorMaps, serviceDay, pendingSwitch.mapId)
        // No service day in context (shouldn't happen in the admin panel) —
        // fall back to the house default so activation is never a no-op.
        : { ...floorMaps, activeDiningMapId: pendingSwitch.mapId });
      setPendingSwitch(null);
    } catch (error) {
      setSwitchError(error?.message || "The layout switch could not be saved.");
    } finally {
      setSavingSwitch(false);
    }
  };

  const statusColor = { move: tokens.ink[1], conflict: tokens.red.text, needs_table: tokens.signal.warn, unchanged: tokens.ink[4] };

  return (
    <div>
      <div style={label}>
        ACTIVE DINING LAYOUT{serviceDay ? ` — FOR ${serviceDay}` : ""}
      </div>
      {serviceDay && (
        <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], margin: "-4px 0 8px" }}>
          Applies to this service day only — other days keep their own layout.
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap" }}>
        {diningMaps.map((m) => (
          <button key={m.id} style={btn(m.id === activeForDay)} onClick={() => requestSwitch(m.id)}>
            {m.name}
          </button>
        ))}
      </div>

      {pendingSwitch && (
        <div style={{ border: `1px solid ${tokens.ink[1]}`, background: tokens.neutral[0], padding: "12px 14px", marginTop: 10 }}>
          <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: tokens.ink[1], fontWeight: 700, marginBottom: 8 }}>
            SWITCH TO {floorMaps.maps.find((m) => m.id === pendingSwitch.mapId)?.name} — RE-RESOLVES UPCOMING ASSIGNMENTS
          </div>
          {pendingSwitch.rows.length === 0 && (
            <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], marginBottom: 8 }}>no reservations for this service</div>
          )}
          {pendingSwitch.rows.filter((r) => r.status !== "unchanged").map((r) => {
            // A future date's unresolved row is a warning, not a blocker — it
            // reads amber and says which night to sort it before, so tonight's
            // switch is never mistaken for breaking next week.
            const future = (r.status === "conflict" || r.status === "needs_table") && !isCurrentServiceRow(r, serviceDay);
            return (
            <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "3px 0", borderBottom: `1px solid ${tokens.ink[5]}` }}>
              <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: "0.1em", fontWeight: 700, minWidth: 84, textTransform: "uppercase", color: future ? tokens.signal.warn : statusColor[r.status] }}>
                {future ? "LATER — REASSIGN" : r.status === "needs_table" ? "NEEDS TABLE" : r.status}
              </span>
              {r.date && <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[3] }}>{r.date}</span>}
              <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[1], fontWeight: 600 }}>{r.name || "—"}</span>
              <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3] }}>
                T{r.from.join("-")}{r.to ? ` → ${r.label} (T${r.to.join("-")})` : " → unresolved in this layout"}
              </span>
              {r.seated && r.status === "move" && (
                <span style={{
                  fontFamily: FONT, fontSize: 8, letterSpacing: "0.1em", fontWeight: 700,
                  color: tokens.green.text, border: `1px solid ${tokens.green.border}`,
                  background: tokens.green.bg, padding: "1px 6px", textTransform: "uppercase",
                }}>
                  SEATED · live state moves too
                </span>
              )}
            </div>
          );})}
          {pendingSwitch.rows.every((r) => r.status === "unchanged") && pendingSwitch.rows.length > 0 && (
            <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], marginBottom: 4 }}>all assignments resolve unchanged</div>
          )}
          {(() => {
            const blockers = blockedBy(pendingSwitch.rows);
            const laterCount = pendingSwitch.rows.filter((r) => (r.status === "conflict" || r.status === "needs_table") && !isCurrentServiceRow(r, serviceDay)).length;
            return (
              <>
                {(switchError || blockers.length > 0) && (
                  <div role="alert" aria-live="assertive" style={{ fontFamily: FONT, fontSize: 10, color: tokens.red.text, marginTop: 10 }}>
                    {switchError || "Resolve today's conflicts and NEEDS TABLE assignments before activating this layout."}
                  </div>
                )}
                {blockers.length === 0 && laterCount > 0 && (
                  <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.signal.warn, marginTop: 10 }}>
                    {laterCount} upcoming booking{laterCount === 1 ? "" : "s"} won&apos;t have a table under this layout — they keep their current assignment and stay put; reassign or set that night&apos;s layout before its service.
                  </div>
                )}
              </>
            );
          })()}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              style={{ ...btn(true), opacity: savingSwitch || blockedBy(pendingSwitch.rows).length > 0 ? 0.5 : 1 }}
              onClick={confirmSwitch}
              disabled={savingSwitch || blockedBy(pendingSwitch.rows).length > 0}
            >{savingSwitch ? "SAVING…" : "CONFIRM SWITCH"}</button>
            <button style={btn(false)} onClick={() => { setPendingSwitch(null); setSwitchError(""); }} disabled={savingSwitch}>CANCEL</button>
          </div>
        </div>
      )}

      <div style={label}>GEOMETRY (drag tables · tap to edit · seats, merges & maps below the canvas)</div>
      <FloorEditor
        floorMaps={floorMaps}
        tableIds={tableIds}
        onUpdateFloorMaps={onUpdateFloorMaps}
        reservations={reservations}
        boardTables={boardTables}
        isMobile={isMobile}
      />

    </div>
  );
}
