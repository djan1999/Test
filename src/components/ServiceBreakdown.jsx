import { useMemo, useState } from "react";
import { tokens } from "../styles/tokens.js";
import { RESTRICTIONS } from "../constants/dietary.js";

const FONT = tokens.font;

// ── Helpers ─────────────────────────────────────────────────────────────────
const pad2 = (n) => String(n).padStart(2, "0");

function formatDateHeader(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long" });
  const day = d.getDate();
  const ord = (n) => {
    const s = ["TH", "ST", "ND", "RD"];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
  };
  const month = d.toLocaleDateString("en-GB", { month: "long" });
  const year = d.getFullYear();
  return `${weekday}, THE ${day}${ord(day)} OF ${month} ${year}`.toUpperCase();
}

function tableLabel(r) {
  const d = r.data || {};
  const group = d.tableGroup?.length > 1 ? d.tableGroup.map(Number) : [r.table_id];
  if (group.length > 1) {
    return `T${[...group].sort((a, b) => a - b).join(",")}`;
  }
  return `T${String(r.table_id).padStart(2, "0")}`;
}

// Build the bullet lines that get auto-filled under each reservation from
// existing reservation data. This matches the reference screenshot style:
//  - Long menu
//  - No dietaries or SO
//  - From Germany
//  - Hotel #22 (5% C&F)
//  - notes lines
function bulletsForReservation(r) {
  const d = r.data || {};
  const out = [];

  // Menu
  if (d.menuType) {
    const menuLabel = String(d.menuType).trim();
    const pretty = menuLabel.charAt(0).toUpperCase() + menuLabel.slice(1).toLowerCase();
    out.push(`${pretty} menu`);
  }

  // Dietaries / allergies / cake summary
  const restrictions = Array.isArray(d.restrictions) ? d.restrictions : [];
  const restrLabels = restrictions
    .map((rs) => {
      const def = RESTRICTIONS.find((x) => x.key === rs.note);
      return def ? def.label : rs.note;
    })
    .filter(Boolean);

  const cakeChunks = [];
  if (d.birthday) {
    const note = d.cakeNote ? `CAKE(${d.cakeNote})` : "CAKE";
    cakeChunks.push(`1x ${note}`);
  }

  if (restrLabels.length === 0 && cakeChunks.length === 0) {
    out.push("No dietaries or SO");
  } else {
    const parts = [];
    if (restrLabels.length > 0) parts.push(restrLabels.join(", "));
    else parts.push("No dietaries");
    if (cakeChunks.length > 0) parts.push(cakeChunks.join(", "));
    out.push(parts.join(", "));
  }

  // Origin
  if (d.lang === "si") out.push("From Slovenia");

  // Hotel
  if (d.guestType === "hotel") {
    const roomPart = d.room ? ` #${d.room}` : "";
    out.push(`Hotel${roomPart}`);
  }

  // Free-form notes — each line becomes its own bullet
  if (d.notes) {
    String(d.notes)
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((line) => out.push(line));
  }

  return out;
}

// Group reservations by their time slot, sorted ascending.
function groupByTimeSlot(reservations) {
  const map = new Map();
  for (const r of reservations) {
    const t = (r.data?.resTime || "").trim() || "—";
    if (!map.has(t)) map.set(t, []);
    map.get(t).push(r);
  }
  const slots = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  // Sort each slot's reservations by table id for a stable display
  for (const [, list] of slots) {
    list.sort((a, b) => (a.table_id || 0) - (b.table_id || 0));
  }
  return slots; // [ [timeLabel, reservations[]], ... ]
}

// ── Component ───────────────────────────────────────────────────────────────
export default function ServiceBreakdown({ dateStr, reservations, onClose }) {
  const [intel, setIntel] = useState({}); // { [reservationId]: string }
  const [bread, setBread] = useState("");
  const [announcements, setAnnouncements] = useState(["", "", "", ""]);

  const slots = useMemo(() => groupByTimeSlot(reservations || []), [reservations]);

  // Header summary: total reservation tables and total guests for the day.
  const totalReservations = (reservations || []).length;
  const totalGuests = (reservations || []).reduce(
    (a, r) => a + (r.data?.guests || 2),
    0
  );

  // Two-column split — first half of slots to left, second half to right.
  const mid = Math.ceil(slots.length / 2);
  const leftSlots = slots.slice(0, mid);
  const rightSlots = slots.slice(mid);

  const handleIntel = (id, v) => setIntel((p) => ({ ...p, [id]: v }));
  const handleAnnouncement = (i, v) =>
    setAnnouncements((p) => p.map((x, idx) => (idx === i ? v : x)));

  const onPrint = () => {
    window.print();
  };

  const header = formatDateHeader(dateStr);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.7)",
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        overflow: "auto",
        padding: "24px 16px",
      }}
      className="service-breakdown-overlay"
    >
      <PrintStyles />

      {/* Top bar — not printed */}
      <div
        className="sb-topbar"
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          maxWidth: 900,
          width: "100%",
          margin: "0 auto 12px",
        }}
      >
        <button
          onClick={onPrint}
          className="sb-no-print"
          style={{
            fontFamily: FONT,
            fontSize: 10,
            letterSpacing: 2,
            padding: "8px 16px",
            border: "1px solid #fff",
            borderRadius: 0,
            background: "#fff",
            color: "#000",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          PRINT
        </button>
        <button
          onClick={onClose}
          className="sb-no-print"
          style={{
            fontFamily: FONT,
            fontSize: 10,
            letterSpacing: 2,
            padding: "8px 16px",
            border: "1px solid #fff",
            borderRadius: 0,
            background: "transparent",
            color: "#fff",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          CLOSE
        </button>
      </div>

      {/* Print sheet */}
      <div
        className="sb-sheet"
        style={{
          background: "#ffffff",
          color: "#000",
          fontFamily: FONT,
          fontSize: 11,
          lineHeight: 1.45,
          maxWidth: 900,
          width: "100%",
          margin: "0 auto",
          padding: "36px 42px",
          boxShadow: "0 0 0 1px #ddd",
          borderRadius: 0,
        }}
      >
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 12 }}>{header}</div>
          <div style={{ fontSize: 11, marginTop: 2 }}>
            {totalReservations} table{totalReservations !== 1 ? "s" : ""},{" "}
            {totalGuests} guest{totalGuests !== 1 ? "s" : ""}
          </div>
        </div>

        {/* Two columns */}
        <div
          className="sb-columns"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            columnGap: 32,
            marginTop: 24,
          }}
        >
          <div>
            {leftSlots.map(([time, list]) => (
              <SlotBlock
                key={time}
                time={time}
                list={list}
                intel={intel}
                onIntel={handleIntel}
              />
            ))}
          </div>
          <div>
            {rightSlots.map(([time, list]) => (
              <SlotBlock
                key={time}
                time={time}
                list={list}
                intel={intel}
                onIntel={handleIntel}
              />
            ))}
          </div>
        </div>

        {/* Bottom section */}
        <div
          style={{
            marginTop: 32,
            paddingTop: 12,
            borderTop: "1px solid #000",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <span style={{ fontWeight: 700 }}>Extra bread count:</span>
            <input
              type="text"
              value={bread}
              onChange={(e) => setBread(e.target.value)}
              className="sb-inline"
              style={{
                flex: 1,
                fontFamily: "inherit",
                fontSize: "inherit",
                color: "#000",
                border: "none",
                borderBottom: "1px solid #000",
                background: "transparent",
                outline: "none",
                padding: "2px 4px",
              }}
            />
          </div>

          <div style={{ fontWeight: 700, marginBottom: 4 }}>
            Service Announcements:
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {announcements.map((v, i) => (
              <div
                key={i}
                style={{ display: "flex", alignItems: "flex-start", gap: 6 }}
              >
                <span>-</span>
                <textarea
                  value={v}
                  onChange={(e) => handleAnnouncement(i, e.target.value)}
                  rows={1}
                  className="sb-announcement"
                  style={{
                    flex: 1,
                    fontFamily: "inherit",
                    fontSize: "inherit",
                    color: "#000",
                    border: "1px dashed #aaa",
                    background: "#f5f5f5",
                    outline: "none",
                    padding: "2px 6px",
                    borderRadius: 0,
                    resize: "vertical",
                    minHeight: 20,
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SlotBlock({ time, list, intel, onIntel }) {
  const count = list.length;
  return (
    <div style={{ marginBottom: 20 }}>
      <div
        style={{
          fontWeight: 700,
          fontSize: 11,
          borderBottom: "1px solid #000",
          paddingBottom: 2,
          marginBottom: 8,
        }}
      >
        {time} - {count} table{count !== 1 ? "s" : ""}
      </div>
      {list.map((r) => {
        const d = r.data || {};
        const name = (d.resName || "—").trim();
        const pax = d.guests || 2;
        const bullets = bulletsForReservation(r);
        return (
          <div key={r.id} style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 700 }}>
              {tableLabel(r)}: {name} [{pax} pax]
            </div>
            <ul
              style={{
                listStyle: "none",
                margin: "2px 0 0 0",
                padding: "0 0 0 8px",
              }}
            >
              {bullets.map((b, i) => (
                <li key={i} style={{ whiteSpace: "pre-wrap" }}>
                  - {b}
                </li>
              ))}
            </ul>
            <textarea
              value={intel[r.id] || ""}
              onChange={(e) => onIntel(r.id, e.target.value)}
              placeholder="Guest intel / notes"
              rows={2}
              className="sb-intel"
              style={{
                width: "100%",
                marginTop: 4,
                fontFamily: "inherit",
                fontSize: "0.8rem",
                color: "#000",
                border: "1px dashed #aaa",
                background: "#f5f5f5",
                padding: "3px 6px",
                resize: "none",
                outline: "none",
                borderRadius: 0,
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

function PrintStyles() {
  return (
    <style>{`
      .service-breakdown-overlay textarea,
      .service-breakdown-overlay input {
        font-family: inherit;
      }
      @media print {
        @page { size: A4; margin: 15mm; }
        html, body { background: #ffffff !important; }
        body * { visibility: hidden !important; }
        .service-breakdown-overlay,
        .service-breakdown-overlay * { visibility: visible !important; }
        .service-breakdown-overlay {
          position: absolute !important;
          inset: 0 !important;
          background: #ffffff !important;
          padding: 0 !important;
          display: block !important;
          overflow: visible !important;
        }
        .sb-sheet {
          box-shadow: none !important;
          padding: 0 !important;
          max-width: 100% !important;
          width: 100% !important;
          margin: 0 !important;
        }
        .sb-no-print,
        .sb-topbar {
          display: none !important;
        }
        .service-breakdown-overlay textarea,
        .service-breakdown-overlay input {
          border: none !important;
          background: transparent !important;
          box-shadow: none !important;
          outline: none !important;
          resize: none !important;
          padding: 0 !important;
          color: #000 !important;
        }
        .sb-inline {
          border-bottom: 1px solid #000 !important;
        }
        .sb-columns {
          display: grid !important;
          grid-template-columns: 1fr 1fr !important;
          column-gap: 32px !important;
          page-break-inside: auto;
        }
      }
    `}</style>
  );
}
