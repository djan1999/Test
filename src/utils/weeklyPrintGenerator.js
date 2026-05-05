/**
 * Weekly print generators for the Reservation Manager.
 * Produces two HTML documents: reservations sheet and allergy/restriction sheet.
 */
import { applyCourseRestriction, getCourseMod, RESTRICTION_PRIORITY_KEYS, RESTRICTION_COLUMN_MAP, deriveKitchenNote, applyMenuOverride } from "./menuUtils.js";

const esc = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ROBOTO_LINK = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;700&display=swap" rel="stylesheet">`;

const resvHtmlShell = (title, bodyHtml) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
${ROBOTO_LINK}
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Roboto Mono',monospace;font-size:9pt;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
@page{size:A4 portrait;margin:12mm 10mm;}
@media print{body{margin:0;}}
table{width:100%;border-collapse:collapse;}
tr{page-break-inside:avoid;}
th,td{border:1px solid #aaa;padding:4pt 5pt;vertical-align:top;text-align:center;font-size:8.5pt;color:#000;font-weight:700;}
th{text-align:center;background:#fff;}
.date-row td{background:#f0f0f0;}
u{text-decoration:underline;color:#000;}
h1{font-family:'Roboto Mono',monospace;font-size:11pt;text-align:center;margin:0 0 2pt;font-weight:700;}
h2{font-family:'Roboto Mono',monospace;font-size:9pt;text-align:center;margin:0 0 10pt;font-weight:700;color:#000;}
</style></head><body>${bodyHtml}</body></html>`;

const allergyHtmlShell = (title, bodyHtml, resvCount) => {
  // For few reservations use natural column widths; only compress for large counts
  const isLarge = resvCount > 5;
  const baseFontPt = isLarge ? (resvCount <= 7 ? 6.5 : resvCount <= 9 ? 5.5 : 5) : 8;
  const courseSubPt = Math.max(baseFontPt - 1.5, 4);
  const cellPad = isLarge ? "1.5pt 3pt" : "2pt 4pt";
  const tableLayout = isLarge ? "width:100%;table-layout:fixed;" : "width:auto;table-layout:auto;";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
${ROBOTO_LINK}
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Roboto Mono',monospace;font-size:${baseFontPt}pt;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
@page{size:A4 landscape;margin:5mm 5mm;}
@media print{body{margin:0;}}
table{border-collapse:collapse;${tableLayout}}
th,td{border:1px solid #aaa;padding:${cellPad};vertical-align:top;text-align:left;font-size:${baseFontPt}pt;color:#000;font-weight:700;overflow:hidden;word-wrap:break-word;line-height:1.15;}
th{text-align:center;}
.green-header{background:#3d6b4f;color:#fff;}
.green-header th,.green-header td{border-color:#2e5a3e;color:#fff;}
.red{color:#c04040;}
.center{text-align:center;}
.highlight{background:#edf7ef;}
.course-name{text-transform:uppercase;font-size:${baseFontPt}pt;}
.course-sub{font-size:${courseSubPt}pt;color:#555;font-weight:400;}
.resv-cell{font-size:${baseFontPt}pt;line-height:1.15;}
</style></head><body>${bodyHtml}</body></html>`;
};

const fmtDateShort = ds => {
  const d = new Date(ds + "T00:00:00");
  return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
};

const fmtDateFull = ds => {
  const d = new Date(ds + "T00:00:00");
  return `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
};

const toDateStr = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ── PDF 1: Weekly Reservations Sheet ──────────────────────────────────────────

export function generateWeeklyReservationsHTML(reservations, weekDays, restrictionDefs = []) {
  const weekStart = toDateStr(weekDays[0]);
  const weekEnd   = toDateStr(weekDays[6]);

  // Filter & group
  const weekResv = reservations
    .filter(r => r.date >= weekStart && r.date <= weekEnd)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.data?.resTime || "99").localeCompare(b.data?.resTime || "99"));

  const byDate = {};
  weekResv.forEach(r => {
    if (!byDate[r.date]) byDate[r.date] = [];
    byDate[r.date].push(r);
  });

  const totalGuests = weekResv.reduce((a, r) => a + (r.data?.guests || 2), 0);

  // Date range: first date with reservations to last
  const sortedDates = Object.keys(byDate).sort();
  const firstDate = sortedDates[0] || weekStart;
  const lastDate  = sortedDates[sortedDates.length - 1] || weekEnd;
  const dateRange = `${fmtDateShort(firstDate)} - ${fmtDateFull(lastDate)}`;

  const expLabelForResv = (r) => {
    const year = new Date(r.date + "T00:00:00").getFullYear();
    const suffix = String(year).slice(-2);
    const d = r.data || {};
    if (d.menuType === "short") return "SM";
    return `L${suffix}`;
  };

  const infoText = (d, r) => {
    const parts = [];
    const rs = Array.isArray(d.rooms) && d.rooms.length ? d.rooms.filter(Boolean) : (d.room ? [d.room] : []);
    if (d.guestType === "hotel" && rs.length) parts.push(`<u>Hotel #${esc(rs.join(", "))}</u>`);
    if (d.birthday) {
      const occasion = d.cakeNote ? `(${esc(d.cakeNote)})` : "";
      parts.push(`<u>1xCAKE${occasion}</u>`);
    }
    if (d.notes) parts.push(esc(d.notes));
    return parts.join("<br>");
  };

  // Build restriction text
  const restrText = (restrictions) => {
    if (!restrictions?.length) return "";
    const counts = {};
    restrictions.forEach(r => {
      counts[r.note] = (counts[r.note] || 0) + 1;
    });
    return Object.entries(counts).map(([key, count]) => {
      const def = restrictionDefs.find(d => d.key === key);
      const label = def ? def.label.toLowerCase() : key;
      return `${count}x ${label}`;
    }).join("\n");
  };

  let body = `<h1>Reservations : ${esc(dateRange)}</h1>`;
  body += `<h2>Guest count : ${totalGuests}</h2>`;

  body += `<table>`;
  body += `<tr><th>DATE</th><th>COVER</th><th>TIME</th><th>NAME</th><th>EXP.</th><th>INFO</th><th>ALLERGIES/<br>RESTRICTIONS</th></tr>`;

  for (const ds of sortedDates) {
    const dayResv = byDate[ds];
    const dayGuests = dayResv.reduce((a, r) => a + (r.data?.guests || 2), 0);
    const dateLabel = fmtDateShort(ds);

    // Date + total guest row
    body += `<tr class="date-row">`;
    body += `<td class="bold">${esc(dateLabel)}</td>`;
    body += `<td style="font-size:8pt;">Total<br>guest:<br><span class="bold">${dayGuests}</span></td>`;
    body += `<td></td><td></td><td></td><td></td><td></td>`;
    body += `</tr>`;

    // Check if we need LUNCH / DINNER subheadings
    const lunchResv  = dayResv.filter(r => { const t = r.data?.resTime || ""; return t < "15:00"; });
    const dinnerResv = dayResv.filter(r => { const t = r.data?.resTime || ""; return t >= "15:00"; });
    const needsSplit = lunchResv.length > 0 && dinnerResv.length > 0;

    const renderRows = (resv, subLabel) => {
      if (subLabel) {
        body += `<tr>`;
        body += `<td class="bold">${subLabel}</td>`;
        body += `<td></td><td></td><td></td><td></td><td></td><td></td>`;
        body += `</tr>`;
      }
      resv.forEach(r => {
        const d = r.data || {};
        const restr = restrText(d.restrictions);
        body += `<tr>`;
        body += `<td></td>`;
        body += `<td class="center">${d.guests || 2}</td>`;
        body += `<td>${esc(d.resTime || "")}</td>`;
        body += `<td class="bold">${esc(d.resName || "\u2014")}</td>`;
        body += `<td class="center"><u>${esc(expLabelForResv(r))}</u></td>`;
        body += `<td style="font-size:8pt;">${infoText(d, r)}</td>`;
        body += `<td style="font-size:8pt;white-space:pre-line;">${esc(restr)}</td>`;
        body += `</tr>`;
      });
    };

    if (needsSplit) {
      renderRows(lunchResv, "LUNCH");
      renderRows(dinnerResv, "DINNER");
    } else {
      renderRows(dayResv, null);
    }
  }

  body += `</table>`;
  return resvHtmlShell("Weekly Reservations", body);
}

// ── PDF 2: Weekly Allergy/Restriction Sheet ───────────────────────────────────

export function generateWeeklyAllergyHTML(reservations, menuCourses, weekDays, restrictionDefs = []) {
  const weekStart = toDateStr(weekDays[0]);
  const weekEnd   = toDateStr(weekDays[6]);
  const dateRange = `${fmtDateShort(weekStart)}-${fmtDateShort(weekEnd)}`;

  // Filter to week, then to only reservations with restrictions or manual edits
  const weekResv = reservations
    .filter(r => r.date >= weekStart && r.date <= weekEnd)
    .filter(r => {
      const d = r.data || {};
      const hasRestr = d.restrictions?.length > 0;
      const hasNotes = d.kitchenCourseNotes && Object.keys(d.kitchenCourseNotes).length > 0;
      return hasRestr || hasNotes;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || (a.data?.resTime || "99").localeCompare(b.data?.resTime || "99"));

  if (weekResv.length === 0) {
    return allergyHtmlShell("Weekly Allergy Sheet", `<h1 style="margin-top:40pt;font-family:Arial,Helvetica,sans-serif;">No restrictions or edits for ${esc(dateRange)}</h1>`, 0);
  }

  // Courses: all non-snack courses in order (main + optional)
  const courses = menuCourses
    .filter(c => !c.is_snack)
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999));

  let body = "";
  body += `<table>`;

  // Column widths: natural sizing for few reservations, compressed for many
  const isLarge = weekResv.length > 5;
  const courseColPct = weekResv.length <= 5 ? "22%" : weekResv.length <= 7 ? "18%" : "15%";
  const resvColPct = `${Math.floor((100 - parseInt(courseColPct)) / weekResv.length)}%`;
  const courseColStyle = isLarge
    ? `width:${courseColPct};text-align:left;padding-left:6pt;`
    : `min-width:110pt;text-align:left;padding-left:6pt;`;
  const resvColStyle = isLarge
    ? `width:${resvColPct};text-align:center;`
    : `min-width:90pt;text-align:center;`;

  // Header row 1: date range + guest names
  body += `<tr class="green-header">`;
  body += `<th style="${courseColStyle}">${esc(dateRange)}</th>`;
  weekResv.forEach(r => {
    const d = r.data || {};
    body += `<th style="${resvColStyle}">${esc(d.resName || "\u2014")}</th>`;
  });
  body += `</tr>`;

  // Header row 2: dates (white background)
  body += `<tr>`;
  body += `<td style="padding-left:6pt;">Date</td>`;
  weekResv.forEach(r => {
    body += `<td class="center">${fmtDateShort(r.date)}</td>`;
  });
  body += `</tr>`;

  // Header row 3: allergies/restrictions summary + menu type (white background)
  body += `<tr>`;
  body += `<td style="padding-left:6pt;font-weight:700;">Allergies/Restrictions</td>`;
  weekResv.forEach(r => {
    const d = r.data || {};
    const mt = d.menuType === "short" ? "SHORT MENU" : "LONG MENU";
    const restrCounts = {};
    (d.restrictions || []).forEach(rs => {
      restrCounts[rs.note] = (restrCounts[rs.note] || 0) + 1;
    });
    const restrLines = Object.entries(restrCounts).map(([key, count]) => {
      const def = restrictionDefs.find(x => x.key === key);
      const label = def ? def.label.toLowerCase() : key;
      return `${count}x ${label}`;
    });
    body += `<td class="center" style="line-height:1.3;">${esc(mt)}<br>${esc(restrLines.join(", "))}</td>`;
  });
  body += `</tr>`;

  // Course rows
  courses.forEach(course => {
    const key = course.course_key || "";
    const baseName = course.menu?.name || key;
    const baseSub  = course.menu?.sub || "";

    body += `<tr>`;
    // Course name column
    body += `<td style="padding-left:6pt;"><span class="course-name">${esc(baseName)}</span>`;
    if (baseSub) body += `<br><span class="course-sub">${esc(baseSub)}</span>`;
    body += `</td>`;

    // Per-reservation columns
    weekResv.forEach(r => {
      const d = r.data || {};
      const kcNote = d.kitchenCourseNotes?.[key];
      const restrictions = d.restrictions || [];

      // Priority 1: Manual kitchen ticket edits
      if (kcNote?.name || kcNote?.note) {
        const parts = [];
        if (kcNote.name) parts.push(esc(kcNote.name));
        if (kcNote.note) parts.push(esc(kcNote.note));
        body += `<td class="resv-cell highlight">${parts.join("<br>")}</td>`;
        return;
      }

      // Priority 2: Restriction-based modifications.
      // Each restriction entry represents one guest. Restrictions assigned to
      // the same seat (pos > 0) are grouped so the resolver picks a combined
      // substitute. Unassigned entries (pos null) each count as one guest —
      // counts must reflect how many guests actually have the restriction,
      // not the table size.
      if (restrictions.length > 0) {
        const modCounts = {};
        const seatGroups = new Map();
        const unassigned = [];
        restrictions.forEach(rs => {
          if (rs.pos) {
            const arr = seatGroups.get(rs.pos) || [];
            arr.push(rs.note);
            seatGroups.set(rs.pos, arr);
          } else {
            unassigned.push([rs.note]);
          }
        });
        [...seatGroups.values(), ...unassigned].forEach(notes => {
          const mod = getCourseMod(course, notes);
          if (mod) modCounts[mod] = (modCounts[mod] || 0) + 1;
        });

        if (Object.keys(modCounts).length > 0) {
          const entries = Object.entries(modCounts)
            .map(([mod, count]) => `${count}x ${mod.toLowerCase()}`)
            .join("<br>");
          body += `<td class="resv-cell highlight">${entries}</td>`;
          return;
        }
      }

      // Priority 3: no change
      body += `<td class="resv-cell"></td>`;
    });

    body += `</tr>`;
  });

  body += `</table>`;
  return allergyHtmlShell("Weekly Allergy Sheet", body, weekResv.length);
}

// ── PDF 3: Printable Kitchen Tickets ─────────────────────────────────────────

export function generateKitchenTicketsHTML(reservations, menuCourses, restrictionDefs = []) {
  if (!reservations || reservations.length === 0) {
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Kitchen Tickets</title>${ROBOTO_LINK}</head><body style="font-family:'Roboto Mono',monospace;padding:40pt;text-align:center;">No reservations</body></html>`;
  }

  const normFlag = s => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const normCategory = (course) => {
    const raw = normFlag(course?.course_category);
    if (raw === "main" || raw === "optional" || raw === "celebration") return raw;
    return normFlag(course?.optional_flag) ? "optional" : "main";
  };
  const isTruthyShort = v => { const s = String(v ?? "").trim().toLowerCase(); return s === "true" || s === "1" || s === "yes" || s === "y" || s === "x" || s === "wahr"; };

  const subDiff = (baseSub, modSub) => {
    const baseTokens = new Set(String(baseSub || "").split(/[,·]+/).map(s => s.trim().toLowerCase()).filter(Boolean));
    const modTokens = String(modSub || "").split(/[,·]+/).map(s => s.trim()).filter(Boolean);
    const newOnes = modTokens.filter(t => !baseTokens.has(t.toLowerCase()));
    return newOnes.length > 0 ? newOnes[0] : modSub;
  };

  const restrLabel = (key) => {
    const def = restrictionDefs.find(r => r.key === key);
    return def ? def.label : key;
  };

  const pLabel = p => p === "Non-Alc" ? "N/A" : p === "Our Story" ? "O.S." : p === "Premium" ? "Prem" : p === "Wine" ? "Wine" : p;

  const ticketCards = [...reservations]
    .sort((a, b) => (a.data?.resTime || "99:99").localeCompare(b.data?.resTime || "99:99"))
    .map(resv => {
      const d = resv.data || {};
      const tableId = resv.table_id;
      const tableGroup = Array.isArray(d.tableGroup) && d.tableGroup.length > 1
        ? d.tableGroup.map(Number).sort((a, b) => a - b) : null;
      const tLabel = tableGroup ? `T${tableGroup.join("-")}` : `T${tableId}`;
      const guests = d.guests || 2;
      const rawSeats = Array.isArray(d.seats) ? d.seats : [];
      const seats = Array.from({ length: guests }, (_, i) => ({
        id: i + 1,
        pairing: rawSeats[i]?.pairing || "",
        extras: rawSeats[i]?.extras || {},
      }));
      const restrictions = Array.isArray(d.restrictions) ? d.restrictions : [];
      const isShort = String(d.menuType || "").trim().toLowerCase() === "short";
      const kitchenCourseNotes = d.kitchenCourseNotes || {};
      const courseOverrides = d.courseOverrides || {};

      const seatRestrKeys = (seat) =>
        restrictions.filter(r => r.pos === seat.id).map(r => r.note);

      const overriddenCourses = (menuCourses || []).map(c => applyMenuOverride(c, courseOverrides));

      // Optional extras always shown in print; celebration (cake) only when birthday is on
      const courses = overriddenCourses
        .filter(c => {
          if (c.is_snack) return false;
          const category = normCategory(c);
          if (category === "celebration") return !!d.birthday;
          if (isShort && !isTruthyShort(c.show_on_short)) return false;
          return true;
        })
        .sort((a, b) => {
          if (isShort) return ((Number(a.short_order) || 9999) - (Number(b.short_order) || 9999));
          return (Number(a.position) || 0) - (Number(b.position) || 0);
        });

      // Header
      let html = `<div class="ticket">`;
      html += `<div class="hdr">`;
      html += `<span class="tbl">${esc(tLabel)}</span>`;
      html += `<div class="hinfo">`;
      html += `<div class="nrow">`;
      if (d.resName) html += `<span class="rname">${esc(d.resName)}</span>`;
      if (d.menuType) html += `<span class="badge${isShort ? " bshort" : ""}">${isShort ? "SHORT" : "LONG"}</span>`;
      html += `<span class="badge${d.lang === "si" ? " bsi" : " ben"}">${d.lang === "si" ? "SI" : "EN"}</span>`;
      if (d.birthday) html += ` &#x1F382;`;
      html += `</div>`;
      html += `<div class="mrow"><b>${guests}</b> <span class="muted">PAX</span>`;
      if (d.resTime) html += ` <span class="rtime">${esc(d.resTime)}</span>`;
      if (d.guestType === "hotel") {
        const rs = Array.isArray(d.rooms) && d.rooms.length ? d.rooms.filter(Boolean) : (d.room ? [d.room] : []);
        if (rs.length) html += ` <span class="muted">#${esc(rs.join(", "))}</span>`;
      }
      html += `</div>`;
      html += `</div>`;
      html += `</div>`; // .hdr

      // Notes
      if (d.notes) {
        html += `<div class="notes">${esc(d.notes)}</div>`;
      }

      // Seats with pairings and restrictions
      const unassigned = restrictions.filter(r => !r.pos && r.note);
      html += `<div class="seats">`;
      seats.forEach(s => {
        const p = s.pairing && s.pairing !== "—" ? s.pairing : null;
        const restrList = restrictions.filter(r => r.pos === s.id).map(r => r.note).filter(Boolean);
        html += `<span class="stag">P${s.id}${p ? ` · ${pLabel(p)}` : ""}`;
        if (restrList.length) html += ` <span class="srestr">${restrList.map(restrLabel).join(" · ")}</span>`;
        html += `</span>`;
      });
      if (unassigned.length) {
        html += `<div class="unassigned">&#9888; ${unassigned.map(r => restrLabel(r.note)).join(", ")} (unassigned)</div>`;
      }
      html += `</div>`; // .seats

      // Courses
      html += `<div class="courses">`;
      courses.forEach((course, idx) => {
        const key = course.course_key || `course_${idx}`;
        const baseName = course.menu?.name || key;
        const baseSub = course.menu?.sub || "";
        const category = normCategory(course);
        const optKey = normFlag(course?.optional_flag || "");
        const kcNote = kitchenCourseNotes[key] || {};
        const displayName = kcNote.name || baseName;

        // Per-seat modifications
        const allSeatDishes = seats.map(seat => {
          const restrKeys = seatRestrKeys(seat);
          if (restrKeys.length) {
            const modified = applyCourseRestriction(course, restrKeys);
            if (modified) {
              if (modified.name !== baseName) return modified.name;
              if (modified.sub !== baseSub) return subDiff(baseSub, modified.sub).toUpperCase();
            }
          }
          return baseName;
        });
        const anyMod = allSeatDishes.some(n => n !== baseName);
        const modGroups = anyMod ? (() => {
          const g = {};
          allSeatDishes.forEach(n => { g[n] = (g[n] || 0) + 1; });
          return g;
        })() : null;

        // Derived kitchen note from restriction variants
        const kitchenNote = (() => {
          const notes = new Set();
          seats.forEach(seat => {
            seatRestrKeys(seat).forEach(k => {
              const n = deriveKitchenNote(course, k, baseName, baseSub);
              if (n) notes.add(n);
            });
          });
          return [...notes].join(" · ");
        })();

        // Extra label: for optional (beetroot/cheese) always show quantity or "—";
        // for celebration (cake) show only when birthday is on
        let extraLabel = null;
        if (optKey) {
          if (category === "celebration" && d.birthday) {
            extraLabel = "ALL" + (optKey === "cake" && d.cakeNote ? ` — ${d.cakeNote}` : "");
          } else if (category === "optional") {
            const orderedSeats = seats.filter(s => !!s.extras?.[optKey]?.ordered);
            extraLabel = orderedSeats.length > 0
              ? `${orderedSeats.length}× ${orderedSeats.map(s => `P${s.id}`).join(" ")}`
              : "—";
          }
        }

        const isOpt = category === "optional" || category === "celebration";
        html += `<div class="cr${isOpt ? " cr-opt" : ""}">`;
        html += `<div class="cm">`;
        html += `<span class="cn">${esc(displayName)}`;
        if (kcNote.name) html += ` <span class="corig">(${esc(baseName)})</span>`;
        html += `</span>`;
        if (extraLabel !== null) html += `<span class="el">${esc(extraLabel)}</span>`;
        html += `</div>`;
        if (modGroups || kitchenNote || kcNote.note) {
          html += `<div class="mods">`;
          if (modGroups) {
            Object.entries(modGroups)
              .sort(([a], [b]) => (a === baseName ? -1 : 1) - (b === baseName ? -1 : 1))
              .forEach(([name, count]) => {
                html += `<span class="mod${name !== baseName ? " malt" : ""}">${count}× ${esc(name)}</span>`;
              });
          }
          if (kitchenNote) html += `<span class="mod malt">${esc(kitchenNote)}</span>`;
          if (kcNote.note) html += `<span class="mod malt">&#9873; ${esc(kcNote.note)}</span>`;
          html += `</div>`;
        }
        html += `</div>`; // .cr
      });
      html += `</div>`; // .courses
      html += `</div>`; // .ticket
      return html;
    });

  const css = `
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Roboto Mono',monospace;font-size:9pt;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact;padding:5mm;}
@page{size:A4 portrait;margin:8mm 8mm;}
@media print{body{padding:0;}}
.grid{display:flex;flex-wrap:wrap;gap:5mm;align-items:flex-start;}
.ticket{border:1.5pt solid #000;width:92mm;font-family:'Roboto Mono',monospace;page-break-inside:avoid;break-inside:avoid;}
.hdr{border-bottom:1pt solid #aaa;padding:5pt 8pt;display:flex;align-items:flex-start;gap:5pt;}
.tbl{font-size:18pt;font-weight:700;letter-spacing:-0.02em;line-height:1;flex-shrink:0;}
.hinfo{flex:1;min-width:0;}
.nrow{display:flex;align-items:baseline;gap:3pt;flex-wrap:wrap;}
.rname{font-size:10pt;font-weight:700;}
.badge{font-size:5.5pt;font-weight:700;letter-spacing:0.08em;padding:1pt 3pt;border:1pt solid #aaa;background:#f0f0f0;color:#444;}
.bshort{background:#fff3cd;border-color:#d4a017;color:#856404;}
.ben{background:#d4edda;border-color:#5a9a6a;color:#155724;}
.bsi{background:#f8d7da;border-color:#c04040;color:#721c24;}
.mrow{display:flex;gap:5pt;margin-top:2pt;align-items:baseline;}
.rtime{font-size:9pt;font-weight:600;color:#333;}
.muted{font-size:8pt;color:#666;font-weight:400;}
.notes{background:#fffbf0;border-bottom:1pt solid #e8e0c0;padding:3pt 8pt;font-size:7.5pt;color:#666;font-style:italic;}
.seats{border-bottom:1pt solid #aaa;padding:4pt 8pt;display:flex;flex-wrap:wrap;gap:2.5pt 4pt;background:#f9f9f9;}
.stag{font-size:7pt;font-weight:700;padding:1.5pt 4pt;border:1pt solid #ccc;background:#fff;}
.srestr{color:#c04040;font-weight:700;}
.unassigned{font-size:7pt;color:#c04040;width:100%;margin-top:2pt;font-weight:700;}
.courses{}
.cr{border-bottom:1pt solid #eee;padding:4pt 8pt;}
.cr:last-child{border-bottom:none;}
.cr-opt{background:#fafff8;}
.cm{display:flex;align-items:baseline;justify-content:space-between;gap:4pt;}
.cn{font-size:9pt;font-weight:700;letter-spacing:0.01em;}
.corig{font-size:6.5pt;font-weight:400;color:#999;}
.el{font-size:8pt;font-weight:600;color:#555;flex-shrink:0;text-align:right;}
.mods{margin-top:2pt;display:flex;flex-wrap:wrap;gap:1.5pt 5pt;}
.mod{font-size:8pt;font-weight:600;color:#555;}
.malt{color:#c04040;}
`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Kitchen Tickets</title>
${ROBOTO_LINK}
<style>${css}</style>
</head><body>
<div class="grid">
${ticketCards.join("\n")}
</div>
</body></html>`;
}
