import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import FloorMap from "./FloorMap.jsx";
import {
  getTerraceMap, getActiveDiningMap, terraceOccupancy, isTerraceDirty,
  resolveReservationTable,
} from "../../utils/floorMaps.js";
import { visitStateOf, isArmed } from "../../utils/terraceFlow.js";

const FONT = tokens.font;

// TerracePanel — the FOH terrace seam on the service board. Renders the
// terrace map through the shared FloorMap renderer (picker mode: free tables
// tappable, occupied tables inert) and carries the whole terrace leg:
//   tap free table  → assign a booked party (toast `T23 → NOVAK ×2`)
//   tap dirty table → MARK CLEAN, or assign straight over it (a DIRTY table
//                     is assignable — acceptance 5)
//   tap party table → MOVE TO {dining table} / CLEAR TABLE
// plus rows for arriving parties (MARK SEATED) and the edge case of an armed
// party whose terrace table was cleared (MOVE stays reachable).
//
// Collapsed to a single hairline row while unused so the no-terrace service
// is visually unchanged.

const btn = (primary) => ({
  fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
  padding: "8px 12px", border: `1px solid ${primary ? tokens.ink[0] : tokens.ink[4]}`,
  background: primary ? tokens.ink[0] : tokens.neutral[0],
  color: primary ? tokens.neutral[0] : tokens.ink[2],
  borderRadius: 0, cursor: "pointer", touchAction: "manipulation", fontWeight: primary ? 600 : 400,
});

export default function TerracePanel({
  floorMaps, terraceState, reservations = [], tables = [],
  onAssign, onClear, onMove, onMarkSeated, onMarkClean, isMobile,
}) {
  const map = getTerraceMap(floorMaps);
  const diningMap = getActiveDiningMap(floorMaps);
  const [open, setOpen] = useState(false);
  const [selLabel, setSelLabel] = useState(null);
  const [toast, setToast] = useState(null);

  if (!map) return null;

  const occupancy = terraceOccupancy(reservations);
  const occupiedCount = Object.keys(occupancy).length;
  const arrivingParties = reservations.filter((r) => visitStateOf(r.data) === "arriving");
  const strandedArmed = reservations.filter((r) => isArmed(r.data) && !r.data?.terrace_table);
  // A live terrace (anyone out there) keeps the map pinned open; the fold
  // only hides an EMPTY terrace so the no-terrace service looks unchanged.
  const expanded = open || occupiedCount > 0;

  // dining-table label under the ACTIVE layout; MOVE always targets the
  // reservation's CURRENT table_id (the table-change tool may have moved it,
  // even mid-terrace).
  const diningLabelOf = (r) =>
    resolveReservationTable(diningMap, r.table_id).table?.label || `T${r.table_id}`;

  // Parties eligible for a terrace assignment: still booked, not cleared off
  // the board, not already seated inside.
  const seatedIds = new Set(tables.filter((t) => t.active).map((t) => t.id));
  const bookedParties = reservations.filter((r) =>
    visitStateOf(r.data) === "booked" && !r.data?.clearedFromBoard && !seatedIds.has(Number(r.table_id)));

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const tableState = {};
  for (const t of map.tables) {
    const r = occupancy[t.label];
    tableState[t.label] = r
      ? {
          status: "occupied",
          name: r.data?.resName || "—",
          pax: r.data?.guests || undefined,
          sub: r.data?.resTime || "",
          badge: isArmed(r.data) ? { text: "LAST BITE ✓" } : undefined,
          dirty: false,
        }
      : { status: "free", dirty: isTerraceDirty(terraceState, t.label), selectable: true };
  }

  const restrictionsByLabel = {};
  for (const [label, r] of Object.entries(occupancy)) {
    const restr = (r.data?.restrictions || []).filter((x) => x && x.note);
    if (restr.length) restrictionsByLabel[label] = restr;
  }

  const selParty = selLabel ? occupancy[selLabel] : null;
  const selDirty = selLabel ? isTerraceDirty(terraceState, selLabel) : false;

  const partyRow = (r, actions) => (
    <div key={r.id} style={{
      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
      padding: "8px 12px", border: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[0], marginTop: 6,
    }}>
      <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: tokens.ink[0] }}>
        {r.data?.resName || "—"} {r.data?.guests ? `×${r.data.guests}` : ""}
      </span>
      <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[3] }}>→ {diningLabelOf(r)}</span>
      {isArmed(r.data) && (
        <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: "0.1em", background: tokens.ink[0], color: tokens.neutral[0], padding: "2px 6px" }}>LAST BITE ✓</span>
      )}
      <span style={{ flex: 1 }} />
      {actions}
    </div>
  );

  return (
    <div style={{ margin: isMobile ? "0 12px 14px" : "0 24px 20px" }}>
      {/* hairline header row — the whole panel when terrace is unused */}
      <div
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 12, cursor: "pointer",
          borderBottom: `1px solid ${tokens.ink[4]}`, padding: "8px 0",
        }}
      >
        <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: tokens.ink[2], fontWeight: 600 }}>
          [TERRACE]
        </span>
        {occupiedCount > 0 && (
          <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.green.text, letterSpacing: "0.1em" }}>● {occupiedCount} OUT</span>
        )}
        {arrivingParties.length > 0 && (
          <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[1], letterSpacing: "0.1em" }}>◔ {arrivingParties.length} ARRIVING · KV</span>
        )}
        {toast && (
          <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.green.text, letterSpacing: "0.08em", fontWeight: 700 }}>{toast}</span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3] }}>{expanded ? "▴" : "▾"}</span>
      </div>

      {/* arriving + stranded-armed rows stay visible even collapsed — these
          need an action NOW and must not hide behind a fold */}
      {arrivingParties.map((r) => partyRow(r, (
        <button style={btn(true)} onClick={() => onMarkSeated(r)}>MARK SEATED · {diningLabelOf(r)}</button>
      )))}
      {strandedArmed.map((r) => partyRow(r, (
        <button style={btn(true)} onClick={() => onMove(r)}>MOVE TO {diningLabelOf(r)} →</button>
      )))}

      {expanded && (
        <div style={{ marginTop: 8 }}>
          <FloorMap
            map={map}
            mode="picker"
            tableState={tableState}
            restrictionsByLabel={restrictionsByLabel}
            height={isMobile ? 230 : 300}
            onTableTap={(t) => setSelLabel((prev) => (prev === t.label ? null : t.label))}
          />

          {/* action sheet for the tapped table */}
          {selLabel && (
            <div style={{ border: `1px solid ${tokens.ink[4]}`, borderTop: "none", background: tokens.neutral[0], padding: "10px 12px" }}>
              <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.14em", color: tokens.ink[3], textTransform: "uppercase", marginBottom: 8 }}>
                [{selLabel}]{selDirty ? " · DIRTY" : ""}{selParty ? ` · ${selParty.data?.resName || ""} ×${selParty.data?.guests || "?"}` : " · FREE"}
              </div>

              {selParty ? (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button style={btn(true)} onClick={() => { onMove(selParty); setSelLabel(null); }}>
                    MOVE TO {diningLabelOf(selParty)} →
                  </button>
                  <button style={btn(false)} onClick={() => { onClear(selParty); setSelLabel(null); }}>
                    CLEAR TABLE
                  </button>
                </div>
              ) : (
                <div>
                  {selDirty && (
                    <button style={{ ...btn(false), borderColor: tokens.signal.warn, color: tokens.signal.warn, marginBottom: 8 }}
                      onClick={() => { onMarkClean(selLabel); setSelLabel(null); }}>
                      MARK CLEAN
                    </button>
                  )}
                  <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: "0.12em", color: tokens.ink[3], textTransform: "uppercase", margin: "2px 0 6px" }}>
                    ASSIGN PARTY
                  </div>
                  {bookedParties.length === 0 && (
                    <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3] }}>no waiting parties</div>
                  )}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {bookedParties.map((r) => (
                      <button key={r.id} style={btn(false)}
                        onClick={() => {
                          onAssign(r, selLabel);
                          flash(`${selLabel} → ${(r.data?.resName || "—").toUpperCase()} ×${r.data?.guests || "?"}`);
                          setSelLabel(null);
                        }}>
                        {r.data?.resName || "—"} ×{r.data?.guests || "?"}{r.data?.resTime ? ` · ${r.data.resTime}` : ""}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
