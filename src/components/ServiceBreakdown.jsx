import { useState } from "react";
import { tokens } from "../styles/tokens.js";
import { RESTRICTIONS } from "../constants/dietary.js";
import { useFocusChain } from "../hooks/useFocusChain.js";
import { useModalEscape } from "../hooks/useModalEscape.js";

const FONT = tokens.font;

// ── Helpers ─────────────────────────────────────────────────────────────────
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

// Group identical restrictions by count. Returns an array of display strings
// like ["2x Vegetarian", "Gluten Free"]. Grouped items (count > 1) sort first,
// then singletons, alphabetical within each group.
function groupRestrictions(restrictions) {
  const counts = new Map();
  for (const r of restrictions || []) {
    const key = (r && (r.note || r.key)) || "";
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const entries = [...counts.entries()].map(([key, count]) => {
    const def = RESTRICTIONS.find((x) => x.key === key);
    const label = def ? def.label : key;
    return { key, label, count };
  });
  entries.sort((a, b) => {
    const aGrouped = a.count > 1;
    const bGrouped = b.count > 1;
    if (aGrouped !== bGrouped) return aGrouped ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
  return entries.map((e) => `${e.count}x ${e.label}`);
}

// Build the auto-seeded bullet lines for a reservation.
function bulletsForReservation(r) {
  const d = r.data || {};
  const out = [];

  // Menu
  if (d.menuType) {
    const menuLabel = String(d.menuType).trim();
    const pretty = menuLabel.charAt(0).toUpperCase() + menuLabel.slice(1).toLowerCase();
    out.push(`${pretty} menu`);
  }

  // Dietaries / allergies / cake summary — grouped with counts
  const grouped = groupRestrictions(d.restrictions);
  const cakeChunks = [];
  if (d.birthday) {
    const note = d.cakeNote ? `CAKE(${d.cakeNote})` : "CAKE";
    cakeChunks.push(`1x ${note}`);
  }

  if (grouped.length === 0 && cakeChunks.length === 0) {
    out.push("No dietaries or SO");
  } else {
    const parts = [];
    if (grouped.length > 0) parts.push(grouped.join(", "));
    else parts.push("No dietaries");
    if (cakeChunks.length > 0) parts.push(cakeChunks.join(", "));
    out.push(parts.join(", "));
  }

  // Origin
  if (d.lang === "si") out.push("From Slovenia");

  // Hotel
  if (d.guestType === "hotel") {
    const rs = Array.isArray(d.rooms) && d.rooms.length ? d.rooms.filter(Boolean) : (d.room ? [d.room] : []);
    const roomPart = rs.length ? ` #${rs.join(", ")}` : "";
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

// Group reservations by time slot, sorted ascending, stable order within.
function groupByTimeSlot(reservations) {
  const map = new Map();
  for (const r of reservations) {
    const t = (r.data?.resTime || "").trim() || "—";
    if (!map.has(t)) map.set(t, []);
    map.get(t).push(r);
  }
  const slots = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [, list] of slots) {
    list.sort((a, b) => (a.table_id || 0) - (b.table_id || 0));
  }
  return slots;
}

// Build the initial editable document state by pre-filling from reservations.
function buildInitialState(dateStr, reservations) {
  const total = (reservations || []).length;
  const totalGuests = (reservations || []).reduce(
    (a, r) => a + (r.data?.guests || 2),
    0
  );
  const slots = groupByTimeSlot(reservations || []);

  return {
    headerText: formatDateHeader(dateStr),
    summaryText: `${total} table${total !== 1 ? "s" : ""}, ${totalGuests} guest${totalGuests !== 1 ? "s" : ""}`,
    slots: slots.map(([time, list]) => ({
      key: time,
      label: `${time} - ${list.length} table${list.length !== 1 ? "s" : ""}`,
      reservations: list.map((r) => {
        const d = r.data || {};
        const name = (d.resName || "—").trim();
        const pax = d.guests || 2;
        return {
          id: r.id,
          headerText: `${tableLabel(r)}: ${name} [${pax} pax]`,
          bullets: bulletsForReservation(r),
          intel: "",
        };
      }),
    })),
    bread: "",
    announcements: ["", "", "", ""],
  };
}

// ── Editable building blocks ────────────────────────────────────────────────
const plainInputStyle = {
  border: "none",
  background: "transparent",
  fontFamily: "inherit",
  fontSize: "inherit",
  color: tokens.neutral[900],
  width: "100%",
  padding: 0,
  margin: 0,
  outline: "none",
  borderRadius: 0,
};

function PlainInput({ value, onChange, bold, center, style, focusBind }) {
  return (
    <input
      type="text"
      ref={focusBind?.ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={focusBind?.onKeyDown}
      style={{
        ...plainInputStyle,
        fontWeight: bold ? 700 : "inherit",
        textAlign: center ? "center" : "left",
        ...style,
      }}
    />
  );
}

// Auto-growing single-row textarea. Grows vertically when content wraps so
// nothing is clipped, and collapses to a single line when empty so short
// content stays compact in print.
function AutoTextarea({ value, onChange, style, minRows = 1, placeholder, autoBullet, onKeyDown, textareaRef }) {
  const resize = (el) => {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  };
  const bulletHandler = autoBullet ? (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const el = e.target;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const next = value.slice(0, start) + "\n- " + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = start + 3;
      resize(el);
    });
  } : undefined;
  const handleKeyDown = (e) => {
    if (onKeyDown) onKeyDown(e);
    if (!e.defaultPrevented && bulletHandler) bulletHandler(e);
  };
  return (
    <textarea
      ref={(el) => { resize(el); textareaRef?.(el); }}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        resize(e.target);
      }}
      onKeyDown={handleKeyDown}
      rows={minRows}
      placeholder={placeholder}
      style={{
        ...plainInputStyle,
        resize: "none",
        overflow: "hidden",
        lineHeight: 1.35,
        ...style,
      }}
    />
  );
}

// ── Component ───────────────────────────────────────────────────────────────
export default function ServiceBreakdown({ dateStr, reservations, onClose }) {
  const [doc, setDoc] = useState(() => buildInitialState(dateStr, reservations));
  const chain = useFocusChain();
  useModalEscape(onClose);

  const updateHeader = (v) => setDoc((p) => ({ ...p, headerText: v }));
  const updateSummary = (v) => setDoc((p) => ({ ...p, summaryText: v }));
  const updateSlotLabel = (si, v) =>
    setDoc((p) => ({
      ...p,
      slots: p.slots.map((s, i) => (i === si ? { ...s, label: v } : s)),
    }));
  const updateResvHeader = (si, ri, v) =>
    setDoc((p) => ({
      ...p,
      slots: p.slots.map((s, i) =>
        i !== si
          ? s
          : {
              ...s,
              reservations: s.reservations.map((r, j) =>
                j === ri ? { ...r, headerText: v } : r
              ),
            }
      ),
    }));
  const updateBullet = (si, ri, bi, v) =>
    setDoc((p) => ({
      ...p,
      slots: p.slots.map((s, i) =>
        i !== si
          ? s
          : {
              ...s,
              reservations: s.reservations.map((r, j) =>
                j !== ri
                  ? r
                  : {
                      ...r,
                      bullets: r.bullets.map((b, k) => (k === bi ? v : b)),
                    }
              ),
            }
      ),
    }));
  const updateIntel = (si, ri, v) =>
    setDoc((p) => ({
      ...p,
      slots: p.slots.map((s, i) =>
        i !== si
          ? s
          : {
              ...s,
              reservations: s.reservations.map((r, j) =>
                j === ri ? { ...r, intel: v } : r
              ),
            }
      ),
    }));
  const mergeBullet = (si, ri, bi) =>
    setDoc((p) => ({
      ...p,
      slots: p.slots.map((s, i) =>
        i !== si ? s : {
          ...s,
          reservations: s.reservations.map((r, j) =>
            j !== ri ? r : {
              ...r,
              bullets: [
                ...r.bullets.slice(0, bi - 1),
                r.bullets[bi - 1] + r.bullets[bi],
                ...r.bullets.slice(bi + 1),
              ],
            }
          ),
        }
      ),
    }));

  const splitBullet = (si, ri, bi, before, after) =>
    setDoc((p) => ({
      ...p,
      slots: p.slots.map((s, i) =>
        i !== si ? s : {
          ...s,
          reservations: s.reservations.map((r, j) =>
            j !== ri ? r : {
              ...r,
              bullets: [...r.bullets.slice(0, bi), before, after, ...r.bullets.slice(bi + 1)],
            }
          ),
        }
      ),
    }));

  const updateBread = (v) => setDoc((p) => ({ ...p, bread: v }));
  const updateAnnouncement = (i, v) =>
    setDoc((p) => ({
      ...p,
      announcements: p.announcements.map((a, idx) => (idx === i ? v : a)),
    }));

  const onPrint = () => window.print();

  return (
    <div
      className="service-breakdown-overlay"
      style={{
        position: "fixed",
        inset: 0,
        background: tokens.surface.overlay,
        zIndex: 1000,
        display: "flex",
        flexDirection: "column",
        overflow: "auto",
        padding: "24px 16px",
      }}
    >
      <PrintStyles />

      {/* Top bar — not printed */}
      <div
        className="sb-topbar no-print"
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          maxWidth: 1100,
          width: "100%",
          margin: "0 auto 12px",
        }}
      >
        <button
          onClick={onPrint}
          style={{
            fontFamily: FONT,
            fontSize: 10,
            letterSpacing: 2,
            padding: "8px 16px",
            border: `1px solid ${tokens.neutral[0]}`,
            borderRadius: 0,
            background: tokens.neutral[0],
            color: tokens.neutral[900],
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          PRINT
        </button>
        <button
          onClick={onClose}
          style={{
            fontFamily: FONT,
            fontSize: 10,
            letterSpacing: 2,
            padding: "8px 16px",
            border: `1px solid ${tokens.neutral[0]}`,
            borderRadius: 0,
            background: "transparent",
            color: tokens.neutral[0],
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
          background: tokens.neutral[0],
          color: tokens.neutral[900],
          fontFamily: FONT,
          fontSize: 11,
          lineHeight: 1.35,
          maxWidth: 1100,
          width: "100%",
          margin: "0 auto",
          padding: "20px 28px",
          boxShadow: `0 0 0 1px ${tokens.neutral[300]}`,
          borderRadius: 0,
        }}
      >
        <div
          className="service-breakdown-print-area sb-columns"
          style={{
            columnCount: 2,
            columnGap: 24,
            columnFill: "balance",
          }}
        >
          {/* Header — inside column flow so it sits left in column 1 above slots */}
          <div className="header-block" style={{ marginBottom: 8 }}>
            <PlainInput
              value={doc.headerText}
              onChange={updateHeader}
              bold
              style={{ fontSize: 12 }}
              focusBind={chain.bind("doc-header")}
            />
            <PlainInput
              value={doc.summaryText}
              onChange={updateSummary}
              style={{ fontSize: 11, marginTop: 2 }}
              focusBind={chain.bind("doc-summary")}
            />
          </div>

          {doc.slots.map((slot, si) => (
            <div key={slot.key} className="slot-block" style={{ marginBottom: 10 }}>
              <div
                style={{
                  borderBottom: `1px solid ${tokens.neutral[900]}`,
                  paddingBottom: 1,
                  marginBottom: 4,
                }}
              >
                <PlainInput
                  value={slot.label}
                  onChange={(v) => updateSlotLabel(si, v)}
                  bold
                  style={{ fontSize: 11 }}
                  focusBind={chain.bind(`slot-${si}`)}
                />
              </div>
              {slot.reservations.map((r, ri) => (
                <div
                  key={r.id}
                  className="reservation-block"
                  style={{ marginBottom: 8 }}
                >
                  <PlainInput
                    value={r.headerText}
                    onChange={(v) => updateResvHeader(si, ri, v)}
                    bold
                    focusBind={chain.bind(`header-${si}-${ri}`)}
                  />
                  <div style={{ padding: "0 0 0 8px", marginTop: 1 }}>
                    {r.bullets.map((b, bi) => {
                      const bulletBind = chain.bind(`bullet-${si}-${ri}-${bi}`, (e) => {
                        const el = e.currentTarget;
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const before = b.slice(0, el.selectionStart);
                          const after = b.slice(el.selectionEnd);
                          splitBullet(si, ri, bi, before, after);
                          chain.focusField(`bullet-${si}-${ri}-${bi + 1}`, false);
                        } else if (e.key === "Backspace" && el.selectionStart === 0 && el.selectionEnd === 0 && bi > 0) {
                          e.preventDefault();
                          mergeBullet(si, ri, bi);
                          chain.focusField(`bullet-${si}-${ri}-${bi - 1}`, true);
                        }
                      });
                      return (
                        <div
                          key={bi}
                          style={{ display: "flex", alignItems: "flex-start", gap: 4 }}
                        >
                          <span style={{ flexShrink: 0 }}>-</span>
                          <AutoTextarea
                            value={b}
                            onChange={(v) => updateBullet(si, ri, bi, v)}
                            textareaRef={bulletBind.ref}
                            onKeyDown={bulletBind.onKeyDown}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ))}

          {/* Bottom section — flows as last item in column layout */}
          <div
            className="bottom-section"
            style={{
              marginTop: 12,
              paddingTop: 6,
              borderTop: `1px solid ${tokens.neutral[900]}`,
              breakInside: "avoid",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: 4,
              }}
            >
              <span style={{ fontWeight: 700, flexShrink: 0 }}>
                Extra bread count:
              </span>
              <input
                type="text"
                value={doc.bread}
                onChange={(e) => updateBread(e.target.value)}
                ref={chain.bind("bread").ref}
                onKeyDown={chain.bind("bread").onKeyDown}
                className="sb-inline"
                style={{
                  flex: 1,
                  fontFamily: "inherit",
                  fontSize: "inherit",
                  color: tokens.neutral[900],
                  border: "none",
                  borderBottom: `1px solid ${tokens.neutral[900]}`,
                  background: "transparent",
                  outline: "none",
                  padding: "2px 4px",
                }}
              />
            </div>

            <div style={{ fontWeight: 700, marginBottom: 2 }}>
              Service Announcements:
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {doc.announcements.map((v, i) => {
                const ab = chain.bind(`announce-${i}`);
                return (
                  <div
                    key={i}
                    style={{ display: "flex", alignItems: "flex-start", gap: 6 }}
                  >
                    <span>-</span>
                    <div style={{ flex: 1 }}>
                      <AutoTextarea
                        value={v}
                        onChange={(nv) => updateAnnouncement(i, nv)}
                        autoBullet
                        textareaRef={ab.ref}
                        onKeyDown={ab.onKeyDown}
                        style={{
                          border: `1px dashed ${tokens.neutral[400]}`,
                          background: tokens.neutral[100],
                          padding: "1px 4px",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
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
        @page {
          size: A4 landscape;
          margin: 10mm 12mm;
        }
        html, body { background: ${tokens.neutral[0]} !important; }
        body * { visibility: hidden !important; }
        .service-breakdown-overlay,
        .service-breakdown-overlay * { visibility: visible !important; }
        .service-breakdown-overlay {
          position: absolute !important;
          inset: 0 !important;
          background: ${tokens.neutral[0]} !important;
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
        .no-print,
        .sb-topbar {
          display: none !important;
        }
        input, textarea {
          border: none !important;
          background: transparent !important;
          box-shadow: none !important;
          outline: none !important;
          resize: none !important;
          padding: 0 !important;
          color: ${tokens.neutral[900]} !important;
          -webkit-print-color-adjust: exact;
        }
        /* Placeholders are a UI hint only — never print them. */
        input::placeholder,
        textarea::placeholder {
          color: transparent !important;
          opacity: 0 !important;
        }
        /* Collapse empty textareas entirely in print so a blank
           "Guest intel / notes" field doesn't reserve a line. */
        textarea:placeholder-shown {
          height: 0 !important;
          min-height: 0 !important;
          margin: 0 !important;
          padding: 0 !important;
          line-height: 0 !important;
          visibility: hidden !important;
        }
        .sb-inline {
          border-bottom: 1px solid ${tokens.neutral[900]} !important;
        }
        .service-breakdown-print-area {
          column-count: 2;
          column-gap: 12mm;
          column-fill: balance;
        }
        .header-block {
          break-after: avoid;
        }
        .reservation-block {
          break-inside: avoid;
          page-break-inside: avoid;
        }
        .slot-block {
          break-inside: avoid-column;
        }
        .bottom-section {
          break-inside: avoid;
          page-break-inside: avoid;
        }

        /* Aggressive compaction so a typical daily briefing fits
           within at most two A4-landscape pages. */
        .sb-sheet {
          font-size: 9pt !important;
          line-height: 1.2 !important;
        }
        .sb-sheet input,
        .sb-sheet textarea {
          line-height: 1.2 !important;
        }
        .slot-block {
          margin-bottom: 4pt !important;
        }
        .reservation-block {
          margin-bottom: 4pt !important;
        }
        .reservation-block + .reservation-block {
          margin-top: 0 !important;
        }
        .bottom-section {
          margin-top: 6pt !important;
          padding-top: 3pt !important;
        }
        .header-block {
          margin-bottom: 4pt !important;
        }
      }
    `}</style>
  );
}
