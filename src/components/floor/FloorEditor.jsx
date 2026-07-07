import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import FloorMap from "./FloorMap.jsx";
import FloorInspector from "./FloorInspector.jsx";
import {
  moveTable, moveSeat, findMapTable, assignSeatNumbers, GEOMETRY_VERSION,
} from "../../utils/floorMaps.js";

const FONT = tokens.font;

// FloorEditor — the geometry editor, an ADMIN surface (mounted in the Floor
// & Terrace panel; the FOH floor view is service-only). Tabs over EVERY map
// (inactive layouts and LAYOUT C drafts included), the shared FloorMap
// canvas in edit mode (drag tables with unit snap, tap to select, drag a
// selected table's chairs along its outline), and the inspector for
// everything else. The SEATS renumber flow lives here too: RENUMBER in the
// inspector flips the canvas to seats mode — tap chairs in service order,
// first-chair re-tap restarts, completion commits (and clears CONFIRM tags).

const btn = (on) => ({
  fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
  padding: "8px 14px", marginLeft: -1, borderRadius: 0, cursor: "pointer",
  border: `1px solid ${on ? tokens.charcoal.default : tokens.ink[4]}`,
  background: on ? tokens.charcoal.default : tokens.neutral[0],
  color: on ? tokens.neutral[0] : tokens.ink[2], fontWeight: on ? 600 : 400,
  touchAction: "manipulation",
});

export default function FloorEditor({
  floorMaps, onUpdateFloorMaps, reservations = [], isMobile,
}) {
  const [tabId, setTabId] = useState(null);
  const [selLabel, setSelLabel] = useState(null);
  const [renumber, setRenumber] = useState(null); // { label, seq } — SEATS tap sequence

  const map = floorMaps.maps.find((m) => m.id === tabId) || floorMaps.maps[0];
  if (!map) return null;

  const switchTab = (id) => { setTabId(id); setSelLabel(null); setRenumber(null); };

  const onRenumber = (label) =>
    setRenumber((prev) => (prev?.label === label ? null : { label, seq: [] }));

  const onSeatTap = (tableLabel, seatIdx) => {
    if (!renumber || tableLabel !== renumber.label) return;
    const table = findMapTable(map, tableLabel);
    const seq = seatIdx === renumber.seq[0] ? [seatIdx] : [...renumber.seq, seatIdx];
    const { seats, complete } = assignSeatNumbers(table.seats, seq);
    if (!complete) { setRenumber({ label: tableLabel, seq }); return; }
    onUpdateFloorMaps({
      ...floorMaps,
      maps: floorMaps.maps.map((m) => m.id !== map.id ? m : {
        ...m,
        tables: m.tables.map((t) => (t.label === tableLabel ? { ...t, seats } : t)),
      }),
    });
    setRenumber(null);
  };

  const renumberPreview = (() => {
    if (!renumber?.seq.length) return {};
    const table = findMapTable(map, renumber.label);
    if (!table) return {};
    return { [renumber.label]: assignSeatNumbers(table.seats, renumber.seq).seats };
  })();

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0, marginBottom: 8 }}>
        {floorMaps.maps.map((m) => (
          <button key={m.id} style={btn(m.id === map.id)} onClick={() => switchTab(m.id)}>
            {m.name}
          </button>
        ))}
      </div>

      {/* the geometry-trap unfreeze: stored blob predates the current seeds */}
      {(floorMaps.geometryVersion || 1) < GEOMETRY_VERSION && (
        <div style={{
          fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
          border: `1px solid ${tokens.signal.warn}`, color: tokens.signal.warn,
          padding: "8px 12px", marginBottom: 8, fontWeight: 700,
        }}>
          NEW DEFAULT GEOMETRY AVAILABLE — RESET MAP
        </div>
      )}

      {renumber ? (
        <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[3], letterSpacing: "0.08em", margin: "0 0 6px" }}>
          tap {renumber.label}'s chairs in service order — {renumber.seq.length}/{findMapTable(map, renumber.label)?.seats?.length || 0} numbered
          (tap the first chair again to restart)
        </div>
      ) : (
        <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[3], letterSpacing: "0.08em", margin: "0 0 6px" }}>
          drag tables to move them · tap a table to edit it below
        </div>
      )}

      <FloorMap
        map={map}
        mode={renumber ? "seats" : "edit"}
        height={isMobile ? 380 : 480}
        selectedLabel={selLabel}
        seatsEditLabel={renumber?.label || null}
        seatsOverride={renumberPreview}
        onSeatTap={onSeatTap}
        onTableTap={(t) => setSelLabel((prev) => (prev === t.label ? null : t.label))}
        onTableMove={(label, x, y) => onUpdateFloorMaps(moveTable(floorMaps, map.id, label, x, y))}
        onSeatMove={(label, i, p) => onUpdateFloorMaps(moveSeat(floorMaps, map.id, label, i, p))}
      />

      <FloorInspector
        floorMaps={floorMaps}
        mapId={map.id}
        selLabel={selLabel}
        reservations={reservations}
        onUpdate={onUpdateFloorMaps}
        onSelect={setSelLabel}
        onSwitchMap={switchTab}
        onRenumber={onRenumber}
        renumbering={!!renumber}
      />
    </div>
  );
}
