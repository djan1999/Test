/**
 * Weekly print generators for the Reservation Manager.
 * Produces two HTML documents: reservations sheet and allergy/restriction sheet.
 */
import { applyCourseRestriction, getCourseMod, deriveKitchenNote } from "./menuUtils.js";

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

// ── PDF 1: Weekly Reservations Sheet ──────────────────────────────────────────────────────

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
        body += `<td class="bold">${esc(d.resName || "—")}</td>`;
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

// ── PDF 2: Weekly Allergy/Restriction Sheet ───────────────────────────────────────────────

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
    body += `<th style="${resvColStyle}">${esc(d.resName || "—")}</th>`;
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

// ── PDF 3: Printable Kitchen Tickets ───────────────────────────────────────────────────────────────────
// Skeleton format matching the physical ticket taped to the kitchen pass:
// pre-printed quantities for main courses, blank rows for optional extras,
// summary block at the bottom with restrictions pre-filled.

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

  const restrLabel = (key) => {
    const def = restrictionDefs.find(r => r.key === key);
    return def ? def.label : key;
  };

  const ticketCards = [...reservations]
    .sort((a, b) => (a.data?.resTime || "99:99").localeCompare(b.data?.resTime || "99:99"))
    .map(resv => {
      const d = resv.data || {};
      const tableId = resv.table_id;
      const tableGroup = Array.isArray(d.tableGroup) && d.tableGroup.length > 1
        ? d.tableGroup.map(Number).sort((a, b) => a - b) : null;
      const tLabel = tableGroup ? tableGroup.join("-") : String(tableId);
      const guests = d.guests || 2;
      const restrictions = Array.isArray(d.restrictions) ? d.restrictions : [];
      const isShort = String(d.menuType || "").trim().toLowerCase() === "short";
      const kitchenCourseNotes = d.kitchenCourseNotes || {};

      const allCourses = menuCourses || [];

      // All non-snack courses in order. Optional extras always included.
      // Celebration (cake) only when birthday is on.
      const courses = allCourses
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

      // All optional extra course names for the summary block
      const optExtras = [];
      const seenOptKeys = new Set();
      allCourses
        .filter(c => !c.is_snack && normCategory(c) === "optional")
        .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0))
        .forEach(c => {
          const k = normFlag(c?.optional_flag || "");
          if (k && !seenOptKeys.has(k)) {
            seenOptKeys.add(k);
            optExtras.push(c.menu?.name || k);
          }
        });

      // Restrictions summary: all restrictions, no positions, deduplicated with counts
      const restrCounts = {};
      restrictions.forEach(r => { if (r.note) restrCounts[r.note] = (restrCounts[r.note] || 0) + 1; });
      const restrSummary = Object.entries(restrCounts)
        .map(([key, count]) => count > 1 ? `${count}x ${restrLabel(key)}` : restrLabel(key))
        .join(", ");

      // ── Build HTML ────────────────────────────────────────────────────────────────────

      let html = `<div class="ticket">`;

      // Header — two-column grid matching physical ticket layout
      html += `<div class="hdr">`;
      html += `<div class="hcol"><span class="hlbl">TABLE:</span> <span class="hval">${esc(tLabel)}</span></div>`;
      html += `<div class="hcol"><span class="hlbl">GUESTS:</span> <span class="hval">${guests}</span></div>`;
      html += `<div class="hcol"><span class="hlbl">LANG:</span> <span class="hval">${d.lang === "si" ? "SI" : "ENG"}</span></div>`;
      html += `<div class="hcol"><span class="hlbl">TIME:</span> <span class="hval">${esc(d.resTime || "")}</span></div>`;
      if (d.resName) {
        html += `<div class="hfull"><span class="hlbl">NAME:</span> <span class="hval">${esc(d.resName)}</span></div>`;
      }
      if (d.menuType) {
        html += `<div class="hfull"><span class="hlbl">MENU:</span> <span class="hval">${isShort ? "SHORT" : "LONG"}</span></div>`;
      }
      html += `</div>`; // .hdr

      // Fixed pairing template — staff circles the applicable options
      html += `<div class="pair">WP &nbsp;/&nbsp; PWP &nbsp;/&nbsp; OS &nbsp;/&nbsp; NA &nbsp;/&nbsp; BTB &nbsp;/&nbsp; BTG</div>`;

      // Notes banner
      if (d.notes) {
        html += `<div class="notes">${esc(d.notes)}</div>`;
      }

      // Course list
      html += `<div class="courses">`;
      courses.forEach((course, idx) => {
        const key = course.course_key || `course_${idx}`;
        const category = normCategory(course);
        const isOpt = category === "optional";
        const isCelebration = category === "celebration";
        const kcNote = kitchenCourseNotes[key] || {};
        const displayName = kcNote.name || course.menu?.name || key;
        const inlineNote = kcNote.note ? ` [${kcNote.note}]` : "";

        // For main courses: find the actual alternative dish name for each
        // restriction group and show a count breakdown, e.g. "1× Danube · 1× Parsnip Root".
        // Handles both seat-assigned (pos > 0) and unassigned (pos null) restrictions —
        // unassigned ones are each treated as one guest of unknown seat.
        let modLines = [];
        if (!isOpt && !isCelebration && restrictions.length > 0) {
          const baseName = course.menu?.name || key;
          const baseSub = course.menu?.sub || "";
          const modCounts = {};

          // Group seat-assigned restrictions by pos; each unassigned entry is its own group
          const seatGroups = new Map();
          const unassignedGroups = [];
          restrictions.forEach(r => {
            if (!r.note) return;
            if (r.pos) {
              const arr = seatGroups.get(r.pos) || [];
              arr.push(r.note);
              seatGroups.set(r.pos, arr);
            } else {
              unassignedGroups.push([r.note]);
            }
          });

          [...seatGroups.values(), ...unassignedGroups].forEach(restrKeys => {
            const modified = applyCourseRestriction(course, restrKeys);
            let label = null;
            if (modified) {
              if (modified.name !== baseName) {
                label = modified.name;
              } else if (modified.sub !== baseSub) {
                const baseTokens = new Set(baseSub.split(/[,·]+/).map(s => s.trim().toLowerCase()).filter(Boolean));
                const newOnes = modified.sub.split(/[,·]+/).map(s => s.trim()).filter(t => !baseTokens.has(t.toLowerCase()));
                label = newOnes.length > 0 ? newOnes[0] : modified.sub;
              } else {
                for (const k of restrKeys) {
                  const n = deriveKitchenNote(course, k, baseName, baseSub);
                  if (n) { label = n; break; }
                }
              }
            }
            if (label) {
              modCounts[label] = (modCounts[label] || 0) + 1;
            }
          });

          if (Object.keys(modCounts).length > 0) {
            // Only show the alternatives — main line already has the total count
            // and standard dish name, so repeating them is redundant.
            // Lowercase so it reads as a note, not a heading.
            modLines = Object.entries(modCounts)
              .map(([name, count]) => `${count}&#215; ${esc(name.toLowerCase())}`);
          }
        }

        if (isOpt) {
          // Optional extras (Beetroot, Cheese): blank quantity — staff fills in
          html += `<div class="cr cr-opt"><span class="qty"></span><span class="cname">${esc(displayName)}${inlineNote}</span></div>`;
        } else {
          html += `<div class="cr"><span class="qty">${guests}</span><span class="cname">${esc(displayName)}${inlineNote}</span>`;
          if (modLines.length) {
            html += `<span class="cmods">&nbsp;&middot;&nbsp; ${modLines.join(" &middot;&nbsp; ")}</span>`;
          }
          html += `</div>`;
        }
      });
      html += `</div>`; // .courses

      // Summary block — always present, staff fills in quantities during service
      html += `<div class="summary">`;
      optExtras.forEach(name => {
        html += `<div class="srow"><span class="slbl">${esc(name)}:</span></div>`;
      });
      if (d.birthday) {
        const cakeExtra = d.cakeNote ? ` ${esc(d.cakeNote)}` : "";
        html += `<div class="srow"><span class="slbl">Cake:${cakeExtra}</span></div>`;
      }
      html += `<div class="srow srestr-row"><span class="slbl">Allergies &amp; Restrictions:</span>`;
      if (restrSummary) html += ` <span class="srestr-val">${esc(restrSummary)}</span>`;
      html += `</div>`;
      // Extra blank space at the bottom for sharpie annotations
      html += `<div class="srow srow-notes"></div>`;
      html += `</div>`; // .summary

      html += `</div>`; // .ticket
      return html;
    });

  const css = `
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Roboto Mono',monospace;font-size:10pt;color:#000;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;padding:5mm;}
@page{size:A4 portrait;margin:8mm 8mm;}
@media print{body{padding:0;}}
.grid{display:flex;flex-wrap:wrap;gap:5mm;align-items:flex-start;}
.ticket{border:1.5pt solid #000;width:88mm;font-family:'Roboto Mono',monospace;page-break-inside:avoid;break-inside:avoid;}
.hdr{border-bottom:1pt solid #000;padding:5pt 7pt;display:grid;grid-template-columns:1fr 1fr;gap:1pt 6pt;}
.hcol{display:flex;align-items:baseline;gap:3pt;}
.hfull{grid-column:1/-1;display:flex;align-items:baseline;gap:3pt;}
.hlbl{font-size:7.5pt;font-weight:400;letter-spacing:0.04em;flex-shrink:0;}
.hval{font-size:11pt;font-weight:700;line-height:1.1;}
.pair{border-bottom:1pt solid #000;padding:4pt 7pt;font-size:8pt;font-weight:700;letter-spacing:0.10em;text-align:center;}
.notes{border-bottom:1pt solid #000;padding:3pt 7pt;font-size:8pt;font-style:italic;}
.courses{border-bottom:1pt solid #000;}
.cr{display:flex;align-items:baseline;padding:2.5pt 7pt;border-bottom:0.5pt dotted #aaa;flex-wrap:wrap;}
.cr:last-child{border-bottom:none;}
.qty{min-width:14pt;font-size:10pt;font-weight:700;flex-shrink:0;}
.cname{font-size:10pt;font-weight:700;line-height:1.25;}
.cmods{font-size:9pt;font-weight:400;}
.summary{padding:4pt 7pt;}
.srow{font-size:9pt;font-weight:700;min-height:18pt;padding:3pt 0;border-bottom:0.5pt dotted #aaa;display:flex;align-items:flex-start;}
.srow-notes{min-height:28pt;border-bottom:none;}
.srow:last-child{border-bottom:none;}
.slbl{flex-shrink:0;}
.srestr-val{font-weight:400;margin-left:4pt;}
`;

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Kitchen Tickets</title>
${ROBOTO_LINK}
<style>${css}</style>
</head><body><div class="grid">
${ticketCards.join("\n")}
</div>
<script>window.onload = function(){ window.print(); };<\/script>
</body></html>`;
}
