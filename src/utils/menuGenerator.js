/**
 * generateMenuHTML — pure HTML string generator for the A5 seat menu.
 *
 * Single rendering pipeline: template-driven v2 only.
 * Auto-migrates to v2 when no template is stored yet by calling
 * buildDefaultTemplate(menuCourses).
 *
 * Legacy row-builder path has been removed. Everything is driven by
 * the menu_layout_v2 template structure.
 */

import { applyCourseRestriction } from "./menuUtils.js";
import { buildDefaultTemplate, parseWidthPreset } from "./menuTemplateSchema.js";

export const DEFAULT_MENU_RULES = {
  preservePairingLabelSpacingWithoutPairing: true,
  preserveCourseSectionGapFallback: true,
  sectionGapFallbackPt: 14.5,
  forceCrayfishPairing: true,
  forceChickenGizzardBeer: true,
  forcePairingCourseKeys: ["crayfish"],
  forceBeerCourseKeys: ["chicken_gizzard"],
  crayfishFallbackTitleEn: "KITCHEN MARTINI",
  crayfishFallbackTitleSi: "KITCHEN MARTINI",
  crayfishFallbackSubEn: "",
  crayfishFallbackSubSi: "",
};

const normalizeCourseToken = (value) => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/&/g, "and")
  .replace(/[^a-z0-9]+/g, "_")
  .replace(/^_+|_+$/g, "");

const normalizeRuleKeyList = (value, fallback = []) => {
  const rawList = (() => {
    if (Array.isArray(value)) return value;
    if (typeof value === "string") return value.split(/[\n,]+/g);
    if (value && typeof value === "object") return Object.keys(value).filter(k => value[k]);
    return fallback;
  })();
  const out = [];
  const seen = new Set();
  (rawList || []).forEach(item => {
    const token = normalizeCourseToken(item);
    if (!token || seen.has(token)) return;
    seen.add(token);
    out.push(token);
  });
  return out;
};

export function normalizeMenuRules(input = {}) {
  const merged = { ...DEFAULT_MENU_RULES, ...(input || {}) };
  const firstDefined = (...vals) => vals.find(v => v !== undefined);
  const boolWithDefault = (value, fallback = true) => {
    if (value === undefined || value === null) return fallback;
    if (typeof value === "string") return value.trim().toLowerCase() !== "false";
    return value !== false;
  };
  const preservePairingFlag = firstDefined(
    merged.preservePairingLabelSpacingWithoutPairing,
    merged.preservePairingSectionGapWhenNoPairing,
    merged.preservePairingLabelGapWithoutPairing
  );
  const preserveCourseGapFlag = firstDefined(
    merged.preserveCourseSectionGapFallback,
    merged.useCourseSectionGapFallback,
    merged.applyCourseSectionGapFallback
  );
  const sectionGapValue = firstDefined(
    merged.sectionGapFallbackPt,
    merged.sectionGapPt
  );
  const forceCrayfishFlag = firstDefined(
    merged.forceCrayfishPairing,
    merged.forceCrayfishPairingAlways
  );
  const forceGizzardBeerFlag = firstDefined(
    merged.forceChickenGizzardBeer,
    merged.forceBeerOnChickenGizzard
  );
  const forcedPairingKeys = normalizeRuleKeyList(
    firstDefined(
      merged.forcePairingCourseKeys,
      merged.forcePairingCourseKey,
      merged.forceCrayfishCourseKeys,
      merged.forceCrayfishCourseKey
    ),
    DEFAULT_MENU_RULES.forcePairingCourseKeys
  );
  const forcedBeerKeys = normalizeRuleKeyList(
    firstDefined(
      merged.forceBeerCourseKeys,
      merged.forceBeerCourseKey,
      merged.forceChickenGizzardCourseKeys,
      merged.forceChickenGizzardCourseKey
    ),
    DEFAULT_MENU_RULES.forceBeerCourseKeys
  );
  return {
    preservePairingLabelSpacingWithoutPairing: boolWithDefault(preservePairingFlag, true),
    preserveCourseSectionGapFallback: boolWithDefault(preserveCourseGapFlag, true),
    sectionGapFallbackPt: (() => {
      const n = Number(sectionGapValue);
      return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MENU_RULES.sectionGapFallbackPt;
    })(),
    forceCrayfishPairing: boolWithDefault(forceCrayfishFlag, true),
    forceChickenGizzardBeer: boolWithDefault(forceGizzardBeerFlag, true),
    forcePairingCourseKeys: forcedPairingKeys,
    forceBeerCourseKeys: forcedBeerKeys,
    crayfishFallbackTitleEn: String(firstDefined(merged.crayfishFallbackTitleEn, DEFAULT_MENU_RULES.crayfishFallbackTitleEn) || DEFAULT_MENU_RULES.crayfishFallbackTitleEn),
    crayfishFallbackTitleSi: String(firstDefined(merged.crayfishFallbackTitleSi, DEFAULT_MENU_RULES.crayfishFallbackTitleSi) || DEFAULT_MENU_RULES.crayfishFallbackTitleSi),
    crayfishFallbackSubEn: String(firstDefined(merged.crayfishFallbackSubEn, DEFAULT_MENU_RULES.crayfishFallbackSubEn) || ""),
    crayfishFallbackSubSi: String(firstDefined(merged.crayfishFallbackSubSi, DEFAULT_MENU_RULES.crayfishFallbackSubSi) || ""),
  };
}


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
  thankYouNote = "Hvala za vaš obisk.",
  layoutStyles = {},
  // Template v2 — when provided, drives the row order / block resolution.
  // When null/absent, auto-migrated from menuCourses via buildDefaultTemplate().
  menuTemplate = null,
  menuRules = DEFAULT_MENU_RULES,
  // Font/logo assets
  _fontBold = "",
  _fontReg = "",
  _logo = "",
  _rowsOnly = false,
}) {
  const s = (key, def) => key in layoutStyles ? layoutStyles[key] : def;
  const rules = normalizeMenuRules(menuRules);

  const PAIRING_MAP = { "Wine": "wp", "Non-Alc": "na", "Our Story": "os", "Premium": "premium" };
  const PAIRING_LABELS = lang === "si"
    ? { wp: "VINSKA SPREMLJAVA", na: "BREZALKOHOLNA SPREMLJAVA", os: "OUR STORY SPREMLJAVA", premium: "PREMIUM VINSKA SPREMLJAVA" }
    : { wp: "WINE PAIRING", na: "NON-ALCO PAIRING", os: "OUR STORY PAIRING", premium: "PREMIUM WINE PAIRING" };

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

  // Aperitifs: dedicated row above first course
  const aperitifs = Array.isArray(seat.aperitifs)
    ? seat.aperitifs.filter(x => x && (x.name || x.producer || x.notes))
    : [];
  // By-the-glass wines: from Danube Salmon row onwards
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

  const DANUBE_SALMON_KEY = "danube_salmon";

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
    if (type === "cocktail" || type === "beer") {
      const nameLines  = (item.name  || "").split("\n").map(s => s.trim());
      const notesLines = (item.notes || "").split("\n").map(s => s.trim());
      const title = lang === "si" ? (nameLines[1]  || nameLines[0]  || "") : (nameLines[0]  || "");
      const sub   = lang === "si" ? (notesLines[1] || notesLines[0] || "") : (notesLines[0] || "");
      return { title, sub };
    }
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

  const resolveBeerDrinkForCourse = (course) => {
    if (!selectedBeer) return null;
    // If we don't have explicit beer objects and we're rendering SI,
    // prefer SI pairing labels from the course for natural language output.
    if (lang === "si" && beers.length === 0) {
      const siK = beerChoice === "nonalc" ? "na" : "wp";
      const siD = course?.[`${siK}_si`] || course?.[siK];
      if (siD?.name || siD?.sub) return { name: siD.name || "", sub: siD.sub || "" };
    }
    return { name: selectedBeer.title || "", sub: selectedBeer.sub || "" };
  };

  const resolveForcedPairingDrink = (course, rawCourseKey, normKey) => {
    const hasExplicitForcePairing =
      !!String(course?.force_pairing_title || "").trim() ||
      !!String(course?.force_pairing_sub || "").trim() ||
      !!String(course?.force_pairing_title_si || "").trim() ||
      !!String(course?.force_pairing_sub_si || "").trim();
    const rawKeyNorm = normalizeCourseToken(rawCourseKey);
    const isForcedPairingCourse = rules.forcePairingCourseKeys.includes(normKey) || rules.forcePairingCourseKeys.includes(rawKeyNorm);
    if (!(hasExplicitForcePairing || (rules.forceCrayfishPairing && isForcedPairingCourse))) return null;
    const fpTLines = String(course?.force_pairing_title || "").split("\n").map(s => s.trim());
    const fpSLines = String(course?.force_pairing_sub   || "").split("\n").map(s => s.trim());
    const fpTEn = fpTLines[0] || rules.crayfishFallbackTitleEn || "KITCHEN MARTINI";
    const fpTSi = course?.force_pairing_title_si || fpTLines[1] || fpTEn;
    const fpSEn = fpSLines[0] || rules.crayfishFallbackSubEn || "";
    const fpSSi = course?.force_pairing_sub_si   || fpSLines[1] || rules.crayfishFallbackSubSi || fpSEn;
    return lang === "si" ? { name: fpTSi, sub: fpSSi } : { name: fpTEn, sub: fpSEn };
  };

  const isTruthyShort = (value) => {
    const v = String(value ?? "").trim().toLowerCase();
    return v === "true" || v === "1" || v === "yes" || v === "y" || v === "x" || v === "wahr";
  };

  // ── Build visibleCourses (filtered and sorted) ────────────────────────────
  const visibleCourses = [];
  menuCourses.forEach((course, i) => {
    const courseKey = normalizeCourseToken(course?.course_key || course?.key || course?.menu?.name);
    const courseName = String(course?.menu?.name || "").trim().toUpperCase();
    const optionalFlag = normalizeCourseToken(course?.optional_flag || "");

    const isBeetrootCourse = optionalFlag === "beetroot" || courseKey === "beetroot";
    const isCakeCourse = optionalFlag === "cake" || courseKey === "pear" || courseKey === "pear_cake";
    const isCheeseExtraCourse = optionalFlag === "cheese" || courseKey === "cheese";

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

  const DANUBE_SALMON_IDX = visibleCourses.find(vc => vc.courseKey === DANUBE_SALMON_KEY)?.i ?? Infinity;

  const dedup = arr => {
    const seen = new Set();
    return arr.filter(item => {
      const key = (item.name || item.title || "").trim().toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const hasPairing = !!pkey;
  const bottleQueue = hasPairing ? [] : dedup([...tableBottles]);

  const aperitifQueue = dedup(aperitifs.map(x => ({
    ...x,
    __type: x.__type || x.type || ((x.producer || x.vintage) ? "wine" : "cocktail"),
  })));

  const glassByGlassQueue = dedup([
    ...glasses.map(w => ({ ...w, __type: "wine" })),
    ...cocktails.map(c => ({ ...c, __type: "cocktail" })),
  ]);

  // ── Auto-migrate to v2 template ───────────────────────────────────────────
  // If the caller didn't provide a v2 template (e.g. first run, or tests
  // without a template), build one from the course list.  The result is
  // used for this render only — persistence is handled by the editor/App.
  const template = (menuTemplate?.version === 2 && Array.isArray(menuTemplate.rows))
    ? menuTemplate
    : buildDefaultTemplate(menuCourses);

  // ── Reorder template course rows for short menu ──────────────────────────
  // When isShort, course rows are sorted by their course's short_order while
  // structural rows (spacers, headers, etc.) stay at their original positions.
  // This ensures the short_order field drives the render sequence rather than
  // the template's long-menu layout order.
  const effectiveTemplateRows = (() => {
    if (!isShort) return template.rows;
    const tRows = template.rows;
    const courseIdxs = tRows.reduce((acc, row, i) => {
      if (row.left?.type === "course") acc.push(i);
      return acc;
    }, []);
    if (courseIdxs.length === 0) return tRows;
    const withOrder = courseIdxs.map(i => {
      const ck = normalizeCourseToken(tRows[i].left?.courseKey || "");
      const mc = menuCourses.find(c => normalizeCourseToken(c.course_key || c.key || c.menu?.name || "") === ck);
      return { i, order: Number(mc?.short_order) || 9999 };
    });
    const sorted = [...withOrder].sort((a, b) => a.order - b.order);
    const reordered = [...tRows];
    courseIdxs.forEach((origIdx, slot) => { reordered[origIdx] = tRows[sorted[slot].i]; });
    return reordered;
  })();

  // ── Walk template rows → internal row list ────────────────────────────────
  // Independent queue copies so template walking doesn't mutate the originals.
  const aQ = [...aperitifQueue];
  const gQ = [...glassByGlassQueue];
  const bQ = [...bottleQueue];

  let rows = [];
  let pendingGap = 0;      // deferred spacer gap — applied to the next row that actually renders

  for (const tRow of effectiveTemplateRows) {
    let lb = tRow.left;
    let rb = tRow.right;
    const wp = tRow.widthPreset || "55/45";

    // ── Spacer normalization ──
    // Each cell is independent: a spacer in one cell becomes extra top-gap on the row,
    // while content in the other cell still renders normally.
    let spacerGap = 0;
    if (lb?.type === "spacer") { spacerGap = Math.max(spacerGap, lb.height || 8); lb = null; }
    if (rb?.type === "spacer") { spacerGap = Math.max(spacerGap, rb.height || 8); rb = null; }
    const gap = (tRow.gap || 0) + spacerGap;
    // If both cells are empty (both were spacers, or both null), defer the gap
    // instead of emitting a standalone spacer row. This way, if the next course
    // is hidden (e.g. beetroot not ordered), the spacer disappears with it.
    if (!lb && !rb) {
      pendingGap += spacerGap + (tRow.gap || 0);
      continue;
    }

    // Consume any deferred spacer gap from previous spacer-only rows.
    // Course rows handle pendingGap separately (discarded when course is hidden).
    const consumeGap = () => { const g = gap + pendingGap; pendingGap = 0; return g; };

    // ── divider ──
    if (lb?.type === "divider" || rb?.type === "divider") {
      const db = lb?.type === "divider" ? lb : rb;
      rows.push({
        type: "_divider",
        thickness:    db.thickness    ?? 0.5,
        color:        db.color        ?? "#cccccc",
        marginTop:    db.marginTop    ?? 3,
        marginBottom: db.marginBottom ?? 3,
        gap: consumeGap(),
      });
      continue;
    }

    // ── pairing_label ──
    // Emits a section row with the label on whichever side (left/right) the block was placed.
    const plSide  = lb?.type === "pairing_label" ? "left" : "right";
    const plBlock = lb?.type === "pairing_label" ? lb : rb?.type === "pairing_label" ? rb : null;
    if (plBlock) {
      if (!isShort) {
        if (!hasPairing && !rules.preservePairingLabelSpacingWithoutPairing) {
          continue;
        }
        const autoLabel = PAIRING_LABELS[pkey] || "PAIRING";
        const allAutoLabels = new Set([
          ...Object.values(PAIRING_LABELS),
          "WINE PAIRING", "NON-ALCO PAIRING", "OUR STORY PAIRING", "PREMIUM PAIRING", "PREMIUM WINE PAIRING",
          "VINSKA SPREMLJAVA", "BREZALKOHOLNA SPREMLJAVA", "OUR STORY SPREMLJAVA", "PREMIUM SPREMLJAVA", "PREMIUM VINSKA SPREMLJAVA",
        ]);
        const label = (plBlock.text && !allAutoLabels.has(plBlock.text)) ? plBlock.text : autoLabel;
        rows.push({
          type: "section",
          // Preserve section break spacing even when the seat has no pairing.
          label: hasPairing ? label : "",
          reserveHeight: !hasPairing,
          side: plSide,
          align: plBlock.align || "right",
          spacing: plBlock.spacing ?? 6,
          widthPreset: wp,
          gap: consumeGap(),
        });
      }
      continue;
    }

    // ── title / logo → in-flow header row ──
    if (lb?.type === "title" || lb?.type === "logo" || rb?.type === "title" || rb?.type === "logo") {
      const tBlock = lb?.type === "title" ? lb : rb?.type === "title" ? rb : null;
      const lBlock = lb?.type === "logo"  ? lb : rb?.type === "logo"  ? rb : null;
      rows.push({ type: "_header", titleBlock: tBlock, logoBlock: lBlock, widthPreset: wp, gap: consumeGap() });
      continue;
    }

    // ── team → in-flow team row ──
    if (lb?.type === "team" || rb?.type === "team") {
      const tmBlock = lb?.type === "team" ? lb : rb;
      rows.push({ type: "_team", block: tmBlock, gap: consumeGap(), pinToBottom: !!tRow.pinToBottom });
      continue;
    }

    // ── goodbye → thank-you row ──
    const gbBlock = lb?.type === "goodbye" ? lb : rb?.type === "goodbye" ? rb : null;
    if (gbBlock) {
      const gbText = lang === "si"
        ? (gbBlock.text_si?.trim() || gbBlock.text?.trim())
        : gbBlock.text?.trim();
      rows.push({ type: "thankyou", _text: gbText || thankYouNote, fontSize: gbBlock.fontSize, align: gbBlock.align, gap: consumeGap(), pinToBottom: !!tRow.pinToBottom });
      continue;
    }

    // ── text ──
    if (lb?.type === "text" || rb?.type === "text") {
      const lText = lb?.type === "text" ? lb : null;
      const rText = rb?.type === "text" ? rb : null;
      const mkTextVal = (b) => b ? { title: b.bold ? (b.text || "") : "", sub: b.bold ? "" : (b.text || ""), fontSize: b.fontSize, lineHeight: b.lineHeight, align: b.align } : null;
      rows.push({ type: "course", courseKey: null, left: mkTextVal(lText), right: mkTextVal(rText), rowClass: "", widthPreset: wp, gap: consumeGap() });
      continue;
    }

    // ── aperitif ──
    if (lb?.type === "aperitif" || rb?.type === "aperitif") {
      if (aQ.length > 0) rows.push({ type: "wine-only", right: fmtDrinkParts(aQ.shift()), widthPreset: wp, gap: consumeGap() });
      continue;
    }

    // ── by_the_glass (explicit standalone block) ──
    if (lb?.type === "by_the_glass" || rb?.type === "by_the_glass") {
      if (gQ.length > 0) rows.push({ type: "wine-only", right: fmtDrinkParts(gQ.shift()), widthPreset: wp, gap: consumeGap() });
      continue;
    }

    // ── bottle (explicit standalone block) ──
    if (lb?.type === "bottle" || rb?.type === "bottle") {
      if (bQ.length > 0) rows.push({ type: "wine-only", right: fmtDrinkParts(bQ.shift()), widthPreset: wp, gap: consumeGap() });
      continue;
    }

    // ── course row ──
    if (lb?.type === "course") {
      const courseKey = lb.courseKey || "";
      // Normalized lookup handles raw course_keys that differ in punctuation
      const normKey = normalizeCourseToken(courseKey);
      const vc = visibleCourses.find(vc => vc.courseKey === courseKey || vc.courseKey === normKey);
      // Course hidden (e.g. beetroot not ordered) — discard any pending spacer gap
      if (!vc) { pendingGap = 0; continue; }
      const { course, i } = vc;

      let dish = applyCourseRestriction(resolveCourse(course), restrictions, lang);
      let drink = null;
      const cn = String(course?.menu?.name || "").trim().toUpperCase();
      const nameKey = normalizeCourseToken(cn);
      const isForcedBeerCourse = rules.forceBeerCourseKeys.includes(normKey) || rules.forceBeerCourseKeys.includes(nameKey);
      const forcedBeerDrink = (rules.forceChickenGizzardBeer && isForcedBeerCourse) ? resolveBeerDrinkForCourse(course) : null;
      const forcedPairingDrink = resolveForcedPairingDrink(course, courseKey, normKey);

      if (lb.showPairing === false && !forcedPairingDrink) {
        // showPairing toggle off — don't resolve any drink for this course row
      } else if (rb?.type === "pairing" || forcedPairingDrink) {
        if (pkey) {
          drink = forcedPairingDrink || (lang === "si" ? (course[`${pkey}_si`] || course[pkey]) : course[pkey]);

          // Beetroot extra pairing override
          const isBeetrootC = normalizeCourseToken(course.optional_flag || "") === "beetroot" || normKey === "beetroot";
          const beetExtra = extras[1];
          if (isBeetrootC && beetExtra?.ordered) {
            const beetPair = String(beetExtra.pairing || "—").trim();
            if (beetPair === "N/A" || beetPair === "Non-Alc") {
              drink = (lang === "si" ? (course.na_si || course.na) : course.na) || null;
            } else if (beetPair === "Champagne" || beetPair === "Wine") {
              drink = (lang === "si"
                ? (course.os_si || course.os || course.premium_si || course.premium || course.wp_si || course.wp)
                : (course.os || course.premium || course.wp)) || null;
            } else { drink = null; }
          }

          // Forced beer substitution for configured course keys.
          if (forcedBeerDrink) drink = forcedBeerDrink;

          // By-the-glass fallback from Danube Salmon onwards
          if (!drink && i >= DANUBE_SALMON_IDX && gQ.length > 0 && rb?.showByGlass !== false) {
            const d = fmtDrinkParts(gQ.shift());
            drink = { name: d.title || "", sub: d.sub || "" };
          }
        } else {
          if (forcedPairingDrink) {
            drink = forcedPairingDrink;
          }
          if (forcedBeerDrink) {
            drink = forcedBeerDrink;
          }
          // No pairing package — by-the-glass or bottle from Danube onwards
          if (!drink && i >= DANUBE_SALMON_IDX && gQ.length > 0 && rb?.showByGlass !== false) {
            const d = fmtDrinkParts(gQ.shift());
            drink = { name: d.title || "", sub: d.sub || "" };
          } else if (!drink && i >= DANUBE_SALMON_IDX && bQ.length > 0 && rb?.showBottle !== false) {
            const d = fmtDrinkParts(bQ.shift());
            drink = { name: d.title || "", sub: d.sub || "" };
          }
        }
      }

      // Aperitif overflow: remaining aperitifs fill into pre-Danube course right columns
      // so e.g. a 2nd aperitif shows alongside Sour Soup, 3rd alongside Linzer Eye, etc.
      if (lb.showPairing !== false && !drink && aQ.length > 0 && i < DANUBE_SALMON_IDX) {
        const d = fmtDrinkParts(aQ.shift());
        drink = { name: d.title || "", sub: d.sub || "" };
      }

      // Per-seat output overrides (ephemeral, set in the service view)
      const outOv = seatOutputOverrides[courseKey] || seatOutputOverrides[normKey];
      if (outOv) {
        if (typeof outOv.name      === "string") dish  = { ...(dish  || {}), name: outOv.name      };
        if (typeof outOv.sub       === "string") dish  = { ...(dish  || {}), sub:  outOv.sub       };
        if (typeof outOv.drinkName === "string") drink = { ...(drink || {}), name: outOv.drinkName };
        if (typeof outOv.drinkSub  === "string") drink = { ...(drink || {}), sub:  outOv.drinkSub  };
      }

      rows.push({
        type: "course",
        courseKey: normKey,
        left:  { title: dish?.name || "", sub: dish?.sub || "" },
        right: drink ? { title: drink.name || "", sub: drink.sub || "" } : null,
        rowClass: "",
        widthPreset: wp,
        // Preserve section breaks even if the template is missing an explicit spacer row.
        // (e.g. legacy templates where "Gap Before" was toggled later in course data)
        gap: (() => {
          const templateGap = consumeGap();
          if (templateGap > 0) return templateGap;
          return (rules.preserveCourseSectionGapFallback && course?.section_gap_before) ? rules.sectionGapFallbackPt : 0;
        })(),
      });
      continue;
    }
  }


  // ── Append leftover drink queues after template walk ──────────────────────
  while (gQ.length > 0) rows.push({ type: "wine-only", right: fmtDrinkParts(gQ.shift()), widthPreset: "55/45" });
  while (bQ.length > 0) rows.push({ type: "wine-only", right: fmtDrinkParts(bQ.shift()), widthPreset: "55/45" });

  if (_rowsOnly) return rows;

  // ── Extract header/footer settings from template blocks ──────────────────
  // These override the global layoutStyles defaults when the editor has
  // configured them explicitly on the title/logo/team/goodbye blocks.
  let titleBlock = null, logoBlock = null;
  for (const tRow of template.rows) {
    if (!titleBlock && tRow.left?.type  === "title") titleBlock = tRow.left;
    if (!titleBlock && tRow.right?.type === "title") titleBlock = tRow.right;
    if (!logoBlock  && tRow.left?.type  === "logo")  logoBlock  = tRow.left;
    if (!logoBlock  && tRow.right?.type === "logo")  logoBlock  = tRow.right;
  }

  const titleFontSize = titleBlock?.fontSize  ?? 13.9;
  const titleTracking = titleBlock?.tracking  ?? 0.035;
  const titleTransform = (titleBlock?.uppercase !== false) ? "uppercase" : "none";
  const titleAlign    = titleBlock?.align     ?? "left";

  const logoSize    = s("logoSize",    logoBlock?.size    ?? 10.5);
  const logoOffsetX = s("logoOffsetX", logoBlock?.offsetX ?? 0);
  const logoOffsetY = s("logoOffsetY", logoBlock?.offsetY ?? 0);

  // ── Render helpers ────────────────────────────────────────────────────────

  /**
   * Render a left or right content block into a .menu-col div.
   * Accepts optional inline style override from text blocks.
   */
  const renderBlock = (block, cls = "") => {
    if (!block || (!block.title && !block.sub)) return `<div class="menu-col ${cls}"></div>`;
    const styleAttr = (() => {
      const parts = [];
      if (block.fontSize)   parts.push(`font-size:${block.fontSize}pt`);
      if (block.lineHeight) parts.push(`line-height:${block.lineHeight}`);
      if (block.align && block.align !== "left") parts.push(`text-align:${block.align}`);
      return parts.length ? ` style="${parts.join(";")}"` : "";
    })();
    return `<div class="menu-col ${cls}"${styleAttr}>${block.title ? `<div class="menu-main">${esc(block.title)}</div>` : ""}${block.sub ? `<div class="menu-sub">${esc(block.sub)}</div>` : ""}</div>`;
  };

  /**
   * Convert a widthPreset string to an inline CSS grid-template-columns value.
   */
  const gridCols = (preset) => {
    const { leftFr, rightFr } = parseWidthPreset(preset);
    return `grid-template-columns:minmax(0,${leftFr}fr) minmax(0,${rightFr}fr)`;
  };

  // ── Date and title (needed by _header row renderer) ──────────────────────
  const _today = new Date();
  const _d = _today.getDate();
  const _MONTHS_EN = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const _MONTHS_SI = ["Januar","Februar","Marec","April","Maj","Junij","Julij","Avgust","September","Oktober","November","December"];
  const menuDate = lang === "si"
    ? `${_d}. ${_MONTHS_SI[_today.getMonth()]} ${_today.getFullYear()}`
    : (() => {
        const sfx = [11,12,13].includes(_d) ? "th" : _d%10===1 ? "st" : _d%10===2 ? "nd" : _d%10===3 ? "rd" : "th";
        return `${_d}${sfx} of ${_MONTHS_EN[_today.getMonth()]}, ${_today.getFullYear()}`;
      })();
  // Title: prefer the template's title block text (lang-aware), fall back to menuTitle parameter.
  const _titleBlockText = (() => {
    for (const r of (menuTemplate?.rows || [])) {
      const tb = r.left?.type === "title" ? r.left : r.right?.type === "title" ? r.right : null;
      if (!tb) continue;
      const t = lang === "si" ? (tb.text_si?.trim() || tb.text?.trim()) : tb.text?.trim();
      if (t) return t;
    }
    return null;
  })();
  const TITLE_FALLBACK = lang === "si" ? "ZIMSKI MENI" : "WINTER MENU";
  const safeTitle = esc((_titleBlockText || menuTitle || TITLE_FALLBACK).replace(/\s+/g, " ").trim());

  // ── Render rows to HTML ───────────────────────────────────────────────────
  const menuRowsHtml = rows.map(row => {
    const gapStyle = row.gap ? `margin-top:${row.gap}pt;` : "";
    const pin = row.pinToBottom;

    if (row.type === "_divider") {
      const t  = row.thickness ?? 0.5;
      const c  = row.color     ?? "#cccccc";
      const mt = (row.marginTop    ?? 3) + (row.gap || 0);
      const mb = row.marginBottom  ?? 3;
      return `<hr style="border:none;border-top:${t}pt solid ${esc(c)};margin:${mt}pt 0 ${mb}pt;">`;
    }
    if (row.type === "section") {
      const ta = row.align && row.align !== "left" ? `text-align:${row.align};` : "";
      const mbPt = (row.spacing ?? 6);
      const reserveHeight = row.reserveHeight !== false;
      const labelHasText = String(row.label || "").trim().length > 0;
      const labelVisibility = !labelHasText && reserveHeight ? "visibility:hidden;" : "";
      const labelText = labelHasText ? esc(row.label || "") : (reserveHeight ? "&nbsp;" : "");
      const labelHtml = `<div class="menu-section-label" style="${ta}${labelVisibility}">${labelText}</div>`;
      const emptyDiv = `<div></div>`;
      const leftHtml = row.side === "left" ? labelHtml : emptyDiv;
      const rightHtml = row.side === "right" ? labelHtml : emptyDiv;
      return `<div class="menu-row" style="${gapStyle}margin-bottom:${mbPt}pt;${gridCols(row.widthPreset)}">${leftHtml}${rightHtml}</div>`;
    }
    if (row.type === "wine-only") {
      return `<div class="menu-row wine-only" style="${gapStyle}${gridCols(row.widthPreset)}">${renderBlock(null, "left")}${renderBlock(row.right, "right")}</div>`;
    }
    if (row.type === "_header") {
      const hasTitle = !!row.titleBlock;
      const hasLogo  = !!row.logoBlock && !!_logo;
      const titleHtml = hasTitle
        ? `<div id="title">${safeTitle}<div id="menu-date">${esc(menuDate)}</div></div>`
        : "";
      const logoHtml = hasLogo
        ? `<div id="logo"><img src="${_logo}" alt="Logo"></div>`
        : "";
      return `<div class="menu-header-row" style="${gapStyle}">${titleHtml}${logoHtml}</div>`;
    }
    if (row.type === "_team") {
      const tmB = row.block || {};
      const spacing = tmB.spacing ?? 1.4;
      const names = tmB.names || teamNames;
      const taStyle = (tmB.align && tmB.align !== "left") ? `text-align:${tmB.align};` : "";
      return `<div id="team" class="${pin ? "pin-bottom" : ""}" style="${pin ? "" : gapStyle}${taStyle}"><div class="menu-main" style="margin-bottom:${spacing}pt">TEAM:</div><div>${esc(names)}</div></div>`;
    }
    if (row.type === "thankyou") {
      const fs = row.fontSize ? `font-size:${row.fontSize}pt;` : "";
      const ta = (row.align && row.align !== "left") ? `text-align:${row.align};` : "";
      return `<div class="menu-thankyou ${pin ? "pin-bottom" : ""}" style="${pin ? "" : gapStyle}${fs}${ta}">${esc(row._text || thankYouNote)}</div>`;
    }
    // course / text rows
    const ckAttr = row.courseKey ? ` data-ck="${esc(row.courseKey)}"` : "";
    return `<div class="menu-row ${row.rowClass || ""}${pin ? " pin-bottom" : ""}" style="${pin ? "" : gapStyle}${gridCols(row.widthPreset)}"${ckAttr}>${renderBlock(row.left, "left")}${renderBlock(row.right, "right")}</div>`;
  }).join("");

  // ── HTML output ───────────────────────────────────────────────────────────
  // Single unified rendering path — same CSS and structure used in both the
  // live editor preview and the final print window.
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${safeTitle}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Roboto+Mono:wght@400;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
:root{
  --page-w:148mm;--page-h:210mm;
  --pad-t:${s("padTop",8.4)}mm;--pad-r:${s("padRight",12)}mm;
  --pad-b:${s("padBottom",8.2)}mm;--pad-l:${s("padLeft",12)}mm;
  --inner-h:calc(var(--page-h) - var(--pad-t) - var(--pad-b));
}
@page{size:A5 portrait;margin:0;}
html,body{width:var(--page-w);height:var(--page-h);overflow:hidden;background:#fff;color:#000;font-family:'Roboto Mono',monospace;font-size:${s("fontSize",6.75)}pt;line-height:1.08;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
body{position:relative;}
#sheet{width:var(--page-w);height:var(--page-h);overflow:hidden;position:relative;background:#fff;}
#frame{position:absolute;inset:0;padding:var(--pad-t) var(--pad-r) var(--pad-b) var(--pad-l);overflow:hidden;}
#scaleTarget{width:100%;min-height:var(--inner-h);display:flex;flex-direction:column;transform-origin:top left;}
.menu-header-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;column-gap:8.6mm;margin-bottom:${s("headerSpacing",7)}mm;}
#title{font-size:${titleFontSize}pt;font-weight:700;letter-spacing:${titleTracking}em;text-transform:${titleTransform};text-align:${titleAlign};}
#menu-date{font-size:5.8pt;font-weight:400;letter-spacing:0.02em;margin-top:0.8mm;text-transform:none;}
#logo{transform:translate(${logoOffsetX}mm,${logoOffsetY}mm);}
#logo img{width:${logoSize}mm;display:block;}
#menu{width:100%;flex:1;display:flex;flex-direction:column;}
.pin-bottom{margin-top:auto;}
/* Per-row grid-template-columns are set via inline styles on each .menu-row */
.menu-row{display:grid;column-gap:${s("colGap", 9)}mm;align-items:start;break-inside:avoid;page-break-inside:avoid;}
.menu-row{margin-bottom:${s("rowSpacing",3.15)}pt;}
.menu-row.wine-only{margin-bottom:${s("wineRowSpacing",4.5)}pt;}

.menu-col{min-width:0;}
.menu-main{font-weight:700;line-height:1.02;letter-spacing:0.012em;overflow-wrap:anywhere;text-transform:uppercase;}
.menu-sub{line-height:1.08;margin-top:0.75pt;overflow-wrap:anywhere;}
.menu-section-label{font-weight:700;letter-spacing:0.042em;padding-top:0.6pt;text-transform:uppercase;}
.menu-thankyou{margin-top:${s("thankYouSpacing",7)}pt;font-size:6.55pt;font-style:normal;}
#team{font-size:6.5pt;line-height:1.2;overflow-wrap:anywhere;}
#team .menu-main{margin-bottom:1.4pt;}
</style>
</head>
<body>
<div id="sheet"><div id="frame"><div id="scaleTarget">
<div id="menu">${menuRowsHtml}</div>
</div></div></div>
<script>
(function(){
  const MIN_SCALE = 0.58;
  const MAX_TRIES = 80;
  function fit(){
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
  window.addEventListener('load', function(){ setTimeout(fit, 80); });
  window.addEventListener('resize', fit);
  window.addEventListener('beforeprint', fit);
  window.addEventListener('afterprint', fit);
})();
</script>
</body>
</html>`;
}
