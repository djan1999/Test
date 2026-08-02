/**
 * The printed seat menu — one A5 page, rendered from a seat plan.
 *
 * The workspace preview and the print window use THIS function, not two
 * lookalike renderers. The preview is the page itself scaled down, so what the
 * pass sees on screen is what comes out of the printer; a divergence here
 * would mean an operator approving a sheet that prints differently.
 *
 * Substituted and hand-edited courses print bold on purpose: the pass has to
 * spot the odd plate on a stack of sheets without reading every line.
 */

// A5 portrait, in the units the print pipeline already uses elsewhere.
export const PAGE_W_MM = 148;
export const PAGE_H_MM = 210;
/** A5 width in CSS pixels at 96dpi — the preview scales against this. */
export const PAGE_W_PX = (PAGE_W_MM / 25.4) * 96;
export const PAGE_H_PX = (PAGE_H_MM / 25.4) * 96;

const esc = (v) => String(v ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

/** "TITLE · SEAT 2 OF 4 · WINE" — the small-caps line under the wordmark. */
export function seatSubtitle(plan) {
  const seatLabel = plan?.lang === "si"
    ? `SEDEŽ ${plan?.seatNumber} OD ${plan?.seatCount}`
    : `SEAT ${plan?.seatNumber} OF ${plan?.seatCount}`;
  return [plan?.menuTitle, seatLabel, plan?.pairingSetLabel]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" · ");
}

const courseHtml = (course) => {
  // Bold marks a plate that differs from the master menu — a substitution the
  // engine made, or a one-time edit the operator typed for this seat.
  const flagged = course.substituted || course.edited;
  const cls = flagged ? "course flagged" : "course";
  const sub = course.sub ? `<div class="dish-sub">${esc(course.sub)}</div>` : "";
  const pairing = course.pairing ? `<div class="pairing">${esc(course.pairing)}</div>` : "";
  return `<div class="${cls}"><div class="dish">${esc(course.name)}</div>${sub}${pairing}</div>`;
};

/** Full standalone HTML document for one seat's printed menu. */
export function renderSeatMenuHTML(plan) {
  const courses = (plan?.courses || []).map(courseHtml).join("");
  const aperitif = plan?.aperitif
    ? `<div class="aperitif">${esc(plan.aperitif)}</div>`
    : "";
  const thankYou = plan?.thankYou
    ? `<div class="thankyou">${esc(plan.thankYou)}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="${plan?.lang === "si" ? "sl" : "en"}">
<head>
<meta charset="UTF-8">
<title>${esc(seatSubtitle(plan))}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
@page{size:A5 portrait;margin:0;}
html,body{width:${PAGE_W_MM}mm;height:${PAGE_H_MM}mm;background:#fff;color:#0a0a0a;
  font-family:'Roboto Mono','JetBrains Mono',monospace;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
#page{width:${PAGE_W_MM}mm;height:${PAGE_H_MM}mm;padding:16mm 14mm;display:flex;flex-direction:column;overflow:hidden;}
#wordmark{font-size:13pt;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;text-align:center;}
#subtitle{margin-top:3mm;font-size:6.4pt;font-weight:400;letter-spacing:0.18em;text-transform:uppercase;
  text-align:center;color:#4a4a4a;}
#rule{margin:5mm 0 7mm;border-top:0.5pt solid #c4c4c4;}
#courses{flex:1;display:flex;flex-direction:column;gap:5.5mm;}
.course{text-align:center;}
.dish{font-size:8.2pt;font-weight:400;letter-spacing:0.05em;text-transform:uppercase;line-height:1.25;
  overflow-wrap:anywhere;}
.course.flagged .dish{font-weight:700;}
.dish-sub{margin-top:1mm;font-size:7pt;line-height:1.3;overflow-wrap:anywhere;}
.course.flagged .dish-sub{font-weight:700;}
.pairing{margin-top:1.4mm;font-size:6.2pt;letter-spacing:0.06em;color:#8a8a8a;line-height:1.3;
  overflow-wrap:anywhere;}
.aperitif{margin-top:6mm;text-align:center;font-size:6.6pt;letter-spacing:0.14em;text-transform:uppercase;
  color:#4a4a4a;}
.thankyou{margin-top:7mm;text-align:center;font-size:7pt;letter-spacing:0.04em;}
</style>
</head>
<body>
<div id="page">
  <div id="wordmark">${esc(plan?.wordmark || "")}</div>
  <div id="subtitle">${esc(seatSubtitle(plan))}</div>
  <div id="rule"></div>
  <div id="courses">${courses}</div>
  ${aperitif}
  ${thankYou}
</div>
</body>
</html>`;
}

/**
 * Send one seat's page to the printer.
 *
 * Returns false when the browser blocked the pop-up, so the caller can tell
 * the operator the sheet did NOT go out rather than showing a success toast
 * for a print that never happened.
 */
export function printSeatMenu(plan) {
  const win = window.open("", "_blank", "width=620,height=880");
  if (!win) return false;
  win.document.write(renderSeatMenuHTML(plan));
  win.document.close();
  win.focus();
  // The webfont has to land before the page is measured, otherwise the first
  // sheet prints in the fallback monospace at a different metric.
  setTimeout(() => win.print(), 600);
  return true;
}
