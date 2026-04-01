/**
 * Weekly print generators for the Reservation Manager.
 * Produces two HTML documents: reservations sheet and allergy/restriction sheet.
 */
import { applyCourseRestriction, getCourseMod, RESTRICTION_PRIORITY_KEYS, RESTRICTION_COLUMN_MAP } from "./menuUtils.js";

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
  // Scale font based on number of reservation columns to fit on one page
  const baseFontPt = resvCount <= 3 ? 7 : resvCount <= 5 ? 6.5 : resvCount <= 7 ? 5.5 : 5;
  const courseSubPt = Math.max(baseFontPt - 1.5, 4);
  const cellPad = "1.5pt 3pt";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
${ROBOTO_LINK}
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Roboto Mono',monospace;font-size:${baseFontPt}pt;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
@page{size:A4 landscape;margin:5mm 5mm;}
@media print{body{margin:0;}}
table{width:100%;border-collapse:collapse;table-layout:fixed;}
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

const toDateStr = d => d.toISOString().slice(0, 10);

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
    if (d.guestType === "hotel" && d.room) parts.push(`<u>Hotel #${esc(d.room)}</u>`);
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
      return count > 1 ? `${count}x ${label}` : label;
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

  // Courses: all non-snack, non-cake courses in order
  const courses = menuCourses
    .filter(c => !c.is_snack && c.optional_flag !== "cake")
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999));

  let body = "";
  body += `<table>`;

  // Calculate course column width
  const courseColPct = weekResv.length <= 3 ? "22%" : weekResv.length <= 5 ? "18%" : "15%";
  const resvColPct = `${Math.floor((100 - parseInt(courseColPct)) / weekResv.length)}%`;

  // Header row 1: date range + guest names
  body += `<tr class="green-header">`;
  body += `<th style="width:${courseColPct};text-align:left;padding-left:6pt;">${esc(dateRange)}</th>`;
  weekResv.forEach(r => {
    const d = r.data || {};
    body += `<th style="width:${resvColPct};text-align:center;">${esc(d.resName || "\u2014")}</th>`;
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
      return count > 1 ? `${count}x ${label}` : label;
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
      const guests = d.guests || 2;
      const restrictions = d.restrictions || [];

      // Priority 1: Manual kitchen ticket edits
      if (kcNote?.name || kcNote?.note) {
        const parts = [];
        if (kcNote.name) parts.push(esc(kcNote.name));
        if (kcNote.note) parts.push(esc(kcNote.note));
        body += `<td class="resv-cell highlight">${parts.join("<br>")}</td>`;
        return;
      }

      // Priority 2: Restriction-based modifications (per-seat, grouped)
      if (restrictions.length > 0) {
        const modCounts = {};
        for (let seatId = 1; seatId <= guests; seatId++) {
          const seatRestrKeys = restrictions
            .filter(rs => !rs.pos || rs.pos === seatId)
            .map(rs => rs.note);
          if (!seatRestrKeys.length) continue;
          const mod = getCourseMod(course, seatRestrKeys);
          if (mod) {
            modCounts[mod] = (modCounts[mod] || 0) + 1;
          }
        }

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
