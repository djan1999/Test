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
import {
  firstFilled, applyMenuOverride, truthyCell, splitMainSubCell,
  parseBilingual, mergeDishes, applyCourseRestriction,
  RESTRICTION_PRIORITY_KEYS, RESTRICTION_COLUMN_MAP, initDishes,
  parseMenuRow, RESTRICTION_KEYS,
} from "./utils/menuUtils.js";
import { generateMenuHTML, DEFAULT_MENU_RULES, normalizeMenuRules } from "./utils/menuGenerator.js";
import { buildDefaultTemplate } from "./utils/menuTemplateSchema.js";
import { generateWeeklyReservationsHTML, generateWeeklyAllergyHTML } from "./utils/weeklyPrintGenerator.js";
import {
  readLocalBeverages, writeLocalBeverages,
  readTeamNames, writeTeamNames,
  readMenuTitle, writeMenuTitle,
  readThankYouNote, writeThankYouNote,
  readLocalBoardState, writeLocalBoardState,
  BEV_STORAGE_KEY, TEAM_STORAGE_KEY, STORAGE_KEY,
} from "./utils/storage.js";
import { makeSeats, blankTable, sanitizeTable, initTables, fmt, parseHHMM } from "./utils/tableHelpers.js";
import { fuzzy, fuzzyDrink } from "./utils/search.js";
import { useIsMobile } from "./hooks/useIsMobile.js";
import { AdminLayout } from "./components/admin/index.js";

// All dietary restriction keys used in the DB schema
const DIETARY_KEYS = [
  "veg","vegan","pescetarian","gluten_free","dairy_free","nut_free","shellfish_free",
  "no_red_meat","no_pork","no_game","no_offal","egg_free","no_alcohol",
  "no_garlic_onion","halal","low_fodmap",
];

const pad2 = (n) => String(n).padStart(2, "0");
const toLocalDateISO = (date = new Date()) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const APP_NAME = String(import.meta.env.VITE_APP_NAME || "MILKA").trim() || "MILKA";
const APP_SUBTITLE = String(import.meta.env.VITE_APP_SUBTITLE || "SERVICE BOARD").trim() || "SERVICE BOARD";

const DEFAULT_ROOM_OPTIONS = String(import.meta.env.VITE_DEFAULT_ROOM_OPTIONS || "01,11,12,21,22,23")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);
const parseSittingTimes = () => {
  const raw = String(import.meta.env.VITE_DEFAULT_SITTING_TIMES || "18:00,18:30,19:00,19:15")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  return raw.length > 0 ? raw : ["18:00", "18:30", "19:00", "19:15"];
};
const DEFAULT_SITTING_TIMES = parseSittingTimes();

const parseDefaultQuickAccessItems = () => {
  const raw = String(import.meta.env.VITE_DEFAULT_QUICK_ACCESS || "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item, idx) => ({
        id: Number(item?.id) || idx + 1,
        label: String(item?.label || "").trim(),
        searchKey: String(item?.searchKey || item?.label || "").trim(),
        type: String(item?.type || "wine").trim() || "wine",
        enabled: item?.enabled !== false,
      }))
      .filter(item => item.label);
  } catch {
    return [];
  }
};

const DEFAULT_QUICK_ACCESS_ITEMS = parseDefaultQuickAccessItems();

const SITTING_TIMES = DEFAULT_SITTING_TIMES;
const ROOM_OPTIONS = DEFAULT_ROOM_OPTIONS.length ? DEFAULT_ROOM_OPTIONS : ["01", "11", "12", "21", "22", "23"];

// Convert a Supabase menu_courses row to the internal shape used throughout the app.
function supabaseRowToCourse(r) {
  const restrictions = {};
  DIETARY_KEYS.forEach(k => { restrictions[k] = r[k] ?? null; });
  const rSi = r.restrictions_si || {};
  Object.entries(rSi).forEach(([k, v]) => {
    if (k.endsWith("__note")) {
      if (v) restrictions[k.slice(0, -"__note".length) + "_note"] = v;
    } else {
      if (v) restrictions[`${k}_si`] = v;
    }
  });
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
    section_gap_before: false,
    show_on_short: !!r.show_on_short,
    short_order: r.short_order || null,
    force_pairing_title: r.force_pairing_title || "",
    force_pairing_sub: r.force_pairing_sub || "",
    force_pairing_title_si: r.force_pairing_title_si || "",
    force_pairing_sub_si: r.force_pairing_sub_si || "",
    kitchen_note: r.kitchen_note || "",
    aperitif_btn: r.aperitif_btn || null,
    restrictions,
  };
}

// Convert internal course shape back to flat Supabase row for upsert.
function courseToSupabaseRow(course) {
  const restrictionColsSi = {};
  const restrictionNotes = {};
  RESTRICTION_KEYS.forEach(k => {
    if (course.restrictions?.[`${k}_si`]) restrictionColsSi[k] = course.restrictions[`${k}_si`];
    if (course.restrictions?.[`${k}_note`]) restrictionNotes[k] = course.restrictions[`${k}_note`];
  });
  const restrictions_si = (() => {
    const combined = { ...restrictionColsSi };
    Object.entries(restrictionNotes).forEach(([k, v]) => { combined[`${k}__note`] = v; });
    return Object.keys(combined).length ? combined : null;
  })();

  const row = {
    position: course.position,
    menu: course.menu,
    menu_si: course.menu_si,
    wp: course.wp,
    wp_si: course.wp_si,
    na: course.na,
    na_si: course.na_si,
    os: course.os,
    os_si: course.os_si,
    premium: course.premium,
    premium_si: course.premium_si,
    hazards: course.hazards,
    is_snack: course.is_snack,
    course_key: course.course_key,
    optional_flag: course.optional_flag,
    section_gap_before: false,
    show_on_short: course.show_on_short,
    short_order: course.short_order,
    force_pairing_title: course.force_pairing_title,
    force_pairing_sub: course.force_pairing_sub,
    force_pairing_title_si: course.force_pairing_title_si,
    force_pairing_sub_si: course.force_pairing_sub_si,
    kitchen_note: course.kitchen_note,
    aperitif_btn: course.aperitif_btn,
    restrictions_si,
  };
  DIETARY_KEYS.forEach(k => { row[k] = course.restrictions?.[k] ?? null; });
  return row;
}

async function fetchMenuCourses() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("menu_courses")
    .select("*")
    .order("position", { ascending: true });
  if (error) throw error;
  return (data || []).map(supabaseRowToCourse);
}


const FONT = "'Roboto Mono', monospace";
const MOBILE_SAFE_INPUT_SIZE = 16;

// ── Wine DB ───────────────────────────────────────────────────────────────────
const initWines = [];

// ── Initial extra dishes — imported from menuUtils.js ─────────────────────────

// ── Cocktails & Spirits & Beers ───────────────────────────────────────────────
const initCocktails = [];
const initSpirits   = [];
const initBeers     = [];

// ── Beverages local-storage key (separate from board state) ───────────────────
// Storage helpers, search utilities, table factories, and useIsMobile hook
// are now imported from their respective modules above.

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

const COUNTRY_NAMES = {
  FR: "France", IT: "Italy", ES: "Spain", DE: "Germany", AT: "Austria",
  SI: "Slovenia", PT: "Portugal", GR: "Greece", HU: "Hungary", HR: "Croatia",
  CH: "Switzerland", GE: "Georgia", RO: "Romania", BG: "Bulgaria", RS: "Serbia",
  CZ: "Czech Republic", SK: "Slovakia", MD: "Moldova", AM: "Armenia",
  US: "USA", AR: "Argentina", CL: "Chile", AU: "Australia", NZ: "New Zealand",
  ZA: "South Africa", UY: "Uruguay",
};
// ── Restriction definitions ───────────────────────────────────────────────────
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





const pairingStyle = {
  "—":        { color: "#666", border: "#d8d8d8", bg: "#f5f5f5" },
  "Non-Alc":  { color: "#1f5f73", border: "#7fc6db88", bg: "#7fc6db12" },
  "Wine":      { color: "#8a6030", border: "#c8a06088", bg: "#c8a06008" },
  "Premium":   { color: "#5a5a8a", border: "#8888bb88", bg: "#8888bb08" },
  "Our Story": { color: "#3a7a5a", border: "#5aaa7a88", bg: "#5aaa7a08" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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

const circBtnSm = {
  width: 36, height: 36, borderRadius: "50%",
  border: "1px solid #e8e8e8", background: "#fff",
  color: "#444", fontSize: 18, cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
  fontFamily: FONT, lineHeight: 1, touchAction: "manipulation",
};

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
  aperitif: { label: "Aperitif", color: "#a07040", bg: "#fdf8f0", border: "#d0c0a8", dot: "#d0c0a8" },
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
// ── Course Editor — inline editing of a single menu course ───────────────────
function CourseEditor({ course, onUpdate, onDelete, onMoveUp, onMoveDown, isFirst, isLast }) {
  const [expanded, setExpanded] = useState(false);
  const inpSm = { ...baseInp, padding: "5px 8px", fontSize: 11 };
  const labelSm = { fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#999", textTransform: "uppercase", marginBottom: 2 };

  const upd = (field, value) => onUpdate({ ...course, [field]: value });
  const updMenu = (lang, field, value) => {
    const key = lang === "si" ? "menu_si" : "menu";
    const current = course[key] || { name: "", sub: "" };
    onUpdate({ ...course, [key]: { ...current, [field]: value } });
  };
  const updPairing = (pairingKey, lang, field, value) => {
    const key = lang === "si" ? `${pairingKey}_si` : pairingKey;
    const current = course[key] || { name: "", sub: "" };
    onUpdate({ ...course, [key]: { ...current, [field]: value } });
  };
  const updRestriction = (rKey, field, value) => {
    const restrictions = { ...course.restrictions };
    const current = restrictions[rKey] || { name: "", sub: "" };
    restrictions[rKey] = { ...current, [field]: value };
    if (!restrictions[rKey].name && !restrictions[rKey].sub) restrictions[rKey] = null;
    onUpdate({ ...course, restrictions });
  };

  return (
    <div style={{
      border: "1px solid #e8e8e8", borderRadius: 4, background: "#fff",
      marginBottom: 8, overflow: "hidden",
    }}>
      {/* Collapsed header */}
      <div
        onClick={() => setExpanded(x => !x)}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 14px",
          cursor: "pointer", background: expanded ? "#fafafa" : "#fff",
        }}
      >
        <span style={{ fontFamily: FONT, fontSize: 10, color: "#bbb", minWidth: 22 }}>{course.position}</span>
        <div style={{ flex: 1 }}>
          <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: "#1a1a1a" }}>{course.menu?.name || "(unnamed)"}</span>
          {course.menu?.sub && <span style={{ fontFamily: FONT, fontSize: 10, color: "#999", marginLeft: 8 }}>{course.menu.sub}</span>}
        </div>
        {course.is_snack && <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#c8a06e", border: "1px solid #e8d8b8", borderRadius: 2, padding: "2px 6px" }}>SNACK</span>}
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={e => { e.stopPropagation(); onMoveUp(); }} disabled={isFirst} style={{ background: "none", border: "none", cursor: isFirst ? "default" : "pointer", color: isFirst ? "#ddd" : "#888", fontSize: 12, padding: "2px 4px" }}>▲</button>
          <button onClick={e => { e.stopPropagation(); onMoveDown(); }} disabled={isLast} style={{ background: "none", border: "none", cursor: isLast ? "default" : "pointer", color: isLast ? "#ddd" : "#888", fontSize: 12, padding: "2px 4px" }}>▼</button>
        </div>
        <span style={{ fontFamily: FONT, fontSize: 14, color: "#ccc", transition: "transform 0.15s", transform: expanded ? "rotate(180deg)" : "none" }}>▾</span>
      </div>

      {expanded && (
        <div style={{ padding: "12px 14px 16px", borderTop: "1px solid #f0f0f0" }}>
          {/* ── Dish Info ── */}
          <div style={{ ...labelSm, marginBottom: 6, fontSize: 9, letterSpacing: 2, color: "#888" }}>DISH INFO</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
            <div><div style={labelSm}>Name (EN)</div><input value={course.menu?.name || ""} onChange={e => updMenu("en", "name", e.target.value)} style={inpSm} placeholder="Dish name" /></div>
            <div><div style={labelSm}>Description (EN)</div><input value={course.menu?.sub || ""} onChange={e => updMenu("en", "sub", e.target.value)} style={inpSm} placeholder="ingredients, description" /></div>
            <div><div style={labelSm}>Name (SI)</div><input value={course.menu_si?.name || ""} onChange={e => updMenu("si", "name", e.target.value)} style={inpSm} placeholder="Slovenian name" /></div>
            <div><div style={labelSm}>Description (SI)</div><input value={course.menu_si?.sub || ""} onChange={e => updMenu("si", "sub", e.target.value)} style={inpSm} placeholder="Slovenian desc" /></div>
          </div>

          {/* ── Metadata ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
            <div><div style={labelSm}>Course Key</div><input value={course.course_key || ""} onChange={e => upd("course_key", e.target.value)} style={inpSm} placeholder="e.g. beetroot" /></div>
            <div><div style={labelSm}>Optional Flag</div><input value={course.optional_flag || ""} onChange={e => upd("optional_flag", e.target.value)} style={inpSm} placeholder="e.g. beetroot" /></div>
            <div><div style={labelSm}>Kitchen Note</div><input value={course.kitchen_note || ""} onChange={e => upd("kitchen_note", e.target.value)} style={inpSm} placeholder="Note for kitchen" /></div>
            <div><div style={labelSm}>Aperitif Btn</div><input value={course.aperitif_btn || ""} onChange={e => upd("aperitif_btn", e.target.value || null)} style={inpSm} placeholder="Button label" /></div>
          </div>

          {/* ── Toggles ── */}
          <div style={{ display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
            {[
              { key: "is_snack", label: "Snack" },
              { key: "show_on_short", label: "Show on Short" },
            ].map(({ key, label }) => (
              <label key={key} style={{ fontFamily: FONT, fontSize: 10, color: "#555", display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                <input type="checkbox" checked={!!course[key]} onChange={e => upd(key, e.target.checked)} />
                {label}
              </label>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontFamily: FONT, fontSize: 10, color: "#555" }}>Short order:</span>
              <input type="number" value={course.short_order ?? ""} onChange={e => upd("short_order", e.target.value ? Number(e.target.value) : null)} style={{ ...inpSm, width: 60 }} />
            </div>
          </div>

          {/* ── Pairings ── */}
          <div style={{ ...labelSm, marginBottom: 6, fontSize: 9, letterSpacing: 2, color: "#888" }}>PAIRINGS</div>
          {[
            { key: "wp", label: "Wine" },
            { key: "na", label: "Non-Alc" },
            { key: "os", label: "Our Story" },
            { key: "premium", label: "Premium" },
          ].map(({ key, label }) => (
            <div key={key} style={{ display: "grid", gridTemplateColumns: "70px 1fr 1fr 1fr 1fr", gap: 6, marginBottom: 4, alignItems: "center" }}>
              <span style={{ fontFamily: FONT, fontSize: 9, color: "#c8a06e", fontWeight: 600 }}>{label}</span>
              <input value={course[key]?.name || ""} onChange={e => updPairing(key, "en", "name", e.target.value)} style={inpSm} placeholder="Name (EN)" />
              <input value={course[key]?.sub || ""} onChange={e => updPairing(key, "en", "sub", e.target.value)} style={inpSm} placeholder="Sub (EN)" />
              <input value={course[`${key}_si`]?.name || ""} onChange={e => updPairing(key, "si", "name", e.target.value)} style={inpSm} placeholder="Name (SI)" />
              <input value={course[`${key}_si`]?.sub || ""} onChange={e => updPairing(key, "si", "sub", e.target.value)} style={inpSm} placeholder="Sub (SI)" />
            </div>
          ))}

          {/* ── Force Pairing ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginTop: 8, marginBottom: 12 }}>
            <div><div style={labelSm}>Force Pairing (EN)</div><input value={course.force_pairing_title || ""} onChange={e => upd("force_pairing_title", e.target.value)} style={inpSm} /></div>
            <div><div style={labelSm}>Force Sub (EN)</div><input value={course.force_pairing_sub || ""} onChange={e => upd("force_pairing_sub", e.target.value)} style={inpSm} /></div>
            <div><div style={labelSm}>Force Pairing (SI)</div><input value={course.force_pairing_title_si || ""} onChange={e => upd("force_pairing_title_si", e.target.value)} style={inpSm} /></div>
            <div><div style={labelSm}>Force Sub (SI)</div><input value={course.force_pairing_sub_si || ""} onChange={e => upd("force_pairing_sub_si", e.target.value)} style={inpSm} /></div>
          </div>

          {/* ── Restrictions ── */}
          <div style={{ ...labelSm, marginBottom: 6, fontSize: 9, letterSpacing: 2, color: "#888" }}>DIETARY RESTRICTIONS</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 14 }}>
            {DIETARY_KEYS.map(rKey => {
              const val = course.restrictions?.[rKey];
              const hasVal = val && (val.name || val.sub);
              return (
                <div key={rKey} style={{ display: "grid", gridTemplateColumns: "110px 1fr 1fr", gap: 6, alignItems: "center" }}>
                  <span style={{ fontFamily: FONT, fontSize: 9, color: hasVal ? "#b04040" : "#ccc" }}>{rKey.replace(/_/g, " ")}</span>
                  <input value={val?.name || ""} onChange={e => updRestriction(rKey, "name", e.target.value)} style={inpSm} placeholder="Alt name" />
                  <input value={val?.sub || ""} onChange={e => updRestriction(rKey, "sub", e.target.value)} style={inpSm} placeholder="Alt desc" />
                </div>
              );
            })}
          </div>

          {/* ── Actions ── */}
          <div style={{ display: "flex", gap: 8, borderTop: "1px solid #f0f0f0", paddingTop: 12 }}>
            <button onClick={onDelete} style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px",
              border: "1px solid #ffcccc", borderRadius: 2, cursor: "pointer",
              background: "#fff9f9", color: "#c04040",
            }}>DELETE COURSE</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Menu Courses Editor Tab — full CRUD for menu courses ─────────────────────
function MenuCoursesTab({ menuCourses = [], onUpdateCourses, onSaveCourses }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true); setSaved(false);
    await onSaveCourses(menuCourses);
    setSaving(false); setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const updateCourse = (position, updated) => {
    onUpdateCourses(menuCourses.map(c => c.position === position ? updated : c));
  };

  const deleteCourse = (position) => {
    if (!window.confirm("Delete this course?")) return;
    onUpdateCourses(menuCourses.filter(c => c.position !== position));
  };

  const moveCourse = (position, dir) => {
    const idx = menuCourses.findIndex(c => c.position === position);
    if (idx < 0) return;
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= menuCourses.length) return;
    const reordered = [...menuCourses];
    [reordered[idx], reordered[newIdx]] = [reordered[newIdx], reordered[idx]];
    // Re-assign positions sequentially
    onUpdateCourses(reordered.map((c, i) => ({ ...c, position: i + 1 })));
  };

  const addCourse = () => {
    const maxPos = menuCourses.reduce((m, c) => Math.max(m, c.position || 0), 0);
    const newCourse = {
      position: maxPos + 1,
      menu: { name: "", sub: "" },
      menu_si: null,
      wp: null, wp_si: null, na: null, na_si: null, os: null, os_si: null, premium: null, premium_si: null,
      hazards: null, is_snack: false,
      course_key: "", optional_flag: "", section_gap_before: false,
      show_on_short: false, short_order: null,
      force_pairing_title: "", force_pairing_sub: "",
      force_pairing_title_si: "", force_pairing_sub_si: "",
      kitchen_note: "", aperitif_btn: null,
      restrictions: {},
    };
    onUpdateCourses([...menuCourses, newCourse]);
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontFamily: FONT, fontSize: 10, color: "#888", letterSpacing: 1 }}>
          {menuCourses.length} COURSES
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={addCourse} style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px",
            border: "1px solid #1a1a1a", borderRadius: 2, cursor: "pointer",
            background: "#1a1a1a", color: "#fff",
          }}>+ ADD COURSE</button>
          <button onClick={handleSave} disabled={saving} style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px",
            border: `1px solid ${saved ? "#4a9a6a" : "#c8a06e"}`, borderRadius: 2,
            cursor: saving ? "default" : "pointer",
            background: saved ? "#4a9a6a" : "#c8a06e", color: "#fff",
          }}>{saving ? "SAVING…" : saved ? "SAVED ✓" : "SAVE ALL COURSES"}</button>
        </div>
      </div>

      {menuCourses.map((course, idx) => (
        <CourseEditor
          key={course.position}
          course={course}
          onUpdate={updated => updateCourse(course.position, updated)}
          onDelete={() => deleteCourse(course.position)}
          onMoveUp={() => moveCourse(course.position, -1)}
          onMoveDown={() => moveCourse(course.position, +1)}
          isFirst={idx === 0}
          isLast={idx === menuCourses.length - 1}
        />
      ))}

      {menuCourses.length === 0 && (
        <div style={{ fontFamily: FONT, fontSize: 11, color: "#ccc", textAlign: "center", padding: "40px 0" }}>
          No courses yet — add your first course above
        </div>
      )}
    </div>
  );
}

// ── Wine Sync Tab — kept for wine/beverage sync from hotel website ───────────
function WineSyncTab({ onSyncWines }) {
  const [status, setStatus] = useState(null);
  const [msg, setMsg] = useState("");

  const handleSync = async () => {
    setStatus("syncing"); setMsg("");
    try {
      const r = await onSyncWines();
      if (r?.ok) {
        const parts = [
          r.wines != null ? `${r.wines} wines` : null,
          r.cocktails != null ? `${r.cocktails} cocktails` : null,
          r.beers != null ? `${r.beers} beers` : null,
          r.spirits != null ? `${r.spirits} spirits` : null,
        ].filter(Boolean);
        const warn = r.failedCountries?.length ? ` (missed: ${r.failedCountries.join(", ")})` : "";
        setStatus("ok"); setMsg(`${parts.join(", ")}${warn}`);
      } else { setStatus("err"); setMsg(r?.error || "Failed"); }
    } catch (e) { setStatus("err"); setMsg(e.message); }
  };

  return (
    <div>
      <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#888", textTransform: "uppercase", marginBottom: 16 }}>
        Wine &amp; beverage sync from hotel website
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={handleSync} disabled={status === "syncing"} style={{
          fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "10px 20px",
          border: "1px solid #c8a06e", borderRadius: 2,
          cursor: status === "syncing" ? "not-allowed" : "pointer",
          background: "#c8a06e", color: "#fff",
        }}>
          {status === "syncing" ? "SYNCING…" : "SYNC WINES & BEVERAGES"}
        </button>
        {msg && <span style={{ fontFamily: FONT, fontSize: 10, color: status === "ok" ? "#2a7a2a" : "#c04040" }}>{msg}</span>}
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

// BlurInput: keeps typed value local, only calls onCommit when focus leaves.
function BlurInput({ committedValue, onCommit, placeholder, style }) {
  const [local, setLocal] = useState(committedValue ?? "");
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

// ── Admin Panel ───────────────────────────────────────────────────────────────

function AdminPanel({
  dishes, wines, cocktails, spirits, beers, menuCourses,
  onUpdateDishes, onUpdateWines, onSaveBeverages, onResetMenuLayout,
  onUpdateMenuCourses, onSaveMenuCourses, onSyncWines,
  logoDataUri = "", onSaveLogo, onClose,
}) {
  const [tab, setTab] = useState("menu");
  const [drinkTab, setDrinkTab] = useState("wines");
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

  // ── Spirits ──
  const [localSpirits, setLocalSpirits] = useState(spirits.map(s => ({ ...s })));
  const [newSpirit, setNewSpirit] = useState({ name: "", notes: "" });
  const nextSpiritId = useRef(Math.max(...spirits.map(s => s.id), 0) + 1);

  // ── Beers ──
  const [localBeers, setLocalBeers] = useState(beers.map(b => ({ ...b })));
  const [newBeer, setNewBeer] = useState({ name: "", notes: "" });
  const nextBeerId = useRef(Math.max(...beers.map(b => b.id), 0) + 1);

  const handleSaveDrinks = () => {
    onUpdateDishes(localDishes);
    onUpdateWines(localWines);
    onSaveBeverages({ cocktails: localCocktails, spirits: localSpirits, beers: localBeers });
  };

  const SECTIONS = [
    { id: "menu",         label: "Menu Layout" },
    { id: "drinks",       label: "Drinks" },
    { id: "dishes",       label: "Extras" },
    { id: "sync",         label: "Sync" },
    { id: "settings",     label: "Settings" },
  ];

  const tabBtn = t => ({
    fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "9px 18px",
    border: "none", cursor: "pointer", textTransform: "uppercase", transition: "all 0.1s",
    background: tab === t ? "#1a1a1a" : "#fff",
    color: tab === t ? "#fff" : "#444",
    borderBottom: tab === t ? "none" : "1px solid #e8e8e8",
    whiteSpace: "nowrap",
  });

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(255,255,255,0.92)",
      backdropFilter: "blur(4px)", zIndex: 500,
      display: "flex", alignItems: "stretch", justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        background: "#fff", borderTop: "1px solid #e8e8e8",
        width: "100%", maxWidth: 900,
        maxHeight: "100vh", overflow: "hidden",
        boxShadow: "0 -4px 40px rgba(0,0,0,0.10)",
        display: "flex", flexDirection: "column",
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid #e8e8e8", flexShrink: 0 }}>
          <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: 3, color: "#1a1a1a" }}>ADMIN</span>
          <button onClick={onClose} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 14px", border: "1px solid #e8e8e8", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#888" }}>CLOSE</button>
        </div>

        {/* Section tabs */}
        <div style={{ display: "flex", borderBottom: "1px solid #e8e8e8", flexShrink: 0, overflowX: "auto" }}>
          {SECTIONS.map(s => <button key={s.id} style={tabBtn(s.id)} onClick={() => setTab(s.id)}>{s.label}</button>)}
        </div>

        {/* Scrollable content */}
        <div style={{ overflowY: "auto", padding: isMobile ? "20px 16px" : "24px 28px", flex: 1, overflowX: "hidden" }}>

          {/* ── MENU LAYOUT ── Full course editor */}
          {tab === "menu" && (
            <MenuCoursesTab
              menuCourses={menuCourses}
              onUpdateCourses={onUpdateMenuCourses}
              onSaveCourses={onSaveMenuCourses}
            />
          )}

          {/* ── DRINKS ── Wines, cocktails, spirits, beers */}
          {tab === "drinks" && (
            <div>
              <div style={{ display: "flex", flexWrap: "wrap", marginBottom: 8 }}>
                {["wines", "cocktails", "spirits", "beers"].map(t => (
                  <button key={t} style={{
                    fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px",
                    border: `1px solid ${drinkTab === t ? "#1a1a1a" : "#e8e8e8"}`,
                    borderRadius: 2, cursor: "pointer",
                    background: drinkTab === t ? "#1a1a1a" : "#fff",
                    color: drinkTab === t ? "#fff" : "#888",
                    marginRight: 6, marginBottom: 12,
                  }} onClick={() => setDrinkTab(t)}>{t.toUpperCase()}</button>
                ))}
                <button onClick={handleSaveDrinks} style={{
                  fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px",
                  border: "1px solid #4a9a6a", borderRadius: 2, cursor: "pointer",
                  background: "#4a9a6a", color: "#fff", marginLeft: "auto",
                }}>SAVE DRINKS</button>
              </div>

              {drinkTab === "wines" && (
                <>
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

              {drinkTab === "cocktails" && (
                <DrinkListEditor list={localCocktails} setList={setLocalCocktails}
                  newItem={newCocktail} setNewItem={setNewCocktail}
                  nextId={nextCocktailId} label="cocktail" />
              )}

              {drinkTab === "spirits" && (
                <DrinkListEditor list={localSpirits} setList={setLocalSpirits}
                  newItem={newSpirit} setNewItem={setNewSpirit}
                  nextId={nextSpiritId} label="spirit" />
              )}

              {drinkTab === "beers" && (
                <DrinkListEditor list={localBeers} setList={setLocalBeers}
                  newItem={newBeer} setNewItem={setNewBeer}
                  nextId={nextBeerId} label="beer" />
              )}
            </div>
          )}

          {/* ── EXTRAS (dishes) ── */}
          {tab === "dishes" && (
            <>
              <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, color: "#888", marginBottom: 16 }}>
                EXTRA DISH OPTIONS — optional courses offered to guests (beetroot, cheese, cake, etc.)
              </div>
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
              <div style={{ borderTop: "1px solid #f0f0f0", marginTop: 24, paddingTop: 14 }}>
                <button onClick={() => { onUpdateDishes(localDishes); }} style={{
                  fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "10px 24px",
                  border: "1px solid #1a1a1a", borderRadius: 2, cursor: "pointer", background: "#1a1a1a", color: "#fff",
                }}>SAVE EXTRAS</button>
              </div>
            </>
          )}

          {/* ── SYNC ── Wine sync from hotel website */}
          {tab === "sync" && (
            <WineSyncTab onSyncWines={onSyncWines} />
          )}

          {/* ── SETTINGS ── Logo, layout reset */}
          {tab === "settings" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
              {/* Logo */}
              <div>
                <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 14 }}>Menu Logo</div>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ width: 64, height: 64, border: "1px solid #e8e8e8", borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", background: "#fafafa", flexShrink: 0 }}>
                    {logoDataUri
                      ? <img src={logoDataUri} alt="logo" style={{ width: 52, height: 52, objectFit: "contain" }} />
                      : <span style={{ fontFamily: FONT, fontSize: 8, color: "#ccc", letterSpacing: 1 }}>NO LOGO</span>
                    }
                  </div>
                  <div>
                    <div style={{ fontFamily: FONT, fontSize: 9, color: "#888", marginBottom: 8 }}>
                      Upload PNG, JPG, or SVG. Will be embedded in all printed menus.
                    </div>
                    <label style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px", border: "1px solid #1a1a1a", borderRadius: 2, cursor: "pointer", background: "#1a1a1a", color: "#fff", display: "inline-block" }}>
                      UPLOAD LOGO
                      <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => {
                        const file = e.target.files[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = ev => onSaveLogo(ev.target.result);
                        reader.readAsDataURL(file);
                      }} />
                    </label>
                    {logoDataUri && (
                      <button onClick={() => onSaveLogo("")} style={{ marginLeft: 8, fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px", border: "1px solid #e08080", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#c04040" }}>
                        REMOVE
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Layout reset */}
              <div>
                <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 14 }}>Print Layout</div>
                <div style={{ border: "1px solid #f8e8e8", borderRadius: 4, padding: "16px 18px", background: "#fffafa" }}>
                  <div style={{ fontFamily: FONT, fontSize: 10, color: "#444", marginBottom: 6 }}>Reset to factory defaults</div>
                  <div style={{ fontFamily: FONT, fontSize: 9, color: "#aaa", marginBottom: 14 }}>
                    Clears all saved layout customisations (row spacing, padding, font size, etc.) and restores the original values.
                  </div>
                  <button
                    onClick={() => { if (window.confirm("Reset print layout to factory defaults?")) onResetMenuLayout(); }}
                    style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 14px", border: "1px solid #e08080", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#c04040" }}
                  >RESET LAYOUT TO DEFAULTS</button>
                </div>
              </div>
            </div>
          )}
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
  const [lang, setLang]           = useState(table.lang || "en");

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
              {SITTING_TIMES.map(t => (
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

          <div>
            <div style={fieldLabel}>Language</div>
            <div style={{ display: "flex", gap: 8 }}>
              {[{v:"en",l:"EN"},{v:"si",l:"SLO"}].map(opt => (
                <button key={opt.v} onClick={() => setLang(opt.v)} style={{
                  fontFamily: FONT, fontSize: 10, letterSpacing: 2,
                  padding: "10px 24px", border: "1px solid",
                  borderColor: lang === opt.v ? "#1a1a1a" : "#e8e8e8",
                  borderRadius: 2, cursor: "pointer",
                  background: lang === opt.v ? "#1a1a1a" : "#fff",
                  color: lang === opt.v ? "#fff" : "#888",
                  textTransform: "uppercase",
                }}>{opt.l}</button>
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
                    {ROOM_OPTIONS.map(r => (
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
          <button onClick={() => onSave({ tableIds, name, time, menuType, guests, guestType, room, birthday, restrictions, notes, lang })} style={{
            flex: 2, fontFamily: FONT, fontSize: 12, letterSpacing: 2,
            padding: "14px", border: "1px solid #1a1a1a", borderRadius: 2, cursor: "pointer", background: "#1a1a1a", color: "#fff",
          }}>SAVE</button>
        </div>
      </div>
    </div>
  );
}


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
function Detail({ table, dishes, wines = [], cocktails = [], spirits = [], beers = [], menuCourses = MENU_DATA, aperitifOptions = [], mode, onBack, upd, updSeat, setGuests, swapSeats, onApplySeatToAll, onClearBeverages }) {
  const isMobile = useIsMobile(860);
  const row1 = isMobile ? "34px 68px 1fr 28px" : "38px 75px 1fr 28px";
  const seatCount = table.seats?.length || 0;
  const canApplySeatToAll = typeof onApplySeatToAll === "function" && seatCount > 1;
  const hasAnyBeverageData = (table.seats || []).some(s =>
    (s.aperitifs?.length || 0) > 0 ||
    (s.glasses?.length || 0) > 0 ||
    (s.cocktails?.length || 0) > 0 ||
    (s.spirits?.length || 0) > 0 ||
    (s.beers?.length || 0) > 0 ||
    (s.pairing && s.pairing !== "—")
  );
  return (
    <div style={{ maxWidth: 860, margin: "0 auto", padding: isMobile ? "20px 12px 28px" : "24px 16px", overflowX: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
        <button onClick={onBack} style={{
          background: "none", border: "none", cursor: "pointer",
          fontFamily: FONT, fontSize: 11, color: "#666", letterSpacing: 1, padding: 0,
        }}>← all tables</button>
      </div>

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

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <button
          onClick={() => onApplySeatToAll && onApplySeatToAll(table.id, 1)}
          disabled={!canApplySeatToAll}
          style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: 1.2, padding: "6px 12px",
            border: "1px solid #d8d8d8", borderRadius: 2, cursor: canApplySeatToAll ? "pointer" : "not-allowed",
            background: "#fff", color: "#666", opacity: canApplySeatToAll ? 1 : 0.5,
          }}
        >
          COPY P1 TO ALL
        </button>
        <button
          onClick={() => onClearBeverages && onClearBeverages(table.id)}
          disabled={!onClearBeverages || !hasAnyBeverageData}
          style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: 1.2, padding: "6px 12px",
            border: "1px solid #f0c8c8", borderRadius: 2, cursor: (onClearBeverages && hasAnyBeverageData) ? "pointer" : "not-allowed",
            background: "#fff", color: "#c06060", opacity: (onClearBeverages && hasAnyBeverageData) ? 1 : 0.5,
          }}
        >
          CLEAR ALL DRINKS
        </button>
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
              {/* ── Aperitif ── generates above Sour Soup */}
              <div style={{ background: "#fdf8f0", border: "1px solid #e8dcc8", borderRadius: 8, padding: isMobile ? "10px" : "12px" }}>
                <div style={{ ...fieldLabel, marginBottom: 8, color: "#a07040" }}>Aperitif</div>
                {/* Quick-add buttons */}
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                  {aperitifOptions.map(ap => (
                    <button key={ap.label} onClick={() => {
                      const lk = (ap.searchKey || ap.label).toLowerCase();
                      const found = wines.filter(w => w.byGlass).find(w =>
                        w.name?.toLowerCase().includes(lk) || w.producer?.toLowerCase().includes(lk)
                      );
                      const item = found || { name: ap.searchKey || ap.label, notes: "", __cocktail: true };
                      updSeat(seat.id, "aperitifs", [...(seat.aperitifs || []), item]);
                    }} style={{
                      fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: "4px 9px",
                      border: "1px solid #d0c0a8", borderRadius: 3, cursor: "pointer",
                      background: "#fff", color: "#7a5020", transition: "all 0.1s",
                    }}>{ap.label}</button>
                  ))}
                </div>
                <BeverageSearch
                  wines={wines} cocktails={cocktails} spirits={spirits} beers={beers}
                  onAdd={({ type, item }) => {
                    updSeat(seat.id, "aperitifs", [...(seat.aperitifs || []), item]);
                  }}
                />
                {/* Aperitif chips */}
                {(seat.aperitifs || []).length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                    {(seat.aperitifs || []).map((x, i) => {
                      const ts = BEV_TYPES.aperitif;
                      const label = x?.name || x?.producer || "?";
                      const sub = x?.producer && x?.name ? x.producer : (x?.notes || "");
                      return (
                        <div key={`ap${i}`} style={{
                          display: "inline-flex", alignItems: "center", gap: 5,
                          padding: "4px 8px 4px 10px", borderRadius: 999,
                          background: ts.bg, border: `1px solid ${ts.border}`,
                        }}>
                          <span style={{ fontFamily: FONT, fontSize: 11, color: ts.color, fontWeight: 500, whiteSpace: "nowrap" }}>
                            {label}{sub ? ` · ${sub}` : ""}
                          </span>
                          <button onClick={() => updSeat(seat.id, "aperitifs", (seat.aperitifs||[]).filter((_,idx)=>idx!==i))} style={{ background: "none", border: "none", color: ts.color, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 0 0 2px", opacity: 0.7 }}>×</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── By the Glass ── generates from Danube Salmon row */}
              <div style={{ background: "#fcfcfc", border: "1px solid #ececec", borderRadius: 8, padding: isMobile ? "10px" : "12px" }}>
                <div style={{ ...fieldLabel, marginBottom: 8, color: "#444" }}>By the Glass</div>
                <BeverageSearch
                  wines={wines} cocktails={cocktails} spirits={spirits} beers={beers}
                  onAdd={({ type, item }) => {
                    if (type === "wine")     updSeat(seat.id, "glasses",   [...(seat.glasses   || []), item]);
                    if (type === "cocktail") updSeat(seat.id, "cocktails", [...(seat.cocktails || []), item]);
                    if (type === "spirit")   updSeat(seat.id, "spirits",   [...(seat.spirits   || []), item]);
                    if (type === "beer")     updSeat(seat.id, "beers",     [...(seat.beers     || []), item]);
                  }}
                />
                {/* By the Glass chips */}
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
          const pc = PC[seat.pairing] || PC["Non-Alc"];
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
const PC = {
  "—":         { color: "#666",    bg: "#f5f5f5", border: "#d8d8d8" },
  "Wine":      { color: "#7a5020", bg: "#f5ead8", border: "#c8a060" },
  "Non-Alc":   { color: "#1f5f73", bg: "#e8f7fb", border: "#7fc6db" },
  "Premium":   { color: "#3a3a7a", bg: "#eaeaf5", border: "#8888bb" },
  "Our Story": { color: "#2a6a4a", bg: "#e0f5ea", border: "#5aaa7a" },
};
// Flat color/bg maps used by Summary, Archive, and other read-only views
const PAIRING_COLOR = { Wine: "#8a6030", "Non-Alc": "#1f5f73", Premium: "#3a3a7a", "Our Story": "#2a6a4a" };
const PAIRING_BG    = { Wine: "#fdf4e8", "Non-Alc": "#e8f7fb", Premium: "#eaeaf5", "Our Story": "#e0f5ea" };
const PAIRING_OPTS = [["—","—"],["Wine","W"],["Non-Alc","N/A"],["Premium","Prem"],["Our Story","Story"]];

// Extracted as a stable module-level component to prevent React from unmounting/remounting
// cards on every DisplayBoard re-render (which caused the visual overlap animation glitch).
function DisplayBoardCard({ t, quickMode, upd, updSeat, onCardClick, onSeat, onUnseat, dishes, aperitifOptions, wines = [], cocktails = [] }) {
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
            {t.lang === "si" && <span style={{ fontFamily: FONT, fontSize: 8, padding: "3px 7px", borderRadius: 3, border: "1px solid #c0ccee", color: "#3050a0", background: "#f0f4ff", fontWeight: 700 }}>SI</span>}
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
              const beetExtra = s.extras?.[1] || { ordered: false, pairing: "—" };
              const hasBeet   = !!beetExtra.ordered;
              const hasCheese = !!s.extras?.[2]?.ordered;
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
                      {/* Beetroot quick-pair */}
                      {[["—", "—", "#4a4a4a", "#f5f5f5", "#c0c0c0"], ["Champagne", "Champ", "#7a5020", "#fdf4e8", "#c8a060"], ["N/A", "N/A", "#1f5f73", "#e8f7fb", "#7fc6db"]].map(([pairing, label, col, bg, border]) => {
                        const active = pairing === "—" ? (beetExtra.ordered && (!beetExtra.pairing || beetExtra.pairing === "—")) : (beetExtra.ordered && beetExtra.pairing === pairing);
                        return (
                          <button key={pairing} onClick={() => updSeat && updSeat(t.id, s.id, "extras", {
                            ...s.extras, 1: active ? { ordered: false, pairing: "—" } : { ordered: true, pairing },
                          })} style={{
                            fontFamily: FONT, fontSize: 9, letterSpacing: 0.3, padding: "3px 9px",
                            border: `1px solid ${active ? border : "#e8e8e8"}`, borderRadius: 20, cursor: "pointer",
                            background: active ? bg : "#fff", color: active ? col : "#ccc",
                            transition: "all 0.1s",
                          }}>Beet {label}</button>
                        );
                      })}
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
                    {/* Aperitif quick-add — same behaviour as Beverages section buttons */}
                    {aperitifOptions && aperitifOptions.length > 0 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap", padding: "2px 10px 8px" }}>
                        <span style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 1, color: "#ccc", marginRight: 2 }}>APR</span>
                        {aperitifOptions.map(opt => {
                          const label = opt.label ?? opt;
                          const sk = (opt.searchKey ?? opt).toLowerCase();
                          const active = (s.aperitifs || []).some(x => x?.name?.toLowerCase().includes(sk) || x?.producer?.toLowerCase().includes(sk));
                          return (
                            <button key={label} onClick={() => {
                              if (!updSeat) return;
                              if (active) {
                                updSeat(t.id, s.id, "aperitifs", (s.aperitifs || []).filter(x => !x?.name?.toLowerCase().includes(sk) && !x?.producer?.toLowerCase().includes(sk)));
                              } else {
                                const type = opt.type || "wine";
                                const found = type === "wine"
                                  ? wines.filter(w => w.byGlass).find(w => w.name?.toLowerCase().includes(sk) || w.producer?.toLowerCase().includes(sk))
                                  : cocktails?.find(c => c.name?.toLowerCase().includes(sk));
                                const item = found || { name: label, notes: "", __cocktail: true };
                                updSeat(t.id, s.id, "aperitifs", [...(s.aperitifs || []), item]);
                              }
                            }} style={{
                              fontFamily: FONT, fontSize: 8, letterSpacing: 0.3, padding: "3px 7px",
                              border: `1px solid ${active ? "#7a5020" : "#e8e8e8"}`,
                              borderRadius: 3, cursor: "pointer",
                              background: active ? "#fdf4e8" : "#fff",
                              color: active ? "#7a5020" : "#bbb",
                            }}>{label}</button>
                          );
                        })}
                      </div>
                    )}
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
        {isSeated && (quickMode || onUnseat) && (
          <div style={{ padding: "6px 14px", borderTop: "1px solid #f5f5f5", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {quickMode && upd ? (
              <button onClick={() => {
                const seats = t.seats || [];
                const alertSeats = seats.map(s => {
                  const beetExtra = s.extras?.[1];
                  return {
                    id: s.id,
                    pairing: s.pairing || null,
                    beet: beetExtra?.ordered ? { pairing: beetExtra.pairing || "—" } : null,
                    cheese: !!s.extras?.[2]?.ordered,
                  };
                });
                upd(t.id, "kitchenAlert", {
                  timestamp: new Date().toISOString(),
                  tableName: t.resName || null,
                  seats: alertSeats,
                  confirmed: false,
                });
              }} style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 16px",
                border: "1px solid #1a1a1a", borderRadius: 3, cursor: "pointer",
                background: "#1a1a1a", color: "#fff", fontWeight: 700, textTransform: "uppercase",
              }}>Send</button>
            ) : <span />}
            {onUnseat && (
              <button onClick={() => onUnseat(t.id)} style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "4px 12px",
                border: "1px solid #d8d8d8", borderRadius: 3, cursor: "pointer",
                background: "#fff", color: "#999", textTransform: "uppercase",
              }}>Unseat</button>
            )}
          </div>
        )}
      </div>
    );
}

function DisplayBoard({ tables, dishes, upd, quickMode = false, updSeat, onCardClick, onSeat, onUnseat, aperitifOptions = [], wines = [], cocktails = [] }) {
  const isMobile = useIsMobile(700);

  const isPrimary = t => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup);
  const visible = tables.filter(t => t.active || t.resTime || t.resName).filter(isPrimary);
  const rowsData = SITTING_TIMES.map(time => ({
    time,
    tables: visible
      .filter(t => t.resTime === time)
      .sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return (a.arrivedAt || a.resTime || "99").localeCompare(b.arrivedAt || b.resTime || "99");
      }),
  }));
  const hasAny = rowsData.some(r => r.tables.length > 0);

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
              alignItems: "start",
            }}>
              {rowTables.map(t => (
                <DisplayBoardCard
                  key={t.id}
                  t={t}
                  quickMode={quickMode}
                  upd={upd}
                  updSeat={updSeat}
                  onCardClick={onCardClick}
                  onSeat={onSeat}
                  onUnseat={onUnseat}
                  dishes={dishes}
                  aperitifOptions={aperitifOptions}
                  wines={wines}
                  cocktails={cocktails}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Service Quick View ────────────────────────────────────────────────────────
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
          const beetExtra = seat.extras?.[1] || { ordered: false, pairing: "—" };
          const hasBeet = !!beetExtra.ordered;
          const hasCheese = !!seat.extras?.[2]?.ordered;
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
function KitchenTicket({ table, menuCourses, upd, dragHandleRef, dragListeners }) {
  const seats = table.seats || [];
  const restrictions = table.restrictions || [];
  const log = table.kitchenLog || {};
  const [assigningRestrIdx, setAssigningRestrIdx] = useState(null);
  const [showEdit, setShowEdit] = useState(false);
  const [pickingRestr, setPickingRestr] = useState(null); // restriction key, or "custom"
  const [customNote, setCustomNote] = useState("");
  const [editingCourse, setEditingCourse] = useState(null);
  const [editName, setEditName] = useState("");
  const [editNote, setEditNote] = useState("");

  const kitchenCourseNotes = table.kitchenCourseNotes || {};
  const startEditCourse = (key) => {
    const curr = kitchenCourseNotes[key] || {};
    setEditName(curr.name || "");
    setEditNote(curr.note || "");
    setEditingCourse(key);
  };
  const saveCourseDraft = (key, name, note) => {
    const allNotes = { ...kitchenCourseNotes };
    const entry = {};
    if (name.trim()) entry.name = name.trim();
    if (note.trim()) entry.note = note.trim();
    if (Object.keys(entry).length) allNotes[key] = entry;
    else delete allNotes[key];
    upd(table.id, "kitchenCourseNotes", allNotes);
  };
  const clearCourseNote = (key) => {
    const allNotes = { ...kitchenCourseNotes };
    delete allNotes[key];
    upd(table.id, "kitchenCourseNotes", allNotes);
    setEditingCourse(null);
  };

  const addKitchenRestr = (note, seatId) => {
    if (!note?.trim()) return;
    const next = [...restrictions, { note: note.trim(), pos: seatId || null, kitchenAdded: true }];
    upd(table.id, "restrictions", next);
    setPickingRestr(null);
    setCustomNote("");
  };
  const removeKitchenRestr = (origIdx) => {
    const next = restrictions.filter((_, i) => i !== origIdx);
    upd(table.id, "restrictions", next);
  };

  const extrasConfirmed = table.extrasConfirmed || {};
  const confirmExtra = (type) => {
    const next = { ...extrasConfirmed, [type]: true };
    upd(table.id, "extrasConfirmed", next);
  };

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
  const isBeetCourse    = c => { const f = normFlag(c.optional_flag), k = normFlag(c.course_key || c.menu?.name); return f === "beetroot" || k === "beetroot"; };
  const isCheeseCourse  = c => { const f = normFlag(c.optional_flag), k = normFlag(c.course_key || c.menu?.name); return f === "cheese"   || k === "cheese";   };
  // Also check normalized menu name directly (matches menuGenerator.js isCakeCourse logic)
  const isCakeCourse    = c => { const f = normFlag(c.optional_flag), k = normFlag(c.course_key || c.menu?.name), kn = normFlag(c.menu?.name); return f === "cake" || k === "pear" || k === "pear_cake" || kn === "pear"; };
  const isForcedPairingCourse = c => !!String(c.force_pairing_title || c.force_pairing_title_si || "").trim();

  // Extras ordered per seat — must come before courses filter
  const beetSeats   = seats.filter(s => s.extras?.[1]?.ordered);
  const cheeseSeats = seats.filter(s => s.extras?.[2]?.ordered);
  const cakeSeats   = seats.filter(s => s.extras?.[3]?.ordered);
  const hasCake     = cakeSeats.length > 0;

  const isShort = String(table.menuType || "").trim().toLowerCase() === "short";
  const isTruthyShort = v => { const s = String(v ?? "").trim().toLowerCase(); return s === "true" || s === "1" || s === "yes" || s === "y" || s === "x" || s === "wahr"; };

  // Apply per-table course overrides on top of the (already globally-overridden) menuCourses
  const tableOverriddenCourses = (menuCourses || []).map(c => applyMenuOverride(c, table.courseOverrides || {}));

  // Courses to show: non-snack, optional extras only when ordered, short menu filtered
  const courses = tableOverriddenCourses.filter(c => {
    if (c.is_snack) return false;
    if (isBeetCourse(c)   && beetSeats.length   === 0) return false;
    if (isBeetCourse(c)   && !extrasConfirmed.beetroot) return false;
    if (isCheeseCourse(c) && cheeseSeats.length === 0) return false;
    if (isCheeseCourse(c) && !extrasConfirmed.cheese) return false;
    if (isCakeCourse(c)   && cakeSeats.length   === 0 && !table.birthday) return false;
    if (isCakeCourse(c)   && !extrasConfirmed.cake && !table.birthday) return false;
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
  const lastFiredAt = allDone ? Object.values(log).map(e => e.firedAt).filter(Boolean).sort().pop() : null;
  const durationMins = (() => {
    const start = parseHHMM(table.arrivedAt), end = parseHHMM(lastFiredAt);
    if (start == null || end == null) return null;
    const d = end - start; return d >= 0 ? d : d + 1440;
  })();

  const pLabel = p => p === "Non-Alc" ? "N/A" : p === "Our Story" ? "O.S." : p === "Premium" ? "Prem" : p === "Wine" ? "Wine" : p;

  return (
    <div style={{ border: "2px solid #e8e8e8", borderRadius: 6, overflow: "hidden", background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,0.07)" }}>

      {/* ── Header (drag handle) ── */}
      <div ref={dragHandleRef} {...dragListeners} style={{ background: "#fff", borderBottom: "1px solid #e8e8e8", padding: "7px 10px", display: "flex", alignItems: "flex-start", gap: 8, cursor: dragListeners ? "grab" : undefined, touchAction: "none" }}>
        <span style={{ fontFamily: FONT, fontSize: table.tableGroup?.length > 1 ? 16 : 21, fontWeight: 800, color: "#111", lineHeight: 1, letterSpacing: -1, flexShrink: 0 }}>
          {table.tableGroup?.length > 1 ? `T${table.tableGroup.join("-")}` : `T${table.id}`}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 5, flexWrap: "wrap" }}>
            {table.resName && <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{table.resName}</span>}
            {table.menuType && <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, padding: "1px 5px", borderRadius: 3, background: isShort ? "#fff4e0" : "#e8f0ff", color: isShort ? "#a06000" : "#2a50a0" }}>{isShort ? "SHORT" : "LONG"}</span>}
            <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: 0.5, padding: "1px 5px", borderRadius: 3, background: table.lang === "si" ? "#fff0f0" : "#f0fff4", color: table.lang === "si" ? "#a03030" : "#207040", border: "1px solid", borderColor: table.lang === "si" ? "#f0c0c0" : "#b0dcc0" }}>{table.lang === "si" ? "SI" : "EN"}</span>
            {table.birthday && <span style={{ fontSize: 10 }}>🎂</span>}
            {table.guestType === "hotel" && <span style={{ fontFamily: FONT, fontSize: 8, color: "#9a6a20", letterSpacing: 0.5 }}>{table.room ? `#${table.room}` : "Hotel"}</span>}
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 1, flexWrap: "wrap" }}>
            <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, color: "#111" }}>{seats.length} <span style={{ fontWeight: 600, fontSize: 10, letterSpacing: 0.5 }}>PAX</span></span>
            {table.resTime && <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, color: "#333" }}>{table.resTime}</span>}
            {table.arrivedAt && <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, color: "#4a9a6a" }}>arr. {table.arrivedAt}</span>}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
          <div style={{ fontFamily: FONT, fontSize: 15, fontWeight: 700, color: allDone ? "#4a9a6a" : "#111", lineHeight: 1 }}>{firedCount}<span style={{ fontSize: 10, color: "#666", fontWeight: 400 }}>/{totalCourses}</span></div>
          {allDone && durationMins != null && <div style={{ fontFamily: FONT, fontSize: 9, color: "#4a9a6a" }}>{durationMins} min</div>}
          <button
            onPointerDown={e => e.stopPropagation()}
            onClick={e => { e.stopPropagation(); setShowEdit(v => !v); setPickingRestr(null); setCustomNote(""); setEditingCourse(null); }}
            style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "2px 7px",
              border: `1px solid ${showEdit ? "#1a1a1a" : "#ddd"}`,
              borderRadius: 3, cursor: "pointer",
              background: showEdit ? "#1a1a1a" : "#fff",
              color: showEdit ? "#fff" : "#888",
              touchAction: "manipulation",
            }}>✏ EDIT</button>
        </div>
      </div>

      {/* ── Notes banner ── */}
      {table.notes && (
        <div style={{ background: "#fffbe8", borderBottom: "1px solid #f0d878", padding: "5px 10px", display: "flex", gap: 6, alignItems: "flex-start" }}>
          <span style={{ fontSize: 10, flexShrink: 0, lineHeight: 1.4 }}>📋</span>
          <span style={{ fontFamily: FONT, fontSize: 10, color: "#7a6010", lineHeight: 1.35, fontStyle: "italic" }}>{table.notes}</span>
        </div>
      )}

      {/* ── Temp restriction editor ── */}
      {showEdit && (
        <div style={{ borderBottom: "1px solid #e8e8e8", padding: "8px 10px", background: "#fafafa" }}>
          {/* Existing kitchen-added restrictions */}
          {restrictions.map((r, i) => r.kitchenAdded ? (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontFamily: FONT, fontSize: 10, color: "#b04040", fontWeight: 600 }}>
                {restrLabel(r.note)}{r.pos ? ` → P${r.pos}` : " → All"}
              </span>
              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={e => { e.stopPropagation(); removeKitchenRestr(i); }}
                style={{ fontFamily: FONT, fontSize: 10, padding: "1px 6px", border: "1px solid #e09090", borderRadius: 3, cursor: "pointer", background: "#fff", color: "#b04040", touchAction: "manipulation" }}>✕</button>
            </div>
          ) : null)}
          {/* Step 1: pick restriction */}
          {!pickingRestr && (
            <>
              <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, color: "#888", textTransform: "uppercase", marginBottom: 6 }}>Add restriction</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {RESTRICTIONS.map(r => (
                  <button key={r.key}
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); setPickingRestr(r.key); }}
                    style={{ fontFamily: FONT, fontSize: 9, padding: "4px 8px", border: "1px solid #e0e0e0", borderRadius: 3, cursor: "pointer", background: "#fff", color: "#444", touchAction: "manipulation" }}>
                    {r.emoji} {r.label}
                  </button>
                ))}
                <button
                  onPointerDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); setPickingRestr("custom"); }}
                  style={{ fontFamily: FONT, fontSize: 9, padding: "4px 8px", border: "1px solid #e0e0e0", borderRadius: 3, cursor: "pointer", background: "#fff", color: "#888", touchAction: "manipulation" }}>
                  + Custom
                </button>
              </div>
            </>
          )}
          {/* Step 2a: assign to seat */}
          {pickingRestr && pickingRestr !== "custom" && (
            <div>
              <div style={{ fontFamily: FONT, fontSize: 9, color: "#444", marginBottom: 6 }}>
                {restrLabel(pickingRestr)} → assign to:
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); addKitchenRestr(pickingRestr, null); }}
                  style={{ fontFamily: FONT, fontSize: 9, padding: "4px 10px", border: "1px solid #c8a060", borderRadius: 3, cursor: "pointer", background: "#fdf4e8", color: "#7a5020", fontWeight: 700, touchAction: "manipulation" }}>All</button>
                {seats.map(s => (
                  <button key={s.id} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); addKitchenRestr(pickingRestr, s.id); }}
                    style={{ fontFamily: FONT, fontSize: 9, padding: "4px 10px", border: "1px solid #e09090", borderRadius: 3, cursor: "pointer", background: "#fff", color: "#b04040", fontWeight: 700, touchAction: "manipulation" }}>P{s.id}</button>
                ))}
                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setPickingRestr(null); }}
                  style={{ fontFamily: FONT, fontSize: 9, padding: "4px 8px", border: "1px solid #eee", borderRadius: 3, cursor: "pointer", background: "#fff", color: "#bbb", touchAction: "manipulation" }}>cancel</button>
              </div>
            </div>
          )}
          {/* Step 2b: custom text */}
          {pickingRestr === "custom" && (
            <div>
              <input
                value={customNote}
                onChange={e => setCustomNote(e.target.value)}
                placeholder="e.g. No Ricotta"
                onPointerDown={e => e.stopPropagation()}
                style={{ fontFamily: FONT, fontSize: 10, padding: "5px 8px", border: "1px solid #ddd", borderRadius: 3, width: "100%", marginBottom: 6, boxSizing: "border-box" }}
              />
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); addKitchenRestr(customNote, null); }}
                  style={{ fontFamily: FONT, fontSize: 9, padding: "4px 10px", border: "1px solid #c8a060", borderRadius: 3, cursor: "pointer", background: "#fdf4e8", color: "#7a5020", fontWeight: 700, touchAction: "manipulation" }}>All</button>
                {seats.map(s => (
                  <button key={s.id} onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); addKitchenRestr(customNote, s.id); }}
                    style={{ fontFamily: FONT, fontSize: 9, padding: "4px 10px", border: "1px solid #e09090", borderRadius: 3, cursor: "pointer", background: "#fff", color: "#b04040", fontWeight: 700, touchAction: "manipulation" }}>P{s.id}</button>
                ))}
                <button onPointerDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); setPickingRestr(null); setCustomNote(""); }}
                  style={{ fontFamily: FONT, fontSize: 9, padding: "4px 8px", border: "1px solid #eee", borderRadius: 3, cursor: "pointer", background: "#fff", color: "#bbb", touchAction: "manipulation" }}>cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Pace ── */}
      <div style={{ borderBottom: "1px solid #e8e8e8", padding: "5px 10px", display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#888", textTransform: "uppercase", flexShrink: 0 }}>Pace</span>
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
                  color: p ? (pairingColor[p] || "#444") : "#444",
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


      {/* ── Extras backup confirm — shown only when ordered but Send was never clicked ── */}
      {upd && (beetSeats.length > 0 && !extrasConfirmed.beetroot || cheeseSeats.length > 0 && !extrasConfirmed.cheese) && (
        <div style={{ background: "#fff8ee", borderBottom: "1px solid #f0d080", padding: "6px 10px", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, color: "#a07020", textTransform: "uppercase", flexShrink: 0 }}>⚠ Not sent</span>
          {beetSeats.length > 0 && !extrasConfirmed.beetroot && (
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); confirmExtra("beetroot"); }}
              style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "3px 10px",
                border: "1px solid #c8a060", borderRadius: 3, cursor: "pointer",
                background: "#fdf4e8", color: "#7a5020", touchAction: "manipulation",
              }}>BEETROOT ({beetSeats.map(s => `P${s.id}`).join(" ")}) — CONFIRM</button>
          )}
          {cheeseSeats.length > 0 && !extrasConfirmed.cheese && (
            <button
              onPointerDown={e => e.stopPropagation()}
              onClick={e => { e.stopPropagation(); confirmExtra("cheese"); }}
              style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "3px 10px",
                border: "1px solid #c8a060", borderRadius: 3, cursor: "pointer",
                background: "#fdf4e8", color: "#7a5020", touchAction: "manipulation",
              }}>CHEESE ({cheeseSeats.map(s => `P${s.id}`).join(" ")}) — CONFIRM</button>
          )}
        </div>
      )}

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
          const kitchenNote = (() => {
            const notes = new Set();
            seats.forEach(seat => {
              seatRestrKeys(seat).forEach(k => {
                const n = course.restrictions?.[k]?.kitchen_note;
                if (n?.trim()) notes.add(n.trim());
              });
            });
            return [...notes].join(" · ");
          })();
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
            if (isBeetCourse(course))    return beetSeats.map(s => `P${s.id}`).join(" ");
            if (isCheeseCourse(course))  return cheeseSeats.map(s => `P${s.id}`).join(" ");
            if (isCakeCourse(course))    return cakeSeats.map(s => `P${s.id}`).join(" ") + (table.cakeNote ? ` — ${table.cakeNote}` : "");
            return null;
          })();

          const kcNote = kitchenCourseNotes[key] || {};
          const displayName = kcNote.name || line1;
          const isEditingThis = editingCourse === key;

          return (
            <div key={key} style={{
              borderBottom: "1px solid #f2f2f2",
              background: fired ? "#f3fcf5" : "#fff",
              borderLeft: fired ? "4px solid #4a9a6a" : kcNote.name || kcNote.note ? "4px solid #c04040" : "4px solid transparent",
            }}>
              <div
                onClick={() => !isEditingThis && (fired ? unfire(key) : fire(key))}
                style={{ display: "flex", alignItems: "center", padding: "7px 10px 7px 8px", gap: 7, cursor: isEditingThis ? "default" : "pointer" }}>
                <span style={{ fontFamily: FONT, fontSize: 13, color: fired ? "#4a9a6a" : "#ddd", flexShrink: 0, lineHeight: 1 }}>{fired ? "✓" : "○"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: FONT, fontSize: 11, fontWeight: 700, lineHeight: 1.25,
                    color: fired ? "#bbb" : kcNote.name ? "#c04040" : "#111",
                    textDecoration: fired ? "line-through" : "none",
                    letterSpacing: 0.2,
                  }}>
                    {displayName}
                    {kcNote.name && <span style={{ fontFamily: FONT, fontSize: 8, fontWeight: 400, color: "#aaa", marginLeft: 5 }}>({line1})</span>}
                    {extraLabel && <span style={{ fontFamily: FONT, fontSize: 9, fontWeight: 400, color: "#bbb", marginLeft: 6 }}>{extraLabel}</span>}
                  </div>
                  {(modGroups || kitchenNote || kcNote.note) && !fired && (
                    <div style={{ marginTop: 2, display: "flex", flexWrap: "wrap", gap: "2px 8px" }}>
                      {modGroups && Object.entries(modGroups).sort(([a], [b]) => (a === baseName ? -1 : 1) - (b === baseName ? -1 : 1)).map(([name, count]) => (
                        <span key={name} style={{ fontFamily: FONT, fontSize: 10, color: name === baseName ? "#444" : "#c04040", fontWeight: 600 }}>{count}× {name}</span>
                      ))}
                      {kitchenNote && <span style={{ fontFamily: FONT, fontSize: 10, color: "#c04040", fontWeight: 600 }}>{kitchenNote}</span>}
                      {kcNote.note && <span style={{ fontFamily: FONT, fontSize: 10, color: "#c04040", fontWeight: 600 }}>⚑ {kcNote.note}</span>}
                    </div>
                  )}
                </div>
                {showEdit && !fired && (
                  <button
                    onPointerDown={e => e.stopPropagation()}
                    onClick={e => { e.stopPropagation(); if (isEditingThis) { saveCourseDraft(key, editName, editNote); setEditingCourse(null); } else { startEditCourse(key); } }}
                    style={{
                      fontFamily: FONT, fontSize: 9, padding: "2px 6px", flexShrink: 0,
                      border: `1px solid ${isEditingThis ? "#1a1a1a" : "#ddd"}`,
                      borderRadius: 3, cursor: "pointer",
                      background: isEditingThis ? "#1a1a1a" : "#fff",
                      color: isEditingThis ? "#fff" : "#aaa",
                      touchAction: "manipulation",
                    }}>✏</button>
                )}
                {firedAt && <span style={{ fontFamily: FONT, fontSize: 9, color: "#4a9a6a", fontWeight: 700, flexShrink: 0 }}>{firedAt}</span>}
              </div>
              {/* Inline course editor */}
              {isEditingThis && (
                <div onPointerDown={e => e.stopPropagation()} style={{ padding: "0 10px 8px 28px", display: "flex", flexDirection: "column", gap: 5 }}>
                  <input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onBlur={() => saveCourseDraft(key, editName, editNote)}
                    placeholder={`Rename "${line1}"…`}
                    style={{ fontFamily: FONT, fontSize: 10, padding: "4px 7px", border: "1px solid #c04040", borderRadius: 3, width: "100%", boxSizing: "border-box" }}
                  />
                  <input
                    value={editNote}
                    onChange={e => setEditNote(e.target.value)}
                    onBlur={() => saveCourseDraft(key, editName, editNote)}
                    placeholder="Add note (e.g. No Ricotta)…"
                    style={{ fontFamily: FONT, fontSize: 10, padding: "4px 7px", border: "1px solid #ddd", borderRadius: 3, width: "100%", boxSizing: "border-box" }}
                  />
                  {(kcNote.name || kcNote.note) && (
                    <button
                      onPointerDown={e => e.stopPropagation()}
                      onClick={e => { e.stopPropagation(); clearCourseNote(key); }}
                      style={{ fontFamily: FONT, fontSize: 8, padding: "3px 8px", border: "1px solid #e09090", borderRadius: 3, cursor: "pointer", background: "#fff", color: "#b04040", alignSelf: "flex-start", touchAction: "manipulation" }}>Clear override</button>
                  )}
                </div>
              )}
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

function SortableTicket({ table, menuCourses, upd, isDragging, anyDragging }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition } = useSortable({
    id: table.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      style={{
        flexShrink: 0, width: 248,
        // Only apply transform while a drag is active — prevents stale transforms
        // from persisting after drag ends and causing cards to appear displaced.
        transform: anyDragging && transform ? `translate3d(${Math.round(transform.x)}px, ${Math.round(transform.y)}px, 0)` : undefined,
        transition: isDragging ? 'none' : (anyDragging ? transition : undefined),
        userSelect: "none", WebkitUserSelect: "none",
        touchAction: "pan-y",
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
        <KitchenTicket table={table} menuCourses={menuCourses} upd={upd} dragHandleRef={setActivatorNodeRef} dragListeners={listeners} />
      )}
    </div>
  );
}

function KitchenAlertOverlay({ alerts, onConfirm }) {
  if (alerts.length === 0) return null;
  const PAIR_COLORS = {
    Wine:      { color: "#7a5020", bg: "#fdf4e8", border: "#c8a060" },
    "Non-Alc": { color: "#1f5f73", bg: "#e8f7fb", border: "#7fc6db" },
    Premium:   { color: "#5a5a8a", bg: "#f0eeff", border: "#aaaacc" },
    "Our Story":{ color: "#3a7a5a", bg: "#eaf5ee", border: "#7abf9a" },
  };
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.72)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      gap: 16, padding: "24px 16px", overflowY: "auto",
    }}>
      {alerts.map(({ tableId, alert }) => {
        const seats = alert.seats || [];
        const pairSeats   = seats.filter(s => s.pairing && s.pairing !== "—");
        const beetSeats   = seats.filter(s => s.beet);
        const cheeseSeats = seats.filter(s => s.cheese);
        const ts = new Date(alert.timestamp);
        const timeStr = `${String(ts.getHours()).padStart(2,"0")}:${String(ts.getMinutes()).padStart(2,"0")}`;
        return (
          <div key={tableId} style={{
            background: "#fff", borderRadius: 10, maxWidth: 480, width: "100%",
            boxShadow: "0 16px 48px rgba(0,0,0,0.4)",
            overflow: "hidden",
          }}>
            {/* Header */}
            <div style={{
              background: "#1a1a1a", padding: "14px 20px",
              display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
              <div>
                <span style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, letterSpacing: 2, color: "#fff" }}>
                  TABLE {tableId}{alert.tableName ? ` — ${alert.tableName}` : ""}
                </span>
              </div>
              <span style={{ fontFamily: FONT, fontSize: 10, color: "#888", letterSpacing: 1 }}>{timeStr}</span>
            </div>
            {/* Body */}
            <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
              {pairSeats.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                  <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1.5, color: "#666", minWidth: 60 }}>PAIRING</span>
                  {pairSeats.map(s => {
                    const c = PAIR_COLORS[s.pairing] || {};
                    return (
                      <span key={s.id} style={{ fontFamily: FONT, fontSize: 11, padding: "3px 8px", borderRadius: 4, background: c.bg || "#f5f5f5", border: `1px solid ${c.border || "#ddd"}`, color: c.color || "#444" }}>
                        P{s.id} {s.pairing}
                      </span>
                    );
                  })}
                </div>
              )}
              {beetSeats.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                  <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1.5, color: "#666", minWidth: 60 }}>BEETROOT</span>
                  {beetSeats.map(s => (
                    <span key={s.id} style={{ fontFamily: FONT, fontSize: 11, padding: "3px 8px", borderRadius: 4, background: "#edf8e8", border: "1px solid #88cc88", color: "#2a6a2a" }}>
                      P{s.id}{s.beet.pairing && s.beet.pairing !== "—" ? ` · ${s.beet.pairing}` : ""}
                    </span>
                  ))}
                </div>
              )}
              {cheeseSeats.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
                  <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1.5, color: "#666", minWidth: 60 }}>CHEESE</span>
                  {cheeseSeats.map(s => (
                    <span key={s.id} style={{ fontFamily: FONT, fontSize: 11, padding: "3px 8px", borderRadius: 4, background: "#fdf4e8", border: "1px solid #c8a060", color: "#7a5020" }}>
                      P{s.id}
                    </span>
                  ))}
                </div>
              )}
              {pairSeats.length === 0 && beetSeats.length === 0 && cheeseSeats.length === 0 && (
                <span style={{ fontFamily: FONT, fontSize: 11, color: "#bbb" }}>No extras noted</span>
              )}
            </div>
            {/* Confirm */}
            <div style={{ padding: "12px 20px", borderTop: "1px solid #f0f0f0", display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => onConfirm(tableId)} style={{
                fontFamily: FONT, fontSize: 11, letterSpacing: 1.5, padding: "10px 28px",
                border: "none", borderRadius: 4, cursor: "pointer",
                background: "#1a1a1a", color: "#fff", fontWeight: 700, textTransform: "uppercase",
              }}>Confirm</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function KitchenBoard({ tables, menuCourses, upd, updMany }) {
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
    useSensor(PointerSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(TouchSensor,   { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const pendingAlerts = tables
    .filter(t => t.kitchenAlert && !t.kitchenAlert.confirmed)
    .map(t => ({ tableId: t.id, alert: t.kitchenAlert }));

  const confirmAlert = (tableId) => {
    // Batch both field updates into a single state change → one render, one Supabase save
    updMany(tableId, { kitchenAlert: null, extrasConfirmed: { beetroot: true, cheese: true, cake: true } });
  };

  if (activeTables.length === 0) return (
    <>
      <div style={{ fontFamily: FONT, fontSize: 11, color: "#bbb", textAlign: "center", paddingTop: 80 }}>
        No active tables
      </div>
      <KitchenAlertOverlay alerts={pendingAlerts} onConfirm={confirmAlert} />
    </>
  );

  const orderedTables = order.map(id => activeTables.find(t => t.id === id)).filter(Boolean);
  const activeTable  = activeId ? activeTables.find(t => t.id === activeId) : null;

  return (
    <>
    <KitchenAlertOverlay alerts={pendingAlerts} onConfirm={confirmAlert} />
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
                anyDragging={activeId !== null}
              />
            ))}
          </div>
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
        {activeTable && (
          <div style={{
            width: 248, borderRadius: 6,
            boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
            opacity: 0.97,
          }}>
            <KitchenTicket table={activeTable} menuCourses={menuCourses} upd={upd} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
    </>
  );
}

// ── Menu Generator ────────────────────────────────────────────────────────────
const PAIRING_MAP = { "Wine": "wp", "Non-Alc": "na", "Our Story": "os", "Premium": "premium" };


function BevEditRow({ emoji, label, items, onUpdate }) {
  const [draft, setDraft] = useState("");
  const add = () => { const v = draft.trim(); if (!v) return; onUpdate([...(items || []), { name: v }]); setDraft(""); };
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, color: "#bbb", textTransform: "uppercase", marginBottom: 4 }}>{label}</div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        {(items || []).map((item, i) => (
          <span key={i} style={{ fontFamily: FONT, fontSize: 10, padding: "2px 6px 2px 8px", borderRadius: 2, border: "1px solid #e0e0e0", background: "#fafafa", display: "flex", alignItems: "center", gap: 4 }}>
            {emoji} {item.name}
            <button onClick={() => onUpdate((items || []).filter((_, j) => j !== i))} style={{ background: "none", border: "none", cursor: "pointer", color: "#bbb", fontSize: 13, padding: 0, lineHeight: 1 }}>×</button>
          </span>
        ))}
        <input
          value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") add(); }}
          placeholder={`add…`}
          style={{ fontFamily: FONT, fontSize: 10, padding: "3px 8px", border: "1px solid #e8e8e8", borderRadius: 2, outline: "none", width: 120 }}
        />
        {draft.trim() && (
          <button onClick={add} style={{ fontFamily: FONT, fontSize: 9, padding: "3px 8px", border: "1px solid #c8a96e", borderRadius: 2, cursor: "pointer", background: "#fdf4e8", color: "#7a5020" }}>add</button>
        )}
      </div>
    </div>
  );
}

function MenuGenerator({ table, menuCourses = [], upd, onClose, defaultLayoutStyles = {}, menuTemplate = null, logoDataUri = "", wines: winesCatalog = [], cocktails: cocktailsCatalog = [], spirits: spiritsCatalog = [], beers: beersCatalog = [], aperitifOptions = [], menuRules = DEFAULT_MENU_RULES }) {
  const [teamNames, setTeamNames] = useState(readTeamNames);
  const [menuTitle, setMenuTitle] = useState(() => readMenuTitle(table.lang || "en"));
  const [thankYouNote, setThankYouNote] = useState(() => readThankYouNote(table.lang || "en"));
  const [lang, setLang] = useState(table.lang || "en");
  // Per-seat ephemeral one-time edits — { [seatId]: { [courseKey]: { name?, sub? } } }
  // Cleared automatically after the PDF for that seat is generated.
  const [seatEdits, setSeatEdits] = useState({});
  const [expandedSeatId, setExpandedSeatId] = useState(null);
  const [expandedDrinksId, setExpandedDrinksId] = useState(null);
  const [previewSeatId, setPreviewSeatId] = useState(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const genLoaded = useRef(false);

  const updSeat = (seatId, field, value) => {
    if (!upd) return;
    // Use functional update to avoid stale closure (e.g. adding aperitif then pairing in quick succession)
    upd(table.id, "seats", prev => (prev || []).map(s => s.id === seatId ? { ...s, [field]: value } : s));
  };

  // Load team names + menu title from Supabase on mount
  useEffect(() => {
    if (!supabase) { genLoaded.current = true; return; }
    Promise.all([
      supabase.from("service_settings").select("state").eq("id", "menu_gen_team").single(),
      supabase.from("service_settings").select("state").eq("id", "menu_gen_title").single(),
    ]).then(([teamRes, titleRes]) => {
      if (teamRes.data?.state?.value) setTeamNames(teamRes.data.state.value);
      if (titleRes.data?.state?.value) setMenuTitle(titleRes.data.state.value);
      genLoaded.current = true;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Save team names to localStorage + Supabase when changed
  useEffect(() => {
    writeTeamNames(teamNames);
    if (!genLoaded.current || !supabase) return;
    supabase.from("service_settings")
      .upsert({ id: "menu_gen_team", state: { value: teamNames }, updated_at: new Date().toISOString() }, { onConflict: "id" })
      .then(() => {});
  }, [teamNames]);

  // Persist menu title and thank-you note per language to localStorage
  // Note: writes happen directly in onChange and setLanguageWithDefaults — NOT here as a
  // side-effect — to avoid a React batching race where lang changes before menuTitle does,
  // causing the wrong language's key to get overwritten.

  // Save menu title to Supabase when changed
  useEffect(() => {
    if (!genLoaded.current || !supabase) return;
    supabase.from("service_settings")
      .upsert({ id: "menu_gen_title", state: { value: menuTitle }, updated_at: new Date().toISOString() }, { onConflict: "id" })
      .then(() => {});
  }, [menuTitle]);

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
  const normalizedMenuRules = normalizeMenuRules(menuRules);

  const setLanguageWithDefaults = (nextLang) => {
    writeMenuTitle(lang, menuTitle);
    writeThankYouNote(lang, thankYouNote);
    setLang(nextLang);
    if (normalizedMenuRules?.overwriteTitleAndThankYouOnLanguageSwitch !== false) {
      setMenuTitle(readMenuTitle(nextLang));
      setThankYouNote(readThankYouNote(nextLang));
    }
  };

  // ── Layout styles (global default, read-only in this view) ───────────────
  const layoutStyles = defaultLayoutStyles || {};

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
      layoutStyles,
      menuRules: normalizedMenuRules,
      menuTemplate,
      _logo: logoDataUri,
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
    setPreviewSeatId(null);
    setPreviewHtml("");
  };

  const printSelected = async (selectedSeatIds) => {
    const selected = seats.filter(s => selectedSeatIds.includes(s.id));
    if (selected.length === 0) return;
    selected.forEach((s, i) => {
      setTimeout(() => openPrint(s), i * 700);
    });
  };

  const openPreview = (seat) => {
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
      layoutStyles,
      menuRules: normalizedMenuRules,
      menuTemplate,
      _logo: logoDataUri,
    });
    setPreviewHtml(html);
    setPreviewSeatId(seat.id);
    setExpandedSeatId(null);
    setExpandedDrinksId(null);
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
              setLanguageWithDefaults(opt.val);
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
            <input value={menuTitle} onChange={e => { setMenuTitle(e.target.value); writeMenuTitle(lang, e.target.value); }}
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
            <input value={thankYouNote} onChange={e => { setThankYouNote(e.target.value); writeThankYouNote(lang, e.target.value); }}
              style={{ fontFamily: FONT, fontSize: 11, padding: "8px 10px", border: "1px solid #e0e0e0", borderRadius: 2, outline: "none", width: "100%" }} />
          </div>
        </div>

        {/* Menu behavior rules (in-app configurable) */}
        {/* Seat rows */}
        <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#888", textTransform: "uppercase", marginBottom: 10 }}>Seats</div>

        {seats.map(s => {
          const seatRestr  = restrictions.filter(r => !r.pos || r.pos === s.id);
          const printable  = isPrintable(s);
          const extras     = Object.entries(s.extras || {}).filter(([,v]) => v?.ordered).map(([k]) => +k);
          const glasses    = s.glasses || [];
          const cocktails  = s.cocktails || [];
          const bottles    = seatBottles(s);

          const spirits    = s.spirits  || [];
          const beers      = s.beers    || [];

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

                {/* Manually added beverages */}
                {glasses.map((w, i) => (
                  <span key={`g${i}`} style={{ fontFamily: FONT, fontSize: 9, padding: "2px 7px", borderRadius: 2, background: "#fdf4e8", color: "#7a5020", border: "1px solid #c8a060", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    🍷 {w.name}
                  </span>
                ))}
                {cocktails.map((c, i) => (
                  <span key={`c${i}`} style={{ fontFamily: FONT, fontSize: 9, padding: "2px 7px", borderRadius: 2, background: "#f5eeff", color: "#5a3878", border: "1px solid #b898d8", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    🍹 {c.name}
                  </span>
                ))}
                {spirits.map((sp, i) => (
                  <span key={`s${i}`} style={{ fontFamily: FONT, fontSize: 9, padding: "2px 7px", borderRadius: 2, background: "#fff3e0", color: "#7a5020", border: "1px solid #d4a870", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    🥃 {sp.name}
                  </span>
                ))}
                {beers.map((b, i) => (
                  <span key={`b${i}`} style={{ fontFamily: FONT, fontSize: 9, padding: "2px 7px", borderRadius: 2, background: "#edf8e8", color: "#3a6a2a", border: "1px solid #88bb70", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    🍺 {b.name}
                  </span>
                ))}

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
                <button onClick={() => { setExpandedSeatId(isExpanded ? null : s.id); setExpandedDrinksId(null); setPreviewSeatId(null); }} style={{
                  fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 10px",
                  border: `1px solid ${seatHasEdits ? "#f0c060" : "#e0e0e0"}`, borderRadius: 2, cursor: "pointer",
                  background: seatHasEdits ? "#fff8e0" : "#fafafa",
                  color: seatHasEdits ? "#a07020" : "#aaa",
                }}>{isExpanded ? "▲" : (seatHasEdits ? "✎ EDITED" : "✎")}</button>

                {/* Drinks edit button */}
                {upd && (
                  <button onClick={() => { setExpandedDrinksId(expandedDrinksId === s.id ? null : s.id); setExpandedSeatId(null); setPreviewSeatId(null); }} style={{
                    fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 10px",
                    border: `1px solid ${expandedDrinksId === s.id ? "#6a9abf" : "#e0e0e0"}`, borderRadius: 2, cursor: "pointer",
                    background: expandedDrinksId === s.id ? "#eef4fa" : "#fafafa",
                    color: expandedDrinksId === s.id ? "#2a5a80" : "#aaa",
                  }}>🍷</button>
                )}

                {/* Preview button */}
                <button onClick={() => previewSeatId === s.id ? setPreviewSeatId(null) : openPreview(s)} style={{
                  fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 10px",
                  border: `1px solid ${previewSeatId === s.id ? "#4a7a9a" : "#e0e0e0"}`, borderRadius: 2, cursor: "pointer",
                  background: previewSeatId === s.id ? "#e8f0f8" : "#fafafa",
                  color: previewSeatId === s.id ? "#2a5a80" : "#aaa",
                }}>👁</button>

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
                    {(() => { const pkey = PAIRING_MAP[s.pairing]; const hasPair = !!pkey; return menuCourses.filter(c => !c.is_snack).map(course => {
                      const key = course.course_key;
                      const baseDish = getSeatDish(course, s.id);
                      const edit = seatEdits[s.id]?.[key] || {};
                      const hasEdit = "name" in edit || "sub" in edit || "drinkName" in edit || "drinkSub" in edit;
                      const inpStyle = { ...baseInp, padding: "3px 6px", fontSize: 11 };
                      const baseDrink = hasPair ? (lang === "si" ? (course[`${pkey}_si`] || course[pkey]) : course[pkey]) : null;
                      return (
                        <div key={key} style={{
                          display: "grid", gridTemplateColumns: hasPair ? "100px 1fr 1.2fr 44px 1fr 1.2fr 20px" : "120px 1fr 1.6fr 20px",
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
                          {hasPair && <>
                            <span style={{ fontFamily: FONT, fontSize: 7, color: "#8a8a6a", textAlign: "center", whiteSpace: "nowrap" }}>
                              {s.pairing}
                            </span>
                            <BlurInput
                              committedValue={"drinkName" in edit ? edit.drinkName : ""}
                              onCommit={v => setSeatEditField(s.id, key, "drinkName", v)}
                              placeholder={"drinkName" in edit ? "" : (baseDrink?.name || "")}
                              style={inpStyle}
                            />
                            <BlurInput
                              committedValue={"drinkSub" in edit ? edit.drinkSub : ""}
                              onCommit={v => setSeatEditField(s.id, key, "drinkSub", v)}
                              placeholder={"drinkSub" in edit ? "" : (baseDrink?.sub || "")}
                              style={inpStyle}
                            />
                          </>}
                          {hasEdit
                            ? <button onClick={() => setSeatEdits(prev => {
                                const sd = { ...(prev[s.id] || {}) };
                                delete sd[key];
                                return { ...prev, [s.id]: Object.keys(sd).length ? sd : undefined };
                              })} style={{ background: "none", border: "none", color: "#ccc", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                            : <span />}
                        </div>
                      );
                    }); })()}
                  </div>
                </div>
              )}

              {/* Drinks editor */}
              {expandedDrinksId === s.id && (
                <div style={{ borderTop: "1px solid #e8f0f8", padding: "12px 16px 14px", background: "#f7fafd" }}>
                  <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, color: "#6a9abf", textTransform: "uppercase", marginBottom: 12 }}>Drinks & Pairing — P{s.id}</div>
                  {/* Pairing selector */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>Pairing</div>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {["—", "Wine", "Non-Alc", "Premium", "Our Story"].map(p => {
                        const active = (s.pairing || "—") === p;
                        return (
                          <button key={p} onClick={() => updSeat(s.id, "pairing", p === "—" ? "—" : p)} style={{
                            fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 12px",
                            border: `1px solid ${active ? "#2a5a80" : "#e0e0e0"}`, borderRadius: 2, cursor: "pointer",
                            background: active ? "#2a5a80" : "#fff",
                            color: active ? "#fff" : "#888",
                          }}>{p}</button>
                        );
                      })}
                    </div>
                  </div>
                  {/* ── Aperitif — generates above Sour Soup ── */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, color: "#a07040", textTransform: "uppercase", marginBottom: 6 }}>Aperitif</div>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                      {aperitifOptions.map(ap => {
                        const label = ap.label ?? ap;
                        const sk = (ap.searchKey ?? ap).toLowerCase();
                        const type = ap.type || "wine";
                        return (
                          <button key={label} onClick={() => {
                            const found = type === "wine"
                              ? winesCatalog.filter(w => w.byGlass).find(w => w.name?.toLowerCase().includes(sk) || w.producer?.toLowerCase().includes(sk))
                              : cocktailsCatalog?.find(c => c.name?.toLowerCase().includes(sk));
                            const item = found || { name: label, notes: "", __cocktail: true };
                            updSeat(s.id, "aperitifs", [...(s.aperitifs || []), item]);
                          }} style={{
                            fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: "4px 9px",
                            border: "1px solid #d0c0a8", borderRadius: 3, cursor: "pointer",
                            background: "#fff", color: "#7a5020",
                          }}>{label}</button>
                        );
                      })}
                    </div>
                    <BeverageSearch
                      wines={winesCatalog} cocktails={cocktailsCatalog} spirits={spiritsCatalog} beers={beersCatalog}
                      onAdd={({ type, item }) => {
                        updSeat(s.id, "aperitifs", [...(s.aperitifs || []), item]);
                      }}
                    />
                    {(s.aperitifs || []).length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                        {(s.aperitifs || []).map((x, i) => {
                          const ts = BEV_TYPES.aperitif;
                          const label = x?.name || x?.producer || "?";
                          const sub = x?.producer && x?.name ? x.producer : (x?.notes || "");
                          return (
                            <div key={`ap${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px 4px 10px", borderRadius: 999, background: ts.bg, border: `1px solid ${ts.border}` }}>
                              <span style={{ fontFamily: FONT, fontSize: 11, color: ts.color, fontWeight: 500, whiteSpace: "nowrap" }}>{label}{sub ? ` · ${sub}` : ""}</span>
                              <button onClick={() => updSeat(s.id, "aperitifs", (s.aperitifs||[]).filter((_,idx)=>idx!==i))} style={{ background: "none", border: "none", color: ts.color, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 0 0 2px", opacity: 0.7 }}>×</button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  {/* ── By the Glass — generates from Danube Salmon ── */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>By the Glass</div>
                    <BeverageSearch
                      wines={winesCatalog} cocktails={cocktailsCatalog} spirits={spiritsCatalog} beers={beersCatalog}
                      onAdd={({ type, item }) => {
                        if (type === "wine")     updSeat(s.id, "glasses",   [...(s.glasses   || []), item]);
                        if (type === "cocktail") updSeat(s.id, "cocktails", [...(s.cocktails || []), item]);
                        if (type === "spirit")   updSeat(s.id, "spirits",   [...(s.spirits   || []), item]);
                        if (type === "beer")     updSeat(s.id, "beers",     [...(s.beers     || []), item]);
                      }}
                    />
                    {(() => {
                      const allBevs = [
                        ...(s.glasses   || []).map((x, i) => ({ key: `g${i}`, type: "wine",     label: x?.name, sub: x?.producer, onRemove: () => updSeat(s.id, "glasses",   (s.glasses  ||[]).filter((_,idx)=>idx!==i)) })),
                        ...(s.cocktails || []).map((x, i) => ({ key: `c${i}`, type: "cocktail", label: x?.name, sub: x?.notes,    onRemove: () => updSeat(s.id, "cocktails", (s.cocktails||[]).filter((_,idx)=>idx!==i)) })),
                        ...(s.spirits   || []).map((x, i) => ({ key: `sp${i}`,type: "spirit",   label: x?.name, sub: x?.notes,    onRemove: () => updSeat(s.id, "spirits",   (s.spirits  ||[]).filter((_,idx)=>idx!==i)) })),
                        ...(s.beers     || []).map((x, i) => ({ key: `b${i}`, type: "beer",     label: x?.name, sub: x?.notes,    onRemove: () => updSeat(s.id, "beers",     (s.beers    ||[]).filter((_,idx)=>idx!==i)) })),
                      ];
                      if (allBevs.length === 0) return null;
                      return (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                          {allBevs.map(bev => {
                            const ts = BEV_TYPES[bev.type];
                            return (
                              <div key={bev.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px 4px 10px", borderRadius: 999, background: ts.bg, border: `1px solid ${ts.border}` }}>
                                <span style={{ fontFamily: FONT, fontSize: 11, color: ts.color, fontWeight: 500, whiteSpace: "nowrap" }}>{bev.label}{bev.sub ? ` · ${bev.sub}` : ""}</span>
                                <button onClick={bev.onRemove} style={{ background: "none", border: "none", color: ts.color, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 0 0 2px", opacity: 0.7 }}>×</button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                  {/* Beetroot & Cheese */}
                  {(() => {
                    const beetExtra = s.extras?.[1] || { ordered: false, pairing: "—" };
                    const hasCheese = !!s.extras?.[2]?.ordered;
                    return (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #e8f0f8" }}>
                        <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>Extras</div>
                        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                          {/* Beetroot — off + 3 pairing options */}
                          {[["off", "Beet off"], ["—", "Beet —"], ["Champagne", "Beet Champ"], ["N/A", "Beet N/A"]].map(([p, label]) => {
                            const active = p === "off"
                              ? !beetExtra.ordered
                              : beetExtra.ordered && (beetExtra.pairing || "—") === p;
                            return (
                              <button key={p} onClick={() => {
                                const newExtras = { ...s.extras };
                                if (p === "off") { newExtras[1] = { ordered: false, pairing: "—" }; }
                                else { newExtras[1] = { ordered: true, pairing: p }; }
                                updSeat(s.id, "extras", newExtras);
                              }} style={{
                                fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: "4px 10px",
                                border: `1px solid ${active ? "#c8a060" : "#e0e0e0"}`, borderRadius: 2, cursor: "pointer",
                                background: active ? "#fdf4e8" : "#fff",
                                color: active ? "#7a5020" : "#bbb",
                              }}>{label}</button>
                            );
                          })}
                          <div style={{ width: 1, height: 18, background: "#e0e0e0" }} />
                          {/* Cheese toggle */}
                          <button onClick={() => {
                            const cur = s.extras?.[2] || { ordered: false };
                            updSeat(s.id, "extras", { ...s.extras, 2: { ...cur, ordered: !cur.ordered } });
                          }} style={{
                            fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: "4px 10px",
                            border: `1px solid ${hasCheese ? "#a06830" : "#e0e0e0"}`, borderRadius: 2, cursor: "pointer",
                            background: hasCheese ? "#fdf4e8" : "#fff",
                            color: hasCheese ? "#a06830" : "#bbb",
                          }}>Cheese {hasCheese ? "✓" : ""}</button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Menu preview */}
              {previewSeatId === s.id && (
                <div style={{ borderTop: "1px solid #e0eaf4", padding: "12px 16px 14px", background: "#f7fafd" }}>
                  <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, color: "#6a9abf", textTransform: "uppercase", marginBottom: 10 }}>Preview — P{s.id}</div>
                  {(() => {
                    const containerW = 280;
                    const a5W = 559, a5H = 793;
                    const scale = containerW / a5W;
                    return (
                      <div style={{ width: containerW, height: Math.round(a5H * scale), overflow: "hidden", border: "1px solid #d0dce8", borderRadius: 2 }}>
                        <iframe
                          srcDoc={previewHtml}
                          title={`preview-p${s.id}`}
                          style={{ width: a5W, height: a5H, border: "none", transform: `scale(${scale})`, transformOrigin: "top left", pointerEvents: "none" }}
                        />
                      </div>
                    );
                  })()}
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
          <div style={{ marginTop: 16 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => printSelected(seats.map(s => s.id))} style={{
                flex: 1, fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "12px",
                border: "1px solid #1a1a1a", borderRadius: 2, cursor: "pointer",
                background: "#1a1a1a", color: "#fff",
              }}>PRINT ALL SEATS</button>
            </div>
          </div>
        )}
      </div>
    </FullModal>
  );
}

// ── Header ────────────────────────────────────────────────────────────────────
function Header({ modeLabel, showAddRes = false, showSummary = false, showMenu = false, showArchive = false, showInventory = false, showSync = false, showSeed = false, showEndService = false, syncLabel, syncLive, activeCount, reserved, seated, onExit, onMenu, onSummary, onArchive, onAddRes, onInventory, onSyncAll, onSeed, onEndService }) {
  const modeColor = modeLabel === "ADMIN" ? "#4b4b88" : modeLabel === "SERVICE" ? "#2f7a45" : "#555";
  const [sSt, setSSt] = useState(null); // null | "syncing" | "ok" | "err"
  const handleSyncAll = async () => {
    if (!onSyncAll || sSt === "syncing") return;
    setSSt("syncing");
    try {
      const r = await onSyncAll();
      console.log("[Sync]", r);
      setSSt(r?.ok ? "ok" : "err");
    } catch (e) {
      console.error("[Sync] threw:", e);
      setSSt("err");
    }
    setTimeout(() => setSSt(null), 3000);
  };
  return (
    <div style={{
      borderBottom: "1px solid #f0f0f0", padding: "10px 12px",
      display: "flex", flexDirection: "column", gap: 10,
      background: "#fff", position: "sticky", top: 0, zIndex: 50,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: 4, color: "#1a1a1a" }}>{APP_NAME}</span>
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
          {showInventory && (
            <button onClick={onInventory} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", border: "1px solid #c8d8e8", borderRadius: 999, cursor: "pointer", background: "#f0f6ff", color: "#3060a0" }}>INVENTORY</button>
          )}
          {showSeed && (
            <button onClick={onSeed} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", border: "1px solid #b0d8b0", borderRadius: 999, cursor: "pointer", background: "#f0fbf0", color: "#307030" }}>SEED TEST</button>
          )}
          {showArchive && (
            <button onClick={onArchive} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px", border: "1px solid #e8d8b8", borderRadius: 999, cursor: "pointer", background: "#fff8f0", color: "#8a6030" }}>ARCHIVE</button>
          )}
          {showSync && (
            <button onClick={handleSyncAll} disabled={sSt === "syncing"} style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 12px",
              border: `1px solid ${sSt === "ok" ? "#8fc39f" : sSt === "err" ? "#e89898" : "#c8a96e"}`,
              borderRadius: 999, cursor: sSt === "syncing" ? "not-allowed" : "pointer",
              background: sSt === "ok" ? "#eef8f1" : sSt === "err" ? "#fff0f0" : "#fffaf4",
              color: sSt === "ok" ? "#2f7a45" : sSt === "err" ? "#c04040" : "#8a6020",
              fontWeight: 600, whiteSpace: "nowrap",
            }}>
              {sSt === "syncing" ? "SYNCING…" : sSt === "ok" ? "✓ SYNCED" : sSt === "err" ? "✗ FAILED" : "↻ SYNC"}
            </button>
          )}
          <span style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px",
            border: `1px solid ${syncLive ? "#8fc39f" : "#d8d8d8"}`,
            borderRadius: 999,
            background: syncLive ? "#eef8f1" : "#f6f6f6",
            color: syncLive ? "#2f7a45" : "#555",
            fontWeight: 600, whiteSpace: "nowrap",
          }}>{syncLabel}</span>
          {showEndService && (
            <button onClick={onEndService} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 12px", border: "1px solid #c04040", borderRadius: 999, cursor: "pointer", background: "#fff0f0", color: "#c04040", fontWeight: 600, flexShrink: 0 }}>END SERVICE</button>
          )}
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

  const copyText = () => {
    const lines = [];
    active.forEach(t => {
      lines.push(`TABLE ${String(t.id).padStart(2,"0")}${t.resName ? " · " + t.resName : ""}${t.arrivedAt ? " [arr. " + t.arrivedAt + "]" : ""}`);
      if (t.menuType) lines.push(`  Menu: ${t.menuType}`);
      t.seats.forEach(s => {
        const parts = [`P${s.id}`];
        if (s.water && s.water !== "—") parts.push(`water:${s.water}`);
        if (s.pairing) parts.push(s.pairing);
        const ap = (s.aperitifs || []).map(x => x?.name).filter(Boolean);
        const gs = (s.glasses   || []).map(w => w?.name).filter(Boolean);
        const cs = (s.cocktails || []).map(c => c?.name).filter(Boolean);
        const sp = (s.spirits   || []).map(x => x?.name).filter(Boolean);
        const bs = (s.beers     || []).map(x => x?.name).filter(Boolean);
        if (ap.length) parts.push("aperitif:" + ap.join(","));
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
                  ...(s.aperitifs || []).filter(Boolean).map(x => ({ label: x.name, ts: BEV_TYPES.aperitif })),
                  ...(s.glasses   || []).filter(Boolean).map(x => ({ label: x.name, ts: BEV_TYPES.wine })),
                  ...(s.cocktails || []).filter(Boolean).map(x => ({ label: x.name, ts: BEV_TYPES.cocktail })),
                  ...(s.spirits   || []).filter(Boolean).map(x => ({ label: x.name, ts: BEV_TYPES.spirit })),
                  ...(s.beers     || []).filter(Boolean).map(x => ({ label: x.name, ts: BEV_TYPES.beer })),
                ];
                return (
                  <div key={s.id} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", padding: "8px 4px", borderBottom: "1px solid #f5f5f5" }}>
                    <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 600, color: restr.length ? "#b04040" : "#999", minWidth: 28, letterSpacing: 0.5 }}>P{s.id}</span>
                    {s.water !== "—" && <span style={{ fontFamily: FONT, fontSize: 10, padding: "2px 8px", borderRadius: 2, background: ws.bg || "#f5f5f5", color: "#333", border: "1px solid #e0e0e0" }}>{s.water}</span>}
                    {s.pairing && <span style={{ fontFamily: FONT, fontSize: 10, padding: "2px 8px", borderRadius: 2, border: "1px solid #e0e0e0", color: PAIRING_COLOR[s.pairing] || "#555", background: PAIRING_BG[s.pairing] || "#fafafa" }}>{s.pairing}</span>}
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
function ArchiveModal({ tables, dishes, onArchiveAndClear, onClearAll, onSeedTest, onClose, onRestoreTicket, menuCourses }) {
  const [entries, setEntries]         = useState([]);
  const [deleted, setDeleted]         = useState([]);
  const [loading, setLoading]         = useState(true);
  const [expanded, setExpanded]       = useState(null);
  const [deleting, setDeleting]       = useState(null);
  const [showTrash, setShowTrash]     = useState(false);

  const loadEntries = () => {
    if (!supabase) { setLoading(false); return; }
    setLoading(true);
    Promise.all([
      supabase.from("service_archive").select("*").is("deleted_at", null).order("created_at", { ascending: false }).limit(60),
      supabase.from("service_archive").select("*").not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(30),
    ]).then(([active, trash]) => {
      setEntries(active.error ? [] : (active.data || []));
      setDeleted(trash.error ? [] : (trash.data || []));
      setLoading(false);
    });
  };
  useEffect(loadEntries, []);

  const deleteEntry = async id => {
    if (!supabase) return;
    setDeleting(id);
    const { error } = await supabase.from("service_archive").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      alert("Delete failed: " + error.message + "\n\nYou may need to enable UPDATE on the service_archive table in Supabase (Policies → anon → UPDATE).");
    } else {
      const entry = entries.find(x => x.id === id);
      setEntries(e => e.filter(x => x.id !== id));
      if (entry) setDeleted(d => [{ ...entry, deleted_at: new Date().toISOString() }, ...d]);
      if (expanded === id) setExpanded(null);
    }
    setDeleting(null);
  };

  const deleteAll = async () => {
    if (!supabase) return;
    if (!window.confirm("Move ALL archive entries to trash? You can restore them from Recently Deleted.")) return;
    setDeleting("all");
    const now = new Date().toISOString();
    const { error } = await supabase.from("service_archive").update({ deleted_at: now }).is("deleted_at", null);
    if (error) {
      alert("Delete failed: " + error.message + "\n\nYou may need to enable UPDATE on the service_archive table in Supabase (Policies → anon → UPDATE).");
    } else {
      setDeleted(d => [...entries.map(e => ({ ...e, deleted_at: now })), ...d]);
      setEntries([]);
      setExpanded(null);
    }
    setDeleting(null);
  };

  const restoreEntry = async id => {
    if (!supabase) return;
    setDeleting(id);
    const { error } = await supabase.from("service_archive").update({ deleted_at: null }).eq("id", id);
    if (error) {
      alert("Restore failed: " + error.message);
    } else {
      const entry = deleted.find(x => x.id === id);
      setDeleted(d => d.filter(x => x.id !== id));
      if (entry) setEntries(e => [{ ...entry, deleted_at: null }, ...e].sort((a, b) => b.created_at.localeCompare(a.created_at)));
    }
    setDeleting(null);
  };

  const emptyTrash = async () => {
    if (!supabase) return;
    if (!window.confirm("Permanently delete all trashed entries? This cannot be undone.")) return;
    setDeleting("trash");
    const { error } = await supabase.from("service_archive").delete().not("deleted_at", "is", null);
    if (error) {
      alert("Empty trash failed: " + error.message);
    } else {
      setDeleted([]);
    }
    setDeleting(null);
  };

  const activeTables = tables.filter(t => t.active || t.arrivedAt || t.resName || t.resTime);

  const archiveActions = (
    <div style={{ display: "flex", gap: 8 }}>
      <button onClick={onSeedTest} style={{
        fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "8px 14px",
        border: "1px solid #b0d8b0", borderRadius: 2, cursor: "pointer", background: "#f0fbf0", color: "#307030",
      }}>SEED TEST</button>
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
                    {/* Expanded: KitchenTicket + service data */}
                    {isOpen && (
                      <div style={{ borderTop: "1px solid #d8edd8", padding: "12px 14px", background: "#fff" }}>
                        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                          {/* Left: full kitchen ticket as shown on display */}
                          <div style={{ width: 248, flexShrink: 0 }}>
                            <KitchenTicket table={t} menuCourses={menuCourses} upd={null} />
                          </div>
                          {/* Right: service selections — bottles, per-seat beverages & pairings */}
                          <div style={{ flex: 1, minWidth: 220 }}>
                            {(t.bottleWines || []).length > 0 && (
                              <div style={{ marginBottom: 12 }}>
                                <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>Bottles</div>
                                {(t.bottleWines || []).map((w, wi) => {
                                  const rawVintage = String(w?.vintage || "").trim();
                                  const vintage = rawVintage.match(/^\d{4}$/) ? `'${rawVintage.slice(2)}` : rawVintage;
                                  const title = [w?.producer, w?.name, vintage].filter(Boolean).join(" ");
                                  const rawCountry = w?.country || "";
                                  const country = COUNTRY_NAMES[rawCountry] || rawCountry;
                                  const region = (w?.region || "").replace(new RegExp(`,?\\s*${rawCountry}$`), "").trim();
                                  const sub = [region, country].filter(Boolean).join(", ") || w?.notes || "";
                                  return (
                                    <div key={wi} style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 4 }}>
                                      <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: "#1a1a1a", letterSpacing: 0.3 }}>🍾 {title}</span>
                                      {sub && <span style={{ fontFamily: FONT, fontSize: 11, color: "#5a8fc4" }}>{sub}</span>}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>Seats</div>
                            {(t.seats || []).map(s => {
                              const ws = waterStyle(s.water);
                              const restr = (t.restrictions || []).filter(r => r.pos === s.id);
                              const extra = (dishes || []).filter(d => s.extras?.[d.id]?.ordered);
                              const bevs = [
                                ...(s.aperitifs || []).filter(Boolean).map(x => ({ label: x.name, ts: BEV_TYPES.aperitif })),
                                ...(s.glasses   || []).filter(Boolean).map(x => ({ label: x.name, ts: BEV_TYPES.wine })),
                                ...(s.cocktails || []).filter(Boolean).map(x => ({ label: x.name, ts: BEV_TYPES.cocktail })),
                                ...(s.spirits   || []).filter(Boolean).map(x => ({ label: x.name, ts: BEV_TYPES.spirit })),
                                ...(s.beers     || []).filter(Boolean).map(x => ({ label: x.name, ts: BEV_TYPES.beer })),
                              ];
                              return (
                                <div key={s.id} style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", padding: "5px 4px", borderBottom: "1px solid #f5f5f5" }}>
                                  <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 600, color: "#999", minWidth: 26 }}>P{s.id}</span>
                                  {s.water !== "—" && <span style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 2, background: ws.bg || "#f0f0f0", color: "#444", border: "1px solid #e0e0e0" }}>{s.water}</span>}
                                  {s.pairing && <span style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 2, color: PAIRING_COLOR[s.pairing] || "#555", background: PAIRING_BG[s.pairing] || "#fafafa", border: "1px solid #e0e0e0" }}>{s.pairing}</span>}
                                  {bevs.map((b, bi) => <span key={bi} style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 2, border: `1px solid ${b.ts.border}`, color: b.ts.color, background: b.ts.bg }}>{b.label}</span>)}
                                  {extra.map(d => <span key={d.id} style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 2, border: "1px solid #88cc88", color: "#2a6a2a", background: "#e8f5e8" }}>{d.name}</span>)}
                                  {restr.map((r, ri) => <span key={ri} style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 2, border: "1px solid #e09090", color: "#b04040", background: "#fef0f0" }}>⚠ {restrLabel(r.note)}</span>)}
                                </div>
                              );
                            })}
                          </div>
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
            }}>{deleting === "all" ? "MOVING TO TRASH…" : "DELETE ALL"}</button>
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
                      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
                        {/* Left: full kitchen ticket as shown on display */}
                        <div style={{ width: 248, flexShrink: 0 }}>
                          <KitchenTicket table={t} menuCourses={entry.state?.menuCourses || []} upd={null} />
                        </div>
                        {/* Right: service selections — bottles, per-seat beverages & pairings */}
                        <div style={{ flex: 1, minWidth: 220 }}>
                          {(t.bottleWines || []).length > 0 && (
                            <div style={{ marginBottom: 12 }}>
                              <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>Bottles</div>
                              {(t.bottleWines || []).map((w, wi) => {
                                const rawVintage = String(w?.vintage || "").trim();
                                const vintage = rawVintage.match(/^\d{4}$/) ? `'${rawVintage.slice(2)}` : rawVintage;
                                const title = [w?.producer, w?.name, vintage].filter(Boolean).join(" ");
                                const rawCountry = w?.country || "";
                                const country = COUNTRY_NAMES[rawCountry] || rawCountry;
                                const region = (w?.region || "").replace(new RegExp(`,?\\s*${rawCountry}$`), "").trim();
                                const sub = [region, country].filter(Boolean).join(", ") || w?.notes || "";
                                return (
                                  <div key={wi} style={{ display: "flex", flexDirection: "column", gap: 1, marginBottom: 4 }}>
                                    <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: "#1a1a1a", letterSpacing: 0.3 }}>🍾 {title}</span>
                                    {sub && <span style={{ fontFamily: FONT, fontSize: 11, color: "#5a8fc4" }}>{sub}</span>}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 6 }}>Seats</div>
                          {(t.seats || []).map(s => {
                            const ws    = waterStyle(s.water);
                            const restr = (t.restrictions || []).filter(r => r.pos === s.id);
                            const extra = (entry.state?.dishes || dishes).filter(d => s.extras?.[d.id]?.ordered);
                            const bevs  = [
                              ...(s.aperitifs || []).filter(Boolean).map(x => ({ label: x.name, ts: BEV_TYPES.aperitif })),
                              ...(s.glasses   || []).filter(Boolean).map(x => ({ label: x.name, ts: BEV_TYPES.wine })),
                              ...(s.cocktails || []).filter(Boolean).map(x => ({ label: x.name, ts: BEV_TYPES.cocktail })),
                              ...(s.spirits   || []).filter(Boolean).map(x => ({ label: x.name, ts: BEV_TYPES.spirit })),
                              ...(s.beers     || []).filter(Boolean).map(x => ({ label: x.name, ts: BEV_TYPES.beer })),
                            ];
                            return (
                              <div key={s.id} style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center", padding: "5px 4px", borderBottom: "1px solid #fafafa" }}>
                                <span style={{ fontFamily: FONT, fontSize: 10, fontWeight: 600, color: "#999", minWidth: 26 }}>P{s.id}</span>
                                {s.water !== "—" && <span style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 2, background: ws.bg || "#f0f0f0", color: "#444", border: "1px solid #e0e0e0" }}>{s.water}</span>}
                                {s.pairing && <span style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 2, color: PAIRING_COLOR[s.pairing] || "#555", background: PAIRING_BG[s.pairing] || "#fafafa", border: "1px solid #e0e0e0" }}>{s.pairing}</span>}
                                {bevs.map((b, bi) => <span key={bi} style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 2, border: `1px solid ${b.ts.border}`, color: b.ts.color, background: b.ts.bg }}>{b.label}</span>)}
                                {extra.map(d => <span key={d.id} style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 2, border: "1px solid #88cc88", color: "#2a6a2a", background: "#e8f5e8" }}>{d.name}</span>)}
                                {restr.map((r, ri) => <span key={ri} style={{ fontFamily: FONT, fontSize: 10, padding: "1px 7px", borderRadius: 2, border: "1px solid #e09090", color: "#b04040", background: "#fef0f0" }}>⚠ {restrLabel(r.note)}</span>)}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* ── Recently Deleted (trash) ── */}
        {deleted.length > 0 && (
          <div style={{ marginTop: 32 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <button
                onClick={() => setShowTrash(v => !v)}
                style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 3, color: "#bbb", background: "none", border: "none", cursor: "pointer", padding: 0, textTransform: "uppercase" }}
              >
                Recently Deleted ({deleted.length}) {showTrash ? "▲" : "▼"}
              </button>
              {showTrash && (
                <button onClick={emptyTrash} disabled={deleting === "trash"} style={{
                  fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "4px 12px",
                  border: "1px solid #ffcccc", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#e07070",
                  opacity: deleting === "trash" ? 0.5 : 1,
                }}>{deleting === "trash" ? "DELETING…" : "EMPTY TRASH"}</button>
              )}
            </div>
            {showTrash && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {deleted.map(entry => {
                  const entryTables = entry.state?.tables || [];
                  const totalGuests = entryTables.reduce((a, t) => a + (t.guests || 0), 0);
                  const deletedDate = entry.deleted_at ? new Date(entry.deleted_at).toLocaleDateString() : "";
                  return (
                    <div key={entry.id} style={{ border: "1px solid #f5f0f0", borderRadius: 4, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fdf8f8", opacity: 0.8 }}>
                      <div>
                        <div style={{ fontFamily: FONT, fontSize: 12, fontWeight: 500, color: "#888" }}>{entry.label}</div>
                        <div style={{ fontFamily: FONT, fontSize: 9, color: "#bbb", marginTop: 2 }}>{entryTables.length} tables · {totalGuests} guests · deleted {deletedDate}</div>
                      </div>
                      <button onClick={() => restoreEntry(entry.id)} disabled={deleting === entry.id} style={{
                        fontFamily: FONT, fontSize: 9, letterSpacing: 1.5, padding: "4px 12px",
                        border: "1px solid #b8d8c8", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#4a9a6a",
                        opacity: deleting === entry.id ? 0.5 : 1,
                      }}>{deleting === entry.id ? "…" : "RESTORE"}</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </FullModal>
  );
}

// ── Inventory Modal ───────────────────────────────────────────────────────────
const INV_LS_KEY      = "milka-inventory-counts";
const INV_SETTINGS_ID = "inventory";

// Stable per-browser device ID (persists across reloads, not across tabs)
const getDeviceId = () => {
  const KEY = "milka-inv-did";
  let id = localStorage.getItem(KEY);
  if (!id) { id = Math.random().toString(36).slice(2, 10); localStorage.setItem(KEY, id); }
  return id;
};

// Supabase state shape: { d: { [deviceId]: { label: "Device 1", counts: { [wineId]: number } } } }

function InventoryModal({ wines, onClose }) {
  const myId    = useRef(getDeviceId());
  const stRef   = useRef(null);   // latest fullState ref for debounce callbacks
  const saveTimer = useRef(null);

  const [syncSt, setSyncSt] = useState("loading");
  const [search, setSearch] = useState("");

  // fullState holds all devices' data
  const [fullState, setFullState] = useState(() => {
    let myCountsLS = {};
    try { myCountsLS = JSON.parse(localStorage.getItem(INV_LS_KEY) || "{}"); } catch {}
    const initial = { d: { [myId.current]: { label: "…", counts: myCountsLS } } };
    stRef.current = initial;
    return initial;
  });

  const myCounts   = fullState.d[myId.current]?.counts || {};
  const allDevices = fullState.d || {};

  // Merged display counts: other devices fill in, mine wins on overlap
  const displayCounts = {};
  Object.entries(allDevices).forEach(([did, dev]) => {
    if (did !== myId.current)
      Object.entries(dev.counts || {}).forEach(([wid, n]) => { if (n > 0) displayCounts[wid] = n; });
  });
  Object.entries(myCounts).forEach(([wid, n]) => { if (n > 0) displayCounts[wid] = n; });

  // Format count: 3 → "3", 3.5 → "3½"
  const fmtCount = n => n % 1 >= 0.5 ? `${Math.floor(n)}½` : String(Math.floor(n));

  // Per-device totals (for footer)
  const deviceTotals = Object.entries(allDevices)
    .map(([did, dev]) => ({
      id: did,
      label: dev.label || did,
      total: Object.values(dev.counts || {}).reduce((s, n) => s + (n || 0), 0),
      isMe: did === myId.current,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const grandTotal = Object.values(displayCounts).reduce((s, n) => s + n, 0);

  // Save to Supabase (called inside debounce)
  const flushToSupabase = async (state) => {
    if (!supabase || !navigator.onLine) { setSyncSt("offline"); return; }
    const { error } = await supabase.from("service_settings").upsert(
      { id: INV_SETTINGS_ID, state, updated_at: new Date().toISOString() },
      { onConflict: "id" }
    );
    setSyncSt(error ? "error" : "synced");
  };

  // Apply update to MY counts
  const applyUpdate = (updater) => {
    setFullState(prev => {
      const prevMy = prev.d[myId.current]?.counts || {};
      const nextMy = typeof updater === "function" ? updater(prevMy) : updater;
      try { localStorage.setItem(INV_LS_KEY, JSON.stringify(nextMy)); } catch {}
      const next = { d: { ...prev.d, [myId.current]: { ...prev.d[myId.current], counts: nextMy } } };
      stRef.current = next;
      if (supabase) {
        clearTimeout(saveTimer.current);
        setSyncSt(st => st === "offline" ? "offline" : "saving");
        saveTimer.current = setTimeout(() => flushToSupabase(stRef.current), 1500);
      }
      return next;
    });
  };

  const inc      = id => applyUpdate(c => {
    const cur = c[id] || 0; const half = cur % 1 >= 0.5 ? 0.5 : 0;
    return { ...c, [id]: Math.floor(cur) + 1 + half };
  });
  const dec      = id => applyUpdate(c => {
    const cur = c[id] || 0; const half = cur % 1 >= 0.5 ? 0.5 : 0;
    return { ...c, [id]: Math.max(0, Math.floor(cur) - 1) + half };
  });
  const setCount = (id, val) => {
    const n = parseInt(val, 10);
    applyUpdate(c => {
      const half = (c[id] || 0) % 1 >= 0.5 ? 0.5 : 0;
      return { ...c, [id]: isNaN(n) || n < 0 ? 0 + half : n + half };
    });
  };
  const togglePartial = id => applyUpdate(c => {
    const cur = c[id] || 0;
    return { ...c, [id]: cur % 1 >= 0.5 ? Math.floor(cur) : cur + 0.5 };
  });
  const clearAll = () => {
    if (window.confirm("Clear YOUR counts on this device? Other devices are not affected.")) applyUpdate({});
  };

  // Load from Supabase on mount
  useEffect(() => {
    if (!supabase) { setSyncSt(navigator.onLine ? "synced" : "offline"); return; }
    supabase.from("service_settings").select("state").eq("id", INV_SETTINGS_ID).single()
      .then(({ data, error }) => {
        const remoteD = (!error && data?.state?.d) ? data.state.d : {};
        // Assign my label: Device N based on position in the remote map
        const myRemote   = remoteD[myId.current];
        const myLabel    = myRemote?.label || `Device ${Object.keys(remoteD).length + 1}`;
        // Merge: local non-zero wins (user may have counted offline before opening)
        const myLocalCounts = (() => { try { return JSON.parse(localStorage.getItem(INV_LS_KEY) || "{}"); } catch { return {}; } })();
        const baseCounts    = myRemote?.counts || {};
        const mergedMyCounts = { ...baseCounts };
        Object.entries(myLocalCounts).forEach(([id, n]) => { if (n > 0) mergedMyCounts[id] = n; });
        const fullD = { ...remoteD, [myId.current]: { label: myLabel, counts: mergedMyCounts } };
        const next  = { d: fullD };
        stRef.current = next;
        setFullState(next);
        try { localStorage.setItem(INV_LS_KEY, JSON.stringify(mergedMyCounts)); } catch {}
        // Push merged data back if we're the new device or had local changes
        if (!myRemote?.label || Object.keys(myLocalCounts).length > 0) flushToSupabase(next);
        setSyncSt(navigator.onLine ? "synced" : "offline");
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Online / offline — flush pending save on reconnect
  useEffect(() => {
    const goOnline = () => {
      setSyncSt("saving");
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => flushToSupabase(stRef.current), 500);
    };
    const goOffline = () => { clearTimeout(saveTimer.current); setSyncSt("offline"); };
    window.addEventListener("online",  goOnline);
    window.addEventListener("offline", goOffline);
    return () => { window.removeEventListener("online", goOnline); window.removeEventListener("offline", goOffline); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime: receive other devices' changes
  useEffect(() => {
    if (!supabase) return;
    const ch = supabase.channel("milka-inventory")
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "service_settings",
        filter: `id=eq.${INV_SETTINGS_ID}`,
      }, payload => {
        const remoteD = payload.new?.state?.d;
        if (!remoteD) return;
        setFullState(prev => {
          // Keep my own device data, update everyone else's
          const merged = { ...remoteD, [myId.current]: prev.d[myId.current] };
          return { d: merged };
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const q = search.trim().toLowerCase();
  const filtered = q
    ? wines.filter(w =>
        (w.name     || "").toLowerCase().includes(q) ||
        (w.producer || "").toLowerCase().includes(q) ||
        (w.vintage  || "").toLowerCase().includes(q)
      )
    : wines;

  const syncChip = (() => {
    if (syncSt === "loading")  return { label: "LOADING…",       color: "#aaa",    bg: "#f8f8f8", border: "#e8e8e8" };
    if (syncSt === "saving")   return { label: "SAVING…",        color: "#a07020", bg: "#fffbe8", border: "#e8d888" };
    if (syncSt === "offline")  return { label: "OFFLINE · SAVED",color: "#c06020", bg: "#fff4ee", border: "#e8c8a8" };
    if (syncSt === "error")    return { label: "SYNC ERROR",     color: "#c02020", bg: "#fff0f0", border: "#e8a8a8" };
    return                            { label: "SYNCED",          color: "#2f7a45", bg: "#eef8f1", border: "#8fc39f" };
  })();

  const handlePrint = () => {
    const byCountry = {};
    wines.forEach(w => {
      const country = COUNTRY_NAMES[w.country] || w.country || "Other";
      if (!byCountry[country]) byCountry[country] = [];
      byCountry[country].push(w);
    });
    const dateStr = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const deviceSummary = deviceTotals.map(d => `${d.label}: ${fmtCount(d.total)}`).join(" · ");

    const rows = ws => ws.map(w => {
      const n      = displayCounts[w.id] || 0;
      const rawVin = String(w.vintage || "").trim();
      const vin    = rawVin.match(/^\d{4}$/) ? `'${rawVin.slice(2)}` : rawVin;
      const sub    = [w.region, COUNTRY_NAMES[w.country] || w.country].filter(Boolean).join(", ");
      return `<tr>
        <td style="padding:5px 4px;border-bottom:1px solid #f0f0f0;vertical-align:top;">
          <div style="font-weight:600;">${w.producer} ${w.name} <span style="font-weight:400;color:#888;">${vin}</span></div>
          ${sub ? `<div style="font-size:9px;color:#aaa;margin-top:1px;">${sub}</div>` : ""}
        </td>
        <td style="padding:5px 4px;border-bottom:1px solid #f0f0f0;text-align:right;font-size:15px;font-weight:700;color:${n > 0 ? "#1a1a1a" : "#ddd"};white-space:nowrap;width:48px;">${fmtCount(n)}</td>
      </tr>`;
    }).join("");

    const sections = Object.entries(byCountry)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([country, ws]) => `
        <div style="margin-bottom:20px;">
          <div style="font-size:9px;letter-spacing:3px;color:#888;text-transform:uppercase;border-bottom:1px solid #e0e0e0;padding-bottom:4px;margin-bottom:6px;">${country}</div>
          <table style="width:100%;border-collapse:collapse;">${rows(ws)}</table>
        </div>`).join("");

    const html = `<html><head><title>Wine Inventory · ${dateStr}</title>
      <style>body{font-family:'Roboto Mono',monospace;font-size:11px;padding:24px;color:#1a1a1a;}@media print{body{padding:12px;}}</style>
      </head><body>
        <div style="font-size:14px;font-weight:600;letter-spacing:4px;margin-bottom:4px;">WINE INVENTORY</div>
        <div style="font-size:9px;letter-spacing:2px;color:#888;margin-bottom:4px;">${dateStr}</div>
        ${deviceTotals.length > 1 ? `<div style="font-size:9px;color:#888;margin-bottom:20px;">${deviceSummary} · TOTAL: ${fmtCount(grandTotal)}</div>` : `<div style="font-size:9px;color:#888;margin-bottom:20px;">Total: ${fmtCount(grandTotal)} bottles</div>`}
        ${sections}
        <div style="font-size:11px;font-weight:700;text-align:right;padding-top:12px;border-top:1px solid #e0e0e0;">TOTAL: ${fmtCount(grandTotal)} bottles</div>
      </body></html>`;

    const w = window.open("", "_blank");
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 500);
  };

  const actions = (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <span style={{
        fontFamily: FONT, fontSize: 8, letterSpacing: 1.5, padding: "4px 10px",
        border: `1px solid ${syncChip.border}`, borderRadius: 999,
        background: syncChip.bg, color: syncChip.color, whiteSpace: "nowrap",
      }}>{syncChip.label}</span>
      <button onClick={clearAll} style={{
        fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 12px",
        border: "1px solid #e8e8e8", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#888",
      }}>CLEAR ALL</button>
      <button onClick={handlePrint} style={{
        fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 14px",
        border: "1px solid #3060a0", borderRadius: 2, cursor: "pointer", background: "#f0f6ff", color: "#3060a0",
      }}>PRINT</button>
    </div>
  );

  return (
    <FullModal title="Wine Inventory" onClose={onClose} actions={actions}>
      <div style={{ maxWidth: 700, margin: "0 auto" }}>

        {/* Search */}
        <div style={{ marginBottom: 16 }}>
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search wine, producer, vintage…"
            style={{ ...baseInp, width: "100%", fontSize: 16, boxSizing: "border-box" }}
          />
        </div>

        {/* Wine rows — input controls MY count; other devices' count shown as badge */}
        {filtered.length === 0 && (
          <div style={{ fontFamily: FONT, fontSize: 11, color: "#bbb", padding: "40px 0", textAlign: "center" }}>No wines found</div>
        )}
        {filtered.map(w => {
          const myCount   = myCounts[w.id] || 0;
          const fullBtls  = Math.floor(myCount);
          const isPartial = myCount % 1 >= 0.5;
          const rawVin    = String(w.vintage || "").trim();
          const vin       = rawVin.match(/^\d{4}$/) ? `'${rawVin.slice(2)}` : rawVin;
          const sub       = [w.region, COUNTRY_NAMES[w.country] || w.country].filter(Boolean).join(", ");
          const othersRaw = Object.entries(allDevices)
            .filter(([did]) => did !== myId.current)
            .reduce((s, [, dev]) => s + (dev.counts?.[w.id] || 0), 0);
          const othersLabel = othersRaw > 0
            ? (othersRaw % 1 >= 0.5 ? `${Math.floor(othersRaw)}½` : String(othersRaw))
            : null;
          return (
            <div key={w.id} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "10px 4px", borderBottom: "1px solid #f5f5f5",
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT, fontSize: 12, fontWeight: 600, color: "#1a1a1a" }}>
                  {w.producer}{" "}
                  <span style={{ fontWeight: 400 }}>{w.name}</span>
                  <span style={{ color: "#aaa", marginLeft: 6, fontSize: 11 }}>{vin}</span>
                </div>
                {sub && <div style={{ fontFamily: FONT, fontSize: 9, color: "#bbb", marginTop: 2 }}>{sub}</div>}
              </div>
              {/* Other device count badge */}
              {othersLabel && (
                <span style={{
                  fontFamily: FONT, fontSize: 9, color: "#4a80c0", background: "#eaf0fc",
                  border: "1px solid #c8d8f0", borderRadius: 3, padding: "2px 7px", flexShrink: 0,
                }}>{othersLabel}</span>
              )}
              {/* My counter */}
              <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                <button onClick={() => dec(w.id)} style={{
                  fontFamily: FONT, fontSize: 18, width: 38, height: 38,
                  border: "1px solid #e8e8e8", borderRadius: "2px 0 0 2px", borderRight: "none",
                  cursor: "pointer", background: "#fff", color: "#888",
                  display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
                }}>−</button>
                <input
                  type="number" min={0}
                  value={fullBtls === 0 ? "" : fullBtls}
                  onChange={e => setCount(w.id, e.target.value)}
                  placeholder="0"
                  style={{
                    fontFamily: FONT, fontSize: 14, width: 46, height: 38,
                    border: "1px solid #e8e8e8", outline: "none", textAlign: "center",
                    color: myCount > 0 ? "#1a1a1a" : "#ccc", fontWeight: myCount > 0 ? 700 : 400,
                    boxSizing: "border-box", WebkitAppearance: "none", MozAppearance: "textfield",
                  }}
                />
                <button onClick={() => inc(w.id)} style={{
                  fontFamily: FONT, fontSize: 18, width: 38, height: 38,
                  border: "1px solid #3060a0", borderRight: "none",
                  cursor: "pointer", background: "#f0f6ff", color: "#3060a0",
                  display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
                }}>+</button>
                <button onClick={() => togglePartial(w.id)} style={{
                  fontFamily: FONT, fontSize: 10, width: 32, height: 38,
                  border: isPartial ? "1px solid #e07840" : "1px solid #e8e8e8",
                  borderRadius: "0 2px 2px 0", borderLeft: "none",
                  cursor: "pointer",
                  background: isPartial ? "#fff4ee" : "#fafafa",
                  color: isPartial ? "#e07840" : "#ccc",
                  display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
                }}>½</button>
              </div>
            </div>
          );
        })}

        {/* Device totals footer */}
        {wines.length > 0 && (
          <div style={{ padding: "16px 4px 0", borderTop: "1px solid #f0f0f0", marginTop: 8 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
              {deviceTotals.map(d => (
                <span key={d.id} style={{
                  fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "3px 10px",
                  borderRadius: 999, border: d.isMe ? "1px solid #3060a0" : "1px solid #e0e0e0",
                  background: d.isMe ? "#f0f6ff" : "#f8f8f8",
                  color: d.isMe ? "#3060a0" : "#888",
                }}>
                  {d.label}{d.isMe ? " (you)" : ""}: {fmtCount(d.total)}
                </span>
              ))}
              <span style={{
                fontFamily: FONT, fontSize: 10, fontWeight: 700, color: "#1a1a1a",
                padding: "3px 10px", borderRadius: 999, border: "1px solid #1a1a1a", background: "#fff",
              }}>TOTAL: {fmtCount(grandTotal)}</span>
            </div>
          </div>
        )}
      </div>
    </FullModal>
  );
}

// ── Access gate constants ─────────────────────────────────────────────────────
const PINS = {
  admin: String(import.meta.env.VITE_PIN_ADMIN || "").trim(),
  menu: String(import.meta.env.VITE_PIN_MENU || "").trim(),
};
const ACCESS_PASSWORD = String(import.meta.env.VITE_ACCESS_PASSWORD || "").trim();
const ACCESS_KEY      = "milka_access";
const ACCESS_TTL_MS   = 12 * 60 * 60 * 1000; // 12 hours

const readAccess = () => {
  if (!ACCESS_PASSWORD) return true;
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

// ── ServiceDatePicker ─────────────────────────────────────────────────────────
function ServiceDatePicker({ defaultDate, onConfirm, onCancel, reservations = [] }) {
  const todayStr = toLocalDateISO();
  const [selected, setSelected] = useState(defaultDate || todayStr);
  // weekOffset: 0 = current week, -1 = last week, +1 = next week
  const [weekOffset, setWeekOffset] = useState(0);

  // Build week array (Mon–Sun) for the given offset
  const weekDays = useMemo(() => {
    const today = new Date();
    // Monday of current week
    const dow = today.getDay(); // 0=Sun
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((dow + 6) % 7) + weekOffset * 7);
    monday.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return toLocalDateISO(d);
    });
  }, [weekOffset]);

  const monthLabel = useMemo(() => {
    const d = new Date(weekDays[0] + "T00:00:00");
    const d2 = new Date(weekDays[6] + "T00:00:00");
    const m1 = d.toLocaleDateString("en-GB", { month: "long" }).toUpperCase();
    const m2 = d2.toLocaleDateString("en-GB", { month: "long" }).toUpperCase();
    const y = d2.getFullYear();
    return m1 === m2 ? `${m1} ${y}` : `${m1} / ${m2} ${y}`;
  }, [weekDays]);

  const DAY_LABELS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: FONT, zIndex: 200, padding: 16,
    }}>
      <GlobalStyle />
      <div style={{
        width: "100%", maxWidth: 420, background: "#fff",
        borderRadius: 12, overflow: "hidden",
        boxShadow: "0 12px 60px rgba(0,0,0,0.18)",
      }}>
        {/* Header */}
        <div style={{ background: "#1a1a1a", padding: "20px 20px 16px", textAlign: "center" }}>
          <div style={{ fontSize: 9, letterSpacing: 4, color: "rgba(255,255,255,0.5)", marginBottom: 4 }}>{APP_NAME}</div>
          <div style={{ fontSize: 13, letterSpacing: 3, color: "#fff", fontWeight: 700 }}>SELECT SERVICE DATE</div>
        </div>

        {/* Week navigator */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px 10px" }}>
          <button
            onClick={() => setWeekOffset(o => o - 1)}
            style={{ fontFamily: FONT, fontSize: 16, border: "none", background: "none", cursor: "pointer", color: "#555", padding: "4px 10px", lineHeight: 1 }}
          >‹</button>
          <span style={{ fontSize: 9, letterSpacing: 3, color: "#888", fontWeight: 600 }}>{monthLabel}</span>
          <button
            onClick={() => setWeekOffset(o => o + 1)}
            style={{ fontFamily: FONT, fontSize: 16, border: "none", background: "none", cursor: "pointer", color: "#555", padding: "4px 10px", lineHeight: 1 }}
          >›</button>
        </div>

        {/* Day tiles */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6, padding: "0 14px 20px" }}>
          {weekDays.map((dateStr, i) => {
            const d = new Date(dateStr + "T00:00:00");
            const dayNum = d.getDate();
            const isToday = dateStr === todayStr;
            const isSel = dateStr === selected;
            const isPast = dateStr < todayStr;
            const dayResv = reservations.filter(r => r.date === dateStr);
            return (
              <button
                key={dateStr}
                onClick={() => setSelected(dateStr)}
                style={{
                  fontFamily: FONT, border: "none", borderRadius: 8, cursor: "pointer",
                  padding: "10px 0", display: "flex", flexDirection: "column",
                  alignItems: "center", gap: 4, transition: "all 0.12s",
                  background: isSel ? "#1a1a1a" : isToday ? "#f0f8f4" : "#f6f6f6",
                  outline: isToday && !isSel ? "1.5px solid #3a8a5a" : "none",
                  opacity: isPast && !isSel ? 0.45 : 1,
                }}
              >
                <span style={{ fontSize: 8, letterSpacing: 1, color: isSel ? "rgba(255,255,255,0.6)" : "#aaa", fontWeight: 600 }}>{DAY_LABELS[i]}</span>
                <span style={{ fontSize: 16, fontWeight: 700, color: isSel ? "#fff" : isToday ? "#2f7a45" : "#1a1a1a", lineHeight: 1 }}>{dayNum}</span>
                {isToday && <span style={{ width: 4, height: 4, borderRadius: "50%", background: isSel ? "#fff" : "#3a8a5a" }} />}
                {dayResv.length > 0 && <span style={{ width: 4, height: 4, borderRadius: "50%", background: isSel ? "rgba(255,255,255,0.4)" : "#bbb", marginTop: 2 }} />}
              </button>
            );
          })}
        </div>

        {/* Selected date confirmation */}
        {selected && (() => {
          const selResv = reservations.filter(r => r.date === selected);
          const selGuests = selResv.reduce((a, r) => a + (r.data?.guests || 2), 0);
          return (
            <div style={{ textAlign: "center", paddingBottom: 6 }}>
              <span style={{ fontSize: 10, letterSpacing: 2, color: "#3a8a5a", fontWeight: 600 }}>
                {new Date(selected + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }).toUpperCase()}
              </span>
              {selResv.length > 0 && (
                <div style={{ fontSize: 9, letterSpacing: 1, color: "#3a8a5a", fontWeight: 600, marginTop: 4 }}>
                  {selGuests} PAX · {selResv.length} {selResv.length === 1 ? "TABLE" : "TABLES"}
                </div>
              )}
            </div>
          );
        })()}

        {/* Actions */}
        <div style={{ display: "flex", gap: 0, borderTop: "1px solid #f0f0f0", marginTop: 14 }}>
          <button
            onClick={onCancel}
            style={{ fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "16px 0", flex: 1, border: "none", borderRight: "1px solid #f0f0f0", cursor: "pointer", background: "#fff", color: "#888", fontWeight: 500 }}
          >CANCEL</button>
          <button
            onClick={() => selected && onConfirm(selected)}
            disabled={!selected}
            style={{ fontFamily: FONT, fontSize: 10, letterSpacing: 2, padding: "16px 0", flex: 2, border: "none", cursor: selected ? "pointer" : "not-allowed", background: selected ? "#1a1a1a" : "#f0f0f0", color: selected ? "#fff" : "#aaa", fontWeight: 700, opacity: 1 }}
          >START SERVICE ›</button>
        </div>
      </div>
    </div>
  );
}

// ── ResvForm — create / edit a reservation ────────────────────────────────────
function ResvForm({ initial, tables, reservations, excludeId, onSave, onCancel }) {
  const [tableIds,     setTableIds]     = useState(
    initial?.data?.tableGroup?.length > 1 ? initial.data.tableGroup.map(Number)
      : initial?.table_id               ? [Number(initial.table_id)]
      : []
  );
  const [name,         setName]         = useState(initial?.data?.resName      || "");
  const [time,         setTime]         = useState(initial?.data?.resTime      || "");
  const [menuType,     setMenuType]     = useState(initial?.data?.menuType     || "");
  const [lang,         setLang]         = useState(initial?.data?.lang         || "en");
  const [guests,       setGuests]       = useState(initial?.data?.guests       || 2);
  const [guestType,    setGuestType]    = useState(initial?.data?.guestType    || "");
  const [room,         setRoom]         = useState(initial?.data?.room         || "");
  const [birthday,     setBirthday]     = useState(!!initial?.data?.birthday);
  const [cakeNote,     setCakeNote]     = useState(initial?.data?.cakeNote || "");
  const [restrictions, setRestrictions] = useState(initial?.data?.restrictions || []);
  const [notes,        setNotes]        = useState(initial?.data?.notes        || "");
  const [saving,       setSaving]       = useState(false);

  const sortedGroup = [...tableIds].sort((a, b) => a - b);
  const primaryId   = sortedGroup[0] ?? null;

  const isConflict = (tid) => reservations.some(r =>
    r.id !== excludeId &&
    r.date === initial?.date &&
    (r.table_id === tid || (r.data?.tableGroup || []).map(Number).includes(tid)) &&
    !tableIds.includes(tid)
  );

  const handleSave = async () => {
    if (!primaryId) return;
    setSaving(true);
    const data = {
      resName: name, resTime: time, menuType, lang, guests, guestType,
      room: guestType === "hotel" ? room : "", birthday, cakeNote: birthday ? cakeNote : "", restrictions, notes,
      tableGroup: sortedGroup,
      courseOverrides:    initial?.data?.courseOverrides    || {},
      kitchenCourseNotes: initial?.data?.kitchenCourseNotes || {},
    };
    await onSave({ id: initial?.id, date: initial?.date, table_id: primaryId, data });
    setSaving(false);
  };

  return (
    <div style={{ background: "#fafafa", border: "1px solid #e8e8e8", borderRadius: 6, padding: "14px 14px 18px", margin: "4px 0 8px", fontFamily: FONT }}>
      {/* Table picker */}
      <div style={{ marginBottom: 14 }}>
        <div style={fieldLabel}>
          Table
          {tableIds.length > 1 && <span style={{ color: "#aaa", fontWeight: 400, marginLeft: 6 }}>T{sortedGroup.join("-")} · combined</span>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 5 }}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map(tid => {
            const isSel    = tableIds.includes(tid);
            const conflict = isConflict(tid);
            return (
              <button key={tid} onClick={() => {
                if (conflict) return;
                setTableIds(prev => prev.includes(tid) ? (prev.length > 1 ? prev.filter(x => x !== tid) : prev) : [...prev, tid]);
              }} style={{
                fontFamily: FONT, fontSize: 11, padding: "9px 0",
                border: "1px solid",
                borderColor: isSel ? "#1a1a1a" : conflict ? "#f0d0b0" : "#e0e0e0",
                borderRadius: 2,
                background: isSel ? "#1a1a1a" : conflict ? "#fff8f2" : "#fff",
                color: isSel ? "#fff" : conflict ? "#c07840" : "#555",
                cursor: conflict ? "not-allowed" : "pointer",
              }}>T{String(tid).padStart(2, "0")}</button>
            );
          })}
        </div>
        {tableIds.length === 0 && <div style={{ fontFamily: FONT, fontSize: 9, color: "#e06060", marginTop: 4 }}>Select at least one table</div>}
      </div>

      {/* Name + Sitting */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        <div>
          <div style={fieldLabel}>Name</div>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Guest name…" style={baseInp} />
        </div>
        <div>
          <div style={fieldLabel}>Sitting</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 5 }}>
            {SITTING_TIMES.map(t => (
              <button key={t} onClick={() => setTime(t === time ? "" : t)} style={{
                fontFamily: FONT, fontSize: 11, letterSpacing: 0.5, padding: "8px 0",
                border: "1px solid", borderColor: time === t ? "#1a1a1a" : "#e8e8e8",
                borderRadius: 2, cursor: "pointer",
                background: time === t ? "#1a1a1a" : "#fff",
                color: time === t ? "#fff" : "#666",
              }}>{t}</button>
            ))}
          </div>
        </div>
      </div>

      {/* Menu + Lang + Guests */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 10, alignItems: "flex-start", marginBottom: 10 }}>
        <div>
          <div style={fieldLabel}>Menu</div>
          <div style={{ display: "flex", gap: 5 }}>
            {[["long","Long"],["short","Short"]].map(([v, l]) => (
              <button key={v} onClick={() => setMenuType(menuType === v ? "" : v)} style={{
                fontFamily: FONT, fontSize: 10, letterSpacing: 0.5, padding: "8px 0", flex: 1,
                border: "1px solid", borderColor: menuType === v ? "#1a1a1a" : "#e8e8e8",
                borderRadius: 2, cursor: "pointer",
                background: menuType === v ? "#1a1a1a" : "#fff",
                color: menuType === v ? "#fff" : "#666",
              }}>{l}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={fieldLabel}>Language</div>
          <div style={{ display: "flex", gap: 5 }}>
            {[["en","EN"],["si","SLO"]].map(([v, l]) => (
              <button key={v} onClick={() => setLang(v)} style={{
                fontFamily: FONT, fontSize: 10, letterSpacing: 0.5, padding: "8px 0", flex: 1,
                border: "1px solid", borderColor: lang === v ? "#1a1a1a" : "#e8e8e8",
                borderRadius: 2, cursor: "pointer",
                background: lang === v ? "#1a1a1a" : "#fff",
                color: lang === v ? "#fff" : "#666",
              }}>{l}</button>
            ))}
          </div>
        </div>
        <div>
          <div style={fieldLabel}>Guests</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button onClick={() => setGuests(g => Math.max(1, g - 1))} style={circBtnSm}>−</button>
            <span style={{ fontFamily: FONT, fontSize: 15, minWidth: 22, textAlign: "center", color: "#1a1a1a" }}>{guests}</span>
            <button onClick={() => setGuests(g => Math.min(14, g + 1))} style={circBtnSm}>+</button>
          </div>
        </div>
      </div>

      {/* Guest type + Room */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10, alignItems: "flex-start" }}>
        <div>
          <div style={fieldLabel}>Guest type</div>
          <div style={{ display: "flex", gap: 5 }}>
            {[["","Regular"],["hotel","Hotel"],["outside","Outside"]].map(([v, l]) => (
              <button key={v || "r"} onClick={() => { setGuestType(v); if (v !== "hotel") setRoom(""); }} style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: "8px 0", flex: 1,
                border: "1px solid", borderColor: guestType === v ? "#1a1a1a" : "#e8e8e8",
                borderRadius: 2, cursor: "pointer",
                background: guestType === v ? "#1a1a1a" : "#fff",
                color: guestType === v ? "#fff" : "#666",
              }}>{l}</button>
            ))}
          </div>
        </div>
        {guestType === "hotel" ? (
          <div>
            <div style={fieldLabel}>Room</div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              {ROOM_OPTIONS.map(r => (
                <button key={r} onClick={() => setRoom(x => x === r ? "" : r)} style={{
                  fontFamily: FONT, fontSize: 11, padding: "7px 10px",
                  border: "1px solid", borderColor: room === r ? "#c8a06e" : "#e8e8e8",
                  borderRadius: 2, cursor: "pointer",
                  background: room === r ? "#fdf6ec" : "#fff",
                  color: room === r ? "#a07040" : "#555",
                }}>{r}</button>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 22, flexWrap: "wrap" }}>
            <input type="checkbox" id={`resvbd-${initial?.id || "new"}`} checked={birthday} onChange={e => setBirthday(e.target.checked)} style={{ width: 14, height: 14, cursor: "pointer" }} />
            <label htmlFor={`resvbd-${initial?.id || "new"}`} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, cursor: "pointer" }}>Cake</label>
            {birthday && <input value={cakeNote} onChange={e => setCakeNote(e.target.value)} placeholder="occasion (e.g. Mrs Bday)" style={{ ...baseInp, flex: 1, minWidth: 100, fontSize: MOBILE_SAFE_INPUT_SIZE, padding: "4px 8px" }} />}
          </div>
        )}
      </div>
      {guestType === "hotel" && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          <input type="checkbox" id={`resvbd2-${initial?.id || "new"}`} checked={birthday} onChange={e => setBirthday(e.target.checked)} style={{ width: 14, height: 14, cursor: "pointer" }} />
          <label htmlFor={`resvbd2-${initial?.id || "new"}`} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, cursor: "pointer" }}>Cake</label>
          {birthday && <input value={cakeNote} onChange={e => setCakeNote(e.target.value)} placeholder="occasion (e.g. Mrs Bday)" style={{ ...baseInp, flex: 1, minWidth: 100, fontSize: MOBILE_SAFE_INPUT_SIZE, padding: "4px 8px" }} />}
        </div>
      )}

      {/* Dietary restrictions */}
      <div style={{ marginBottom: 10 }}>
        <div style={{ ...fieldLabel, marginBottom: 8 }}>Dietary restrictions</div>
        {Object.entries(RESTRICTION_GROUPS).map(([group, groupLabel]) => {
          const items = RESTRICTIONS.filter(r => r.group === group);
          return (
            <div key={group} style={{ marginBottom: 10 }}>
              <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#bbb", textTransform: "uppercase", marginBottom: 5 }}>{groupLabel}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {items.map(opt => {
                  const cnt = restrictions.filter(r => r.note === opt.key).length;
                  return (
                    <button key={opt.key} onClick={() => setRestrictions(rs => [...rs, { pos: null, note: opt.key }])} style={{
                      fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: "5px 9px",
                      borderRadius: 2, cursor: "pointer",
                      border: `1px solid ${cnt > 0 ? "#e09090" : "#e8e8e8"}`,
                      background: cnt > 0 ? "#fef0f0" : "#fafafa",
                      color: cnt > 0 ? "#b04040" : "#888",
                      fontWeight: cnt > 0 ? 600 : 400,
                    }}>
                      {opt.emoji} {opt.label}
                      {cnt > 0 && <span style={{ marginLeft: 4, background: "#e09090", color: "#fff", borderRadius: 99, fontSize: 8, padding: "1px 4px" }}>{cnt}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
        {restrictions.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
            {restrictions.map((r, i) => {
              const def   = RESTRICTIONS.find(x => x.key === r.note);
              const label = def ? `${def.emoji} ${def.label}` : r.note;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 8px", background: "#fef0f0", border: "1px solid #e09090", borderRadius: 2 }}>
                  <span style={{ fontFamily: FONT, fontSize: 10, color: "#b04040" }}>{label}</span>
                  <button onClick={() => setRestrictions(rs => rs.filter((_, idx) => idx !== i))} style={{ background: "none", border: "none", color: "#e09090", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>×</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Notes */}
      <div style={{ marginBottom: 14 }}>
        <div style={fieldLabel}>Notes</div>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="VIP, pace, special requests…" style={{ ...baseInp, minHeight: 56, resize: "vertical", lineHeight: 1.5 }} />
      </div>

      {/* Save / Cancel */}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onCancel} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "8px 16px", border: "1px solid #e0e0e0", borderRadius: 4, cursor: "pointer", background: "#fff", color: "#666" }}>CANCEL</button>
        <button onClick={handleSave} disabled={!primaryId || saving} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "8px 20px", border: "1px solid #1a1a1a", borderRadius: 4, cursor: "pointer", background: "#1a1a1a", color: "#fff", fontWeight: 600, opacity: (!primaryId || saving) ? 0.5 : 1 }}>
          {saving ? "SAVING…" : "SAVE"}
        </button>
      </div>
    </div>
  );
}

// ── ReservationManager — two-screen: week overview → day detail ───────────────
function ReservationManager({ reservations, menuCourses, tables, onUpsert, onDelete, onUpdReservation, onExit, serviceDate, onSetServiceDate }) {
  const [weekOffset,  setWeekOffset]  = useState(0);
  const [selectedDay, setSelectedDay] = useState(null);   // "YYYY-MM-DD" or null (week view)
  const [editingId,   setEditingId]   = useState(null);   // reservation id being edited, or "new"
  const [ticketId,    setTicketId]    = useState(null);    // reservation id showing kitchen preview
  const [weeklyPreview, setWeeklyPreview] = useState(null); // "reservations" | "allergies" | null
  const [draftFromReservation, setDraftFromReservation] = useState(null);

  const todayStr = toLocalDateISO();

  // ── Week helpers ─────────────────────────────────────────────────────────
  const weekDays = useMemo(() => {
    const today = new Date();
    const dow   = today.getDay();
    const toMon = dow === 0 ? -6 : 1 - dow;
    const mon   = new Date(today);
    mon.setDate(today.getDate() + toMon + weekOffset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(mon);
      d.setDate(mon.getDate() + i);
      return d;
    });
  }, [weekOffset]);

  const toDateStr = d => toLocalDateISO(d);
  const fmtRange  = () => {
    const o = { day: "numeric", month: "short" };
    return `${weekDays[0].toLocaleDateString("en-GB", o)} – ${weekDays[6].toLocaleDateString("en-GB", o)}`.toUpperCase();
  };

  const navBtn = { fontFamily: FONT, fontSize: 12, padding: "6px 10px", border: "1px solid #e8e8e8", borderRadius: 4, cursor: "pointer", background: "#fff", color: "#555" };

  const resvForDate = (ds) => reservations
    .filter(r => r.date === ds)
    .sort((a, b) => (a.data?.resTime || "99:99").localeCompare(b.data?.resTime || "99:99"));

  // ── DAY DETAIL VIEW ──────────────────────────────────────────────────────
  if (selectedDay) {
    const dayDate   = new Date(selectedDay + "T00:00:00");
    const dayLabel  = dayDate.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }).toUpperCase();
    const dayResv   = resvForDate(selectedDay);
    const isService = selectedDay === serviceDate;
    const totalGuests = dayResv.reduce((a, r) => a + (r.data?.guests || 2), 0);

    // Kitchen ticket preview for a reservation
    const ticketResv = ticketId ? dayResv.find(r => r.id === ticketId) : null;
    const ticketVirtualTable = ticketResv ? {
      ...blankTable(ticketResv.table_id),
      ...(ticketResv.data || {}),
      id: ticketResv.table_id,
      seats: makeSeats(ticketResv.data?.guests || 2, ticketResv.data?.seats || []),
    } : null;

    const updForTicket = (tid, field, value) => {
      if (ticketResv) onUpdReservation(ticketResv.id, tid, field, value);
    };

    return (
      <div style={{ minHeight: "100vh", background: "#fff", fontFamily: FONT, overflowX: "hidden", WebkitTextSizeAdjust: "100%" }}>
        <GlobalStyle />

        {/* Sticky header */}
        <div style={{ borderBottom: "1px solid #f0f0f0", padding: "0 16px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "#fff", zIndex: 50, gap: 12 }}>
          <button onClick={() => { setSelectedDay(null); setEditingId(null); setTicketId(null); setDraftFromReservation(null); }}
            style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 14px", border: "1px solid #e8e8e8", borderRadius: 999, cursor: "pointer", background: "#fff", color: "#1a1a1a", flexShrink: 0 }}>← WEEK</button>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 10, letterSpacing: 3, color: isService ? "#2f7a45" : "#1a1a1a", fontWeight: 600 }}>{dayLabel}</div>
            <div style={{ fontSize: 8, letterSpacing: 2, color: "#aaa", marginTop: 2 }}>
              {dayResv.length} reservation{dayResv.length !== 1 ? "s" : ""} · {totalGuests} guests
              {isService && <span style={{ color: "#2f7a45", marginLeft: 6 }}>● ACTIVE SERVICE</span>}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            <button onClick={() => {
              const next = editingId === "new" ? null : "new";
              setEditingId(next);
              setDraftFromReservation(null);
            }}
              style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 14px", border: "1px solid #1a1a1a", borderRadius: 999, cursor: "pointer", background: editingId === "new" ? "#1a1a1a" : "#fff", color: editingId === "new" ? "#fff" : "#1a1a1a", fontWeight: 600 }}>+ ADD</button>
          </div>
        </div>

        <div style={{ padding: "16px 16px 60px", maxWidth: 700, margin: "0 auto" }}>

          {/* New reservation form */}
          {editingId === "new" && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 3, color: "#999", marginBottom: 6, textTransform: "uppercase" }}>New Reservation</div>
              <ResvForm
                initial={draftFromReservation
                  ? { date: selectedDay, table_id: draftFromReservation.table_id ?? null, data: draftFromReservation.data || {} }
                  : { date: selectedDay, table_id: null, data: {} }}
                tables={tables}
                reservations={reservations}
                excludeId={null}

                onSave={async (row) => { const r = await onUpsert(row); if (r?.ok) { setEditingId(null); setDraftFromReservation(null); } }}
                onCancel={() => { setEditingId(null); setDraftFromReservation(null); }}
              />
            </div>
          )}

          {/* Existing reservations as big clear cards */}
          {dayResv.length === 0 && editingId !== "new" && (
            <div style={{ textAlign: "center", padding: "60px 0", color: "#ccc" }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>◫</div>
              <div style={{ fontFamily: FONT, fontSize: 10, letterSpacing: 2 }}>NO RESERVATIONS</div>
              <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, marginTop: 6, color: "#ddd" }}>Tap + ADD or TEMPLATE to create one</div>
            </div>
          )}

          {dayResv.map(r => {
            const d = r.data || {};
            const group = d.tableGroup?.length > 1 ? d.tableGroup.map(Number) : [r.table_id];
            const tLabel = group.length > 1
              ? `T${[...group].sort((a, b) => a - b).join("-")}`
              : `T${String(r.table_id).padStart(2, "0")}`;
            const isEditing = editingId === r.id;
            const showTicket = ticketId === r.id;

            return (
              <div key={r.id} style={{
                border: "1px solid #e8e8e8", borderRadius: 6, marginBottom: 10,
                background: "#fff", overflow: "hidden",
              }}>
                {/* Card header — always visible */}
                <div style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 12 }}>
                  {/* Table badge */}
                  <div style={{ background: "#1a1a1a", color: "#fff", fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: 1, padding: "8px 12px", borderRadius: 4, minWidth: 48, textAlign: "center" }}>{tLabel}</div>
                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: FONT, fontSize: 13, color: "#1a1a1a", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {d.resName || "—"}
                    </div>
                    <div style={{ fontFamily: FONT, fontSize: 10, color: "#999", marginTop: 2, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      {d.resTime && <span>{d.resTime}</span>}
                      <span>{d.guests || 2} guests</span>
                      {d.menuType && <span style={{ color: "#c8a06e", textTransform: "uppercase", letterSpacing: 1 }}>{d.menuType}</span>}
                      {d.lang === "si" && <span style={{ color: "#6080c0" }}>SLO</span>}
                      {d.birthday && <span>🎂{d.cakeNote ? ` ${d.cakeNote}` : ""}</span>}
                      {d.guestType === "hotel" && d.room && <span style={{ color: "#a07040" }}>Room {d.room}</span>}
                    </div>
                    {d.restrictions?.length > 0 && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
                        {d.restrictions.map((rs, i) => {
                          const def = RESTRICTIONS.find(x => x.key === rs.note);
                          return <span key={i} style={{ fontFamily: FONT, fontSize: 9, color: "#b04040", background: "#fef0f0", border: "1px solid #f0d0d0", borderRadius: 2, padding: "2px 6px" }}>{def ? `${def.emoji} ${def.label}` : rs.note}</span>;
                        })}
                      </div>
                    )}
                    {d.notes && <div style={{ fontFamily: FONT, fontSize: 9, color: "#888", fontStyle: "italic", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.notes}</div>}
                  </div>
                  {/* Action buttons */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, flexShrink: 0 }}>
                    <button onClick={() => { setEditingId(isEditing ? null : r.id); if (!isEditing) setTicketId(null); }}
                      style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 10px", border: "1px solid " + (isEditing ? "#1a1a1a" : "#d0d0d0"), borderRadius: 4, cursor: "pointer", background: isEditing ? "#1a1a1a" : "#fff", color: isEditing ? "#fff" : "#555" }}>EDIT</button>
                    <button onClick={() => { setTicketId(showTicket ? null : r.id); if (!showTicket) setEditingId(null); }}
                      style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 10px", border: "1px solid " + (showTicket ? "#1a1a1a" : "#d0d0d0"), borderRadius: 4, cursor: "pointer", background: showTicket ? "#1a1a1a" : "#fff", color: showTicket ? "#fff" : "#555" }}>TICKET</button>
                    <button onClick={() => {
                      setEditingId("new");
                      setTicketId(null);
                      setDraftFromReservation({
                        table_id: r.table_id,
                        data: { ...(r.data || {}), resName: `${d.resName || "Guest"} (copy)` },
                        date: selectedDay,
                      });
                    }}
                      style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 10px", border: "1px solid #d0d0d0", borderRadius: 4, cursor: "pointer", background: "#fff", color: "#666" }}>COPY</button>
                    <button onClick={async () => { if (window.confirm(`Delete reservation for ${d.resName || tLabel}?`)) { await onDelete(r.id); setEditingId(null); setTicketId(null); } }}
                      style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 10px", border: "1px solid #f0c0c0", borderRadius: 4, cursor: "pointer", background: "#fff8f8", color: "#c04040" }}>DEL</button>
                  </div>
                </div>

                {/* Edit form */}
                {isEditing && (
                  <div style={{ borderTop: "1px solid #f0f0f0", padding: "12px 16px" }}>
                    <ResvForm
                      initial={r}
                      tables={tables}
                      reservations={reservations}
                      excludeId={r.id}
      
                      onSave={async (row) => { await onUpsert(row); setEditingId(null); setDraftFromReservation(null); }}
                      onCancel={() => { setEditingId(null); setDraftFromReservation(null); }}
                    />
                  </div>
                )}

                {/* Kitchen ticket preview */}
                {showTicket && ticketVirtualTable && (
                  <div style={{ borderTop: "1px solid #f0f0f0", padding: "12px 16px" }}>
                    <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 3, color: "#bbb", marginBottom: 8, textTransform: "uppercase" }}>Kitchen Ticket Preview</div>
                    <div style={{ border: "1px solid #f0f0f0", borderRadius: 4, overflow: "hidden", background: "#fff" }}>
                      <KitchenTicket table={ticketVirtualTable} menuCourses={menuCourses} upd={updForTicket} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ── WEEK OVERVIEW ────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "#fff", fontFamily: FONT, overflowX: "hidden", WebkitTextSizeAdjust: "100%" }}>
      <GlobalStyle />

      {/* Sticky header */}
      <div style={{ borderBottom: "1px solid #f0f0f0", padding: "0 16px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, background: "#fff", zIndex: 50, gap: 12 }}>
        <button onClick={onExit} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 12px", border: "1px solid #e8e8e8", borderRadius: 999, cursor: "pointer", background: "#fff", color: "#1a1a1a", flexShrink: 0 }}>← EXIT</button>
        <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 4, color: "#999", flex: 1, textAlign: "center" }}>RESERVATIONS</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <button onClick={() => setWeeklyPreview(weeklyPreview === "reservations" ? null : "reservations")}
            style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 1, padding: "5px 8px", border: `1px solid ${weeklyPreview === "reservations" ? "#1a1a1a" : "#d0d0d0"}`, borderRadius: 999, cursor: "pointer", background: weeklyPreview === "reservations" ? "#1a1a1a" : "#fff", color: weeklyPreview === "reservations" ? "#fff" : "#555", fontWeight: 600, flexShrink: 0 }}>OVERVIEW</button>
          <button onClick={() => setWeeklyPreview(weeklyPreview === "allergies" ? null : "allergies")}
            style={{ fontFamily: FONT, fontSize: 7, letterSpacing: 1, padding: "5px 8px", border: `1px solid ${weeklyPreview === "allergies" ? "#1a1a1a" : "#d0d0d0"}`, borderRadius: 999, cursor: "pointer", background: weeklyPreview === "allergies" ? "#1a1a1a" : "#fff", color: weeklyPreview === "allergies" ? "#fff" : "#555", fontWeight: 600, flexShrink: 0 }}>ALLERGIES</button>
          <button onClick={() => setWeekOffset(w => w - 1)} style={navBtn}>◀</button>
          <button onClick={() => setWeekOffset(0)}
            style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#888", minWidth: 110, textAlign: "center", background: "none", border: "1px solid #f0f0f0", borderRadius: 4, padding: "5px 0", cursor: "pointer" }}>{fmtRange()}</button>
          <button onClick={() => setWeekOffset(w => w + 1)} style={navBtn}>▶</button>
        </div>
      </div>

      {/* Service date strip */}
      <div style={{ padding: "8px 16px", borderBottom: "1px solid #f0f0f0", display: "flex", alignItems: "center", gap: 10 }}>
        {serviceDate ? (
          <>
            <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#2f7a45", fontWeight: 600 }}>
              ● SERVICE: {new Date(serviceDate + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).toUpperCase()}
            </span>
            <button onClick={() => { const nd = window.prompt("Change service date (YYYY-MM-DD):", serviceDate); if (nd && /^\d{4}-\d{2}-\d{2}$/.test(nd)) onSetServiceDate(nd); }}
              style={{ fontFamily: FONT, fontSize: 8, color: "#bbb", background: "none", border: "none", cursor: "pointer" }}>change</button>
          </>
        ) : (
          <>
            <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#ccc" }}>NO ACTIVE SERVICE DATE</span>
            <button onClick={() => { const nd = window.prompt("Set service date (YYYY-MM-DD):", todayStr); if (nd && /^\d{4}-\d{2}-\d{2}$/.test(nd)) onSetServiceDate(nd); }}
              style={{ fontFamily: FONT, fontSize: 8, color: "#888", background: "none", border: "1px solid #e0e0e0", cursor: "pointer", borderRadius: 2, padding: "2px 8px" }}>SET DATE</button>
          </>
        )}
      </div>

      {/* Weekly preview panel */}
      {weeklyPreview && (() => {
        const html = weeklyPreview === "reservations"
          ? generateWeeklyReservationsHTML(reservations, weekDays, RESTRICTIONS)
          : generateWeeklyAllergyHTML(reservations, menuCourses, weekDays, RESTRICTIONS);
        const isLandscape = weeklyPreview === "allergies";
        const a4W = isLandscape ? 1123 : 794;
        const a4H = isLandscape ? 794 : 1123;
        const containerW = Math.min(window.innerWidth - 32, 700);
        const scale = containerW / a4W;
        return (
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f0f0", background: "#fafafa" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: "#888", textTransform: "uppercase" }}>
                {weeklyPreview === "reservations" ? "Weekly Overview" : "Weekly Allergies"} Preview
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => {
                  const w = window.open("", "_blank", "width=900,height=700");
                  if (!w) { alert("Pop-up blocked"); return; }
                  w.document.write(html); w.document.close(); w.focus();
                  setTimeout(() => w.print(), 800);
                }}
                  style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, padding: "5px 12px", border: "1px solid #1a1a1a", borderRadius: 999, cursor: "pointer", background: "#1a1a1a", color: "#fff", fontWeight: 600 }}>PRINT</button>
                <button onClick={() => setWeeklyPreview(null)}
                  style={{ fontFamily: FONT, fontSize: 10, background: "none", border: "none", cursor: "pointer", color: "#aaa", padding: "0 4px" }}>×</button>
              </div>
            </div>
            <div style={{ width: containerW, height: Math.round(a4H * scale), overflow: "hidden", border: "1px solid #e0e0e0", borderRadius: 4, background: "#fff" }}>
              <iframe srcDoc={html} title="weekly preview"
                style={{ width: a4W, height: a4H, border: "none", transform: `scale(${scale})`, transformOrigin: "top left", pointerEvents: "none" }} />
            </div>
          </div>
        );
      })()}

      {/* Week grid — big tappable day tiles */}
      <div style={{ padding: "16px 16px 60px", maxWidth: 600, margin: "0 auto" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {weekDays.map(day => {
            const dateStr    = toDateStr(day);
            const dayResv    = resvForDate(dateStr);
            const isToday      = dateStr === todayStr;
            const isServiceDay = dateStr === serviceDate;
            const totalGuests  = dayResv.reduce((a, r) => a + (r.data?.guests || 2), 0);

            return (
              <button key={dateStr} onClick={() => setSelectedDay(dateStr)}
                style={{
                  fontFamily: FONT, textAlign: "left", cursor: "pointer",
                  border: `1.5px solid ${isServiceDay ? "#b0d8b0" : isToday ? "#d0d0d0" : "#efefef"}`,
                  borderRadius: 6, padding: "14px 16px",
                  background: isServiceDay ? "#f4fbf4" : "#fff",
                  display: "flex", alignItems: "center", gap: 14,
                  transition: "all 0.1s",
                }}>
                {/* Day label */}
                <div style={{ minWidth: 100 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 1, color: isServiceDay ? "#2f7a45" : isToday ? "#1a1a1a" : "#888" }}>
                    {day.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase()}
                  </div>
                  <div style={{ fontSize: 10, letterSpacing: 1, color: isServiceDay ? "#5aaa6a" : isToday ? "#666" : "#bbb", marginTop: 2 }}>
                    {day.toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase()}
                  </div>
                </div>

                {/* Badges */}
                <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                  {isServiceDay && <span style={{ fontSize: 8, letterSpacing: 1, color: "#2f7a45", fontWeight: 600 }}>● SERVICE</span>}
                  {isToday && !isServiceDay && <span style={{ fontSize: 8, letterSpacing: 1, color: "#bbb" }}>TODAY</span>}
                </div>

                {/* Count */}
                <div style={{ textAlign: "right" }}>
                  {dayResv.length > 0 ? (
                    <>
                      <div style={{ fontSize: 16, fontWeight: 600, color: "#1a1a1a", lineHeight: 1 }}>{dayResv.length}</div>
                      <div style={{ fontSize: 9, color: "#aaa", letterSpacing: 1, marginTop: 2 }}>{totalGuests} guests</div>
                    </>
                  ) : (
                    <div style={{ fontSize: 10, color: "#ddd", letterSpacing: 1 }}>—</div>
                  )}
                </div>

                {/* Arrow */}
                <span style={{ fontSize: 14, color: "#ccc" }}>›</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── GateScreen — password wall before anything else ───────────────────────────
function GateScreen({ onPass }) {
  const [pw, setPw]       = useState("");
  const [shake, setShake] = useState(false);
  const [show, setShow]   = useState(false);

  const attempt = val => {
    if (!ACCESS_PASSWORD) {
      writeAccess();
      onPass();
      return;
    }
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
        <div style={{ fontSize: 15, fontWeight: 500, letterSpacing: 6, color: "#1a1a1a", marginBottom: 6 }}>{APP_NAME}</div>
        <div style={{ fontSize: 9, letterSpacing: 4, color: "#555" }}>{APP_SUBTITLE}</div>
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

// ── Menu Page — preview + print only ─────────────────────────────────────────
function MenuPage({ tables, menuCourses, upd, logoDataUri = "", wines = [], cocktails = [], spirits = [], beers = [], globalLayout = {}, menuTemplate = null, aperitifOptions = [], menuRules = DEFAULT_MENU_RULES, onExit }) {
  const [menuGenTable, setMenuGenTable] = useState(null);

  return (
    <div style={{ minHeight: "100vh", background: "#fafafa", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e8e8e8", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <span style={{ fontFamily: FONT, fontSize: 11, fontWeight: 700, letterSpacing: 3, color: "#1a1a1a" }}>MENU</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, color: "#aaa" }}>PREVIEW + PRINT</span>
          <button onClick={onExit} style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 14px", border: "1px solid #e8e8e8", borderRadius: 2, cursor: "pointer", background: "#fff", color: "#888" }}>EXIT</button>
        </div>
      </div>

      {/* Content — table selection for menu generation */}
      <div style={{ flex: 1, overflowY: "auto", padding: "28px 24px", maxWidth: 740, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <div style={{ fontFamily: FONT, fontSize: 10, color: "#888", letterSpacing: 1, marginBottom: 20 }}>
          SELECT A TABLE TO GENERATE MENUS
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
          {tables.map(t => {
            const hasData = t.active || t.resName || t.resTime;
            return (
              <div
                key={t.id}
                onClick={() => setMenuGenTable(t)}
                style={{
                  border: `1px solid ${hasData ? "#e0e0e0" : "#f0f0f0"}`,
                  borderRadius: 6, padding: "14px 16px",
                  background: hasData ? "#fff" : "#fafafa",
                  cursor: "pointer", boxShadow: hasData ? "0 1px 4px rgba(0,0,0,0.06)" : "none",
                  opacity: hasData ? 1 : 0.5, transition: "box-shadow 0.15s",
                }}
              >
                <div style={{ fontFamily: FONT, fontSize: 20, fontWeight: 800, color: "#111", letterSpacing: -1, lineHeight: 1 }}>T{t.id}</div>
                {t.resName && <div style={{ fontFamily: FONT, fontSize: 10, fontWeight: 700, color: "#333", marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.resName}</div>}
                {t.resTime && <div style={{ fontFamily: FONT, fontSize: 9, color: "#888", marginTop: 2 }}>{t.resTime}</div>}
                {t.seats?.length > 0 && <div style={{ fontFamily: FONT, fontSize: 9, color: "#aaa", marginTop: 4 }}>{t.seats.length} pax</div>}
                {t.active && <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: "#4a9a6a", marginTop: 4, fontWeight: 700 }}>SEATED</div>}
              </div>
            );
          })}
        </div>
      </div>

      {/* MenuGenerator overlay */}
      {menuGenTable && (
        <MenuGenerator
          table={tables.find(t => t.id === menuGenTable.id) || menuGenTable}
          menuCourses={menuCourses}
          upd={upd}
          defaultLayoutStyles={globalLayout}
          menuTemplate={menuTemplate}
          logoDataUri={logoDataUri}
          wines={wines}
          cocktails={cocktails}
          spirits={spirits}
          beers={beers}
          aperitifOptions={aperitifOptions}
          menuRules={menuRules}
          onClose={() => setMenuGenTable(null)}
        />
      )}
    </div>
  );
}

// ── Login Screen ──────────────────────────────────────────────────────────────
function LoginScreen({ onEnter, onSyncAll }) {
  const MODES = [
    { id: "display",     label: "Display",      sub: "read-only view",      icon: "◎", pin: false },
    { id: "service",     label: "Service",      sub: "full service access",  icon: "◈", pin: false },
    { id: "reservation", label: "Reservations", sub: "weekly planner",       icon: "◫", pin: false },
    { id: "admin",       label: "Admin",        sub: "pin required",         icon: "◆", pin: true  },
    { id: "menu",        label: "Menu",         sub: "preview + print",      icon: "▨", pin: true  },
  ];
  const [picking, setPicking] = useState(null);
  const [pin, setPin]         = useState("");
  const [shake, setShake]     = useState(false);
  const [syncSt, setSyncSt]   = useState(null); // null | "syncing" | "ok" | "err"

  const handleSync = async () => {
    if (!onSyncAll || syncSt === "syncing") return;
    setSyncSt("syncing");
    try {
      const r = await onSyncAll();
      console.log("[LoginSync]", r);
      setSyncSt(r?.ok ? "ok" : "err");
    } catch (e) {
      console.error("[LoginSync] threw:", e);
      setSyncSt("err");
    }
    setTimeout(() => setSyncSt(null), 3000);
  };

  const handleTile = mode => {
    if (!mode.pin) { onEnter(mode.id); return; }
    if (!PINS[mode.id]) { onEnter(mode.id); return; }
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
        <div style={{ fontFamily: FONT, fontSize: 14, fontWeight: 600, letterSpacing: 6, color: "#1a1a1a", marginBottom: 8 }}>{APP_NAME}</div>
        <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 4, color: "#999" }}>{APP_SUBTITLE}</div>
      </div>

      {!picking ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
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
          {onSyncAll && (
            <button onClick={handleSync} disabled={syncSt === "syncing"} style={{
              fontFamily: FONT, fontSize: 9, letterSpacing: 2,
              padding: "6px 16px", borderRadius: 999, cursor: syncSt === "syncing" ? "not-allowed" : "pointer",
              border: `1px solid ${syncSt === "ok" ? "#8fc39f" : syncSt === "err" ? "#e89898" : "#ddd"}`,
              background: syncSt === "ok" ? "#eef8f1" : syncSt === "err" ? "#fff0f0" : "#fafafa",
              color: syncSt === "ok" ? "#2f7a45" : syncSt === "err" ? "#c04040" : "#aaa",
            }}>
              {syncSt === "syncing" ? "SYNCING…" : syncSt === "ok" ? "✓ SYNCED" : syncSt === "err" ? "✗ FAILED" : "↻ SYNC WINES"}
            </button>
          )}
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
  const [menuCourses, setMenuCourses] = useState([]); // live from Supabase
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
  const [adminOpen,      setAdminOpen]      = useState(false);
  const [summaryOpen,    setSummaryOpen]    = useState(false);
  const [archiveOpen,    setArchiveOpen]    = useState(false);
  const [inventoryOpen,  setInventoryOpen]  = useState(false);
  const [syncStatus,   setSyncStatus]   = useState(hasSupabaseConfig ? "connecting" : "local-only");
  const [logoDataUri,  setLogoDataUri]  = useState("");
  // Print layout state (lifted from MenuPage into App for Admin access)
  const [globalLayout, setGlobalLayout] = useState(() => {
    try { return JSON.parse(localStorage.getItem("milka_menu_layout") || "{}"); } catch { return {}; }
  });
  const [layoutSaving, setLayoutSaving] = useState(false);
  const [layoutSaved,  setLayoutSaved]  = useState(false);
  const layoutLoaded = useRef(false);
  const globalLayoutRef = useRef(globalLayout);
  globalLayoutRef.current = globalLayout;
  const [menuRules, setMenuRules] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("milka_menu_rules") || "null");
      return normalizeMenuRules(raw || DEFAULT_MENU_RULES);
    } catch {
      return normalizeMenuRules(DEFAULT_MENU_RULES);
    }
  });
  const [menuRulesSaving, setMenuRulesSaving] = useState(false);
  const [menuRulesSaved, setMenuRulesSaved] = useState(false);
  const menuRulesRef = useRef(menuRules);
  menuRulesRef.current = menuRules;
  // Quick Access items (data-driven, replaces hardcoded APERITIF_OPTIONS)
  const [quickAccessItems, setQuickAccessItems] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem("milka_quick_access") || "null");
      if (stored) return stored;
    } catch {}
        return DEFAULT_QUICK_ACCESS_ITEMS.map(item => ({ ...item }));
  });
  // Access gate: checked once at init against 12h TTL
  const [authed,       setAuthed]       = useState(() => readAccess());
  // Reservations & service date
  const [reservations, setReservations] = useState([]);
  const [serviceDate,  setServiceDate]  = useState(() => {
    try { return localStorage.getItem("milka_service_date") || null; } catch { return null; }
  });
  const [showServiceDatePicker,  setShowServiceDatePicker]  = useState(false);
  const [pendingModeAfterDate,   setPendingModeAfterDate]   = useState(null);
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
    const nextTables = initTables.map(base => byId.get(base.id) || base);
    // Snapshot prevTablesJsonRef BEFORE setTables so the save-useEffect sees no diff
    // after a full poll and doesn't re-save the entire remote state.
    prevTablesJsonRef.current = nextTables.map(t => JSON.stringify(sanitizeTable(t)));
    applyingRemoteRef.current = true;
    setTables(() => nextTables);
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

  const upd = (id, f, v) => setTables(p => p.map(t => t.id === id ? { ...t, [f]: typeof v === "function" ? v(t[f]) : v } : t));
  // Batch multiple field updates in one setTables call (one render, one Supabase save)
  const updMany = (id, changes) => setTables(p => p.map(t => t.id === id ? { ...t, ...changes } : t));

  const updSeat = (tid, sid, f, v) => setTables(p => p.map(t =>
    t.id !== tid ? t : { ...t, seats: t.seats.map(s => s.id === sid ? { ...s, [f]: v } : s) }
  ));

  const setGuests = (tid, n) => setTables(p => p.map(t =>
    t.id !== tid ? t : { ...t, guests: n, seats: makeSeats(n, t.seats) }
  ));

  const applySeatTemplateToAll = (tableId, sourceSeatId = 1) => setTables(prev => prev.map(t => {
    if (t.id !== tableId) return t;
    const seats = t.seats || [];
    if (seats.length <= 1) return t;
    const source = seats.find(s => s.id === sourceSeatId) || seats[0];
    if (!source) return t;
    const clonedExtras = source.extras
      ? Object.fromEntries(Object.entries(source.extras).map(([k, v]) => [k, v ? { ...v } : v]))
      : {};
    const nextSeats = seats.map(s => (
      s.id === source.id
        ? s
        : {
            ...s,
            water: source.water || "Still",
            pairing: source.pairing || "—",
            aperitifs: [...(source.aperitifs || [])],
            glasses: [...(source.glasses || [])],
            cocktails: [...(source.cocktails || [])],
            spirits: [...(source.spirits || [])],
            beers: [...(source.beers || [])],
            extras: clonedExtras,
          }
    ));
    return { ...t, seats: nextSeats };
  }));

  const clearSeatBeverages = (tableId) => setTables(prev => prev.map(t => {
    if (t.id !== tableId) return t;
    const nextSeats = (t.seats || []).map(s => ({
      ...s,
      pairing: "—",
      aperitifs: [],
      glasses: [],
      cocktails: [],
      spirits: [],
      beers: [],
    }));
    return { ...t, seats: nextSeats };
  }));

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

  const syncWines = async () => {
    try {
      const secret = import.meta.env.VITE_SYNC_SECRET || "";
      const url = secret ? `/api/sync-wines?secret=${encodeURIComponent(secret)}` : "/api/sync-wines";
      const r = await fetch(url);
      const json = await r.json();
      if (!r.ok) return { ok: false, error: json.error || String(r.status) };
      await loadWines(); // explicit reload after sync completes
      return { ok: true, wines: json.wines, cocktails: json.cocktails, beers: json.beers, spirits: json.spirits, failedCountries: json.failedCountries };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };

  // Save menu courses directly to Supabase (the app is now the source of truth)
  const saveMenuCourses = async (courses) => {
    if (!supabase) return;
    const rows = courses.map(c => courseToSupabaseRow(c));
    const { error } = await supabase
      .from("menu_courses")
      .upsert(rows, { onConflict: "position" });
    if (error) { console.error("Menu save failed:", error); return; }
    // Remove courses that no longer exist
    const positions = courses.map(c => c.position);
    if (positions.length > 0) {
      await supabase.from("menu_courses").delete().not("position", "in", `(${positions.join(",")})`);
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

  const seedTestData = () => {
    const names = ["Novak", "Kovač", "Krajnc", "Zupan", "Horvat", "Mlakar", "Kralj", "Kos", "Smith", "Müller"];
    const times = ["18:00","18:00","18:30","18:30","19:00","19:00","19:00","19:15","19:15","19:15"];
    const types = ["long","long","long","short","long","long","short","long","long","long"];
    const pax   = [2,4,3,2,6,4,2,5,3,2];
    const langs = ["en","en","si","si","en","si","en","en","si","en"];
    const restrPool = ["vegetarian","vegan","gluten free","lactose free","nut allergy","shellfish allergy","no pork"];
    const rng = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const now = fmt(new Date());
    setTables(Array.from({ length: 10 }, (_, i) => {
      const id = i + 1;
      const n = pax[i];
      const restrCount = Math.random() < 0.4 ? 1 : 0;
      const restrictions = restrCount ? [{ note: rng(restrPool), pos: null }] : [];
      return {
        ...blankTable(id),
        active: true,
        resName: names[i],
        resTime: times[i],
        menuType: types[i],
        guests: n,
        guestType: Math.random() < 0.2 ? "hotel" : "regular",
        room: Math.random() < 0.2 ? String(100 + Math.floor(Math.random() * 50)) : "",
        birthday: Math.random() < 0.15,
        lang: langs[i],
        restrictions,
        notes: Math.random() < 0.2 ? "Window seat please" : "",
        arrivedAt: Math.random() < 0.6 ? now : null,
        seats: makeSeats(n),
        kitchenLog: {},
        tableGroup: [],
      };
    }));
    setArchiveOpen(false);
  };

  const archiveAndClearAll = async () => {
    if (typeof window !== "undefined" && !window.confirm("Archive today's service and clear all tables?")) return;
    const snap = boardStateRef.current; // stable reference, never stale
    const dateStr = new Date().toLocaleDateString("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric" });
    const activeTables = snap.tables.filter(t => t.active || t.arrivedAt || t.resName || t.resTime);
    if (supabase) {
      const { error } = await supabase.from("service_archive").insert({
        date: toLocalDateISO(),
        label: dateStr,
        state: { ...snap, tables: activeTables, menuCourses: menuCourses },
      });
      if (error) {
        window.alert("Archive failed: " + error.message);
        return;
      }
    }
    setTables(Array.from({ length: 10 }, (_, i) => blankTable(i + 1)));
    setSel(null);
    setArchiveOpen(false);
    // Release the service date lock so the next service can set a new date
    persistServiceDate(null);
    // Return to mode selection after archiving
    changeMode(null);
  };

  const endService = async () => {
    await archiveAndClearAll();
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

  const saveRes = (id, { tableIds, tableId, name, time, menuType, guests, guestType, room, birthday, cakeNote, restrictions, notes, lang }) => {
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
      const newSeats = makeSeats(guests, t.seats).map(s => {
        const newExtras = { ...s.extras };
        if (birthday) {
          newExtras[3] = { ordered: true, pairing: "—" };
        } else {
          // Clear auto-added cake when birthday is turned off
          delete newExtras[3];
        }
        return { ...s, extras: newExtras };
      });
      const ec = birthday ? { ...(t.extrasConfirmed || {}), cake: true } : t.extrasConfirmed || {};
      return { ...t, resName: name, resTime: time, menuType, guestType, room, guests, seats: newSeats, birthday, cakeNote: birthday ? (cakeNote || "") : "", restrictions, notes, lang: lang || "en", tableGroup: sortedGroup, extrasConfirmed: ec };
    }));
    setResModal(null);
  };

  // ── Service date ──────────────────────────────────────────────────────────
  const persistServiceDate = async (date) => {
    setServiceDate(date);
    try {
      if (date) localStorage.setItem("milka_service_date", date);
      else      localStorage.removeItem("milka_service_date");
    } catch {}
    if (!supabase) return;
    await supabase.from("service_settings")
      .upsert({ id: "service_date", state: date ? { date } : {}, updated_at: new Date().toISOString() }, { onConflict: "id" });
  };

  // ── Reservations CRUD ─────────────────────────────────────────────────────
  const upsertReservation = async ({ id, date, table_id, data: rData }) => {
    const dbRow = { date, table_id, data: rData };
    if (id) {
      if (supabase) {
        const { error } = await supabase.from("reservations").update(dbRow).eq("id", id);
        if (!error) setReservations(prev => prev.map(r => r.id === id ? { ...r, ...dbRow } : r));
        return { ok: !error, error };
      }
      setReservations(prev => prev.map(r => r.id === id ? { ...r, ...dbRow } : r));
      return { ok: true };
    }
    if (supabase) {
      const { data: inserted, error } = await supabase.from("reservations").insert(dbRow).select().single();
      if (!error && inserted) setReservations(prev => [...prev, inserted]);
      return { ok: !error, error, data: inserted };
    }
    const local = { ...dbRow, id: crypto.randomUUID(), created_at: new Date().toISOString() };
    setReservations(prev => [...prev, local]);
    return { ok: true, data: local };
  };

  const deleteReservation = async (id) => {
    setReservations(prev => prev.filter(r => r.id !== id));
    if (!supabase) return { ok: true };
    const { error } = await supabase.from("reservations").delete().eq("id", id);
    return { ok: !error };
  };

  // Apply reservation data to tables that are still blank (not yet active / named)
  const prePopulateFromReservations = (rows) => {
    if (!rows?.length) return;
    setTables(prev => {
      let next = [...prev];
      for (const row of rows) {
        const d = row.data || {};
        const group = (d.tableGroup?.length > 1 ? d.tableGroup : [row.table_id]).map(Number);
        for (const tid of group) {
          const idx = next.findIndex(t => t.id === tid);
          if (idx === -1) continue;
          const t = next[idx];
          if (t.active || t.resName) continue; // never overwrite occupied / named tables
          next[idx] = {
            ...t,
            resName:            d.resName || "",
            resTime:            d.resTime || "",
            menuType:           d.menuType || "",
            lang:               d.lang || "en",
            guests:             d.guests || 2,
            guestType:          d.guestType || "",
            room:               d.room || "",
            birthday:           !!d.birthday,
            cakeNote:           d.birthday ? (d.cakeNote || "") : "",
            restrictions:       d.restrictions || [],
            notes:              d.notes || "",
            tableGroup:         group,
            courseOverrides:    d.courseOverrides || {},
            kitchenCourseNotes: d.kitchenCourseNotes || {},
            extrasConfirmed:   d.birthday ? { cake: true } : {},
            seats:              makeSeats(d.guests || 2, t.seats).map(s => {
              if (!d.birthday) return s;
              return { ...s, extras: { ...s.extras, 3: { ordered: true, pairing: "—" } } };
            }),
          };
        }
      }
      return next;
    });
  };

  // Update a field in a reservation's data AND sync to service_tables so
  // Display mode picks it up via the existing realtime subscription.
  const updTableFromReservation = (resvId, tableId, field, value) => {
    setReservations(prev => prev.map(r => {
      if (r.id !== resvId) return r;
      const newData = { ...(r.data || {}), [field]: value };
      supabase?.from("reservations").update({ data: newData }).eq("id", resvId).then(() => {});
      return { ...r, data: newData };
    }));
    // Only push to service_tables when that table already carries reservation data
    // (avoids polluting blank table rows before service starts).
    const serviceTable = tablesRef.current?.find(t => t.id === tableId);
    if (serviceTable?.resName || serviceTable?.active) {
      upd(tableId, field, value);
    }
  };

  const changeMode = nextMode => {
    // Service mode requires a locked service date
    if (nextMode === "service" && !serviceDate) {
      setPendingModeAfterDate(nextMode);
      setShowServiceDatePicker(true);
      return;
    }
    setMode(nextMode);
    try {
      if (nextMode) localStorage.setItem("milka_mode", nextMode);
      else          localStorage.removeItem("milka_mode");
    } catch {}
    // Pre-populate tables from reservations when entering live modes
    if ((nextMode === "service" || nextMode === "display") && serviceDate && supabase) {
      supabase.from("reservations").select("*").eq("date", serviceDate)
        .then(({ data }) => { if (data?.length) prePopulateFromReservations(data); });
    }
  };

  const switchMode = () => { changeMode(null); setSel(null); };

  // ── Persist locally + sync changed tables to Supabase ─────────────────────
  useEffect(() => {
    if (!hydrated) return;

    writeLocalBoardState(boardStateRef.current);

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


  // ── Load logo on startup (Supabase → fallback to /logo.svg) ─────────────────
  useEffect(() => {
    const loadDefault = () =>
      fetch("/logo.svg").then(r => r.text())
        .then(svg => setLogoDataUri(`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`))
        .catch(() => {});
    if (!supabase) { loadDefault(); return; }
    supabase.from("service_settings").select("state").eq("id", "menu_logo").single()
      .then(({ data }) => { data?.state?.dataUri ? setLogoDataUri(data.state.dataUri) : loadDefault(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveLogo = async (dataUri) => {
    setLogoDataUri(dataUri);
    if (!supabase) return;
    await supabase.from("service_settings")
      .upsert({ id: "menu_logo", state: { dataUri }, updated_at: new Date().toISOString() }, { onConflict: "id" });
  };

  // ── Load print layout from Supabase on mount ─────────────────────────────
  useEffect(() => {
    if (!supabase) { layoutLoaded.current = true; return; }
    supabase.from("service_settings").select("state").eq("id", "menu_layout_global").maybeSingle()
      .then(({ data, error }) => {
        if (error) console.error("Layout load error:", error);
        if (data?.state && Object.keys(data.state).length > 0) setGlobalLayout(data.state);
        layoutLoaded.current = true;
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist layout to localStorage
  useEffect(() => {
    try { localStorage.setItem("milka_menu_layout", JSON.stringify(globalLayout)); } catch {}
  }, [globalLayout]);

  const saveGlobalLayout = async () => {
    setLayoutSaving(true); setLayoutSaved(false);
    const toSave = globalLayoutRef.current;
    if (supabase) {
      const { error } = await supabase.from("service_settings")
        .upsert({ id: "menu_layout_global", state: toSave, updated_at: new Date().toISOString() }, { onConflict: "id" });
      if (error) { console.error("Layout save failed:", error); setLayoutSaving(false); return; }
    }
    setLayoutSaving(false); setLayoutSaved(true);
    setTimeout(() => setLayoutSaved(false), 2500);
  };


  // ── Menu template v2 (row-based canvas editor) ───────────────────────────
  const [menuTemplate, setMenuTemplate] = useState(() => {
    try { return JSON.parse(localStorage.getItem("milka_menu_template_v2") || "null"); } catch { return null; }
  });
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateSaved,  setTemplateSaved]  = useState(false);
  const menuTemplateRef = useRef(menuTemplate);
  menuTemplateRef.current = menuTemplate;

  useEffect(() => {
    if (!supabase) return;
    supabase.from("service_settings").select("state").eq("id", "menu_layout_v2").maybeSingle()
      .then(({ data }) => {
        if (data?.state?.version === 2) {
          setMenuTemplate(data.state);
          try { localStorage.setItem("milka_menu_template_v2", JSON.stringify(data.state)); } catch {}
        }
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!menuTemplate) return;
    try { localStorage.setItem("milka_menu_template_v2", JSON.stringify(menuTemplate)); } catch {}
  }, [menuTemplate]);

  const saveMenuTemplate = async () => {
    setTemplateSaving(true); setTemplateSaved(false);
    const toSave = menuTemplateRef.current;
    if (!toSave) { setTemplateSaving(false); return; }
    if (supabase) {
      const { error } = await supabase.from("service_settings")
        .upsert({ id: "menu_layout_v2", state: toSave, updated_at: new Date().toISOString() }, { onConflict: "id" });
      if (error) { console.error("Template save failed:", error); setTemplateSaving(false); return; }
    }
    setTemplateSaving(false); setTemplateSaved(true);
    setTimeout(() => setTemplateSaved(false), 2500);
  };

  // ── Menu generation rules (layout behavior) ───────────────────────────────
  useEffect(() => {
    try { localStorage.setItem("milka_menu_rules", JSON.stringify(menuRules)); } catch {}
  }, [menuRules]);

  useEffect(() => {
    if (!supabase) return;
    supabase.from("service_settings").select("state").eq("id", "menu_gen_rules").maybeSingle()
      .then(({ data }) => {
        if (data?.state && typeof data.state === "object") {
          setMenuRules(normalizeMenuRules(data.state));
          try { localStorage.setItem("milka_menu_rules", JSON.stringify(data.state)); } catch {}
        }
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateMenuRules = (nextRules) => {
    if (typeof nextRules === "function") {
      setMenuRules(prev => normalizeMenuRules(nextRules(prev)));
      return;
    }
    setMenuRules(normalizeMenuRules(nextRules));
  };

  const saveMenuRules = async () => {
    setMenuRulesSaving(true);
    setMenuRulesSaved(false);
    if (supabase) {
      const { error } = await supabase.from("service_settings")
        .upsert({ id: "menu_gen_rules", state: menuRulesRef.current, updated_at: new Date().toISOString() }, { onConflict: "id" });
      if (error) {
        console.error("Menu rules save failed:", error);
        setMenuRulesSaving(false);
        return;
      }
    }
    setMenuRulesSaving(false);
    setMenuRulesSaved(true);
    setTimeout(() => setMenuRulesSaved(false), 2500);
  };

  // ── Quick Access persistence ──────────────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem("milka_quick_access", JSON.stringify(quickAccessItems)); } catch {}
  }, [quickAccessItems]);

  useEffect(() => {
    if (!supabase) return;
    supabase.from("service_settings").select("state").eq("id", "quick_access").maybeSingle()
      .then(({ data }) => {
        if (data?.state?.items?.length) setQuickAccessItems(data.state.items);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateQuickAccess = (items) => {
    setQuickAccessItems(items);
    if (supabase) {
      supabase.from("service_settings")
        .upsert({ id: "quick_access", state: { items }, updated_at: new Date().toISOString() }, { onConflict: "id" })
        .then(() => {});
    }
  };

  // ── Aperitif quick-button options (data-driven from Quick Access config) ──
  // aperitifOptions: array of { label, searchKey, type } — preserves searchKey from config
  const aperitifOptions = useMemo(() => {
    const fromQuickAccess = quickAccessItems.filter(i => i.enabled)
      .map(i => ({ label: i.label, searchKey: i.searchKey || i.label, type: i.type || "wine" }));
    if (fromQuickAccess.length > 0) return fromQuickAccess;
    // Fallback to aperitif_btn column from courses
    const fromSheet = [...new Set(menuCourses.map(c => c.aperitif_btn).filter(Boolean))].slice(0, 4);
    if (fromSheet.length > 0) return fromSheet.map(l => ({ label: l, searchKey: l, type: "wine" }));
    return DEFAULT_QUICK_ACCESS_ITEMS.filter(i => i.enabled).map(i => ({ label: i.label, searchKey: i.searchKey || i.label, type: i.type || "wine" }));
  }, [quickAccessItems, menuCourses]);

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
        // Only update the specific table's entry — do NOT overwrite other tables'
        // entries so locally-pending changes for those tables are not silently dropped.
        const remoteIdx = tablesRef.current.findIndex(t => t.id === Number(payload.new.table_id));
        if (remoteIdx !== -1) {
          const next = [...prevTablesJsonRef.current];
          next[remoteIdx] = JSON.stringify(sanitizeTable({ id: Number(payload.new.table_id), ...(payload.new.data || {}) }));
          prevTablesJsonRef.current = next;
        }
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
      if (!mounted || error || !data) return;
      const byCat = cat => data
        .filter(r => r.category === cat)
        .map((r, i) => ({ id: r.id, name: r.name, notes: r.notes || "", position: r.position ?? i }));
      const c = byCat("cocktail");
      const s = byCat("spirit");
      const b = byCat("beer");
      setCocktails(c);
      setSpirits(s);
      setBeers(b);
      writeLocalBeverages({ cocktails: c, spirits: s, beers: b });
    };

    loadBevs();

    const bevChannel = supabase.channel("milka-beverages")
      .on("postgres_changes", { event: "*", schema: "public", table: "beverages" }, loadBevs)
      .subscribe();

    return () => { mounted = false; supabase.removeChannel(bevChannel); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Wines: load from Supabase wines table + realtime ─────────────────────────
  const loadWines = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("wines")
      .select("key, name, wine_name, producer, vintage, region, country, by_glass")
      .order("name", { ascending: true });
    if (error || !data) return;
    setWines(data.map(r => ({
      id: r.key, name: r.wine_name || r.name,
      producer: r.producer || "", vintage: r.vintage || "",
      region: r.region || "", country: r.country || "",
      byGlass: r.by_glass ?? false,
    })));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!supabase) return;
    loadWines();
    const wineChannel = supabase.channel("milka-wines")
      .on("postgres_changes", { event: "*", schema: "public", table: "wines" }, loadWines)
      .subscribe();
    return () => supabase.removeChannel(wineChannel);
  }, [loadWines]);

  // ── Service date + reservations: load from Supabase + realtime ──────────────
  useEffect(() => {
    if (!supabase) return;
    let mounted = true;

    // Restore service date saved by a previous session
    supabase.from("service_settings").select("state").eq("id", "service_date").single()
      .then(({ data }) => {
        if (!mounted || !data?.state?.date) return;
        setServiceDate(d => d || data.state.date); // local state wins if already set
        try { localStorage.setItem("milka_service_date", data.state.date); } catch {}
      });

    // Load reservations for -7 days … +30 days so the planner is pre-populated
    const past   = new Date(); past.setDate(past.getDate() - 7);
    const future = new Date(); future.setDate(future.getDate() + 30);
    supabase.from("reservations").select("*")
      .gte("date", toLocalDateISO(past))
      .lte("date", toLocalDateISO(future))
      .order("date").order("created_at")
      .then(({ data, error }) => {
        if (!mounted || error || !data) return;
        setReservations(data);
      });

    const ch = supabase.channel("milka-reservations")
      .on("postgres_changes", { event: "*", schema: "public", table: "reservations" }, payload => {
        if (!mounted) return;
        if (payload.eventType === "DELETE") {
          setReservations(prev => prev.filter(r => r.id !== payload.old?.id));
        } else if (payload.new) {
          setReservations(prev => {
            const without = prev.filter(r => r.id !== payload.new.id);
            return [...without, payload.new];
          });
        }
      })
      .subscribe();

    return () => { mounted = false; supabase.removeChannel(ch); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Menu courses: load from Supabase (app is the source of truth) ───────────
  useEffect(() => {
    let mounted = true;

    const loadCourses = async () => {
      try {
        const courses = await fetchMenuCourses();
        if (!mounted || !courses) return;
        setMenuCourses(courses);
        // Auto-generate template v2 from courses if none stored yet
        if (courses.length > 0 && !menuTemplateRef.current?.rows?.length) {
          const tmpl = buildDefaultTemplate(courses);
          if (mounted) {
            setMenuTemplate(tmpl);
            try { localStorage.setItem("milka_menu_template_v2", JSON.stringify(tmpl)); } catch {}
          }
        }
      } catch (error) {
        console.warn("Menu courses fetch failed:", error);
      }
    };

    loadCourses();

    // Subscribe to realtime changes so edits from other devices appear instantly
    if (!supabase) return;
    const ch = supabase.channel("milka-menu-courses")
      .on("postgres_changes", { event: "*", schema: "public", table: "menu_courses" }, () => {
        if (mounted) loadCourses();
      })
      .subscribe();

    return () => { mounted = false; supabase.removeChannel(ch); };
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
    onInventory: () => setInventoryOpen(true),
    onSeed: seedTestData,
    onSyncAll: syncWines,
    onAddRes: () => {
      const freeTable = tables.find(t => !t.active && !t.resName && !t.resTime);
      if (freeTable) { setResModalPresetTime(null); setResModal(freeTable.id); }
      else { setResModalPresetTime(null); setResModal(tables[0].id); }
    },
  };

  // Gate 1: password wall
  if (!authed) return <GateScreen onPass={() => setAuthed(true)} />;

  // Gate 2: hydration — wait for Supabase state before rendering
  if (!hydrated) return (
    <div style={{
      minHeight: "100vh", background: "#fff", display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: FONT, gap: 24,
    }}>
      <GlobalStyle />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: 6, color: "#1a1a1a", marginBottom: 6 }}>{APP_NAME}</div>
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

  const serviceDatePickerEl = showServiceDatePicker ? (
    <ServiceDatePicker
      defaultDate={toLocalDateISO()}
      reservations={reservations}
      onConfirm={async (date) => {
        await persistServiceDate(date);
        setShowServiceDatePicker(false);
        const target = pendingModeAfterDate;
        setPendingModeAfterDate(null);
        if (target) {
          setMode(target);
          try { localStorage.setItem("milka_mode", target); } catch {}
          if ((target === "service" || target === "display") && supabase) {
            supabase.from("reservations").select("*").eq("date", date)
              .then(({ data }) => { if (data?.length) prePopulateFromReservations(data); });
          }
        }
      }}
      onCancel={() => { setShowServiceDatePicker(false); setPendingModeAfterDate(null); }}
    />
  ) : null;

  if (!mode) return <>{serviceDatePickerEl}<LoginScreen onEnter={m => { changeMode(m); setSel(null); }} onSyncAll={syncWines} /></>;

  // Reservation Manager mode
  if (mode === "reservation") return (<>{serviceDatePickerEl}<ReservationManager
      reservations={reservations}
      menuCourses={menuCourses}
      tables={tables}
      onUpsert={upsertReservation}
      onDelete={deleteReservation}
      onUpdReservation={updTableFromReservation}
      onExit={() => changeMode(null)}
      serviceDate={serviceDate}
      onSetServiceDate={persistServiceDate}
    /></>);

  // Display mode — unified board+kitchen view
  if (mode === "display") return (<>
    {serviceDatePickerEl}
    <div style={{ minHeight: "100vh", background: "#fff", fontFamily: FONT, overflowX: "hidden", WebkitTextSizeAdjust: "100%" }}>
      <GlobalStyle />
      <Header modeLabel="DISPLAY" showSummary={false} showMenu={false} showArchive={true} showInventory={false} {...hProps} />
      <div style={{ padding: "20px 24px" }}>
        <KitchenBoard tables={tables} menuCourses={menuCourses} upd={upd} updMany={updMany} />
      </div>
      {archiveOpen && (
        <ArchiveModal
          tables={tables} dishes={dishes}
          onArchiveAndClear={archiveAndClearAll}
          onClearAll={clearAll}
          onSeedTest={seedTestData}
          onClose={() => setArchiveOpen(false)}
          onRestoreTicket={id => upd(id, "kitchenArchived", false)}
          menuCourses={menuCourses}
        />
      )}
      {inventoryOpen && <InventoryModal wines={wines} onClose={() => setInventoryOpen(false)} />}
    </div>
  </>);

  if (mode === "menu") return (
    <div style={{ minHeight: "100vh", background: "#fafafa", fontFamily: FONT, overflowX: "hidden", WebkitTextSizeAdjust: "100%" }}>
      <GlobalStyle />
      <MenuPage
        tables={tables}
        menuCourses={menuCourses}
        upd={upd}
        logoDataUri={logoDataUri}
        globalLayout={globalLayout}
        menuTemplate={menuTemplate}
        wines={wines}
        cocktails={cocktails}
        spirits={spirits}
        beers={beers}
        aperitifOptions={aperitifOptions}
        menuRules={menuRules}
        onExit={() => changeMode(null)}
      />
    </div>
  );

  // ── Admin mode — pure control panel, no service UI ──
  if (mode === "admin") return (
    <div style={{ minHeight: "100vh", background: "#fff", fontFamily: FONT, overflowX: "hidden", WebkitTextSizeAdjust: "100%" }}>
      <GlobalStyle />
      <AdminLayout
        menuCourses={menuCourses}
        onUpdateMenuCourses={setMenuCourses}
        onSaveMenuCourses={saveMenuCourses}
        menuTemplate={menuTemplate}
        onUpdateTemplate={setMenuTemplate}
        onSaveTemplate={saveMenuTemplate}
        templateSaving={templateSaving}
        templateSaved={templateSaved}
        menuRules={menuRules}
        onUpdateMenuRules={updateMenuRules}
        onSaveMenuRules={saveMenuRules}
        menuRulesSaving={menuRulesSaving}
        menuRulesSaved={menuRulesSaved}
        dishes={dishes}
        onUpdateDishes={setDishes}
        wines={wines}
        cocktails={cocktails}
        spirits={spirits}
        beers={beers}
        onUpdateWines={setWines}
        onSaveBeverages={saveBeverages}
        onSyncWines={syncWines}
        syncStatus={syncStatus}
        supabaseUrl={SUPABASE_URL}
        hasSupabase={hasSupabaseConfig}
        logoDataUri={logoDataUri}
        onSaveLogo={saveLogo}
        layoutStyles={globalLayout}
        onUpdateLayoutStyles={setGlobalLayout}
        onSaveLayoutStyles={saveGlobalLayout}
        onResetMenuLayout={() => {
          setGlobalLayout({});
          try { localStorage.removeItem("milka_menu_layout"); } catch {}
          if (supabase) supabase.from("service_settings").upsert({ id: "menu_layout_global", state: {}, updated_at: new Date().toISOString() }, { onConflict: "id" }).then(() => {});
        }}
        quickAccessItems={quickAccessItems}
        onUpdateQuickAccess={updateQuickAccess}
        onExit={() => changeMode(null)}
      />
    </div>
  );

  // Service mode only
  return (<>
    {serviceDatePickerEl}
    <div style={{ minHeight: "100vh", background: "#fff", fontFamily: FONT, overflowX: "hidden", WebkitTextSizeAdjust: "100%" }}>
      <GlobalStyle />

      <Header
        modeLabel="SERVICE"
        showSummary={true}
        showAddRes={false}
        showMenu={false}
        showArchive={true}
        showInventory={false}
        showSeed={false}
        showSync={true}
        showEndService={true}
        onEndService={endService}
        {...hProps}
      />

      {sel === null ? (
        <div style={{ padding: "20px 24px", maxWidth: 1100, margin: "0 auto", overflowX: "hidden" }}>
          {/* Top bar: stats + Quick Access toggle */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
            <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
              {serviceDate && (
                <span
                  title="Click to change service date"
                  onClick={() => { setPendingModeAfterDate(mode); setShowServiceDatePicker(true); }}
                  style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#7aaa8a", cursor: "pointer", textTransform: "uppercase" }}
                >
                  {new Date(serviceDate + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).toUpperCase()}
                </span>
              )}
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

          {/* Service DisplayBoard */}
          {(() => {
            const visibleTables = tables
              .filter(t => t.active || t.resName || t.resTime)
              .filter(t => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup));

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
                aperitifOptions={aperitifOptions}
                wines={wines}
                cocktails={cocktails}
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
          menuCourses={menuCourses}
          aperitifOptions={aperitifOptions}
          mode={mode}
          onBack={() => setSel(null)}
          upd={(f, v) => upd(sel, f, v)}
          updSeat={(sid, f, v) => updSeat(sel, sid, f, v)}
          setGuests={n => setGuests(sel, n)}
          swapSeats={(aId, bId) => swapSeats(sel, aId, bId)}
          onApplySeatToAll={(tableId, sourceSeatId) => applySeatTemplateToAll(tableId, sourceSeatId)}
          onClearBeverages={tableId => clearSeatBeverages(tableId)}
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
          onSeedTest={seedTestData}
          onClose={() => setArchiveOpen(false)}
          onRestoreTicket={id => upd(id, "kitchenArchived", false)}
          menuCourses={menuCourses}
        />
      )}
      {inventoryOpen && <InventoryModal wines={wines} onClose={() => setInventoryOpen(false)} />}
    </div>
  </>);
}
