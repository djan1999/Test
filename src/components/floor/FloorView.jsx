import { useEffect, useState } from "react";
import { tokens } from "../../styles/tokens.js";
import FloorMap from "./FloorMap.jsx";
import FloorDock from "./FloorDock.jsx";
import {
  getActiveDiningMap, getTerraceMap, terraceOccupancy, boardIdsOf,
  resolveReservationTable, floorStatusOf, mapTicker,
} from "../../utils/floorMaps.js";
import { visitStateOf } from "../../utils/terraceFlow.js";
import { getVisibleCoursesForTable, getCourseProgressState } from "../../utils/courseProgress.js";
import {
  floorPositionKey, seatFloorPosition, restrictionsAtFloorPositions,
} from "../../utils/tableHelpers.js";

const FONT = tokens.font;

// FloorView — the FOH floor surface (serviceView "floor"). One spatial
// projection of the same App state the board renders: map tabs (active dining
// layout + terrace), a ticker strip, and the shared FloorMap renderer in
// `service` mode.
//
// Tap model (per Djan, 21.08): a tap SELECTS — the dock beside the map
// follows it and carries every action (SET strip, SET → KITCHEN, UNSET,
// extras, DETAILS). The tap itself changes nothing, so peeking at a table
// can never flip its SET by accident (the old tap-toggles-SET model).
// The exception that DOES open a sheet, because it carries actions the dock
// doesn't: every terrace table (assign / MOVE / CHANGE / CLEAR, plus the
// party's waters by seat position + pairings — the runner's crib sheet).
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
  // "terrace" | "dining": the caller owns which map shows (the 11.07
  // flattening — BOARD/TERRACE/DINING ROOM one row up in App); the inner
  // tab bar disappears. Unset → legacy self-owned tabs.
  mapKind = null,
  floorMaps, floorStatus, reservations = [], tables = [],
  menuCourses = [], profiles = [], assignments = {},
  optionalExtras = [], optionalPairings = [],
  onCycleStatus,
  onAssign, onClear, onMove,
  onSendSetToKitchen,
  onSwapSeats,
  onOpenDetail,             // (boardId) → App raises the board's table sheet
  onUnsetKitchen,           // (boardId) → clears the kitchen banner (courseReady)
  upd,                      // (boardId, field, value|fn) — the dock's extras/alert writes
  isMobile,
}) {
  const diningMap = getActiveDiningMap(floorMaps);
  const terraceMap = getTerraceMap(floorMaps);
  const tabs = [diningMap, terraceMap].filter(Boolean);

  const [tabId, setTabId] = useState(null);
  const [sheetLabel, setSheetLabel] = useState(null);
  const [dockLabel, setDockLabel] = useState(null); // the table the side dock follows (last tap)
  const [dockSeatNo, setDockSeatNo] = useState(null); // chair tap → this guest's card in the dock
  const [movingParty, setMovingParty] = useState(null); // terrace CHANGE TABLE: the reservation being re-seated
  const [toast, setToast] = useState(null);

  const forcedMap = mapKind === "terrace" ? terraceMap : mapKind === "dining" ? diningMap : null;
  const map = forcedMap || tabs.find((m) => m.id === tabId) || tabs[0];
  // Leaving the map (App's toggle) must drop the open sheet / pending CHANGE
  // TABLE, exactly like the old tab switch did.
  useEffect(() => {
    if (mapKind) { setSheetLabel(null); setDockLabel(null); setDockSeatNo(null); setMovingParty(null); }
  }, [mapKind]);
  if (!map) return null;

  const flash = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };
  const switchTab = (id) => { setTabId(id); setSheetLabel(null); setDockLabel(null); setDockSeatNo(null); setMovingParty(null); };

  const progressOf = (boardTable) => {
    if (!boardTable) return "";
    const visible = getVisibleCoursesForTable(boardTable, menuCourses, { profiles, assignments });
    const p = getCourseProgressState(boardTable, visible);
    return p.total ? `C${p.firedCount}/${p.total}` : "";
  };

  // The course a board table would announce right now (its next unfired one).
  const nextFireKeyOf = (bt) => {
    if (!bt) return null;
    const visible = getVisibleCoursesForTable(bt, menuCourses, { profiles, assignments });
    return getCourseProgressState(bt, visible).nextFire?.key || null;
  };
  // A SET table has ALREADY been sent when the kitchen already holds a "SET
  // FOR …" banner for the exact course we'd send now — courseReady.key (written
  // by onSendSetToKitchen) equals its current nextFire. Re-sending it is a pure
  // duplicate: pressing SEND after setting a second table used to re-fire the
  // first one too. Already-sent tables drop out of the send set and wear an
  // amber ring instead; they clear on their own when the course fires
  // (courseReady resolves → SET strip drops).
  const alreadySent = (bt) => {
    const nk = nextFireKeyOf(bt);
    return nk != null && bt?.courseReady?.key === nk;
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
  const seatNotesOf = (bt, positionKey) => {
    const notes = {};
    for (const s of bt?.seats || []) {
      const note = bevNote(s);
      if (note) notes[seatFloorPosition(s, positionKey)] = note;
    }
    return Object.keys(notes).length ? notes : null;
  };
  // Chairs outline in the seat's gender color (Mr blue / Mrs pink) so the
  // runner can address the right guest from the map.
  const seatGendersOf = (bt, positionKey) => {
    const out = {};
    for (const s of bt?.seats || []) {
      if (s.gender === "Mr" || s.gender === "Mrs") out[seatFloorPosition(s, positionKey)] = s.gender;
    }
    return Object.keys(out).length ? out : null;
  };
  // A terrace party's live restrictions belong to its BOARD table (seat
  // assignments made in service/kitchen live there) — the reservation blob is
  // only the fallback for parties whose board table isn't templated yet.
  const terracePartyBoardTable = (r) => {
    if (!r) return null;
    let bt = tables.find((x) => x.id === Number(r.table_id)) || null;
    if (bt?.tableGroup?.length) bt = tables.find((x) => x.id === Math.min(...bt.tableGroup)) || bt;
    return bt;
  };

  const occ = map.kind === "terrace" ? terraceOccupancy(reservations) : {};
  const tableState = {};
  const restrictionsByLabel = {};
  const seatNotesByLabel = {};
  const seatGendersByLabel = {};
  for (const t of map.tables || []) {
    const strip = floorStatusOf(floorStatus, map.id, t.label);
    const positionKey = floorPositionKey(map.id, t.label);
    if (map.kind === "terrace") {
      const r = occ[t.label];
      const bt = terracePartyBoardTable(r);
      const restrSource = (bt?.restrictions?.length ? bt.restrictions : r?.data?.restrictions) || [];
      const restr = restrictionsAtFloorPositions(bt?.seats || [], restrSource, positionKey)
        .filter((x) => x && x.note);
      tableState[t.label] = r
        ? {
            status: "occupied",
            pax: r.data?.guests || undefined, // ticker covers; not rendered
            // the party's identity on the terrace IS their dining table
            sub: diningLabelOf(r),
            allergy: restr.length > 0,
            strip,
            // announced to the kitchen (SET on a kitchen ticket, the board
            // sheet, or here) → amber ring, whatever surface pressed it
            sent: alreadySent(bt),
          }
        : { status: "free", strip };
      if (restr.length) restrictionsByLabel[t.label] = restr;
      if (bt) {
        const notes = seatNotesOf(bt, positionKey);
        if (notes) seatNotesByLabel[t.label] = notes;
        const genders = seatGendersOf(bt, positionKey);
        if (genders) seatGendersByLabel[t.label] = genders;
      }
    } else {
      const bt = boardTableOf(t);
      const restr = restrictionsAtFloorPositions(bt?.seats || [], bt?.restrictions || [], positionKey)
        .filter((x) => x && x.note);
      if (bt) {
        const genders = seatGendersOf(bt, positionKey);
        if (genders) seatGendersByLabel[t.label] = genders;
      }
      if (bt?.active) {
        tableState[t.label] = {
          status: "occupied",
          pax: bt.guests || undefined, // ticker covers; not rendered
          allergy: restr.length > 0,
          strip,
          // the table's course readout ("C3/7") rides the tile like the
          // kitchen floor's — the same information wherever you look
          sub: progressOf(bt),
          // announced to the kitchen for its next course → amber ring. NOT
          // gated on the strip: a SET pressed on the kitchen ticket or the
          // board sheet writes courseReady only, and the floor must show it
          // all the same. Announced tables stay excluded from the next SEND.
          sent: alreadySent(bt),
        };
        const notes = seatNotesOf(bt, positionKey);
        if (notes) seatNotesByLabel[t.label] = notes;
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

  // Drag a chair onto another chair of the same table. TERRACE: P-numbers
  // stay tied to guests; only the chair assignment for this map changes (the
  // aperitif chair must not rewrite the dining plan). DINING: the chair IS
  // the kitchen's plate position — a real swap, so P-numbers and restriction
  // positions renumber and the kitchen ticket reads the new chair.
  const swapSeatPositions = (label, aNo, bNo) => {
    if (!onSwapSeats) return;
    const bt = map.kind === "terrace"
      ? terracePartyBoardTable(occ[label])
      : boardTableOf((map.tables || []).find((x) => x.label === label));
    if (!bt) return;
    const positionKey = floorPositionKey(map.id, label);
    const source = (bt.seats || []).find((seat) => seatFloorPosition(seat, positionKey) === Number(aNo));
    if (!source) return;
    const target = (bt.seats || []).find((seat) => seatFloorPosition(seat, positionKey) === Number(bNo));
    if (map.kind === "terrace") {
      onSwapSeats(bt.id, Number(aNo), Number(bNo), positionKey);
      flash(target
        ? `${label} · P${source.id} ⇄ P${target.id}`
        : `${label} · P${source.id} → CHAIR ${bNo}`);
      return;
    }
    onSwapSeats(bt.id, Number(aNo), Number(bNo), positionKey, { identity: true });
    flash(target ? `${label} · P${aNo} ⇄ P${bNo}` : `${label} · P${aNo} → P${bNo}`);
  };

  // Parties the terrace tab must keep reachable even without a tile: any
  // terrace party whose label no longer exists on the current map (tile
  // renamed/deleted mid-service). No tile means no sheet and no MOVE — this
  // banner is the only way back in. (A table-less 'terrace' row never gets
  // here: visitStateOf self-heals it to 'booked'.)
  const mapLabels = new Set((map.tables || []).map((t) => t.label));
  const stranded = map.kind === "terrace"
    ? reservations.filter((r) =>
        visitStateOf(r.data) === "terrace" && !mapLabels.has(r.data?.terrace_table))
    : [];

  // The dining-side counterpart: LIVE board parties whose slot no tile on
  // this map claims (a mid-service rename/delete, or an unlinked table).
  // They used to vanish from the floor silently — no tile, no SET, only the
  // admin editor's RESOLVE list knew (15.07 audit). The floor itself warns.
  const floorInvisible = map.kind === "terrace" ? [] : (() => {
    const claimed = new Set((map.tables || []).flatMap((t) => boardIdsOf(t).map(Number)));
    return (tables || []).filter((t) =>
      (t.active || t.resName || t.resTime) &&
      (!t.tableGroup?.length || t.id === Math.min(...t.tableGroup)) &&
      !(t.tableGroup?.length > 1 ? t.tableGroup : [t.id]).some((id) => claimed.has(Number(id))));
  })();

  // Parties eligible for a terrace assignment: anyone without a terrace leg
  // yet. Seated-inside parties stay eligible — Djan seats the board table
  // first (courses start) while the party physically sits outside — and so
  // do 'dining' parties who already came IN from the terrace: they may go
  // back out for the last course / dessert (per Djan, 15.07). Only parties
  // already on the terrace, and cleared rows, are out.
  const bookedParties = reservations.filter((r) =>
    ["booked", "dining"].includes(visitStateOf(r.data)) && !r.data?.clearedFromBoard);

  // SET tables with a live board ticket, grouped by board id (a merge shares one
  // ticket). SEND forwards only the ones not yet announced for their next course.
  const setBoardTables = map.kind === "terrace" ? [] : [...new Map(
    (map.tables || [])
      .filter((t) => floorStatusOf(floorStatus, map.id, t.label) === "SET")
      .map((t) => boardTableOf(t))
      .filter((bt) => bt?.active)
      .map((bt) => [bt.id, bt]),
  ).values()];
  const sendableIds = setBoardTables.filter((bt) => !alreadySent(bt)).map((bt) => bt.id);

  // ── sheet content for the tapped table ────────────────────────────────────
  const sheetTable = sheetLabel ? (map.tables || []).find((t) => t.label === sheetLabel) : null;
  const sheetParty = sheetTable && map.kind === "terrace" ? occ[sheetLabel] : null;
  const sheetBoard = sheetTable && map.kind !== "terrace" ? boardTableOf(sheetTable) : null;

  // ── dock content — the last tapped table, resolved to its merge-primary
  // board table exactly the way the tiles themselves resolve it ─────────────
  const dockTable = dockLabel ? (map.tables || []).find((t) => t.label === dockLabel) : null;
  const dockBoard = dockTable
    ? (map.kind === "terrace" ? terracePartyBoardTable(occ[dockLabel]) : boardTableOf(dockTable))
    : null;
  const dockStrip = dockTable ? floorStatusOf(floorStatus, map.id, dockLabel) : null;
  // same restriction source rule as the tiles: the board table, falling back
  // to the reservation blob for terrace parties not templated onto a board
  // table yet — the dock must never disagree with the chair it sits beside
  const dockRestrictions = map.kind === "terrace"
    ? ((dockBoard?.restrictions?.length ? dockBoard.restrictions : occ[dockLabel]?.data?.restrictions) || [])
    : (dockBoard?.restrictions || []);
  // chair tap → the guest at that floor position; resolved with the same
  // per-map mapping the swap drags use, so the card can never show the wrong
  // person after a seat swap
  const dockSeat = dockSeatNo != null && dockBoard
    ? (dockBoard.seats || []).find(
        (s) => seatFloorPosition(s, floorPositionKey(map.id, dockLabel)) === Number(dockSeatNo),
      ) || null
    : null;
  // announce THIS table — same double write as the terrace sheet's
  // SET → KITCHEN: the kitchen banner plus the local strip (when not on yet)
  const announceDock = onSendSetToKitchen && dockBoard ? () => {
    onSendSetToKitchen([dockBoard.id]);
    if (dockStrip !== "SET") onCycleStatus(map.id, dockLabel);
    flash(`${dockLabel} SET → KITCHEN ✓`);
  } : undefined;
  // the one set button's other face: announced → UNSET clears the kitchen
  // banner AND the strip together (mirrors the sheet's onUnsetKitchen)
  const unannounceDock = onUnsetKitchen && dockBoard ? () => {
    onUnsetKitchen(dockBoard.id);
    if (dockStrip === "SET") onCycleStatus(map.id, dockLabel);
    flash(`${dockLabel} UNSET`);
  } : undefined;

  const sheetBody = () => {
    if (map.kind === "terrace") {
      // Terrace SET works exactly like the dining room's (per Djan — the old
      // "set for bites" toggle told the kitchen nothing): one press in the
      // sheet raises the SAME kitchen banner, courseReady for the party's
      // next unfired course, and turns the strip on. The strip then clears
      // by itself when that course fires (App's courseReady-resolve watcher).
      const sheetStrip = floorStatusOf(floorStatus, map.id, sheetLabel);
      if (sheetParty) {
        // A merged group's kitchen ticket lives on the PRIMARY board table.
        const primaryBoardId = (() => {
          const tid = Number(sheetParty.table_id);
          const bt = tables.find((x) => x.id === tid);
          return bt?.tableGroup?.length ? Math.min(...bt.tableGroup.map(Number)) : tid;
        })();
        const setToggle = sheetStrip === "SET" ? (
          <button
            style={actionBtn(false)}
            onClick={() => { onCycleStatus(map.id, sheetLabel); setSheetLabel(null); }}>
            UNSET
          </button>
        ) : (
          <button
            style={actionBtn(true)}
            onClick={() => {
              onSendSetToKitchen?.([primaryBoardId]);
              onCycleStatus(map.id, sheetLabel);
              flash(`${sheetLabel} SET → KITCHEN ✓`);
              setSheetLabel(null);
            }}>
            SET → KITCHEN
          </button>
        );
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
      // Free terrace table — no SET here: with no party there is no course to
      // announce, so the sheet is purely the assign picker. (A leftover strip
      // from a departed party still offers UNSET so it can't get stuck.)
      return (
        <div>
          {sheetStrip === "SET" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <button
                style={actionBtn(false)}
                onClick={() => { onCycleStatus(map.id, sheetLabel); setSheetLabel(null); }}>
                UNSET
              </button>
            </div>
          )}
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
                {/* a dining party's identity is its table — going back OUT */}
                {r.data?.resName || "—"} ×{r.data?.guests || "?"}
                {visitStateOf(r.data) === "dining" ? ` · ${diningLabelOf(r)} ↩`
                  : r.data?.resTime ? ` · ${r.data.resTime}` : ""}
              </button>
            ))}
          </div>
        </div>
      );
    }
    return null; // dining taps cycle status instead — no sheet
  };

  return (
    <div style={{ margin: isMobile ? "0 12px 40px" : "0 24px 48px" }}>
      {/* map tabs — hidden when the caller owns the map choice (mapKind);
          the toast still needs a home then. */}
      {!mapKind ? (
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
      ) : toast && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 4 }}>
          <span style={{ fontFamily: FONT, fontSize: 9, color: tokens.green.text, letterSpacing: "0.08em", fontWeight: 700, marginRight: 10 }}>{toast}</span>
        </div>
      )}

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
          <span style={{ color: tokens.ink[3], fontSize: 8 }}>TAP TABLE → DOCK · SET LIVES IN THE DOCK</span>
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

      {/* stranded terrace parties — the label vanished in a map edit;
          actions must stay one tap away */}
      {stranded.map((r) => (
        <div key={r.id} style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          padding: "8px 12px", border: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[0], marginBottom: 6,
        }}>
          <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: tokens.ink[0] }}>
            {r.data?.resName || "—"} {r.data?.guests ? `×${r.data.guests}` : ""}
          </span>
          <span style={{ flex: 1 }} />
          <button style={actionBtn(false)} onClick={() => setMovingParty(r)}>CHANGE TABLE</button>
          <button style={actionBtn(true)} onClick={() => onMove(r)}>MOVE TO {diningLabelOf(r)} →</button>
        </div>
      ))}

      {/* live parties this dining map can't show — no tile claims their
          board slot. The board/kitchen still serve them; the floor says WHY
          they're missing here instead of hiding them. */}
      {floorInvisible.map((t) => (
        <div key={t.id} style={{
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
          padding: "8px 12px", border: `1px solid ${tokens.signal.warn}`,
          background: tokens.neutral[0], marginBottom: 6,
        }}>
          <span style={{
            fontFamily: FONT, fontSize: 8, letterSpacing: "0.12em", fontWeight: 700,
            textTransform: "uppercase", color: tokens.signal.warn,
          }}>NOT ON THIS MAP</span>
          <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: tokens.ink[0] }}>
            {t.resName || "—"} {t.guests ? `×${t.guests}` : ""}
          </span>
          <span style={{ fontFamily: FONT, fontSize: 10, color: tokens.ink[3] }}>
            board {t.tableGroup?.length > 1 ? t.tableGroup.join("-") : t.id} — no table here claims this slot (Admin → Floor → SLOTS)
          </span>
        </div>
      ))}

      {/* map + dock: the dock lives in the gutter the capped map leaves
          free (below the map on mobile) and follows the last tapped table */}
      <div style={{
        display: "flex", flexDirection: isMobile ? "column" : "row",
        gap: 16, alignItems: isMobile ? "stretch" : "flex-start",
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <FloorMap
            map={map}
            mode="service"
            tableState={tableState}
            restrictionsByLabel={restrictionsByLabel}
            // The label ▲ read as a dead button (per Djan) — the restriction CODE
            // in red at the exact chair replaces it on the FOH floor too.
            seatCodes
            seatNotesByLabel={seatNotesByLabel}
            seatGendersByLabel={seatGendersByLabel}
            onSeatSwap={onSwapSeats ? swapSeatPositions : undefined}
            showPartyLines={false}
            serviceSelectedLabel={dockLabel}
            serviceSelectedSeat={dockSeatNo != null && dockLabel ? { label: dockLabel, no: dockSeatNo } : null}
            // a chair tap selects the GUEST for the dock (per Djan, 22.08) —
            // it does not bubble to the table tap
            onServiceSeatTap={(label, no) => { setDockLabel(label); setDockSeatNo(Number(no)); }}
            // 560 on desktop (22.08): the slimmer dock gives the map the
            // gutter back — ~610px wide instead of ~522
            height={isMobile ? 380 : 560}
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
              // A tap SELECTS (per Djan, 21.08) — the dock follows it and
              // holds the SET controls; terrace tables also raise their
              // action sheet. Nothing toggles on the tap itself. A table-body
              // tap returns the dock from a guest card to the table view.
              setDockLabel(t.label);
              setDockSeatNo(null);
              if (map.kind === "terrace") setSheetLabel(t.label);
            }}
          />
        </div>
        <FloorDock
          label={dockLabel}
          mapKind={map.kind === "terrace" ? "terrace" : "dining"}
          boardTable={dockBoard}
          restrictions={dockRestrictions}
          selectedSeat={dockSeat}
          selectedSeatNo={dockSeatNo}
          onClearSeat={() => setDockSeatNo(null)}
          strip={dockStrip}
          menuCourses={menuCourses}
          profiles={profiles}
          assignments={assignments}
          optionalExtras={optionalExtras}
          optionalPairings={optionalPairings}
          onToggleStrip={dockLabel ? () => onCycleStatus(map.id, dockLabel) : undefined}
          onAnnounce={announceDock}
          onUnannounce={unannounceDock}
          onOpenDetail={onOpenDetail}
          upd={upd}
          isMobile={isMobile}
        />
      </div>

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
                  ? (sheetParty ? `×${sheetParty.data?.guests || "?"}` : "free")
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
