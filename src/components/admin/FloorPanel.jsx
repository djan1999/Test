import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { FONT } from "./adminStyles.js";
import FloorMap from "../floor/FloorMap.jsx";
import {
  getActiveDiningMap, findMapTable, planLayoutSwitch, assignSeatNumbers,
} from "../../utils/floorMaps.js";

// ── FloorPanel — floor layouts, seat numbering, terrace flow config ──────────
// Three seams, all persisting through onUpdateFloorMaps → the stateStore seam:
//  · ACTIVE LAYOUT: exactly one dining map is active per service (manual
//    pre-service toggle). Switching re-resolves tonight's reservations and
//    shows the confirm diff (moves / conflicts / NEEDS TABLE) BEFORE applying.
//  · SEATS mode: tap a table, then tap its chair marks in sequence to number
//    them (tapping the first chair again restarts). Numbers commit when every
//    chair is tapped. Seat definitions are per map.
//  · MOVE_SINGLE_TAP: MOVE skips the arriving confirm.
// Walls/doors editing is out of scope — separate track.
export default function FloorPanel({
  floorMaps, reservations = [], onUpdateFloorMaps, onApplyLayoutSwitch,
}) {
  const [pendingSwitch, setPendingSwitch] = useState(null); // { mapId, rows }
  const [seatsMapId, setSeatsMapId] = useState(null);
  const [seatsTable, setSeatsTable] = useState(null); // label
  const [tapSeq, setTapSeq] = useState([]);

  const diningMaps = floorMaps.maps.filter((m) => m.kind === "dining");
  const activeMap = getActiveDiningMap(floorMaps);
  const seatsMap = floorMaps.maps.find((m) => m.id === seatsMapId) || activeMap;

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

  // SEATS mode tap: first-chair re-tap restarts the sequence; a completed
  // sequence commits the new numbering into the map (and drops CONFIRM tags).
  const onSeatTap = (tableLabel, seatIdx) => {
    if (tableLabel !== seatsTable) return;
    const table = findMapTable(seatsMap, tableLabel);
    const seq = seatIdx === tapSeq[0] ? [seatIdx] : [...tapSeq, seatIdx];
    const { seats, complete } = assignSeatNumbers(table.seats, seq);
    if (!complete) { setTapSeq(seq); return; }
    onUpdateFloorMaps({
      ...floorMaps,
      maps: floorMaps.maps.map((m) => m.id !== seatsMap.id ? m : {
        ...m,
        tables: m.tables.map((t) => t.label === tableLabel ? { ...t, seats } : t),
      }),
    });
    setTapSeq([]);
    setSeatsTable(null);
  };

  const seatsPreview = (() => {
    if (!seatsTable || !tapSeq.length) return {};
    const table = findMapTable(seatsMap, seatsTable);
    if (!table) return {};
    return { [seatsTable]: assignSeatNumbers(table.seats, tapSeq).seats };
  })();

  const statusColor = { move: tokens.ink[1], conflict: tokens.red.text, needs_table: tokens.signal.warn, unchanged: tokens.ink[4] };

  return (
    <div>
      <div style={label}>ACTIVE DINING LAYOUT (one per service)</div>
      <div style={{ display: "flex" }}>
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

      <div style={label}>SEAT NUMBERING (per map — tap a table, then its chairs in service order)</div>
      <div style={{ display: "flex", marginBottom: 8 }}>
        {floorMaps.maps.map((m) => (
          <button key={m.id} style={btn(m.id === seatsMap.id)}
            onClick={() => { setSeatsMapId(m.id); setSeatsTable(null); setTapSeq([]); }}>
            {m.name}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {seatsMap.tables.map((t) => (
          <button key={t.label} style={btn(t.label === seatsTable)}
            onClick={() => { setSeatsTable((prev) => prev === t.label ? null : t.label); setTapSeq([]); }}>
            {t.label}{t.seats?.some((s) => s.confirm) ? " ?" : ""}
          </button>
        ))}
      </div>
      {seatsTable && (
        <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[3], marginBottom: 6 }}>
          tap {seatsTable}'s chairs in order — {tapSeq.length}/{findMapTable(seatsMap, seatsTable)?.seats?.length || 0} numbered
          (tap the first chair again to restart)
        </div>
      )}
      <FloorMap
        map={seatsMap}
        mode="seats"
        seatsEditLabel={seatsTable}
        seatsOverride={seatsPreview}
        onSeatTap={onSeatTap}
        height={360}
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
