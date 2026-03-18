import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";
import {
  DndContext, PointerSensor, TouchSensor,
  useSensor, useSensors, DragOverlay, rectIntersection,
  MeasuringStrategy,
} from "@dnd-kit/core";
import {
  SortableContext, useSortable, rectSortingStrategy, arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const LIVE_MENU_SHEET_ID = import.meta.env.VITE_MENU_SHEET_ID || "1aPVGmKNcvDOFzyr3jSPT_KL5lKEYKPgkad3y0_E_Vl4";
const LIVE_MENU_SHEET_TAB = import.meta.env.VITE_MENU_SHEET_TAB || "MILKA MENU V2";
const LIVE_MENU_CSV_URL = `https://docs.google.com/spreadsheets/d/${LIVE_MENU_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(LIVE_MENU_SHEET_TAB)}`;

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') inQuote = false;
      else field += ch;
    } else {
      if (ch === '"') inQuote = true;
      else if (ch === ',') { row.push(field); field = ""; }
      else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (ch !== "\r") field += ch;
    }
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const normHeader = value => String(value || "")
  .trim()
  .toLowerCase()
  .replace(/\s+/g, "_")
  .replace(/[^a-z0-9_/?#]+/g, "_")
  .replace(/^_+|_+$/g, "");

const csvRowsToObjects = (rows) => {
  if (!Array.isArray(rows) || rows.length < 2) return [];
  const headers = rows[0].map(normHeader);
  return rows.slice(1).map(cols => {
    const obj = {};
    headers.forEach((header, idx) => { obj[header] = cols[idx] ?? ""; });
    return obj;
  });
};

const firstFilled = (...vals) => vals.find(v => String(v ?? "").trim()) ?? "";

// Apply a service-level menu override to a course.
// overrides[courseKey] = { name?, sub?, name_si?, sub_si?, seats?: { [seatId]: { name?, sub? } } }
// seatId: if provided, seat-specific overrides take precedence over table-wide ones.
const applyMenuOverride = (course, overrides, seatId = null) => {
  const base = overrides?.[course.course_key];
  if (!base) return course;
  // Merge table-wide + seat-specific (seat wins)
  const seatOv = seatId != null ? (base.seats?.[seatId] || {}) : {};
  const ov = { ...base, ...seatOv };
  if (!Object.keys(ov).filter(k => k !== "seats").length) return course;
  return {
    ...course,
    menu: {
      name: "name" in ov ? ov.name : course.menu?.name,
      sub:  "sub"  in ov ? ov.sub  : course.menu?.sub,
    },
    menu_si: ("name_si" in ov || "sub_si" in ov) ? {
      name: "name_si" in ov ? ov.name_si : (course.menu_si?.name || ""),
      sub:  "sub_si"  in ov ? ov.sub_si  : (course.menu_si?.sub  || ""),
    } : course.menu_si,
  };
};

const truthyCell = value => {
  const s = String(value ?? "").trim().toLowerCase();
  return s === "true" || s === "yes" || s === "y" || s === "1" || s === "wahr";
};

const splitMainSubCell = (title, sub = "") => {
  const rawTitle = String(title ?? "").trim();
  const rawSub = String(sub ?? "").trim();
  if (!rawTitle && !rawSub) return null;
  if (rawTitle.includes("|")) {
    const [left, ...rest] = rawTitle.split("|");
    return {
      name: left.trim(),
      sub: rest.join("|").trim() || rawSub || "",
    };
  }
  return { name: rawTitle, sub: rawSub };
};

// Parse a bilingual cell with optional kitchen note:
//   Line 1 = EN  (menu generator)
//   Line 2 = SI  (menu generator)
//   Line 3 = kitchen ticket note (never used for menu generation)
// rawSubCol is the optional separate sub/description column (same 3-line structure).
// Returns { en: {name, sub} | null, si: {name, sub} | null, note: string }
//
// IMPORTANT: We split on a single \n (not \n+) to preserve blank-line positions.
// A blank line 2 means "no SI content" — it must not shift line 3 up into the SI slot.
const parseBilingual = (rawCell, rawSubCol = "") => {
  const lines    = String(rawCell   ?? "").split("\n").map(s => s.trim());
  const subLines = String(rawSubCol ?? "").split("\n").map(s => s.trim());
  const en = splitMainSubCell(lines[0] || "", subLines[0] || "");
  const si = (lines[1] || subLines[1])
    ? splitMainSubCell(lines[1] || "", subLines[1] || "")
    : null;
  const note = lines[2] || subLines[2] || "";
  return { en: en?.name ? en : null, si: si?.name ? si : null, note };
};

function normalizeLiveMenuRow(row) {
  const position = Number(firstFilled(row["#"], row.position, row.order_index)) || 0;

  // Google Sheets cells may contain up to 3 lines: line 1 = EN, line 2 = SI, line 3 = kitchen note only.
  // Split on single \n to preserve blank-line positions — a blank line 2 must NOT shift line 3 into SI slot.
  const dishLines = String(row.dish ?? "").split("\n").map(s => s.trim());
  const descLines = String(row.description ?? "").split("\n").map(s => s.trim());
  const dishEnRaw = dishLines[0] || "";
  const descEnRaw = descLines[0] || "";
  // Line 2 = SI name (menu gen only). Line 3 = kitchen note fallback.
  // Prefer an explicit dish_si column; fall back to line 2 of the dish cell.
  const dishSiRaw = String(row.dish_si ?? "").trim() || dishLines[1] || "";
  const descSiRaw = String(row.dish_si_sub ?? "").trim() || descLines[1] || "";
  const kitchenNoteFallback = dishLines[2] || "";

  const dish = splitMainSubCell(dishEnRaw, descEnRaw);
  if (!dish?.name) return null;

  // course_key derived from the EN dish name only (not the combined cell)
  const courseKey = String(firstFilled(row.course_key, row.key, dishEnRaw) || "")
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  const restrictionKeys = [
    "veg","vegan","pescetarian","gluten_free","dairy_free","nut_free","shellfish_free",
    "no_red_meat","no_pork","no_game","no_offal","egg_free","no_alcohol",
    "no_garlic_onion","halal","low_fodmap"
  ];
  const restrictions = {};
  restrictionKeys.forEach((key) => {
    const { en, si, note: cellNote } = parseBilingual(row[key], row[`${key}_sub`]);
    restrictions[key] = en;
    if (si) restrictions[`${key}_si`] = si;
    // Kitchen note: prefer explicit "{key}_note" column, fall back to line 3 of the restriction cell.
    const note = String(firstFilled(row[`${key}_note`], cellNote) || "").trim();
    if (note) restrictions[`${key}_note`] = note;
  });

  const menuSi = splitMainSubCell(dishSiRaw, descSiRaw);

  // Pairings — bilingual (line 1 = EN, line 2 = SI)
  const wpBi   = parseBilingual(row.wp_drink,  row.wp_sub);
  const naBi   = parseBilingual(row.na_drink,  row.na_sub);
  const osBi   = parseBilingual(row.os_drink,  row.os_sub);
  const premBi = parseBilingual(row.premium,   row.premium_sub);

  return {
    position,
    is_snack: truthyCell(firstFilled(row["snack?"], row.snack)),
    menu: dish,
    menu_si: menuSi?.name ? menuSi : null,
    wp: wpBi.en,
    wp_si: wpBi.si || null,
    na: naBi.en,
    na_si: naBi.si || null,
    os: osBi.en,
    os_si: osBi.si || null,
    premium: premBi.en,
    premium_si: premBi.si || null,
    course_key: courseKey,
    optional_flag: String(firstFilled(row.optional_flag)).trim().toLowerCase(),
    section_gap_before: truthyCell(firstFilled(row.section_gap_before)),
    show_on_short: truthyCell(firstFilled(row.show_on_short)),
    short_order: Number(firstFilled(row.short_order)) || null,
    // Bilingual force pairing: same column, line 1 = EN "TITLE | sub", line 2 = SI "TITLE | sub"
    ...(() => {
      const raw = String(firstFilled(row.force_pairing_title)).trim();
      const [enLine, siLine] = raw.split("\n").map(l => l.trim());
      const en = splitMainSubCell(enLine, String(firstFilled(row.force_pairing_sub)).trim());
      const si = siLine ? splitMainSubCell(siLine) : null;
      return {
        force_pairing_title: en?.name || "",
        force_pairing_sub: en?.sub || "",
        force_pairing_title_si: si?.name || "",
        force_pairing_sub_si: si?.sub || "",
      };
    })(),
    kitchen_note: String(firstFilled(row.kitchen_note, kitchenNoteFallback)).trim(),
    restrictions,
  };
}

async function fetchLiveMenuCourses() {
  const response = await fetch(LIVE_MENU_CSV_URL, { cache: "no-store" });
  if (!response.ok) throw new Error(`Live menu fetch failed: ${response.status}`);
  const csvText = await response.text();
  const rows = parseCSV(csvText);
  const objects = csvRowsToObjects(rows);
  const courses = objects
    .map(normalizeLiveMenuRow)
    .filter(Boolean)
    .sort((a, b) => (a.position || 0) - (b.position || 0));
  if (!courses.length) throw new Error("No menu courses parsed from live sheet");
  return courses;
}


const FONT = "'Roboto Mono', monospace";
const MOBILE_SAFE_INPUT_SIZE = 16;

// ── Wine DB ───────────────────────────────────────────────────────────────────
const initWines = [];

// ── Initial extra dishes ──────────────────────────────────────────────────────
const initDishes = [
  { id: 1, name: "Beetroot",  pairings: ["—", "Champagne", "N/A"] },
  { id: 2, name: "Cheese",    pairings: ["—", "Wine", "Non-Alc"] },
  { id: 3, name: "Cake",      pairings: ["—"] },
];

// ── Cocktails & Spirits & Beers ───────────────────────────────────────────────
function mergeDishes(list) {
  const base = Array.isArray(list) ? list : [];
  const builtinById = new Map(initDishes.map(d => [String(d.id), d]));
  const merged = base.map(item => {
    const builtin = builtinById.get(String(item?.id ?? ""));
    if (!builtin) return item;
    return {
      ...item,
      name: builtin.name,
      pairings: [...builtin.pairings],
    };
  });
  const seen = new Set(merged.map(x => String(x?.id ?? "")));
  initDishes.forEach(d => {
    if (!seen.has(String(d.id))) merged.push({ ...d, pairings: [...d.pairings] });
  });
  return merged.sort((a, b) => Number(a.id || 0) - Number(b.id || 0));
}

const initCocktails = [];
const initSpirits   = [];
const initBeers     = [];

// ── Beverages local-storage key (separate from board state) ───────────────────
const BEV_STORAGE_KEY = "milka-beverages-v1";
function readLocalBeverages() {
  try {
    const raw = localStorage.getItem(BEV_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}
function writeLocalBeverages(bev) {
  try { localStorage.setItem(BEV_STORAGE_KEY, JSON.stringify(bev)); } catch {}
}


const TEAM_STORAGE_KEY = "milka-menu-team-v1";
const DEFAULT_TEAM_NAMES = "Daniel Polyakov, David Žefran, Djan Meglič, Jakob Zarnik, Joel Gomez, Juan Galindo, Nar Bahadur, Živa Kralj";
function readTeamNames() {
  if (typeof window === "undefined") return DEFAULT_TEAM_NAMES;
  try {
    const raw = window.localStorage.getItem(TEAM_STORAGE_KEY);
    return raw && raw.trim() ? raw : DEFAULT_TEAM_NAMES;
  } catch {
    return DEFAULT_TEAM_NAMES;
  }
}
function writeTeamNames(value) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TEAM_STORAGE_KEY, value || DEFAULT_TEAM_NAMES);
  } catch {}
}

const esc = (v) => String(v ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;");

// ── Water ─────────────────────────────────────────────────────────────────────
const WATER_OPTS = ["—", "XC", "XW", "OC", "OW"];
const waterStyle = v => {
  if (v === "XC" || v === "XW") return { color: "#1a1a1a", bg: "#f0f0f0" };
  if (v === "OC" || v === "OW") return { color: "#1a1a1a", bg: "#e8e8e8" };
  return { color: "#555", bg: "transparent" };
};

// ── Pairings ──────────────────────────────────────────────────────────────────
const PAIRINGS = ["—", "Wine", "Non-Alc", "Premium", "Our Story"];

// ── Winter Menu Data (from FOOD N PAIRINGS JAN26) ────────────────────────────
const MENU_DATA = [{"menu":{"name":"SOUR SOUP","sub":"cabbage, yeast butter"},"veg":{"name":"SOUR SOUP","sub":"cabbage, yeast butter"},"hazards":"Lactose, chicken stock, pork","na":null,"wp":null,"os":null,"premium":null,"aperitivo":{"name":"So fresh, So clean","sub":"jasmine, redcurrant"}},{"menu":{"name":"LINZER EYE","sub":"chicken liver, barberry"},"veg":{"name":"LINZER EYE","sub":"mushroom parfait, crisp of rye"},"hazards":"Lactose, berries, chicken, gluten","na":null,"wp":null,"os":null,"premium":null,"aperitivo":{"name":"Domaine Slapšak ZC","sub":"Dolenjska, Slovenija"}},{"menu":{"name":"TROUT BELLY","sub":"trdinka corn, horseradish"},"veg":{"name":"CARROT","sub":"trdinka corn, horseradish"},"hazards":"Fish, gluten, eggs","na":null,"wp":null,"os":null,"premium":null,"aperitivo":{"name":"Clandestin, Les Revers '22","sub":"Côte de Bars de Reims, France"}},{"menu":{"name":"CHAMOIS","sub":"smoked ricotta, leek"},"veg":{"name":"CHAMOIS","sub":"brussels sprout, algae caviar"},"hazards":"Alliums, lactose, gluten","na":null,"wp":null,"os":null,"premium":null,"aperitivo":{"name":"Krug 173ème edition","sub":"Montagne de Reims, France"}},{"menu":{"name":"CRAYFISH","sub":"bozner sauce, porkhead"},"veg":{"name":"CELERIAC","sub":"ricotta"},"hazards":"Shellfish, eggs, lactose, gluten, pork","na":null,"wp":null,"os":null,"premium":null,"aperitivo":null},{"menu":{"name":"DANUBE SALMON","sub":"potato, walnut leaf"},"veg":{"name":"DANUBE SALMON","sub":"parsley root"},"hazards":null,"na":{"name":"TARRAGON","sub":"lavender, fennel seeds"},"wp":{"name":"Marko Fon Vitovska Selekcija '21","sub":"Kras, Slovenia"},"os":{"name":"TARRAGON","sub":"lavender, fennel seeds"},"premium":{"name":"J. Recchione Hautes Côtes de Nuits Blanc '23","sub":"Côte de Nuits, France"},"aperitivo":{"name":"Pickle Martini","sub":""}},{"menu":{"name":"BEETROOT","sub":"bear fat, caviar"},"veg":{"name":"BEETROOT","sub":"smoked cream, algae caviar"},"hazards":"Hazelnut, lactose, meat","na":{"name":"RED CURRANT","sub":"walnut, lilac"},"wp":null,"os":{"name":"Champagne Chavost, Paradoxe '19","sub":"Vallée de la Marne, France"},"premium":{"name":"Champagne Chavost, Paradoxe '19","sub":"Vallée de la Marne, France"},"aperitivo":null},{"menu":{"name":"SQUASH","sub":"quince, pork cracklings"},"veg":{"name":"SQUASH","sub":"quince, potato cracklings"},"hazards":"shellfish/crustaceans, lactose","na":{"name":"FIG LEAF","sub":"carrot, miso"},"wp":{"name":"Lucien Aviet, Cuvée des Docteurs '23","sub":"Jura, France"},"os":{"name":"FIG LEAF","sub":"carrot, miso washed cognac"},"premium":{"name":"Théo Dancer, Jurassique '23","sub":"Jura, France"},"aperitivo":null},{"menu":{"name":"RAINBOW TROUT","sub":"sauerkraut, chanterelles"},"veg":null,"hazards":"lactose, alliums-onion, trout roe","na":{"name":"MUSTARD SEEDS","sub":"buckwheat, lemongrass"},"wp":{"name":"Renesansa, Renski rizling '21","sub":"Maribor, Slovenia"},"os":{"name":"Renesansa, Renski rizling '21","sub":"Maribor, Slovenia"},"premium":{"name":"Antoine Jobard, Mersault Les Gouttes d'or '22","sub":"Mersault, France"},"aperitivo":null},{"menu":{"name":"CHICKEN GIZZARD","sub":"fermented potato, bell pepper"},"veg":{"name":"MUSHROOM DUMPLING","sub":"fermented potato, kohlrabi"},"hazards":"gluten, lactose","na":{"name":"SPENT BREAD KOMBUCHA","sub":"malt, hops"},"wp":{"name":"Reservoir Dogs, Crazy Sister","sub":"Nova Gorica, Slovenia"},"os":{"name":"Reservoir Dogs, Crazy Sister","sub":"Nova Gorica, Slovenia"},"premium":{"name":"Reservoir Dogs, Crazy Sister","sub":"Nova Gorica, Slovenia"},"aperitivo":null},{"menu":{"name":"BRIOCHE","sub":"wild boar, cream cheese"},"veg":{"name":"BRIOCHE","sub":"seed crunch, cream cheese"},"hazards":"gluten, lactose","na":null,"wp":null,"os":null,"premium":null,"aperitivo":null},{"menu":{"name":"VENISON","sub":"preserved berries, Perigord truffle"},"veg":{"name":"VENISON","sub":"celeriac roll, caramelised onion reduction"},"hazards":"berries, stone fruits, lactose","na":{"name":"LINGONBERRY","sub":"shiitake, carob"},"wp":{"name":"Aleks Klinec, Mora '12","sub":"Goriška Brda, Slovenia"},"os":{"name":"Aleks Klinec, Mora '12","sub":"Goriška Brda, Slovenia"},"premium":{"name":"Dard & Ribo Hermitage '17","sub":"Rhône, France"},"aperitivo":null},{"menu":{"name":"SHEEP CHEESE","sub":"juniper, green tomato"},"veg":null,"hazards":"lactose","na":{"name":"SPRUCE","sub":"apple, gentian"},"wp":{"name":"Floribunda Apple Cider","sub":"Udine, Italy"},"os":{"name":"SPRUCE","sub":"apple, gin"},"premium":{"name":"Egly-Ouriet Les Vignes de Bisseuil","sub":"Montagne de Reims, France"},"aperitivo":null},{"menu":{"name":"PEAR","sub":"walnut, whiskey caramel"},"veg":null,"hazards":"gluten, lactose","na":null,"wp":null,"os":null,"premium":null,"aperitivo":null},{"menu":{"name":"SUNCHOKE","sub":"sea buckthorn, rosehip"},"veg":null,"hazards":"gluten, lactose","na":null,"wp":null,"os":null,"premium":null,"aperitivo":null},{"menu":{"name":"GODLJA","sub":"bread caramel, grains"},"veg":{"name":"GODLJA","sub":"no blood"},"hazards":"stone fruits, gluten","na":{"name":"ARONIA","sub":"meadowsweet, barley"},"wp":{"name":"Domaine Rolet, Macvin du Jura","sub":"Jura, France"},"os":{"name":"Domaine Rolet, Macvin du Jura","sub":"Jura, France"},"premium":{"name":"Domaine Rolet Macvin du Jura '12","sub":"Arbois, France"},"aperitivo":null},{"menu":{"name":"SWEET POTATO","sub":"star anise, egg yolk"},"veg":null,"hazards":"nuts, eggs, berries, gluten","na":null,"wp":null,"os":null,"premium":null,"aperitivo":null},{"menu":{"name":"CHEESE","sub":"condiments, sourdough crackers"},"veg":null,"hazards":null,"na":null,"wp":null,"os":null,"premium":null,"aperitivo":null},{"menu":{"name":"BUHTELJ","sub":"deer fat, lingonberry"},"veg":{"name":"BUHTELJ","sub":"brown butter, lingonberry"},"hazards":"gluten, lactose","na":null,"wp":null,"os":null,"premium":null,"aperitivo":null}];

const PAIRING_KEY = { "Wine": "wp", "Non-Alc": "na", "Premium": "premium", "Our Story": "os" };

const COUNTRY_NAMES = {
  FR: "France", IT: "Italy", ES: "Spain", DE: "Germany", AT: "Austria",
  SI: "Slovenia", PT: "Portugal", GR: "Greece", HU: "Hungary", HR: "Croatia",
  CH: "Switzerland", GE: "Georgia", RO: "Romania", BG: "Bulgaria", RS: "Serbia",
  CZ: "Czech Republic", SK: "Slovakia", MD: "Moldova", AM: "Armenia",
  US: "USA", AR: "Argentina", CL: "Chile", AU: "Australia", NZ: "New Zealand",
  ZA: "South Africa", UY: "Uruguay",
};
// ── Restriction definitions — keys match spreadsheet column names ─────────────
const RESTRICTIONS = [
  // Dietary
  { key: "veg",          label: "Vegetarian",      emoji: "🥦", group: "dietary"  },
  { key: "vegan",        label: "Vegan",            emoji: "🌱", group: "dietary"  },
  { key: "pescetarian",  label: "Pescetarian",      emoji: "🐟", group: "dietary"  },
  { key: "no_red_meat",  label: "No Red Meat",      emoji: "🚫🥩", group: "dietary" },
  { key: "no_pork",      label: "No Pork",          emoji: "🚫🐷", group: "dietary" },
  { key: "no_game",      label: "No Game",          emoji: "🚫🦌", group: "dietary" },
  { key: "no_offal",     label: "No Offal",         emoji: "🚫🫀", group: "dietary" },
  // Allergies / Intolerances
  { key: "gluten",       label: "Gluten Free",      emoji: "🌾", group: "allergy"  },
  { key: "dairy",        label: "Dairy Free",       emoji: "🥛", group: "allergy"  },
  { key: "nut",          label: "Nut Free",         emoji: "🥜", group: "allergy"  },
  { key: "shellfish",    label: "Shellfish Free",   emoji: "🦐", group: "allergy"  },
  { key: "egg_free",     label: "Egg Free",         emoji: "🥚", group: "allergy"  },
  { key: "no_garlic_onion", label: "No Garlic/Onion", emoji: "🧅", group: "allergy" },
  // Lifestyle / Religious
  { key: "no_alcohol",   label: "No Alcohol",       emoji: "🚱", group: "other"    },
  { key: "halal",        label: "Halal",            emoji: "☪️",  group: "other"    },
  { key: "low_fodmap",   label: "Low FODMAP",       emoji: "📋", group: "other"    },
];
const RESTRICTION_GROUPS = { dietary: "Dietary", allergy: "Allergies & Intolerances", other: "Lifestyle & Religious" };
const restrLabel = (key) => { const d = RESTRICTIONS.find(r => r.key === key); return d ? `${d.emoji} ${d.label}` : key; };
const restrCompact = (key) => { const d = RESTRICTIONS.find(r => r.key === key); return d ? d.label : key; };


// ── Embedded assets for menu PDF generation ───────────────────────────────────
const MENU_FONT_BOLD = "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/9IAAATMB9ISJgAkAAAQBwH0/9wBQf///63/7ARLBpESJgBEAAAQBgH0twD//wAcAAAEzAfwEiYAJAAAEAcB8//yAT3//wBz/+wEiwavEiYARAAAEAYB8838//8AHAAABMwILBImACQAABAHAfL/6AE7//8Ac//sBEsG6xImAEQAABAGAfLD+v//ABz+mQTMB0kSJgAkAAAQJwFVAIYBXRAHAV4ExAAF//8Ac/6hBEsGBxImAEQAABAmAVVhGxAHAV4EfwAN//8AHAAABMwHvRImACQAABAHAfn/9QFM//8Ac//sBEsGexImAEQAABAGAfnQCv//ABwAAATMCBwSJgAkAAAQBwH2//wBq///AHP/7ARLBtoSJgBEAAAQBgH212n//wAcAAAEzAgzEiYAJAAAEAcB+P/gAT3//wBz/+wESwbyEiYARAAAEAYB+Lv8//8AHAAABMwIIxImACQAABAHAfz/xgFB//8Ac//sBEsG4hImAEQAABAGAfyhAP//ABz+mQTMB0ESJgAkAAAQJwFXAAABnxAHAV4ExAAF//8Ac/6hBEsF/xImAEQAABAmAVfcXRAHAV4EfwAN//8Ak/6eBGgFsBImACgAABAHAV4E3AAK//8AcP6UBGgEThImAEgAABAHAV4E0wAA//8AkwAABGgHvhImACgAABAHAV0E4QE5//8AcP/sBGgGhhImAEgAABAHAV0EuAAB//8AkwAABGgHWxImACgAABAHAVoAlgFV//8AcP/sBGgGIxImAEgAABAGAVptHf//AJMAAAUlB9oSJgAoAAAQBwH1//oBVf//AHD/7AT8BqISJgBIAAAQBgH10R3////bAAAEaAfJEiYAKAAAEAcB9P/lATj///+y/+wEaAaREiYASAAAEAYB9LwA//8AkwAABLkH5xImACgAABAHAfP/+wE0//8AcP/sBJAGsBImAEgAABAGAfPS/f//AJMAAARoCCMSJgAoAAAQBwHy//EBMv//AHD/7ARoBuwSJgBIAAAQBgHyyPv//wCT/p4EaAdAEiYAKAAAECcBVQCPAVQQBwFeBNwACv//AHD+lARoBggSJgBIAAAQJgFVZhwQBwFeBNMAAP//AMEAAAQLB8cSJgAsAAAQBwFdBLcBQv//AMcAAARaBmwSJgDzAAAQBwFdBPr/5///AMH+ngQLBbASJgAsAAAQBwFe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TQBvAG4AbwAtAEIAbwBsAGQAaAB0AHQAcAA6AC8ALwB3AHcAdwAuAGEAcABhAGMAaABlAC4AbwByAGcALwBsAGkAYwBlAG4AcwBlAHMALwBMAEkAQwBFAE4AUwBFAC0AMgAuADAAAAAAAgAAAAAAAP8GAGQAAAABAAAAAAAAAAAAAAAAAAAAAAH9AAAAAQACAAMABAAFAAYABwAIAAkACgALAAwADQAOAA8AEAARABIAEwAUABUAFgAXABgAGQAaABsAHAAdAB4AHwAgACEAIgAjACQAJQAmACcAKAApACoAKwAsAC0ALgAvADAAMQAyADMANAA1ADYANwA4ADkAOgA7ADwAPQA+AD8AQABBAEIAQwBEAEUARgBHAEgASQBKAEsATABNAE4ATwBQAFEAUgBTAFQAVQBWAFcAWABZAFoAWwBcAF0AXgBfAGAAYQCsAKMAhACFAL0AlgDoAIYAjgCLAJ0AqQCkAQIAigDaAIMAkwDyAPMAjQCXAIgAwwDeAPEAngCqAPUA9AD2AKIArQDJAMcArgBiAGMAkABkAMsAZQDIAMoAzwDMAM0AzgDpAGYA0wDQANEArwBnAPAAkQDWANQA1QBoAOsA7QCJAGoAaQBrAG0AbABuAKAAbwBxAHAAcgBzAHUAdAB2AHcA6gB4AHoAeQB7AH0AfAC4AKEAfwB+AIAAgQDsAO4AugEDAQQBBQEGAQcBCAD9AP4BCQEKAQsBDAD/AQABDQEOAQ8BAQEQAREBEgETARQBFQEWARcBGAEZARoBGwD4APkBHAEdAR4BHwEgASEBIgEjASQBJQEmAScBKAEpASoBKwD6ANcBLAEtAS4BLwEwATEBMgEzATQBNQE2ATcBOAE5AToA4gDjATsBPAE9AT4BPwFAAUEBQgFDAUQBRQFGAUcBSAFJALAAsQFKAUsBTAFNAU4BTwFQAVEBUgFTAPsA/ADkAOUBVAFVAVYBVwFYAVkBWgFbAVwBXQFeAV8BYAFhAWIBYwFkAWUBZgFnAWgBaQC7AWoBawFsAW0A5gDnAW4ApgFvAXABcQFyAXMBdAF1AXYBdwF4AXkBegF7AXwBfQF+AX8BgADYAOEA2wDcAN0A2QDfAYEBggGDAYQBhQGGAYcBiAGJAYoBiwGMAY0BjgGPAZABkQGSAZMBlAGVAZYBlwGYAZkBmgGbAZwBnQGeAZ8BoAGhAaIBowGkAaUBpgGnAagBqQGqAasBrAGtAa4BrwGwAbEBsgGzAbQBtQG2AbcBuAG5AboBuwG8Ab0BvgG/AcABwQHCAcMBxAHFAcYBxwHIAckBygHLAcwBzQHOAc8B0AHRAdIB0wHUAdUB1gHXAdgB2QHaAdsB3AHdAd4B3wHgAeEB4gHjAeQB5QHmAecB6AHpAeoB6wHsAe0B7gHvAfAB8QHyAfMAsgCzAfQB9QC2ALcAxAH2ALQAtQDFAIIAwgCHAfcAqwDGAfgB+QC+AL8B+gC8AfsA9wH8Af0B/gH/AgAAjADvAgECAgIDAgQCBQIGAgcCCAIJAgoCCwIMAg0CDgd1bmkwMEFEB0FtYWNyb24HYW1hY3JvbgZBYnJldmUGYWJyZXZlB0FvZ29uZWsHYW9nb25lawtDY2lyY3VtZmxleAtjY2lyY3VtZmxleAd1bmkwMTBBB3VuaTAxMEIGRGNhcm9uBmRjYXJvbgZEY3JvYXQHRW1hY3JvbgdlbWFjcm9uBkVicmV2ZQZlYnJldmUKRWRvdGFjY2VudAplZG90YWNjZW50B0VvZ29uZWsHZW9nb25lawZFY2Fyb24GZWNhcm9uC0djaXJjdW1mbGV4C2djaXJjdW1mbGV4B3VuaTAxMjAHdW5pMDEyMQxHY29tbWFhY2NlbnQMZ2NvbW1hYWNjZW50C0hjaXJjdW1mbGV4C2hjaXJjdW1mbGV4BEhiYXIEaGJhcgZJdGlsZGUGaXRpbGRlB0ltYWNyb24HaW1hY3JvbgZJYnJldmUGaWJyZXZlB0lvZ29uZWsHaW9nb25lawJJSgJpagtKY2lyY3VtZmxleAtqY2lyY3VtZmxleAxLY29tbWFhY2NlbnQMa2NvbW1hYWNjZW50DGtncmVlbmxhbmRpYwZMYWN1dGUGbGFjdXRlDExjb21tYWFjY2VudAxsY29tbWFhY2NlbnQGTGNhcm9uBmxjYXJvbgRMZG90BGxkb3QGTmFjdXRlBm5hY3V0ZQxOY29tbWFhY2NlbnQMbmNvbW1hYWNjZW50Bk5jYXJvbgZuY2Fyb24LbmFwb3N0cm9waGUDRW5nA2VuZwdPbWFjcm9uB29tYWNyb24GT2JyZXZlBm9icmV2ZQ1PaHVuZ2FydW1sYXV0DW9odW5nYXJ1bWxhdXQGUmFjdXRlBnJhY3V0ZQxSY29tbWFhY2NlbnQMcmNvbW1hYWNjZW50BlJjYXJvbgZyY2Fyb24GU2FjdXRlBnNhY3V0ZQtTY2lyY3VtZmxleAtzY2lyY3VtZmxleAd1bmkwMTYyB3VuaTAxNjMGVGNhcm9uBnRjYXJvbgRUYmFyBHRiYXIGVXRpbGRlBnV0aWxkZQdVbWFjcm9uB3VtYWNyb24GVWJyZXZlBnVicmV2ZQVVcmluZwV1cmluZw1VaHVuZ2FydW1sYXV0DXVodW5nYXJ1bWxhdXQHVW9nb25lawd1b2dvbmVrC1djaXJjdW1mbGV4C3djaXJjdW1mbGV4C1ljaXJjdW1mbGV4C3ljaXJjdW1mbGV4BlphY3V0ZQZ6YWN1dGUKWmRvdGFjY2VudAp6ZG90YWNjZW50BWxvbmdzBU9ob3JuBW9ob3JuBVVob3JuBXVob3JuB3VuaTAxRjAKQXJpbmdhY3V0ZQphcmluZ2FjdXRlB0FFYWN1dGUHYWVhY3V0ZQtPc2xhc2hhY3V0ZQtvc2xhc2hhY3V0ZQd1bmkwMjE4B3VuaTAyMTkHdW5pMDIxQQd1bmkwMjFCB3VuaTAyMzcFc2Nod2EHdW5pMDJCQwd1bmkwMkYzBGhvb2sIZG90YmVsb3cHdW5pMUUwMAd1bmkxRTAxB3VuaTFFM0UHdW5pMUUzRgZXZ3JhdmUGd2dyYXZlBldhY3V0ZQZ3YWN1dGUJV2RpZXJlc2lzCXdkaWVyZXNpcwd1bmkxRUEwB3VuaTFFQTEHdW5pMUVBMgd1bmkxRUEzB3VuaTFFQTQHdW5pMUVBNQd1bmkxRUE2B3VuaTFFQTcHdW5pMUVBOAd1bmkxRUE5B3VuaTFFQUEHdW5pMUVBQgd1bmkxRUFDB3VuaTFFQUQHdW5pMUVBRQd1bmkxRUFGB3VuaTFFQjAHdW5pMUVCMQd1bmkxRUIyB3VuaTFFQjMHdW5pMUVCNAd1bmkxRUI1B3VuaTFFQjYHdW5pMUVCNwd1bmkxRUI4B3VuaTFFQjkHdW5pMUVCQQd1bmkxRUJCB3VuaTFFQkMHdW5pMUVCRAd1bmkxRUJFB3VuaTFFQkYHdW5pMUVDMAd1bmkxRUMxB3VuaTFFQzIHdW5pMUVDMwd1bmkxRUM0B3VuaTFFQzUHdW5pMUVDNgd1bmkxRUM3B3VuaTFFQzgHdW5pMUVDOQd1bmkxRUNBB3VuaTFFQ0IHdW5pMUVDQwd1bmkxRUNEB3VuaTFFQ0UHdW5pMUVDRgd1bmkxRUQwB3VuaTFFRDEHdW5pMUVEMgd1bmkxRUQzB3VuaTFFRDQHdW5pMUVENQd1bmkxRUQ2B3VuaTFFRDcHdW5pMUVEOAd1bmkxRUQ5B3VuaTFFREEHdW5pMUVEQgd1bmkxRURDB3VuaTFFREQHdW5pMUVERQd1bmkxRURGB3VuaTFFRTAHdW5pMUVFMQd1bmkxRUUyB3VuaTFFRTMHdW5pMUVFNAd1bmkxRUU1B3VuaTFFRTYHdW5pMUVFNwd1bmkxRUU4B3VuaTFFRTkHdW5pMUVFQQd1bmkxRUVCB3VuaTFFRUMHdW5pMUVFRAd1bmkxRUVFB3VuaTFFRUYHdW5pMUVGMAd1bmkxRUYxBllncmF2ZQZ5Z3JhdmUHdW5pMUVGNAd1bmkxRUY1B3VuaTFFRjYHdW5pMUVGNwd1bmkxRUY4B3VuaTFFRjkHdW5pMjAwMAd1bmkyMDAxB3VuaTIwMDIHdW5pMjAwMwd1bmkyMDA0B3VuaTIwMDUHdW5pMjAwNgd1bmkyMDA3B3VuaTIwMDgHdW5pMjAwOQd1bmkyMDBBB3VuaTIwMEIHdW5pMjAxNQ11bmRlcnNjb3JlZGJsDXF1b3RlcmV2ZXJzZWQHdW5pMjAyNQZtaW51dGUGc2Vjb25kCWV4Y2xhbWRibAd1bmkyMDc0BGxpcmEGcGVzZXRhB3VuaTIwQUIERXVybwd1bmkyMTEzC2NvbW1hYWNjZW50B3VuaUZFRkYHdW5pRkZGRBNjaXJjdW1mbGV4dGlsZGVjb21iEmNpcmN1bWZsZXhob29rY29tYhNjaXJjdW1mbGV4Z3JhdmVjb21iE2NpcmN1bWZsZXhhY3V0ZWNvbWIOYnJldmVncmF2ZWNvbWIRY29tbWFhY2NlbnRyb3RhdGUNYnJldmVob29rY29tYg5icmV2ZWFjdXRlY29tYghjcm9zc2JhcglyaW5nYWN1dGUOYnJldmV0aWxkZWNvbWIAAQAB//8ADwABAAAADAAAAAAAAAACAAQAAgFVAAEBWQFaAAEBXwHuAAEB8AHxAAE=";
const MENU_FONT_REG  = "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cgBzAGkAbwBuACAAMwAuADAAMAAwAFIAbwBiAG8AdABvAE0AbwBuAG8ALQBSAGUAZwB1AGwAYQByAGgAdAB0AHAAOgAvAC8AdwB3AHcALgBhAHAAYQBjAGgAZQAuAG8AcgBnAC8AbABpAGMAZQBuAHMAZQBzAC8ATABJAEMARQBOAFMARQAtADIALgAwAAAAAAIAAAAAAAD/BgBkAAAAAQAAAAAAAAAAAAAAAAAAAAAB/QAAAAEAAgADAAQABQAGAAcACAAJAAoACwAMAA0ADgAPABAAEQASABMAFAAVABYAFwAYABkAGgAbABwAHQAeAB8AIAAhACIAIwAkACUAJgAnACgAKQAqACsALAAtAC4ALwAwADEAMgAzADQANQA2ADcAOAA5ADoAOwA8AD0APgA/AEAAQQBCAEMARABFAEYARwBIAEkASgBLAEwATQBOAE8AUABRAFIAUwBUAFUAVgBXAFgAWQBaAFsAXABdAF4AXwBgAGEArACjAIQAhQC9AJYA6ACGAI4AiwCdAKkApAECAIoA2gCDAJMA8gDzAI0AlwCIAMMA3gDxAJ4AqgD1APQA9gCiAK0AyQDHAK4AYgBjAJAAZADLAGUAyADKAM8AzADNAM4A6QBmANMA0ADRAK8AZwDwAJEA1gDUANUAaADrAO0AiQBqAGkAawBtAGwAbgCgAG8AcQBwAHIAcwB1AHQAdgB3AOoAeAB6AHkAewB9AHwAuAChAH8AfgCAAIEA7ADuALoBAwEEAQUBBgEHAQgA/QD+AQkBCgELAQwA/wEAAQ0BDgEPAQEBEAERARIBEwEUARUBFgEXARgBGQEaARsA+AD5ARwBHQEeAR8BIAEhASIBIwEkASUBJgEnASgBKQEqASsA+gDXASwBLQEuAS8BMAExATIBMwE0ATUBNgE3ATgBOQE6AOIA4wE7ATwBPQE+AT8BQAFBAUIBQwFEAUUBRgFHAUgBSQCwALEBSgFLAUwBTQFOAU8BUAFRAVIBUwD7APwA5ADlAVQBVQFWAVcBWAFZAVoBWwFcAV0BXgFfAWABYQFiAWMBZAFlAWYBZwFoAWkAuwFqAWsBbAFtAOYA5wFuAKYBbwFwAXEBcgFzAXQBdQF2AXcBeAF5AXoBewF8AX0BfgF/AYAA2ADhANsA3ADdANkA3wGBAYIBgwGEAYUBhgGHAYgBiQGKAYsBjAGNAY4BjwGQAZEBkgGTAZQBlQGWAZcBmAGZAZoBmwGcAZ0BngGfAaABoQGiAaMBpAGlAaYBpwGoAakBqgGrAawBrQGuAa8BsAGxAbIBswG0AbUBtgG3AbgBuQG6AbsBvAG9Ab4BvwHAAcEBwgHDAcQBxQHGAccByAHJAcoBywHMAc0BzgHPAdAB0QHSAdMB1AHVAdYB1wHYAdkB2gHbAdwB3QHeAd8B4AHhAeIB4wHkAeUB5gHnAegB6QHqAesB7AHtAe4B7wHwAfEB8gHzALIAswH0AfUAtgC3AMQB9gC0ALUAxQCCAMIAhwH3AKsAxgH4AfkAvgC/AfoAvAH7APcB/AH9Af4B/wIAAIwA7wIBAgICAwIEAgUCBgIHAggCCQIKAgsCDAINAg4HdW5pMDBBRAdBbWFjcm9uB2FtYWNyb24GQWJyZXZlBmFicmV2ZQdBb2dvbmVrB2FvZ29uZWsLQ2NpcmN1bWZsZXgLY2NpcmN1bWZsZXgHdW5pMDEwQQd1bmkwMTBCBkRjYXJvbgZkY2Fyb24GRGNyb2F0B0VtYWNyb24HZW1hY3JvbgZFYnJldmUGZWJyZXZlCkVkb3RhY2NlbnQKZWRvdGFjY2VudAdFb2dvbmVrB2VvZ29uZWsGRWNhcm9uBmVjYXJvbgtHY2lyY3VtZmxleAtnY2lyY3VtZmxleAd1bmkwMTIwB3VuaTAxMjEMR2NvbW1hYWNjZW50DGdjb21tYWFjY2VudAtIY2lyY3VtZmxleAtoY2lyY3VtZmxleARIYmFyBGhiYXIGSXRpbGRlBml0aWxkZQdJbWFjcm9uB2ltYWNyb24GSWJyZXZlBmlicmV2ZQdJb2dvbmVrB2lvZ29uZWsCSUoCaWoLSmNpcmN1bWZsZXgLamNpcmN1bWZsZXgMS2NvbW1hYWNjZW50DGtjb21tYWFjY2VudAxrZ3JlZW5sYW5kaWMGTGFjdXRlBmxhY3V0ZQxMY29tbWFhY2NlbnQMbGNvbW1hYWNjZW50BkxjYXJvbgZsY2Fyb24ETGRvdARsZG90Bk5hY3V0ZQZuYWN1dGUMTmNvbW1hYWNjZW50DG5jb21tYWFjY2VudAZOY2Fyb24GbmNhcm9uC25hcG9zdHJvcGhlA0VuZwNlbmcHT21hY3JvbgdvbWFjcm9uBk9icmV2ZQZvYnJldmUNT2h1bmdhcnVtbGF1dA1vaHVuZ2FydW1sYXV0BlJhY3V0ZQZyYWN1dGUMUmNvbW1hYWNjZW50DHJjb21tYWFjY2VudAZSY2Fyb24GcmNhcm9uBlNhY3V0ZQZzYWN1dGULU2NpcmN1bWZsZXgLc2NpcmN1bWZsZXgHdW5pMDE2Mgd1bmkwMTYzBlRjYXJvbgZ0Y2Fyb24EVGJhcgR0YmFyBlV0aWxkZQZ1dGlsZGUHVW1hY3Jvbgd1bWFjcm9uBlVicmV2ZQZ1YnJldmUFVXJpbmcFdXJpbmcNVWh1bmdhcnVtbGF1dA11aHVuZ2FydW1sYXV0B1VvZ29uZWsHdW9nb25lawtXY2lyY3VtZmxleAt3Y2lyY3VtZmxleAtZY2lyY3VtZmxleAt5Y2lyY3VtZmxleAZaYWN1dGUGemFjdXRlClpkb3RhY2NlbnQKemRvdGFjY2VudAVsb25ncwVPaG9ybgVvaG9ybgVVaG9ybgV1aG9ybgd1bmkwMUYwCkFyaW5nYWN1dGUKYXJpbmdhY3V0ZQdBRWFjdXRlB2FlYWN1dGULT3NsYXNoYWN1dGULb3NsYXNoYWN1dGUHdW5pMDIxOAd1bmkwMjE5B3VuaTAyMUEHdW5pMDIxQgd1bmkwMjM3BXNjaHdhB3VuaTAyQkMHdW5pMDJGMwRob29rCGRvdGJlbG93B3VuaTFFMDAHdW5pMUUwMQd1bmkxRTNFB3VuaTFFM0YGV2dyYXZlBndncmF2ZQZXYWN1dGUGd2FjdXRlCVdkaWVyZXNpcwl3ZGllcmVzaXMHdW5pMUVBMAd1bmkxRUExB3VuaTFFQTIHdW5pMUVBMwd1bmkxRUE0B3VuaTFFQTUHdW5pMUVBNgd1bmkxRUE3B3VuaTFFQTgHdW5pMUVBOQd1bmkxRUFBB3VuaTFFQUIHdW5pMUVBQwd1bmkxRUFEB3VuaTFFQUUHdW5pMUVBRgd1bmkxRUIwB3VuaTFFQjEHdW5pMUVCMgd1bmkxRUIzB3VuaTFFQjQHdW5pMUVCNQd1bmkxRUI2B3VuaTFFQjcHdW5pMUVCOAd1bmkxRUI5B3VuaTFFQkEHdW5pMUVCQgd1bmkxRUJDB3VuaTFFQkQHdW5pMUVCRQd1bmkxRUJGB3VuaTFFQzAHdW5pMUVDMQd1bmkxRUMyB3VuaTFFQzMHdW5pMUVDNAd1bmkxRUM1B3VuaTFFQzYHdW5pMUVDNwd1bmkxRUM4B3VuaTFFQzkHdW5pMUVDQQd1bmkxRUNCB3VuaTFFQ0MHdW5pMUVDRAd1bmkxRUNFB3VuaTFFQ0YHdW5pMUVEMAd1bmkxRUQxB3VuaTFFRDIHdW5pMUVEMwd1bmkxRUQ0B3VuaTFFRDUHdW5pMUVENgd1bmkxRUQ3B3VuaTFFRDgHdW5pMUVEOQd1bmkxRURBB3VuaTFFREIHdW5pMUVEQwd1bmkxRUREB3VuaTFFREUHdW5pMUVERgd1bmkxRUUwB3VuaTFFRTEHdW5pMUVFMgd1bmkxRUUzB3VuaTFFRTQHdW5pMUVFNQd1bmkxRUU2B3VuaTFFRTcHdW5pMUVFOAd1bmkxRUU5B3VuaTFFRUEHdW5pMUVFQgd1bmkxRUVDB3VuaTFFRUQHdW5pMUVFRQd1bmkxRUVGB3VuaTFFRjAHdW5pMUVGMQZZZ3JhdmUGeWdyYXZlB3VuaTFFRjQHdW5pMUVGNQd1bmkxRUY2B3VuaTFFRjcHdW5pMUVGOAd1bmkxRUY5B3VuaTIwMDAHdW5pMjAwMQd1bmkyMDAyB3VuaTIwMDMHdW5pMjAwNAd1bmkyMDA1B3VuaTIwMDYHdW5pMjAwNwd1bmkyMDA4B3VuaTIwMDkHdW5pMjAwQQd1bmkyMDBCB3VuaTIwMTUNdW5kZXJzY29yZWRibA1xdW90ZXJldmVyc2VkB3VuaTIwMjUGbWludXRlBnNlY29uZAlleGNsYW1kYmwHdW5pMjA3NARsaXJhBnBlc2V0YQd1bmkyMEFCBEV1cm8HdW5pMjExMwtjb21tYWFjY2VudAd1bmlGRUZGB3VuaUZGRkQTY2lyY3VtZmxleHRpbGRlY29tYhJjaXJjdW1mbGV4aG9va2NvbWITY2lyY3VtZmxleGdyYXZlY29tYhNjaXJjdW1mbGV4YWN1dGVjb21iDmJyZXZlZ3JhdmVjb21iEWNvbW1hYWNjZW50cm90YXRlDWJyZXZlaG9va2NvbWIOYnJldmVhY3V0ZWNvbWIIY3Jvc3NiYXIJcmluZ2FjdXRlDmJyZXZldGlsZGVjb21iAAEAAf//AA8AAQAAAAwAAAAAAAAAAgAEAAIBVQABAVkBWgABAV8B7gABAfAB8QAB";
const MENU_LOGO      = "iVBORw0KGgoAAAANSUhEUgAAATQAAAEsCAIAAADCZtg+AAAUXklEQVR4nO2d7XHjvA6FmTtvH6tUYm0lViqxXIntSqxUYm0luT8w69FaH6YAkATJ8/zYyWZimTZ1iAMSpD5+fn4cAMAe/0vdAADAMhAnAEaBOAEwyn+pGwBAJMZxpH+/v7/pB/rNMAxN0zjnmqZ5/vDr1y/6uW3bNM117gMTQqBsxnG83W5937Ov0DRN13WHwyGyUCFOUCAkSOecRJNzIqsU4gRFcT6fh2EYhiHouzRN07bt8XgMqlKIExTCMAxfX1+URkaj67rT6UTZqToQJ8iecRx///4dWZZPyOsej0d1iUKcIGPGcfz6+gptYn0giZ5OJ8VrQpwgS+RzsCHQlSjECfJjGIbfv3+nbsUqXdddLhf5dVAhBDLjer1aVqZz7nq9fn5+ynNgiBPkxPl8/vr6St2K99AclTAZhq0FeWBn7scfYQoKcYIMyFGZT/q+5+kT4gTWMT7940Pbtvf7fe+rkHMC01DMTN0KKcMwnM/nva+COIFp4lfkBaLv+736hDiBXeQTnqa4Xq+7Pg7ECYxC+0tSt0ITsuj+RgATQsAi4SaBaHnDOUdnHTxPP3ieiuCc+/PnT7h9Z03TPB4Pn7+EOIE5xnH8/PzUvSZjn/Q4jsMw3G43dZX61vf9AGAM3R3MTdNcLhdJex6Ph3qFvU+TIE5gC5WScUIuyym6Em2a5u07QpzAFlpblvu+D9E8RYl2Xbf9XhAnMIRK2Gya5n6/B22nij5pZmjjXTAhBAzx8fEhvAKvUI6Bynzy9swQ1jmBFRgFbi90XRdHmc65tm0fj4fQhL9ZsAka/QHwxHPpb4NASebbZgv1uZF5wtYCE3x9fV2vV/bLo7nZOfJV2fv9vrh6BFsLTJCpMt3f+SfJFehw+jkQJ0iPRJm0mKnXFg5t20rmb9fSTogTpIce+8XjcrkEOnB9F6fTiV3YRHWC899DnCA97OLVtm0TPqLvBUkAXxyeIE6QmOv1yt5OrXvCupDnfhcGi8Ye4gSJYXvaruvshE2CPVgsOluIEySG7WlNhU1CMjs1H6QgTpCSYRh4nrbrOgvzQHPYwRyRE9iC7WkPh4NuS7Sg5+oyXjgfpyBOkBL2VBB76iUCx+OR90KIE2SPZWU6gbN9AeIEKeHNBpn1tATb2SJyguyxtoIyh9fCP3/+TP8LcYKU8HJOm/O06kCcAOjDM94vJh/iBMngJZz2Pa0WECdIRsGeltdITAgBEByVEQTiBMlQCS8lgcgJQHBU0mmIEySj4Mipkk5DnAAYBeIEyXg+G3MX4zjaD54vtT6eIHICQ5TqbHkt/PXr1/S/ECfIj7WDXu0gOezzCcQJUsKLnIEeCK8FW5mYrQWGYNtay/qUHMM7BeIEKWHvzNQSQAjYAwcmhIAh2GVuKkldCNjH8M6Pd4A4QUokhwbY1Cd7smp+8hAeAQgSw35END22Xb09Eq7X69fXF++1cyUicoLEsJ3tOI5sJQSC/XDuxSPLIE6QGLazdYIzqUNwPp/ZjVmcGIOtBemRuMG0T859wjbnxKIMETlBeiQnjwzDkNzcjuMoUebaMbwQJ0iPxNk6567XKzvZU0E4Oqwu9v4AYAChNW2a5n6/J2m58MCxtm3XrgxxAisI73J6/F7kNssfDLExpkCcwAryRcumafq+j9Za+SGdG2HzB+IEplB5QlEEfT4eD5Xz9batOMQJDKFV8UPFQ4EaqbVy03Xd9htBnMAWfd+r3PohLK6KlX3ydviAOIEtdMtltST6eDx0Hwr6Nmz+/PygQgiYQ1IwtAitox6Px71xbxzH2+2mvgPGs2Qf4gQWOZ/PWv52Cqn0cDi0bbs2o0P1sbfbbRiGQOct3O93n2EC4gQWoR0noc8iIX3SCZ3jX4K+o/NWpoM4gVmoYNXOphMV+r4/nU6efwxxAruM4/j5+Zm6FWrs3UCDwndgF6qYTd0KHRhb2yBOYJq2bUPMDEWG6n73vgriBNY5nU5Z65PiP6PcDzknyINM54ckBzUgcoI8YMefhPR9L8mZIU6QDaTPXCzu5XLxXzVZBOIEOdE0zfF4NK5PGkTktbjIOUGWnM9n9oMPgqJ41DXECXKFqtLtRFFaL1HcUwZxgryxINGmabquE2aYcyBOUALjOJLRjfy+gWRJQJygHOLsZSGCypKAOEFp0HOvv7+/QwRS0iTtCFW/+AsQJygWRZWSJo/HY8wqCIgTVMFTqPTzxr7q6Q5s+jmod90A4gT1Qvp8qvSpRiNAnAAYBeV7ABgF4gTAKBAnAEaBOAEwCsQJgFEgTgCMAnECYBSIEwCjQJwAGAXiBMAoECcARoE4ATAKxAmAUSBOAIwCcQJgFIgTAKNAnAAYBeIEwCgQJwBGgTgBMArECYBRIE4AjAJxAmAUiBMAo0CcABgF4gTAKBAnAEaBOAEwCsQJgFEgTgCMAnECYBSIEwCjQJwAGAXiBMAoECcARvkvdQN8GYZB5TpN0zRNo3Kp2kAXxOYnBy6Xi9bn7bou9afJEsUu6Ps+9afJgzxs7ff3t9altIb/2kAXxOfj5+cndRve8/n5OY6j1tXu93vbtlpXq4SPjw+tSzVN83g8tK5WMBlEzmEYFJXpnLvdbopXq4Hr9ap4tXEcdS9YKhmIU1eZDrZqP4qelsD46EMGtlbX0xJwtrtQ9LQEnK0PNUZOFyAUFEwICzqOI/zLW6yLM1BygpzHn0AD2fl8DnHZkrAuzkDJCUZufwJ9USEMUWFYF2c4CcHZ+nC9XgOpCOPjW0yLM6j5hLP1IegQBme7jWlxBp1wx8jtQ9CvCM52G9PiDC0eONttwnlaAuPjNnbFGcF2wtluE2HwgrPdwK44I9wZGLm3ifDlwNluYFecccIanO0a6iXNi2B83MCoOKMZTtwZa0QbtlBnu4ZRcfLuDEa57DAM0OcivPGRccQBvv81jIqTd2fwdusj7VmE97UwugDOdg2L4uQps+s63uE0sFVzJF3AeCG6YBGL4pRkO4ybA5FzDk8th8OhaRpecsF4u+KxKE5eVx0OB8dKO7Exfw6vC+jL53UB9DnHnDjZVSl0T5BE9wJbNYU9VJFtQRdoYU6c7HlaujN4OQ+c7RSeTrquox94XYDIOcecOHmd9LwheDkPbNUUSVrhuGdGowvm2BIn29NOrRTvcCAUeRJsTzv92nnBE9VaL9gSJ7t7pncGL+eBsyXYXTAV5PF4ZFwB03KvpD5y/h/Yj9CYXoR9rNv9fk/0uQ3B++peHnKBLlDBUORkV1o/pyIIXtrp4GwFsevFrbAHWTjbKYbEyZ5Mn/tYnjjhbFXSirXf+ABnO8WQONmTdfP7gJ12Vj5hKFzhnMIeHyvvgimGxMkOXPM7g22ral4KZyvzJa0geHNCDs52ghVx6t4Z7LSz5mGbrYpFn8IeH2vughesiJM9GbPmYGGr9qKYVmz//m0zqu2CF6yIk+1p1+4AXtrpanW2koP21oIknK0QE+KUeNq1OwO2ahdsPSymFQT7OW51dsEcE+IMEazYaWedzpb9kTccCq/IVtKYwjAhTnZnbBsn9shdm7OVeNrtL5ntX7Dg6SyIU9IN23cGO+2sbeQOd/TE6XTiXba28XGR9OJkd8NGtkOwh+3anC37wwbtAt4LSyK9OENkOwQ77XQ1TRhKDo8O1wW1jY+LJBZnOE/r/zeL1JPzSAzk28jpBF2AfQiJxRn6oD32Uls9I3c4T0uwM38421wjp+edAWf7FvXaA96fzalnfFwjpTgl1pE9HvtTg7OVfEZPVyIZHyt3tinFKQlN/v3Nns2vYeSW3P3+IZEtzsqdbZaRc1fpCdtWuQqcLfvu90wrCEnaWfz4uEEycYaep30isVVlO9toaYVkfKzZ2SYTpyQo7Z2DldiqgkduySJKtPGxZmebTJySm35vT0tmjwp2tuwuYFS0Y02LQRpxSiqtd2U7hMRWlXpnREsr2C95Um2dbRpxSsIRIwxKbFWpG/MldzwjDAq7gPfC3EkjzpielmDbKleos43fBcj895JAnBJP67geVWKryrszJJ6WkVYQksy/TmebQJySQMS+MzBhOCVyWkEg899LAnFKvmiJO5WIs7AFz8izQYRwfKxQnwnEKQlEEncKW0VIlMk+FoiQjK0ldYEnscWZJNshJHdVSc42Tkmz+ssrjJyxHwEoUcjlchG+u+TmKObpdOxvQOVLQBf4EztypvK0hMRWlVHkKUye5V0guUKRa1obRBVnwmyHkNwZZTjbJFPlUySZf2HTcm+JKs5oldZrYMJQ8hFUNrgLM/8CusCfqOJMtYgyRSLy3J2tsPwj+fjoKnO28cSZPNshJMN/7s5W6GnlaQUhGWercrbxxBn6CEZParZVyT0tIcz8s+6CXcQTp5E7Q2ir8l0Kt+BpCThbTyKJ04inJdhHfrmcl8KF97SWpyVQjeBDJHEayXaIOp2tpNmKaQUhSTtL3WE7J4PIqX5EbYXOdhxHiae11gWVONsY4jTlaQnhyK3XkEgI26weOR12kPkQoURQ2LUhmvR4PCRNyq7IU6KErutCNOl+v0u64PF4hGiVKaxHzhBjtqvP2ZrytIRwHqGG4BlcnEJPq1UYNKeeCUODaYWrb3xkEFycwtw90J3hxKVCGelTWP6hO1U+RTLy5l6t5UNwcZqawZ8ilH1GE4ZGyj/mCEuFii/lCytOYVVK6Of8ScSfy51h09MScLbbhBWnMLwEjZxObKuycLbCOzicpyWww3aDsOI062kJ4Z2XhbM13gU1jI9sAorTuKd1Yltl39manSp/IuyC3HfYbhNQnGbnaadIiuDtj9xZdAGc7RoBxSk0VKGzHaJsZ2uw/GNOPWtaewklzmEY4j8QhfdGpTpbYdsipBVE27ZwtouEEqdwkjBCtqPyXpZHbuNT5VNw3vciASOn5OXRIqcrtxohC09LlDo+CgklTsl4FvnOEDpbm3dGLp6WEI7FpVYjBBGn/Rn8F4TiNKjPLOZpnxQ5PioQYh+asGtDNGkb4fbOvu/jt3kbgxs4txFu78xuh60PQSKn8aqUOYWN3PbLP+bA2c7RF2de2c6TkpbC8/K0RGHjow7qsTg7T0sIna388YSKCKNQqmbD2b6gHzmz87REMduXhJ42bRdIXm6nC7RQFmemnpYow9kKPa2k2FgInO0LyuLMMdt5UkaRZ0blH3NQjfAPui5Z0pIkM/gvSEaHtm1TN1+atiXvgvLWtCRoRs6sPS2Ru7PNqKR5kYL3ITDQFGfWnpbI3dkKG2ChC+Bsn1iJnNE2cG4jbEPy7UuZztNOKXUfAgM1cRbgaZ1zTdNI7tG0zraYLoCzJdTEWYCnJfK1VcK4bSRyOjz6+i9q4sx6Bn9Kvs62AE9LCOelinG2OuLMtypljtBWpXK2ZXhaAs6W0BFnvlUpi+R4JJ9wEcVOWkHA2TotcRbjaYkcizyzOOvQHzhbpyLOkjwtkV2RZ0melsiuC0KgIE7hKJW8KmWRvOZsC/O0RHlnx+xFQZwFVKXMEbYqsrMtzNMSwnhuoZpSiFScwsOjDXpaIiNbVZ6nJXLM/HWRilP4FZi9M1w+E4bFlH+8kHW1lg7CXS2ZnojhQy7blySNNN4Fwh1wps6OYSCNnEV6WiKLpXDhu9jvAsnLc3e2InGWmu08se9sCyv/eCHTai01JGFXOLA9Hg+l+B8K+8624LSCqPlIPlH3SL615CdieCIZuZumCdq2y+VSfBcIx0cLZ8ew4dva4j0tYdnZFln+8ULNzpYvziKrUuYIB5GgRZ5Fln/MyataSxN2zJW8aRaGihDaqnDOtgZPS1TrbJmRsxJP6zSWwgON3MKYnFcX1OlsmeKsxNMSNrcvCTVvfIXzhTqdLVOckk/btq3NSus1hK0NcWeUWtK8Rl77ELTgiFPoafNSptMoglfXZ8ElzYtktA9BEY44y65KWUTYZnVnW5WnJSyvaQUCkdMLa862Kk9LCDP/HJ3tbnGWXWm9hqkJw3qmyqdU6Gx3i7OGqpRFhEfyKW5SER6Nm9dU+ZTqnO3ehdHIb2cHO0vhkmZkVHswR9gF2X32fZGzTk9LGHG2dXpaojZnu0+c1XpawsJSeFXlH3Oqcrb7xFlJpfUawvarPEalyIP2/LG8D0GdHeIs7/DovSR3tjV7WkI4uOT1GJUd4qyn0nqDtM62ck/rDO9DCIL/3FHxJ2L4kHbOVvLWoY9liIbw4JJopyLK8Y2c8LREQmcrtGQFhE2iHmfrK0542iepJgwrLGleRD4+ZuNsPSMsPO2TVM5W8qaFdUElztYrcta2e3CbJM625vKPOZU4Wy9xCtcASvK0RHxbVXn5xwu1OFuf8Fr84dF7EdoqRpGn5O1cWZ6WqMHZBo+cBVSlzGnbNmaRJzztHGs7bEPwXpyoSlkkpq2Cp51j8OwYdd6LE1UpiwgHnV3fauUlzWvYPBVRkffirLzSeo1otgrlH2sIB53sIyc87RrRijxR/rFG8n0IoXkjTnjaDeLYqgoP2vNHuA/B+oLn9mSu5MrFVFqvEeExKvU8EIWHnbNjQrAVOVFpvU2EpXB42m3KdrZb4kSl9VtCHzYNT/uWkkuFNqJquCsXQ1BnG78OKUcKdrarkRNVKT4EdbbwtD4U7GxXxYmqFE/COVvk/J4U62zXQmqgy5ZHOGcruWwlnpYQ+n+zznY5csLT+hPI2aL8wx/hPgSzznZZnPC0uwhRjYDyj10U6WyXxYlK612EKPJESfMuYu5DiMaCOFFpvRf17UvwtHspcnvngjgxg89AGDxfvnN42r2Uedj0fI4IB+0x0F0Kl1yq2i4or2bjNXLC0/JQXArHVDmP8pztqzjhadkIxfnUJEqaeRR4JN9LJIWnZaPlbCUXqbwLCnO2/0ROHB4tQcXZwtNKKMzZ/iNO4SRhzZ6WkNsqlH9IKM3ZTsMoDo8WIi/ylLzc1e1piZIOm/74ESc5AIAQ7HiyNQAgJhAnAEaBOAEwCsQJgFH+DzIs6YYljq07AAAAAElFTkSuQmCC";


// Section breaks after these course indices (0-based)
const MENU_SECTIONS = [4, 10, 14]; // after snacks, after fish/meat block, after cheese

const MILKA_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 58 68" fill="#000">
  <circle cx="46" cy="10" r="10"/>
  <path d="M2,66 L2,30 L20,52 L38,24 L38,66 L34,66 L34,27 L20,50 L6,30 L6,66 Z"/>
</svg>`;


const RESTRICTION_PRIORITY_KEYS = [
  "vegan","veg","pescetarian","gluten","dairy","nut","shellfish",
  "no_red_meat","no_pork","no_game","no_offal","egg_free","no_alcohol",
  "no_garlic_onion","halal","low_fodmap"
];

const RESTRICTION_COLUMN_MAP = {
  veg: "veg",
  vegan: "vegan",
  pescetarian: "pescetarian",
  gluten: "gluten_free",
  dairy: "dairy_free",
  nut: "nut_free",
  shellfish: "shellfish_free",
  no_red_meat: "no_red_meat",
  no_pork: "no_pork",
  no_game: "no_game",
  no_offal: "no_offal",
  egg_free: "egg_free",
  no_alcohol: "no_alcohol",
  no_garlic_onion: "no_garlic_onion",
  halal: "halal",
  low_fodmap: "low_fodmap",
};

function applyCourseRestriction(course, activeRestrictions, lang = "en") {
  const baseDish = course?.menu || null;
  if (!baseDish) return null;

  let dish = {
    name: String(baseDish.name || "").trim(),
    sub: String(baseDish.sub || "").trim(),
  };

  const courseRestrictions = course?.restrictions || {};

  for (const key of RESTRICTION_PRIORITY_KEYS) {
    if (!(activeRestrictions || []).includes(key)) continue;
    const mapped = RESTRICTION_COLUMN_MAP[key] || key;
    // Prefer SI variant when generating a Slovenian menu
    const siMapped = lang === "si" ? `${mapped}_si` : null;

    if (courseRestrictions[mapped]) {
      const next = (siMapped && courseRestrictions[siMapped]) ? courseRestrictions[siMapped] : courseRestrictions[mapped];
      // If the cell had a | separator, next.sub is non-empty → full name+sub replacement.
      // If no | separator, next.sub is empty → sub-only replacement, keep original dish name.
      if (next?.sub) {
        dish = { name: String(next.name || dish.name).trim(), sub: String(next.sub).trim() };
      } else if (next?.name) {
        dish = { name: dish.name, sub: String(next.name).trim() };
      }
      break; // highest-priority matching restriction wins
    }

    // backward compatibility for older static menu data
    if (mapped === "veg" && course?.veg) {
      const v = course.veg;
      if (v?.sub) {
        dish = { name: String(v.name || dish.name).trim(), sub: String(v.sub).trim() };
      } else if (v?.name) {
        dish = { name: dish.name, sub: String(v.name).trim() };
      }
    }
  }

  return dish;
}


function generateMenuHTML({ seat, table, menuTitle = "WINTER MENU", teamNames = "", menuCourses = MENU_DATA, beerChoice = null, lang = "en", seatOutputOverrides = {}, thankYouNote = "Thank you for your visit." }) {
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
  const hasBeetroot = !!(extras[1]?.ordered || extras["1"]?.ordered);
  const hasCheese = !!(extras[2]?.ordered || extras["2"]?.ordered);
  const hasCake = !!(table.birthday || extras[3]?.ordered || extras["3"]?.ordered);

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
  // Non-pairing: cocktails fill early course right columns; glasses distribute from Danube like bottles
  const aperitivoQueue = hasPairing ? [] : [...cocktails.map(c => ({ ...c, __type: "cocktail" }))];
  const glassByGlassQueue = hasPairing ? [] : [...glasses.map(w => ({ ...w, __type: "wine" }))];

  // Pairing case: keep existing behaviour (all aperitivos/glasses/bottles as wine-only rows at top)
  const topRightItems = hasPairing ? [
    ...cocktails.map(c => ({ ...c, __type: "cocktail" })),
    ...glasses.map(w => ({ ...w, __type: "wine" })),
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
    // For SI menus, prefer the SI pairing variant when available
    let drink = pkey ? (lang === "si" ? (course[`${pkey}_si`] || course[pkey]) : course[pkey]) : null;

    if (pkey && (course.force_pairing_title || courseKey === "crayfish" || i === CRAYFISH_IDX)) {
      const fpName = (lang === "si" && course.force_pairing_title_si) ? course.force_pairing_title_si : (course.force_pairing_title || "KITCHEN MARTINI");
      const fpSub  = (lang === "si" && course.force_pairing_sub_si)   ? course.force_pairing_sub_si   : (course.force_pairing_sub   || "");
      drink = { name: fpName, sub: fpSub };
    }

    const beetrootExtra = extras[1] || extras["1"];
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

    // Before the very first course row, insert the first aperitivo as a wine-only row
    // so it appears visually "above" the first course (one slot above Sour Soup)
    if (courseRowsSeen === 0 && aperitivoQueue.length > 0) {
      rows.push({ type: "wine-only", right: fmtDrinkParts(aperitivoQueue.shift()) });
    }

    if ((courseKey === "chicken_gizzard" || courseName === "CHICKEN GIZZARD") && selectedBeer) {
      // For SI menus with default beer list, prefer the course's SI pairing variants
      if (lang === "si" && beers.length === 0) {
        const siKey = beerChoice === "nonalc" ? "na" : "wp";
        const siDrink = course[`${siKey}_si`] || course[siKey];
        drink = siDrink ? { name: siDrink.name || "", sub: siDrink.sub || "" } : { name: selectedBeer.title || "", sub: selectedBeer.sub || "" };
      } else {
        drink = { name: selectedBeer.title || "", sub: selectedBeer.sub || "" };
      }
    } else if (aperitivoQueue.length > 0) {
      // Fill empty right column with next aperitivo (cocktail)
      const d = fmtDrinkParts(aperitivoQueue.shift());
      drink = { name: d.title || "", sub: d.sub || "" };
    } else if (i >= DANUBE_SALMON_IDX && glassByGlassQueue.length > 0) {
      // From Danube onwards: by-the-glass wines fill right column
      const d = fmtDrinkParts(glassByGlassQueue.shift());
      drink = { name: d.title || "", sub: d.sub || "" };
    } else if (!hasPairing && i >= DANUBE_SALMON_IDX && bottleQueue.length > 0) {
      const nextBottle = bottleQueue.shift();
      const d = fmtDrinkParts(nextBottle);
      drink = { name: d.title || "", sub: d.sub || "" };
    }

    // Apply ephemeral per-seat output overrides (applied after restrictions)
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
  const _suffix = [11, 12, 13].includes(_d) ? "th" : _d % 10 === 1 ? "st" : _d % 10 === 2 ? "nd" : _d % 10 === 3 ? "rd" : "th";
  const _MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const menuDate = `${_d}${_suffix} of ${_MONTHS[_today.getMonth()]}, ${_today.getFullYear()}`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${safeTitle}</title>
<style>
@font-face{font-family:'RM';font-weight:700;src:url('data:font/truetype;base64,${MENU_FONT_BOLD}') format('truetype');}
@font-face{font-family:'RM';font-weight:400;src:url('data:font/truetype;base64,${MENU_FONT_REG}') format('truetype');}
*{margin:0;padding:0;box-sizing:border-box;}
:root{--page-w:148mm;--page-h:210mm;--pad-t:8.4mm;--pad-r:12mm;--pad-b:8.2mm;--pad-l:12mm;--inner-h:calc(var(--page-h) - var(--pad-t) - var(--pad-b));}
@page{size:A5 portrait;margin:0;}
html,body{width:var(--page-w);height:var(--page-h);overflow:hidden;background:#fff;color:#000;font-family:'RM', monospace;font-size:6.75pt;line-height:1.08;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
body{position:relative;}
#sheet{width:var(--page-w);height:var(--page-h);overflow:hidden;position:relative;background:#fff;}
#frame{position:absolute;inset:0;padding:var(--pad-t) var(--pad-r) var(--pad-b) var(--pad-l);overflow:hidden;}
#scaleTarget{width:100%;min-height:var(--inner-h);display:flex;flex-direction:column;transform-origin:top left;}
#header{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;column-gap:8.6mm;margin-bottom:7mm;}
#title{font-size:13.9pt;font-weight:700;letter-spacing:0.035em;}
#menu-date{font-size:5.8pt;font-weight:400;letter-spacing:0.02em;margin-top:0.8mm;}
#logo img{width:18.2mm;display:block;}
#menu{width:100%;}
.menu-row,.menu-section-row{display:grid;grid-template-columns:minmax(0,${hasPairing ? "0.85fr) minmax(0,1.15fr" : "1fr) minmax(0,1fr"});column-gap:${hasPairing ? "9mm" : "10.8mm"};align-items:start;break-inside:avoid;page-break-inside:avoid;}
.menu-row{margin-bottom:3.15pt;}
.menu-row.wine-only{margin-bottom:4.5pt;}
.menu-row.after-crayfish{margin-bottom:7.2pt;}
.menu-row.short-after-trout-belly,.menu-row.short-after-venison{margin-bottom:10pt;}
.menu-row.section-gap-before{margin-top:14.5pt;}
.menu-col{min-width:0;}
.menu-main{font-weight:700;line-height:1.02;letter-spacing:0.012em;overflow-wrap:anywhere;text-transform:uppercase;}
.menu-sub{line-height:1.08;margin-top:0.75pt;overflow-wrap:anywhere;}
.menu-section-row{margin:6.8pt 0 6.2pt;}
.menu-section-label{font-weight:700;letter-spacing:0.042em;padding-top:0.6pt;text-transform:uppercase;}
.menu-thankyou{margin-top:7pt;font-size:6.55pt;font-style:normal;font-family:'RM',monospace;}
#footer{margin-top:auto;padding-top:9.5pt;}
#team{font-size:6.5pt;line-height:1.2;overflow-wrap:anywhere;}
#team .menu-main{margin-bottom:1.4pt;}
</style>
</head>
<body>
<div id="sheet"><div id="frame"><div id="scaleTarget"><div id="header"><div id="title">${safeTitle}<div id="menu-date">${esc(menuDate)}</div></div><div id="logo"><img src="data:image/png;base64,${MENU_LOGO}" alt="Milka"></div></div><div id="menu">${rowsHtml}</div><div id="footer"><div id="team"><div class="menu-main">TEAM:</div><div>${esc(teamNames)}</div></div></div></div></div></div>
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

const pairingStyle = {
  "—":        { color: "#666", border: "#d8d8d8", bg: "#f5f5f5" },
  "Non-Alc":  { color: "#1f5f73", border: "#7fc6db88", bg: "#7fc6db12" },
  "Wine":      { color: "#8a6030", border: "#c8a06088", bg: "#c8a06008" },
  "Premium":   { color: "#5a5a8a", border: "#8888bb88", bg: "#8888bb08" },
  "Our Story": { color: "#3a7a5a", border: "#5aaa7a88", bg: "#5aaa7a08" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const fuzzy = (q, wineList, byGlass = null) => {
  if (!q) return [];
  const lq = q.toLowerCase();
  return wineList.filter(w => {
    const hit = w.name.toLowerCase().includes(lq) || w.producer.toLowerCase().includes(lq) || w.vintage.includes(lq);
    return hit && (byGlass === null || w.byGlass === byGlass);
  }).slice(0, 6);
};

const fuzzyDrink = (q, list) => {
  if (!q) return [];
  const lq = q.toLowerCase();
  return list.filter(d =>
    d.name.toLowerCase().includes(lq) || (d.notes || "").toLowerCase().includes(lq)
  ).slice(0, 6);
};

const makeSeats = (n, ex = []) =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    water:     ex[i]?.water     ?? "—",
    glasses:   ex[i]?.glasses   ?? [],
    cocktails: ex[i]?.cocktails ?? [],
    spirits:   ex[i]?.spirits   ?? [],
    beers:     ex[i]?.beers     ?? [],
    pairing:   ex[i]?.pairing   ?? "",
    extras:    ex[i]?.extras    ?? {},
  }));

const fmt = d => `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;

// ── Blank table factory ───────────────────────────────────────────────────────
const blankTable = id => ({
  id, active: false, guests: 2, resName: "", resTime: "", guestType: "", room: "",
  arrivedAt: null, menuType: "", pace: "", bottleWines: [],
  restrictions: [], birthday: false, notes: "", seats: makeSeats(2),
  kitchenLog: {}, tableGroup: [],
});

const initTables = Array.from({ length: 10 }, (_, i) => blankTable(i + 1));

// ── sanitizeTable: fill any missing fields so stale Supabase data never breaks UI ──
const sanitizeTable = t => ({
  ...blankTable(t.id ?? 0),
  ...t,
  bottleWines: Array.isArray(t.bottleWines) ? t.bottleWines : (t.bottleWine ? [t.bottleWine] : []),
  seats: makeSeats(
    t.guests ?? 2,
    Array.isArray(t.seats) ? t.seats : []
  ),
  restrictions: Array.isArray(t.restrictions) ? t.restrictions : [],
  kitchenLog: t.kitchenLog && typeof t.kitchenLog === "object" ? t.kitchenLog : {},
  courseOverrides: t.courseOverrides && typeof t.courseOverrides === "object" ? t.courseOverrides : {},
  tableGroup: Array.isArray(t.tableGroup) ? t.tableGroup : [],
});

// ── Shared styles ─────────────────────────────────────────────────────────────
const baseInp = {
  fontFamily: FONT, fontSize: MOBILE_SAFE_INPUT_SIZE, // 16px prevents iOS auto-zoom
  padding: "10px 12px", border: "1px solid #e8e8e8",
  borderRadius: 2, outline: "none",
  color: "#1a1a1a", background: "#fff",
  boxSizing: "border-box", width: "100%", minWidth: 0,
  WebkitAppearance: "none", // removes iOS styling
};
const fieldLabel = {
  fontFamily: FONT, fontSize: 9,
  letterSpacing: 3, color: "#444",
  textTransform: "uppercase", marginBottom: 8,
};
const topStatChip = {
  fontFamily: FONT,
  fontSize: 10,
  color: "#1a1a1a",
  letterSpacing: 1,
  padding: "6px 10px",
  border: "1px solid #e8e8e8",
  borderRadius: 999,
  background: "#fff",
  whiteSpace: "nowrap",
};
const statusPill = (isLive, label) => ({
  fontFamily: FONT,
  fontSize: 9,
  letterSpacing: 2,
  padding: "6px 10px",
  border: `1px solid ${isLive ? "#8fc39f" : "#d8d8d8"}`,
  borderRadius: 999,
  background: isLive ? "#eef8f1" : "#f6f6f6",
  color: isLive ? "#2f7a45" : "#555",
  fontWeight: 600,
  whiteSpace: "nowrap",
});

const STORAGE_KEY = "milka-service-board-v8";
const SERVICE_TABLES_TABLE = import.meta.env.VITE_SUPABASE_SERVICE_TABLES || "service_tables";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
const supabase = hasSupabaseConfig ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

const defaultBoardState = () => ({
  tables: initTables,
  dishes: initDishes,
  wines: initWines,
  cocktails: initCocktails,
  spirits: initSpirits,
  beers: initBeers,
});

const readLocalBoardState = () => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

const writeLocalBoardState = state => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
};

const circBtnSm = {
  width: 36, height: 36, borderRadius: "50%",
  border: "1px solid #e8e8e8", background: "#fff",
  color: "#444", fontSize: 18, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: FONT, lineHeight: 1, touchAction: "manipulation",
};

function useIsMobile(bp = 700) {
  const getValue = () => (typeof window !== "undefined" ? window.innerWidth < bp : false);
  const [isMobile, setIsMobile] = useState(getValue);

  useEffect(() => {
    const onResize = () => setIsMobile(getValue());
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [bp]);

  return isMobile;
}

// ── Water Picker ──────────────────────────────────────────────────────────────
function WaterPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    document.addEventListener("touchstart", h, { passive: true });
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("touchstart", h);
    };
  }, []);
  const ws = waterStyle(value);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)} style={{
        fontFamily: FONT, fontSize: 12, fontWeight: 500,
        padding: "6px 10px", border: "1px solid #e8e8e8",
        borderRadius: 2, cursor: "pointer", width: "100%",
        background: ws.bg, color: ws.color, letterSpacing: 1,
      }}>{value}</button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 3px)", left: 0,
          background: "#fff", border: "1px solid #e8e8e8", borderRadius: 2,
          zIndex: 200, overflow: "hidden", boxShadow: "0 4px 20px rgba(0,0,0,0.08)", minWidth: 70,
        }}>
          {WATER_OPTS.map(opt => (
            <div key={opt} onMouseDown={() => { onChange(opt); setOpen(false); }} style={{
              padding: "8px 14px", cursor: "pointer",
              fontFamily: FONT, fontSize: 12, letterSpacing: 1,
              color: value === opt ? "#1a1a1a" : "#999",
              background: value === opt ? "#f8f8f8" : "#fff",
              fontWeight: value === opt ? 500 : 400,
              borderBottom: "1px solid #f5f5f5",
            }}>{opt}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Wine Search ───────────────────────────────────────────────────────────────
function WineSearch({ wineObj, wines = [], onChange, placeholder, byGlass = null, compact = false }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    document.addEventListener("touchstart", h, { passive: true });
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("touchstart", h);
    };
  }, []);
  const fs = compact ? 11 : 12;
  const inputFs = MOBILE_SAFE_INPUT_SIZE;
  const py = compact ? 5 : 7;
  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      {wineObj ? (
        <div style={{
          display: "flex", alignItems: "center",
          border: "1px solid #d8d8d8", borderRadius: 2,
          padding: `${py}px 28px ${py}px 10px`,
          background: "#fafafa", position: "relative",
          fontSize: fs, fontFamily: FONT, color: "#4a4a4a",
        }}>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {wineObj.name} · {wineObj.producer} · {wineObj.vintage}
          </span>
          <button onClick={e => { e.stopPropagation(); onChange(null); }} style={{
            position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
            background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0,
          }}>×</button>
        </div>
      ) : (
        <input value={q} onChange={e => {
          setQ(e.target.value);
          const r = fuzzy(e.target.value, wines, byGlass);
          setResults(r); setOpen(r.length > 0);
          if (!e.target.value) onChange(null);
        }} onFocus={() => results.length && setOpen(true)}
          placeholder={placeholder || "search…"}
          style={{ ...baseInp, fontSize: inputFs, padding: `${py}px 10px`, letterSpacing: 0.3 }} />
      )}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 3px)", left: 0, right: 0,
          background: "#fff", border: "1px solid #e8e8e8", borderRadius: 2,
          zIndex: 200, boxShadow: "0 4px 20px rgba(0,0,0,0.08)", overflow: "hidden",
        }}>
          {results.map(w => (
            <div key={w.id} onMouseDown={() => { setQ(""); setOpen(false); onChange(w); }} style={{
              padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid #f5f5f5",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div>
                <span style={{ fontFamily: FONT, fontSize: 12, color: "#1a1a1a" }}>{w.name}</span>
                <span style={{ fontFamily: FONT, fontSize: 11, color: "#444" }}> · {w.producer} · {w.vintage}</span>
              </div>
              {w.byGlass && <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, color: "#444", border: "1px solid #e8e8e8", borderRadius: 2, padding: "2px 5px" }}>glass</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Drink Search (cocktails / spirits) ────────────────────────────────────────
function DrinkSearch({ drinkObj, list = [], onChange, placeholder, accentColor = "#7a507a" }) {
  const [q, setQ]           = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen]     = useState(false);
  const ref = useRef();
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    document.addEventListener("touchstart", h, { passive: true });
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("touchstart", h);
    };
  }, []);

  return (
    <div ref={ref} style={{ position: "relative", width: "100%" }}>
      {drinkObj ? (
        <div style={{
          display: "flex", alignItems: "center",
          border: `1px solid ${accentColor}44`, borderRadius: 2,
          padding: "5px 28px 5px 10px", background: `${accentColor}08`,
          position: "relative", fontSize: 11, fontFamily: FONT, color: "#4a4a4a",
        }}>
          <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {drinkObj.name}{drinkObj.notes ? ` · ${drinkObj.notes}` : ""}
          </span>
          <button onClick={e => { e.stopPropagation(); onChange(null); }} style={{
            position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
            background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0,
          }}>×</button>
        </div>
      ) : (
        <input value={q} onChange={e => {
          setQ(e.target.value);
          const r = fuzzyDrink(e.target.value, list);
          setResults(r); setOpen(r.length > 0);
          if (!e.target.value) onChange(null);
        }} onFocus={() => results.length && setOpen(true)}
          placeholder={placeholder || "search…"}
          style={{ ...baseInp, fontSize: MOBILE_SAFE_INPUT_SIZE, padding: "5px 10px", letterSpacing: 0.3 }} />
      )}
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 3px)", left: 0, right: 0,
          background: "#fff", border: "1px solid #e8e8e8", borderRadius: 2,
          zIndex: 200, boxShadow: "0 4px 20px rgba(0,0,0,0.08)", overflow: "hidden",
        }}>
          {results.map(d => (
            <div key={d.id} onMouseDown={() => { setQ(""); setOpen(false); onChange(d); }} style={{
              padding: "9px 14px", cursor: "pointer", borderBottom: "1px solid #f5f5f5",
              fontFamily: FONT, fontSize: 12, color: "#1a1a1a",
            }}>
              {d.name}{d.notes ? <span style={{ color: "#444" }}> · {d.notes}</span> : ""}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Swap Picker ───────────────────────────────────────────────────────────────
function SwapPicker({ seatId, totalSeats, onSwap }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    document.addEventListener("touchstart", h, { passive: true });
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("touchstart", h);
    };
  }, []);
  const others = Array.from({ length: totalSeats }, (_, i) => i + 1).filter(n => n !== seatId);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)} title="Swap position" style={{
        width: 28, height: 28, borderRadius: 2,
        border: "1px solid #e8e8e8", background: open ? "#f5f5f5" : "#fff",
        color: "#555", cursor: "pointer", fontSize: 13,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>⇅</button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 3px)", right: 0,
          background: "#fff", border: "1px solid #e8e8e8", borderRadius: 2,
          zIndex: 300, overflow: "hidden", minWidth: 80,
          boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
        }}>
          <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#555", padding: "7px 12px 4px", textTransform: "uppercase" }}>swap with</div>
          {others.map(n => (
            <div key={n} onMouseDown={() => { onSwap(n); setOpen(false); }} style={{
              padding: "8px 14px", cursor: "pointer",
              fontFamily: FONT, fontSize: 12, color: "#1a1a1a",
              borderTop: "1px solid #f5f5f5",
            }}>P{n}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Beverage type styles (shared) ─────────────────────────────────────────────
const BEV_TYPES = {
  wine:     { label: "Glass",    color: "#7a5020", bg: "#fdf4e8", border: "#c8a060", dot: "#c8a060" },
  cocktail: { label: "Cocktail", color: "#5a3878", bg: "#f5eeff", border: "#b898d8", dot: "#b898d8" },
  spirit:   { label: "Spirit",   color: "#7a5020", bg: "#fff3e0", border: "#d4a870", dot: "#d4a870" },
  beer:     { label: "Beer",     color: "#3a6a2a", bg: "#edf8e8", border: "#88bb70", dot: "#88bb70" },
};

// ── BeverageSearch — unified single-search across all drink types ──────────────
function BeverageSearch({ wines, cocktails, spirits, beers, onAdd }) {
  const [q, setQ]           = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen]     = useState(false);
  const ref = useRef();
  const inputRef = useRef();

  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    document.addEventListener("touchstart", h, { passive: true });
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("touchstart", h); };
  }, []);

  const search = val => {
    if (!val.trim()) { setResults([]); setOpen(false); return; }
    const lq = val.toLowerCase();
    const r = [];
    wines.filter(w => w.byGlass).forEach(w => {
      if (w.name.toLowerCase().includes(lq) || w.producer?.toLowerCase().includes(lq) || w.vintage?.includes(lq))
        r.push({ type: "wine",     item: w, label: w.name, sub: `${w.producer} · ${w.vintage}` });
    });
    cocktails.forEach(c => {
      if (c.name.toLowerCase().includes(lq) || (c.notes||"").toLowerCase().includes(lq))
        r.push({ type: "cocktail", item: c, label: c.name, sub: c.notes || "" });
    });
    spirits.forEach(s => {
      if (s.name.toLowerCase().includes(lq) || (s.notes||"").toLowerCase().includes(lq))
        r.push({ type: "spirit",   item: s, label: s.name, sub: s.notes || "" });
    });
    beers.forEach(b => {
      if (b.name.toLowerCase().includes(lq) || (b.notes||"").toLowerCase().includes(lq))
        r.push({ type: "beer",     item: b, label: b.name, sub: b.notes || "" });
    });
    setResults(r.slice(0, 10));
    setOpen(r.length > 0);
  };

  const handleAdd = entry => {
    onAdd(entry);
    setQ("");
    setResults([]);
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <input
        ref={inputRef}
        value={q}
        onChange={e => { setQ(e.target.value); search(e.target.value); }}
        onFocus={() => results.length && setOpen(true)}
        placeholder="search beverages…"
        autoComplete="off"
        style={{ ...baseInp, fontSize: MOBILE_SAFE_INPUT_SIZE, padding: "9px 12px", letterSpacing: 0.3 }}
      />
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 3px)", left: 0, right: 0,
          background: "#fff", border: "1px solid #e8e8e8", borderRadius: 4,
          zIndex: 300, boxShadow: "0 6px 24px rgba(0,0,0,0.10)", overflow: "hidden",
        }}>
          {results.map((r, i) => {
            const ts = BEV_TYPES[r.type];
            return (
              <div key={i} onMouseDown={() => handleAdd(r)} style={{
                padding: "10px 14px", cursor: "pointer", borderBottom: "1px solid #f8f8f8",
                display: "flex", alignItems: "center", gap: 10,
                background: "#fff",
              }}>
                <span style={{
                  fontFamily: FONT, fontSize: 8, letterSpacing: 1, fontWeight: 600,
                  padding: "2px 6px", borderRadius: 2,
                  color: ts.color, background: ts.bg, border: `1px solid ${ts.border}`,
                  flexShrink: 0, textTransform: "uppercase",
                }}>{ts.label}</span>
                <span style={{ fontFamily: FONT, fontSize: 12, color: "#1a1a1a", flex: 1 }}>{r.label}</span>
                {r.sub && <span style={{ fontFamily: FONT, fontSize: 11, color: "#999" }}>{r.sub}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Menu Sync Tab ─────────────────────────────────────────────────────────────
function MenuSyncTab({ menuCourses = [], onSyncMenu }) {
  const [status, setStatus] = useState(null); // null | "syncing" | "ok" | "err"
  const [msg, setMsg]       = useState("");

  const handleSync = async () => {
    setStatus("syncing"); setMsg("");
    try {
      const r = await onSyncMenu();
      if (r?.ok) {
        setStatus("ok");
        setMsg(`✓ ${r.synced} courses synced`);
      } else {
        setStatus("err");
        setMsg(r?.error || "Sync failed");
      }
    } catch(e) {
      setStatus("err");
      setMsg(e.message);
    }
  };

  const SNACK_LABEL = { true: "snack", false: "" };
  const pairingCols = ["wp", "na", "os", "premium"];
  const pairingLabels = { wp: "Wine", na: "Non-Alc", os: "Our Story", premium: "Premium" };

  return (
    <div>
      <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#888", textTransform: "uppercase", marginBottom: 16 }}>
        Menu Courses — live from Google Sheets
      </div>

      <div style={{ marginBottom: 20, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button onClick={handleSync} disabled={status === "syncing"} style={{
          fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "10px 20px",
          border: "1px solid #c8a96e", borderRadius: 2, cursor: status === "syncing" ? "not-allowed" : "pointer",
          background: "#c8a96e", color: "#fff",
        }}>
          {status === "syncing" ? "SYNCING…" : "↻ SYNC FROM GOOGLE SHEETS"}
        </button>
        {msg && (
          <span style={{ fontFamily: FONT, fontSize: 10, color: status === "ok" ? "#2a7a2a" : "#c04040" }}>{msg}</span>
        )}
      </div>

      <div style={{ fontSize: 9, fontFamily: FONT, color: "#bbb", marginBottom: 16, letterSpacing: 1 }}>
        Sheet: FOOD N PAIRINGS JAN26 · {menuCourses.length} courses loaded
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 360, overflowY: "auto" }}>
        {menuCourses.map((c, i) => (
          <div key={c.position || i} style={{
            display: "grid", gridTemplateColumns: "24px 1fr 1fr 1fr 1fr 1fr", gap: 6,
            padding: "8px 10px", border: "1px solid #f0f0f0", fontSize: 9, fontFamily: FONT,
            background: c.is_snack ? "#fffdf8" : "#fff",
          }}>
            <span style={{ color: "#bbb" }}>{c.position || i + 1}</span>
            <div>
              <div style={{ fontWeight: 700, color: "#1a1a1a" }}>{c.menu?.name}</div>
              <div style={{ color: "#999" }}>{c.menu?.sub}</div>
            </div>
            {pairingCols.map(p => (
              <div key={p}>
                {c[p] ? (
                  <>
                    <div style={{ color: "#c8a96e", fontWeight: 700 }}>{pairingLabels[p]}</div>
                    <div style={{ color: "#555" }}>{c[p].name}</div>
                    <div style={{ color: "#bbb" }}>{c[p].sub}</div>
                  </>
                ) : (
                  <span style={{ color: "#eee" }}>—</span>
                )}
              </div>
            ))}
          </div>
        ))}
        {menuCourses.length === 0 && (
          <div style={{ fontFamily: FONT, fontSize: 11, color: "#ccc", textAlign: "center", padding: "40px 0" }}>
            No courses loaded yet — hit Sync to pull from Google Sheets
          </div>
        )}
      </div>
    </div>
  );
}

// ── Drink List Editor (used inside AdminPanel tabs) ───────────────────────────
function DrinkListEditor({ list, setList, newItem, setNewItem, nextId, label }) {
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 28px", gap: 8, marginBottom: 8 }}>
        {["Name", "Notes / Label", ""].map((h, i) => (
          <div key={i} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#666", textTransform: "uppercase" }}>{h}</div>
        ))}
      </div>
      <div style={{ borderTop: "1px solid #f0f0f0", marginBottom: 12 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 24 }}>
        {list.map(item => (
          <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 28px", gap: 8, alignItems: "center" }}>
            <input value={item.name} onChange={e => setList(l => l.map(x => x.id === item.id ? { ...x, name: e.target.value } : x))}
              style={{ ...baseInp, padding: "5px 8px" }} placeholder="Name" />
            <input value={item.notes} onChange={e => setList(l => l.map(x => x.id === item.id ? { ...x, notes: e.target.value } : x))}
              style={{ ...baseInp, padding: "5px 8px" }} placeholder="e.g. classic / on the rocks" />
            <button onClick={() => setList(l => l.filter(x => x.id !== item.id))} style={{
              background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0,
            }}>×</button>
          </div>
        ))}
      </div>
      <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 16 }}>
        <div style={fieldLabel}>Add {label}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
          <input value={newItem.name} onChange={e => setNewItem(x => ({ ...x, name: e.target.value }))}
            placeholder="Name" style={{ ...baseInp, padding: "5px 8px" }} />
          <input value={newItem.notes} onChange={e => setNewItem(x => ({ ...x, notes: e.target.value }))}
            placeholder="Notes (optional)" style={{ ...baseInp, padding: "5px 8px" }}
            onKeyDown={e => { if (e.key === "Enter" && newItem.name.trim()) { setList(l => [...l, { ...newItem, id: nextId.current++ }]); setNewItem({ name: "", notes: "" }); }}} />
        </div>
        <button onClick={() => { if (!newItem.name.trim()) return; setList(l => [...l, { ...newItem, id: nextId.current++ }]); setNewItem({ name: "", notes: "" }); }} style={{
          fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "8px 20px",
          border: "1px solid #1a1a1a", borderRadius: 2, cursor: "pointer", background: "#1a1a1a", color: "#fff",
        }}>+ ADD {label.toUpperCase()}</button>
      </div>
    </>
  );
}

// ── Admin Panel ───────────────────────────────────────────────────────────────
// ── Manual Menu Overrides Tab ─────────────────────────────────────────────────
// BlurInput: keeps typed value local, only calls onCommit when focus leaves.
// Prevents parent state updates (and re-renders) on every keystroke.
function BlurInput({ committedValue, onCommit, placeholder, style }) {
  const [local, setLocal] = useState(committedValue ?? "");
  // Sync if the committed value changes from outside (e.g. reset)
  const prev = useRef(committedValue);
  if (prev.current !== committedValue) { prev.current = committedValue; setLocal(committedValue ?? ""); }
  return (
    <input
      value={local}
      onChange={e => setLocal(e.target.value)}
      onBlur={() => { if (local !== committedValue) onCommit(local); }}
      placeholder={placeholder}
      style={style}
    />
  );
}

function MenuOverridesTab({ menuCourses = [], overrides = {}, onSetOverrides }) {
  const hasAny = Object.keys(overrides).some(k => Object.keys(overrides[k] || {}).length > 0);

  const commitField = (courseKey, field, value) => {
    onSetOverrides(prev => ({
      ...prev,
      [courseKey]: { ...(prev[courseKey] || {}), [field]: value },
    }));
  };

  const clearCourse = courseKey => {
    onSetOverrides(prev => { const next = { ...prev }; delete next[courseKey]; return next; });
  };

  const clearAll = () => onSetOverrides({});

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <div style={{ fontFamily: FONT, fontSize: 10, color: "#888", letterSpacing: 1 }}>
          SERVICE OVERRIDES — changes apply to all menus & kitchen tickets tonight
        </div>
        {hasAny && (
          <button onClick={clearAll} style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 12px",
            border: "1px solid #ffcccc", borderRadius: 2, cursor: "pointer",
            background: "#fff9f9", color: "#c04040",
          }}>RESET ALL</button>
        )}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {menuCourses.map(course => {
          const key = course.course_key;
          const ov = overrides[key] || {};
          const hasOv = Object.keys(ov).length > 0;
          const origName   = course.menu?.name || key;
          const origSub    = course.menu?.sub  || "";
          const origSiName = course.menu_si?.name || "";
          const origSiSub  = course.menu_si?.sub  || "";
          const inpStyle   = { ...baseInp, padding: "5px 8px", fontSize: 11 };

          return (
            <div key={key} style={{
              border: `1px solid ${hasOv ? "#f0c060" : "#f0f0f0"}`,
              borderRadius: 3, padding: "12px 14px",
              background: hasOv ? "#fffdf4" : "#fff",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div>
                  <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: "#1a1a1a", letterSpacing: 0.3 }}>{origName}</span>
                  {origSub && <span style={{ fontFamily: FONT, fontSize: 10, color: "#999", marginLeft: 8 }}>{origSub}</span>}
                </div>
                {hasOv && (
                  <button onClick={() => clearCourse(key)} style={{
                    fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "3px 9px",
                    border: "1px solid #e8c878", borderRadius: 2, cursor: "pointer",
                    background: "#fff", color: "#a07020",
                  }}>RESET</button>
                )}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div>
                  <div style={{ fontFamily: FONT, fontSize: 9, color: "#999", letterSpacing: 1, marginBottom: 3 }}>NAME (EN)</div>
                  <BlurInput committedValue={"name" in ov ? ov.name : ""} onCommit={v => commitField(key, "name", v)} placeholder={origName} style={inpStyle} />
                </div>
                <div>
                  <div style={{ fontFamily: FONT, fontSize: 9, color: "#999", letterSpacing: 1, marginBottom: 3 }}>SUB (EN)</div>
                  <BlurInput committedValue={"sub" in ov ? ov.sub : ""} onCommit={v => commitField(key, "sub", v)} placeholder={origSub || "—"} style={inpStyle} />
                </div>
                {(origSiName || origSiSub) && (<>
                  <div>
                    <div style={{ fontFamily: FONT, fontSize: 9, color: "#999", letterSpacing: 1, marginBottom: 3 }}>NAME (SI)</div>
                    <BlurInput committedValue={"name_si" in ov ? ov.name_si : ""} onCommit={v => commitField(key, "name_si", v)} placeholder={origSiName || "—"} style={inpStyle} />
                  </div>
                  <div>
                    <div style={{ fontFamily: FONT, fontSize: 9, color: "#999", letterSpacing: 1, marginBottom: 3 }}>SUB (SI)</div>
                    <BlurInput committedValue={"sub_si" in ov ? ov.sub_si : ""} onCommit={v => commitField(key, "sub_si", v)} placeholder={origSiSub || "—"} style={inpStyle} />
                  </div>
                </>)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AdminPanel({ dishes, wines, cocktails, spirits, beers, menuCourses = [], menuOverrides = {}, onSetMenuOverrides, onUpdateDishes, onUpdateWines, onSaveBeverages, onSyncMenu, onClose }) {
  const [tab, setTab] = useState("wines");
  const isMobile = useIsMobile(700);

  // ── Dishes ──
  const [localDishes, setLocalDishes] = useState(dishes.map(d => ({ ...d, pairings: [...d.pairings] })));
  const [newDishName, setNewDishName] = useState("");
  const nextDishId = useRef(Math.max(...dishes.map(d => d.id), 0) + 1);
  const addDish = () => { if (!newDishName.trim()) return; setLocalDishes(l => [...l, { id: nextDishId.current++, name: newDishName.trim(), pairings: ["—", "Wine", "Non-Alc"] }]); setNewDishName(""); };
  const removeDish    = id         => setLocalDishes(l => l.filter(d => d.id !== id));
  const updDishName   = (id, v)    => setLocalDishes(l => l.map(d => d.id === id ? { ...d, name: v } : d));
  const addPairing    = id         => setLocalDishes(l => l.map(d => d.id === id ? { ...d, pairings: [...d.pairings, ""] } : d));
  const updPairing    = (id, i, v) => setLocalDishes(l => l.map(d => d.id === id ? { ...d, pairings: d.pairings.map((p, idx) => idx === i ? v : p) } : d));
  const removePairing = (id, i)    => setLocalDishes(l => l.map(d => d.id === id ? { ...d, pairings: d.pairings.filter((_, idx) => idx !== i) } : d));

  // ── Wines ──
  const [localWines, setLocalWines] = useState(wines.map(w => ({ ...w })));
  const [newWine, setNewWine] = useState({ name: "", producer: "", vintage: "", byGlass: false });
  const nextWineId = useRef(Math.max(...wines.map(w => w.id), 0) + 1);
  const addWine    = () => { if (!newWine.name.trim()) return; setLocalWines(l => [...l, { ...newWine, id: nextWineId.current++ }]); setNewWine({ name: "", producer: "", vintage: "", byGlass: false }); };
  const removeWine = id       => setLocalWines(l => l.filter(w => w.id !== id));
  const updWine    = (id,f,v) => setLocalWines(l => l.map(w => w.id === id ? { ...w, [f]: v } : w));

  // ── Cocktails ──
  const [localCocktails, setLocalCocktails] = useState(cocktails.map(c => ({ ...c })));
  const [newCocktail, setNewCocktail] = useState({ name: "", notes: "" });
  const nextCocktailId = useRef(Math.max(...cocktails.map(c => c.id), 0) + 1);
  const addCocktail    = () => { if (!newCocktail.name.trim()) return; setLocalCocktails(l => [...l, { ...newCocktail, id: nextCocktailId.current++ }]); setNewCocktail({ name: "", notes: "" }); };
  const removeCocktail = id      => setLocalCocktails(l => l.filter(c => c.id !== id));
  const updCocktail    = (id,f,v) => setLocalCocktails(l => l.map(c => c.id === id ? { ...c, [f]: v } : c));

  // ── Spirits ──
  const [localSpirits, setLocalSpirits] = useState(spirits.map(s => ({ ...s })));
  const [newSpirit, setNewSpirit] = useState({ name: "", notes: "" });
  const nextSpiritId = useRef(Math.max(...spirits.map(s => s.id), 0) + 1);
  const addSpirit    = () => { if (!newSpirit.name.trim()) return; setLocalSpirits(l => [...l, { ...newSpirit, id: nextSpiritId.current++ }]); setNewSpirit({ name: "", notes: "" }); };
  const removeSpirit = id      => setLocalSpirits(l => l.filter(s => s.id !== id));
  const updSpirit    = (id,f,v) => setLocalSpirits(l => l.map(s => s.id === id ? { ...s, [f]: v } : s));

  // ── Beers ──
  const [localBeers, setLocalBeers] = useState(beers.map(b => ({ ...b })));
  const [newBeer, setNewBeer] = useState({ name: "", notes: "" });
  const nextBeerId = useRef(Math.max(...beers.map(b => b.id), 0) + 1);
  const addBeer    = () => { if (!newBeer.name.trim()) return; setLocalBeers(l => [...l, { ...newBeer, id: nextBeerId.current++ }]); setNewBeer({ name: "", notes: "" }); };
  const removeBeer = id      => setLocalBeers(l => l.filter(b => b.id !== id));
  const updBeer    = (id,f,v) => setLocalBeers(l => l.map(b => b.id === id ? { ...b, [f]: v } : b));

  const handleSave = () => {
    onUpdateDishes(localDishes);
    onUpdateWines(localWines);
    onSaveBeverages({ cocktails: localCocktails, spirits: localSpirits, beers: localBeers });
    onClose();
  };

  const TABS = ["wines", "cocktails", "spirits", "beers", "dishes", "overrides", "menu"];
  const tabBtn = t => ({
    fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "9px 18px",
    border: "none", cursor: "pointer", textTransform: "uppercase", transition: "all 0.1s",
    background: tab === t ? "#1a1a1a" : "#fff",
    color: tab === t ? "#fff" : "#444",
    borderBottom: tab === t ? "none" : "1px solid #e8e8e8",
  });

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(255,255,255,0.92)",
      backdropFilter: "blur(4px)", zIndex: 500,
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        background: "#fff", borderTop: "1px solid #e8e8e8",
        borderRadius: "12px 12px 0 0",
        width: "100%", maxWidth: 580,
        maxHeight: "92vh", overflow: "hidden",
        boxShadow: "0 -4px 40px rgba(0,0,0,0.10)",
        display: "flex", flexDirection: "column",
      }} onClick={e => e.stopPropagation()}>

        {/* Drag handle */}
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "#e0e0e0", margin: "12px auto 0" }} />

        {/* Tab bar */}
        <div style={{ display: "flex", borderBottom: "1px solid #e8e8e8", flexShrink: 0, marginTop: 8, overflowX: "auto" }}>
          {TABS.map(t => <button key={t} style={tabBtn(t)} onClick={() => setTab(t)}>{t}</button>)}
        </div>

        {/* Scrollable content */}
        <div style={{ overflowY: "auto", padding: isMobile ? "20px 16px" : "24px 28px", flex: 1, overflowX: "hidden" }}>

          {/* ── Wines tab ── */}
          {tab === "wines" && (
            <>
              {/* Wine rows */}
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 70px 52px 28px", gap: 8, marginBottom: 8 }}>
                {(isMobile ? ["Name", "Producer"] : ["Name", "Producer", "Vintage", "Glass", ""]).map((h, i) => (
                  <div key={i} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#666", textTransform: "uppercase" }}>{h}</div>
                ))}
              </div>
              <div style={{ borderTop: "1px solid #f0f0f0", marginBottom: 10 }} />
              <div style={{ display: "flex", flexDirection: "column", gap: 7, marginBottom: 20 }}>
                {localWines.map(w => (
                  <div key={w.id} style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr auto" : "1fr 1fr 70px 52px 28px", gap: 8, alignItems: "center" }}>
                    <input value={w.name} onChange={e => updWine(w.id, "name", e.target.value)} style={{ ...baseInp, padding: "5px 8px" }} placeholder="Name" />
                    <input value={w.producer} onChange={e => updWine(w.id, "producer", e.target.value)} style={{ ...baseInp, padding: "5px 8px" }} placeholder="Producer" />
{!isMobile && <input value={w.vintage} onChange={e => updWine(w.id, "vintage", e.target.value)} style={{ ...baseInp, padding: "5px 8px" }} placeholder="2020" />}
                    <button onClick={() => updWine(w.id, "byGlass", !w.byGlass)} style={{
                      fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 6px", border: "1px solid",
                      borderColor: w.byGlass ? "#aaddaa" : "#e8e8e8", borderRadius: 2, cursor: "pointer",
                      background: w.byGlass ? "#f0faf0" : "#fff", color: w.byGlass ? "#4a8a4a" : "#555",
                    }}>{w.byGlass ? "YES" : "NO"}</button>
                    <button onClick={() => removeWine(w.id)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 16 }}>
                <div style={fieldLabel}>Add wine</div>
                <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "1fr 1fr 70px 52px", gap: 8, marginBottom: 10 }}>
                  <input value={newWine.name} onChange={e => setNewWine(w => ({ ...w, name: e.target.value }))} placeholder="Name" style={{ ...baseInp, padding: "5px 8px" }} />
                  <input value={newWine.producer} onChange={e => setNewWine(w => ({ ...w, producer: e.target.value }))} placeholder="Producer" style={{ ...baseInp, padding: "5px 8px" }} />
                  {!isMobile && <input value={newWine.vintage} onChange={e => setNewWine(w => ({ ...w, vintage: e.target.value }))} placeholder="2020" style={{ ...baseInp, padding: "5px 8px" }} />}
                  <button onClick={() => setNewWine(w => ({ ...w, byGlass: !w.byGlass }))} style={{
                    fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 6px", border: "1px solid",
                    borderColor: newWine.byGlass ? "#aaddaa" : "#e8e8e8", borderRadius: 2, cursor: "pointer",
                    background: newWine.byGlass ? "#f0faf0" : "#fff", color: newWine.byGlass ? "#4a8a4a" : "#555",
                  }}>{newWine.byGlass ? "YES" : "NO"}</button>
                </div>
                <button onClick={addWine} style={{
                  fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "8px 20px",
                  border: "1px solid #1a1a1a", borderRadius: 2, cursor: "pointer", background: "#1a1a1a", color: "#fff",
                }}>+ ADD WINE</button>
              </div>
            </>
          )}

          {tab === "cocktails" && (
            <DrinkListEditor list={localCocktails} setList={setLocalCocktails}
              newItem={newCocktail} setNewItem={setNewCocktail}
              nextId={nextCocktailId} label="cocktail" />
          )}

          {tab === "spirits" && (
            <DrinkListEditor list={localSpirits} setList={setLocalSpirits}
              newItem={newSpirit} setNewItem={setNewSpirit}
              nextId={nextSpiritId} label="spirit" />
          )}

          {tab === "beers" && (
            <DrinkListEditor list={localBeers} setList={setLocalBeers}
              newItem={newBeer} setNewItem={setNewBeer}
              nextId={nextBeerId} label="beer" />
          )}

          {tab === "dishes" && (
            <>
              <div style={{ display: "flex", flexDirection: "column", gap: 16, marginBottom: 24 }}>
                {localDishes.map(dish => (
                  <div key={dish.id} style={{ border: "1px solid #f0f0f0", borderRadius: 2, padding: "14px 16px" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10 }}>
                      <input value={dish.name} onChange={e => updDishName(dish.id, e.target.value)} style={{ ...baseInp, fontWeight: 500, flex: 1 }} />
                      <button onClick={() => removeDish(dish.id)} style={{ background: "none", border: "1px solid #ffcccc", borderRadius: 2, color: "#e07070", cursor: "pointer", fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 10px" }}>REMOVE</button>
                    </div>
                    <div style={{ ...fieldLabel, marginBottom: 8 }}>Pairing options</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {dish.pairings.map((p, idx) => (
                        <div key={idx} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                          <input value={p} onChange={e => updPairing(dish.id, idx, e.target.value)}
                            style={{ fontFamily: FONT, fontSize: 11, padding: "4px 8px", border: "1px solid #e8e8e8", borderRadius: 2, width: 80, outline: "none", color: "#1a1a1a", background: "#fafafa" }} />
                          {dish.pairings.length > 1 && (
                            <button onClick={() => removePairing(dish.id, idx)} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                          )}
                        </div>
                      ))}
                      <button onClick={() => addPairing(dish.id)} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "4px 9px", border: "1px solid #e0e0e0", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#444" }}>+ option</button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 18 }}>
                <div style={fieldLabel}>Add dish</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={newDishName} onChange={e => setNewDishName(e.target.value)} onKeyDown={e => e.key === "Enter" && addDish()} placeholder="Dish name…" style={{ ...baseInp, flex: 1 }} />
                  <button onClick={addDish} style={{ fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "8px 16px", border: "1px solid #1a1a1a", borderRadius: 2, cursor: "pointer", background: "#1a1a1a", color: "#fff", whiteSpace: "nowrap" }}>+ ADD</button>
                </div>
              </div>
            </>
          )}


          {tab === "overrides" && (
            <MenuOverridesTab
              menuCourses={menuCourses}
              overrides={menuOverrides}
              onSetOverrides={onSetMenuOverrides}
            />
          )}

          {tab === "menu" && (
            <MenuSyncTab menuCourses={menuCourses} onSyncMenu={onSyncMenu} />
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", gap: 10, padding: "14px 28px", borderTop: "1px solid #f0f0f0", flexShrink: 0 }}>
          <button onClick={onClose} style={{ flex: 1, fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "10px", border: "1px solid #e8e8e8", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#444" }}>CANCEL</button>
          <button onClick={handleSave} style={{ flex: 2, fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "10px", border: "1px solid #1a1a1a", borderRadius: 2, cursor: "pointer", background: "#1a1a1a", color: "#fff" }}>SAVE</button>
        </div>
      </div>
    </div>
  );
}
// ── Reservation Modal ─────────────────────────────────────────────────────────
function ReservationModal({ table, tables = [], onSave, onClose }) {
  const isMobile = useIsMobile(700);
  const [tableIds, setTableIds]   = useState(table.tableGroup?.length > 1 ? table.tableGroup : [table.id]);
  const [name, setName]           = useState(table.resName || "");
  const [time, setTime]           = useState(table.resTime || "");
  const [menuType, setMenuType]   = useState(table.menuType || "");
  const [guests, setGuests]       = useState(table.guests || 2);
  const [guestType, setGuestType] = useState(table.guestType || "");
  const [room, setRoom]           = useState(table.room || "");
  const [birthday, setBirthday]   = useState(table.birthday || false);
  const [restrictions, setRestrictions] = useState(table.restrictions || []);
  const [notes, setNotes]         = useState(table.notes || "");

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(255,255,255,0.92)",
      backdropFilter: "blur(4px)", zIndex: 500,
      display: "flex", alignItems: "flex-end",
      justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        background: "#fff", borderTop: "1px solid #e8e8e8",
        borderRadius: "12px 12px 0 0",
        padding: "24px 20px 32px",
        width: "100%", maxWidth: 520,
        maxHeight: "92vh", overflowY: "auto",
        boxShadow: "0 -4px 40px rgba(0,0,0,0.10)",
      }} onClick={e => e.stopPropagation()}>

        {/* Drag handle */}
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "#e0e0e0", margin: "0 auto 20px" }} />

        <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 4, color: "#666", marginBottom: 16 }}>
          TABLE · RESERVATION
        </div>

        {/* Table picker — multi-select for combined tables */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={fieldLabel}>Table</div>
            {tableIds.length > 1 && (
              <span style={{ fontFamily: FONT, fontSize: 10, color: "#555", letterSpacing: 1 }}>
                T{[...tableIds].sort((a,b)=>a-b).join("-")} · combined
              </span>
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map(tid => {
              const tObj     = tables.find(t => t.id === tid);
              const isActive = tObj?.active;
              const isBooked = tObj && (tObj.resName || tObj.resTime) && !table.tableGroup?.includes(tid) && tid !== table.id;
              const isSel    = tableIds.includes(tid);
              const toggle   = () => {
                if (isActive) return;
                setTableIds(prev =>
                  prev.includes(tid)
                    ? prev.length > 1 ? prev.filter(x => x !== tid) : prev  // keep at least one
                    : [...prev, tid]
                );
              };
              return (
                <button key={tid} onClick={toggle} disabled={isActive}
                  title={isActive ? "Table is currently seated" : isBooked ? `Reserved: ${tObj.resName || tObj.resTime}` : ""}
                  style={{
                    fontFamily: FONT, fontSize: 13, fontWeight: 500, letterSpacing: 1,
                    padding: "12px 0", border: "1px solid",
                    borderColor: isSel ? "#1a1a1a" : isActive ? "#f0f0f0" : isBooked ? "#f0c8a8" : "#e8e8e8",
                    borderRadius: 2, cursor: isActive ? "not-allowed" : "pointer",
                    background: isSel ? "#1a1a1a" : isActive ? "#f8f8f8" : isBooked ? "#fff8f2" : "#fff",
                    color: isSel ? "#fff" : isActive ? "#ccc" : isBooked ? "#c07840" : "#444",
                    transition: "all 0.1s",
                  }}>
                  T{String(tid).padStart(2, "0")}
                </button>
              );
            })}
          </div>
          {tableIds.length === 1 && (
            <div style={{ fontFamily: FONT, fontSize: 9, color: "#aaa", marginTop: 5, letterSpacing: 0.5 }}>
              Tap multiple tables to combine (e.g. T2-3)
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <div style={fieldLabel}>Name</div>
            <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Guest name…" style={baseInp} />
          </div>

          <div>
            <div style={fieldLabel}>Sitting</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
              {["18:00","18:30","19:00","19:15"].map(t => (
                <button key={t} onClick={() => setTime(t)} style={{
                  fontFamily: FONT, fontSize: 13, letterSpacing: 1,
                  padding: "14px 0", flex: 1, border: "1px solid",
                  borderColor: time === t ? "#1a1a1a" : "#e8e8e8",
                  borderRadius: 2, cursor: "pointer",
                  background: time === t ? "#1a1a1a" : "#fff",
                  color: time === t ? "#fff" : "#888",
                  transition: "all 0.12s",
                }}>{t}</button>
              ))}
            </div>
          </div>
          <div>
            <div style={fieldLabel}>Menu</div>
              <div style={{ display: "flex", gap: 8 }}>
                {["Long", "Short"].map(opt => (
                  <button key={opt} onClick={() => setMenuType(m => m === opt ? "" : opt)} style={{
                    fontFamily: FONT, fontSize: 10, letterSpacing: 2,
                    padding: "10px 24px", border: "1px solid",
                    borderColor: menuType === opt ? "#1a1a1a" : "#e8e8e8",
                    borderRadius: 2, cursor: "pointer",
                    background: menuType === opt ? "#1a1a1a" : "#fff",
                    color: menuType === opt ? "#fff" : "#888",
                    textTransform: "uppercase",
                  }}>{opt}</button>
                ))}
              </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "120px 1fr", gap: 16, alignItems: "flex-start" }}>
            <div>
              <div style={fieldLabel}>Guests</div>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <button onClick={() => setGuests(g => Math.max(1, g-1))} style={circBtnSm}>−</button>
                <span style={{ fontFamily: FONT, fontSize: 18, color: "#1a1a1a", minWidth: 20, textAlign: "center" }}>{guests}</span>
                <button onClick={() => setGuests(g => Math.min(14, g+1))} style={circBtnSm}>+</button>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={fieldLabel}>Guest Type</div>
              <div style={{ display: "flex", gap: 8 }}>
                {["hotel","outside"].map(type => (
                  <button key={type} onClick={() => { setGuestType(t => t === type ? "" : type); setRoom(""); }} style={{
                    fontFamily: FONT, fontSize: 11, letterSpacing: 1,
                    padding: "12px 0", flex: 1, border: "1px solid",
                    borderColor: guestType === type ? "#1a1a1a" : "#e8e8e8",
                    borderRadius: 2, cursor: "pointer",
                    background: guestType === type ? "#1a1a1a" : "#fff",
                    color: guestType === type ? "#fff" : "#444",
                    transition: "all 0.12s", textTransform: "uppercase",
                  }}>{type}</button>
                ))}
              </div>
              {guestType === "hotel" && (
                <div style={{ marginTop: 12 }}>
                  <div style={fieldLabel}>Room</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {["01","11","12","21","22","23"].map(r => (
                      <button key={r} onClick={() => setRoom(x => x === r ? "" : r)} style={{
                        fontFamily: FONT, fontSize: 13, fontWeight: 500, letterSpacing: 1,
                        padding: "12px 16px", border: "1px solid",
                        borderColor: room === r ? "#c8a06e" : "#e8e8e8",
                        borderRadius: 2, cursor: "pointer",
                        background: room === r ? "#fdf6ec" : "#fff",
                        color: room === r ? "#a07040" : "#444",
                        transition: "all 0.12s",
                      }}>{r}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div style={{ borderTop: "1px solid #f0f0f0" }} />

          <div>
            <div style={fieldLabel}>🎂 Birthday Cake</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[true,false].map(val => (
                <button key={String(val)} onClick={() => setBirthday(val)} style={{
                  fontFamily: FONT, fontSize: 12, letterSpacing: 1,
                  padding: "14px 0", flex: 1, border: "1px solid",
                  borderColor: birthday === val ? (val ? "#d4b888" : "#e8e8e8") : "#e8e8e8",
                  borderRadius: 2, cursor: "pointer",
                  background: birthday === val ? (val ? "#fdf8f0" : "#fafafa") : "#fff",
                  color: birthday === val ? (val ? "#a07040" : "#1a1a1a") : "#555",
                  transition: "all 0.12s",
                }}>{val ? "YES" : "NO"}</button>
              ))}
            </div>
          </div>

          <div>
            <div style={{ ...fieldLabel, marginBottom: 12 }}>⚠️ Restrictions</div>

            {/* Chip picker — each click adds one entry (multiple seats can share same restriction) */}
            {Object.entries(RESTRICTION_GROUPS).map(([group, groupLabel]) => {
              const groupItems = RESTRICTIONS.filter(r => r.group === group);
              return (
                <div key={group} style={{ marginBottom: 14 }}>
                  <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 7 }}>{groupLabel}</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {groupItems.map(opt => {
                      const count = restrictions.filter(r => r.note === opt.key).length;
                      const active = count > 0;
                      return (
                        <button key={opt.key}
                          onClick={() => setRestrictions(rs => [...rs, { pos: null, note: opt.key }])}
                          style={{
                            fontFamily: FONT, fontSize: 10, letterSpacing: 0.5,
                            padding: "6px 11px", borderRadius: 2, cursor: "pointer",
                            border: `1px solid ${active ? "#e09090" : "#e8e8e8"}`,
                            background: active ? "#fef0f0" : "#fafafa",
                            color: active ? "#b04040" : "#888",
                            fontWeight: active ? 600 : 400,
                            transition: "all 0.1s",
                            position: "relative",
                          }}>
                          {opt.emoji} {opt.label}
                          {count > 0 && (
                            <span style={{
                              marginLeft: 5,
                              background: "#e09090", color: "#fff",
                              borderRadius: 99, fontSize: 9, fontWeight: 700,
                              padding: "1px 5px", verticalAlign: "middle",
                            }}>{count}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {/* Active restrictions — just chips, seat assigned later in service */}
            {restrictions.length > 0 && (
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {restrictions.map((r, i) => {
                  const def = RESTRICTIONS.find(x => x.key === r.note);
                  const label = def ? `${def.emoji} ${def.label}` : r.note;
                  return (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "5px 10px", background: "#fef0f0",
                      border: "1px solid #e09090", borderRadius: 2,
                    }}>
                      <span style={{ fontFamily: FONT, fontSize: 11, color: "#b04040", fontWeight: 500 }}>{label}</span>
                      <button onClick={() => setRestrictions(rs => rs.filter((_, idx) => idx !== i))}
                        style={{ background: "none", border: "none", color: "#e09090", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
                    </div>
                  );
                })}
              </div>
            )}
            {restrictions.length > 0 && (
              <div style={{ fontFamily: FONT, fontSize: 9, color: "#ccc", marginTop: 8, letterSpacing: 0.5 }}>
                Assign to seats when guests are seated
              </div>
            )}
          </div>

          <div>
            <div style={fieldLabel}>📝 Notes</div>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="VIP, pace, special requests…"
              style={{ ...baseInp, minHeight: 72, resize: "vertical", lineHeight: 1.5 }} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 28 }}>
          <button onClick={onClose} style={{
            flex: 1, fontFamily: FONT, fontSize: 12, letterSpacing: 2,
            padding: "14px", border: "1px solid #e8e8e8", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#444",
          }}>CANCEL</button>
          <button onClick={() => onSave({ tableIds, name, time, menuType, guests, guestType, room, birthday, restrictions, notes })} style={{
            flex: 2, fontFamily: FONT, fontSize: 12, letterSpacing: 2,
            padding: "14px", border: "1px solid #1a1a1a", borderRadius: 2, cursor: "pointer", background: "#1a1a1a", color: "#fff",
          }}>SAVE</button>
        </div>
      </div>
    </div>
  );
}


// ── Sitting time rows layout constant ─────────────────────────────────────────
const SITTING_TIMES = ["18:00", "18:30", "19:00"];

// ── Table Card ────────────────────────────────────────────────────────────────
function Card({ table, mode, onClick, onSeat, onUnseat, onClear, onEditRes }) {
  const hasRes = table.resName || table.resTime;
  return (
    <div style={{
      background: "#fff",
      border: "1px solid",
      borderColor: table.active ? "#d0d0d0" : hasRes ? "#e4e4e4" : "#f0f0f0",
      borderRadius: 4,
      padding: "20px 18px 16px",
      cursor: table.active ? "pointer" : "default",
      display: "flex", flexDirection: "column", gap: 10,
      minHeight: 190,
      opacity: !table.active && !hasRes ? 0.35 : 1,
      boxShadow: table.active ? "0 1px 6px rgba(0,0,0,0.06)" : "none",
    }} onClick={onClick}>

      {/* ── Top row: table number + status badges ── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span style={{
          fontFamily: FONT, fontSize: table.tableGroup?.length > 1 ? 20 : 28, fontWeight: 300, letterSpacing: 1,
          color: table.active ? "#1a1a1a" : "#888", lineHeight: 1,
        }}>
          {table.tableGroup?.length > 1 ? `T${table.tableGroup.join("-")}` : String(table.id).padStart(2, "0")}
        </span>
        <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end", maxWidth: "65%" }}>
          {table.birthday && <span style={{ fontSize: 13 }}>🎂</span>}
          {table.restrictions?.length > 0 && <span style={{ fontSize: 13 }}>⚠️</span>}
          {table.guestType === "hotel" && (
            <span style={{ fontFamily: FONT, fontSize: 9, color: "#1a1a1a", letterSpacing: 1, border: "1px solid #e0e0e0", borderRadius: 2, padding: "2px 6px", background: "#fafafa" }}>
              {table.room ? `Hotel #${table.room}` : "Hotel"}
            </span>
          )}
          {table.menuType && (
            <span style={{ fontFamily: FONT, fontSize: 9, color: "#1a1a1a", letterSpacing: 1, border: "1px solid #e0e0e0", borderRadius: 2, padding: "2px 6px", background: "#fafafa" }}>
              {table.menuType} menu
            </span>
          )}
          {table.pace && (() => {
            const pc = { Slow: { color: "#7a5020", bg: "#fdf4e8", border: "#c8a060" }, Fast: { color: "#6a2a2a", bg: "#fdf0f0", border: "#d08888" } }[table.pace] || {};
            return <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, border: `1px solid ${pc.border}`, borderRadius: 2, padding: "2px 6px", background: pc.bg, color: pc.color }}>{table.pace}</span>;
          })()}
          {table.active && (
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#4a9a6a", display: "inline-block" }} />
          )}
        </div>
      </div>

      {/* ── Reservation info ── */}
      {hasRes && (
        <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
          {table.resName && (
            <div style={{ fontFamily: FONT, fontSize: 14, fontWeight: 500, color: "#1a1a1a", letterSpacing: 0.3 }}>
              {table.resName}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {table.resTime && (
              <span style={{ fontFamily: FONT, fontSize: 11, color: "#555" }}>res. {table.resTime}</span>
            )}
            {table.arrivedAt && (
              <span style={{ fontFamily: FONT, fontSize: 11, color: "#4a9a6a", fontWeight: 500 }}>arr. {table.arrivedAt}</span>
            )}
          </div>
        </div>
      )}

      {/* ── Active table info ── */}
      {table.active && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontFamily: FONT, fontSize: 11, color: "#777", letterSpacing: 0.5 }}>
            {table.guests} {table.guests === 1 ? "guest" : "guests"}
          </div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {table.seats.map(s => (
              <div key={s.id} style={{
                width: 9, height: 9, borderRadius: "50%",
                background: s.pairing ? (pairingStyle[s.pairing]?.color || "#d8d8d8") : "#d8d8d8",
              }} />
            ))}
          </div>
          {table.notes && (
            <div style={{ fontFamily: FONT, fontSize: 10, color: "#888", fontStyle: "italic", lineHeight: 1.4 }}>{table.notes}</div>
          )}
        </div>
      )}

      {/* ── Action buttons ── */}
      <div style={{ marginTop: "auto", display: "flex", gap: 6, flexWrap: "wrap" }} onClick={e => e.stopPropagation()}>
        {!table.active && mode === "admin" && (
          <button onClick={onEditRes} style={{
            fontFamily: FONT, fontSize: 10, letterSpacing: 1, padding: "5px 10px",
            border: "1px solid #e0e0e0", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#555",
          }}>{hasRes ? "edit" : "reserve"}</button>
        )}
        {!table.active && hasRes && (
          <button onClick={onSeat} style={{
            fontFamily: FONT, fontSize: 10, letterSpacing: 1, padding: "5px 10px",
            border: "1px solid #b8ddb8", borderRadius: 2, cursor: "pointer", background: "#f4fbf4", color: "#4a8a4a",
          }}>seat</button>
        )}
        {table.active && mode === "admin" && (
          <button onClick={onUnseat} style={{
            fontFamily: FONT, fontSize: 10, letterSpacing: 1, padding: "5px 10px",
            border: "1px solid #d8d8d8", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#666",
          }}>unseat</button>
        )}
        {table.active && mode === "admin" && (
          <button onClick={onClear} style={{
            fontFamily: FONT, fontSize: 10, letterSpacing: 1, padding: "5px 10px",
            border: "1px solid #f0c0c0", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#c06060",
          }}>clear</button>
        )}
      </div>
    </div>
  );
}

// ── Detail View ───────────────────────────────────────────────────────────────
function Detail({ table, dishes, wines = [], cocktails = [], spirits = [], beers = [], menuCourses = MENU_DATA, mode, onBack, upd, updSeat, setGuests, swapSeats }) {
  const isMobile = useIsMobile(860);
  const row1 = isMobile ? "34px 68px 1fr 28px" : "38px 75px 1fr 28px";
  const [showMenuGen, setShowMenuGen] = useState(false);

  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: isMobile ? "20px 12px 28px" : "24px 16px", overflowX: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <button onClick={onBack} style={{
          background: "none", border: "none", cursor: "pointer",
          fontFamily: FONT, fontSize: 11, color: "#666", letterSpacing: 1, padding: 0,
        }}>← all tables</button>
        {(mode === "admin" || mode === "service") && table.active && (
          <button onClick={() => setShowMenuGen(true)} style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "7px 14px",
            border: "1px solid #c8a96e", borderRadius: 2, cursor: "pointer",
            background: "#fdf4e8", color: "#7a5020",
          }}>MENUS</button>
        )}
      </div>

      {showMenuGen && <MenuGenerator table={table} menuCourses={menuCourses} upd={upd} onClose={() => setShowMenuGen(false)} />}

      {/* Table number + guest count */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 12, gap: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 4, color: "#555", marginBottom: 6 }}>TABLE</div>
          <div style={{ fontFamily: FONT, fontSize: 48, fontWeight: 300, color: "#1a1a1a", lineHeight: 1 }}>
            {String(table.id).padStart(2, "0")}
          </div>
        </div>
        {mode === "admin" && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
            <button onClick={() => setGuests(Math.max(1, table.guests - 1))} style={circBtnSm}>−</button>
            <span style={{ fontFamily: FONT, fontSize: 11, color: "#444", letterSpacing: 1, minWidth: 70, textAlign: "center" }}>
              {table.guests} guests
            </span>
            <button onClick={() => setGuests(Math.min(14, table.guests + 1))} style={circBtnSm}>+</button>
          </div>
        )}
        {mode === "service" && (
          <span style={{ fontFamily: FONT, fontSize: 11, color: "#444", letterSpacing: 1, marginBottom: 6 }}>
            {table.guests} guests
          </span>
        )}
      </div>

      {/* Reservation strip */}
      {(table.resName || table.resTime || table.arrivedAt || table.menuType) && (
        <div style={{
          display: "grid", gap: 14, alignItems: "start",
          gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(auto-fit, minmax(160px, max-content))",
          padding: isMobile ? "12px" : "10px 14px", background: "#fafafa", border: "1px solid #f0f0f0",
          borderRadius: 2, marginBottom: 28,
        }}>
          {table.resName && (
            <div>
              <div style={{ ...fieldLabel, marginBottom: 2 }}>Name</div>
              <div style={{ fontFamily: FONT, fontSize: 13, color: "#1a1a1a" }}>
                {table.resName}
                {table.guestType && <span style={{ fontFamily: FONT, fontSize: 9, color: "#444", marginLeft: 8, letterSpacing: 1, textTransform: "uppercase" }}>{table.guestType}</span>}
                {table.guestType === "hotel" && table.room && <span style={{ fontFamily: FONT, fontSize: 11, color: "#a07040", marginLeft: 6, letterSpacing: 1 }}>· Hotel #{table.room}</span>}
              </div>
            </div>
          )}
          {table.resTime && (
            <div>
              <div style={{ ...fieldLabel, marginBottom: 2 }}>Reserved</div>
              <div style={{ fontFamily: FONT, fontSize: 13, color: "#1a1a1a" }}>{table.resTime}</div>
            </div>
          )}
          {table.menuType && (
            <div>
              <div style={{ ...fieldLabel, marginBottom: 2 }}>Menu</div>
              <div style={{ fontFamily: FONT, fontSize: 13, color: "#1a1a1a" }}>{table.menuType}</div>
            </div>
          )}
          {table.arrivedAt && (
            <div>
              <div style={{ ...fieldLabel, marginBottom: 2 }}>Arrived</div>
              <div style={{ fontFamily: FONT, fontSize: 13, color: "#4a9a6a" }}>{table.arrivedAt}</div>
            </div>
          )}
        </div>
      )}

      {/* Quick set water for all seats */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, padding: "10px 12px", background: "#fafafa", borderRadius: 4, border: "1px solid #f0f0f0" }}>
        <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#888", textTransform: "uppercase", flexShrink: 0 }}>All water</span>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {WATER_OPTS.map(opt => (
            <button key={opt} onClick={() => table.seats.forEach(s => updSeat(s.id, "water", opt))} style={{
              fontFamily: FONT, fontSize: 11, letterSpacing: 0.5,
              padding: "5px 10px", border: "1px solid",
              borderColor: table.seats.every(s => s.water === opt) ? "#1a1a1a" : "#e0e0e0",
              borderRadius: 2, cursor: "pointer",
              background: table.seats.every(s => s.water === opt) ? "#1a1a1a" : "#fff",
              color: table.seats.every(s => s.water === opt) ? "#fff" : "#555",
              transition: "all 0.1s",
            }}>{opt}</button>
          ))}
        </div>
      </div>

      {/* Column header row 1 */}
      <div style={{ display: "grid", gridTemplateColumns: row1, gap: 10, alignItems: "center", marginBottom: 4 }}>
        {["", "Water", "Pairing", ""].map((h, i) => (
          <div key={i} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#555", textTransform: "uppercase" }}>{h}</div>
        ))}
      </div>
      <div style={{ borderTop: "1px solid #f0f0f0", marginBottom: 2 }} />

      {/* Seat rows */}
      {table.seats.map((seat, si) => {
        const glasses   = seat.glasses   || [];
        const cocktailList = seat.cocktails || [];
        const spiritList   = seat.spirits   || [];
        const seatRestrictions = (table.restrictions || []).filter(r => r.pos === seat.id);
        return (
          <div key={seat.id} style={{
            borderBottom: si < table.seats.length - 1 ? "1px solid #f5f5f5" : "none",
            padding: "10px 0",
          }}>
            {/* ── Line 1: P · [restrictions] · Water · Pairing · Swap ── */}
            <div style={{ display: "grid", gridTemplateColumns: row1, gap: 10, alignItems: "start", marginBottom: 8 }}>
              {/* P bubble */}
              <div style={{
                width: 30, height: 30, borderRadius: "50%", border: "1px solid #ebebeb",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: FONT, fontSize: 9, color: "#444", letterSpacing: 0.5, flexShrink: 0,
                marginTop: 2,
              }}>P{seat.id}</div>

              {/* Water */}
              <WaterPicker value={seat.water} onChange={v => updSeat(seat.id, "water", v)} />

              {/* Pairing */}
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {PAIRINGS.map(p => {
                  const ps = pairingStyle[p];
                  const on = seat.pairing === p;
                  return (
                    <button key={p} onClick={() => updSeat(seat.id, "pairing", p)} style={{
                      fontFamily: FONT, fontSize: 9, letterSpacing: 0.5,
                      padding: "5px 8px", border: "1px solid",
                      borderColor: on ? ps.border : "#ebebeb", borderRadius: 2, cursor: "pointer",
                      background: on ? ps.bg : "#fff", color: on ? ps.color : "#555",
                      transition: "all 0.1s",
                    }}>{p}</button>
                  );
                })}
                {/* Restriction tags inline */}
                {seatRestrictions.map((r, i) => (
                  <span key={i} style={{
                    fontFamily: FONT, fontSize: 9, letterSpacing: 0.5,
                    padding: "4px 8px", borderRadius: 2,
                    background: "#fff5f5", border: "1px solid #f0c0c0",
                    color: "#c07070", whiteSpace: "nowrap",
                  }}>⚠ {restrLabel(r.note)}</span>
                ))}
              </div>

              {/* Swap */}
              {table.seats.length > 1
                ? <SwapPicker seatId={seat.id} totalSeats={table.seats.length} onSwap={t => swapSeats(seat.id, t)} />
                : <div />}
            </div>
            {/* ── Beverages + Extras ── */}
            <div style={{ paddingLeft: isMobile ? 0 : 48, display: "flex", flexDirection: "column", gap: 12 }}>
              {/* Unified beverage search */}
              <div style={{ background: "#fcfcfc", border: "1px solid #ececec", borderRadius: 8, padding: isMobile ? "10px" : "12px" }}>
                <div style={{ ...fieldLabel, marginBottom: 8, color: "#444" }}>Beverages</div>
                <BeverageSearch
                  wines={wines} cocktails={cocktails} spirits={spirits} beers={beers}
                  onAdd={({ type, item }) => {
                    if (type === "wine")     updSeat(seat.id, "glasses",   [...(seat.glasses   || []), item]);
                    if (type === "cocktail") updSeat(seat.id, "cocktails", [...(seat.cocktails || []), item]);
                    if (type === "spirit")   updSeat(seat.id, "spirits",   [...(seat.spirits   || []), item]);
                    if (type === "beer")     updSeat(seat.id, "beers",     [...(seat.beers     || []), item]);
                  }}
                />
                {/* Added beverages as chips */}
                {(() => {
                  const allBevs = [
                    ...(seat.glasses   || []).map((x, i) => ({ key: `g${i}`,  type: "wine",     label: x?.name, sub: x?.producer, onRemove: () => updSeat(seat.id, "glasses",   (seat.glasses||[]).filter((_,idx)=>idx!==i)) })),
                    ...(seat.cocktails || []).map((x, i) => ({ key: `c${i}`,  type: "cocktail", label: x?.name, sub: x?.notes,    onRemove: () => updSeat(seat.id, "cocktails", (seat.cocktails||[]).filter((_,idx)=>idx!==i)) })),
                    ...(seat.spirits   || []).map((x, i) => ({ key: `s${i}`,  type: "spirit",   label: x?.name, sub: x?.notes,    onRemove: () => updSeat(seat.id, "spirits",   (seat.spirits||[]).filter((_,idx)=>idx!==i)) })),
                    ...(seat.beers     || []).map((x, i) => ({ key: `b${i}`,  type: "beer",     label: x?.name, sub: x?.notes,    onRemove: () => updSeat(seat.id, "beers",     (seat.beers||[]).filter((_,idx)=>idx!==i)) })),
                  ];
                  if (allBevs.length === 0) return null;
                  return (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                      {allBevs.map(bev => {
                        const ts = BEV_TYPES[bev.type];
                        return (
                          <div key={bev.key} style={{
                            display: "inline-flex", alignItems: "center", gap: 5,
                            padding: "4px 8px 4px 10px", borderRadius: 999,
                            background: ts.bg, border: `1px solid ${ts.border}`,
                          }}>
                            <span style={{ fontFamily: FONT, fontSize: 11, color: ts.color, fontWeight: 500, whiteSpace: "nowrap" }}>
                              {bev.label}{bev.sub ? ` · ${bev.sub}` : ""}
                            </span>
                            <button onClick={bev.onRemove} style={{ background: "none", border: "none", color: ts.color, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 0 0 2px", opacity: 0.7 }}>×</button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {/* Extra dishes */}
              {dishes.length > 0 && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {dishes.map(dish => {
                    const extra = seat.extras?.[dish.id] || { ordered: false, pairing: dish.pairings[0] };
                    return (
                      <div key={dish.id} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 88 }}>
                        <div style={{ ...fieldLabel, marginBottom: 4 }}>{dish.name}</div>
                        <button onClick={() => updSeat(seat.id, "extras", {
                          ...seat.extras, [dish.id]: { ...extra, ordered: !extra.ordered }
                        })} style={{
                          fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 8px", border: "1px solid",
                          borderColor: extra.ordered ? "#aaddaa" : "#ebebeb", borderRadius: 2, cursor: "pointer",
                          background: extra.ordered ? "#f0faf0" : "#fff", color: extra.ordered ? "#4a8a4a" : "#555",
                          transition: "all 0.1s",
                        }}>{extra.ordered ? "YES" : "NO"}</button>
                        <select value={extra.pairing || dish.pairings[0]} disabled={!extra.ordered}
                          onChange={e => updSeat(seat.id, "extras", { ...seat.extras, [dish.id]: { ...extra, pairing: e.target.value } })}
                          style={{
                            fontFamily: FONT, fontSize: 10, padding: "4px 5px",
                            border: "1px solid #ebebeb", borderRadius: 2,
                            background: "#fff", color: "#1a1a1a", outline: "none",
                            opacity: extra.ordered ? 1 : 0.3, width: "100%",
                          }}>
                          {dish.pairings.map(p => <option key={p}>{p}</option>)}
                        </select>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })}

      <div style={{ borderTop: "1px solid #ebebeb", margin: "28px 0" }} />

      {/* Table-wide fields */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 24 }}>
        <div>
          <div style={fieldLabel}>🍾 Bottles</div>
          {(table.bottleWines || []).map((w, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <WineSearch
                wineObj={w} wines={wines} byGlass={false} placeholder="search bottle…"
                onChange={val => {
                  const next = (table.bottleWines || []).map((b, idx) => idx === i ? val : b).filter(Boolean);
                  upd("bottleWines", next);
                }}
              />
            </div>
          ))}
          <WineSearch
            wineObj={null} wines={wines} byGlass={false} placeholder="add bottle…"
            onChange={w => { if (w) upd("bottleWines", [...(table.bottleWines || []), w]); }}
          />
        </div>
        <div>
          <div style={fieldLabel}>Menu</div>
          <div style={{ display: "flex", gap: 8 }}>
            {["Long", "Short"].map(opt => (
              <button key={opt} onClick={() => upd("menuType", table.menuType === opt ? "" : opt)} style={{
                fontFamily: FONT, fontSize: 10, letterSpacing: 2,
                padding: "9px 22px", border: "1px solid",
                borderColor: table.menuType === opt ? "#1a1a1a" : "#e8e8e8",
                borderRadius: 2, cursor: "pointer",
                background: table.menuType === opt ? "#1a1a1a" : "#fff",
                color: table.menuType === opt ? "#fff" : "#888",
                textTransform: "uppercase",
              }}>{opt}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={fieldLabel}>⚠️ Restrictions</div>
          {table.restrictions?.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {table.restrictions.map((r, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
                  padding: "6px 10px", background: r.pos ? "#fafafa" : "#fff8f8",
                  border: `1px solid ${r.pos ? "#f0f0f0" : "#f0c0c066"}`, borderRadius: 2,
                }}>
                  <span style={{ fontFamily: FONT, fontSize: 11, color: "#b04040", fontWeight: 500, flex: 1, minWidth: 80 }}>
                    {restrLabel(r.note)}
                  </span>
                  <div style={{ display: "flex", gap: 3 }}>
                    <button onClick={() => upd("restrictions", table.restrictions.map((x, idx) =>
                      idx === i ? { ...x, pos: null } : x
                    ))} style={{
                      fontFamily: FONT, fontSize: 9, padding: "3px 6px",
                      border: `1px solid ${!r.pos ? "#e09090" : "#e8e8e8"}`,
                      borderRadius: 2, cursor: "pointer",
                      background: !r.pos ? "#fef0f0" : "#fff",
                      color: !r.pos ? "#b04040" : "#bbb",
                    }}>All</button>
                    {Array.from({ length: table.guests }, (_, idx) => {
                      const p = idx + 1; const sel = r.pos === p;
                      return (
                        <button key={p} onClick={() => upd("restrictions", table.restrictions.map((x, ii) =>
                          ii === i ? { ...x, pos: p } : x
                        ))} style={{
                          fontFamily: FONT, fontSize: 9, padding: "3px 6px",
                          border: `1px solid ${sel ? "#e09090" : "#e8e8e8"}`,
                          borderRadius: 2, cursor: "pointer",
                          background: sel ? "#fef0f0" : "#fff",
                          color: sel ? "#b04040" : "#bbb", fontWeight: sel ? 700 : 400,
                        }}>P{p}</button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontFamily: FONT, fontSize: 11, color: "#ddd" }}>none</div>
          )}
        </div>
        <div>
          <div style={fieldLabel}>🎂 Birthday Cake</div>
          <div style={{ fontFamily: FONT, fontSize: 12, color: table.birthday ? "#a07040" : "#555" }}>
            {table.birthday ? "YES" : "NO"}
          </div>
        </div>
        <div>
          <div style={fieldLabel}>📝 Notes</div>
          <textarea value={table.notes} onChange={e => upd("notes", e.target.value)}
            placeholder="VIP, pace, special requests…"
            style={{ ...baseInp, minHeight: 68, resize: "vertical", lineHeight: 1.5 }} />
        </div>
      </div>

      {/* Sticky bottom back button */}
      <div style={{
        position: "sticky", bottom: 0, left: 0, right: 0,
        padding: "12px 0 20px", marginTop: 28,
        background: "linear-gradient(to bottom, transparent, #fff 30%)",
      }}>
        <button onClick={onBack} style={{
          width: "100%", fontFamily: FONT, fontSize: 11, letterSpacing: 2,
          padding: "14px", border: "1px solid #e0e0e0", borderRadius: 4,
          cursor: "pointer", background: "#fff", color: "#555",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>← all tables</button>
      </div>
    </div>
  );
}


// ── Table Seat Detail (read-only, used in DisplayBoard) ───────────────────────
function TableSeatDetail({ table, dishes, isMobile }) {
  const pairingColors = {
    "—":        { color: "#666", bg: "#f5f5f5",  border: "#d8d8d8" },
    "Non-Alc":  { color: "#1f5f73", bg: "#e8f7fb",  border: "#7fc6db" },
    "Wine":      { color: "#7a5020", bg: "#f5ead8",  border: "#c8a060" },
    "Premium":   { color: "#3a3a7a", bg: "#eaeaf5",  border: "#8888bb" },
    "Our Story": { color: "#2a6a4a", bg: "#e0f5ea",  border: "#5aaa7a" },
  };

  const chip = (label, color, bg, border, bold = false) => (
    <span style={{
      fontFamily: FONT, fontSize: 11, letterSpacing: 0.5,
      padding: "4px 10px", borderRadius: 2,
      color, background: bg, border: `1px solid ${border}`,
      whiteSpace: "nowrap", fontWeight: bold ? 500 : 400,
    }}>{label}</span>
  );

  return (
    <>
      {table.notes && (
        <div style={{
          fontFamily: FONT, fontSize: 12, color: "#555", fontStyle: "italic",
          padding: "10px 14px", background: "#f8f8f8", border: "1px solid #e8e8e8",
          borderRadius: 2, marginBottom: 20,
        }}>{table.notes}</div>
      )}
      {(table.restrictions || []).filter(r => !r.pos && r.note).length > 0 && (
        <div style={{ marginBottom: 16, padding: "10px 14px", background: "#fef0f0", border: "1px solid #e09090", borderRadius: 2 }}>
          <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 3, color: "#b04040", marginBottom: 6, textTransform: "uppercase" }}>
            ⚠ Unassigned restrictions
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {table.restrictions.filter(r => !r.pos && r.note).map((r, i) => (
              <span key={i} style={{ fontFamily: FONT, fontSize: 11, color: "#b04040", fontWeight: 500 }}>{restrLabel(r.note)}</span>
            ))}
          </div>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        {table.seats.map(seat => {
          const seatRestrictions = (table.restrictions || []).filter(r => r.pos === seat.id);
          const seatExtras = dishes.filter(d => seat.extras?.[d.id]?.ordered);
          const ws = waterStyle(seat.water);
          const pc = pairingColors[seat.pairing] || pairingColors["Non-Alc"];
          const hasInfo = seatRestrictions.length > 0 || seatExtras.length > 0;
          return (
            <div key={seat.id} style={{ border: "1px solid #ececec", borderRadius: 10, padding: "12px", background: "#fff" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    width: 30, height: 30, borderRadius: "50%",
                    border: `1px solid ${seatRestrictions.length ? "#e08080" : "#d0d0d0"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontFamily: FONT, fontSize: 10, fontWeight: 600,
                    color: seatRestrictions.length ? "#b04040" : "#444",
                  }}>P{seat.id}</div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                  <span style={{
                    fontFamily: FONT, fontSize: 11, fontWeight: 600, letterSpacing: 0.5,
                    padding: "4px 10px", borderRadius: 999,
                    background: seat.water === "—" ? "#f5f5f5" : (ws.bg || "#f0f0f0"),
                    color: seat.water === "—" ? "#666" : "#1a1a1a", border: "1px solid #e0e0e0",
                  }}>{seat.water}</span>
                  {seat.pairing && <span style={{
                    fontFamily: FONT, fontSize: 11, fontWeight: 600, letterSpacing: 0.4,
                    padding: "4px 10px", borderRadius: 999,
                    background: pc.bg, border: `1px solid ${pc.border}`, color: pc.color,
                  }}>{seat.pairing}</span>}
                </div>
              </div>
              {hasInfo ? (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {seatRestrictions.map((r, i) => (
                    <span key={i} style={{ fontFamily: FONT, fontSize: 11, fontWeight: 500, letterSpacing: 0.3, padding: "4px 9px", borderRadius: 999, background: "#fef0f0", border: "1px solid #e09090", color: "#b04040" }}>⚠ {restrLabel(r.note)}</span>
                  ))}
                  {seatExtras.map(d => {
                    const ex = seat.extras[d.id];
                    return <span key={d.id} style={{ fontFamily: FONT, fontSize: 11, letterSpacing: 0.3, padding: "4px 9px", borderRadius: 999, background: "#e8f5e8", border: "1px solid #88cc88", color: "#2a6a2a" }}>{d.name}{ex.pairing && ex.pairing !== "—" ? ` · ${ex.pairing}` : ""}</span>;
                  })}
                </div>
              ) : <div style={{ fontFamily: FONT, fontSize: 11, color: "#777" }}>No extra notes</div>}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ── Display Board ─────────────────────────────────────────────────────────────
function DisplayBoard({ tables, dishes, upd, quickMode = false, updSeat, onCardClick, onSeat, onUnseat }) {
  const isMobile = useIsMobile(700);

  const PC = {
    "Wine":      { color: "#7a5020", bg: "#f5ead8", border: "#c8a060" },
    "Non-Alc":   { color: "#1f5f73", bg: "#e8f7fb", border: "#7fc6db" },
    "Premium":   { color: "#3a3a7a", bg: "#eaeaf5", border: "#8888bb" },
    "Our Story": { color: "#2a6a4a", bg: "#e0f5ea", border: "#5aaa7a" },
  };
  const PAIRING_OPTS = [["—","—"],["Wine","W"],["Non-Alc","N/A"],["Premium","Prem"],["Our Story","Story"]];

  const isPrimary = t => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup);
  const visible = tables.filter(t => t.active || t.resTime || t.resName).filter(isPrimary);
  const rowsData = SITTING_TIMES.map(time => ({
    time,
    tables: visible
      .filter(t => t.resTime === time || (time === "19:00" && t.resTime === "19:15"))
      .sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return (a.arrivedAt || a.resTime || "99").localeCompare(b.arrivedAt || b.resTime || "99");
      }),
  }));
  const hasAny = rowsData.some(r => r.tables.length > 0);

  const TableCard = ({ t }) => {
    const isSeated = t.active;
    const allRestr = (t.restrictions || []).filter(r => r.note);
    const [assigningIdx, setAssigningIdx] = useState(null);
    const seats = t.seats || [];

    const unassigned = allRestr.map((r, i) => ({ ...r, _i: i })).filter(r => !r.pos);

    const assignTo = (seatId) => {
      if (assigningIdx === null || !upd) return;
      upd(t.id, "restrictions", allRestr.map((r, i) => i === assigningIdx ? { ...r, pos: seatId } : r));
      setAssigningIdx(null);
    };

    const allWaterMatch = opt => seats.length > 0 && seats.every(s => s.water === opt);

    const wBtn = (opt, active, onClick) => (
      <button key={opt} onClick={onClick} style={{
        fontFamily: FONT, fontSize: 10, letterSpacing: 0.3, padding: "4px 8px",
        border: `1px solid ${active ? (opt === "OC" || opt === "OW" ? "#c8a060" : "#555") : "#e8e8e8"}`,
        borderRadius: 3, cursor: "pointer", lineHeight: 1,
        background: active ? (opt === "OC" || opt === "OW" ? "#fdf4e8" : "#1a1a1a") : "#fff",
        color: active ? (opt === "OC" || opt === "OW" ? "#7a5020" : "#fff") : "#aaa",
        transition: "all 0.1s",
      }}>{opt}</button>
    );

    const pBtn = (val, label, active) => {
      const col = PC[val];
      return (
        <button key={val} onClick={() => updSeat && updSeat(t.id, seats[0]?.id, "pairing", val)} style={{
          fontFamily: FONT, fontSize: 9, letterSpacing: 0.3, padding: "3px 7px",
          border: `1px solid ${active && val !== "—" ? col?.border : active ? "#333" : "#e8e8e8"}`,
          borderRadius: 3, cursor: "pointer", lineHeight: 1,
          background: active && val !== "—" ? col?.bg : active ? "#1a1a1a" : "#fff",
          color: active && val !== "—" ? col?.color : active ? "#fff" : "#bbb",
          transition: "all 0.1s",
        }}>{label}</button>
      );
    };

    const accentColor = isSeated ? "#5aaa70" : "#88a8c8";

    return (
      <div style={{
        background: "#fff",
        border: "1px solid #e8e8e8",
        borderRadius: 8,
        overflow: "hidden",
        boxShadow: isSeated ? "0 2px 12px rgba(74,154,106,0.10)" : "0 1px 4px rgba(0,0,0,0.04)",
        transition: "box-shadow 0.15s",
      }}>
        {/* Accent bar */}
        <div style={{ height: 3, background: accentColor }} />

        {/* Header */}
        <div
          onClick={() => onCardClick && onCardClick(t.id)}
          style={{
            padding: "12px 14px 10px",
            borderBottom: "1px solid #f0f0f0",
            display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8,
            cursor: onCardClick ? "pointer" : "default",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
            <span style={{ fontFamily: FONT, fontSize: 20, fontWeight: 300, color: "#1a1a1a", letterSpacing: 1, lineHeight: 1 }}>
              {String(t.id).padStart(2, "0")}
            </span>
            {t.resName && (
              <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 700, color: "#1a1a1a" }}>
                {t.resName}
              </span>
            )}
            {t.arrivedAt
              ? <span style={{ fontFamily: FONT, fontSize: 10, color: "#3a8a5a", fontWeight: 600 }}>arr. {t.arrivedAt}</span>
              : t.resTime
                ? <span style={{ fontFamily: FONT, fontSize: 10, color: "#aaa" }}>res. {t.resTime}</span>
                : null
            }
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span style={{
              fontFamily: FONT, fontSize: 8, letterSpacing: 1, padding: "3px 8px", borderRadius: 3,
              background: isSeated ? "#e8f7ee" : "#eef4fb",
              border: `1px solid ${isSeated ? "#9bd0aa" : "#c0d4ea"}`,
              color: isSeated ? "#2f7a45" : "#2f5f8a", fontWeight: 700,
            }}>{isSeated ? "SEATED" : "RESERVED"}</span>
            {t.menuType && <span style={{ fontFamily: FONT, fontSize: 8, padding: "3px 7px", borderRadius: 3, border: "1px solid #e8e8e8", color: "#666" }}>{t.menuType}</span>}
            {t.pace && (() => {
              const pc = { Slow: { color: "#7a5020", bg: "#fdf4e8", border: "#c8a060" }, Fast: { color: "#6a2a2a", bg: "#fdf0f0", border: "#d08888" } }[t.pace] || {};
              return <span style={{ fontFamily: FONT, fontSize: 8, padding: "3px 7px", borderRadius: 3, border: `1px solid ${pc.border}`, background: pc.bg, color: pc.color, fontWeight: 700 }}>{t.pace}</span>;
            })()}
            {t.guestType === "hotel" && t.room && <span style={{ fontFamily: FONT, fontSize: 8, padding: "3px 7px", borderRadius: 3, border: "1px solid #d4b888", color: "#a07040", background: "#fffaf2", fontWeight: 600 }}>#{t.room}</span>}
            {t.birthday && <span style={{ fontSize: 12 }}>🎂</span>}
          </div>
        </div>

        {/* Notes */}
        {t.notes && (
          <div style={{ padding: "7px 14px", borderBottom: "1px solid #f5f5f5", background: "#fafafa" }}>
            <span style={{ fontFamily: FONT, fontSize: 11, color: "#888", fontStyle: "italic" }}>{t.notes}</span>
          </div>
        )}

        {/* Unassigned restrictions */}
        {unassigned.length > 0 && (
          <div style={{ padding: "5px 14px", borderBottom: "1px solid #f5f5f5", background: "#fff8f8", display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#b04040", textTransform: "uppercase", flexShrink: 0 }}>⚠</span>
            {unassigned.map(r => (
              <span key={r._i} onClick={() => setAssigningIdx(assigningIdx === r._i ? null : r._i)} style={{
                fontFamily: FONT, fontSize: 8,
                color: assigningIdx === r._i ? "#fff" : "#b04040",
                background: assigningIdx === r._i ? "#b04040" : "#fef0f0",
                border: "1px solid #e09090", borderRadius: 3, padding: "1px 6px",
                fontWeight: 500, cursor: "pointer", userSelect: "none",
              }}>{restrCompact(r.note)} {assigningIdx === r._i ? "→ seat" : "→"}</span>
            ))}
          </div>
        )}

        {assigningIdx !== null && (
          <div style={{ padding: "7px 14px", borderBottom: "1px solid #f5f5f5", background: "#fff3f3", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, color: "#b04040", flexShrink: 0 }}>Assign to:</span>
            {seats.map(s => (
              <button key={s.id} onClick={() => assignTo(s.id)} style={{
                fontFamily: FONT, fontSize: 10, fontWeight: 700, padding: "4px 10px",
                border: "1px solid #e09090", borderRadius: 3, cursor: "pointer",
                background: "#fff", color: "#b04040",
              }}>P{s.id}</button>
            ))}
            <button onClick={() => setAssigningIdx(null)} style={{
              fontFamily: FONT, fontSize: 9, padding: "3px 8px", marginLeft: 4,
              border: "1px solid #eee", borderRadius: 3, cursor: "pointer",
              background: "#fff", color: "#bbb",
            }}>cancel</button>
          </div>
        )}

        {/* Quick mode — ALL water row */}
        {quickMode && isSeated && seats.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", borderBottom: "1px solid #f0f0f0", background: "#fafafa" }}>
            <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#ccc", textTransform: "uppercase", minWidth: 30 }}>ALL</span>
            <div style={{ display: "flex", gap: 4 }}>
              {WATER_QUICK.map(opt => wBtn(opt, allWaterMatch(opt), () => seats.forEach(s => updSeat && updSeat(t.id, s.id, "water", opt))))}
            </div>
          </div>
        )}

        {/* Seat rows */}
        {isSeated && seats.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: quickMode ? 6 : 0, padding: quickMode ? "8px 10px" : "6px 0" }}>
            {seats.map(s => {
              const ws      = waterStyle(s.water);
              const pc      = PC[s.pairing];
              const restr   = allRestr.filter(r => r.pos === s.id);
              const extras  = dishes.filter(d => s.extras?.[d.id]?.ordered);
              const beetExtra = s.extras?.[1] || s.extras?.["1"] || { ordered: false, pairing: "—" };
              const hasBeet   = !!beetExtra.ordered;
              const hasCheese = !!(s.extras?.[2]?.ordered || s.extras?.["2"]?.ordered);
              const hasContent = (s.water && s.water !== "—") || s.pairing || restr.length > 0 || extras.length > 0;

              if (quickMode) {
                return (
                  <div key={s.id} style={{
                    border: `1px solid ${restr.length ? "#f0d0d0" : "#ececec"}`,
                    borderRadius: 6, overflow: "hidden",
                    background: restr.length ? "#fffaf9" : "#fafafa",
                  }}>
                    {/* Seat label + restrictions */}
                    <div style={{
                      display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
                      padding: "4px 10px", background: restr.length ? "#fff0f0" : "#f2f2f2",
                      borderBottom: "1px solid #e8e8e8",
                    }}>
                      <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: 1.5, color: restr.length ? "#b04040" : "#777" }}>P{s.id}</span>
                      {restr.map((r, i) => (
                        <span key={i} style={{ fontFamily: FONT, fontSize: 9, color: "#b04040", fontWeight: 500 }}>
                          ⚠ {restrLabel(r.note)}
                        </span>
                      ))}
                    </div>
                    {/* Water */}
                    <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", padding: "6px 10px 4px" }}>
                      <div style={{ display: "flex", gap: 3 }}>
                        {WATER_QUICK.map(opt => wBtn(opt, s.water === opt, () => updSeat && updSeat(t.id, s.id, "water", opt)))}
                      </div>
                      <div style={{ width: 1, height: 16, background: "#e0e0e0", margin: "0 2px" }} />
                      {/* Extras */}
                      <button onClick={() => { const cur = s.extras?.[1] || { ordered: false }; updSeat && updSeat(t.id, s.id, "extras", { ...s.extras, 1: { ...cur, ordered: !cur.ordered } }); }} style={{
                        fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: "3px 8px",
                        border: `1px solid ${hasBeet ? "#5a8a3a" : "#e0e0e0"}`,
                        borderRadius: 3, cursor: "pointer",
                        background: hasBeet ? "#edf8e8" : "#fff", color: hasBeet ? "#5a8a3a" : "#bbb",
                      }}>Beet</button>
                      <button onClick={() => { const cur = s.extras?.[2] || { ordered: false }; updSeat && updSeat(t.id, s.id, "extras", { ...s.extras, 2: { ...cur, ordered: !cur.ordered } }); }} style={{
                        fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: "3px 8px",
                        border: `1px solid ${hasCheese ? "#a06830" : "#e0e0e0"}`,
                        borderRadius: 3, cursor: "pointer",
                        background: hasCheese ? "#fdf4e8" : "#fff", color: hasCheese ? "#a06830" : "#bbb",
                      }}>Chse</button>
                    </div>
                    {/* Pairing */}
                    <div style={{ display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap", padding: "2px 10px 7px" }}>
                      {PAIRING_OPTS.map(([val, label]) => {
                        const active = s.pairing === val || (val === "—" && !s.pairing);
                        const col = PC[val];
                        return (
                          <button key={val} onClick={() => updSeat && updSeat(t.id, s.id, "pairing", val)} style={{
                            fontFamily: FONT, fontSize: 8, letterSpacing: 0.3, padding: "3px 7px",
                            border: `1px solid ${active && val !== "—" ? col?.border : active ? "#333" : "#e8e8e8"}`,
                            borderRadius: 3, cursor: "pointer",
                            background: active && val !== "—" ? col?.bg : active ? "#1a1a1a" : "#fff",
                            color: active && val !== "—" ? col?.color : active ? "#fff" : "#ccc",
                          }}>{label}</button>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              // Normal display mode
              return (
                <div key={s.id} style={{
                  display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap",
                  padding: "5px 14px", borderBottom: "1px solid #f8f8f8",
                  background: restr.length ? "#fffaf9" : "transparent",
                }}>
                  <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, minWidth: 22, color: restr.length ? "#b04040" : "#aaa", letterSpacing: 0.5 }}>P{s.id}</span>
                  {!hasContent && <span style={{ fontFamily: FONT, fontSize: 10, color: "#e8e8e8" }}>—</span>}
                  {s.water && s.water !== "—" && (
                    <span style={{ fontFamily: FONT, fontSize: 10, padding: "2px 7px", borderRadius: 3, background: ws.bg || "#f5f5f5", color: "#444", border: "1px solid #e0e0e0" }}>{s.water}</span>
                  )}
                  {s.pairing && pc && (
                    <span style={{ fontFamily: FONT, fontSize: 10, padding: "2px 7px", borderRadius: 3, background: pc.bg, border: `1px solid ${pc.border}`, color: pc.color, fontWeight: 500 }}>{s.pairing}</span>
                  )}
                  {extras.map(d => {
                    const ex = s.extras[d.id];
                    return (
                      <span key={d.id} style={{ fontFamily: FONT, fontSize: 10, padding: "2px 7px", borderRadius: 3, border: "1px solid #88cc88", color: "#2a6a2a", background: "#e8f5e8" }}>
                        {d.name}{ex?.pairing && ex.pairing !== "—" ? ` · ${ex.pairing}` : ""}
                      </span>
                    );
                  })}
                  {restr.map((r, i) => (
                    <span key={i} style={{ fontFamily: FONT, fontSize: 8, padding: "1px 5px", borderRadius: 3, border: "1px solid #e09090", color: "#b04040", background: "#fef0f0", fontWeight: 500 }}>⚠ {restrCompact(r.note)}</span>
                  ))}
                </div>
              );
            })}
          </div>
        ) : !isSeated ? (
          <div style={{ padding: "11px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontFamily: FONT, fontSize: 11, color: "#bbb" }}>{t.guests} guest{t.guests !== 1 ? "s" : ""}</span>
              {allRestr.map((r, i) => (
                <span key={i} style={{ fontFamily: FONT, fontSize: 8, padding: "1px 5px", borderRadius: 3, border: "1px solid #e09090", color: "#b04040", background: "#fef0f0", fontWeight: 500 }}>⚠ {restrCompact(r.note)}</span>
              ))}
            </div>
            {onSeat && (
              <button onClick={() => onSeat(t.id)} style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 14px",
                border: "1px solid #b8ddb8", borderRadius: 3, cursor: "pointer",
                background: "#f4fbf4", color: "#4a8a4a", fontWeight: 600, textTransform: "uppercase",
              }}>Seat</button>
            )}
          </div>
        ) : null}
        {isSeated && onUnseat && (
          <div style={{ padding: "6px 14px", borderTop: "1px solid #f5f5f5", display: "flex", justifyContent: "flex-end" }}>
            <button onClick={() => onUnseat(t.id)} style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "4px 12px",
              border: "1px solid #d8d8d8", borderRadius: 3, cursor: "pointer",
              background: "#fff", color: "#999", textTransform: "uppercase",
            }}>Unseat</button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ overflowY: "auto", overflowX: "hidden", padding: isMobile ? "16px 12px 40px" : "20px 0 48px" }}>
      {!hasAny && (
        <div style={{ fontFamily: FONT, fontSize: 10, color: "#ccc", textAlign: "center", marginTop: 80, letterSpacing: 2 }}>
          no reservations
        </div>
      )}
      {rowsData.map(({ time, tables: rowTables }) => {
        if (rowTables.length === 0) return null;
        const seatedCount = rowTables.filter(t => t.active).length;
        return (
          <div key={time} style={{ marginBottom: 32 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <span style={{ fontFamily: FONT, fontSize: 10, letterSpacing: 3, color: "#aaa", textTransform: "uppercase" }}>{time}</span>
              <div style={{ flex: 1, height: 1, background: "#efefef" }} />
              <span style={{ fontFamily: FONT, fontSize: 9, color: "#ccc" }}>
                {seatedCount}/{rowTables.length} seated · {rowTables.reduce((a, t) => a + (t.guests || 0), 0)} guests
              </span>
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(340px, 1fr))",
              gap: isMobile ? 10 : 14,
            }}>
              {rowTables.map(t => <TableCard key={t.id} t={t} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Service Quick View ────────────────────────────────────────────────────────
const WATER_LABELS = { XC: "XC", XW: "XW", OC: "OC", OW: "OW" };
const WATER_QUICK = ["XC", "XW", "OC", "OW"];

function ServiceQuickCard({ table, updSeat, onDetails }) {
  const seats = table.seats || [];
  const toggleExtra = (seat, dishId) => {
    const cur = seat.extras?.[dishId] || { ordered: false, pairing: "—" };
    updSeat(table.id, seat.id, "extras", { ...seat.extras, [dishId]: { ...cur, ordered: !cur.ordered } });
  };

  const waterBtn = (opt, active, onClick) => (
    <button key={opt} onClick={onClick} style={{
      fontFamily: FONT, fontSize: 10, letterSpacing: 0.5,
      padding: "5px 9px", border: "1px solid",
      borderColor: active ? "#1a1a1a" : "#e0e0e0",
      borderRadius: 2, cursor: "pointer", lineHeight: 1,
      background: active ? "#1a1a1a" : "#fff",
      color: active ? "#fff" : "#666",
    }}>{opt}</button>
  );

  const extraBtn = (label, active, color, onClick) => (
    <button onClick={onClick} style={{
      fontFamily: FONT, fontSize: 9, letterSpacing: 1,
      padding: "5px 9px", border: "1px solid",
      borderColor: active ? color : "#e0e0e0",
      borderRadius: 2, cursor: "pointer", lineHeight: 1,
      background: active ? color : "#fff",
      color: active ? "#fff" : "#aaa",
      textTransform: "uppercase",
    }}>{label}</button>
  );

  const allWaterMatch = opt => seats.length > 0 && seats.every(s => s.water === opt);

  return (
    <div style={{ border: "1px solid #e8e8e8", borderRadius: 6, overflow: "hidden", background: "#fff" }}>
      {/* Table header */}
      <div onClick={onDetails} style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 14px", background: "#fafafa", cursor: "pointer",
        borderBottom: "1px solid #f0f0f0",
      }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: "#1a1a1a" }}>T{table.id}</span>
          {table.resName && <span style={{ fontFamily: FONT, fontSize: 10, color: "#555", letterSpacing: 1 }}>{table.resName}</span>}
          {table.resTime && <span style={{ fontFamily: FONT, fontSize: 9, color: "#bbb", letterSpacing: 1 }}>{table.resTime}</span>}
          <span style={{ fontFamily: FONT, fontSize: 9, color: "#bbb" }}>{seats.length}p</span>
        </div>
        <span style={{ fontFamily: FONT, fontSize: 11, color: "#c8a96e" }}>→</span>
      </div>

      {/* All water quick row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderBottom: "1px solid #f8f8f8", background: "#fdfdfd" }}>
        <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", minWidth: 28 }}>ALL</span>
        <div style={{ display: "flex", gap: 4 }}>
          {WATER_QUICK.map(opt => waterBtn(opt, allWaterMatch(opt), () => seats.forEach(s => updSeat(table.id, s.id, "water", opt))))}
        </div>
      </div>

      {/* Per-seat rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 10px" }}>
        {seats.map(seat => {
          const beetExtra = seat.extras?.[1] || seat.extras?.["1"] || { ordered: false, pairing: "—" };
          const hasBeet = !!beetExtra.ordered;
          const hasCheese = !!(seat.extras?.[2]?.ordered || seat.extras?.["2"]?.ordered);
          const setBeetPairing = (p) => updSeat(table.id, seat.id, "extras", { ...seat.extras, 1: { ...beetExtra, pairing: p } });
          const pairingColor = { Wine: "#7a5020", "Non-Alc": "#3a6a2a", Premium: "#4a3a7a", "Our Story": "#2a5a6a" };
          const pairingBg   = { Wine: "#fdf4e8", "Non-Alc": "#edf8e8", Premium: "#f0eeff", "Our Story": "#e8f5f8" };
          const PAIRING_OPTS = [["—","—"],["Wine","W"],["Non-Alc","N/A"],["Premium","Prem"],["Our Story","Story"]];
          return (
            <div key={seat.id} style={{
              border: "1px solid #ececec", borderRadius: 5, overflow: "hidden",
              background: "#fafafa",
            }}>
              {/* Seat label strip */}
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "3px 10px", background: "#f0f0f0",
                borderBottom: "1px solid #e8e8e8",
              }}>
                <span style={{ fontFamily: FONT, fontSize: 8, fontWeight: 700, letterSpacing: 2, color: "#888" }}>P{seat.id}</span>
                {(table.restrictions || []).filter(r => !r.pos || r.pos === seat.id).map((r, i) => (
                  <span key={i} style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 0.5, color: "#b04040" }}>
                    {restrLabel(r.note)}
                  </span>
                ))}
              </div>

              {/* Water + extras */}
              <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", padding: "7px 10px 5px" }}>
                <div style={{ display: "flex", gap: 3 }}>
                  {WATER_QUICK.map(opt => waterBtn(opt, seat.water === opt, () => updSeat(table.id, seat.id, "water", opt)))}
                </div>
                <div style={{ width: 1, height: 18, background: "#e8e8e8", margin: "0 2px" }} />
                <div style={{ display: "flex", gap: 3 }}>
                  {extraBtn("Beet", hasBeet, "#5a8a3a", () => toggleExtra(seat, 1))}
                  {hasBeet && ["—", "Champ", "N/A"].map(p => {
                    const val = p === "Champ" ? "Champagne" : p;
                    const active = (beetExtra.pairing || "—") === val;
                    return (
                      <button key={p} onClick={() => setBeetPairing(val)} style={{
                        fontFamily: FONT, fontSize: 8, letterSpacing: 0.5,
                        padding: "4px 6px", border: "1px solid",
                        borderColor: active ? "#5a8a3a" : "#e0e0e0",
                        borderRadius: 2, cursor: "pointer", lineHeight: 1,
                        background: active ? "#edf8e8" : "#fff",
                        color: active ? "#5a8a3a" : "#aaa",
                      }}>{p}</button>
                    );
                  })}
                  {extraBtn("Chse", hasCheese, "#a06830", () => toggleExtra(seat, 2))}
                </div>
              </div>

              {/* Pairing */}
              <div style={{ display: "flex", alignItems: "center", gap: 3, padding: "0 10px 7px" }}>
                {PAIRING_OPTS.map(([val, label]) => {
                  const active = seat.pairing === val || (val === "—" && !seat.pairing);
                  const col = pairingColor[val];
                  const bg = pairingBg[val];
                  return (
                    <button key={val} onClick={() => updSeat(table.id, seat.id, "pairing", val)} style={{
                      fontFamily: FONT, fontSize: 8, letterSpacing: 0.5,
                      padding: "4px 7px", border: "1px solid",
                      borderColor: active && val !== "—" ? col : active ? "#1a1a1a" : "#e0e0e0",
                      borderRadius: 2, cursor: "pointer", lineHeight: 1,
                      background: active && val !== "—" ? bg : active ? "#1a1a1a" : "#fff",
                      color: active && val !== "—" ? col : active ? "#fff" : "#bbb",
                    }}>{label}</button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ServiceQuickView({ tables, updSeat, setSel }) {
  const activeTables = tables.filter(t => t.active || t.resName || t.resTime);
  if (activeTables.length === 0) return (
    <div style={{ fontFamily: FONT, fontSize: 11, color: "#bbb", textAlign: "center", paddingTop: 80 }}>
      No active tables
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
      {activeTables.map(t => (
        <ServiceQuickCard key={t.id} table={t} updSeat={updSeat} onDetails={() => setSel(t.id)} />
      ))}
    </div>
  );
}

// ── Kitchen Board (KDS) ────────────────────────────────────────────────────────
function KitchenTicket({ table, menuCourses, upd }) {
  const seats = table.seats || [];
  const restrictions = table.restrictions || [];
  const log = table.kitchenLog || {};
  const [assigningRestrIdx, setAssigningRestrIdx] = useState(null);

  const fire = (courseKey) => {
    const now = fmt(new Date());
    const newLog = { ...log, [courseKey]: { firedAt: now } };
    upd(table.id, "kitchenLog", newLog);
  };
  const unfire = (courseKey) => {
    const newLog = { ...log };
    delete newLog[courseKey];
    upd(table.id, "kitchenLog", newLog);
  };

  const assignRestrToSeat = (seatId) => {
    if (assigningRestrIdx === null) return;
    const updated = restrictions.map((r, i) =>
      i === assigningRestrIdx ? { ...r, pos: seatId } : r
    );
    upd(table.id, "restrictions", updated);
    setAssigningRestrIdx(null);
  };

  // Seat restriction keys per seat (for course substitution lookup).
  // Return raw r.note — applyCourseRestriction does its own RESTRICTION_COLUMN_MAP lookup internally.
  const seatRestrKeys = (seat) =>
    (restrictions || [])
      .filter(r => !r.pos || r.pos === seat.id)
      .map(r => r.note);

  const pairingColor = { Wine: "#7a5020", "Non-Alc": "#1f5f73", Premium: "#5a5a8a", "Our Story": "#3a7a5a" };
  const pairingBg   = { Wine: "#fdf4e8", "Non-Alc": "#e8f5fa", Premium: "#f0eeff", "Our Story": "#eaf5ee" };

  const normFlag = s => String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const isBeetCourse   = c => { const f = normFlag(c.optional_flag), k = normFlag(c.course_key || c.menu?.name); return f === "beetroot" || k === "beetroot"; };
  const isCheeseCourse = c => { const f = normFlag(c.optional_flag), k = normFlag(c.course_key || c.menu?.name); return f === "cheese"   || k === "cheese";   };
  const isCakeCourse   = c => { const f = normFlag(c.optional_flag), k = normFlag(c.course_key || c.menu?.name); return f === "cake"     || k === "pear" || k === "pear_cake"; };

  // Extras ordered per seat — must come before courses filter
  const beetSeats   = seats.filter(s => s.extras?.[1]?.ordered || s.extras?.["1"]?.ordered);
  const cheeseSeats = seats.filter(s => s.extras?.[2]?.ordered || s.extras?.["2"]?.ordered);
  const cakeSeats   = seats.filter(s => s.extras?.[3]?.ordered || s.extras?.["3"]?.ordered);
  const hasCake     = cakeSeats.length > 0;

  const isShort = String(table.menuType || "").trim().toLowerCase() === "short";
  const isTruthyShort = v => { const s = String(v ?? "").trim().toLowerCase(); return s === "true" || s === "1" || s === "yes" || s === "y" || s === "x" || s === "wahr"; };

  // Apply per-table course overrides on top of the (already globally-overridden) menuCourses
  const tableOverriddenCourses = (menuCourses || []).map(c => applyMenuOverride(c, table.courseOverrides || {}));

  // Courses to show: non-snack, optional extras only when ordered, short menu filtered
  const courses = tableOverriddenCourses.filter(c => {
    if (c.is_snack) return false;
    if (isBeetCourse(c)   && beetSeats.length   === 0) return false;
    if (isCheeseCourse(c) && cheeseSeats.length === 0) return false;
    if (isCakeCourse(c)   && cakeSeats.length   === 0) return false;
    if (isShort && !isTruthyShort(c.show_on_short)) return false;
    return true;
  }).sort((a, b) => {
    if (isShort) return ((Number(a.short_order) || 9999) - (Number(b.short_order) || 9999));
    return (Number(a.position) || 0) - (Number(b.position) || 0);
  });

  const firedCount   = Object.keys(log).length;
  const totalCourses = courses.length; // extras are now included in courses

  // Duration: arrivedAt → last firedAt when all done
  const allDone = totalCourses > 0 && firedCount >= totalCourses;
  const parseHHMM = s => { if (!s) return null; const [h,m] = s.split(":").map(Number); return isNaN(h)||isNaN(m) ? null : h*60+m; };
  const lastFiredAt = allDone ? Object.values(log).map(e => e.firedAt).filter(Boolean).sort().pop() : null;
  const durationMins = (() => {
    const start = parseHHMM(table.arrivedAt), end = parseHHMM(lastFiredAt);
    if (start == null || end == null) return null;
    const d = end - start; return d >= 0 ? d : d + 1440;
  })();

  const pLabel = p => p === "Non-Alc" ? "N/A" : p === "Our Story" ? "O.S." : p === "Premium" ? "Prem" : p === "Wine" ? "Wine" : p;

  return (
    <div style={{ border: "2px solid #e8e8e8", borderRadius: 6, overflow: "hidden", background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,0.07)" }}>

      {/* ── Header ── */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e8e8e8", padding: "7px 10px", display: "flex", alignItems: "flex-start", gap: 8 }}>
        <span style={{ fontFamily: FONT, fontSize: table.tableGroup?.length > 1 ? 16 : 21, fontWeight: 800, color: "#111", lineHeight: 1, letterSpacing: -1, flexShrink: 0 }}>
          {table.tableGroup?.length > 1 ? `T${table.tableGroup.join("-")}` : `T${table.id}`}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5, flexWrap: "wrap" }}>
            {table.resName && <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{table.resName}</span>}
            {table.birthday && <span style={{ fontSize: 10 }}>🎂</span>}
            {table.guestType === "hotel" && <span style={{ fontFamily: FONT, fontSize: 8, color: "#9a6a20", letterSpacing: 0.5 }}>{table.room ? `#${table.room}` : "Hotel"}</span>}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 1, flexWrap: "wrap" }}>
            <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: "#111" }}>{seats.length} <span style={{ fontWeight: 600, fontSize: 10, letterSpacing: 0.5 }}>PAX</span></span>
            {table.resTime && <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, color: "#555" }}>{table.resTime}</span>}
            {table.arrivedAt && <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, color: "#4a9a6a" }}>arr. {table.arrivedAt}</span>}
            {table.menuType && <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, letterSpacing: 0.5, padding: "1px 5px", borderRadius: 3, background: isShort ? "#fff4e0" : "#e8f0ff", color: isShort ? "#a06000" : "#2a50a0" }}>{isShort ? "SHORT" : "LONG"}</span>}
          </div>
          {table.notes && <div style={{ fontFamily: FONT, fontSize: 8, color: "#999", fontStyle: "italic", marginTop: 1, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{table.notes}</div>}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: allDone ? "#4a9a6a" : "#111", lineHeight: 1 }}>{firedCount}<span style={{ fontSize: 10, color: "#aaa", fontWeight: 400 }}>/{totalCourses}</span></div>
          {allDone && durationMins != null && <div style={{ fontFamily: FONT, fontSize: 9, color: "#4a9a6a", marginTop: 2 }}>{durationMins} min</div>}
        </div>
      </div>

      {/* ── Pace ── */}
      <div style={{ borderBottom: "1px solid #e8e8e8", padding: "5px 10px", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#ccc", textTransform: "uppercase", flexShrink: 0 }}>Pace</span>
        {["Slow", "Fast"].map(p => {
          const colors = { Slow: { on: "#7a5020", bg: "#fdf4e8", border: "#c8a060" }, Fast: { on: "#6a2a2a", bg: "#fdf0f0", border: "#d08888" } };
          const active = table.pace === p;
          const col = colors[p];
          return (
            <button key={p} onClick={() => upd && upd(table.id, "pace", active ? "" : p)} style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: "3px 10px",
              border: `1px solid ${active ? col.border : "#ececec"}`,
              borderRadius: 3, cursor: upd ? "pointer" : "default",
              background: active ? col.bg : "#fff", color: active ? col.on : "#ccc",
              transition: "all 0.1s",
            }}>{p}</button>
          );
        })}
      </div>

      {/* ── Seats ── */}
      <div style={{ background: "#f6f6f6", borderBottom: "1px solid #e8e8e8", padding: "5px 10px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 6px" }}>
          {seats.map(s => {
            const p = s.pairing && s.pairing !== "—" ? s.pairing : null;
            const restrList = restrictions.filter(r => r.pos === s.id).map(r => r.note).filter(Boolean);
            const restrShort = k => { const d = RESTRICTIONS.find(r => r.key === k); return d ? d.label : k; };
            return (
              <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                <span style={{
                  fontFamily: FONT, fontSize: 9, fontWeight: 700, padding: "2px 5px", borderRadius: 2,
                  background: p ? (pairingBg[p] || "#f0f0f0") : "#e8e8e8",
                  color: p ? (pairingColor[p] || "#555") : "#666",
                }}>P{s.id}{p ? ` · ${pLabel(p)}` : ""}</span>
                {restrList.length > 0 && (
                  <span style={{ fontFamily: FONT, fontSize: 8, color: "#b03030", letterSpacing: 0.2, fontWeight: 600 }}>{restrList.map(restrShort).join(" · ")}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Unassigned restrictions — tap to assign to a seat */}
        {(() => {
          const unassigned = restrictions.map((r, i) => ({ ...r, _i: i })).filter(r => !r.pos && r.note);
          if (unassigned.length === 0) return null;
          return (
            <div style={{ marginTop: 7, paddingTop: 7, borderTop: "1px solid #e8e8e8" }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#b04040", textTransform: "uppercase", flexShrink: 0 }}>⚠ Unassigned</span>
                {unassigned.map(r => (
                  <span
                    key={r._i}
                    onClick={() => setAssigningRestrIdx(assigningRestrIdx === r._i ? null : r._i)}
                    style={{
                      fontFamily: FONT, fontSize: 9, padding: "2px 8px", borderRadius: 3,
                      border: "1px solid #e09090",
                      background: assigningRestrIdx === r._i ? "#b04040" : "#fef0f0",
                      color: assigningRestrIdx === r._i ? "#fff" : "#b04040",
                      fontWeight: 500, cursor: "pointer", userSelect: "none",
                    }}
                  >{restrLabel(r.note)} {assigningRestrIdx === r._i ? "→ pick seat" : "→"}</span>
                ))}
              </div>
              {assigningRestrIdx !== null && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", marginTop: 5 }}>
                  <span style={{ fontFamily: FONT, fontSize: 9, color: "#b04040", flexShrink: 0 }}>Assign to:</span>
                  {seats.map(s => (
                    <button key={s.id} onClick={() => assignRestrToSeat(s.id)} style={{
                      fontFamily: FONT, fontSize: 10, fontWeight: 700, padding: "3px 10px",
                      border: "1px solid #e09090", borderRadius: 3, cursor: "pointer",
                      background: "#fff", color: "#b04040",
                    }}>P{s.id}</button>
                  ))}
                  <button onClick={() => setAssigningRestrIdx(null)} style={{
                    fontFamily: FONT, fontSize: 9, padding: "3px 8px",
                    border: "1px solid #eee", borderRadius: 3, cursor: "pointer",
                    background: "#fff", color: "#bbb",
                  }}>cancel</button>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* ── Courses ── */}
      <div style={{ display: "flex", flexDirection: "column" }}>
        {courses.map((course, idx) => {
          const key = course.course_key || `course_${idx}`;
          const fired = !!log[key];
          const firedAt = log[key]?.firedAt;

          const baseName    = course.menu?.name || key;
          const baseSub     = course.menu?.sub  || "";
          const baseNameSi  = course.menu_si?.name || null;
          const baseSubSi   = course.menu_si?.sub  || "";
          const kitchenNote = course.kitchen_note || "";
          const line1 = baseName;
          const subDiff = (modSub) => {
            const baseTokens = new Set(baseSub.split(/[,·]+/).map(s => s.trim().toLowerCase()).filter(Boolean));
            const modTokens  = modSub.split(/[,·]+/).map(s => s.trim()).filter(Boolean);
            const newOnes    = modTokens.filter(t => !baseTokens.has(t.toLowerCase()));
            return newOnes.length > 0 ? newOnes[0] : modSub;
          };
          const allSeatDishes = seats.map(seat => {
            const restrKeys = seatRestrKeys(seat);
            if (restrKeys.length) {
              for (const key of RESTRICTION_PRIORITY_KEYS) {
                if (!restrKeys.includes(key)) continue;
                const mapped = RESTRICTION_COLUMN_MAP[key] || key;
                const note = course.restrictions?.[`${mapped}_note`];
                if (note) return note.toUpperCase();
              }
              const modified = applyCourseRestriction(course, restrKeys);
              if (modified) {
                if (modified.name !== baseName) return modified.name;
                if (modified.sub  !== baseSub)  return subDiff(modified.sub).toUpperCase();
              }
            }
            return baseName;
          });
          const anyMod = allSeatDishes.some(n => n !== baseName);
          const modGroups = (() => {
            if (!anyMod || fired) return null;
            const g = {};
            allSeatDishes.forEach(n => { g[n] = (g[n] || 0) + 1; });
            return g;
          })();
          const extraLabel = (() => {
            if (isBeetCourse(course))   return beetSeats.map(s => `P${s.id}`).join(" ");
            if (isCheeseCourse(course)) return cheeseSeats.map(s => `P${s.id}`).join(" ");
            if (isCakeCourse(course))   return cakeSeats.map(s => `P${s.id}`).join(" ");
            return null;
          })();

          return (
            <div key={key}
              onClick={() => fired ? unfire(key) : fire(key)}
              style={{
                borderBottom: "1px solid #f2f2f2",
                background: fired ? "#f3fcf5" : "#fff",
                borderLeft: fired ? "4px solid #4a9a6a" : "4px solid transparent",
                cursor: "pointer", transition: "background 0.15s",
              }}>
              <div style={{ display: "flex", alignItems: "center", padding: "7px 10px 7px 8px", gap: 7 }}>
                <span style={{ fontFamily: FONT, fontSize: 13, color: fired ? "#4a9a6a" : "#ddd", flexShrink: 0, lineHeight: 1 }}>{fired ? "✓" : "○"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Line 1: CELERIAC | pork head, bozner sauce */}
                  <div style={{
                    fontFamily: FONT, fontSize: 11, fontWeight: 700, lineHeight: 1.25,
                    color: fired ? "#bbb" : "#111",
                    textDecoration: fired ? "line-through" : "none",
                    letterSpacing: 0.2,
                  }}>
                    {line1}
                    {extraLabel && <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 400, color: "#bbb", marginLeft: 6 }}>{extraLabel}</span>}
                  </div>
                  {/* Restriction labels + kitchen note (line 3) — both in red */}
                  {(modGroups || kitchenNote) && !fired && (
                    <div style={{ marginTop: 2, display: "flex", flexWrap: "wrap", gap: "2px 8px" }}>
                      {modGroups && Object.entries(modGroups).sort(([a], [b]) => (a === baseName ? -1 : 1) - (b === baseName ? -1 : 1)).map(([name, count]) => (
                        <span key={name} style={{ fontFamily: FONT, fontSize: 10, color: name === baseName ? "#444" : "#c04040", fontWeight: 600 }}>{count}× {name}</span>
                      ))}
                      {kitchenNote && <span style={{ fontFamily: FONT, fontSize: 10, color: "#c04040", fontWeight: 600 }}>{kitchenNote}</span>}
                    </div>
                  )}
                </div>
                {firedAt && <span style={{ fontFamily: FONT, fontSize: 9, color: "#4a9a6a", fontWeight: 700, flexShrink: 0 }}>{firedAt}</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Done footer ── */}
      {allDone && (() => {
        const fmtDuration = (mins) => {
          if (mins == null) return null;
          const h = Math.floor(mins / 60), m = mins % 60;
          return h > 0 ? `${h}h ${m}m` : `${m}m`;
        };
        const timeRange = table.arrivedAt && lastFiredAt ? `${table.arrivedAt}–${lastFiredAt}` : null;
        const durLabel  = fmtDuration(durationMins);
        return (
          <div style={{ background: "#eaf7ee", borderTop: "2px solid #b8e8c4", padding: "7px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontFamily: FONT, fontSize: 13, color: "#4a9a6a" }}>✓</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {durLabel && <span style={{ fontFamily: FONT, fontSize: 10, color: "#4a9a6a", fontWeight: 700, letterSpacing: 0.5 }}>{durLabel}</span>}
                {timeRange && <span style={{ fontFamily: FONT, fontSize: 9, color: "#6ab88a", letterSpacing: 0.3 }}>{timeRange}</span>}
                {!durLabel && !timeRange && <span style={{ fontFamily: FONT, fontSize: 10, color: "#4a9a6a", fontWeight: 700, letterSpacing: 1 }}>COMPLETE</span>}
              </div>
            </div>
            <button
              onClick={e => { e.stopPropagation(); upd && upd(table.id, "kitchenArchived", true); }}
              style={{
                fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, padding: "4px 10px",
                border: "1px solid #a8d8b8", borderRadius: 3, cursor: "pointer",
                background: "#fff", color: "#4a9a6a", textTransform: "uppercase",
              }}
            >Archive</button>
          </div>
        );
      })()}
    </div>
  );
}

function SortableTicket({ table, menuCourses, upd, isDragging }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: table.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{
        flexShrink: 0, width: 248,
        transform: CSS.Transform.toString(transform),
        transition: isDragging ? 'none' : transition,
        willChange: 'transform',
        cursor: isDragging ? "grabbing" : "grab",
        userSelect: "none", WebkitUserSelect: "none",
        touchAction: "none",
      }}
    >
      {isDragging ? (
        // Ghost placeholder — dashed outline so the layout slot stays visible
        <div style={{
          width: 248, height: "100%", minHeight: 120,
          border: "2px dashed #d0e8d8", borderRadius: 6,
          background: "#f4fbf6",
        }} />
      ) : (
        <KitchenTicket table={table} menuCourses={menuCourses} upd={upd} />
      )}
    </div>
  );
}

function KitchenBoard({ tables, menuCourses, upd }) {
  const activeTables = tables
    .filter(t => t.active && !t.kitchenArchived)
    .filter(t => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup));
  const activeIds = activeTables.map(t => t.id).join(",");

  const [order, setOrder] = useState(() => activeTables.map(t => t.id));
  const [activeId, setActiveId] = useState(null);

  // Keep order in sync when tables are added/removed
  useEffect(() => {
    setOrder(prev => {
      const activeIdSet = new Set(activeTables.map(t => t.id));
      const kept = prev.filter(id => activeIdSet.has(id));
      const added = activeTables.map(t => t.id).filter(id => !kept.includes(id));
      return [...kept, ...added];
    });
  }, [activeIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  if (activeTables.length === 0) return (
    <div style={{ fontFamily: FONT, fontSize: 11, color: "#bbb", textAlign: "center", paddingTop: 80 }}>
      No active tables
    </div>
  );

  const orderedTables = order.map(id => activeTables.find(t => t.id === id)).filter(Boolean);
  const activeTable  = activeId ? activeTables.find(t => t.id === activeId) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={rectIntersection}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={({ active }) => setActiveId(active.id)}
      onDragEnd={({ active, over }) => {
        setActiveId(null);
        if (!over || active.id === over.id) return;
        setOrder(prev => {
          const from = prev.indexOf(active.id);
          const to   = prev.indexOf(over.id);
          return arrayMove(prev, from, to);
        });
      }}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={order} strategy={rectSortingStrategy}>
        <div style={{ paddingBottom: 8 }}>
          <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 12 }}>
            {orderedTables.map(t => (
              <SortableTicket
                key={t.id}
                table={t}
                menuCourses={menuCourses}
                upd={upd}
                isDragging={activeId === t.id}
              />
            ))}
          </div>
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.18,0.67,0.6,1.22)" }}>
        {activeTable && (
          <div style={{
            width: 248, borderRadius: 6,
            boxShadow: "0 12px 40px rgba(0,0,0,0.20), 0 2px 8px rgba(0,0,0,0.10)",
            transform: "rotate(1deg) scale(1.02)",
            transition: "box-shadow 0.15s",
            willChange: "transform",
          }}>
            <KitchenTicket table={activeTable} menuCourses={menuCourses} upd={upd} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

// ── Menu Generator ────────────────────────────────────────────────────────────
function MenuGenerator({ table, menuCourses = MENU_DATA, upd, onClose }) {
  const [teamNames, setTeamNames] = useState(readTeamNames);
  const [menuTitle, setMenuTitle] = useState("WINTER MENU");
  const [thankYouNote, setThankYouNote] = useState("Thank you for your visit.");
  const [lang, setLang] = useState("en");
  // Per-seat ephemeral one-time edits — { [seatId]: { [courseKey]: { name?, sub? } } }
  // Cleared automatically after the PDF for that seat is generated.
  const [seatEdits, setSeatEdits] = useState({});
  const [expandedSeatId, setExpandedSeatId] = useState(null);

  useEffect(() => {
    writeTeamNames(teamNames);
  }, [teamNames]);

  const seats        = table.seats        || [];
  const restrictions = table.restrictions || [];
  const tableBottles = table.bottleWines  || [];

  // Table-wide persistent overrides (applied silently, managed via Admin panel)
  const courseOverrides = table.courseOverrides || {};

  // Get the restriction+override-applied dish text for a course as it would appear for a seat.
  // Used to pre-populate the per-seat editor with the already-adjusted menu.
  const getSeatDish = (course, seatId) => {
    const withOv = applyMenuOverride(course, courseOverrides, seatId);
    const seatRestrKeys = restrictions.filter(r => !r.pos || r.pos === seatId).map(r => r.note);
    const resolved = lang === "si" && withOv.menu_si?.name ? { ...withOv, menu: withOv.menu_si } : withOv;
    return applyCourseRestriction(resolved, seatRestrKeys, lang) || { name: withOv.menu?.name || "", sub: withOv.menu?.sub || "" };
  };

  const setSeatEditField = (seatId, courseKey, field, value) => {
    setSeatEdits(prev => {
      const seatData = { ...(prev[seatId] || {}) };
      const courseEdit = { ...(seatData[courseKey] || {}) };
      if (value === "") {
        delete courseEdit[field];
      } else {
        courseEdit[field] = value;
      }
      if (Object.keys(courseEdit).length === 0) {
        delete seatData[courseKey];
      } else {
        seatData[courseKey] = courseEdit;
      }
      return { ...prev, [seatId]: seatData };
    });
  };

  const clearSeatAllEdits = (seatId) => {
    setSeatEdits(prev => { const n = { ...prev }; delete n[seatId]; return n; });
  };

  const defaultBeer = (s) => {
    if (s.pairing === "Non-Alc") return "nonalc";
    if (s.pairing && s.pairing !== "—") return "alco";
    return "alco";
  };

  const [beerChoices, setBeerChoices] = useState(() => {
    const init = {};
    seats.forEach(s => { init[s.id] = defaultBeer(s); });
    return init;
  });

  const setBeer = (seatId, val) => setBeerChoices(prev => ({ ...prev, [seatId]: val }));

  const isPrintable = () => true;
  const seatBottles = () => tableBottles;

  const openPrint = (seat) => {
    const seatCourses = menuCourses.map(c => applyMenuOverride(c, courseOverrides, seat.id));
    const html = generateMenuHTML({
      seat,
      table: { menuType: table.menuType || "", restrictions, bottleWines: tableBottles, birthday: table.birthday || false },
      menuTitle,
      teamNames,
      menuCourses: seatCourses,
      beerChoice: beerChoices[seat.id] || defaultBeer(seat),
      lang,
      seatOutputOverrides: seatEdits[seat.id] || {},
      thankYouNote,
    });
    const w = window.open("", "_blank", "width=620,height=880");
    if (!w) { alert("Pop-up blocked — allow pop-ups for this site."); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 600);
    // One-time: clear this seat's edits and collapse its editor after printing
    clearSeatAllEdits(seat.id);
    setExpandedSeatId(null);
  };

  const generateAll = () => {
    seats.forEach((s, i) => {
      setTimeout(() => openPrint(s), i * 900);
    });
  };

  const pairingColor = { Wine: "#7a5020", "Non-Alc": "#3a6a2a", Premium: "#4a3a7a", "Our Story": "#2a5a6a" };
  const pairingBg   = { Wine: "#fdf4e8", "Non-Alc": "#edf8e8", Premium: "#f0eeff", "Our Story": "#e8f5f8" };

  const BEER_OPTS = [
    { val: "alco",   label: "ALCO" },
    { val: "nonalc", label: "N/A" },
  ];

  return (
    <FullModal title="Generate Menus" onClose={onClose}>
      <div style={{ maxWidth: 580, margin: "0 auto" }}>

        {/* Language + Title + Team */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
          <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#888", textTransform: "uppercase" }}>Language</div>
          {[{val:"en",label:"EN"},{val:"si",label:"SLO"}].map(opt => (
            <button key={opt.val} onClick={() => {
              setLang(opt.val);
              setMenuTitle(opt.val === "si" ? "ZIMSKI MENI" : "WINTER MENU");
            }} style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 12px",
              border: `1px solid ${lang === opt.val ? "#1a1a1a" : "#e0e0e0"}`,
              borderRadius: 2, cursor: "pointer",
              background: lang === opt.val ? "#1a1a1a" : "#fff",
              color: lang === opt.val ? "#fff" : "#aaa",
            }}>{opt.label}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#888", textTransform: "uppercase", marginBottom: 6 }}>Menu Title</div>
            <input value={menuTitle} onChange={e => setMenuTitle(e.target.value)}
              style={{ fontFamily: FONT, fontSize: 11, padding: "8px 10px", border: "1px solid #e0e0e0", borderRadius: 2, outline: "none", width: "100%" }} />
          </div>
          <div style={{ flex: 2, minWidth: 220 }}>
            <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#888", textTransform: "uppercase", marginBottom: 6 }}>Team</div>
            <input value={teamNames} onChange={e => setTeamNames(e.target.value)}
              style={{ fontFamily: FONT, fontSize: 11, padding: "8px 10px", border: "1px solid #e0e0e0", borderRadius: 2, outline: "none", width: "100%" }} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#888", textTransform: "uppercase", marginBottom: 6 }}>Thank You Note</div>
            <input value={thankYouNote} onChange={e => setThankYouNote(e.target.value)}
              style={{ fontFamily: FONT, fontSize: 11, padding: "8px 10px", border: "1px solid #e0e0e0", borderRadius: 2, outline: "none", width: "100%" }} />
          </div>
        </div>

        {/* Seat rows */}
        <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#888", textTransform: "uppercase", marginBottom: 10 }}>Seats</div>

        {seats.map(s => {
          const seatRestr  = restrictions.filter(r => !r.pos || r.pos === s.id);
          const printable  = isPrintable(s);
          const extras     = Object.entries(s.extras || {}).filter(([,v]) => v?.ordered).map(([k]) => +k);
          const glasses    = s.glasses || [];
          const cocktails  = s.cocktails || [];
          const bottles    = seatBottles(s);

          const seatHasEdits = Object.keys(seatEdits[s.id] || {}).length > 0;
          const isExpanded = expandedSeatId === s.id;

          return (
            <div key={s.id} style={{
              border: `1px solid ${seatHasEdits ? "#f0c060" : "#f0f0f0"}`, borderRadius: 4, marginBottom: 8,
              background: seatHasEdits ? "#fffdf4" : "#fff",
            }}>
              {/* Main row */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", flexWrap: "wrap" }}>
                <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: "#999", minWidth: 28 }}>P{s.id}</span>

                {/* Pairing badge */}
                {s.pairing && s.pairing !== "—"
                  ? <span style={{ fontFamily: FONT, fontSize: 10, padding: "3px 9px", borderRadius: 2, background: pairingBg[s.pairing] || "#f5f5f5", color: pairingColor[s.pairing] || "#555", border: "1px solid #e0e0e0", fontWeight: 500 }}>{s.pairing}</span>
                  : glasses.length > 0 || cocktails.length > 0 || tableBottles.length > 0
                    ? <span style={{ fontFamily: FONT, fontSize: 10, padding: "3px 9px", borderRadius: 2, background: "#f5f5f5", color: "#888", border: "1px solid #e8e8e8" }}>drinks</span>
                    : <span style={{ fontFamily: FONT, fontSize: 10, color: "#ccc" }}>no pairing</span>}

                {seatRestr.map((r, i) => {
                  const isDietary = ["veg","vegan","pescetarian"].includes(r.note);
                  return (
                    <span key={i} style={{ fontFamily: FONT, fontSize: 9, padding: "2px 7px", borderRadius: 2,
                      background: isDietary ? "#edf8e8" : "#fef0f0",
                      color: isDietary ? "#2a6a2a" : "#b04040",
                      border: `1px solid ${isDietary ? "#88cc88" : "#e09090"}` }}>
                      {isDietary ? restrLabel(r.note) : `⚠ ${restrLabel(r.note)}`}
                    </span>
                  );
                })}
                {extras.includes(1) && <span style={{ fontFamily: FONT, fontSize: 9, padding: "2px 7px", borderRadius: 2, background: "#fdf4e8", color: "#7a5020", border: "1px solid #e0c898" }}>+BEETROOT</span>}
                {extras.includes(2) && <span style={{ fontFamily: FONT, fontSize: 9, padding: "2px 7px", borderRadius: 2, background: "#fdf4e8", color: "#7a5020", border: "1px solid #e0c898" }}>+CHEESE</span>}

                {/* Beer selector */}
                <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 4 }}>
                  <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#bbb", textTransform: "uppercase" }}>beer</span>
                  {BEER_OPTS.map(opt => (
                    <button key={opt.val} onClick={() => setBeer(s.id, opt.val)} style={{
                      fontFamily: FONT, fontSize: 8, letterSpacing: 1, padding: "3px 7px",
                      border: `1px solid ${beerChoices[s.id] === opt.val ? "#c8a96e" : "#e8e8e8"}`,
                      borderRadius: 2, cursor: "pointer",
                      background: beerChoices[s.id] === opt.val ? "#fdf4e8" : "#fff",
                      color: beerChoices[s.id] === opt.val ? "#7a5020" : "#bbb",
                    }}>{opt.label}</button>
                  ))}
                </div>

                {/* Edit button — opens per-seat ephemeral course editor */}
                <button onClick={() => setExpandedSeatId(isExpanded ? null : s.id)} style={{
                  fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 10px",
                  border: `1px solid ${seatHasEdits ? "#f0c060" : "#e0e0e0"}`, borderRadius: 2, cursor: "pointer",
                  background: seatHasEdits ? "#fff8e0" : "#fafafa",
                  color: seatHasEdits ? "#a07020" : "#aaa",
                }}>{isExpanded ? "▲" : (seatHasEdits ? "✎ EDITED" : "✎")}</button>

                <button onClick={() => openPrint(s)} style={{
                  marginLeft: "auto", fontFamily: FONT, fontSize: 9, letterSpacing: 2,
                  padding: "8px 16px", border: "1px solid #c8a96e",
                  borderRadius: 2, cursor: "pointer",
                  background: "#c8a96e", color: "#fff",
                }}>PDF</button>
              </div>

              {/* Per-seat ephemeral course editor — shows restriction-applied menu for this position */}
              {isExpanded && (
                <div style={{ borderTop: "1px solid #f5f5f5", padding: "10px 16px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, color: "#aaa", textTransform: "uppercase" }}>
                      Menu edit for P{s.id} — one-time, auto-cleared on PDF
                    </span>
                    {seatHasEdits && (
                      <button onClick={() => clearSeatAllEdits(s.id)} style={{
                        fontFamily: FONT, fontSize: 9, padding: "2px 8px",
                        border: "1px solid #ffcccc", borderRadius: 2, cursor: "pointer",
                        background: "#fff9f9", color: "#c04040",
                      }}>clear all</button>
                    )}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {menuCourses.filter(c => !c.is_snack).map(course => {
                      const key = course.course_key;
                      const baseDish = getSeatDish(course, s.id);
                      const edit = seatEdits[s.id]?.[key] || {};
                      const hasEdit = "name" in edit || "sub" in edit;
                      const inpStyle = { ...baseInp, padding: "3px 6px", fontSize: 11 };
                      return (
                        <div key={key} style={{
                          display: "grid", gridTemplateColumns: "120px 1fr 1.6fr 20px",
                          gap: 5, alignItems: "center",
                          borderRadius: 2, padding: "2px 4px",
                          background: hasEdit ? "#fffdf0" : "transparent",
                        }}>
                          <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, color: hasEdit ? "#a07020" : "#bbb",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {baseDish?.name || "—"}
                          </span>
                          <BlurInput
                            committedValue={"name" in edit ? edit.name : ""}
                            onCommit={v => setSeatEditField(s.id, key, "name", v)}
                            placeholder={"name" in edit ? "" : (baseDish?.name || "")}
                            style={inpStyle}
                          />
                          <BlurInput
                            committedValue={"sub" in edit ? edit.sub : ""}
                            onCommit={v => setSeatEditField(s.id, key, "sub", v)}
                            placeholder={"sub" in edit ? "" : (baseDish?.sub || "—")}
                            style={inpStyle}
                          />
                          {hasEdit
                            ? <button onClick={() => setSeatEdits(prev => {
                                const sd = { ...(prev[s.id] || {}) };
                                delete sd[key];
                                return { ...prev, [s.id]: Object.keys(sd).length ? sd : undefined };
                              })} style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                            : <span />}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Bottles preview */}
              {bottles.length > 0 && (
                <div style={{ padding: "0 16px 10px", display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {bottles.map((b, i) => (
                    <span key={i} style={{ fontFamily: FONT, fontSize: 9, padding: "2px 8px", borderRadius: 2, border: "1px solid #ddd", color: "#555", background: "#fafafa" }}>
                      🍾 {b.name}{b.vintage ? ` · ${b.vintage}` : ""}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {seats.length === 0 && (
          <div style={{ fontFamily: FONT, fontSize: 11, color: "#ccc", textAlign: "center", padding: "40px 0" }}>No seats yet</div>
        )}

        {seats.length > 0 && (
          <button onClick={generateAll} style={{
            marginTop: 16, width: "100%", fontFamily: FONT, fontSize: 9, letterSpacing: 2,
            padding: "12px", border: "1px solid #1a1a1a", borderRadius: 2, cursor: "pointer",
            background: "#1a1a1a", color: "#fff",
          }}>GENERATE ALL</button>
        )}
      </div>
    </FullModal>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────
function Header({ modeLabel, showAddRes = false, showSummary = false, showMenu = false, showArchive = false, syncLabel, syncLive, activeCount, reserved, seated, onExit, onMenu, onSummary, onArchive, onAddRes }) {
  const modeColor = modeLabel === "ADMIN" ? "#4b4b88" : modeLabel === "SERVICE" ? "#2f7a45" : "#555";
  return (
    <div style={{
      borderBottom: "1px solid #f0f0f0", padding: "10px 12px",
      display: "flex", flexDirection: "column", gap: 10,
      background: "#fff", position: "sticky", top: 0, zIndex: 50,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: 4, color: "#1a1a1a" }}>MILKA</span>
          <span style={{ width: 1, height: 14, background: "#e8e8e8" }} />
          <span style={{ fontSize: 10, letterSpacing: 3, color: modeColor, textTransform: "uppercase", fontWeight: 700 }}>{modeLabel}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {showAddRes && (
            <button onClick={onAddRes} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 12px", border: "1px solid #1a1a1a", borderRadius: 999, cursor: "pointer", background: "#1a1a1a", color: "#fff", fontWeight: 600 }}>+ RES</button>
          )}
          {showSummary && (
            <button onClick={onSummary} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", border: "1px solid #e8e8e8", borderRadius: 999, cursor: "pointer", background: "#fff", color: "#1a1a1a" }}>SUMMARY</button>
          )}
          {showMenu && (
            <button onClick={onMenu} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", border: "1px solid #e8e8e8", borderRadius: 999, cursor: "pointer", background: "#fff", color: "#1a1a1a" }}>MENU</button>
          )}
          {showArchive && (
            <button onClick={onArchive} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", border: "1px solid #e8d8b8", borderRadius: 999, cursor: "pointer", background: "#fff8f0", color: "#8a6030" }}>ARCHIVE</button>
          )}
          <span style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px",
            border: `1px solid ${syncLive ? "#8fc39f" : "#d8d8d8"}`,
            borderRadius: 999,
            background: syncLive ? "#eef8f1" : "#f6f6f6",
            color: syncLive ? "#2f7a45" : "#555",
            fontWeight: 600, whiteSpace: "nowrap",
          }}>{syncLabel}</span>
          <button onClick={onExit} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", border: "1px solid #e8e8e8", borderRadius: 999, cursor: "pointer", background: "#fff", color: "#1a1a1a", flexShrink: 0 }}>EXIT</button>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={topStatChip}>{activeCount} seated</span>
        <span style={topStatChip}>{reserved} reserved</span>
        <span style={topStatChip}>{seated} guests</span>
      </div>
    </div>
  );
}

// ── Summary Modal ─────────────────────────────────────────────────────────────
// ── Shared full-screen modal shell ────────────────────────────────────────────
function FullModal({ title, onClose, actions, children }) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "#fff", display: "flex", flexDirection: "column" }}>
      {/* Sticky top bar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 20px", height: 54, borderBottom: "1px solid #ebebeb",
        background: "#fff", flexShrink: 0,
      }}>
        <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 4, color: "#888", textTransform: "uppercase" }}>{title}</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {actions}
          <button onClick={onClose} style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "8px 16px",
            border: "1px solid #e0e0e0", borderRadius: 2,
            cursor: "pointer", background: "#fff", color: "#555",
          }}>✕ CLOSE</button>
        </div>
      </div>
      {/* Scrollable body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "28px 20px 60px" }}>
        {children}
      </div>
    </div>
  );
}

// ── Summary Modal ─────────────────────────────────────────────────────────────
function SummaryModal({ tables, dishes = [], onClose }) {
  const active = tables.filter(t => t.active || t.arrivedAt);
  const pairingColor = { "Wine": "#8a6030", "Non-Alc": "#1f5f73", "Premium": "#3a3a7a", "Our Story": "#2a6a4a" };
  const pairingBg    = { "Wine": "#fdf4e8", "Non-Alc": "#e8f7fb", "Premium": "#eaeaf5", "Our Story": "#e0f5ea" };

  const copyText = () => {
    const lines = [];
    active.forEach(t => {
      lines.push(`TABLE ${String(t.id).padStart(2,"0")}${t.resName ? " · " + t.resName : ""}${t.arrivedAt ? " [arr. " + t.arrivedAt + "]" : ""}`);
      if (t.menuType) lines.push(`  Menu: ${t.menuType}`);
      t.seats.forEach(s => {
        const parts = [`P${s.id}`];
        if (s.water && s.water !== "—") parts.push(`water:${s.water}`);
        if (s.pairing) parts.push(s.pairing);
        const gs = (s.glasses   || []).map(w => w?.name).filter(Boolean);
        const cs = (s.cocktails || []).map(c => c?.name).filter(Boolean);
        const sp = (s.spirits   || []).map(x => x?.name).filter(Boolean);
        const bs = (s.beers     || []).map(x => x?.name).filter(Boolean);
        if (gs.length) parts.push("glass:"    + gs.join(","));
        if (cs.length) parts.push("cocktail:" + cs.join(","));
        if (sp.length) parts.push("spirit:"   + sp.join(","));
        if (bs.length) parts.push("beer:"     + bs.join(","));
        const extras = dishes.filter(d => s.extras?.[d.id]?.ordered);
        if (extras.length) parts.push(extras.map(d => d.name).join(","));
        const restr = (t.restrictions || []).filter(r => r.pos === s.id);
        if (restr.length) parts.push("⚠" + restr.map(r => r.note).join(","));
        lines.push("  " + parts.join(" | "));
      });
      lines.push("");
    });
    navigator.clipboard?.writeText(lines.join("\n")).catch(() => {});
  };

  return (
    <FullModal title="Service Summary" onClose={onClose} actions={
      <button onClick={copyText} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "8px 16px", border: "1px solid #e0e0e0", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#555" }}>COPY TEXT</button>
    }>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        {active.length === 0 && (
          <div style={{ fontFamily: FONT, fontSize: 11, color: "#bbb", textAlign: "center", padding: "80px 0" }}>No active tables</div>
        )}
        {active.map(t => (
          <div key={t.id} style={{ border: "1px solid #f0f0f0", borderRadius: 4, overflow: "hidden", marginBottom: 12 }}>
            <div style={{ padding: "12px 16px", background: "#fafafa", borderBottom: "1px solid #f0f0f0", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontFamily: FONT, fontSize: 22, fontWeight: 300, color: "#1a1a1a", letterSpacing: 1, lineHeight: 1 }}>{String(t.id).padStart(2,"0")}</span>
              {t.resName   && <span style={{ fontFamily: FONT, fontSize: 14, fontWeight: 500, color: "#1a1a1a" }}>{t.resName}</span>}
              {t.arrivedAt && <span style={{ fontFamily: FONT, fontSize: 11, color: "#4a9a6a", fontWeight: 500 }}>arr. {t.arrivedAt}</span>}
              {t.menuType  && <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "3px 8px", border: "1px solid #e0e0e0", borderRadius: 2, color: "#555", background: "#fff" }}>{t.menuType}</span>}
              {t.birthday  && <span style={{ fontSize: 14 }}>🎂</span>}
              {t.notes     && <span style={{ fontFamily: FONT, fontSize: 10, color: "#999", fontStyle: "italic", marginLeft: "auto" }}>{t.notes}</span>}
            </div>
            <div style={{ padding: "8px 12px 12px" }}>
              {t.seats.map(s => {
                const ws      = waterStyle(s.water);
                const restr   = (t.restrictions || []).filter(r => r.pos === s.id);
                const extras  = dishes.filter(d => s.extras?.[d.id]?.ordered);
                const allBevs = [
                  ...(s.glasses   || []).filter(Boolean).map(x => ({ label: x.name, ts: BEV_TYPES.wine })),
                  ...(s.cocktails || []).filter(Boolean).map(x => ({ label: x.name, ts: BEV_TYPES.cocktail })),
                  ...(s.spirits   || []).filter(Boolean).map(x => ({ label: x.name, ts: BEV_TYPES.spirit })),
                  ...(s.beers     || []).filter(Boolean).map(x => ({ label: x.name, ts: BEV_TYPES.beer })),
                ];
                return (
                  <div key={s.id} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "8px 4px", borderBottom: "1px solid #f5f5f5" }}>
                    <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 600, color: restr.length ? "#b04040" : "#999", minWidth: 28, letterSpacing: 0.5 }}>P{s.id}</span>
                    {s.water !== "—" && <span style={{ fontFamily: FONT, fontSize: 10, padding: "2px 8px", borderRadius: 2, background: ws.bg || "#f5f5f5", color: "#333", border: "1px solid #e0e0e0" }}>{s.water}</span>}
                    {s.pairing && <span style={{ fontFamily: FONT, fontSize: 10, padding: "2px 8px", borderRadius: 2, border: "1px solid #e0e0e0", color: pairingColor[s.pairing] || "#555", background: pairingBg[s.pairing] || "#fafafa" }}>{s.pairing}</span>}
                    {extras.map(d => { const ex = s.extras[d.id]; return <span key={d.id} style={{ fontFamily: FONT, fontSize: 10, padding: "2px 7px", borderRadius: 2, border: "1px solid #88cc88", color: "#2a6a2a", background: "#e8f5e8" }}>{d.name}{ex?.pairing && ex.pairing !== "—" ? ` · ${ex.pairing}` : ""}</span>; })}
                    {allBevs.map((b, i) => <span key={i} style={{ fontFamily: FONT, fontSize: 10, padding: "2px 7px", borderRadius: 2, border: `1px solid ${b.ts.border}`, color: b.ts.color, background: b.ts.bg }}>{b.label}</span>)}
                    {restr.map((r, i) => <span key={i} style={{ fontFamily: FONT, fontSize: 10, padding: "2px 7px", borderRadius: 2, border: "1px solid #e09090", color: "#b04040", background: "#fef0f0" }}>⚠ {restrLabel(r.note)}</span>)}
                  </div>
                );
              })}
            </div>
            {(t.bottleWines || []).length > 0 && (
              <div style={{ padding: "10px 16px 14px", borderTop: "1px solid #f5f5f5", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 2 }}>Bottles</div>
                {(t.bottleWines || []).map((w, i) => {
                  const rawVintage = String(w?.vintage || "").trim();
                  const vintage = rawVintage.match(/^\d{4}$/) ? `'${rawVintage.slice(2)}` : rawVintage;
                  const title = [w?.producer, w?.name, vintage].filter(Boolean).join(" ");
                  const rawCountry = w?.country || "";
                  const country = COUNTRY_NAMES[rawCountry] || rawCountry;
                  const region = (w?.region || "").replace(new RegExp(`,?\\s*${rawCountry}$`), "").trim();
                  const sub = [region, country].filter(Boolean).join(", ") || w?.notes || "";
                  return (
                    <div key={i} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                      <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: "#1a1a1a", textTransform: "uppercase", letterSpacing: 0.3 }}>🍾 {title}</span>
                      {sub && <span style={{ fontFamily: FONT, fontSize: 11, color: "#5a8fc4" }}>{sub}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </FullModal>
  );
}

// ── Archive Modal ─────────────────────────────────────────────────────────────
function ArchiveModal({ tables, dishes, onArchiveAndClear, onClearAll, onClose, onRestoreTicket, menuCourses }) {
  const [entries, setEntries]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [expanded, setExpanded] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const pairingColor = { "Wine": "#8a6030", "Non-Alc": "#1f5f73", "Premium": "#3a3a7a", "Our Story": "#2a6a4a" };
  const pairingBg    = { "Wine": "#fdf4e8", "Non-Alc": "#e8f7fb", "Premium": "#eaeaf5", "Our Story": "#e0f5ea" };

  const loadEntries = () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    supabase.from("service_archive").select("*").order("created_at", { ascending: false }).limit(60)
      .then(({ data, error }) => { setEntries(error ? [] : (data || [])); setLoading(false); });
  };
  useEffect(loadEntries, []);

  const deleteEntry = async id => {
    if (!supabase) return;
    setDeleting(id);
    const { error } = await supabase.from("service_archive").delete().eq("id", id);
    if (error) {
      alert("Delete failed: " + error.message + "\n\nYou may need to enable DELETE on the service_archive table in Supabase (Policies → anon → DELETE).");
    } else {
      setEntries(e => e.filter(x => x.id !== id));
      if (expanded === id) setExpanded(null);
    }
    setDeleting(null);
  };

  const deleteAll = async () => {
    if (!supabase) return;
    if (!window.confirm("Delete ALL archive entries? This cannot be undone.")) return;
    setDeleting("all");
    const { error } = await supabase.from("service_archive").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    if (error) {
      alert("Delete failed: " + error.message + "\n\nYou may need to enable DELETE on the service_archive table in Supabase (Policies → anon → DELETE).");
    } else {
      setEntries([]);
      setExpanded(null);
    }
    setDeleting(null);
  };

  const activeTables = tables.filter(t => t.active || t.arrivedAt || t.resName || t.resTime);

  const archiveActions = (
    <div style={{ display: "flex", gap: 8 }}>
      <button onClick={onClearAll} style={{
        fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "8px 14px",
        border: "1px solid #e8e8e8", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#888",
      }}>CLEAR ALL</button>
      <button onClick={async () => { await onArchiveAndClear(); loadEntries(); }} style={{
        fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "8px 16px",
        border: "1px solid #c8a06e", borderRadius: 2, cursor: "pointer", background: "#fdf8f0", color: "#8a6030",
      }}>ARCHIVE & CLEAR ({activeTables.length})</button>
    </div>
  );

  const archivedTickets = (tables || []).filter(t => t.kitchenArchived);
  const [expandedTicket, setExpandedTicket] = useState(null);
  const fmtDuration = (mins) => { if (mins == null) return null; const h = Math.floor(mins / 60), m = mins % 60; return h > 0 ? `${h}h ${m}m` : `${m}m`; };
  const parseHHMM = s => { if (!s) return null; const [h, m] = s.split(":").map(Number); return isNaN(h) || isNaN(m) ? null : h * 60 + m; };

  return (
    <FullModal title="Archive · End of Day" onClose={onClose} actions={archiveActions}>
      <div style={{ maxWidth: 800, margin: "0 auto" }}>

        {/* ── Today's archived tickets ── */}
        {archivedTickets.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 3, color: "#888", textTransform: "uppercase", marginBottom: 10 }}>Today · Archived Tickets</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {archivedTickets.map(t => {
                const klog = t.kitchenLog || {};
                const lastFiredAt = Object.values(klog).map(e => e.firedAt).filter(Boolean).sort().pop();
                const start = parseHHMM(t.arrivedAt), end = parseHHMM(lastFiredAt);
                const durMins = (start != null && end != null) ? (end >= start ? end - start : end - start + 1440) : null;
                const timeRange = t.arrivedAt && lastFiredAt ? `${t.arrivedAt}–${lastFiredAt}` : null;
                const isOpen = expandedTicket === t.id;
                return (
                  <div key={t.id} style={{ border: "1px solid #d8edd8", borderRadius: 6, overflow: "hidden", background: "#f6fbf6" }}>
                    {/* Header row — click to expand */}
                    <div
                      onClick={() => setExpandedTicket(isOpen ? null : t.id)}
                      style={{ padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", cursor: "pointer" }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: FONT, fontSize: 18, fontWeight: 300, color: "#2a6a4a", letterSpacing: 1 }}>{String(t.id).padStart(2, "0")}</span>
                        {t.resName && <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: "#1a1a1a" }}>{t.resName}</span>}
                        <span style={{ fontFamily: FONT, fontSize: 10, color: "#6a9a7a" }}>{t.guests} guests</span>
                        {durMins != null && <span style={{ fontFamily: FONT, fontSize: 10, color: "#4a9a6a", fontWeight: 600 }}>{fmtDuration(durMins)}</span>}
                        {timeRange && <span style={{ fontFamily: FONT, fontSize: 9, color: "#8ab89a" }}>{timeRange}</span>}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <button
                          onClick={e => { e.stopPropagation(); onRestoreTicket && onRestoreTicket(t.id); }}
                          style={{
                            fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, padding: "4px 12px",
                            border: "1px solid #a8d8b8", borderRadius: 3, cursor: "pointer",
                            background: "#fff", color: "#4a9a6a", textTransform: "uppercase",
                          }}
                        >Restore</button>
                        <span style={{ fontFamily: FONT, fontSize: 14, color: "#8ab89a", transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s", display: "inline-block" }}>⌄</span>
                      </div>
                    </div>
                    {/* Expanded: full KitchenTicket */}
                    {isOpen && (
                      <div style={{ borderTop: "1px solid #d8edd8", padding: "12px 14px", background: "#fff" }}>
                        <div style={{ width: 248 }}>
                          <KitchenTicket table={t} menuCourses={menuCourses} upd={null} />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!supabase && <div style={{ fontFamily: FONT, fontSize: 11, color: "#bbb", padding: "60px 0", textAlign: "center" }}>Supabase not connected</div>}
        {supabase && loading && <div style={{ fontFamily: FONT, fontSize: 11, color: "#bbb", padding: "60px 0", textAlign: "center" }}>Loading…</div>}
        {supabase && !loading && entries.length === 0 && archivedTickets.length === 0 && <div style={{ fontFamily: FONT, fontSize: 11, color: "#bbb", padding: "60px 0", textAlign: "center" }}>No archived services yet</div>}
        {supabase && !loading && entries.length > 0 && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            <button onClick={deleteAll} disabled={deleting === "all"} style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 14px",
              border: "1px solid #ffcccc", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#e07070",
              opacity: deleting === "all" ? 0.5 : 1,
            }}>{deleting === "all" ? "DELETING…" : "DELETE ALL"}</button>
          </div>
        )}
        {entries.map(entry => {
          const isExp       = expanded === entry.id;
          const entryTables = entry.state?.tables || [];
          const totalGuests = entryTables.reduce((a, t) => a + (t.guests || 0), 0);
          return (
            <div key={entry.id} style={{ border: "1px solid #f0f0f0", borderRadius: 4, marginBottom: 8, overflow: "hidden" }}>
              <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", background: isExp ? "#fafafa" : "#fff" }}>
                <div onClick={() => setExpanded(isExp ? null : entry.id)} style={{ cursor: "pointer", flex: 1 }}>
                  <div style={{ fontFamily: FONT, fontSize: 13, fontWeight: 500, color: "#1a1a1a", marginBottom: 3 }}>{entry.label}</div>
                  <div style={{ fontFamily: FONT, fontSize: 10, color: "#999" }}>{entryTables.length} tables · {totalGuests} guests</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button onClick={() => deleteEntry(entry.id)} disabled={deleting === entry.id} style={{
                    fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "4px 10px",
                    border: "1px solid #ffcccc", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#e07070",
                    opacity: deleting === entry.id ? 0.5 : 1,
                  }}>{deleting === entry.id ? "…" : "delete"}</button>
                  <span onClick={() => setExpanded(isExp ? null : entry.id)} style={{ fontFamily: FONT, fontSize: 16, color: "#ccc", transform: isExp ? "rotate(180deg)" : "none", transition: "transform 0.18s", display: "inline-block", cursor: "pointer" }}>⌄</span>
                </div>
              </div>
              {isExp && (
                <div style={{ borderTop: "1px solid #f0f0f0" }}>
                  {entryTables.map(t => (
                    <div key={t.id} style={{ padding: "12px 16px", borderBottom: "1px solid #f8f8f8" }}>
                      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                        <span style={{ fontFamily: FONT, fontSize: 16, fontWeight: 300, color: "#1a1a1a", letterSpacing: 1 }}>{String(t.id).padStart(2,"0")}</span>
                        {t.resName   && <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 500 }}>{t.resName}</span>}
                        {t.arrivedAt && <span style={{ fontFamily: FONT, fontSize: 10, color: "#4a9a6a" }}>arr. {t.arrivedAt}</span>}
                        {t.menuType  && <span style={{ fontFamily: FONT, fontSize: 9, padding: "2px 7px", border: "1px solid #e8e8e8", borderRadius: 2, color: "#555" }}>{t.menuType}</span>}
                        {t.birthday  && <span style={{ fontSize: 12 }}>🎂</span>}
                        {(t.bottleWines || []).map((w, i) => (
                          <span key={i} style={{ fontFamily: FONT, fontSize: 9, padding: "2px 7px", borderRadius: 2, border: "1px solid #c8a060", color: "#7a5020", background: "#fdf4e8" }}>🍾 {w.name}</span>
                        ))}
                      </div>
                      {(t.seats || []).map(s => {
                        const ws    = waterStyle(s.water);
                        const restr = (t.restrictions || []).filter(r => r.pos === s.id);
                        const extra = (entry.state?.dishes || dishes).filter(d => s.extras?.[d.id]?.ordered);
                        const bevs  = [
                          ...(s.glasses   || []).filter(Boolean).map(x => ({ label: x.name, ts: BEV_TYPES.wine })),
                          ...(s.cocktails || []).filter(Boolean).map(x => ({ label: x.name, ts: BEV_TYPES.cocktail })),
                          ...(s.spirits   || []).filter(Boolean).map(x => ({ label: x.name, ts: BEV_TYPES.spirit })),
                          ...(s.beers     || []).filter(Boolean).map(x => ({ label: x.name, ts: BEV_TYPES.beer })),
                        ];
                        return (
                          <div key={s.id} style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", padding: "5px 4px", borderBottom: "1px solid #fafafa" }}>
                            <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 600, color: "#999", minWidth: 26 }}>P{s.id}</span>
                            {s.water !== "—" && <span style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 2, background: ws.bg || "#f0f0f0", color: "#444", border: "1px solid #e0e0e0" }}>{s.water}</span>}
                            {s.pairing && <span style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 2, color: pairingColor[s.pairing] || "#555", background: pairingBg[s.pairing] || "#fafafa", border: "1px solid #e0e0e0" }}>{s.pairing}</span>}
                            {bevs.map((b, i) => <span key={i} style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 2, border: `1px solid ${b.ts.border}`, color: b.ts.color, background: b.ts.bg }}>{b.label}</span>)}
                            {extra.map(d => <span key={d.id} style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 2, border: "1px solid #88cc88", color: "#2a6a2a", background: "#e8f5e8" }}>{d.name}</span>)}
                            {restr.map((r, i) => <span key={i} style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 2, border: "1px solid #e09090", color: "#b04040", background: "#fef0f0" }}>⚠ {restrLabel(r.note)}</span>)}
                          </div>
                        );
                      })}
                      {/* Kitchen log for this table */}
                      {(() => {
                        const klog = t.kitchenLog || {};
                        const fired = Object.entries(klog)
                          .map(([courseKey, v]) => {
                            const course = (entry.state?.menuCourses || []).find(c => c.course_key === courseKey);
                            const name = course?.menu?.name || courseKey;
                            return { name, firedAt: v.firedAt || "" };
                          })
                          .filter(e => e.firedAt)
                          .sort((a, b) => a.firedAt.localeCompare(b.firedAt));
                        if (!fired.length) return null;
                        return (
                          <div style={{ padding: "6px 4px 2px", display: "flex", flexWrap: "wrap", gap: "4px 10px", alignItems: "center" }}>
                            <span style={{ fontFamily: FONT, fontSize: 9, color: "#bbb", letterSpacing: 1, textTransform: "uppercase" }}>Kitchen</span>
                            {fired.map((e, i) => (
                              <span key={i} style={{ fontFamily: FONT, fontSize: 10, color: "#4a9a6a" }}>
                                {e.firedAt} <span style={{ color: "#888" }}>{e.name}</span>
                              </span>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </FullModal>
  );
}

// ── Access gate constants ─────────────────────────────────────────────────────
const PINS            = { admin: "3412" };
const ACCESS_PASSWORD = "milka2025";          // ← change to your own password
const ACCESS_KEY      = "milka_access";
const ACCESS_TTL_MS   = 12 * 60 * 60 * 1000; // 12 hours

const readAccess = () => {
  try {
    const raw = localStorage.getItem(ACCESS_KEY);
    if (!raw) return false;
    const { ts } = JSON.parse(raw);
    return Date.now() - ts < ACCESS_TTL_MS;
  } catch { return false; }
};
const writeAccess = () => {
  try { localStorage.setItem(ACCESS_KEY, JSON.stringify({ ts: Date.now() })); } catch {}
};

// ── GateScreen — password wall before anything else ───────────────────────────
function GateScreen({ onPass }) {
  const [pw, setPw]       = useState("");
  const [shake, setShake] = useState(false);
  const [show, setShow]   = useState(false);

  const attempt = val => {
    if (val === ACCESS_PASSWORD) {
      writeAccess();
      onPass();
    } else {
      setShake(true);
      setTimeout(() => { setShake(false); setPw(""); }, 600);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#fff",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      fontFamily: FONT, padding: "20px 16px",
    }}>
      <GlobalStyle />
      <div style={{ marginBottom: 52, textAlign: "center" }}>
        <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: 6, color: "#1a1a1a", marginBottom: 6 }}>MILKA</div>
        <div style={{ fontSize: 9, letterSpacing: 4, color: "#555" }}>SERVICE BOARD</div>
      </div>

      <div style={{ width: "100%", maxWidth: 320, textAlign: "center" }}>
        <div style={{ fontFamily: FONT, fontSize: 10, letterSpacing: 3, color: "#888", marginBottom: 28, textTransform: "uppercase" }}>
          enter password
        </div>

        <div style={{ animation: shake ? "shake 0.4s ease" : "none", marginBottom: 12 }}>
          <div style={{ position: "relative" }}>
            <input
              type={show ? "text" : "password"}
              value={pw}
              onChange={e => setPw(e.target.value)}
              onKeyDown={e => e.key === "Enter" && attempt(pw)}
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              style={{
                ...baseInp,
                textAlign: "center",
                letterSpacing: show ? 2 : 6,
                fontSize: MOBILE_SAFE_INPUT_SIZE,
                paddingRight: 44,
                borderColor: shake ? "#f0c0c0" : "#e8e8e8",
                transition: "border-color 0.2s",
              }}
              placeholder="••••••••"
            />
            <button onClick={() => setShow(s => !s)} style={{
              position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", cursor: "pointer",
              color: "#bbb", fontSize: 13, padding: 0, lineHeight: 1,
            }}>{show ? "hide" : "show"}</button>
          </div>
        </div>

        <button onClick={() => attempt(pw)} style={{
          width: "100%", fontFamily: FONT, fontSize: 11, letterSpacing: 3,
          padding: "14px", border: "1px solid #1a1a1a", borderRadius: 2,
          cursor: "pointer", background: "#1a1a1a", color: "#fff",
          textTransform: "uppercase", marginTop: 8,
        }}>Enter</button>
      </div>

      <style>{`@keyframes shake {
        0%,100%{transform:translateX(0)}
        20%{transform:translateX(-8px)} 40%{transform:translateX(8px)}
        60%{transform:translateX(-5px)} 80%{transform:translateX(5px)}
      }`}</style>
    </div>
  );
}

// ── Login Screen ──────────────────────────────────────────────────────────────
function LoginScreen({ onEnter }) {
  const MODES = [
    { id: "display",  label: "Display",  sub: "read-only view",      icon: "◎", pin: false },
    { id: "service",  label: "Service",  sub: "full service access",  icon: "◈", pin: false },
    { id: "admin",    label: "Admin",    sub: "pin required",         icon: "◆", pin: true  },
  ];
  const [picking, setPicking] = useState(null);
  const [pin, setPin]         = useState("");
  const [shake, setShake]     = useState(false);

  const handleTile = mode => {
    if (!mode.pin) { onEnter(mode.id); return; }
    setPicking(mode.id);
    setPin("");
  };

  const handleDigit = d => {
    const next = pin + d;
    setPin(next);
    if (next.length === 4) {
      if (next === PINS[picking]) {
        onEnter(picking);
        setPicking(null);
      } else {
        setShake(true);
        setPin("");
        setTimeout(() => setShake(false), 500);
      }
    }
  };

  useEffect(() => {
    if (!picking) return;
    const onKey = e => {
      if (e.key >= "0" && e.key <= "9") handleDigit(e.key);
      else if (e.key === "Backspace") setPin(p => p.slice(0, -1));
      else if (e.key === "Escape") { setPicking(null); setPin(""); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picking, pin]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ minHeight: "100vh", background: "#fff", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <GlobalStyle />
      <div style={{ marginBottom: 48, textAlign: "center" }}>
        <div style={{ fontFamily: FONT, fontSize: 14, fontWeight: 600, letterSpacing: 6, color: "#1a1a1a", marginBottom: 8 }}>MILKA</div>
        <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 4, color: "#999" }}>SERVICE BOARD</div>
      </div>

      {!picking ? (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center", maxWidth: 480 }}>
          {MODES.map(m => (
            <button key={m.id} onClick={() => handleTile(m)} style={{
              fontFamily: FONT, cursor: "pointer",
              background: "#fff", border: "1px solid #e8e8e8", borderRadius: 2,
              padding: "28px 32px", width: 140, textAlign: "center",
              transition: "all 0.12s", display: "flex", flexDirection: "column", alignItems: "center", gap: 10,
            }}>
              <span style={{ fontSize: 24, color: "#444" }}>{m.icon}</span>
              <div>
                <div style={{ fontSize: 11, letterSpacing: 2, color: "#1a1a1a", fontWeight: 500 }}>{m.label.toUpperCase()}</div>
                <div style={{ fontSize: 9, letterSpacing: 1, color: "#999", marginTop: 4 }}>{m.sub}</div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 28, width: "100%", maxWidth: 320 }}>
          <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 4, color: "#666" }}>ENTER PIN</div>
          <div style={{
            display: "flex", gap: 14, animation: shake ? "shake 0.4s" : "none",
          }}>
            {[0,1,2,3].map(i => (
              <div key={i} style={{
                width: 14, height: 14, borderRadius: "50%",
                background: i < pin.length ? "#1a1a1a" : "#e8e8e8",
                transition: "background 0.1s",
              }} />
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, width: "100%" }}>
            {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((d, i) => (
              <button key={i} onClick={() => {
                if (d === "⌫") setPin(p => p.slice(0,-1));
                else if (d !== "") handleDigit(d);
              }} disabled={d === ""} style={{
                fontFamily: FONT, fontSize: 22, fontWeight: 300,
                padding: "18px 0", border: "1px solid #e8e8e8", borderRadius: 2,
                background: d === "" ? "transparent" : "#fff", cursor: d === "" ? "default" : "pointer",
                color: "#1a1a1a", letterSpacing: 1,
                opacity: d === "" ? 0 : 1,
                transition: "all 0.08s",
              }}>{d}</button>
            ))}
          </div>
          <button onClick={() => { setPicking(null); setPin(""); }} style={{
            fontFamily: FONT, fontSize: 10, letterSpacing: 2, color: "#999",
            background: "none", border: "none", cursor: "pointer", padding: 8,
          }}>CANCEL</button>
          <style>{`@keyframes shake {
            0%{transform:translateX(0)} 20%{transform:translateX(-8px)}
            40%{transform:translateX(8px)} 60%{transform:translateX(-5px)}
            80%{transform:translateX(5px)} 100%{transform:translateX(0)}
          }`}</style>
        </div>
      )}
    </div>
  );
}

function GlobalStyle() {
  return (
    <style>{`
      * { box-sizing: border-box; }
      body { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; color: #1a1a1a; }
      input, textarea, select { font-size: ${MOBILE_SAFE_INPUT_SIZE}px; }
      button, a, label { touch-action: manipulation; }
    `}</style>
  );
}

// ── Error Boundary ────────────────────────────────────────────────────────────
import { Component } from "react";
export class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ fontFamily: "monospace", padding: 40, textAlign: "center", marginTop: "20vh" }}>
        <div style={{ fontSize: 32, marginBottom: 16 }}>⚠</div>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>Something went wrong</div>
        <div style={{ fontSize: 11, color: "#888", marginBottom: 32, maxWidth: 320, margin: "0 auto 32px" }}>
          {String(this.state.error?.message || this.state.error)}
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{ fontFamily: "monospace", fontSize: 12, letterSpacing: 2, padding: "12px 28px", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer" }}
        >
          RELOAD
        </button>
      </div>
    );
  }
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const localSnapshot = readLocalBoardState();
  const initialState  = localSnapshot || defaultBoardState();

  const localBev = readLocalBeverages();

  const [tables,    setTables]    = useState(initialState.tables);
  const [menuCourses, setMenuCourses] = useState(MENU_DATA); // live from Supabase
  const [menuOverrides, setMenuOverrides] = useState(() => {
    try { return JSON.parse(localStorage.getItem("milka_menu_overrides") || "{}"); } catch { return {}; }
  });
  const [dishes,    setDishes]    = useState(mergeDishes(initialState.dishes));
  const [wines,     setWines]     = useState(initialState.wines);
  const [cocktails, setCocktails] = useState(localBev?.cocktails ?? initialState.cocktails ?? initCocktails);
  const [spirits,   setSpirits]   = useState(localBev?.spirits   ?? initialState.spirits   ?? initSpirits);
  const [beers,     setBeers]     = useState(localBev?.beers      ?? initialState.beers     ?? initBeers);
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem("milka_mode") || null; } catch { return null; }
  });
  const [sel,          setSel]          = useState(null);
  const [quickView,    setQuickView]    = useState("board");
  const [resModal,     setResModal]     = useState(null);
  const [resModalPresetTime, setResModalPresetTime] = useState(null);
  const [adminOpen,    setAdminOpen]    = useState(false);
  const [summaryOpen,  setSummaryOpen]  = useState(false);
  const [archiveOpen,  setArchiveOpen]  = useState(false);
  const [syncStatus,   setSyncStatus]   = useState(hasSupabaseConfig ? "connecting" : "local-only");
  // Access gate: checked once at init against 12h TTL
  const [authed,       setAuthed]       = useState(() => readAccess());
  // Hydration: render immediately from localStorage, sync Supabase in background
  const [hydrated,     setHydrated]     = useState(() => {
    if (!hasSupabaseConfig) return true;
    try { return !!localStorage.getItem(STORAGE_KEY); } catch { return false; }
  });

  const applyingRemoteRef  = useRef(false);
  const saveTimerRef       = useRef(null);
  const prevTablesJsonRef  = useRef((initialState.tables || initTables).map(t => JSON.stringify(sanitizeTable(t))));
  const tablesRef          = useRef(tables);

  const boardState = { tables, dishes, cocktails, spirits, beers };
  const tablesJson = useMemo(() => JSON.stringify(tables), [tables]);
  const boardJson  = useMemo(() => JSON.stringify(boardState), [tablesJson, dishes, cocktails, spirits, beers]); // eslint-disable-line react-hooks/exhaustive-deps
  const boardStateRef = useRef(boardState);
  boardStateRef.current = boardState;
  tablesRef.current = tables;

  const mergeRemoteTables = rows => {
    const byId = new Map((Array.isArray(rows) ? rows : []).map(row => [Number(row.table_id), sanitizeTable({ id: Number(row.table_id), ...(row.data || {}) })]));
    applyingRemoteRef.current = true;
    setTables(() => initTables.map(base => byId.get(base.id) || base));
    setTimeout(() => { applyingRemoteRef.current = false; }, 0);
  };

  const applyRemoteTableRow = row => {
    const tableId = Number(row?.table_id);
    if (!tableId) return;
    const nextTable = sanitizeTable({ id: tableId, ...(row.data || {}) });
    applyingRemoteRef.current = true;
    setTables(prev => prev.map(t => t.id === tableId ? nextTable : t));
    setTimeout(() => { applyingRemoteRef.current = false; }, 0);
  };

  const selTable   = tables.find(t => t.id === sel);
  const modalTable = tables.find(t => t.id === resModal);

  const upd = (id, f, v) => setTables(p => p.map(t => t.id === id ? { ...t, [f]: v } : t));

  const updSeat = (tid, sid, f, v) => setTables(p => p.map(t =>
    t.id !== tid ? t : { ...t, seats: t.seats.map(s => s.id === sid ? { ...s, [f]: v } : s) }
  ));

  const setGuests = (tid, n) => setTables(p => p.map(t =>
    t.id !== tid ? t : { ...t, guests: n, seats: makeSeats(n, t.seats) }
  ));

  const seatTable = id => {
    const now = fmt(new Date());
    const group = tables.find(t => t.id === id)?.tableGroup;
    const ids = group?.length > 1 ? group : [id];
    setTables(p => p.map(t =>
      !ids.includes(t.id) ? t : { ...t, active: true, arrivedAt: now, seats: makeSeats(t.guests, t.seats) }
    ));
  };

  const unseatTable = id => {
    const group = tables.find(t => t.id === id)?.tableGroup;
    const ids = group?.length > 1 ? group : [id];
    setTables(p => p.map(t =>
      !ids.includes(t.id) ? t : { ...t, active: false, arrivedAt: null }
    ));
  };

  const clear = id => {
    if (typeof window !== "undefined" && !window.confirm("Clear this table and reset its details?")) return;
    setTables(p => p.map(t => t.id !== id ? t : blankTable(id)));
    setSel(null);
  };

  const syncMenu = async () => {
    try {
      const r = await fetch(`/api/sync-menu?secret=milka2025`);
      const json = await r.json();
      if (!r.ok) return { ok: false, error: json.error || String(r.status) };
      return { ok: true, synced: json.synced };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };

  const saveBeverages = async ({ cocktails: newC, spirits: newS, beers: newB }) => {
    setCocktails(newC);
    setSpirits(newS);
    setBeers(newB);
    writeLocalBeverages({ cocktails: newC, spirits: newS, beers: newB });
    if (!supabase) return;
    const rows = [
      ...newC.map((item, i) => ({ category: "cocktail", name: item.name, notes: item.notes || "", position: i })),
      ...newS.map((item, i) => ({ category: "spirit",   name: item.name, notes: item.notes || "", position: i })),
      ...newB.map((item, i) => ({ category: "beer",     name: item.name, notes: item.notes || "", position: i })),
    ];
    await supabase.from("beverages").delete().in("category", ["cocktail", "spirit", "beer"]);
    if (rows.length > 0) await supabase.from("beverages").insert(rows);
  };

  const clearAll = () => {
    if (typeof window !== "undefined" && !window.confirm("Clear ALL tables?")) return;
    setTables(Array.from({ length: 10 }, (_, i) => blankTable(i + 1)));
    setSel(null);
    setArchiveOpen(false);
  };

  const archiveAndClearAll = async () => {
    if (typeof window !== "undefined" && !window.confirm("Archive today's service and clear all tables?")) return;
    const snap = boardStateRef.current; // stable reference, never stale
    const dateStr = new Date().toLocaleDateString("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric" });
    const activeTables = snap.tables.filter(t => t.active || t.arrivedAt || t.resName || t.resTime);
    if (supabase) {
      const { error } = await supabase.from("service_archive").insert({
        date: new Date().toISOString().slice(0, 10),
        label: dateStr,
        state: { ...snap, tables: activeTables, menuCourses: effectiveMenuCourses },
      });
      if (error) {
        window.alert("Archive failed: " + error.message);
        return;
      }
    }
    setTables(Array.from({ length: 10 }, (_, i) => blankTable(i + 1)));
    setSel(null);
    setArchiveOpen(false);
  };

  const swapSeats = (tid, aId, bId) => setTables(p => p.map(t => {
    if (t.id !== tid) return t;
    const sA = t.seats.find(s => s.id === aId);
    const sB = t.seats.find(s => s.id === bId);
    return { ...t, seats: t.seats.map(s => {
      if (s.id === aId) return { ...sB, id: aId };
      if (s.id === bId) return { ...sA, id: bId };
      return s;
    })};
  }));

  const saveRes = (id, { tableIds, tableId, name, time, menuType, guests, guestType, room, birthday, restrictions, notes }) => {
    const group = tableIds ?? (tableId ? [tableId] : [id]);
    const sortedGroup = [...group].sort((a, b) => a - b);
    // Find old group to clear tables that are no longer part of it
    const oldGroup = tables.find(t => t.id === id)?.tableGroup || [id];
    setTables(p => p.map(t => {
      // Clear tables that were in the old group but aren't in the new group
      if (oldGroup.includes(t.id) && !sortedGroup.includes(t.id)) {
        return { ...blankTable(t.id), active: t.active, arrivedAt: t.arrivedAt, kitchenLog: t.kitchenLog };
      }
      if (!sortedGroup.includes(t.id)) return t;
      const newSeats = makeSeats(guests, t.seats).map(s => ({
        ...s,
        extras: { ...s.extras, ...(birthday ? { 3: { ordered: true, pairing: "—" } } : {}) },
      }));
      return { ...t, resName: name, resTime: time, menuType, guestType, room, guests, seats: newSeats, birthday, restrictions, notes, tableGroup: sortedGroup };
    }));
    setResModal(null);
  };

  const changeMode = nextMode => {
    setMode(nextMode);
    try {
      if (nextMode) localStorage.setItem("milka_mode", nextMode);
      else          localStorage.removeItem("milka_mode");
    } catch {}
  };

  const switchMode = () => { changeMode(null); setSel(null); };

  // ── Persist locally + sync changed tables to Supabase ─────────────────────
  useEffect(() => {
    if (!hydrated) return;

    writeLocalBoardState(boardStateRef.current);

    if (applyingRemoteRef.current) return;
    if (!supabase) return;

    const nextJsonByIndex = tables.map(t => JSON.stringify(sanitizeTable(t)));
    const changedTables = tables
      .filter((table, idx) => nextJsonByIndex[idx] !== prevTablesJsonRef.current[idx])
      .map(table => ({ table_id: table.id, data: sanitizeTable(table), updated_at: new Date().toISOString() }));

    prevTablesJsonRef.current = nextJsonByIndex;
    if (changedTables.length === 0) return;

    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      let lastError;
      for (let attempt = 0; attempt < 4; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 500 * attempt));
        const { error } = await supabase.from(SERVICE_TABLES_TABLE).upsert(changedTables, { onConflict: "table_id" });
        if (!error) { setSyncStatus("live"); return; }
        lastError = error;
      }
      setSyncStatus("sync-error");
      console.error("Save failed after 4 attempts:", lastError);
    }, 50);

    return () => clearTimeout(saveTimerRef.current);
  }, [tablesJson, hydrated]);

  // ── Persist menu overrides to localStorage ─────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem("milka_menu_overrides", JSON.stringify(menuOverrides)); } catch {}
  }, [menuOverrides]);

  // ── Effective menu courses (overrides applied on top of sheet data) ─────────
  // useMemo so this doesn't recompute on every render (e.g. while typing elsewhere)
  const effectiveMenuCourses = useMemo(
    () => menuCourses.map(c => applyMenuOverride(c, menuOverrides)),
    [menuCourses, menuOverrides]
  );

  // ── Load service tables from Supabase + subscribe realtime ────────────────
  useEffect(() => {
    if (!supabase) return;
    let isMounted = true;

    const gateTimeout = setTimeout(() => { if (isMounted) setHydrated(true); }, 1000);

    const loadRemoteTables = async () => {
      const { data, error } = await supabase
        .from(SERVICE_TABLES_TABLE)
        .select("table_id, data, updated_at")
        .order("table_id", { ascending: true });

      if (!isMounted) return;
      clearTimeout(gateTimeout);

      if (error) {
        setSyncStatus("sync-error");
        setHydrated(true);
        return;
      }

      if (Array.isArray(data) && data.length > 0) {
        const nextJson = initTables.map(base => {
          const row = data.find(item => Number(item.table_id) === base.id);
          return JSON.stringify(row ? sanitizeTable({ id: base.id, ...(row.data || {}) }) : base);
        });
        const hasChanges = nextJson.some((j, i) => j !== prevTablesJsonRef.current[i]);
        if (hasChanges) {
          mergeRemoteTables(data);
          prevTablesJsonRef.current = nextJson;
        }
      }

      setSyncStatus("live");
      setHydrated(true);
    };

    loadRemoteTables();

    // Polling fallback — refreshes every 5 s in case realtime misses an event
    const pollInterval = setInterval(() => { if (isMounted) loadRemoteTables(); }, 15000);

    // Immediately re-fetch when the tab/screen becomes visible (e.g. kitchen display wakes up)
    const onVisibilityChange = () => { if (!document.hidden && isMounted) loadRemoteTables(); };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const channel = supabase
      .channel("milka-service-tables-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: SERVICE_TABLES_TABLE }, payload => {
        if (payload.eventType === "DELETE") {
          const tableId = Number(payload.old?.table_id);
          if (!tableId) return;
          applyingRemoteRef.current = true;
          setTables(prev => prev.map(t => t.id === tableId ? blankTable(tableId) : t));
          setTimeout(() => { applyingRemoteRef.current = false; }, 0);
          setSyncStatus("live");
          return;
        }
        if (!payload.new) return;
        applyRemoteTableRow(payload.new);
        prevTablesJsonRef.current = tablesRef.current.map(t => JSON.stringify(sanitizeTable(t.id === Number(payload.new.table_id) ? { id: Number(payload.new.table_id), ...(payload.new.data || {}) } : t)));
        setSyncStatus("live");
      })
      .subscribe(status => {
        if (status === "SUBSCRIBED") { setSyncStatus("live"); }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setSyncStatus("sync-error");
          // Force a full re-fetch so we don't miss anything while disconnected
          if (isMounted) loadRemoteTables();
        }
      });

    return () => {
      isMounted = false;
      clearTimeout(gateTimeout);
      clearInterval(pollInterval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      supabase.removeChannel(channel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Beverages: load from Supabase + realtime ─────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    let mounted = true;

    const loadBevs = async () => {
      const { data, error } = await supabase
        .from("beverages")
        .select("id, category, name, notes, position")
        .order("position", { ascending: true });
      if (!mounted || error || !data || data.length === 0) return;
      const byCat = cat => data
        .filter(r => r.category === cat)
        .map((r, i) => ({ id: r.id, name: r.name, notes: r.notes || "", position: r.position ?? i }));
      const c = byCat("cocktail");
      const s = byCat("spirit");
      const b = byCat("beer");
      if (c.length) setCocktails(c);
      if (s.length) setSpirits(s);
      if (b.length) setBeers(b);
      writeLocalBeverages({ cocktails: c, spirits: s, beers: b });
    };

    loadBevs();

    const bevChannel = supabase.channel("milka-beverages")
      .on("postgres_changes", { event: "*", schema: "public", table: "beverages" }, loadBevs)
      .subscribe();

    return () => { mounted = false; supabase.removeChannel(bevChannel); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Wines: load from Supabase wines table + realtime ─────────────────────────
  useEffect(() => {
    if (!supabase) return;
    let mounted = true;

    const loadWines = async () => {
      const { data, error } = await supabase
        .from("wines")
        .select("key, name, wine_name, producer, vintage, region, country, by_glass")
        .order("name", { ascending: true });
      if (!mounted || error || !data || data.length === 0) return;
      setWines(data.map(r => ({
        id: r.key, name: r.wine_name || r.name,
        producer: r.producer || "", vintage: r.vintage || "",
        region: r.region || "", country: r.country || "",
        byGlass: r.by_glass ?? false,
      })));
    };

    loadWines();
    const wineChannel = supabase.channel("milka-wines")
      .on("postgres_changes", { event: "*", schema: "public", table: "wines" }, loadWines)
      .subscribe();
    return () => { mounted = false; supabase.removeChannel(wineChannel); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Menu courses: load live from Google Sheet, fallback to Supabase ────────
  useEffect(() => {
    let mounted = true;
    let timer = null;

    const applyCourses = (data) => {
      if (!mounted || !Array.isArray(data) || data.length === 0) return false;
      setMenuCourses(data);
      return true;
    };

    const loadFromSupabase = async () => {
      if (!supabase) return false;
      const { data, error } = await supabase
        .from("menu_courses")
        .select("*")
        .order("position", { ascending: true });
      if (error || !data || data.length === 0) return false;
      const DIETARY_KEYS = [
        "veg","vegan","pescetarian","gluten_free","dairy_free","nut_free","shellfish_free",
        "no_red_meat","no_pork","no_game","no_offal","egg_free","no_alcohol",
        "no_garlic_onion","halal","low_fodmap",
      ];
      return applyCourses(data.map(r => {
        const restrictions = {};
        DIETARY_KEYS.forEach(k => { restrictions[k] = r[k] ?? null; });
        // Merge SI restriction variants and kitchen notes from the restrictions_si column.
        // Notes are stored with "__note" suffix (e.g. "no_pork__note" → restrictions["no_pork_note"]).
        const rSi = r.restrictions_si || {};
        Object.entries(rSi).forEach(([k, v]) => {
          if (k.endsWith("__note")) {
            if (v) restrictions[k.slice(0, -"__note".length) + "_note"] = v;
          } else {
            if (v) restrictions[`${k}_si`] = v;
          }
        });
        // Legacy data may have menu.name = "EN NAME\nSI NAME" (two-line cell not split at sync time).
        // Split it here so the correct language is shown for each menu type.
        let menu = r.menu || null;
        let menu_si = r.menu_si || null;
        if (menu?.name?.includes("\n")) {
          const nameParts = menu.name.split(/\n+/).map(s => s.trim()).filter(Boolean);
          const subParts  = (menu.sub || "").split(/\n+/).map(s => s.trim()).filter(Boolean);
          menu    = { name: nameParts[0] || "", sub: subParts[0] || "" };
          if (!menu_si && nameParts[1]) menu_si = { name: nameParts[1], sub: subParts[1] || "" };
        }
        return {
          position: r.position,
          menu,
          veg: r.veg,
          hazards: r.hazards,
          na: r.na,
          na_si: r.na_si || null,
          wp: r.wp,
          wp_si: r.wp_si || null,
          os: r.os,
          os_si: r.os_si || null,
          premium: r.premium,
          premium_si: r.premium_si || null,
          is_snack: r.is_snack,
          menu_si,
          course_key: r.course_key || "",
          optional_flag: r.optional_flag || "",
          section_gap_before: !!r.section_gap_before,
          show_on_short: !!r.show_on_short,
          short_order: r.short_order || null,
          force_pairing_title: r.force_pairing_title || "",
          force_pairing_sub: r.force_pairing_sub || "",
          force_pairing_title_si: r.force_pairing_title_si || "",
          force_pairing_sub_si: r.force_pairing_sub_si || "",
          kitchen_note: r.kitchen_note || "",
          restrictions,
        };
      }));
    };

    const loadCourses = async () => {
      try {
        const liveCourses = await fetchLiveMenuCourses();
        if (applyCourses(liveCourses)) return;
      } catch (error) {
        console.warn("Live menu sheet fetch failed:", error);
      }
      await loadFromSupabase();
    };

    loadCourses();
    timer = window.setInterval(loadCourses, 60000);
    return () => {
      mounted = false;
      if (timer) window.clearInterval(timer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Only count primary tables in groups (secondaries have same guest count stamped on them)
  const isPrimary = t => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup);
  const active   = tables.filter(t => t.active).filter(isPrimary);
  const seated   = active.reduce((a, t) => a + t.guests, 0);
  const reserved = tables.filter(t => !t.active && (t.resName || t.resTime)).filter(isPrimary).length;

  const syncLabel = syncStatus === "live" ? "SYNC" : syncStatus === "local-only" ? "LOCAL" : syncStatus === "connecting" ? "LINK" : "ERROR";
  const syncLive  = syncStatus === "live";

  const hProps = {
    syncLabel, syncLive,
    activeCount: active.length, reserved, seated,
    onExit: switchMode,
    onMenu: () => setAdminOpen(true),
    onSummary: () => setSummaryOpen(true),
    onArchive: () => setArchiveOpen(true),
    onAddRes: () => {
      const freeTable = tables.find(t => !t.active && !t.resName && !t.resTime);
      if (freeTable) { setResModalPresetTime(null); setResModal(freeTable.id); }
      else { setResModalPresetTime(null); setResModal(tables[0].id); }
    },
  };

  // Gate 1: password wall — temporarily disabled for testing
  // if (!authed) return <GateScreen onPass={() => setAuthed(true)} />;

  // Gate 2: hydration — wait for Supabase state before rendering
  if (!hydrated) return (
    <div style={{
      minHeight: "100vh", background: "#fff", display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: FONT, gap: 24,
    }}>
      <GlobalStyle />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: 6, color: "#1a1a1a", marginBottom: 6 }}>MILKA</div>
        <div style={{ fontSize: 9, letterSpacing: 4, color: "#bbb" }}>CONNECTING…</div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {[0,1,2].map(i => (
          <div key={i} style={{
            width: 5, height: 5, borderRadius: "50%", background: "#e0e0e0",
            animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>
      <style>{`@keyframes pulse{0%,80%,100%{opacity:0.2;transform:scale(0.8)}40%{opacity:1;transform:scale(1)}}`}</style>
    </div>
  );

  if (!mode) return <LoginScreen onEnter={m => { changeMode(m); setSel(null); }} />;

  // Display mode — unified board+kitchen view
  if (mode === "display") return (
    <div style={{ minHeight: "100vh", background: "#fff", fontFamily: FONT, overflowX: "hidden", WebkitTextSizeAdjust: "100%" }}>
      <GlobalStyle />
      <Header modeLabel="DISPLAY" showSummary={false} showMenu={false} showArchive={true} {...hProps} />
      <div style={{ padding: "20px 24px" }}>
        <KitchenBoard tables={tables} menuCourses={effectiveMenuCourses} upd={upd} />
      </div>
      {archiveOpen && (
        <ArchiveModal
          tables={tables} dishes={dishes}
          onArchiveAndClear={archiveAndClearAll}
          onClearAll={clearAll}
          onClose={() => setArchiveOpen(false)}
          onRestoreTicket={id => upd(id, "kitchenArchived", false)}
          menuCourses={effectiveMenuCourses}
        />
      )}
    </div>
  );

  // Service + Admin modes
  return (
    <div style={{ minHeight: "100vh", background: "#fff", fontFamily: FONT, overflowX: "hidden", WebkitTextSizeAdjust: "100%" }}>
      <GlobalStyle />

      <Header
        modeLabel={mode === "admin" ? "ADMIN" : "SERVICE"}
        showSummary={true}
        showAddRes={mode === "admin"}
        showMenu={mode === "admin"}
        showArchive={mode === "admin"}
        {...hProps}
      />

      {sel === null ? (
        <div style={{ padding: "20px 24px", maxWidth: 1100, margin: "0 auto", overflowX: "hidden" }}>
          {/* Top bar: stats + Quick Access toggle */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              {(() => {
                const seatedNow = tables.filter(t => t.active).filter(isPrimary).length;
                const guestsNow = tables.filter(t => t.active).filter(isPrimary).reduce((a, t) => a + (t.guests || 0), 0);
                const resvNow   = tables.filter(t => !t.active && (t.resName || t.resTime)).filter(isPrimary).length;
                return (
                  <>
                    {seatedNow > 0 && <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#3a8a5a", textTransform: "uppercase" }}>{seatedNow} tables · {guestsNow} guests</span>}
                    {resvNow   > 0 && <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#aaa",    textTransform: "uppercase" }}>{resvNow} reserved</span>}
                  </>
                );
              })()}
            </div>
            <button
              onClick={() => setQuickView(v => v === "service" ? "board" : "service")}
              style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 1.5, padding: "7px 16px",
                border: `1.5px solid ${quickView === "service" ? "#1a1a1a" : "#d8d8d8"}`,
                background: quickView === "service" ? "#1a1a1a" : "#fff",
                color: quickView === "service" ? "#fff" : "#999",
                borderRadius: 20, cursor: "pointer",
                transition: "all 0.15s",
                display: "flex", alignItems: "center", gap: 6,
              }}
            >
              <span style={{ fontSize: 10 }}>◈</span> QUICK ACCESS
            </button>
          </div>

          {/* Unified DisplayBoard — quickMode shows inline service controls */}
          {(() => {
            const visibleTables = tables
              .filter(t => mode === "admin" || t.active || t.resName || t.resTime)
              .filter(t => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup));

            // Admin mode: also show empty slot cards
            if (mode === "admin" && quickView !== "service") {
              // Group tables by sitting time for admin (with empty slot placeholders)
              const rows = SITTING_TIMES.map(time => ({
                time,
                tables: visibleTables.filter(t => {
                  if (t.resTime === time) return true;
                  if (time === "19:00" && t.resTime === "19:15") return true;
                  return false;
                }),
              }));
              const hasAnyInRows = rows.some(r => r.tables.length > 0);
              if (!hasAnyInRows) {
                return (
                  <div style={{ fontFamily: FONT, fontSize: 11, color: "#bbb", textAlign: "center", paddingTop: 80 }}>
                    No reservations yet — add them in Admin
                  </div>
                );
              }
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: 32 }}>
                  {rows.map(({ time, tables: rowTables }) => {
                    if (rowTables.length === 0 && mode !== "admin") return null;
                    const cardProps = t => ({
                      key: t.id, table: t, mode,
                      onClick: () => t.active && setSel(t.id),
                      onSeat: () => seatTable(t.id),
                      onUnseat: () => unseatTable(t.id),
                      onClear: () => clear(t.id),
                      onEditRes: () => { if (mode === "admin") { setResModalPresetTime(null); setResModal(t.id); } },
                    });
                    return (
                      <div key={time}>
                        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                          <span style={{ fontFamily: FONT, fontSize: 10, letterSpacing: 3, color: "#aaa", textTransform: "uppercase" }}>
                            {time === "19:00" ? "19:00 / 19:15" : time}
                          </span>
                          <div style={{ flex: 1, height: 1, background: "#f0f0f0" }} />
                          <span style={{ fontFamily: FONT, fontSize: 9, color: "#ccc" }}>{rowTables.length} / 4</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
                          {rowTables.slice(0, 4).map(t => <Card {...cardProps(t)} />)}
                          {rowTables.length < 4 && Array.from({ length: 4 - rowTables.length }).map((_, i) => {
                            const freeTable = tables.find(t => !t.active && !t.resName && !t.resTime);
                            return (
                              <div key={`empty-${time}-${i}`}
                                onClick={() => { if (freeTable) { setResModalPresetTime(time); setResModal(freeTable.id); } }}
                              style={{
                                border: "1px dashed #e0e0e0", borderRadius: 4, minHeight: 190,
                                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                                gap: 8, cursor: freeTable ? "pointer" : "default",
                                transition: "border-color 0.15s, background 0.15s",
                              }}
                              onMouseEnter={e => { if (freeTable) { e.currentTarget.style.borderColor = "#c8a06e"; e.currentTarget.style.background = "#fffdf8"; }}}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = "#e0e0e0"; e.currentTarget.style.background = ""; }}
                            >
                              <span style={{ fontSize: 18, color: "#ddd" }}>+</span>
                              <span style={{ fontFamily: FONT, fontSize: 9, color: "#ccc", letterSpacing: 2 }}>
                                {freeTable ? "ADD RES" : "FULL"}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          }
          // Service mode (and admin in quick mode): unified DisplayBoard
          return (
            <DisplayBoard
              tables={visibleTables}
              dishes={dishes}
              upd={upd}
              quickMode={quickView === "service"}
              updSeat={updSeat}
              onCardClick={id => setSel(id)}
              onSeat={seatTable}
              onUnseat={unseatTable}
            />
          );
        })()}
        </div>
      ) : (
        <Detail
          table={selTable}
          dishes={dishes}
          wines={wines}
          cocktails={cocktails}
          spirits={spirits}
          beers={beers}
          menuCourses={effectiveMenuCourses}
          mode={mode}
          onBack={() => setSel(null)}
          upd={(f, v) => upd(sel, f, v)}
          updSeat={(sid, f, v) => updSeat(sel, sid, f, v)}
          setGuests={n => setGuests(sel, n)}
          swapSeats={(aId, bId) => swapSeats(sel, aId, bId)}
        />
      )}

      {mode === "admin" && resModal !== null && modalTable && (
        <ReservationModal
          table={{ ...modalTable, resTime: resModalPresetTime || modalTable.resTime }}
          tables={tables}
          onSave={data => saveRes(resModal, data)}
          onClose={() => { setResModal(null); setResModalPresetTime(null); }}
        />
      )}
      {adminOpen && (
        <AdminPanel
          dishes={dishes} wines={wines} cocktails={cocktails} spirits={spirits} beers={beers}
          menuCourses={menuCourses}
          menuOverrides={menuOverrides}
          onSetMenuOverrides={setMenuOverrides}
          onUpdateDishes={setDishes} onUpdateWines={setWines}
          onSaveBeverages={saveBeverages}
          onSyncMenu={syncMenu}
          onClose={() => setAdminOpen(false)}
        />
      )}
      {summaryOpen && (
        <SummaryModal tables={tables} dishes={dishes} onClose={() => setSummaryOpen(false)} />
      )}
      {archiveOpen && (
        <ArchiveModal
          tables={tables} dishes={dishes}
          onArchiveAndClear={archiveAndClearAll}
          onClearAll={clearAll}
          onClose={() => setArchiveOpen(false)}
          onRestoreTicket={id => upd(id, "kitchenArchived", false)}
          menuCourses={effectiveMenuCourses}
        />
      )}
    </div>
  );
}
