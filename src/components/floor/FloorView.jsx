import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import FloorMap from "./FloorMap.jsx";
import {
  getActiveDiningMap, getTerraceMap, terraceOccupancy, boardIdsOf,
  resolveReservationTable, floorStatusOf, mapTicker,
} from "../../utils/floorMaps.js";
import { visitStateOf, isArmed } from "../../utils/terraceFlow.js";
import { getVisibleCoursesForTable, getCourseProgressState } from "../../utils/courseProgress.js";

const FONT = tokens.font;

// FloorView — the FOH floor surface (serviceView "floor"). One spatial
// projection of the same App state the board renders: map tabs (active dining
// layout + terrace), a ticker strip, and the shared FloorMap renderer in
// `service` mode.
//
// Tap model (per Djan): a DINING table is one big SET toggle. The board
// stays the place for guest details; no quick-access sheet on the floor.
// Exceptions that DO open a sheet, because they carry an action the tap
// can't mean: an ARRIVING dining table (MARK SEATED) and every terrace
// table (assign / MOVE / CHANGE / CLEAR, plus the party's waters by seat
// position + pairings — the runner's crib sheet).
//
// STRICTLY service — geometry editing is an admin concern and lives in the
// Floor & Terrace panel (FloorEditor), not here.

const btn = (on) => ({
  fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
  padding: "8px 14px", marginLeft: -1, borderRadius: 0, cursor: "pointer",
  border: `1px solid ${on ? tokens.charcoal.default : tokens.ink[4]}`,
  background: on ? tokens.charcoal.default : tokens.neutral[0],
  color: on ? tokens.neutral[0] : tokens.ink[2], fontWeight: on ? 600 : 400,
  touchAction: "manipulation",
});

const actionBtn = (primary) => ({
  fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
  padding: "10px 14px", border: `1px solid ${primary ? tokens.ink[0] : tokens.ink[4]}`,
  background: primary ? tokens.ink[0] : tokens.neutral[0],
  color: primary ? tokens.neutral[0] : tokens.ink[2],
  borderRadius: 0, cursor: "pointer", touchAction: "manipulation", fontWeight: primary ? 600 : 400,
});

export default function FloorView({
  floorMaps, floorStatus, reservations = [], tables = [],
  menuCourses = [], profiles = [], assignments = {},
  onCycleStatus,
  onAssign, onClear, onMove, onMarkSeated,
  onSendSetToKitchen,
  isMobile,
}) {
  const diningMap = getActiveDiningMap(floorMaps);
  const terraceMap = getTerraceMap(floorMaps);
  const tabs = [diningMap, terraceMap].filter(Boolean);

  const [tabId, setTabId] = useState(null);
  const [sheetLabel, setSheetLabel] = useState(null);
  const [movingParty, setMovingParty] = useState(null); // terrace CHANGE TABLE: the reservation being re-seated
  const [toast, setToast] = useState(null);

  const map = tabs.find((m) => m.id === tabId) || tabs[0];
  if (!map) return null;

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };
  const switchTab = (id) => { setTabId(id); setSheetLabel(null); setMovingParty(null); };

  const progressOf = (boardTable) => {
    if (!boardTable) return "";
    const visible = getVisibleCoursesForTable(boardTable, menuCourses, { profiles, assignments });
    const p = getCourseProgressState(boardTable, visible);
    return p.total ? `C${p.firedCount}/${p.total}` : "";
  };

  const diningLabelOf = (r) =>
    resolveReservationTable(diningMap, r.table_id).table?.label || `T${r.table_id}`;

  // A merge's slots point at the group's PRIMARY board table — the one whose
  // card the board shows (same rule as DisplayBoard's isPrimary).
  const boardTableOf = (mapTable) => {
    const id = boardIdsOf(mapTable)[0];
    const bt = tables.find((x) => x.id === id) || null;
    if (bt?.tableGroup?.length) {
      const primary = Math.min(...bt.tableGroup);
      return tables.find((x) => x.id === primary) || bt;
    }
    return bt;
  };

  const arrivingOf = (mapTable) => {
    const ids = boardIdsOf(mapTable);
    return reservations.find((r) =>
      visitStateOf(r.data) === "arriving" && ids.includes(Number(r.table_id))) || null;
  };

  // ── per-table presentation for the visible map ────────────────────────────
  // NO reservation names on the FOH floor (per Djan): tables read label +
  // ×pax + course; the runner's info is the per-seat water·pairing note at
  // each chair. Names stay on the board and the terrace assign picker.
  // Waters are ALREADY house shortcuts (XC / XW / OC / OW) — show the stored
  // value untouched. Pairings use the house codes; unknown values fall back
  // to their initials.
  const PAIRING_CODES = { "Wine": "WP", "Non-Alc": "NA", "Premium": "PWP", "Our Story": "OS" };
  const pairingCode = (p) => {
    const v = String(p || "").trim();
    if (!v || v === "—") return "";
    return PAIRING_CODES[v] || v.split(/[\s-]+/).map((w) => w.charAt(0)).join("").toUpperCase();
  };
  const bevNote = (s) => {
    const water = s.water && s.water !== "—" ? String(s.water).toUpperCase() : "";
    return [water, pairingCode(s.pairing)].filter(Boolean).join("·");
  };
  const seatNotesOf = (bt) => {
    const notes = {};
    for (const s of bt?.seats || []) {
      const note = bevNote(s);
      if (note) notes[Number(s.id)] = note;
    }
    return Object.keys(notes).length ? notes : null;
  };

  const occ = map.kind === "terrace" ? terraceOccupancy(reservations) : {};
  const tableState = {};
  const restrictionsByLabel = {};
  const seatNotesByLabel = {};
  for (const t of map.tables || []) {
    const strip = floorStatusOf(floorStatus, map.id, t.label);
    if (map.kind === "terrace") {
      const r = occ[t.label];
      const restr = (r?.data?.restrictions || []).filter((x) => x && x.note);
      tableState[t.label] = r
        ? {
            status: "occupied",
            pax: r.data?.guests || undefined, // ticker covers; not rendered
            // the party's identity on the terrace IS their dining table
            sub: diningLabelOf(r),
            badge: isArmed(r.data) ? { text: "LAST BITE ✓" } : undefined,
            allergy: restr.length > 0,
            strip,
          }
        : { status: "free", strip };
      if (restr.length) restrictionsByLabel[t.label] = restr;
      if (r) {
        const notes = seatNotesOf(tables.find((x) => x.id === Number(r.table_id)));
        if (notes) seatNotesByLabel[t.label] = notes;
      }
    } else {
      const bt = boardTableOf(t);
      const arriving = arrivingOf(t);
      const restr = (bt?.restrictions || []).filter((x) => x && x.note);
      if (bt?.active) {
        tableState[t.label] = {
          status: "occupied",
          pax: bt.guests || undefined, // ticker covers; not rendered
          allergy: restr.length > 0,
          strip,
        };
        const notes = seatNotesOf(bt);
        if (notes) seatNotesByLabel[t.label] = notes;
      } else if (arriving) {
        tableState[t.label] = {
          status: "arriving",
          pax: arriving.data?.guests || undefined,
          badge: { text: "ARRIVING · KV" },
          strip,
        };
      } else if (bt && (bt.resName || bt.resTime)) {
        tableState[t.label] = {
          status: "reserved",
          pax: bt.guests || undefined,
          allergy: restr.length > 0,
          strip,
        };
      } else {
        tableState[t.label] = { status: "free", strip };
      }
      if (restr.length) restrictionsByLabel[t.label] = restr;
    }
  }

  const ticker = mapTicker(Object.values(tableState));

  // Parties the terrace tab must keep reachable even without a tile:
  // - an ARMED party whose terrace table was cleared mid-visit (no label),
  // - ANY terrace party whose label no longer exists on the current map
  //   (tile renamed/deleted mid-service). No tile means no sheet, no MOVE,
  //   and no self-heal (visitStateOf stays map-blind on purpose) — this
  //   banner is the only way back in for both.
  const mapLabels = new Set((map.tables || []).map((t) => t.label));
  const strandedArmed = map.kind === "terrace"
    ? reservations.filter((r) =>
        visitStateOf(r.data) === "terrace" &&
        (r.data?.terrace_table ? !mapLabels.has(r.data.terrace_table) : isArmed(r.data)))
    : [];

  // Parties eligible for a terrace assignment: anyone without a terrace leg
  // yet. Seated-inside parties stay eligible — Djan seats the board table
  // first (courses start) while the party physically sits outside.
  const bookedParties = reservations.filter((r) =>
    visitStateOf(r.data) === "booked" && !r.data?.clearedFromBoard);

  // SET tables with a live board ticket — what SEND forwards to the kitchen.
  const sendableIds = map.kind === "terrace" ? [] : [...new Set(
    (map.tables || [])
      .filter((t) => floorStatusOf(floorStatus, map.id, t.label) === "SET")
      .map((t) => boardTableOf(t))
      .filter((bt) => bt?.active)
      .map((bt) => bt.id),
  )];

  // ── sheet content for the tapped table ────────────────────────────────────
  const sheetTable = sheetLabel ? (map.tables || []).find((t) => t.label === sheetLabel) : null;
  const sheetParty = sheetTable && map.kind === "terrace" ? occ[sheetLabel] : null;
  const sheetBoard = sheetTable && map.kind !== "terrace" ? boardTableOf(sheetTable) : null;
  const sheetArriving = sheetTable && map.kind !== "terrace" ? arrivingOf(sheetTable) : null;

  const sheetBody = () => {
    if (map.kind === "terrace") {
      // Terrace tables are settable too ("set for bites"): the same
      // floor_status_v1 strip the dining tables use, toggled from the sheet
      // (a terrace body-tap must keep opening the sheet — it carries assign/
      // move actions a status cycle can't mean). The kitchen's terrace tab
      // already renders these strips live, so SET is visible there instantly.
      const sheetStrip = floorStatusOf(floorStatus, map.id, sheetLabel);
      const setToggle = (
        <button
          style={actionBtn(sheetStrip !== "SET")}
          onClick={() => { onCycleStatus(map.id, sheetLabel); setSheetLabel(null); }}>
          {sheetStrip === "SET" ? "UNSET" : "SET FOR BITES"}
        </button>
      );
      if (sheetParty) {
        // the runner's crib sheet: waters by seat position + pairings, from
        // the party's board table (no reservation name — per Djan)
        const bt = tables.find((x) => x.id === Number(sheetParty.table_id)) || null;
        const seats = (bt?.seats || []).filter((s) => (s.water && s.water !== "—") || (s.pairing && s.pairing !== "—"));
        return (
          <div>
            {seats.length > 0 ? (
              <div style={{ marginBottom: 10 }}>
                {seats.map((s) => (
                  <div key={s.id} style={{ display: "flex", gap: 12, alignItems: "baseline", padding: "4px 0", borderBottom: `1px solid ${tokens.ink[5]}` }}>
                    <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: tokens.ink[0], minWidth: 28 }}>P{s.id}</span>
                    <span style={{ fontFamily: FONT, fontSize: 10, color: (s.water && s.water !== "—") ? tokens.ink[1] : tokens.ink[4], textTransform: "uppercase", minWidth: 48 }}>
                      {s.water || "—"}
                    </span>
                    <span style={{ fontFamily: FONT, fontSize: 10, color: (s.pairing && s.pairing !== "—") ? tokens.ink[1] : tokens.ink[4], textTransform: "uppercase" }}>
                      {s.pairing || "—"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3], marginBottom: 10 }}>no waters / pairings yet</div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={actionBtn(true)} onClick={() => { onMove(sheetParty); setSheetLabel(null); }}>
                MOVE TO {diningLabelOf(sheetParty)} →
              </button>
              <button style={actionBtn(false)} onClick={() => { setMovingParty(sheetParty); setSheetLabel(null); }}>
                CHANGE TABLE
              </button>
              <button style={actionBtn(false)} onClick={() => { onClear(sheetParty); setSheetLabel(null); }}>
                CLEAR TABLE
              </button>
              {setToggle}
            </div>
          </div>
        );
      }
      return (
        <div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
            {setToggle}
          </div>
          <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: "0.12em", color: tokens.ink[3], textTransform: "uppercase", margin: "2px 0 6px" }}>
            ASSIGN PARTY
          </div>
          {bookedParties.length === 0 && (
            <div style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3] }}>no waiting parties</div>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {bookedParties.map((r) => (
              <button key={r.id} style={actionBtn(false)}
                onClick={() => {
                  onAssign(r, sheetLabel);
                  flash(`${sheetLabel} → ${(r.data?.resName || "—").toUpperCase()} ×${r.data?.guests || "?"}`);
                  setSheetLabel(null);
                }}>
                {r.data?.resName || "—"} ×{r.data?.guests || "?"}{r.data?.resTime ? ` · ${r.data.resTime}` : ""}
              </button>
            ))}
          </div>
        </div>
      );
    }
    if (sheetArriving && !sheetBoard?.active) {
      return (
        <button style={actionBtn(true)} onClick={() => { onMarkSeated(sheetArriving); setSheetLabel(null); }}>
          MARK SEATED · {sheetLabel}
        </button>
      );
    }
    return null; // dining taps cycle status instead — no sheet
  };

  return (
    <div style={{ margin: isMobile ? "0 12px 40px" : "0 24px 48px" }}>
      {/* map tabs */}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 0, marginBottom: 8 }}>
        {tabs.map((m) => (
          <button key={m.id} style={btn(m.id === map.id)} onClick={() => switchTab(m.id)}>
            {m.name}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {toast && (
          <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.green.text, letterSpacing: "0.08em", fontWeight: 700, marginRight: 10 }}>{toast}</span>
        )}
      </div>

      {/* ticker — the visible map's live counts */}
      <div style={{
        display: "flex", flexWrap: "wrap", gap: "2px 14px", alignItems: "baseline",
        borderTop: `1px solid ${tokens.ink[4]}`, borderBottom: `1px solid ${tokens.ink[4]}`,
        padding: "6px 2px", marginBottom: 8,
        fontFamily: FONT, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase",
      }}>
        <span style={{ color: tokens.ink[0], fontWeight: 700 }}>COVERS {ticker.covers}</span>
        <span style={{ color: tokens.ink[2] }}>SEATED {ticker.seated}</span>
        <span style={{ color: tokens.ink[2] }}>RES {ticker.reserved}</span>
        <span style={{ color: tokens.green.text }}>SET {ticker.set}</span>
        <span style={{ flex: 1 }} />
        {sendableIds.length > 0 && onSendSetToKitchen ? (
          <button
            style={{ ...actionBtn(true), padding: "7px 12px", fontSize: 8 }}
            onClick={() => {
              onSendSetToKitchen(sendableIds);
              flash(`SENT TO KITCHEN ✓ (${sendableIds.length})`);
            }}>
            SEND SET → KITCHEN ({sendableIds.length})
          </button>
        ) : (
          <span style={{ color: tokens.ink[3], fontSize: 8 }}>TAP TABLE → SET / UNSET · TERRACE → SHEET</span>
        )}
      </div>

      {/* CHANGE TABLE banner — armed until a free table is tapped */}
      {movingParty && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          border: `1px solid ${tokens.ink[0]}`, background: tokens.neutral[0],
          padding: "8px 12px", marginBottom: 6,
        }}>
          <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", fontWeight: 700, color: tokens.ink[0] }}>
            TAP A FREE TABLE FOR {(movingParty.data?.resName || "—").toUpperCase()} ×{movingParty.data?.guests || "?"}
          </span>
          <span style={{ flex: 1 }} />
          <button style={actionBtn(false)} onClick={() => setMovingParty(null)}>CANCEL</button>
        </div>
      )}

      {/* stranded terrace parties — no reachable tile (cleared mid-visit or
          the label vanished in a map edit); actions must stay one tap away */}
      {strandedArmed.map((r) => (
        <div key={r.id} style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          padding: "8px 12px", border: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[0], marginBottom: 6,
        }}>
          <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: tokens.ink[0] }}>
            {r.data?.resName || "—"} {r.data?.guests ? `×${r.data.guests}` : ""}
          </span>
          {isArmed(r.data) && (
            <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: "0.1em", background: tokens.ink[0], color: tokens.neutral[0], padding: "2px 6px" }}>LAST BITE ✓</span>
          )}
          <span style={{ flex: 1 }} />
          <button style={actionBtn(false)} onClick={() => setMovingParty(r)}>CHANGE TABLE</button>
          <button style={actionBtn(true)} onClick={() => onMove(r)}>MOVE TO {diningLabelOf(r)} →</button>
        </div>
      ))}

      <FloorMap
        map={map}
        mode="service"
        tableState={tableState}
        restrictionsByLabel={restrictionsByLabel}
        seatCodes={false}
        seatNotesByLabel={seatNotesByLabel}
        showPartyLines={false}
        height={isMobile ? 380 : 480}
        onTableTap={(t) => {
          // CHANGE TABLE in flight: the next FREE terrace table tap re-seats
          // the party there.
          if (movingParty && map.kind === "terrace") {
            if (tableState[t.label]?.status === "occupied") { flash("Table occupied"); return; }
            onAssign(movingParty, t.label);
            flash(`${t.label} → ${(movingParty.data?.resName || "—").toUpperCase()}`);
            setMovingParty(null);
            return;
          }
          // terrace tables and ARRIVING dining tables carry actions → sheet;
          // every other dining table is one big SET toggle.
          if (map.kind === "terrace" || tableState[t.label]?.status === "arriving") setSheetLabel(t.label);
          else onCycleStatus(map.id, t.label);
        }}
      />

      {/* table sheet — fixed bottom, thumb-first */}
      {sheetTable && (
        <>
          <div onClick={() => setSheetLabel(null)}
            style={{ position: "fixed", inset: 0, background: tokens.surface.overlay, zIndex: 40 }} />
          <div style={{
            position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 50,
            maxWidth: 760, margin: "0 auto", background: tokens.neutral[0],
            borderTop: `2px solid ${tokens.ink[0]}`, maxHeight: "74vh", overflowY: "auto",
            padding: isMobile ? "12px 12px 24px" : "14px 18px 28px",
          }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10 }}>
              <span style={{ fontFamily: FONT, fontSize: 20, fontWeight: 700, color: tokens.ink[0], letterSpacing: "-0.02em" }}>
                {sheetLabel}
              </span>
              <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.14em", color: tokens.ink[3], textTransform: "uppercase" }}>
                {map.kind === "terrace"
                  ? (sheetParty ? `×${sheetParty.data?.guests || "?"}${isArmed(sheetParty.data) ? " · LAST BITE ✓" : ""}` : "free")
                  : (tableState[sheetLabel]?.status || "free")}
              </span>
              <span style={{ flex: 1 }} />
              <button onClick={() => setSheetLabel(null)}
                style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, border: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[0], color: tokens.ink[2], width: 32, height: 32, cursor: "pointer", borderRadius: 0 }}>
                ✕
              </button>
            </div>
            {sheetBody()}
          </div>
        </>
      )}
    </div>
  );
}
