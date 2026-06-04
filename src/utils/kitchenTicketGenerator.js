/**
 * kitchenTicketGenerator.js — pure HTML string generator for the kitchen
 * ticket admin preview.
 *
 * NOT used in the actual print path — the existing KitchenTicket component in
 * KitchenBoard.jsx remains the authoritative renderer for daily service and
 * printing. This generator is used exclusively in the admin MenuTemplateEditor
 * preview panel when editing a kitchen_flow profile.
 */

// ── Design tokens (raw hex — no import of tokens.js needed in a generator) ───
const C = {
  ink0:        "#0a0a0a",
  ink1:        "#1a1a1a",
  ink2:        "#4a4a4a",
  ink3:        "#8a8a8a",
  ink4:        "#c4c4c4",
  ink5:        "#e8e6e2",
  inkBg:       "#f8f7f5",
  white:       "#ffffff",
  greenBg:     "#ecf4ee",
  greenBorder: "#8fb69b",
  greenText:   "#3e6b4b",
  redBg:       "#f6ecec",
  redBorder:   "#c08080",
  redText:     "#8a3a3a",
  parchment:   "#f2ede3",
  charcoal:    "#2a2a28",
  maleBg:      "#dbeafe",
  maleText:    "#1e40af",
  femaleBg:    "#fce7f3",
  femaleText:  "#9d174d",
};
const FONT = "'Roboto Mono','Courier New',monospace";

// ── Realistic sample data for the admin preview ───────────────────────────────

const SAMPLE_TABLE = {
  id: 5,
  resName: "Johnson",
  menuType: "long",
  lang: "en",
  birthday: false,
  guestType: null,
  rooms: [],
  resTime: "19:00",
  arrivedAt: "19:03",
  notes: "Window seat preferred",
  pace: null,
  seats: [
    { id: 1, pairing: "Wine",    gender: "Mr"  },
    { id: 2, pairing: "Non-Alc", gender: "Mrs" },
    { id: 3, pairing: "Wine",    gender: null  },
  ],
  restrictions: [
    { note: "gluten", pos: 2 },
  ],
  kitchenLog: {},
  kitchenCourseNotes: {},
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── Section renderers ─────────────────────────────────────────────────────────

function renderHeader(block, table, totalCourses) {
  const t   = table;
  const b   = block || {};
  const seats      = t.seats || [];
  const isShort    = String(t.menuType || "").toLowerCase() === "short";
  const firedCount = Object.keys(t.kitchenLog || {}).length;

  const showName    = b.showName          !== false;
  const showMenuBdg = b.showMenuTypeBadge !== false;
  const showLangBdg = b.showLangBadge    !== false;
  const showBday    = b.showBirthday      !== false;
  const showRooms   = b.showRooms         !== false;
  const showPax     = b.showPax           !== false;
  const showTime    = b.showTime          !== false;
  const showArr     = b.showArrived       !== false;
  const showProg    = b.showProgress      !== false;

  const rooms = Array.isArray(t.rooms) && t.rooms.length ? t.rooms : (t.room ? [t.room] : []);

  let badges = "";
  if (showMenuBdg && t.menuType) {
    badges += `<span style="font-size:7px;font-weight:600;letter-spacing:0.08em;padding:1px 5px;background:${C.ink5};color:${C.ink3};margin-right:3px">${isShort ? "SHORT" : "LONG"}</span>`;
  }
  if (showLangBdg) {
    const si = t.lang === "si";
    badges += `<span style="font-size:7px;font-weight:600;letter-spacing:0.08em;padding:1px 5px;background:${si ? C.redBg : C.greenBg};color:${si ? C.redText : C.greenText};border:1px solid ${si ? C.redBorder : C.greenBorder}">${si ? "SI" : "EN"}</span>`;
  }
  if (showBday && t.birthday) badges += `<span style="font-size:9px;margin-left:3px">🎂</span>`;
  if (showRooms && rooms.length) {
    badges += `<span style="font-size:7px;color:${C.ink3};letter-spacing:0.06em;margin-left:5px">#${rooms.join(", ")}</span>`;
  }

  let paxLine = "";
  if (showPax) {
    paxLine += `<span style="font-size:10px;font-weight:700;color:${C.ink0}">${seats.length} <span style="font-weight:400;font-size:8px;letter-spacing:0.06em">PAX</span></span>`;
  }
  if (showTime && t.resTime)    paxLine += `<span style="font-size:10px;font-weight:600;color:${C.ink2};margin-left:6px">${esc(t.resTime)}</span>`;
  if (showArr  && t.arrivedAt)  paxLine += `<span style="font-size:10px;font-weight:600;color:${C.greenBorder};margin-left:6px">arr. ${esc(t.arrivedAt)}</span>`;

  const isDone = totalCourses > 0 && firedCount >= totalCourses;
  const progressHtml = showProg
    ? `<div style="font-size:14px;font-weight:700;color:${isDone ? C.greenBorder : C.ink0};line-height:1">${firedCount}<span style="font-size:8px;color:${C.ink3};font-weight:400">/${totalCourses}</span></div>`
    : "";

  return `
<div style="background:${C.white};border-bottom:1px solid ${C.ink4};padding:7px 10px;display:flex;align-items:flex-start;gap:8px">
  <span style="font-size:20px;font-weight:800;color:${C.ink0};line-height:1;letter-spacing:-0.02em;flex-shrink:0">T${t.id}</span>
  <div style="flex:1;min-width:0">
    <div style="display:flex;align-items:baseline;gap:5px;flex-wrap:wrap">
      ${showName && t.resName ? `<span style="font-size:11px;font-weight:700;color:${C.ink0};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.resName)}</span>` : ""}
      ${badges}
    </div>
    ${paxLine ? `<div style="display:flex;align-items:baseline;gap:6px;margin-top:1px;flex-wrap:wrap">${paxLine}</div>` : ""}
  </div>
  ${progressHtml ? `<div style="display:flex;flex-direction:column;align-items:flex-end;flex-shrink:0">${progressHtml}</div>` : ""}
</div>`;
}

function renderNotesBanner(block, table) {
  if (!table.notes) return "";
  return `
<div style="background:${C.parchment};border-bottom:1px solid ${C.ink4};padding:5px 10px;display:flex;gap:6px;align-items:flex-start">
  <span style="font-size:9px;color:${C.ink3};flex-shrink:0;line-height:1.4">📋</span>
  <span style="font-size:9px;color:${C.ink2};line-height:1.35;font-style:italic">${esc(table.notes)}</span>
</div>`;
}

function renderPaceStrip(block, table) {
  const fast = table.pace === "Fast";
  const slow = table.pace === "Slow";
  return `
<div style="border-bottom:1px solid ${C.ink4};padding:5px 10px;display:flex;align-items:center;gap:6px">
  <span style="font-size:8px;letter-spacing:0.14em;color:${C.ink3};text-transform:uppercase;flex-shrink:0">PACE</span>
  <span style="font-size:8px;letter-spacing:0.10em;text-transform:uppercase;padding:8px 10px;border:1px solid ${slow ? C.charcoal : C.ink4};background:${slow ? C.charcoal : C.white};color:${slow ? C.white : C.ink3}">Slow</span>
  <span style="font-size:8px;letter-spacing:0.10em;text-transform:uppercase;padding:8px 10px;border:1px solid ${fast ? C.redBorder : C.ink4};background:${fast ? C.redBg : C.white};color:${fast ? C.redText : C.ink3}">Fast</span>
</div>`;
}

function renderSeats(block, table) {
  const b   = block || {};
  const showPairing      = b.showPairing      !== false;
  const showRestrictions = b.showRestrictions !== false;
  const seats = table.seats || [];
  const restrictions = table.restrictions || [];
  const pLabel = p => p === "Non-Alc" ? "N/A" : p === "Our Story" ? "O.S." : p === "Premium" ? "Prem" : p;

  const chips = seats.map(s => {
    const p     = showPairing && s.pairing && s.pairing !== "—" ? s.pairing : null;
    const sRestr = showRestrictions ? restrictions.filter(r => r.pos === s.id).map(r => r.note) : [];
    const gsMale   = s.gender === "Mr";
    const gsFemale = s.gender === "Mrs";
    const gsHtml   = gsMale
      ? `<span style="font-size:6px;font-weight:700;padding:0 2px;background:${C.maleBg};color:${C.maleText}">Mr</span>`
      : gsFemale
      ? `<span style="font-size:6px;font-weight:700;padding:0 2px;background:${C.femaleBg};color:${C.femaleText}">Mrs</span>`
      : "";
    return `<div style="display:flex;align-items:center;gap:3px">
  <span style="font-size:7px;font-weight:700;padding:2px 5px;background:${C.ink5};color:${C.ink2};border:1px solid ${C.ink4};display:inline-flex;align-items:center;gap:4px">
    P${s.id}${gsHtml}${p ? ` · ${pLabel(p)}` : ""}
  </span>
  ${sRestr.length ? `<span style="font-size:7px;color:${C.redText};font-weight:600">${sRestr.join(" · ")}</span>` : ""}
</div>`;
  }).join("");

  const unassigned = restrictions.filter(r => !r.pos && r.note);
  let unassignedHtml = "";
  if (showRestrictions && unassigned.length) {
    unassignedHtml = `<div style="margin-top:6px;padding-top:6px;border-top:1px solid ${C.ink4};display:flex;gap:5px;flex-wrap:wrap;align-items:center">
      <span style="font-size:7px;letter-spacing:0.12em;color:${C.redText};text-transform:uppercase;flex-shrink:0">⚠ UNASSIGNED</span>
      ${unassigned.map(r => `<span style="font-size:7px;padding:2px 5px;border:1px solid ${C.redBorder};color:${C.redText}">${esc(r.note)}</span>`).join("")}
    </div>`;
  }

  return `
<div style="background:${C.white};border-bottom:1px solid ${C.ink4};padding:5px 10px">
  <div style="display:flex;flex-wrap:wrap;gap:3px 6px">${chips}</div>
  ${unassignedHtml}
</div>`;
}

function renderCourses(block, table, menuCourses) {
  const b   = block || {};
  const showRestrictions = b.showRestrictions !== false;
  const showCourseNotes  = b.showCourseNotes  !== false;
  const restrictions = table.restrictions || [];
  const log          = table.kitchenLog || {};
  const courseNotes  = table.kitchenCourseNotes || {};

  if (!menuCourses.length) {
    return `<div style="padding:14px 10px;font-size:8px;color:${C.ink4};text-align:center;letter-spacing:2px;text-transform:uppercase;border-bottom:1px solid ${C.ink4}">NO COURSES</div>`;
  }

  return menuCourses.map((course, idx) => {
    const key   = course.course_key || `course_${idx}`;
    const fired = !!log[key];
    const name  = course.menu?.name || course.kitchenDisplayName || key;
    const kcNote = courseNotes[key] || {};

    let subLine = "";
    if (!fired) {
      if (showRestrictions && restrictions.some(r => r.pos !== null)) {
        subLine += `<span style="font-size:8px;color:${C.redText};font-weight:600">1× GF mod</span>`;
      }
      if (showCourseNotes && kcNote.note) {
        subLine += `<span style="font-size:8px;color:${C.redText};font-weight:600;margin-left:8px">⚑ ${esc(kcNote.note)}</span>`;
      }
    }

    return `
<div style="border-bottom:1px solid ${C.ink4};background:${fired ? C.greenBg : C.white};border-left:4px solid ${fired ? C.greenBorder : "transparent"}">
  <div style="display:flex;align-items:center;padding:7px 10px 7px 8px;gap:7px">
    <span style="font-size:12px;color:${fired ? C.greenBorder : C.ink4};flex-shrink:0;line-height:1">${fired ? "✓" : "○"}</span>
    <div style="flex:1;min-width:0">
      <div style="font-size:11px;font-weight:700;line-height:1.25;color:${fired ? C.ink4 : C.ink0};text-decoration:${fired ? "line-through" : "none"};letter-spacing:0.02em">${esc(name)}</div>
      ${subLine ? `<div style="margin-top:2px;display:flex;flex-wrap:wrap;gap:2px 8px">${subLine}</div>` : ""}
    </div>
  </div>
</div>`;
  }).join("");
}

function renderUnassigned(block, table) {
  const unassigned = (table.restrictions || []).filter(r => !r.pos && r.note);
  if (!unassigned.length) return "";
  return `
<div style="border-bottom:1px solid ${C.ink4};padding:7px 10px;background:${C.redBg}">
  <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
    <span style="font-size:7px;letter-spacing:0.12em;color:${C.redText};text-transform:uppercase;flex-shrink:0">⚠ UNASSIGNED</span>
    ${unassigned.map(r => `<span style="font-size:7px;padding:2px 6px;border:1px solid ${C.redBorder};color:${C.redText}">${esc(r.note)}</span>`).join("")}
  </div>
</div>`;
}

function renderDivider(block) {
  const b  = block || {};
  const th = b.thickness || 1;
  const co = b.color || C.ink4;
  const mt = b.marginTop    || 0;
  const mb = b.marginBottom || 0;
  return `<hr style="border:none;border-top:${th}px solid ${esc(co)};margin:${mt}px 0 ${mb}px 0">`;
}

function renderText(block) {
  const b  = block || {};
  const fs = b.fontSize || 9;
  const fw = b.bold ? "700" : "400";
  const al = b.align || "left";
  const pd = b.padding != null ? b.padding : 5;
  return `<div style="font-size:${fs}px;font-weight:${fw};text-align:${al};padding:${pd}px 10px;color:${C.ink0}">${esc(b.text || "")}</div>`;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Generate a kitchen ticket preview HTML string.
 *
 * @param {object[]} menuCourses    — courses from the kitchen profile's menuTemplate
 * @param {object}   ticketTemplate — { version: 1, rows: [...] } (the kt_* layout)
 * @returns {string} Complete HTML document for the preview iframe
 */
export function generateKitchenTicketHTML(menuCourses = [], ticketTemplate = null) {
  const table        = { ...SAMPLE_TABLE };
  const rows         = Array.isArray(ticketTemplate?.rows) ? ticketTemplate.rows : [];
  const totalCourses = menuCourses.length;

  let bodyHtml = "";

  if (rows.length === 0) {
    // Fallback: render all standard sections when no template configured
    bodyHtml = [
      renderHeader(null, table, totalCourses),
      renderNotesBanner(null, table),
      renderPaceStrip(null, table),
      renderSeats(null, table),
      renderCourses(null, table, menuCourses),
    ].join("");
  } else {
    for (const row of rows) {
      if (row.gap && row.gap > 0 && !row.left && !row.right) {
        bodyHtml += `<div style="height:${row.gap}px"></div>`;
        continue;
      }
      const block = row.left;
      if (!block) continue;
      switch (block.type) {
        case "kt_header":     bodyHtml += renderHeader(block, table, totalCourses); break;
        case "kt_notes":      bodyHtml += renderNotesBanner(block, table);           break;
        case "kt_pace":       bodyHtml += renderPaceStrip(block, table);             break;
        case "kt_seats":      bodyHtml += renderSeats(block, table);                 break;
        case "kt_courses":    bodyHtml += renderCourses(block, table, menuCourses);  break;
        case "kt_unassigned": bodyHtml += renderUnassigned(block, table);            break;
        case "kt_divider":    bodyHtml += renderDivider(block);                      break;
        case "kt_text":       bodyHtml += renderText(block);                         break;
        default: break;
      }
      if ((row.gap || 0) > 0) bodyHtml += `<div style="height:${row.gap}px"></div>`;
    }
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:260px;background:#fff;font-family:${FONT};-webkit-text-size-adjust:100%}
</style>
</head>
<body>
<div style="border:1px solid #c4c4c4;width:260px;background:#fff;overflow:hidden">
${bodyHtml}
</div>
</body>
</html>`;
}
