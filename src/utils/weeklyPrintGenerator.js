/**
 * Weekly print generators for the Reservation Manager.
 * Produces two HTML documents: reservations sheet and allergy/restriction sheet.
 */
import { applyCourseRestriction, getCourseMod, RESTRICTION_PRIORITY_KEYS, RESTRICTION_COLUMN_MAP } from "./menuUtils.js";

const esc = s => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const htmlShell = (title, bodyHtml, landscape = false) => `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:'Roboto Mono',monospace;font-size:9pt;color:#1a1a1a;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
@page{size:A4 ${landscape ? "landscape" : "portrait"};margin:10mm 8mm;}
@media print{body{margin:0;}}
table{width:100%;border-collapse:collapse;page-break-inside:auto;}
tr{page-break-inside:avoid;}
th,td{border:1px solid #888;padding:3pt 5pt;vertical-align:top;text-align:left;}
th{font-weight:700;}
.date-header{background:#1a1a1a;color:#fff;font-weight:700;font-size:10pt;padding:5pt 8pt;}
.date-header td{border-color:#1a1a1a;}
.green-header{background:#2f7a45;color:#fff;font-weight:700;}
.green-header th,.green-header td{border-color:#256b36;color:#fff;}
.red{color:#c04040;font-weight:700;}
.muted{color:#888;}
.center{text-align:center;}
.small{font-size:7.5pt;}
.bold{font-weight:700;}
.resv-cell{font-size:7.5pt;line-height:1.3;}
.highlight{background:#f0faf0;}
.course-name{font-weight:700;text-transform:uppercase;font-size:8pt;}
.course-sub{font-size:7pt;color:#666;font-style:italic;}
h1{font-family:'Roboto Mono',monospace;font-size:12pt;text-align:center;margin:0 0 2pt;}
h2{font-family:'Roboto Mono',monospace;font-size:9pt;text-align:center;margin:0 0 10pt;font-weight:400;color:#555;}
</style></head><body>${bodyHtml}</body></html>`;

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
  const dateRange = `${fmtDateShort(weekStart)} - ${fmtDateFull(weekEnd)}`;

  const restrText = (restrictions) => {
    if (!restrictions?.length) return "";
    // Unique restriction keys, then map to labels
    const unique = [...new Set(restrictions.map(r => r.note))];
    return unique.map(key => {
      const count = restrictions.filter(r => r.note === key).length;
      const def = restrictionDefs.find(d => d.key === key);
      const label = def ? def.label : key;
      return count > 1 ? `${count}x ${label.toLowerCase()}` : label.toLowerCase();
    }).join(", ");
  };

  const infoText = (d) => {
    const parts = [];
    if (d.guestType === "hotel" && d.room) parts.push(`<u>Hotel #${esc(d.room)}</u>`);
    if (d.birthday) parts.push("<u>1xCAKE" + (d.birthday && d.notes?.toLowerCase().includes("bday") ? "(bday)" : d.birthday ? "(anni)" : "") + "</u>");
    if (d.notes) parts.push(esc(d.notes));
    return parts.join("<br>");
  };

  const expLabel = (menuType) => {
    if (menuType === "short") return "SM";
    return "LM";
  };

  let body = `<h1>Reservations : ${esc(dateRange)}</h1>`;
  body += `<h2>Guest count : ${totalGuests}</h2>`;

  body += `<table>`;
  body += `<tr style="background:#f0f0f0;"><th>DATE</th><th>COVER</th><th>TIME</th><th>NAME</th><th>EXP.</th><th>INFO</th><th>ALLERGIES/<br>RESTRICTIONS</th></tr>`;

  const sortedDates = Object.keys(byDate).sort();
  for (const ds of sortedDates) {
    const dayResv = byDate[ds];
    const dayGuests = dayResv.reduce((a, r) => a + (r.data?.guests || 2), 0);
    const dateLabel = fmtDateShort(ds);

    // Date header row
    body += `<tr class="date-header"><td colspan="7">${esc(dateLabel)}&nbsp;&nbsp;&nbsp;Total guest: ${dayGuests}</td></tr>`;

    // Check if we need LUNCH / DINNER subheadings
    const lunchResv  = dayResv.filter(r => { const t = r.data?.resTime || ""; return t < "15:00"; });
    const dinnerResv = dayResv.filter(r => { const t = r.data?.resTime || ""; return t >= "15:00"; });
    const needsSplit = lunchResv.length > 0 && dinnerResv.length > 0;

    const renderRows = (resv, subLabel) => {
      if (needsSplit && subLabel) {
        body += `<tr><td colspan="7" style="font-weight:700;font-size:9pt;padding:4pt 8pt;border:none;background:#fff;">${subLabel}</td></tr>`;
      }
      resv.forEach((r, i) => {
        const d = r.data || {};
        body += `<tr>`;
        body += `<td class="center">${i === 0 && !needsSplit ? esc(dateLabel) : ""}</td>`;
        body += `<td class="center">${d.guests || 2}</td>`;
        body += `<td>${esc(d.resTime || "")}</td>`;
        body += `<td class="bold">${esc(d.resName || "—")}</td>`;
        body += `<td class="center">${expLabel(d.menuType)}</td>`;
        body += `<td class="small">${infoText(d)}</td>`;
        body += `<td class="small">${restrText(d.restrictions)}</td>`;
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
  return htmlShell("Weekly Reservations", body, false);
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
    return htmlShell("Weekly Allergy Sheet", `<h1 style="margin-top:40pt;">No restrictions or edits for ${esc(dateRange)}</h1>`, true);
  }

  // Courses: all non-snack, non-cake courses in order
  const courses = menuCourses
    .filter(c => !c.is_snack && c.optional_flag !== "cake")
    .sort((a, b) => (a.position ?? 999) - (b.position ?? 999));

  // Column width calc
  const courseColW = 200;
  const resvColW = Math.max(120, Math.floor((900 - courseColW) / Math.max(weekResv.length, 1)));

  let body = "";
  body += `<table style="table-layout:fixed;">`;

  // Header row 1: date range + guest names
  body += `<tr class="green-header">`;
  body += `<th style="width:${courseColW}px;">${esc(dateRange)}</th>`;
  weekResv.forEach(r => {
    const d = r.data || {};
    body += `<th style="width:${resvColW}px;text-align:center;font-size:8pt;">${esc(d.resName || "—")}</th>`;
  });
  body += `</tr>`;

  // Header row 2: dates
  body += `<tr class="green-header">`;
  body += `<td style="font-size:8pt;">Date</td>`;
  weekResv.forEach(r => {
    body += `<td class="center" style="font-size:8pt;">${fmtDateShort(r.date)}</td>`;
  });
  body += `</tr>`;

  // Header row 3: allergies/restrictions summary + menu type
  body += `<tr class="green-header">`;
  body += `<td style="font-size:7.5pt;">Allergies/Restrictions</td>`;
  weekResv.forEach(r => {
    const d = r.data || {};
    const mt = d.menuType === "short" ? "SHORT MENU" : "LONG MENU";
    const restrLabels = (d.restrictions || []).map(rs => {
      const count = (d.restrictions || []).filter(x => x.note === rs.note).length;
      const def = restrictionDefs.find(x => x.key === rs.note);
      const label = def ? def.label.toLowerCase() : rs.note;
      return count > 1 ? `${count}x ${label}` : label;
    });
    // Deduplicate
    const unique = [...new Set(restrLabels)];
    body += `<td class="center" style="font-size:7pt;line-height:1.35;">${esc(mt)}<br>${esc(unique.join(", "))}</td>`;
  });
  body += `</tr>`;

  // Course rows
  courses.forEach(course => {
    const key = course.course_key || "";
    const baseName = course.menu?.name || key;
    const baseSub  = course.menu?.sub || "";

    body += `<tr>`;
    // Course name column
    body += `<td><span class="course-name">${esc(baseName)}</span>`;
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
        body += `<td class="resv-cell highlight"><span class="red">${parts.join("<br>")}</span></td>`;
        return;
      }

      // Priority 2: Restriction-based modifications (per-seat, grouped)
      if (restrictions.length > 0) {
        // Build seat-level modification map
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
  return htmlShell("Weekly Allergy Sheet", body, true);
}
