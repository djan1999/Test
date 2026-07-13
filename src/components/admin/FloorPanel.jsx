import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { FONT } from "./adminStyles.js";
import FloorEditor from "../floor/FloorEditor.jsx";
import { planLayoutSwitch } from "../../utils/floorMaps.js";

// ── FloorPanel — floor layouts, geometry editor, terrace flow config ─────────
// Three seams, all persisting through onUpdateFloorMaps → the stateStore seam:
//  · ACTIVE LAYOUT: exactly one dining map is active per service (manual
//    pre-service toggle). Switching re-resolves tonight's reservations and
//    shows the confirm diff (moves / conflicts / NEEDS TABLE) BEFORE applying.
//  · GEOMETRY: the FloorEditor — drag/resize/rename tables, seats (add,
//    remove, drag, tap-in-sequence renumber), merges, maps (duplicate =
//    "LAYOUT C" nights), RESET TO DEFAULTS. Editing is an admin concern;
//    the FOH floor view is service-only.
//  · MOVE_SINGLE_TAP: MOVE skips the arriving confirm.
export default function FloorPanel({
  floorMaps, tableIds = [], reservations = [], onUpdateFloorMaps, onApplyLayoutSwitch, isMobile,
}) {
  const [pendingSwitch, setPendingSwitch] = useState(null); // { mapId, rows }

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
    if (mapId === floorMaps.activeDiningMapId) return;
    const nextMap = floorMaps.maps.find((m) => m.id === mapId);
    setPendingSwitch({ mapId, rows: planLayoutSwitch(nextMap, reservations) });
  };

  const confirmSwitch = () => {
    onApplyLayoutSwitch(pendingSwitch.rows);
    onUpdateFloorMaps({ ...floorMaps, activeDiningMapId: pendingSwitch.mapId });
    setPendingSwitch(null);
  };

  const statusColor = { move: tokens.ink[1], conflict: tokens.red.text, needs_table: tokens.signal.warn, unchanged: tokens.ink[4] };

  return (
    <div>
      <div style={label}>ACTIVE DINING LAYOUT (one per service)</div>
      <div style={{ display: "flex", flexWrap: "wrap" }}>
        {diningMaps.map((m) => (
          <button key={m.id} style={btn(m.id === floorMaps.activeDiningMapId)} onClick={() => requestSwitch(m.id)}>
            {m.name}
          </button>
        ))}
      </div>

      {pendingSwitch && (
        <div style={{ border: `1px solid ${tokens.ink[1]}`, background: tokens.neutral[0], padding: "12px 14px", marginTop: 10 }}>
          <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: tokens.ink[1], fontWeight: 700, marginBottom: 8 }}>
            SWITCH TO {floorMaps.maps.find((m) => m.id === pendingSwitch.mapId)?.name} — RE-RESOLVES TONIGHT'S ASSIGNMENTS
          </div>
          {pendingSwitch.rows.length === 0 && (
            <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], marginBottom: 8 }}>no reservations for this service</div>
          )}
          {pendingSwitch.rows.filter((r) => r.status !== "unchanged").map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "3px 0", borderBottom: `1px solid ${tokens.ink[5]}` }}>
              <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: "0.1em", fontWeight: 700, minWidth: 84, textTransform: "uppercase", color: statusColor[r.status] }}>
                {r.status === "needs_table" ? "NEEDS TABLE" : r.status}
              </span>
              <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[1], fontWeight: 600 }}>{r.name || "—"}</span>
              <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3] }}>
                T{r.from.join("-")}{r.to ? ` → ${r.label} (T${r.to.join("-")})` : " → unresolved in this layout"}
              </span>
            </div>
          ))}
          {pendingSwitch.rows.every((r) => r.status === "unchanged") && pendingSwitch.rows.length > 0 && (
            <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], marginBottom: 4 }}>all assignments resolve unchanged</div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button style={btn(true)} onClick={confirmSwitch}>CONFIRM SWITCH</button>
            <button style={btn(false)} onClick={() => setPendingSwitch(null)}>CANCEL</button>
          </div>
        </div>
      )}

      <div style={label}>GEOMETRY (drag tables · tap to edit · seats, merges & maps below the canvas)</div>
      <FloorEditor
        floorMaps={floorMaps}
        tableIds={tableIds}
        onUpdateFloorMaps={onUpdateFloorMaps}
        reservations={reservations}
        isMobile={isMobile}
      />

      <div style={label}>TERRACE FLOW</div>
      <label style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[2], display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={!!floorMaps.config?.moveSingleTap}
          onChange={(e) => onUpdateFloorMaps({
            ...floorMaps,
            config: { ...(floorMaps.config || {}), moveSingleTap: e.target.checked },
          })}
        />
        MOVE_SINGLE_TAP — MOVE seats the party immediately, skipping the ARRIVING confirm
      </label>
    </div>
  );
}
