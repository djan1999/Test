import { useState } from "react";
import { tokens } from "../../styles/tokens.js";

const FONT = tokens.font;

// Moves into an empty table immediately; occupied destinations require an
// explicit swap confirmation because all reservation and service state moves.
export default function MoveTablePicker({ currentTable, tables = [], reservationOnTable, onCancel, onPick }) {
  const [swapConfirm, setSwapConfirm] = useState(null);

  return (
    <div
      role="presentation"
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 200, padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="move-table-title"
        onClick={(event) => event.stopPropagation()}
        style={{
          background: tokens.neutral[0], border: `1px solid ${tokens.ink[3]}`,
          maxWidth: 460, width: "100%", padding: 20, fontFamily: FONT,
        }}
      >
        <div id="move-table-title" style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: tokens.ink[3], marginBottom: 6 }}>
          [MOVE TABLE]
        </div>
        <div style={{ fontSize: 13, color: tokens.ink[0], marginBottom: 12, lineHeight: 1.5 }}>
          Move <strong>{currentTable.displayLabel || `T${String(currentTable.id).padStart(2, "0")}`}</strong>
          {currentTable.resName ? ` (${currentTable.resName})` : ""} to a different table.
          Free tables move; <span style={{ color: tokens.red.text }}>occupied</span> tables swap.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6, marginBottom: 14 }}>
          {tables.map((table) => Number(table.id)).sort((a, b) => a - b).map((tableId) => {
            const isSelf = tableId === currentTable.id;
            const destination = tables.find((table) => table.id === tableId);
            const destinationStarted = destination && (
              destination.active || destination.arrivedAt
              || (destination.kitchenLog && Object.keys(destination.kitchenLog).length > 0)
              || destination.kitchenArchived
            );
            const ownerReservation = typeof reservationOnTable === "function" ? reservationOnTable(tableId) : null;
            const occupied = Boolean(destinationStarted || destination?.resName || destination?.resTime || ownerReservation);
            const subLabel = isSelf
              ? "current"
              : destinationStarted
                ? "active"
                : (destination?.resName?.slice(0, 8) || ownerReservation?.data?.resName?.slice(0, 8) || "");
            const displayLabel = destination?.displayLabel || `T${String(tableId).padStart(2, "0")}`;

            return (
              <button
                type="button"
                key={tableId}
                onClick={() => {
                  if (isSelf) return;
                  if (occupied) {
                    const ownerLabel = destination?.resName || ownerReservation?.data?.resName || (destinationStarted ? "active service" : "another reservation");
                    setSwapConfirm({ tableId, ownerLabel, displayLabel });
                  } else {
                    onPick(tableId, "move");
                  }
                }}
                disabled={isSelf}
                style={{
                  fontFamily: FONT, padding: "12px 0",
                  border: `1px solid ${isSelf ? tokens.charcoal.default : occupied ? tokens.red.border : tokens.ink[4]}`,
                  borderRadius: 0,
                  background: isSelf ? tokens.tint.parchment : occupied ? tokens.red.bg : tokens.neutral[0],
                  color: isSelf ? tokens.ink[0] : occupied ? tokens.red.text : tokens.ink[1],
                  cursor: isSelf ? "not-allowed" : "pointer",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                  touchAction: "manipulation",
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 700 }}>{displayLabel}</span>
                {subLabel ? (
                  <span style={{ fontSize: 8, letterSpacing: "0.10em", textTransform: "uppercase", opacity: 0.7 }}>
                    {subLabel}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
              padding: "8px 16px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0,
              cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[3],
            }}
          >CANCEL</button>
        </div>
      </div>

      {swapConfirm ? (
        <div
          role="presentation"
          onClick={() => setSwapConfirm(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 250, padding: 16,
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="swap-table-title"
            onClick={(event) => event.stopPropagation()}
            style={{
              background: tokens.neutral[0], border: `1px solid ${tokens.ink[3]}`,
              maxWidth: 380, width: "100%", padding: 18, fontFamily: FONT,
            }}
          >
            <div id="swap-table-title" style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", color: tokens.red.text, marginBottom: 6 }}>
              [TABLE OCCUPIED]
            </div>
            <div style={{ fontSize: 12, color: tokens.ink[0], marginBottom: 14, lineHeight: 1.5 }}>
              <strong>{swapConfirm.displayLabel}</strong> is held by <strong>{swapConfirm.ownerLabel}</strong>.
              Swap will move everything on T{String(currentTable.id).padStart(2, "0")} ↔ T{String(swapConfirm.tableId).padStart(2, "0")} — orders, kitchen log, arrived time, and reservation tags.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                type="button"
                onClick={() => setSwapConfirm(null)}
                style={{
                  fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
                  padding: "8px 16px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0,
                  cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[3],
                }}
              >CANCEL</button>
              <button
                type="button"
                onClick={() => { onPick(swapConfirm.tableId, "swap"); setSwapConfirm(null); }}
                style={{
                  fontFamily: FONT, fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase",
                  padding: "8px 16px", border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0,
                  cursor: "pointer", background: tokens.charcoal.default, color: tokens.neutral[0], fontWeight: 600,
                }}
              >SWAP</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
