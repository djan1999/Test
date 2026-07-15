import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import BlurInput from "../ui/BlurInput.jsx";
import {
  findMapTable, planLayoutSwitch, hasDefaultGeometry, boardIdsOf,
  moveTable, resizeTable, rotateTable, setTableShape, renameTable,
  duplicateTable, addTable, deleteTable, addSeat, removeSeat,
  setTableMembers, setTableBoardIds,
  addMap, renameMap, duplicateMap, deleteMap, resetMapToDefaults,
  sheetOf, patchOpening, deleteOpening, patchZone, deleteZone,
  patchPlanter, deletePlanter, setWallDashed, deleteWall,
} from "../../utils/floorMaps.js";

const FONT = tokens.font;

// FloorInspector — the EDIT-mode panel under the floor canvas. Every button
// applies a pure helper from utils/floorMaps.js through onUpdate (App's
// updateFloorMaps → stateStore); nothing here owns geometry logic.
//
// Two levels: a table selected → table ops (rename, shape, size, rotate,
// duplicate, delete, seats, merge claims); nothing selected → map ops
// (rename, add table, add/duplicate/delete/reset map). Destructive actions
// are two-step (tap once → CONFIRM) instead of a modal — one thumb, no
// plumbing. Editing members/boardIds re-runs the layout-switch resolver on
// tonight's reservations so claim conflicts surface immediately.

const label9 = { fontFamily: FONT, fontSize: 8, letterSpacing: "0.16em", textTransform: "uppercase", color: tokens.ink[3] };

const btn = (on, danger) => ({
  fontFamily: FONT, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase",
  padding: "9px 12px", borderRadius: 0, cursor: "pointer", touchAction: "manipulation",
  border: `1px solid ${danger ? tokens.red.border : on ? tokens.charcoal.default : tokens.ink[4]}`,
  background: on ? tokens.charcoal.default : tokens.neutral[0],
  color: danger ? tokens.red.text : on ? tokens.neutral[0] : tokens.ink[2],
  fontWeight: on ? 600 : 400,
});

const stepper = {
  fontFamily: FONT, fontSize: 12, fontWeight: 700, width: 34, height: 34,
  border: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[0], color: tokens.ink[1],
  borderRadius: 0, cursor: "pointer", touchAction: "manipulation",
};

const inputStyle = {
  fontFamily: FONT, fontSize: 12, fontWeight: 700, width: 110, padding: "8px",
  border: `1px solid ${tokens.ink[2]}`, background: tokens.neutral[0], color: tokens.ink[0],
  borderRadius: 0, outline: "none", textTransform: "uppercase",
};

function Confirm({ children, onConfirm, wide }) {
  const [armed, setArmed] = useState(false);
  return (
    <button
      style={{ ...btn(armed, true), padding: wide ? "9px 16px" : "9px 12px" }}
      onClick={() => {
        if (!armed) { setArmed(true); setTimeout(() => setArmed(false), 3200); return; }
        setArmed(false);
        onConfirm();
      }}>
      {armed ? "CONFIRM ✓" : children}
    </button>
  );
}

const Row = ({ title, children }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "9px 0", borderTop: `1px solid ${tokens.ink[5]}` }}>
    <span style={{ ...label9, minWidth: 64 }}>{title}</span>
    {children}
  </div>
);

export default function FloorInspector({
  floorMaps, mapId, selLabel, sheetSel = null, reservations = [], tableIds = [],
  onUpdate, onSelect, onSheetSelect, onSwitchMap, onRenumber, renumbering = false,
}) {
  const map = floorMaps.maps.find((m) => m.id === mapId);
  if (!map) return null;
  const table = selLabel ? findMapTable(map, selLabel) : null;
  const sheet = sheetOf(map);
  const selDoor = sheetSel?.kind === "door" ? sheet.openings.find((o) => o.id === sheetSel.id) : null;
  const selZone = sheetSel?.kind === "zone" ? sheet.zones.find((z) => z.id === sheetSel.id) : null;
  const selPlanter = sheetSel?.kind === "planter" ? sheet.planters.find((p) => p.id === sheetSel.id) : null;
  const selWall = sheetSel?.kind === "wall" ? sheet.walls.find((w) => w.id === sheetSel.id) : null;
  const sheetThing = selDoor || selZone || selPlanter || selWall;

  const apply = (next) => { if (next !== floorMaps) onUpdate(next); };
  const dropSheetSel = (next) => { apply(next); onSheetSelect && onSheetSelect(null); };

  // Claim conflicts under THIS map for tonight — the same resolver the
  // active-layout switch confirms with. Only trouble rows surface.
  const trouble = map.kind === "dining"
    ? planLayoutSwitch(map, reservations).filter((r) => r.status === "conflict" || r.status === "needs_table")
    : [];

  const configuredIds = [...new Set((tableIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))]
    .sort((a, b) => a - b);
  const slotOptions = configuredIds.length > 0 ? configuredIds : [...Array(10)].map((_, i) => i + 1);
  const memberOptions = slotOptions.map((id) => `T${id}`);

  return (
    <div style={{
      border: `1.5px solid ${tokens.ink[0]}`, background: tokens.neutral[0],
      boxShadow: `4px 4px 0 ${tokens.ink[5]}`, marginTop: 12,
    }}>
      {/* drafting-card header strip, per the mockup's inspector */}
      <div style={{
        display: "flex", alignItems: "baseline", gap: 10, padding: "9px 12px",
        borderBottom: `1.5px solid ${tokens.ink[0]}`, background: tokens.ink[5],
      }}>
        <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", fontWeight: 700, color: tokens.ink[0] }}>
          {sheetThing
            ? `INSPECTOR — ${selDoor ? (selDoor.kind === "pass" ? "PASSAGE" : "DOOR") : selZone ? "ZONE" : selPlanter ? "PLANTER" : "WALL"}`
            : table ? `INSPECTOR — ${table.label}` : `MAP — ${map.name}`}
        </span>
        {table && !sheetThing && (
          <span style={{ ...label9, marginLeft: "auto" }}>
            X{table.x} · Y{table.y} · {table.w}×{table.h}
          </span>
        )}
      </div>
      <div style={{ padding: "2px 12px 12px" }}>

      {selDoor ? (
        <>
          <Row title="TYPE">
            <button style={btn(selDoor.kind !== "pass")} onClick={() => apply(patchOpening(floorMaps, mapId, selDoor.id, { kind: "door" }))}>DOOR</button>
            <button style={btn(selDoor.kind === "pass")} onClick={() => apply(patchOpening(floorMaps, mapId, selDoor.id, { kind: "pass" }))}>PASSAGE</button>
          </Row>
          <Row title="WIDTH">
            <button style={stepper} onClick={() => apply(patchOpening(floorMaps, mapId, selDoor.id, { width: selDoor.width - 2 }))}>−</button>
            <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: tokens.ink[0], minWidth: 24, textAlign: "center" }}>{selDoor.width}</span>
            <button style={stepper} onClick={() => apply(patchOpening(floorMaps, mapId, selDoor.id, { width: selDoor.width + 2 }))}>+</button>
            {selDoor.kind !== "pass" && (
              <>
                <button style={btn(false)} onClick={() => apply(patchOpening(floorMaps, mapId, selDoor.id, { swing: -selDoor.swing }))}>SWING ⇅</button>
                <button style={btn(false)} onClick={() => apply(patchOpening(floorMaps, mapId, selDoor.id, { hinge: selDoor.hinge ? 0 : 1 }))}>HINGE ⇄</button>
              </>
            )}
            <Confirm onConfirm={() => dropSheetSel(deleteOpening(floorMaps, mapId, selDoor.id))}>DELETE</Confirm>
          </Row>
        </>
      ) : selZone ? (
        <>
          <Row title="LABEL">
            <BlurInput
              committedValue={selZone.label}
              onCommit={(v) => apply(patchZone(floorMaps, mapId, selZone.id, { label: v }))}
              style={{ ...inputStyle, width: 180 }}
            />
          </Row>
          <Row title="SIZE">
            <span style={label9}>W</span>
            <button style={stepper} onClick={() => apply(patchZone(floorMaps, mapId, selZone.id, { w: selZone.w - 4 }))}>−</button>
            <button style={stepper} onClick={() => apply(patchZone(floorMaps, mapId, selZone.id, { w: selZone.w + 4 }))}>+</button>
            <span style={label9}>H</span>
            <button style={stepper} onClick={() => apply(patchZone(floorMaps, mapId, selZone.id, { h: selZone.h - 4 }))}>−</button>
            <button style={stepper} onClick={() => apply(patchZone(floorMaps, mapId, selZone.id, { h: selZone.h + 4 }))}>+</button>
            <Confirm onConfirm={() => dropSheetSel(deleteZone(floorMaps, mapId, selZone.id))}>DELETE</Confirm>
          </Row>
          <div style={{ ...label9, paddingTop: 8, letterSpacing: "0.08em" }}>drag the zone on the canvas to move it</div>
        </>
      ) : selPlanter ? (
        <Row title="SIZE">
          <button style={stepper} onClick={() => apply(patchPlanter(floorMaps, mapId, selPlanter.id, { r: selPlanter.r - 1 }))}>−</button>
          <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: tokens.ink[0], minWidth: 20, textAlign: "center" }}>{selPlanter.r}</span>
          <button style={stepper} onClick={() => apply(patchPlanter(floorMaps, mapId, selPlanter.id, { r: selPlanter.r + 1 }))}>+</button>
          <Confirm onConfirm={() => dropSheetSel(deletePlanter(floorMaps, mapId, selPlanter.id))}>DELETE</Confirm>
        </Row>
      ) : selWall ? (
        <Row title="STYLE">
          <button style={btn(!selWall.dashed)} onClick={() => apply(setWallDashed(floorMaps, mapId, selWall.id, false))}>SOLID</button>
          <button style={btn(selWall.dashed)} onClick={() => apply(setWallDashed(floorMaps, mapId, selWall.id, true))}>DASHED</button>
          <Confirm onConfirm={() => dropSheetSel(deleteWall(floorMaps, mapId, selWall.id))}>DELETE WALL</Confirm>
        </Row>
      ) : table ? (
        <>
          <Row title="LABEL">
            <BlurInput
              committedValue={table.label}
              onCommit={(v) => {
                const clean = String(v || "").trim().toUpperCase();
                const next = renameTable(floorMaps, mapId, table.label, clean);
                // meta lets App carry the label-keyed data (SET strip, chair
                // assignments) to the new name instead of orphaning it
                if (next !== floorMaps) { onUpdate(next, { renamedTable: { mapId, from: table.label, to: clean } }); onSelect(clean); }
              }}
              style={inputStyle}
            />
            <button style={btn(table.shape !== "round")} onClick={() => apply(setTableShape(floorMaps, mapId, table.label, "rect"))}>RECT</button>
            <button style={btn(table.shape === "round")} onClick={() => apply(setTableShape(floorMaps, mapId, table.label, "round"))}>ROUND</button>
          </Row>

          <Row title="SIZE">
            <span style={label9}>W</span>
            <button style={stepper} onClick={() => apply(resizeTable(floorMaps, mapId, table.label, table.w - 2, table.h))}>−</button>
            <button style={stepper} onClick={() => apply(resizeTable(floorMaps, mapId, table.label, table.w + 2, table.h))}>+</button>
            <span style={label9}>H</span>
            <button style={stepper} onClick={() => apply(resizeTable(floorMaps, mapId, table.label, table.w, table.h - 2))}>−</button>
            <button style={stepper} onClick={() => apply(resizeTable(floorMaps, mapId, table.label, table.w, table.h + 2))}>+</button>
            <button style={btn(false)} onClick={() => apply(rotateTable(floorMaps, mapId, table.label))}>⟳ ROTATE</button>
          </Row>

          <Row title="SEATS">
            <button style={stepper} onClick={() => apply(removeSeat(floorMaps, mapId, table.label))}>−</button>
            <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: tokens.ink[0], minWidth: 18, textAlign: "center" }}>
              {(table.seats || []).length}
            </span>
            <button style={stepper} onClick={() => apply(addSeat(floorMaps, mapId, table.label))}>+</button>
            <button style={btn(renumbering)} onClick={() => onRenumber(table.label)}>
              {renumbering ? "TAP CHAIRS IN ORDER…" : "RENUMBER"}
            </button>
            <span style={{ ...label9, letterSpacing: "0.08em" }}>drag a chair on the canvas to move it</span>
          </Row>

          {map.kind === "dining" && (
            <>
              <Row title="MEMBERS">
                {memberOptions.map((m) => {
                  const on = (table.members || []).includes(m);
                  return (
                    <button key={m} style={{ ...btn(on), padding: "8px 9px" }}
                      onClick={() => apply(setTableMembers(floorMaps, mapId, table.label,
                        on ? (table.members || []).filter((x) => x !== m) : [...(table.members || []), m]))}>
                      {m}
                    </button>
                  );
                })}
              </Row>
              <Row title="SLOTS">
                {slotOptions.map((id) => {
                  const on = (table.boardIds || []).includes(id);
                  // label-fallback linkage (boardIdsOf reads "T4"/"T2-3" when
                  // no explicit claim exists) renders as a dashed claim — the
                  // operator can finally SEE what an editor-built table reads,
                  // and that a primed duplicate ("T4'") reads nothing.
                  const viaLabel = !on && !(table.boardIds || []).length && boardIdsOf(table).includes(id);
                  return (
                    <button key={id}
                      style={{
                        ...btn(on), padding: "8px 10px",
                        ...(viaLabel ? {
                          border: `1px dashed ${tokens.charcoal.default}`,
                          color: tokens.ink[1], fontWeight: 600,
                        } : {}),
                      }}
                      title={viaLabel ? "Linked via the table's label — tap to make it explicit" : undefined}
                      onClick={() => apply(setTableBoardIds(floorMaps, mapId, table.label,
                        on ? (table.boardIds || []).filter((x) => x !== id) : [...(table.boardIds || []), id]))}>
                      {id}
                    </button>
                  );
                })}
                {!(table.boardIds || []).length && (
                  <span style={{
                    fontFamily: FONT, fontSize: 8, letterSpacing: "0.1em", textTransform: "uppercase",
                    color: boardIdsOf(table).length ? tokens.ink[3] : tokens.signal.alert, fontWeight: 700,
                  }}>
                    {boardIdsOf(table).length
                      ? `via label → ${boardIdsOf(table).join(", ")}`
                      : "UNLINKED — this table reads no board slot"}
                  </span>
                )}
              </Row>
            </>
          )}

          <Row title="TABLE">
            <button style={btn(false)} onClick={() => apply(duplicateTable(floorMaps, mapId, table.label))}>DUPLICATE</button>
            <Confirm onConfirm={() => { apply(deleteTable(floorMaps, mapId, table.label)); onSelect(null); }}>
              DELETE {table.label}
            </Confirm>
          </Row>
        </>
      ) : (
        <>
          <Row title="NAME">
            <BlurInput
              committedValue={map.name}
              onCommit={(v) => apply(renameMap(floorMaps, mapId, v))}
              style={{ ...inputStyle, width: 180 }}
            />
            <span style={label9}>{map.kind}</span>
          </Row>
          <Row title="TABLES">
            <button style={btn(false)} onClick={() => apply(addTable(floorMaps, mapId))}>+ TABLE</button>
            <span style={{ ...label9, letterSpacing: "0.08em" }}>tap a table on the canvas to edit it</span>
          </Row>
          <Row title="MAPS">
            <button style={btn(false)} onClick={() => {
              const next = addMap(floorMaps, map.kind);
              onUpdate(next);
              onSwitchMap(next.maps[next.maps.length - 1].id);
            }}>+ MAP</button>
            <button style={btn(false)} onClick={() => {
              const next = duplicateMap(floorMaps, mapId);
              onUpdate(next);
              onSwitchMap(next.maps[next.maps.length - 1].id);
            }}>DUPLICATE MAP</button>
            <Confirm onConfirm={() => {
              const next = deleteMap(floorMaps, mapId);
              if (next === floorMaps) return; // last of its kind — guard held
              onUpdate(next);
              onSwitchMap(next.maps.find((m) => m.kind === map.kind)?.id || next.maps[0].id);
            }}>
              DELETE MAP
            </Confirm>
            {hasDefaultGeometry(mapId) && (
              <Confirm onConfirm={() => apply(resetMapToDefaults(floorMaps, mapId))} wide>
                RESET TO DEFAULTS
              </Confirm>
            )}
          </Row>
        </>
      )}

      {/* claim conflicts under this map, straight from the switch resolver */}
      {trouble.length > 0 && (
        <div style={{ borderTop: `1px solid ${tokens.ink[5]}`, paddingTop: 8, marginTop: 2 }}>
          <div style={{ ...label9, marginBottom: 4 }}>RESOLVE — tonight's reservations against this map</div>
          {trouble.map((r) => (
            <div key={r.id} style={{ display: "flex", gap: 10, alignItems: "baseline", padding: "3px 0" }}>
              <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: "0.1em", fontWeight: 700, minWidth: 84, textTransform: "uppercase",
                color: r.status === "conflict" ? tokens.red.text : tokens.signal.warn }}>
                {r.status === "needs_table" ? "NEEDS TABLE" : "CONFLICT"}
              </span>
              <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[1], fontWeight: 600 }}>{r.name || "—"}</span>
              <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3] }}>
                T{r.from.join("-")}{r.to ? ` → ${r.label} (T${r.to.join("-")})` : " → unresolved in this map"}
              </span>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
