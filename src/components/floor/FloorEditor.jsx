import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import FloorMap from "./FloorMap.jsx";
import FloorInspector from "./FloorInspector.jsx";
import {
  moveTable, moveSeat, findMapTable, assignSeatNumbers, GEOMETRY_VERSION,
  sheetOf, addWall, addDoorAt, addZoneAt, addPlanterAt, patchZone, patchPlanter,
} from "../../utils/floorMaps.js";

const FONT = tokens.font;

// FloorEditor — the geometry editor, an ADMIN surface (mounted in the Floor
// & Terrace panel; the FOH floor view is service-only). Two layers on one
// canvas, per the reference mockup:
//
//   TABLES — tap to select → inspector; drag a selected table's chairs.
//   Dragging tables is armed by the MOVE tool only (SELECT is the default,
//   so a stray touch can't rearrange the room); RENUMBER flips the canvas
//   to seats mode.
//
//   SHEET — the architecture. SELECT taps sheet elements to edit; MOVE also
//   drags them; WALL places polyline points (ortho snap) finished with CLOSE
//   (room) or END (partition); DOOR cuts an opening into the nearest wall;
//   ZONE / PLANT stamp elements to drag and edit in MOVE.

const btn = (on) => ({
  fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
  padding: "8px 14px", marginLeft: -1, borderRadius: 0, cursor: "pointer",
  border: `1px solid ${on ? tokens.charcoal.default : tokens.ink[4]}`,
  background: on ? tokens.charcoal.default : tokens.neutral[0],
  color: on ? tokens.neutral[0] : tokens.ink[2], fontWeight: on ? 600 : 400,
  touchAction: "manipulation",
});

const TOOLS = [["SELECT", "select"], ["MOVE", "move"], ["WALL", "wall"], ["DOOR", "door"], ["ZONE", "zone"], ["PLANT", "plant"]];

const HINTS = {
  select: "tap anything to edit it — pick MOVE to rearrange the room",
  move: "drag tables, zones & planters · tap anything to edit it",
  wall: "tap to place points (ortho snap) — CLOSE makes a room, END a partition",
  door: "tap a wall to cut an opening with a swing arc",
  zone: "tap to stamp a hatched zone",
  plant: "tap to stamp a planter",
};

export default function FloorEditor({
  floorMaps, tableIds = [], onUpdateFloorMaps, reservations = [], isMobile,
}) {
  const [tabId, setTabId] = useState(null);
  const [selLabel, setSelLabel] = useState(null);
  const [renumber, setRenumber] = useState(null); // { label, seq } — SEATS tap sequence
  const [tool, setTool] = useState("select"); // dragging opts in via MOVE
  const [draft, setDraft] = useState([]);         // wall in progress
  const [sheetSel, setSheetSel] = useState(null); // { kind, id }
  const [note, setNote] = useState(null);

  const map = floorMaps.maps.find((m) => m.id === tabId) || floorMaps.maps[0];
  if (!map) return null;

  const flash = (msg) => {
    setNote(msg);
    setTimeout(() => setNote(null), 2200);
  };

  const switchTab = (id) => {
    setTabId(id); setSelLabel(null); setRenumber(null);
    setTool("select"); setDraft([]); setSheetSel(null);
  };

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

  // ── SHEET tools ────────────────────────────────────────────────────────────
  const pickTool = (v) => { setTool(v); setSheetSel(null); if (v !== "wall") setDraft([]); };

  const lastOf = (state, key) => {
    const items = sheetOf(state.maps.find((m) => m.id === map.id))[key];
    return items[items.length - 1] || null;
  };

  const onCanvasTap = (p) => {
    if (tool === "wall") {
      let pt = [Math.round(p.x), Math.round(p.y)];
      if (draft.length) {
        // ortho snap: lock to the dominant axis off the previous point
        const prev = draft[draft.length - 1];
        pt = Math.abs(pt[0] - prev[0]) > Math.abs(pt[1] - prev[1]) ? [pt[0], prev[1]] : [prev[0], pt[1]];
      }
      setDraft([...draft, pt]);
      return;
    }
    if (tool === "door") {
      const next = addDoorAt(floorMaps, map.id, p);
      if (next === floorMaps) { flash("Tap closer to a wall"); return; }
      onUpdateFloorMaps(next);
      setSheetSel({ kind: "door", id: lastOf(next, "openings").id });
      setTool("move");
      return;
    }
    if (tool === "zone") {
      const next = addZoneAt(floorMaps, map.id, p);
      onUpdateFloorMaps(next);
      setSheetSel({ kind: "zone", id: lastOf(next, "zones").id });
      setTool("move");
      return;
    }
    if (tool === "plant") {
      const next = addPlanterAt(floorMaps, map.id, p);
      onUpdateFloorMaps(next);
      setSheetSel({ kind: "planter", id: lastOf(next, "planters").id });
      setTool("move");
    }
  };

  const finishWall = (closed) => {
    const next = addWall(floorMaps, map.id, draft, closed);
    setDraft([]);
    setTool("select"); // walls don't drag — back to tap-to-edit
    if (next === floorMaps) return; // too few points
    onUpdateFloorMaps(next);
    setSheetSel({ kind: "wall", id: lastOf(next, "walls").id });
    flash(closed ? "Room closed" : "Wall placed");
  };

  const onSheetMove = (kind, id, x, y) =>
    onUpdateFloorMaps(kind === "zone"
      ? patchZone(floorMaps, map.id, id, { x, y })
      : patchPlanter(floorMaps, map.id, id, { x, y }));

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0, marginBottom: 8 }}>
        {floorMaps.maps.map((m) => (
          <button key={m.id} style={btn(m.id === map.id)} onClick={() => switchTab(m.id)}>
            {m.name}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {note && (
          <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[1], letterSpacing: "0.08em", fontWeight: 700 }}>{note}</span>
        )}
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

      {!renumber && (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          <div style={{ display: "flex" }}>
            {TOOLS.map(([labelTxt, v]) => (
              <button key={v} style={btn(tool === v)} onClick={() => pickTool(v)}>{labelTxt}</button>
            ))}
          </div>
          {tool === "wall" && draft.length > 0 && (
            <div style={{ display: "flex", gap: 6 }}>
              <button style={btn(false)} onClick={() => finishWall(true)}>CLOSE</button>
              <button style={btn(false)} onClick={() => finishWall(false)}>END</button>
              <button style={btn(false)} onClick={() => { setDraft([]); }}>✕</button>
            </div>
          )}
        </div>
      )}

      <div style={{ fontFamily: FONT, fontSize: 9, color: tokens.ink[3], letterSpacing: "0.08em", margin: "0 0 6px" }}>
        {renumber
          ? `tap ${renumber.label}'s chairs in service order — ${renumber.seq.length}/${findMapTable(map, renumber.label)?.seats?.length || 0} numbered (tap the first chair again to restart)`
          : HINTS[tool]}
      </div>

      <FloorMap
        map={map}
        mode={renumber ? "seats" : "edit"}
        height={isMobile ? 420 : 640}
        selectedLabel={selLabel}
        seatsEditLabel={renumber?.label || null}
        seatsOverride={renumberPreview}
        onSeatTap={onSeatTap}
        onTableTap={(t) => {
          setSheetSel(null);
          setSelLabel((prev) => (prev === t.label ? null : t.label));
        }}
        onTableMove={(label, x, y) => onUpdateFloorMaps(moveTable(floorMaps, map.id, label, x, y))}
        onSeatMove={(label, i, p) => onUpdateFloorMaps(moveSeat(floorMaps, map.id, label, i, p))}
        sheetTool={tool}
        sheetDraft={draft}
        sheetSel={sheetSel}
        onCanvasTap={renumber ? undefined : onCanvasTap}
        onSheetSelect={(hit) => { setSheetSel(hit); if (hit) setSelLabel(null); }}
        onSheetMove={onSheetMove}
      />

      <FloorInspector
        floorMaps={floorMaps}
        tableIds={tableIds}
        mapId={map.id}
        selLabel={selLabel}
        sheetSel={sheetSel}
        reservations={reservations}
        onUpdate={onUpdateFloorMaps}
        onSelect={setSelLabel}
        onSheetSelect={setSheetSel}
        onSwitchMap={switchTab}
        onRenumber={onRenumber}
        renumbering={!!renumber}
      />
    </div>
  );
}
