/**
 * generateMenuHTML — pure HTML string generator for the A5 seat menu PDF.
 *
 * Extracted from App.jsx so it can be imported and unit-tested without
 * pulling in React, Supabase, or dnd-kit.
 */

import { applyCourseRestriction } from "./menuUtils.js";

export const COUNTRY_NAMES = {
  FR: "France", IT: "Italy", ES: "Spain", DE: "Germany", AT: "Austria",
  SI: "Slovenia", PT: "Portugal", GR: "Greece", HU: "Hungary", HR: "Croatia",
  CH: "Switzerland", GE: "Georgia", RO: "Romania", BG: "Bulgaria", RS: "Serbia",
  CZ: "Czech Republic", SK: "Slovakia", MD: "Moldova", AM: "Armenia",
  US: "USA", AR: "Argentina", CL: "Chile", AU: "Australia", NZ: "New Zealand",
  ZA: "South Africa", UY: "Uruguay",
};

const esc = (v) => String(v ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

export function generateMenuHTML({
  seat,
  table,
  menuTitle = "WINTER MENU",
  teamNames = "",
  menuCourses = [],
  beerChoice = null,
  lang = "en",
  seatOutputOverrides = {},
  thankYouNote = "Thank you for your visit.",
  layoutStyles = {},
  // Font/logo assets — empty strings are fine for tests (no rendering needed)
  _fontBold = "",
  _fontReg = "",
  _logo = "",
}) {
  const s = (key, def) => key in layoutStyles ? layoutStyles[key] : def;
  const PAIRING_MAP = { "Wine": "wp", "Non-Alc": "na", "Our Story": "os", "Premium": "premium" };
  const PAIRING_LABELS = lang === "si"
    ? { wp: "VINSKA SPREMLJAVA", na: "BREZALKOHOLNA SPREMLJAVA", os: "OUR STORY SPREMLJAVA", premium: "PREMIUM SPREMLJAVA" }
    : { wp: "WINE PAIRING", na: "NON-ALCO PAIRING", os: "OUR STORY PAIRING", premium: "PREMIUM PAIRING" };
  // For SI menus, swap menu_si into the menu field so applyCourseRestriction uses the right base
  const resolveCourse = (course) =>
    (lang === "si" && course.menu_si?.name) ? { ...course, menu: course.menu_si } : course;

  const seatId = seat.id;
  const pairingLabel = seat.pairing === "—" ? "" : (seat.pairing || "");
  const pkey = PAIRING_MAP[pairingLabel] || null;

  const restrictions = (table.restrictions || []).filter(r => !r.pos || r.pos === seatId).map(r => r.note);
  const isShort = String(table.menuType || "").toLowerCase() === "short";

  const extras = seat.extras || {};
  const hasBeetroot = !!extras[1]?.ordered;
  const hasCheese   = !!extras[2]?.ordered;
  const hasCake     = !!(table.birthday || extras[3]?.ordered);

  const glasses = Array.isArray(seat.glasses)
    ? seat.glasses.filter(w => w && (w.name || w.producer || w.vintage || w.notes))
    : [];
  const cocktails = Array.isArray(seat.cocktails)
    ? seat.cocktails.filter(c => c && (c.name || c.notes))
    : [];
  const beers = Array.isArray(seat.beers)
    ? seat.beers.filter(b => b && (b.name || b.notes))
    : [];
  const tableBottles = Array.isArray(table.bottleWines)
    ? table.bottleWines.filter(w => w && (w.name || w.producer || w.vintage || w.notes))
    : [];

  const CRAYFISH_IDX = 4;
  const DANUBE_SALMON_IDX = 5;
  const PAIRING_INSERT_IDX = DANUBE_SALMON_IDX;

  const fmtWineParts = w => {
    const rawVintage = String(w?.vintage || "").trim();
    const vintage = rawVintage.match(/^\d{4}$/) ? `'${rawVintage.slice(2)}` : rawVintage;
    const title = [w?.producer, w?.name, vintage].filter(Boolean).join(" ");
    const rawCountry = w?.country || "";
    const country = COUNTRY_NAMES[rawCountry] || rawCountry;
    const region = (w?.region || "").replace(new RegExp(`,?\\s*${rawCountry}$`), "").trim();
    const subParts = [region, country].filter(Boolean);
    return {
      title: title || "",
      sub: subParts.join(", ") || w?.notes || "",
    };
  };

  const fmtDrinkParts = item => {
    if (!item) return { title: "", sub: "" };
    const type = item.__type || item.type || item.category || "";
    if (type === "cocktail" || type === "beer") return { title: item.name || "", sub: item.notes || "" };
    return fmtWineParts(item);
  };

  const selectedBeer = (() => {
    if (beers.length === 0) {
      return beerChoice === "nonalc"
        ? { title: "SPENT BREAD KOMBUCHA", sub: "malt, hops" }
        : { title: "Reservoir Dogs, Crazy Sister", sub: "Nova Gorica, Slovenia" };
    }
    const chosen = beers.find(b => {
      const hay = `${b?.name || ""} ${b?.notes || ""}`.toLowerCase();
      const isNA = hay.includes("0.0") || hay.includes("non") || hay.includes("zero") || hay.includes("free") || hay.includes("n/a") || hay.startsWith("na");
      return beerChoice === "nonalc" ? isNA : !isNA;
    }) || beers[0];
    return fmtDrinkParts({ ...chosen, __type: "beer" });
  })();

  const normalizeToken = (value) => String(value || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const isTruthyShort = (value) => {
    const v = String(value ?? "").trim().toLowerCase();
    return v === "true" || v === "1" || v === "yes" || v === "y" || v === "x" || v === "wahr";
  };

  const visibleCourses = [];
  menuCourses.forEach((course, i) => {
    const courseKey = normalizeToken(course?.course_key || course?.key || course?.menu?.name);
    const courseName = String(course?.menu?.name || "").trim().toUpperCase();
    const courseNameKey = normalizeToken(course?.menu?.name || "");
    const optionalFlag = normalizeToken(course?.optional_flag || "");

    const isBeetrootCourse = optionalFlag === "beetroot" || courseKey === "beetroot" || courseNameKey === "beetroot";
    const isCakeCourse = optionalFlag === "cake" || courseKey === "pear" || courseKey === "pear_cake" || courseNameKey === "pear";
    const isCheeseExtraCourse = optionalFlag === "cheese" || courseKey === "cheese" || courseNameKey === "cheese";

    if (isBeetrootCourse && !hasBeetroot) return;
    if (isCakeCourse && !hasCake) return;
    if (isCheeseExtraCourse && !hasCheese) return;

    if (isShort) {
      if (!isTruthyShort(course?.show_on_short)) return;
      const rank = Number(course?.short_order) || 9999;
      visibleCourses.push({ course, i, courseName, courseKey, optionalFlag, orderValue: rank });
      return;
    }

    visibleCourses.push({
      course,
      i,
      courseName,
      courseKey,
      optionalFlag,
      orderValue: Number(course.position) || i + 1,
    });
  });
  visibleCourses.sort((a, b) => a.orderValue - b.orderValue);

  const rows = [];
  const hasPairing = !!pkey;
  const bottleQueue = hasPairing ? [] : [...tableBottles];
  const aperitivoQueue = [
    ...cocktails.map(c => ({ ...c, __type: "cocktail" })),
    ...(hasPairing ? glasses.map(w => ({ ...w, __type: "wine" })) : []),
  ];
  const glassByGlassQueue = hasPairing ? [] : [...glasses.map(w => ({ ...w, __type: "wine" }))];

  const topRightItems = hasPairing ? [
    ...tableBottles.map(item => ({
      ...item,
      __type: item?.__type || item?.type || item?.category || ((item?.notes && !item?.producer && !item?.vintage) ? "cocktail" : "wine"),
    })),
  ] : [];
  topRightItems.forEach(item => rows.push({ type: "wine-only", right: fmtDrinkParts(item) }));

  let insertedPairingLabel = false;
  let courseRowsSeen = 0;

  visibleCourses.forEach(({ course, i, courseName, courseKey, optionalFlag }) => {
    const insertPairingHere = hasPairing && !insertedPairingLabel && (
      (!isShort && i === PAIRING_INSERT_IDX) ||
      (isShort && courseRowsSeen === 0)
    );
    if (insertPairingHere) {
      rows.push({ type: "section", label: PAIRING_LABELS[pkey] || "PAIRING" });
      insertedPairingLabel = true;
    }

    let dish = applyCourseRestriction(resolveCourse(course), restrictions, lang);
    let drink = pkey ? (lang === "si" ? (course[`${pkey}_si`] || course[pkey]) : course[pkey]) : null;

    if (pkey && (course.force_pairing_title || courseKey === "crayfish" || i === CRAYFISH_IDX)) {
      const fpName = (lang === "si" && course.force_pairing_title_si) ? course.force_pairing_title_si : (course.force_pairing_title || "KITCHEN MARTINI");
      const fpSub  = (lang === "si" && course.force_pairing_sub_si)   ? course.force_pairing_sub_si   : (course.force_pairing_sub   || "");
      drink = { name: fpName, sub: fpSub };
    }

    const beetrootExtra = extras[1];
    const isBeetrootOptionalCourse = optionalFlag === "beetroot" || courseKey === "beetroot" || courseName === "BEETROOT";
    if (isBeetrootOptionalCourse && beetrootExtra?.ordered) {
      const beetPair = String(beetrootExtra.pairing || "—").trim();
      if (beetPair === "N/A" || beetPair === "Non-Alc") {
        const naVariant = lang === "si" ? (course.na_si || course.na) : course.na;
        drink = naVariant || null;
      } else if (beetPair === "Champagne" || beetPair === "Wine") {
        drink = (lang === "si"
          ? (course.os_si || course.os || course.premium_si || course.premium || course.wp_si || course.wp)
          : (course.os || course.premium || course.wp)) || null;
      } else {
        drink = null;
      }
    }

    if ((courseKey === "chicken_gizzard" || courseName === "CHICKEN GIZZARD") && selectedBeer) {
      if (lang === "si" && beers.length === 0) {
        const siKey = beerChoice === "nonalc" ? "na" : "wp";
        const siDrink = course[`${siKey}_si`] || course[siKey];
        drink = siDrink ? { name: siDrink.name || "", sub: siDrink.sub || "" } : { name: selectedBeer.title || "", sub: selectedBeer.sub || "" };
      } else {
        drink = { name: selectedBeer.title || "", sub: selectedBeer.sub || "" };
      }
    } else if (!drink && aperitivoQueue.length > 0) {
      const d = fmtDrinkParts(aperitivoQueue.shift());
      drink = { name: d.title || "", sub: d.sub || "" };
    } else if (i >= DANUBE_SALMON_IDX && glassByGlassQueue.length > 0) {
      const d = fmtDrinkParts(glassByGlassQueue.shift());
      drink = { name: d.title || "", sub: d.sub || "" };
    } else if (!hasPairing && i >= DANUBE_SALMON_IDX && bottleQueue.length > 0) {
      const nextBottle = bottleQueue.shift();
      const d = fmtDrinkParts(nextBottle);
      drink = { name: d.title || "", sub: d.sub || "" };
    }

    const outputOv = seatOutputOverrides[courseKey];
    if (outputOv) {
      if (typeof outputOv.name === "string") dish = { ...(dish || {}), name: outputOv.name };
      if (typeof outputOv.sub  === "string") dish = { ...(dish || {}), sub:  outputOv.sub  };
    }

    rows.push({
      type: "course",
      left: { title: dish?.name || "", sub: dish?.sub || "" },
      right: drink ? { title: drink.name || "", sub: drink.sub || "" } : null,
      rowClass: [
        (hasPairing && (courseKey === "crayfish" || i === CRAYFISH_IDX)) ? "after-crayfish" : "",
        (isShort && (courseKey === "trout_belly" || courseName === "TROUT BELLY")) ? "short-after-trout-belly" : "",
        (isShort && (courseKey === "venison" || courseName === "VENISON")) ? "short-after-venison" : "",
        course.section_gap_before ? "section-gap-before" : "",
      ].filter(Boolean).join(" "),
    });
    courseRowsSeen += 1;
  });

  while (aperitivoQueue.length > 0) {
    rows.push({ type: "wine-only", right: fmtDrinkParts(aperitivoQueue.shift()) });
  }
  while (glassByGlassQueue.length > 0) {
    rows.push({ type: "wine-only", right: fmtDrinkParts(glassByGlassQueue.shift()) });
  }
  while (!hasPairing && bottleQueue.length > 0) {
    const d = fmtDrinkParts(bottleQueue.shift());
    rows.push({ type: "wine-only", right: d });
  }

  if (hasPairing && !insertedPairingLabel) {
    rows.unshift({ type: "section", label: PAIRING_LABELS[pkey] || "PAIRING" });
  }

  rows.push({ type: "thankyou" });

  const renderBlock = (block, cls = "") => {
    if (!block || (!block.title && !block.sub)) return `<div class="menu-col ${cls}"></div>`;
    return `<div class="menu-col ${cls}">
      ${block.title ? `<div class="menu-main">${esc(block.title)}</div>` : ""}
      ${block.sub ? `<div class="menu-sub">${esc(block.sub)}</div>` : ""}
    </div>`;
  };

  const rowsHtml = rows.map(row => {
    if (row.type === "section") {
      return `<div class="menu-section-row pairing-section"><div></div><div class="menu-section-label">${esc(row.label)}</div></div>`;
    }
    if (row.type === "wine-only") {
      return `<div class="menu-row wine-only">${renderBlock(null, "left")}${renderBlock(row.right, "right")}</div>`;
    }
    if (row.type === "thankyou") {
      return `<div class="menu-thankyou">${esc(thankYouNote)}</div>`;
    }
    return `<div class="menu-row ${row.rowClass || ""}">${renderBlock(row.left, "left")}${renderBlock(row.right, "right")}</div>`;
  }).join("");

  const safeTitle = esc((menuTitle || "WINTER MENU").replace(/\s+/g, " ").trim());

  const _today = new Date();
  const _d = _today.getDate();
  const _MONTHS_EN = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const _MONTHS_SI = ["Januar","Februar","Marec","April","Maj","Junij","Julij","Avgust","September","Oktober","November","December"];
  const menuDate = lang === "si"
    ? `${_d}. ${_MONTHS_SI[_today.getMonth()]} ${_today.getFullYear()}`
    : (() => { const _suffix = [11,12,13].includes(_d) ? "th" : _d%10===1 ? "st" : _d%10===2 ? "nd" : _d%10===3 ? "rd" : "th"; return `${_d}${_suffix} of ${_MONTHS_EN[_today.getMonth()]}, ${_today.getFullYear()}`; })();

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${safeTitle}</title>
<style>
@font-face{font-family:'RM';font-weight:700;src:url('data:font/truetype;base64,${_fontBold}') format('truetype');}
@font-face{font-family:'RM';font-weight:400;src:url('data:font/truetype;base64,${_fontReg}') format('truetype');}
*{margin:0;padding:0;box-sizing:border-box;}
:root{--page-w:148mm;--page-h:210mm;--pad-t:${s("padTop",8.4)}mm;--pad-r:${s("padRight",12)}mm;--pad-b:${s("padBottom",8.2)}mm;--pad-l:${s("padLeft",12)}mm;--inner-h:calc(var(--page-h) - var(--pad-t) - var(--pad-b));}
@page{size:A5 portrait;margin:0;}
html,body{width:var(--page-w);height:var(--page-h);overflow:hidden;background:#fff;color:#000;font-family:'RM', monospace;font-size:${s("fontSize",6.75)}pt;line-height:1.08;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
body{position:relative;}
#sheet{width:var(--page-w);height:var(--page-h);overflow:hidden;position:relative;background:#fff;}
#frame{position:absolute;inset:0;padding:var(--pad-t) var(--pad-r) var(--pad-b) var(--pad-l);overflow:hidden;}
#scaleTarget{width:100%;min-height:var(--inner-h);display:flex;flex-direction:column;transform-origin:top left;}
#header{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;column-gap:8.6mm;margin-bottom:${s("headerSpacing",7)}mm;}
#title{font-size:13.9pt;font-weight:700;letter-spacing:0.035em;}
#menu-date{font-size:5.8pt;font-weight:400;letter-spacing:0.02em;margin-top:0.8mm;}
#logo img{width:${s("logoSize",18.2)}mm;display:block;}
#menu{width:100%;}
.menu-row,.menu-section-row{display:grid;grid-template-columns:minmax(0,${hasPairing ? "0.85fr) minmax(0,1.15fr" : "1fr) minmax(0,1fr"});column-gap:${hasPairing ? "9mm" : "10.8mm"};align-items:start;break-inside:avoid;page-break-inside:avoid;}
.menu-row{margin-bottom:${s("rowSpacing",3.15)}pt;}
.menu-row.wine-only{margin-bottom:${s("wineRowSpacing",4.5)}pt;}
.menu-row.after-crayfish{margin-bottom:7.2pt;}
.menu-row.short-after-trout-belly,.menu-row.short-after-venison{margin-bottom:10pt;}
.menu-row.section-gap-before{margin-top:14.5pt;}
.menu-col{min-width:0;}
.menu-main{font-weight:700;line-height:1.02;letter-spacing:0.012em;overflow-wrap:anywhere;text-transform:uppercase;}
.menu-sub{line-height:1.08;margin-top:0.75pt;overflow-wrap:anywhere;}
.menu-section-row{margin:${s("sectionSpacing",6.8)}pt 0 ${(s("sectionSpacing",6.8)-0.6).toFixed(2)}pt;}
.menu-section-label{font-weight:700;letter-spacing:0.042em;padding-top:0.6pt;text-transform:uppercase;}
.menu-thankyou{margin-top:${s("thankYouSpacing",7)}pt;font-size:6.55pt;font-style:normal;font-family:'RM',monospace;}
#footer{margin-top:auto;padding-top:9.5pt;}
#team{font-size:6.5pt;line-height:1.2;overflow-wrap:anywhere;}
#team .menu-main{margin-bottom:1.4pt;}
</style>
</head>
<body>
<div id="sheet"><div id="frame"><div id="scaleTarget"><div id="header"><div id="title">${safeTitle}<div id="menu-date">${esc(menuDate)}</div></div>${_logo ? `<div id="logo"><img src="${_logo}" alt="Milka"></div>` : `<div id="logo"></div>`}</div><div id="menu">${rowsHtml}</div><div id="footer"><div id="team"><div class="menu-main">TEAM:</div><div>${esc(teamNames)}</div></div></div></div></div></div>
<script>
(function(){
  const MIN_SCALE = 0.58;
  const MAX_TRIES = 80;
  function fitOnePage(){
    const frame = document.getElementById('frame');
    const target = document.getElementById('scaleTarget');
    if (!frame || !target) return;
    target.style.transform = 'scale(1)';
    target.style.width = '100%';
    const maxH = frame.clientHeight;
    const maxW = frame.clientWidth;
    const naturalH = target.scrollHeight;
    const naturalW = target.scrollWidth;
    let scale = Math.min(1, maxH / naturalH, maxW / naturalW);
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
  window.addEventListener('load', function(){ setTimeout(fitOnePage, 80); });
  window.addEventListener('resize', fitOnePage);
  window.addEventListener('beforeprint', fitOnePage);
  window.addEventListener('afterprint', fitOnePage);
})();
</script>
</body>
</html>`;
}
