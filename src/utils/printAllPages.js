/**
 * Combine several generateMenuHTML documents into ONE printable document —
 * one A5 page per seat.
 *
 * PRINT ALL used to open one pop-up per seat on a stagger. Browsers only
 * trust the window.open that happens inside the click gesture, so seats 2..n
 * were routinely eaten by the pop-up blocker, and even the happy path meant
 * n separate print dialogs. One combined document is one window (always
 * gesture-blessed), one dialog, and the printer collates the whole table.
 *
 * The input documents all come from the same engine call shape (same
 * template, layoutStyles, fonts) and differ only in body content, so the
 * first document's <head> assets are the shared assets. We do NOT re-render
 * anything here — each page is the engine's own markup, verbatim.
 */

const STYLE_RE = /<style>([\s\S]*?)<\/style>/;
const LINK_RE = /<link\b[^>]*>/g;
const BODY_RE = /<body>([\s\S]*?)<\/body>/;
const SCRIPT_RE = /<script>[\s\S]*?<\/script>/g;
const MIN_SCALE_RE = /const MIN_SCALE = ([\d.]+)/;

const esc = (v) => String(v ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

/** The engine page's body markup with its per-page fit script stripped. */
const pageContentOf = (doc) => {
  const body = BODY_RE.exec(doc || "")?.[1] || "";
  return body.replace(SCRIPT_RE, "").trim();
};

/**
 * Build the combined document. `docs` are full HTML strings from
 * generateMenuHTML, in print order. Returns null when there is nothing
 * printable so callers can refuse instead of printing an empty page.
 */
export function combineMenuPages(docs, { title = "Menus" } = {}) {
  const pages = (docs || []).map(pageContentOf).filter(Boolean);
  if (pages.length === 0) return null;

  const first = docs.find((d) => d && BODY_RE.test(d)) || "";
  const style = STYLE_RE.exec(first)?.[1] || "";
  const links = (first.match(LINK_RE) || []).join("\n");
  const minScale = Number(MIN_SCALE_RE.exec(first)?.[1]) || 0.58;

  // The engine styles a single fixed-height page (html,body locked to
  // 148×210mm, overflow hidden). For n pages the wrapper carries the page
  // box instead, and each page breaks to its own sheet.
  const multiPageStyle = `
html,body{height:auto;overflow:visible;}
.print-page{width:148mm;height:210mm;overflow:hidden;position:relative;page-break-after:always;break-after:page;}
.print-page:last-child{page-break-after:auto;break-after:auto;}`;

  const pagesHtml = pages
    .map((content) => `<div class="print-page">${content}</div>`)
    .join("\n");

  // Same fit algorithm as the engine's single-page script, run once per page.
  // Duplicate ids across pages are resolved by scoping every lookup to its
  // own sheet — getElementById would only ever see the first page.
  const fitScript = `
(function(){
  const MIN_SCALE = ${minScale};
  const MAX_TRIES = 80;
  function fitSheet(sheet){
    const frame = sheet.querySelector('[id="frame"]');
    const target = sheet.querySelector('[id="scaleTarget"]');
    if (!frame || !target) return;
    target.style.transform = 'scale(1)';
    target.style.width = '100%';
    const maxH = frame.clientHeight;
    const maxW = frame.clientWidth;
    let scale = Math.min(1, maxH / target.scrollHeight, maxW / target.scrollWidth);
    scale = Math.max(Math.min(scale, 1), MIN_SCALE);
    let tries = 0;
    while (tries < MAX_TRIES) {
      target.style.transform = 'scale(' + scale + ')';
      target.style.width = (100 / scale) + '%';
      const rect = target.getBoundingClientRect();
      if (rect.height <= maxH - 1 && rect.width <= maxW - 1) break;
      scale -= 0.01;
      if (scale <= MIN_SCALE) {
        scale = MIN_SCALE;
        target.style.transform = 'scale(' + scale + ')';
        target.style.width = (100 / scale) + '%';
        break;
      }
      tries += 1;
    }
  }
  function fitAll(){ document.querySelectorAll('[id="sheet"]').forEach(fitSheet); }
  window.addEventListener('load', function(){ setTimeout(fitAll, 80); });
  window.addEventListener('resize', fitAll);
  window.addEventListener('beforeprint', fitAll);
  window.addEventListener('afterprint', fitAll);
})();`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
${links}
<style>
${style}
${multiPageStyle}
</style>
</head>
<body>
${pagesHtml}
<script>${fitScript}</script>
</body>
</html>`;
}
