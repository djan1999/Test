import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import {
  RESTRICTION_KEYS, normalizeCourseCategory,
  normalizeOptionalKey, optionalPairingsFromCourses,
} from "./utils/menuUtils.js";
import { DEFAULT_MENU_RULES, normalizeMenuRules } from "./utils/menuGenerator.js";
import { buildDefaultTemplate } from "./utils/menuTemplateSchema.js";
import {
  readLocalBeverages, writeLocalBeverages,
  readLocalBoardState, writeLocalBoardState,
  STORAGE_KEY,
} from "./utils/storage.js";
import { makeSeats, blankTable, sanitizeTable, initTables, fmt } from "./utils/tableHelpers.js";
import {
  resolveAperitifFromQuickAccessOption,
  aperitifMatchesQuickAccessOption,
} from "./utils/quickAccessResolve.js";
import { useIsMobile, BP } from "./hooks/useIsMobile.js";
import { useRealtimeTable } from "./hooks/useRealtimeTable.js";
import { useOfflineQueue } from "./hooks/useOfflineQueue.js";
import { useModalEscape } from "./hooks/useModalEscape.js";
import { AdminLayout } from "./components/admin/index.js";
import { DIETARY_KEYS, RESTRICTIONS, RESTRICTION_GROUPS, restrLabel, restrCompact } from "./constants/dietary.js";
import { WATER_OPTS, waterStyle, PAIRINGS, pairingStyle } from "./constants/pairings.js";
import { BEV_TYPES } from "./constants/beverageTypes.js";
import { supabase, hasSupabaseConfig, supabaseUrl, TABLES } from "./lib/supabaseClient.js";
import { tokens } from "./styles/tokens.js";
import { baseInput, fieldLabel as mixinFieldLabel, chip as mixinChip, circleButton as mixinCircleButton } from "./styles/mixins.js";
import WaterPicker from "./components/service/WaterPicker.jsx";
import SwapPicker from "./components/service/SwapPicker.jsx";
import KitchenBoard from "./components/kitchen/KitchenBoard.jsx";
import ServiceDatePicker from "./components/reservations/ServiceDatePicker.jsx";
import ReservationManager from "./components/reservations/ReservationManager.jsx";
import SummaryModal from "./components/modals/SummaryModal.jsx";
import ArchiveModal from "./components/modals/ArchiveModal.jsx";
import InventoryModal from "./components/modals/InventoryModal.jsx";
import Header from "./components/ui/Header.jsx";
import GlobalStyle from "./components/ui/GlobalStyle.jsx";
import GateScreen from "./components/gate/GateScreen.jsx";
import LoginScreen from "./components/login/LoginScreen.jsx";
import MenuPage from "./components/menu/MenuPage.jsx";
import MenuGenerator from "./components/menu/MenuGenerator.jsx";
import WineSearch from "./components/service/WineSearch.jsx";
import BeverageSearch from "./components/service/BeverageSearch.jsx";
import TableCard from "./components/TableCard/TableCard.jsx";
import SheetView from "./components/service/SheetView.jsx";

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
        linkedKey: item?.linkedKey != null && String(item.linkedKey).trim() !== "" ? String(item.linkedKey).trim() : undefined,
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
const MENU_LAYOUT_PROFILES_KEY = "milka_menu_layout_profiles_v1";
const MENU_ACTIVE_LAYOUT_PROFILE_KEY = "milka_active_layout_profile_v1";
const SYNC_CONFIG_KEY = "milka_sync_config_v1";
const DEFAULT_SYNC_CONFIG = {
  winesEnabled: true,
  beveragesEnabled: true,
  wineCountries: ["SI", "AT", "IT", "FR", "HR"],
  beveragePages: [
    { category: "cocktail", label: "Cocktail", url: "https://vinska-karta.hotelmilka.si/category/cocktails/" },
    { category: "beer", label: "Beer", url: "https://vinska-karta.hotelmilka.si/category/pivo/" },
    { category: "spirit", label: "Whisky", url: "https://vinska-karta.hotelmilka.si/category/viski" },
    { category: "spirit", label: "Cognac / Brandy", url: "https://vinska-karta.hotelmilka.si/category/cognac" },
    { category: "spirit", label: "Rum", url: "https://vinska-karta.hotelmilka.si/category/rum" },
    { category: "spirit", label: "Agave", url: "https://vinska-karta.hotelmilka.si/category/agave" },
    { category: "spirit", label: "Gin", url: "https://vinska-karta.hotelmilka.si/category/gin" },
    { category: "spirit", label: "Vodka", url: "https://vinska-karta.hotelmilka.si/category/vodka" },
    { category: "spirit", label: "Other", url: "https://vinska-karta.hotelmilka.si/category/other-ostalo" },
    { category: "spirit", label: "Liqueur", url: "https://vinska-karta.hotelmilka.si/category/likerji" },
  ],
};

const normalizeSyncConfig = (raw) => {
  const cfg = raw && typeof raw === "object" ? raw : {};
  const countries = Array.isArray(cfg.wineCountries) ? cfg.wineCountries : DEFAULT_SYNC_CONFIG.wineCountries;
  const beveragePages = Array.isArray(cfg.beveragePages) ? cfg.beveragePages : DEFAULT_SYNC_CONFIG.beveragePages;
  return {
    winesEnabled: cfg.winesEnabled !== false,
    beveragesEnabled: cfg.beveragesEnabled !== false,
    wineCountries: countries.map(c => String(c || "").trim().toUpperCase()).filter(Boolean),
    beveragePages: beveragePages
      .map((p) => ({
        category: String(p?.category || "").trim().toLowerCase(),
        label: String(p?.label || "").trim(),
        url: String(p?.url || "").trim(),
      }))
      .filter((p) => p.category && p.label && p.url),
  };
};

const toSyncConfigEditor = (cfg) => ({
  countriesCsv: (cfg.wineCountries || []).join(","),
  beverageSourcesText: (cfg.beveragePages || [])
    .map((p) => `${p.label}|${p.url}|${p.category}`)
    .join("\n"),
});

const fromSyncConfigEditor = (editor) => {
  const countries = String(editor?.countriesCsv || "")
    .split(",")
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean);
  const beveragePages = String(editor?.beverageSourcesText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [label, url, category] = line.split("|").map((v) => String(v || "").trim());
      return { label, url, category: category.toLowerCase() };
    })
    .filter((row) => row.label && row.url && row.category);
  return normalizeSyncConfig({
    wineCountries: countries.length > 0 ? countries : DEFAULT_SYNC_CONFIG.wineCountries,
    beveragePages: beveragePages.length > 0 ? beveragePages : DEFAULT_SYNC_CONFIG.beveragePages,
  });
};

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
    course_category: normalizeCourseCategory(r.course_category, r.optional_flag || ""),
    optional_flag: r.optional_flag || "",
    optional_pairing_flag: r.optional_pairing_flag || "",
    optional_pairing_label: r.optional_pairing_label || "",
    optional_pairing_enabled: r.optional_pairing_enabled !== false,
    optional_pairing_default_on: r.optional_pairing_default_on !== false,
    optional_pairing_alco: r.optional_pairing_alco || null,
    optional_pairing_alco_si: r.optional_pairing_alco_si || null,
    optional_pairing_na: r.optional_pairing_na || null,
    optional_pairing_na_si: r.optional_pairing_na_si || null,
    section_gap_before: false,
    show_on_short: !!r.show_on_short,
    short_order: r.short_order || null,
    force_pairing_title: r.force_pairing_title || "",
    force_pairing_sub: r.force_pairing_sub || "",
    force_pairing_title_si: r.force_pairing_title_si || "",
    force_pairing_sub_si: r.force_pairing_sub_si || "",
    kitchen_note: r.kitchen_note || "",
    aperitif_btn: r.aperitif_btn || null,
    is_active: r.is_active !== false,
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
    course_category: normalizeCourseCategory(course.course_category, course.optional_flag),
    optional_flag: course.optional_flag,
    optional_pairing_flag: course.optional_pairing_flag || "",
    optional_pairing_label: course.optional_pairing_label || "",
    optional_pairing_enabled: course.optional_pairing_enabled !== false,
    optional_pairing_default_on: course.optional_pairing_default_on !== false,
    optional_pairing_alco: course.optional_pairing_alco || null,
    optional_pairing_alco_si: course.optional_pairing_alco_si || null,
    optional_pairing_na: course.optional_pairing_na || null,
    optional_pairing_na_si: course.optional_pairing_na_si || null,
    section_gap_before: false,
    show_on_short: course.show_on_short,
    short_order: course.short_order,
    force_pairing_title: course.force_pairing_title,
    force_pairing_sub: course.force_pairing_sub,
    force_pairing_title_si: course.force_pairing_title_si,
    force_pairing_sub_si: course.force_pairing_sub_si,
    kitchen_note: course.kitchen_note,
    aperitif_btn: course.aperitif_btn,
    is_active: course.is_active !== false,
    restrictions_si,
  };
  DIETARY_KEYS.forEach(k => { row[k] = course.restrictions?.[k] ?? null; });
  return row;
}

async function fetchMenuCourses() {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from(TABLES.MENU_COURSES)
    .select("*")
    .order("position", { ascending: true });
  if (error) throw error;
  return (data || []).map(supabaseRowToCourse);
}


const FONT = tokens.font;

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


// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Shared styles ─────────────────────────────────────────────────────────────
const baseInp = { ...baseInput };
const fieldLabel = { ...mixinFieldLabel };
const topStatChip = { ...mixinChip };
const statusPill = (isLive, label) => ({
  fontFamily: FONT,
  fontSize: 9,
  letterSpacing: 2,
  padding: "6px 10px",
  border: `1px solid ${isLive ? tokens.green.border : tokens.neutral[300]}`,
  borderRadius: 0,
  background: isLive ? tokens.green.bg : tokens.neutral[50],
  color: isLive ? tokens.green.text : tokens.text.secondary,
  fontWeight: 600,
  whiteSpace: "nowrap",
});

const defaultBoardState = () => ({
  tables: initTables,
  dishes: [],
  wines: initWines,
  cocktails: initCocktails,
  spirits: initSpirits,
  beers: initBeers,
});

const isPearOptionalKey = (key) => {
  if (!key) return false;
  const k = String(key).toLowerCase();
  return k === "pear" || k.startsWith("pear_") || k.endsWith("_pear") || k.includes("_pear_");
};

function optionalExtrasFromCourses(menuCourses = []) {
  const byKey = new Map();
  (menuCourses || []).forEach((c) => {
    const category = normalizeCourseCategory(c?.course_category, c?.optional_flag);
    if (category !== "optional") return;
    const key = normalizeOptionalKey(c?.optional_flag);
    if (!key || isPearOptionalKey(key)) return;
    const existing = byKey.get(key) || null;
    const label = String(c?.menu?.name || existing?.name || key).trim() || key;
    const pairings = [
      "—",
      c?.wp ? "Wine" : null,
      c?.na ? "Non-Alc" : null,
      c?.premium ? "Premium" : null,
      c?.os ? "Our Story" : null,
    ].filter(Boolean);
    byKey.set(key, {
      id: key,
      key,
      name: label,
      pairings: pairings.length > 0 ? pairings : ["—"],
    });
  });
  return [...byKey.values()];
}

const circBtnSm = { ...mixinCircleButton };
// ── Detail View ───────────────────────────────────────────────────────────────
function Detail({ table, optionalExtras = [], optionalPairings = [], wines = [], cocktails = [], spirits = [], beers = [], menuCourses = MENU_DATA, aperitifOptions = [], mode, onBack, upd, updSeat, setGuests, swapSeats, onApplySeatToAll, onClearBeverages }) {
  const isMobile = useIsMobile(860);
  const isNarrow = useIsMobile(520);
  const row1 = isNarrow ? "30px 1fr 28px" : isMobile ? "34px 68px 1fr 28px" : "38px 75px 1fr 28px";
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
    <div style={{ maxWidth: 860, margin: "0 auto", padding: isMobile ? "0 0 28px" : "0 0 40px", overflowX: "hidden" }}>
      {/* [TABLE] header bar */}
      <div style={{
        borderBottom: `1px solid ${tokens.ink[4]}`,
        padding: isMobile ? "10px 12px" : "10px 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: tokens.neutral[0], marginBottom: 0, gap: 12,
      }}>
        <button onClick={onBack} style={{
          background: "none", border: "none", cursor: "pointer",
          fontFamily: FONT, fontSize: "9px", color: tokens.ink[3],
          letterSpacing: "0.12em", padding: 0, textTransform: "uppercase",
        }}>← TABLES</button>

        {/* Table number */}
        <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
          <span style={{
            fontFamily: FONT, fontSize: isMobile ? "28px" : "36px",
            fontWeight: 700, color: tokens.ink[0], letterSpacing: "-0.02em", lineHeight: 1,
          }}>T{String(table.id).padStart(2, "0")}</span>
          {mode === "service" && (
            <span style={{
              fontFamily: FONT, fontSize: "9px", letterSpacing: "0.10em",
              color: tokens.ink[3], textTransform: "uppercase",
            }}>{table.guests} PAX</span>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {mode === "admin" && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button onClick={() => setGuests(Math.max(1, table.guests - 1))} style={circBtnSm}>−</button>
              <span style={{ fontFamily: FONT, fontSize: 11, color: tokens.text.body, letterSpacing: 1, minWidth: 60, textAlign: "center" }}>
                {table.guests} guests
              </span>
              <button onClick={() => setGuests(Math.min(14, table.guests + 1))} style={circBtnSm}>+</button>
            </div>
          )}
          <button
            onClick={() => onApplySeatToAll && onApplySeatToAll(table.id, 1)}
            disabled={!canApplySeatToAll}
            style={{
              fontFamily: FONT, fontSize: "9px", letterSpacing: "0.10em",
              padding: isMobile ? "10px 10px" : "6px 10px",
              border: `1px solid ${tokens.ink[4]}`, borderRadius: 0,
              cursor: canApplySeatToAll ? "pointer" : "not-allowed",
              background: tokens.neutral[0], color: tokens.ink[2],
              opacity: canApplySeatToAll ? 1 : 0.4,
              textTransform: "uppercase", touchAction: "manipulation",
            }}
          >[P1→ALL]</button>
          <button
            onClick={() => onClearBeverages && onClearBeverages(table.id)}
            disabled={!onClearBeverages || !hasAnyBeverageData}
            style={{
              fontFamily: FONT, fontSize: "9px", letterSpacing: "0.10em",
              padding: isMobile ? "10px 10px" : "6px 10px",
              border: `1px solid ${tokens.red.border}`, borderRadius: 0,
              cursor: (onClearBeverages && hasAnyBeverageData) ? "pointer" : "not-allowed",
              background: tokens.neutral[0], color: tokens.red.text,
              opacity: (onClearBeverages && hasAnyBeverageData) ? 1 : 0.4,
              textTransform: "uppercase", touchAction: "manipulation",
            }}
          >CLEAR DRINKS</button>
        </div>
      </div>

      {/* [GUEST DOSSIER] strip */}
      {(table.resName || table.resTime || table.arrivedAt || table.menuType) && (
        <div style={{
          display: "flex", gap: 0, alignItems: "stretch",
          borderBottom: `1px solid ${tokens.ink[4]}`,
          background: tokens.neutral[0],
          marginBottom: 0,
          flexWrap: "wrap",
        }}>
          {/* Label */}
          <div style={{
            padding: isMobile ? "10px 12px" : "10px 20px",
            borderRight: `1px solid ${tokens.ink[4]}`,
            display: "flex", alignItems: "center",
            flexShrink: 0,
          }}>
            <span style={{
              fontFamily: FONT, fontSize: "8px", letterSpacing: "0.16em",
              textTransform: "uppercase", color: tokens.ink[3], fontWeight: 400,
            }}>[DOSSIER]</span>
          </div>
          {/* Fields */}
          <div style={{
            display: "flex", gap: 0, alignItems: "stretch", flexWrap: "wrap", flex: 1,
          }}>
            {table.resName && (
              <div style={{ padding: isMobile ? "8px 12px" : "8px 16px", borderRight: `1px solid ${tokens.ink[4]}` }}>
                <div style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.12em", color: tokens.ink[3], textTransform: "uppercase", marginBottom: 3 }}>NAME</div>
                <div style={{ fontFamily: FONT, fontSize: "13px", fontWeight: 500, color: tokens.ink[0], lineHeight: 1.2 }}>
                  {table.resName}
                  {table.guestType === "hotel" && (() => {
                    const rs = Array.isArray(table.rooms) && table.rooms.length ? table.rooms.filter(Boolean) : (table.room ? [table.room] : []);
                    return rs.length ? <span style={{ fontFamily: FONT, fontSize: "9px", color: tokens.ink[3], marginLeft: 8 }}>· #{rs.join(", ")}</span> : null;
                  })()}
                </div>
              </div>
            )}
            {table.resTime && (
              <div style={{ padding: isMobile ? "8px 12px" : "8px 16px", borderRight: `1px solid ${tokens.ink[4]}` }}>
                <div style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.12em", color: tokens.ink[3], textTransform: "uppercase", marginBottom: 3 }}>TIME</div>
                <div style={{ fontFamily: FONT, fontSize: "13px", fontWeight: 500, color: tokens.ink[0], lineHeight: 1.2 }}>{table.resTime}</div>
              </div>
            )}
            {table.menuType && (
              <div style={{ padding: isMobile ? "8px 12px" : "8px 16px", borderRight: `1px solid ${tokens.ink[4]}` }}>
                <div style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.12em", color: tokens.ink[3], textTransform: "uppercase", marginBottom: 3 }}>MENU</div>
                <div style={{ fontFamily: FONT, fontSize: "13px", fontWeight: 500, color: tokens.ink[0], lineHeight: 1.2, textTransform: "uppercase" }}>{table.menuType}</div>
              </div>
            )}
            {table.arrivedAt && (
              <div style={{ padding: isMobile ? "8px 12px" : "8px 16px" }}>
                <div style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.12em", color: tokens.ink[3], textTransform: "uppercase", marginBottom: 3 }}>ARRIVED</div>
                <div style={{ fontFamily: FONT, fontSize: "13px", fontWeight: 500, color: tokens.green.text, lineHeight: 1.2 }}>{table.arrivedAt}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* [ALL WATER] strip */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        borderBottom: `1px solid ${tokens.ink[4]}`,
        padding: isMobile ? "8px 12px" : "8px 20px",
        background: tokens.neutral[50],
      }}>
        <span style={{
          fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em",
          color: tokens.ink[3], textTransform: "uppercase", flexShrink: 0,
        }}>[ALL WATER]</span>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {WATER_OPTS.map(opt => {
            const allMatch = table.seats.every(s => s.water === opt);
            return (
              <button key={opt} onClick={() => table.seats.forEach(s => updSeat(s.id, "water", opt))} style={{
                fontFamily: FONT, fontSize: "9px", letterSpacing: "0.06em",
                padding: isMobile ? "9px 9px" : "5px 9px",
                border: `1px solid ${allMatch ? tokens.charcoal.default : tokens.ink[4]}`,
                borderRadius: 0, cursor: "pointer",
                background: allMatch ? tokens.tint.parchment : tokens.neutral[0],
                color: allMatch ? tokens.ink[0] : tokens.ink[3],
                fontWeight: allMatch ? 600 : 400,
                transition: "all 0.1s", touchAction: "manipulation",
              }}>{opt}</button>
            );
          })}
        </div>
      </div>

      {/* [SEATS] column header */}
      <div style={{
        display: "grid", gridTemplateColumns: row1, gap: 10, alignItems: "center",
        padding: isMobile ? "6px 12px" : "6px 20px",
        borderBottom: `1px solid ${tokens.ink[4]}`,
        background: tokens.neutral[0],
      }}>
        {(isNarrow ? ["SEAT", "WATER", ""] : ["SEAT", "WATER", "PAIRING", ""]).map((h, i) => (
          <div key={i} style={{
            fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em",
            color: tokens.ink[3], textTransform: "uppercase",
          }}>{h}</div>
        ))}
      </div>

      {/* [GUEST MATRIX] seat rows */}
      {table.seats.map((seat, si) => {
        const glasses   = seat.glasses   || [];
        const cocktailList = seat.cocktails || [];
        const spiritList   = seat.spirits   || [];
        const seatRestrictions = (table.restrictions || []).filter(r => r.pos === seat.id);
        return (
          <div key={seat.id} style={{
            borderBottom: `1px solid ${tokens.ink[4]}`,
            background: tokens.neutral[0],
          }}>
            {/* ── Line 1: P · Water · Pairing · Swap ── */}
            <div style={{
              display: "grid", gridTemplateColumns: row1, gap: 10, alignItems: "start",
              padding: isMobile ? "8px 12px" : "10px 20px",
            }}>
              {/* P position label */}
              <div style={{
                width: 28, height: 28, borderRadius: 0,
                border: `1px solid ${seatRestrictions.length ? tokens.red.border : tokens.ink[4]}`,
                background: seatRestrictions.length ? tokens.red.bg : tokens.neutral[0],
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: FONT, fontSize: "9px", fontWeight: 700,
                color: seatRestrictions.length ? tokens.red.text : tokens.ink[1],
                letterSpacing: "0.06em", flexShrink: 0, marginTop: 2,
              }}>P{seat.id}</div>

              {/* Water */}
              <WaterPicker value={seat.water} onChange={v => updSeat(seat.id, "water", v)} />

              {/* Pairing (inline on wider screens) */}
              {!isNarrow && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {PAIRINGS.map(p => {
                    const ps = pairingStyle[p];
                    const on = seat.pairing === p;
                    return (
                      <button key={p} onClick={() => updSeat(seat.id, "pairing", p)} style={{
                        fontFamily: FONT, fontSize: 9, letterSpacing: 0.5,
                        padding: "5px 8px", border: "1px solid",
                        borderColor: on ? ps.border : tokens.neutral[200], borderRadius: 0, cursor: "pointer",
                        background: on ? ps.bg : tokens.neutral[0], color: on ? ps.color : tokens.text.secondary,
                        transition: "all 0.1s",
                      }}>{p}</button>
                    );
                  })}
                  {seatRestrictions.map((r, i) => (
                    <span key={i} style={{
                      fontFamily: FONT, fontSize: 9, letterSpacing: 0.5,
                      padding: "4px 8px", borderRadius: 0,
                      background: tokens.red.bg, border: `1px solid ${tokens.red.border}`,
                      color: tokens.red.text, whiteSpace: "nowrap",
                    }}>⚠ {restrLabel(r.note)}</span>
                  ))}
                </div>
              )}

              {/* Swap */}
              {table.seats.length > 1
                ? <SwapPicker seatId={seat.id} totalSeats={table.seats.length} onSwap={t => swapSeats(seat.id, t)} />
                : <div />}
            </div>

            {/* Pairing on its own row on narrow phones */}
            {isNarrow && (
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 10 }}>
                <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: tokens.text.secondary, textTransform: "uppercase", alignSelf: "center", marginRight: 2 }}>Pairing</div>
                {PAIRINGS.map(p => {
                  const ps = pairingStyle[p];
                  const on = seat.pairing === p;
                  return (
                    <button key={p} onClick={() => updSeat(seat.id, "pairing", p)} style={{
                      fontFamily: FONT, fontSize: 9, letterSpacing: 0.5,
                      padding: "6px 10px", border: "1px solid",
                      borderColor: on ? ps.border : tokens.neutral[200], borderRadius: 0, cursor: "pointer",
                      background: on ? ps.bg : tokens.neutral[0], color: on ? ps.color : tokens.text.secondary,
                      transition: "all 0.1s",
                    }}>{p}</button>
                  );
                })}
                {seatRestrictions.map((r, i) => (
                  <span key={i} style={{
                    fontFamily: FONT, fontSize: 9, letterSpacing: 0.5,
                    padding: "5px 8px", borderRadius: 0,
                    background: tokens.red.bg, border: `1px solid ${tokens.red.border}`,
                    color: tokens.red.text, whiteSpace: "nowrap",
                  }}>⚠ {restrLabel(r.note)}</span>
                ))}
              </div>
            )}
            {/* ── Beverages + Extras ── */}
            <div style={{ paddingLeft: isMobile ? 0 : 48, display: "flex", flexDirection: "column", gap: 10 }}>
              {/* ── Aperitif ── */}
              <div style={{
                background: tokens.neutral[50],
                borderTop: `1px solid ${tokens.ink[4]}`,
                borderBottom: `1px solid ${tokens.ink[4]}`,
                padding: isMobile ? "8px 0" : "10px 0",
              }}>
                <div style={{
                  fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em",
                  textTransform: "uppercase", color: tokens.ink[3], fontWeight: 400,
                  marginBottom: 8, paddingLeft: isMobile ? 0 : 0,
                }}>[APERITIF]</div>
                {/* Quick-add buttons */}
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                  {aperitifOptions.map(ap => (
                    <button key={ap.label} onClick={() => {
                      const found = resolveAperitifFromQuickAccessOption(ap, { wines, cocktails, spirits, beers });
                      const item = found || { name: ap.searchKey || ap.label, notes: "", __cocktail: true };
                      updSeat(seat.id, "aperitifs", [...(seat.aperitifs || []), item]);
                    }} style={{
                      fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: isMobile ? "10px 9px" : "4px 9px",
                      border: `1px solid ${tokens.neutral[300]}`, borderRadius: 0, cursor: "pointer",
                      background: tokens.neutral[0], color: tokens.neutral[700], transition: "all 0.1s",
                      touchAction: "manipulation",
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
                          padding: "4px 8px 4px 10px", borderRadius: 0,
                          background: ts.bg, border: `1px solid ${ts.border}`,
                        }}>
                          <span style={{ fontFamily: FONT, fontSize: 11, color: ts.color, fontWeight: 500, whiteSpace: "nowrap" }}>
                            {label}{sub ? ` · ${sub}` : ""}
                          </span>
                          <button onClick={() => updSeat(seat.id, "aperitifs", (seat.aperitifs||[]).filter((_,idx)=>idx!==i))} style={{ background: "none", border: "none", color: ts.color, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, opacity: 0.7, width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, touchAction: "manipulation" }}>×</button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* ── By the Glass ── */}
              <div style={{
                background: tokens.neutral[0],
                borderTop: `1px solid ${tokens.ink[4]}`,
                borderBottom: `1px solid ${tokens.ink[4]}`,
                padding: isMobile ? "8px 0" : "10px 0",
              }}>
                <div style={{
                  fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em",
                  textTransform: "uppercase", color: tokens.ink[3], fontWeight: 400,
                  marginBottom: 8,
                }}>[BY THE GLASS]</div>
                <BeverageSearch
                  wines={wines} cocktails={cocktails} spirits={spirits} beers={beers}
                  onAdd={({ type, item }) => {
                    if (type === "wine" || type === "bottle") updSeat(seat.id, "glasses", [...(seat.glasses || []), item]);
                    if (type === "cocktail") updSeat(seat.id, "cocktails", [...(seat.cocktails || []), item]);
                    if (type === "spirit")   updSeat(seat.id, "spirits",   [...(seat.spirits   || []), item]);
                    if (type === "beer")     updSeat(seat.id, "beers",     [...(seat.beers     || []), item]);
                  }}
                />
                {/* By the Glass chips */}
                {(() => {
                  const allBevs = [
                    ...(seat.glasses   || []).map((x, i) => ({ key: `g${i}`,  type: x?.byGlass === false ? "bottle" : "wine", label: x?.name, sub: x?.producer, onRemove: () => updSeat(seat.id, "glasses",   (seat.glasses||[]).filter((_,idx)=>idx!==i)) })),
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
                            padding: "4px 8px 4px 10px", borderRadius: 0,
                            background: ts.bg, border: `1px solid ${ts.border}`,
                          }}>
                            <span style={{ fontFamily: FONT, fontSize: 11, color: ts.color, fontWeight: 500, whiteSpace: "nowrap" }}>
                              {bev.label}{bev.sub ? ` · ${bev.sub}` : ""}
                            </span>
                            <button onClick={bev.onRemove} style={{ background: "none", border: "none", color: ts.color, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, opacity: 0.7, width: 28, height: 28, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0, touchAction: "manipulation" }}>×</button>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>

              {/* Optional extras (derived from optional_flag) */}
              {optionalExtras.length > 0 && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {optionalExtras.map(dish => {
                    const extra = seat.extras?.[dish.key] || seat.extras?.[dish.id] || { ordered: false, pairing: dish.pairings[0] };
                    const linkedPairing = optionalPairings.find(op => op.extraKey === dish.key || op.extraKey === dish.id);
                    const lpCur = linkedPairing ? (seat.optionalPairings?.[linkedPairing.key] || {}) : null;
                    const lpMode = lpCur?.mode || null;
                    const lpActive = lpCur?.ordered ?? false;
                    const alcoOn = lpActive && lpMode === "alco";
                    const naOn = lpActive && lpMode === "nonalc";
                    const updLp = (patch) => linkedPairing && updSeat(seat.id, "optionalPairings", {
                      ...(seat.optionalPairings || {}), [linkedPairing.key]: { ...(lpCur || {}), ...patch },
                    });
                    return (
                      <div key={dish.key} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 88 }}>
                        <div style={{ ...fieldLabel, marginBottom: 4 }}>{dish.name}</div>
                        <button onClick={() => updSeat(seat.id, "extras", {
                          ...seat.extras, [dish.key]: { ...extra, ordered: !extra.ordered }
                        })} style={{
                          fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: isMobile ? "10px 8px" : "5px 8px", border: "1px solid",
                          borderColor: extra.ordered ? tokens.green.border : tokens.neutral[200], borderRadius: 0, cursor: "pointer",
                          background: extra.ordered ? tokens.green.bg : tokens.neutral[0], color: extra.ordered ? tokens.green.text : tokens.text.secondary,
                          transition: "all 0.1s", touchAction: "manipulation",
                        }}>{extra.ordered ? "YES" : "NO"}</button>
                        {linkedPairing ? (
                          <div style={{ display: "flex", gap: 3, opacity: extra.ordered ? 1 : 0.3, pointerEvents: extra.ordered ? "auto" : "none" }}>
                            <button onClick={() => updLp({ ordered: false, mode: null })} style={{
                              fontFamily: FONT, fontSize: 8, letterSpacing: 0.5, padding: isMobile ? "9px 6px" : "3px 6px", border: "1px solid",
                              borderColor: !lpActive ? tokens.green.border : tokens.neutral[200], borderRadius: 0, cursor: "pointer",
                              background: !lpActive ? tokens.green.bg : tokens.neutral[0], color: !lpActive ? tokens.green.text : tokens.text.disabled, flex: 1,
                            }}>OFF</button>
                            {linkedPairing.hasAlco && (
                              <button onClick={() => updLp({ ordered: true, mode: "alco" })} style={{
                                fontFamily: FONT, fontSize: 8, letterSpacing: 0.5, padding: isMobile ? "9px 6px" : "3px 6px", border: "1px solid",
                                borderColor: alcoOn ? tokens.neutral[300] : tokens.neutral[200], borderRadius: 0, cursor: "pointer",
                                background: alcoOn ? tokens.tint.parchment : tokens.neutral[0], color: alcoOn ? tokens.neutral[700] : tokens.text.disabled, flex: 1,
                              }}>ALCO</button>
                            )}
                            {linkedPairing.hasNonAlco && (
                              <button onClick={() => updLp({ ordered: true, mode: "nonalc" })} style={{
                                fontFamily: FONT, fontSize: 8, letterSpacing: 0.5, padding: isMobile ? "9px 6px" : "3px 6px", border: "1px solid",
                                borderColor: naOn ? tokens.neutral[300] : tokens.neutral[200], borderRadius: 0, cursor: "pointer",
                                background: naOn ? tokens.neutral[100] : tokens.neutral[0], color: naOn ? tokens.neutral[600] : tokens.text.disabled, flex: 1,
                              }}>N/A</button>
                            )}
                          </div>
                        ) : (
                          <select value={extra.pairing || dish.pairings[0]} disabled={!extra.ordered}
                            onChange={e => updSeat(seat.id, "extras", { ...seat.extras, [dish.key]: { ...extra, pairing: e.target.value } })}
                            style={{
                              fontFamily: FONT, fontSize: 10, padding: "4px 5px",
                              border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0,
                              background: tokens.neutral[0], color: tokens.text.primary, outline: "none",
                              opacity: extra.ordered ? 1 : 0.3, width: "100%",
                            }}>
                            {dish.pairings.map(p => <option key={p}>{p}</option>)}
                          </select>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {(() => {
                const visPairings = optionalPairings.filter(opt => !opt.extraKey);
                if (!visPairings.length) return null;
                return (
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
                    {visPairings.map(opt => {
                      const cur = seat.optionalPairings?.[opt.key] || { ordered: opt.defaultOn !== false };
                      const active = !!cur.ordered;
                      const mode = cur.mode || null;
                      const seatPairing = String(seat.pairing || "").trim();
                      const seatIsNonAlc = seatPairing === "Non-Alc";
                      const seatSet = seatPairing && seatPairing !== "—";
                      const alcoOn = active && (mode === "alco" || (mode === null && seatSet && !seatIsNonAlc));
                      const naOn = active && (mode === "nonalc" || (mode === null && seatIsNonAlc));
                      const updOpt = (patch) => updSeat(seat.id, "optionalPairings", {
                        ...(seat.optionalPairings || {}),
                        [opt.key]: { ...cur, ...patch },
                      });
                      return (
                        <div key={opt.key} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 88 }}>
                          <div style={{ ...fieldLabel, marginBottom: 4 }}>{opt.label}</div>
                          <div style={{ display: "flex", gap: 3 }}>
                            <button onClick={() => updOpt({ ordered: false })} style={{
                              fontFamily: FONT, fontSize: 8, letterSpacing: 0.5, padding: isMobile ? "9px 6px" : "3px 6px", border: "1px solid",
                              borderColor: !active ? tokens.green.border : tokens.neutral[200], borderRadius: 0, cursor: "pointer",
                              background: !active ? tokens.green.bg : tokens.neutral[0], color: !active ? tokens.green.text : tokens.text.disabled, flex: 1,
                            }}>OFF</button>
                            {opt.hasAlco && (
                              <button onClick={() => updOpt({ ordered: true, mode: "alco" })} style={{
                                fontFamily: FONT, fontSize: 8, letterSpacing: 0.5, padding: isMobile ? "9px 6px" : "3px 6px", border: "1px solid",
                                borderColor: alcoOn ? tokens.neutral[300] : tokens.neutral[200], borderRadius: 0, cursor: "pointer",
                                background: alcoOn ? tokens.tint.parchment : tokens.neutral[0], color: alcoOn ? tokens.neutral[700] : tokens.text.disabled, flex: 1,
                              }}>ALCO</button>
                            )}
                            {opt.hasNonAlco && (
                              <button onClick={() => updOpt({ ordered: true, mode: "nonalc" })} style={{
                                fontFamily: FONT, fontSize: 8, letterSpacing: 0.5, padding: isMobile ? "9px 6px" : "3px 6px", border: "1px solid",
                                borderColor: naOn ? tokens.neutral[300] : tokens.neutral[200], borderRadius: 0, cursor: "pointer",
                                background: naOn ? tokens.neutral[100] : tokens.neutral[0], color: naOn ? tokens.neutral[600] : tokens.text.disabled, flex: 1,
                              }}>N/A</button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
          </div>
        );
      })}

      {/* [TABLE INFO] section */}
      <div style={{
        borderTop: `1px solid ${tokens.ink[4]}`,
        padding: isMobile ? "10px 12px" : "10px 20px",
        background: tokens.neutral[50],
      }}>
        <div style={{
          fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em",
          textTransform: "uppercase", color: tokens.ink[3], fontWeight: 400,
          marginBottom: 16,
        }}>[TABLE INFO]</div>

      {/* Table-wide fields */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 }}>
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
          <div style={fieldLabel}>⚠️ Restrictions</div>
          {table.restrictions?.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {table.restrictions.map((r, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
                  padding: "6px 10px", background: r.pos ? tokens.neutral[50] : tokens.red.bg,
                  border: `1px solid ${r.pos ? tokens.neutral[100] : tokens.red.border}`, borderRadius: 0,
                }}>
                  <span style={{ fontFamily: FONT, fontSize: 11, color: tokens.red.text, fontWeight: 500, flex: 1, minWidth: 80 }}>
                    {restrLabel(r.note)}
                  </span>
                  <div style={{ display: "flex", gap: 3 }}>
                    {Array.from({ length: table.guests }, (_, idx) => {
                      const p = idx + 1; const sel = r.pos === p;
                      return (
                        <button key={p} onClick={() => upd("restrictions", table.restrictions.map((x, ii) =>
                          ii === i ? { ...x, pos: p } : x
                        ))} style={{
                          fontFamily: FONT, fontSize: 9, padding: isMobile ? "9px 8px" : "3px 6px",
                          border: `1px solid ${sel ? tokens.red.border : tokens.neutral[200]}`,
                          borderRadius: 0, cursor: "pointer", touchAction: "manipulation",
                          background: sel ? tokens.red.bg : tokens.neutral[0],
                          color: sel ? tokens.red.text : tokens.text.disabled, fontWeight: sel ? 700 : 400,
                        }}>P{p}</button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontFamily: FONT, fontSize: 11, color: tokens.neutral[300] }}>none</div>
          )}
        </div>
        <div>
          <div style={fieldLabel}>🎂 Birthday Cake</div>
          <div style={{ fontFamily: FONT, fontSize: 12, color: table.birthday ? tokens.neutral[600] : tokens.text.secondary }}>
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
      </div>

      {/* Sticky back button */}
      <div style={{
        position: "sticky", bottom: 0, left: 0, right: 0,
        padding: "10px 0 16px", marginTop: 0,
        background: `linear-gradient(to bottom, transparent, ${tokens.ink.bg} 30%)`,
      }}>
        <button onClick={onBack} style={{
          width: "100%", fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em",
          textTransform: "uppercase",
          padding: "13px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0,
          cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[3],
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
        }}>← ALL TABLES</button>
      </div>
    </div>
  );
}


// ── Display Board ─────────────────────────────────────────────────────────────
const PC = {
  "—":         { color: tokens.text.secondary, bg: tokens.neutral[100], border: tokens.neutral[300] },
  "Wine":      { color: tokens.neutral[700],   bg: tokens.tint.parchment, border: tokens.neutral[300] },
  "Non-Alc":   { color: tokens.neutral[600],   bg: tokens.neutral[100],  border: tokens.neutral[300] },
  "Premium":   { color: tokens.neutral[700],   bg: tokens.neutral[100],  border: tokens.neutral[300] },
  "Our Story": { color: tokens.green.text,     bg: tokens.green.bg,      border: tokens.green.border },
};
// Flat color/bg maps used by Summary, Archive, and other read-only views
const PAIRING_COLOR = { Wine: tokens.neutral[700], "Non-Alc": tokens.neutral[600], Premium: tokens.neutral[700], "Our Story": tokens.green.text };
const PAIRING_BG    = { Wine: tokens.tint.parchment, "Non-Alc": tokens.neutral[100], Premium: tokens.neutral[100], "Our Story": tokens.green.bg };
const PAIRING_OPTS = [["—","—"],["Wine","W"],["Non-Alc","N/A"],["Premium","Prem"],["Our Story","Story"]];
// Quick-mode water shortcuts: still / sparkling × cold / warm.
const WATER_QUICK = ["XC", "XW", "OC", "OW"];

// Extracted as a stable module-level component to prevent React from unmounting/remounting
// cards on every DisplayBoard re-render (which caused the visual overlap animation glitch).
function DisplayBoardCard({ t, quickMode, upd, updSeat, onCardClick, onSeat, onUnseat, optionalExtras = [], optionalPairings = [], aperitifOptions, wines = [], cocktails = [], spirits = [], beers = [] }) {
    const isSeated = t.active;
    const allRestr = (t.restrictions || []).filter(r => r.note);
    const [assigningIdx, setAssigningIdx] = useState(null);
    const [justSent, setJustSent] = useState(false);
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
        fontFamily: FONT, fontSize: "9px", letterSpacing: "0.08em", padding: "6px 8px",
        border: `1px solid ${active ? tokens.charcoal.default : tokens.ink[4]}`,
        borderRadius: 0, cursor: "pointer", lineHeight: 1,
        background: active ? tokens.tint.parchment : tokens.neutral[0],
        color: active ? tokens.ink[0] : tokens.ink[4],
        transition: "all 0.1s", touchAction: "manipulation",
        fontWeight: active ? 600 : 400,
      }}>{opt}</button>
    );

    const accentColor = isSeated ? tokens.green.text : tokens.neutral[400];

    return (
      <div style={{
        background: tokens.neutral[0],
        borderTop:    `1px solid ${tokens.ink[4]}`,
        borderBottom: `1px solid ${tokens.ink[4]}`,
        borderLeft:   `3px solid ${isSeated ? tokens.green.border : tokens.ink[4]}`,
        borderRight:  `1px solid ${tokens.ink[4]}`,
        borderRadius: 0,
        overflow: "hidden",
        transition: "border-color 0.12s",
      }}>
        {/* Header */}
        <div
          onClick={() => onCardClick && onCardClick(t.id)}
          style={{
            padding: "10px 12px 9px",
            borderBottom: `1px solid ${tokens.ink[4]}`,
            display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8,
            cursor: onCardClick ? "pointer" : "default",
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
            {/* Table number — dominant anchor */}
            <span style={{
              fontFamily: FONT, fontSize: "22px", fontWeight: 700,
              color: tokens.ink[0], letterSpacing: "-0.02em", lineHeight: 1,
            }}>
              T{String(t.id).padStart(2, "0")}
            </span>
            {t.resName && (
              <span style={{
                fontFamily: FONT, fontSize: "13px", fontWeight: 500,
                color: tokens.ink[0], lineHeight: 1.2, overflow: "hidden",
                textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140,
              }}>
                {t.resName}
              </span>
            )}
            {t.arrivedAt
              ? <span style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.08em", color: tokens.green.text, fontWeight: 500 }}>arr. {t.arrivedAt}</span>
              : t.resTime
                ? <span style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.08em", color: tokens.ink[3] }}>{t.resTime}</span>
                : null
            }
          </div>
          <div style={{ display: "flex", gap: 4, alignItems: "center", flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span style={{
              fontFamily: FONT, fontSize: "8px", letterSpacing: "0.12em",
              padding: "2px 7px", borderRadius: 0,
              background: isSeated ? tokens.green.bg : tokens.neutral[50],
              border: `1px solid ${isSeated ? tokens.green.border : tokens.ink[4]}`,
              color: isSeated ? tokens.green.text : tokens.ink[3], fontWeight: 500,
              textTransform: "uppercase",
            }}>{isSeated ? "SEATED" : "RESERVED"}</span>
            {t.menuType && (
              <span style={{
                fontFamily: FONT, fontSize: "8px", letterSpacing: "0.08em",
                padding: "2px 6px", borderRadius: 0,
                border: `1px solid ${tokens.ink[4]}`, color: tokens.ink[3],
                textTransform: "uppercase",
              }}>{t.menuType}</span>
            )}
            {t.lang === "si" && (
              <span style={{
                fontFamily: FONT, fontSize: "8px", letterSpacing: "0.08em",
                padding: "2px 6px", borderRadius: 0,
                border: `1px solid ${tokens.ink[4]}`, color: tokens.ink[3],
                background: tokens.neutral[50], fontWeight: 600,
              }}>SI</span>
            )}
            {t.pace && (() => {
              const pc = { Slow: { color: tokens.ink[2], bg: tokens.tint.parchment, border: tokens.ink[4] }, Fast: { color: tokens.red.text, bg: tokens.red.bg, border: tokens.red.border } }[t.pace] || {};
              return <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.08em", padding: "2px 6px", borderRadius: 0, border: `1px solid ${pc.border}`, background: pc.bg, color: pc.color, fontWeight: 600, textTransform: "uppercase" }}>{t.pace}</span>;
            })()}
            {t.guestType === "hotel" && (() => {
              const rs = Array.isArray(t.rooms) && t.rooms.length ? t.rooms.filter(Boolean) : (t.room ? [t.room] : []);
              return rs.length ? <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 0, border: `1px solid ${tokens.ink[4]}`, color: tokens.ink[2], background: tokens.tint.parchment, fontWeight: 500 }}>#{rs.join(", ")}</span> : null;
            })()}
            {t.birthday && <span style={{ fontSize: 11 }}>🎂</span>}
          </div>
        </div>

        {/* Notes */}
        {t.notes && (
          <div style={{ padding: "6px 12px", borderBottom: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[50] }}>
            <span style={{ fontFamily: FONT, fontSize: "10px", letterSpacing: "0.02em", color: tokens.ink[3], fontStyle: "italic" }}>{t.notes}</span>
          </div>
        )}

        {/* Unassigned restrictions */}
        {unassigned.length > 0 && (
          <div style={{ padding: "5px 14px", borderBottom: `1px solid ${tokens.neutral[100]}`, background: tokens.red.bg, display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 1, color: tokens.red.text, textTransform: "uppercase", flexShrink: 0 }}>⚠</span>
            {unassigned.map(r => (
              <span key={r._i} onClick={() => setAssigningIdx(assigningIdx === r._i ? null : r._i)} style={{
                fontFamily: FONT, fontSize: 8,
                color: assigningIdx === r._i ? tokens.text.primary : tokens.red.text,
                background: assigningIdx === r._i ? tokens.red.text : tokens.red.bg,
                border: `1px solid ${tokens.red.border}`, borderRadius: 0, padding: "1px 6px",
                fontWeight: 500, cursor: "pointer", userSelect: "none",
              }}>{restrCompact(r.note)} {assigningIdx === r._i ? "→ seat" : "→"}</span>
            ))}
          </div>
        )}

        {assigningIdx !== null && (
          <div style={{ padding: "7px 14px", borderBottom: `1px solid ${tokens.neutral[100]}`, background: tokens.red.bg, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 1, color: tokens.red.text, flexShrink: 0 }}>Assign to:</span>
            {seats.map(s => (
              <button key={s.id} onClick={() => assignTo(s.id)} style={{
                fontFamily: FONT, fontSize: 10, fontWeight: 700, padding: "4px 10px",
                border: `1px solid ${tokens.red.border}`, borderRadius: 0, cursor: "pointer",
                background: tokens.neutral[0], color: tokens.red.text,
              }}>P{s.id}</button>
            ))}
            <button onClick={() => setAssigningIdx(null)} style={{
              fontFamily: FONT, fontSize: 9, padding: "3px 8px", marginLeft: 4,
              border: `1px solid ${tokens.neutral[200]}`, borderRadius: 0, cursor: "pointer",
              background: tokens.neutral[0], color: tokens.text.disabled,
            }}>cancel</button>
          </div>
        )}

        {/* Quick mode — ALL water row */}
        {quickMode && seats.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderBottom: `1px solid ${tokens.ink[4]}`, background: tokens.neutral[50] }}>
            <span style={{ fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em", color: tokens.ink[4], textTransform: "uppercase", minWidth: 56 }}>[ALL]</span>
            <div style={{ display: "flex", gap: 4 }}>
              {WATER_QUICK.map(opt => wBtn(opt, allWaterMatch(opt), () => seats.forEach(s => updSeat && updSeat(t.id, s.id, "water", opt))))}
            </div>
          </div>
        )}

        {/* Seat rows — in quick mode, show controls for reserved tables as well (pre-seat prep) */}
        {seats.length > 0 && (isSeated || quickMode) ? (
          <div style={{ display: "flex", flexDirection: "column", gap: quickMode ? 4 : 0, padding: quickMode ? "6px 8px" : "4px 0" }}>
            {seats.map(s => {
              const ws      = waterStyle(s.water);
              const pc      = PC[s.pairing];
              const restr   = allRestr.filter(r => r.pos === s.id);
              const extras  = optionalExtras.filter(d => (s.extras?.[d.key] || s.extras?.[d.id])?.ordered);
              const hasContent = (s.water && s.water !== "—") || s.pairing || restr.length > 0 || extras.length > 0;

              if (quickMode) {
                const cyclePairing = () => {
                  if (!updSeat) return;
                  const cur = s.pairing || "—";
                  const idx = PAIRINGS.indexOf(cur);
                  const nx = PAIRINGS[(idx + 1) % PAIRINGS.length];
                  updSeat(t.id, s.id, "pairing", nx);
                };
                const curPairing = s.pairing || "—";
                const pcStyle = PC[curPairing] || PC["—"];

                const qSectionLabel = (txt) => (
                  <div style={{
                    fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em",
                    color: tokens.ink[3], textTransform: "uppercase", fontWeight: 400, marginBottom: 5,
                  }}>[{txt}]</div>
                );
                const sectionBlock = (label, content) => (
                  <div style={{ padding: "6px 12px" }}>
                    {qSectionLabel(label)}
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>{content}</div>
                  </div>
                );

                return (
                  <div key={s.id} style={{
                    border: `1px solid ${restr.length ? tokens.red.border : tokens.ink[4]}`,
                    borderLeft: `2px solid ${restr.length ? tokens.red.border : tokens.ink[4]}`,
                    borderRadius: 0, overflow: "hidden",
                    background: restr.length ? tokens.red.bg : tokens.neutral[0],
                  }}>
                    {/* Seat label + restrictions */}
                    <div style={{
                      display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
                      padding: "6px 12px",
                      background: restr.length ? tokens.red.bg : tokens.neutral[50],
                      borderBottom: `1px solid ${tokens.ink[4]}`,
                    }}>
                      <span style={{
                        fontFamily: FONT, fontSize: "9px", fontWeight: 700,
                        letterSpacing: "0.10em", color: restr.length ? tokens.red.text : tokens.ink[1],
                      }}>P{s.id}</span>
                      {restr.map((r, i) => (
                        <span key={i} style={{
                          fontFamily: FONT, fontSize: "8px", letterSpacing: "0.06em",
                          color: tokens.red.text, fontWeight: 500,
                          border: `1px solid ${tokens.red.border}`,
                          background: tokens.red.bg, padding: "1px 5px",
                        }}>
                          {restrLabel(r.note)}
                        </span>
                      ))}
                    </div>

                    {/* WATER + PAIRING — side by side */}
                    <div style={{ display: "flex", gap: 12, padding: "8px 12px 4px", alignItems: "flex-start" }}>
                      <div>
                        {qSectionLabel("Water")}
                        <div style={{ display: "flex", gap: 4 }}>
                          {WATER_QUICK.map(opt => wBtn(opt, s.water === opt, () => updSeat && updSeat(t.id, s.id, "water", opt)))}
                        </div>
                      </div>
                      <div style={{ flex: 1 }}>
                        {qSectionLabel("Pairing")}
                        <button onClick={cyclePairing} style={{
                          fontFamily: FONT, fontSize: "10px", letterSpacing: "0.06em",
                          padding: "6px 10px",
                          border: `1px solid ${curPairing === "—" ? tokens.ink[4] : pcStyle.border}`,
                          borderRadius: 0, cursor: "pointer", lineHeight: 1, width: "100%", whiteSpace: "nowrap",
                          background: curPairing === "—" ? tokens.neutral[0] : pcStyle.bg,
                          color: curPairing === "—" ? tokens.ink[4] : pcStyle.color,
                          display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600,
                          touchAction: "manipulation",
                        }}>
                          <span>{curPairing}</span>
                          <span style={{ fontSize: "8px", opacity: 0.55, fontWeight: 400 }}>→</span>
                        </button>
                      </div>
                    </div>

                    {/* EXTRAS — toggleable; linked extras cycle through alco/non-alc */}
                    {(() => {
                      const pairingByExtraKey = new Map();
                      (optionalPairings || []).forEach(opt => { if (opt.extraKey) pairingByExtraKey.set(opt.extraKey, opt); });
                      const visible = (optionalExtras || []).slice(0, 4);
                      if (visible.length === 0) return null;
                      return sectionBlock("Extras", visible.map(dish => {
                        const extra = s.extras?.[dish.key] || s.extras?.[dish.id] || { ordered: false, pairing: dish.pairings?.[0] || "—" };
                        const dishOn = !!extra.ordered;
                        const linked = pairingByExtraKey.get(dish.key);

                        if (linked) {
                          const raw = s.optionalPairings?.[linked.key];
                          const pairingOrdered = raw?.ordered !== undefined ? !!raw.ordered : false;
                          const pmode = raw?.mode || null;
                          const states = ["off", "on"];
                          if (linked.hasAlco) states.push("alco");
                          if (linked.hasNonAlco) states.push("nonalc");
                          let cur;
                          if (!dishOn) cur = "off";
                          else if (!pairingOrdered) cur = "on";
                          else if (pmode === "alco") cur = "alco";
                          else if (pmode === "nonalc") cur = "nonalc";
                          else cur = "on";
                          const subLabel = { off: "off", on: "on", alco: "wine", nonalc: "n/a" }[cur];
                          const styleMap = {
                            off:    { border: tokens.neutral[200], bg: tokens.neutral[0],     color: tokens.text.disabled },
                            on:     { border: tokens.neutral[500], bg: tokens.tint.parchment, color: tokens.neutral[700] },
                            alco:   { border: tokens.green.border, bg: tokens.green.bg,       color: tokens.green.text },
                            nonalc: { border: tokens.green.border, bg: tokens.green.bg,       color: tokens.green.text },
                          }[cur];
                          return (
                            <button key={dish.key || dish.id} onClick={() => upd && upd(t.id, "seats", prev => (prev || []).map(seat => {
                              if (seat.id !== s.id) return seat;
                              const r = seat.optionalPairings?.[linked.key];
                              const xtra = seat.extras?.[dish.key] || { ordered: false, pairing: dish.pairings?.[0] || "—" };
                              const po = r?.ordered !== undefined ? !!r.ordered : false;
                              const pm = r?.mode || null;
                              let c;
                              if (!xtra.ordered) c = "off";
                              else if (!po) c = "on";
                              else if (pm === "alco") c = "alco";
                              else if (pm === "nonalc") c = "nonalc";
                              else c = "on";
                              const nx = states[(states.indexOf(c) + 1) % states.length];
                              return {
                                ...seat,
                                extras: { ...seat.extras, [dish.key]: { ordered: nx !== "off", pairing: dish.pairings?.[0] || "—" } },
                                optionalPairings: { ...(seat.optionalPairings || {}), [linked.key]: {
                                  ...(r || {}),
                                  ordered: nx === "alco" || nx === "nonalc",
                                  ...(nx === "alco" ? { mode: "alco" } : nx === "nonalc" ? { mode: "nonalc" } : { mode: null }),
                                }},
                              };
                            }))} style={{
                              fontFamily: FONT, fontSize: 10, letterSpacing: 0.5, padding: "7px 12px",
                              border: `1px solid ${styleMap.border}`, borderRadius: 0, cursor: "pointer",
                              background: styleMap.bg, color: styleMap.color, lineHeight: 1,
                              display: "inline-flex", alignItems: "center", gap: 6, textTransform: "uppercase",
                            }}>
                              <span style={{ fontWeight: cur === "off" ? 400 : 700 }}>{String(dish.name).slice(0, 8)}</span>
                              <span style={{ fontSize: 9, opacity: 0.7, textTransform: "lowercase" }}>{subLabel}</span>
                            </button>
                          );
                        }

                        // Plain extra — simple toggle
                        return (
                          <button key={dish.key || dish.id}
                            onClick={() => updSeat && updSeat(t.id, s.id, "extras", { ...s.extras, [dish.key]: { ...extra, ordered: !dishOn } })}
                            style={{
                              fontFamily: FONT, fontSize: 10, letterSpacing: 0.5, padding: "7px 12px",
                              border: `1px solid ${dishOn ? tokens.neutral[500] : tokens.neutral[200]}`, borderRadius: 0, cursor: "pointer",
                              background: dishOn ? tokens.tint.parchment : tokens.neutral[0], color: dishOn ? tokens.neutral[700] : tokens.text.disabled, lineHeight: 1,
                              display: "inline-flex", alignItems: "center", gap: 6, textTransform: "uppercase",
                            }}>
                            <span style={{ fontWeight: dishOn ? 700 : 400 }}>{String(dish.name || dish.key || "").slice(0, 8)}</span>
                            <span style={{ fontSize: 9, opacity: 0.7, textTransform: "lowercase" }}>{dishOn ? "on" : "off"}</span>
                          </button>
                        );
                      }));
                    })()}

                    {/* APERITIF — same matching logic as before, now in a labeled row */}
                    {aperitifOptions && aperitifOptions.length > 0 && sectionBlock("Aperitif", aperitifOptions.map(opt => {
                      const label = opt.label ?? opt;
                      const apMatch = (x) => aperitifMatchesQuickAccessOption(x, opt, { wines, cocktails, spirits, beers });
                      const active = (s.aperitifs || []).some(apMatch);
                      return (
                        <button key={label} onClick={() => {
                          if (!updSeat) return;
                          if (active) {
                            updSeat(t.id, s.id, "aperitifs", (s.aperitifs || []).filter(x => !apMatch(x)));
                          } else {
                            const found = resolveAperitifFromQuickAccessOption(opt, { wines, cocktails, spirits, beers });
                            const item = found || { name: label, notes: "", __cocktail: true };
                            updSeat(t.id, s.id, "aperitifs", [...(s.aperitifs || []), item]);
                          }
                        }} style={{
                          fontFamily: FONT, fontSize: 10, letterSpacing: 0.5, padding: "7px 12px",
                          border: `1px solid ${active ? tokens.charcoal.default : tokens.neutral[200]}`,
                          borderRadius: 0, cursor: "pointer", lineHeight: 1,
                          background: active ? tokens.tint.parchment : tokens.neutral[0],
                          color: active ? tokens.neutral[700] : tokens.text.disabled,
                          fontWeight: active ? 700 : 500,
                        }}>{label}</button>
                      );
                    }))}

                    <div style={{ height: 6 }} />
                  </div>
                );
              }

              // Normal display mode
              return (
                <div key={s.id} style={{
                  display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap",
                  padding: "5px 12px", borderBottom: `1px solid ${tokens.ink[5]}`,
                  background: restr.length ? tokens.red.bg : "transparent",
                }}>
                  <span style={{
                    fontFamily: FONT, fontSize: "9px", fontWeight: 700,
                    minWidth: 22, color: restr.length ? tokens.red.text : tokens.ink[2],
                    letterSpacing: "0.06em",
                  }}>P{s.id}</span>
                  {!hasContent && <span style={{ fontFamily: FONT, fontSize: "9px", color: tokens.ink[5] }}>—</span>}
                  {s.water && s.water !== "—" && (
                    <span style={{
                      fontFamily: FONT, fontSize: "9px", padding: "2px 6px", borderRadius: 0,
                      background: tokens.neutral[50], color: tokens.ink[1],
                      border: `1px solid ${tokens.ink[4]}`,
                    }}>{s.water}</span>
                  )}
                  {s.pairing && pc && (
                    <span style={{
                      fontFamily: FONT, fontSize: "9px", padding: "2px 6px", borderRadius: 0,
                      background: pc.bg, border: `1px solid ${pc.border}`,
                      color: pc.color, fontWeight: 500,
                    }}>{s.pairing}</span>
                  )}
                  {extras.map(d => {
                    const ex = s.extras[d.key] || s.extras[d.id];
                    return (
                      <span key={d.key} style={{
                        fontFamily: FONT, fontSize: "9px", padding: "2px 6px", borderRadius: 0,
                        border: `1px solid ${tokens.green.border}`, color: tokens.green.text, background: tokens.green.bg,
                      }}>
                        {d.name}{ex?.pairing && ex.pairing !== "—" ? ` · ${ex.pairing}` : ""}
                      </span>
                    );
                  })}
                  {restr.map((r, i) => (
                    <span key={i} style={{
                      fontFamily: FONT, fontSize: "8px", padding: "1px 5px", borderRadius: 0,
                      border: `1px solid ${tokens.red.border}`, color: tokens.red.text,
                      background: tokens.red.bg, fontWeight: 500,
                    }}>⚠ {restrCompact(r.note)}</span>
                  ))}
                </div>
              );
            })}
          </div>
        ) : !isSeated ? (
          <div style={{ padding: "9px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <span style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.06em", color: tokens.ink[3] }}>{t.guests} pax</span>
              {allRestr.map((r, i) => (
                <span key={i} style={{
                  fontFamily: FONT, fontSize: "8px", padding: "1px 5px", borderRadius: 0,
                  border: `1px solid ${tokens.red.border}`, color: tokens.red.text,
                  background: tokens.red.bg, fontWeight: 500,
                }}>⚠ {restrCompact(r.note)}</span>
              ))}
            </div>
            {onSeat && (
              <button onClick={() => onSeat(t.id)} style={{
                fontFamily: FONT, fontSize: "9px", letterSpacing: "0.10em", padding: "5px 12px",
                border: `1px solid ${tokens.green.border}`, borderRadius: 0, cursor: "pointer",
                background: tokens.green.bg, color: tokens.green.text,
                fontWeight: 500, textTransform: "uppercase", touchAction: "manipulation",
              }}>SEAT</button>
            )}
          </div>
        ) : null}
        {seats.length > 0 && ((isSeated && (quickMode || onUnseat)) || (quickMode && !isSeated && onSeat)) && (
          <div style={{ padding: "6px 14px", borderTop: `1px solid ${tokens.neutral[100]}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {quickMode && upd && isSeated ? (
              <button
                disabled={justSent}
                onClick={() => {
                  const seats = t.seats || [];
                  const alertSeats = seats.map(s => ({
                    id: s.id,
                    pairing: s.pairing || null,
                    extras: (optionalExtras || [])
                      .filter(d => !!(s.extras?.[d.key] || s.extras?.[d.id])?.ordered)
                      .map(d => {
                        const ex = s.extras?.[d.key] || s.extras?.[d.id];
                        return { key: d.key, name: d.name, pairing: ex?.pairing || "—" };
                      }),
                  }));
                  upd(t.id, "kitchenAlert", {
                    timestamp: new Date().toISOString(),
                    tableName: t.resName || null,
                    seats: alertSeats,
                    confirmed: false,
                  });
                  setJustSent(true);
                  setTimeout(() => setJustSent(false), 2000);
                }}
                style={{
                  fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 16px",
                  border: `1px solid ${justSent ? tokens.green.border : tokens.charcoal.default}`, borderRadius: 0,
                  cursor: justSent ? "default" : "pointer",
                  background: justSent ? tokens.green.bg : tokens.surface.card,
                  color: justSent ? tokens.green.text : tokens.text.primary,
                  fontWeight: 700, textTransform: "uppercase",
                  transition: "all 0.15s ease",
                }}>{justSent ? "✓ Sent" : "Send"}</button>
            ) : <span />}
            {quickMode && !isSeated && onSeat ? (
              <button onClick={() => onSeat(t.id)} style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 14px",
                border: `1px solid ${tokens.green.border}`, borderRadius: 0, cursor: "pointer",
                background: tokens.green.bg, color: tokens.green.text, fontWeight: 600, textTransform: "uppercase",
                marginLeft: "auto",
              }}>Seat</button>
            ) : onUnseat && isSeated ? (
              <button onClick={() => onUnseat(t.id)} style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "4px 12px",
                border: `1px solid ${tokens.neutral[300]}`, borderRadius: 0, cursor: "pointer",
                background: tokens.neutral[0], color: tokens.text.muted, textTransform: "uppercase",
              }}>Unseat</button>
            ) : null}
          </div>
        )}
      </div>
    );
}

function DisplayBoard({ tables, optionalExtras = [], optionalPairings = [], upd, quickMode = false, updSeat, onCardClick, onSeat, onUnseat, aperitifOptions = [], wines = [], cocktails = [], spirits = [], beers = [] }) {
  const isMobile = useIsMobile(BP.md);

  // Auto-detect tables that share the same resName + resTime and have no explicit
  // tableGroup — treat them as a merged group for display only (no data mutation).
  const autoGroupMap = (() => {
    const byKey = new Map();
    tables.forEach(t => {
      if (t.tableGroup?.length) return; // already explicitly grouped
      const n = (t.resName || "").trim();
      const r = (t.resTime || "").trim();
      if (!n || !r) return;
      const k = `${n}|${r}`;
      byKey.set(k, [...(byKey.get(k) || []), t.id]);
    });
    const m = new Map();
    byKey.forEach(ids => {
      if (ids.length < 2) return;
      const sorted = [...ids].sort((a, b) => a - b);
      sorted.forEach(id => m.set(id, sorted));
    });
    return m;
  })();

  // Augment table objects with computed tableGroup where applicable
  const effectiveTables = tables.map(t => {
    const eg = autoGroupMap.get(t.id);
    return eg ? { ...t, tableGroup: eg } : t;
  });

  const isPrimary = t => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup);
  const visible = effectiveTables.filter(t => t.active || t.resTime || t.resName).filter(isPrimary);
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
    <div style={{ overflowY: "auto", overflowX: "hidden", padding: isMobile ? "0 12px 40px" : "0 24px 48px" }}>
      {!hasAny && (
        <div style={{ fontFamily: FONT, fontSize: "9px", color: tokens.ink[4], textAlign: "center", marginTop: 80, letterSpacing: "0.16em", textTransform: "uppercase" }}>
          no reservations
        </div>
      )}
      {rowsData.map(({ time, tables: rowTables }) => {
        if (rowTables.length === 0) return null;
        const seatedCount = rowTables.filter(t => t.active).length;
        return (
          <div key={time} style={{ marginBottom: 28 }}>
            {/* Time section header — hairline rule + bracket label */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10, paddingTop: 20 }}>
              <span style={{
                fontFamily: FONT, fontSize: "9px", letterSpacing: "0.14em",
                color: tokens.ink[2], textTransform: "uppercase", fontWeight: 500, flexShrink: 0,
              }}>[{time}]</span>
              <div style={{ flex: 1, height: 1, background: tokens.ink[4] }} />
              <span style={{
                fontFamily: FONT, fontSize: "8px", letterSpacing: "0.10em",
                color: tokens.ink[3], textTransform: "uppercase", flexShrink: 0,
              }}>
                {seatedCount}/{rowTables.length} seated · {rowTables.reduce((a, t) => a + (t.guests || 0), 0)} pax
              </span>
            </div>
            <div style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(340px, 1fr))",
              gap: isMobile ? 8 : 12,
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
                  optionalExtras={optionalExtras}
                  optionalPairings={optionalPairings}
                  aperitifOptions={aperitifOptions}
                  wines={wines}
                  cocktails={cocktails}
                  spirits={spirits}
                  beers={beers}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
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

const sanitizeLayoutProfiles = (profiles) => {
  const list = Array.isArray(profiles) ? profiles : [];
  const out = list
    .filter((p) => p && typeof p === "object")
    .map((p, idx) => ({
      id: String(p.id || `layout_${idx + 1}`),
      name: String(p.name || `Layout ${idx + 1}`),
      layoutStyles: p.layoutStyles && typeof p.layoutStyles === "object" ? p.layoutStyles : {},
      menuTemplate: p.menuTemplate && typeof p.menuTemplate === "object" ? p.menuTemplate : null,
    }));
  return out.length > 0 ? out : [{ id: "layout_1", name: "Layout 1", layoutStyles: {}, menuTemplate: null }];
};

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const localSnapshot = readLocalBoardState();
  const initialState  = localSnapshot || defaultBoardState();

  const localBev = readLocalBeverages();
  const loadMenuCoursesRef = useRef(null);
  const appIsMobile = useIsMobile(BP.md);

  const [tables,    setTables]    = useState(initialState.tables);
  const [menuCourses, setMenuCourses] = useState([]); // live from Supabase
  const [wines,     setWines]     = useState(initialState.wines);
  const [cocktails, setCocktails] = useState(localBev?.cocktails ?? initialState.cocktails ?? initCocktails);
  const [spirits,   setSpirits]   = useState(localBev?.spirits   ?? initialState.spirits   ?? initSpirits);
  const [beers,     setBeers]     = useState(localBev?.beers      ?? initialState.beers     ?? initBeers);
  const [mode, setMode] = useState(() => {
    try { return localStorage.getItem("milka_mode") || null; } catch { return null; }
  });
  const [sel,          setSel]          = useState(null);
  const [quickView,    setQuickView]    = useState("board");
  const [sheetSel,     setSheetSel]     = useState(null);
  const [resModal,     setResModal]     = useState(null);
  const [resModalPresetTime, setResModalPresetTime] = useState(null);
  const [adminOpen,      setAdminOpen]      = useState(false);
  const [summaryOpen,    setSummaryOpen]    = useState(false);
  const [archiveOpen,    setArchiveOpen]    = useState(false);
  const [inventoryOpen,  setInventoryOpen]  = useState(false);
  const [syncStatus,   setSyncStatus]   = useState(hasSupabaseConfig ? "connecting" : "local-only");
  const [logoDataUri,  setLogoDataUri]  = useState("");
  const [wineSyncConfig, setWineSyncConfig] = useState(() => {
    try { return normalizeSyncConfig(JSON.parse(localStorage.getItem(SYNC_CONFIG_KEY) || "null")); } catch { return DEFAULT_SYNC_CONFIG; }
  });
  const syncConfigRef = useRef(wineSyncConfig);
  syncConfigRef.current = wineSyncConfig;
  const [layoutProfiles, setLayoutProfiles] = useState(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(MENU_LAYOUT_PROFILES_KEY) || "null");
      if (Array.isArray(raw) && raw.length > 0) return raw;
    } catch {}
    return [{ id: "layout_1", name: "Layout 1", layoutStyles: {}, menuTemplate: null }];
  });
  const [activeLayoutProfileId, setActiveLayoutProfileId] = useState(() => {
    try { return localStorage.getItem(MENU_ACTIVE_LAYOUT_PROFILE_KEY) || "layout_1"; } catch { return "layout_1"; }
  });
  // Print layout state (lifted from MenuPage into App for Admin access)
  const activeLayoutProfile = useMemo(
    () => layoutProfiles.find(p => p.id === activeLayoutProfileId) || layoutProfiles[0] || null,
    [layoutProfiles, activeLayoutProfileId]
  );
  const [globalLayout, setGlobalLayout] = useState(() => activeLayoutProfile?.layoutStyles || {});
  const [menuTemplate, setMenuTemplate] = useState(() => activeLayoutProfile?.menuTemplate || null);
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

  const saveTimerRef       = useRef(null);
  const prevTablesJsonRef  = useRef((initialState.tables || initTables).map(t => JSON.stringify(sanitizeTable(t))));
  const tablesRef          = useRef(tables);
  /** Client monotonic clock (ms) of last local mutation per table — stale remote rows are ignored to stop realtime/poll flicker. */
  const tableLocalFreshRef = useRef(new Map());

  const parseRemoteUpdatedAt = (raw) => {
    if (raw == null || raw === "") return 0;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw > 1e12 ? raw : raw * 1000;
    const ms = Date.parse(String(raw));
    return Number.isFinite(ms) ? ms : 0;
  };

  const bumpLocalTableFresh = useCallback((tableId) => {
    if (tableId == null || Number.isNaN(Number(tableId))) return;
    tableLocalFreshRef.current.set(Number(tableId), Date.now());
  }, []);

  const offlineQueue = useOfflineQueue({ supabase });
  const enqueueServiceTableUpsert = useCallback(async (rows) => {
    const payloadRows = Array.isArray(rows) ? rows : [];
    if (payloadRows.length === 0) return { ok: true };

    if (!supabase) return { ok: false, queued: false };

    const job = {
      table: TABLES.SERVICE_TABLES,
      op: "upsert",
      payload: payloadRows,
      options: { onConflict: "table_id" },
    };

    if (!navigator.onLine) {
      await offlineQueue.enqueue(job);
      setSyncStatus("local-only");
      return { ok: true, queued: true };
    }

    try {
      const { error } = await supabase.from(TABLES.SERVICE_TABLES).upsert(payloadRows, { onConflict: "table_id" });
      if (error) throw error;
      return { ok: true, queued: false };
    } catch (error) {
      await offlineQueue.enqueue(job);
      setSyncStatus("sync-error");
      return { ok: false, queued: true, error };
    }
  }, [offlineQueue]);

  // Run a Supabase mutation, falling back to the persistent offline queue when
  // offline or on transient failure. `run` performs the live request and may
  // capture inserted data via closure; `job` is the serializable retry payload.
  const enqueueMutation = useCallback(async ({ run, job }) => {
    if (!supabase) return { ok: false, queued: false };

    if (!navigator.onLine) {
      await offlineQueue.enqueue(job);
      setSyncStatus("local-only");
      return { ok: true, queued: true };
    }

    try {
      await run();
      return { ok: true, queued: false };
    } catch (error) {
      await offlineQueue.enqueue(job);
      setSyncStatus("sync-error");
      return { ok: false, queued: true, error };
    }
  }, [offlineQueue]);

  const boardState = { tables, cocktails, spirits, beers };
  const tablesJson = useMemo(() => JSON.stringify(tables), [tables]);
  const boardJson  = useMemo(() => JSON.stringify(boardState), [tablesJson, cocktails, spirits, beers]); // eslint-disable-line react-hooks/exhaustive-deps
  const boardStateRef = useRef(boardState);
  boardStateRef.current = boardState;
  tablesRef.current = tables;

  // Active courses (filter out archived/inactive). Admin sees the full list; service/menu/ticket views see only active.
  const activeMenuCourses = useMemo(() => menuCourses.filter(c => c.is_active !== false), [menuCourses]);
  const dishes = useMemo(() => optionalExtrasFromCourses(activeMenuCourses), [activeMenuCourses]);
  const pairings = useMemo(() => optionalPairingsFromCourses(activeMenuCourses), [activeMenuCourses]);

  const mergeRemoteTables = rows => {
    const arr = Array.isArray(rows) ? rows : [];
    const rawById = new Map(arr.map(row => [Number(row.table_id), row]));
    const nextTables = initTables.map(base => {
      const row = rawById.get(base.id);
      if (!row) return base;
      const remoteTs = parseRemoteUpdatedAt(row.updated_at);
      const localTs = tableLocalFreshRef.current.get(base.id) || 0;
      if (remoteTs > 0 && localTs > 0 && remoteTs < localTs) {
        const cur = tablesRef.current.find(t => t.id === base.id);
        return cur ? { ...cur } : base;
      }
      return sanitizeTable({ id: Number(row.table_id), ...(row.data || {}) });
    });
    // Snapshot prevTablesJsonRef BEFORE setTables so the save-useEffect sees no diff
    // after a full poll and doesn't re-save the entire remote state.
    prevTablesJsonRef.current = nextTables.map(t => JSON.stringify(sanitizeTable(t)));
    setTables(() => nextTables);
  };

  const applyRemoteTableRow = row => {
    const tableId = Number(row?.table_id);
    if (!tableId) return;
    const remoteTs = parseRemoteUpdatedAt(row.updated_at);
    const localTs = tableLocalFreshRef.current.get(tableId) || 0;
    if (remoteTs > 0 && localTs > 0 && remoteTs < localTs) return;
    const nextTable = sanitizeTable({ id: tableId, ...(row.data || {}) });
    setTables(prev => prev.map(t => t.id === tableId ? nextTable : t));
  };

  const selTable   = tables.find(t => t.id === sel);
  const modalTable = tables.find(t => t.id === resModal);

  const upd = (id, f, v) => {
    bumpLocalTableFresh(id);
    setTables(p => p.map(t => t.id === id ? { ...t, [f]: typeof v === "function" ? v(t[f]) : v } : t));
  };
  // Batch multiple field updates in one setTables call (one render, one Supabase save)
  const updMany = (id, changes) => {
    bumpLocalTableFresh(id);
    setTables(p => p.map(t => t.id === id ? { ...t, ...changes } : t));
  };

  /** Seat field update. Pass a function `v(prevField, seat)` to derive from latest state (fixes rapid-click flicker). */
  const updSeat = (tid, sid, f, v) => {
    bumpLocalTableFresh(tid);
    setTables(p => p.map(t => {
    if (t.id !== tid) return t;
    const seats = t.seats || [];
    return {
      ...t,
      seats: seats.map(s => {
        if (s.id !== sid) return s;
        const next = typeof v === "function" ? v(s[f], s) : v;
        return { ...s, [f]: next };
      }),
    };
  }));
  };

  const setGuests = (tid, n) => {
    bumpLocalTableFresh(tid);
    setTables(p => p.map(t =>
    t.id !== tid ? t : { ...t, guests: n, seats: makeSeats(n, t.seats) }
  ));
  };

  const applySeatTemplateToAll = (tableId, sourceSeatId = 1) => {
    bumpLocalTableFresh(tableId);
    setTables(prev => prev.map(t => {
    if (t.id !== tableId) return t;
    const seats = t.seats || [];
    if (seats.length <= 1) return t;
    const source = seats.find(s => s.id === sourceSeatId) || seats[0];
    if (!source) return t;
    const clonedExtras = source.extras
      ? Object.fromEntries(Object.entries(source.extras).map(([k, v]) => [k, v ? { ...v } : v]))
      : {};
    const clonedOptionalPairings = source.optionalPairings ? { ...source.optionalPairings } : {};
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
            optionalPairings: clonedOptionalPairings,
          }
    ));
    return { ...t, seats: nextSeats };
  }));
  };

  const clearSeatBeverages = (tableId) => {
    bumpLocalTableFresh(tableId);
    setTables(prev => prev.map(t => {
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
  };

  const seatTable = id => {
    const now = fmt(new Date());
    const group = tables.find(t => t.id === id)?.tableGroup;
    const ids = group?.length > 1 ? group : [id];
    ids.forEach(tid => bumpLocalTableFresh(tid));
    setTables(p => p.map(t =>
      !ids.includes(t.id) ? t : { ...t, active: true, arrivedAt: now, seats: makeSeats(t.guests, t.seats) }
    ));
  };

  const unseatTable = id => {
    const group = tables.find(t => t.id === id)?.tableGroup;
    const ids = group?.length > 1 ? group : [id];
    ids.forEach(tid => bumpLocalTableFresh(tid));
    setTables(p => p.map(t =>
      !ids.includes(t.id) ? t : { ...t, active: false, arrivedAt: null }
    ));
  };

  const clear = id => {
    if (typeof window !== "undefined" && !window.confirm("Clear this table and reset its details?")) return;
    bumpLocalTableFresh(id);
    setTables(p => p.map(t => t.id !== id ? t : blankTable(id)));
    setSel(null);
  };

  const syncWines = async () => {
    // Client-side budget. Vercel function caps at 60 s (see sync-wines.js);
    // give it slack for headers + DB writes then hard-abort so the UI doesn't hang.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 70_000);
    try {
      const secret = import.meta.env.VITE_SYNC_SECRET || "";
      if (!secret) {
        return { ok: false, error: "VITE_SYNC_SECRET is not set for this build. Add it in Vercel → Settings → Environment Variables (value must match CRON_SECRET or SYNC_SECRET), then redeploy." };
      }
      const cfg = normalizeSyncConfig(syncConfigRef.current);
      const payload = encodeURIComponent(JSON.stringify(cfg));
      const url = `/api/sync-wines?secret=${encodeURIComponent(secret)}&config=${payload}`;
      const r = await fetch(url, { signal: controller.signal });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        const base = json.error || `HTTP ${r.status}`;
        if (r.status === 401) return { ok: false, error: `${base} — VITE_SYNC_SECRET on the frontend doesn't match CRON_SECRET / SYNC_SECRET on the backend. Update the values in Vercel so they match, then redeploy.` };
        return { ok: false, error: base };
      }
      await loadWines();
      return {
        ok: true,
        partial: Boolean(json.partial),
        wines: json.wines,
        cocktails: json.cocktails,
        beers: json.beers,
        spirits: json.spirits,
        failedCountries: json.failedCountries || [],
        failedBeveragePages: json.failedBeveragePages || [],
        skippedCategories: json.skippedCategories || [],
      };
    } catch (e) {
      if (e?.name === "AbortError") return { ok: false, error: "Timed out after 70 s" };
      return { ok: false, error: e.message || e.name || "Request failed" };
    } finally {
      clearTimeout(timeoutId);
    }
  };

  // Save menu courses directly to Supabase (the app is now the source of truth)
  const saveMenuCourses = async (courses) => {
    if (!supabase) return { ok: true };
    // Auto-generate course_key from dish name when empty so the layout editor
    // can always reference every course (keyless courses produce value="" which
    // collides with the "(none)" dropdown option and silently clears the block).
    const withKeys = courses.map(c => {
      if (c.course_key) return c;
      const rawName = c.menu?.name || "";
      const generated = rawName.trim().toLowerCase()
        .replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
      return generated ? { ...c, course_key: generated } : c;
    });
    const rows = withKeys.map(c => courseToSupabaseRow(c));
    let { error } = await supabase
      .from(TABLES.MENU_COURSES)
      .upsert(rows, { onConflict: "position" });
    // Pre-migration fallback: if the is_active column hasn't been added yet,
    // retry without it so the rest of the save still goes through. The toggle
    // won't persist until the schema migration is applied, but new courses,
    // edits, and reorders won't be lost.
    let isActiveSkipped = false;
    if (error && (error.code === "PGRST204" || /is_active/i.test(String(error.message || "")))) {
      const fallbackRows = rows.map(({ is_active, ...rest }) => rest);
      const retry = await supabase
        .from(TABLES.MENU_COURSES)
        .upsert(fallbackRows, { onConflict: "position" });
      error = retry.error;
      if (!error) {
        isActiveSkipped = true;
        console.warn("menu_courses.is_active column missing — saved without it. Run the schema migration to enable archiving.");
      }
    }
    if (error) { console.error("Menu save failed:", error); return { ok: false, error }; }
    // Reflect any auto-generated keys back into local state so the UI shows them.
    setMenuCourses(withKeys);
    // Remove courses that no longer exist
    const positions = withKeys.map(c => c.position);
    if (positions.length > 0) {
      await supabase.from(TABLES.MENU_COURSES).delete().not("position", "in", `(${positions.join(",")})`);
    }
    return { ok: true, isActiveSkipped };
  };

  const saveWines = async (updatedWines) => {
    setWines(updatedWines);
    if (!supabase) return { ok: true };
    const BATCH = 200;
    const rows = updatedWines.map(w => {
      const key = typeof w.id === "string" ? w.id : `manual|legacy_${w.id}`;
      const source = String(key).startsWith("manual|") ? "manual" : "sync";
      return {
        key,
        source,
        wine_name: w.name,
        name: w.producer ? `${w.producer} – ${w.name}` : w.name,
        producer: w.producer || "",
        vintage: w.vintage || "NV",
        region: w.region || "",
        country: w.country || "",
        by_glass: w.byGlass ?? false,
      };
    });
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await supabase.from(TABLES.WINES).upsert(rows.slice(i, i + BATCH), { onConflict: "key" });
      if (error) {
        console.error("Wine save error:", error);
        return { ok: false, error: error.message };
      }
    }
    const savedKeys = new Set(rows.map(r => r.key));
    const originalKeys = wines.map(w => (typeof w.id === "string" ? w.id : null)).filter(Boolean);
    const deletedKeys = originalKeys.filter(k => !savedKeys.has(k));
    if (deletedKeys.length > 0) {
      const { error: delErr } = await supabase.from(TABLES.WINES).delete().in("key", deletedKeys);
      if (delErr) {
        console.error("Wine delete error:", delErr);
        return { ok: false, error: delErr.message };
      }
    }
    return { ok: true };
  };

  const saveBeverages = async ({ cocktails: newC, spirits: newS, beers: newB }) => {
    setCocktails(newC);
    setSpirits(newS);
    setBeers(newB);
    writeLocalBeverages({ cocktails: newC, spirits: newS, beers: newB });
    if (!supabase) return { ok: true };
    const rows = [
      ...newC.map((item, i) => ({ category: "cocktail", name: item.name, notes: item.notes || "", position: i, source: "manual" })),
      ...newS.map((item, i) => ({ category: "spirit",   name: item.name, notes: item.notes || "", position: i, source: "manual" })),
      ...newB.map((item, i) => ({ category: "beer",     name: item.name, notes: item.notes || "", position: i, source: "manual" })),
    ];
    const { error: delErr } = await supabase.from(TABLES.BEVERAGES).delete().eq("source", "manual").in("category", ["cocktail", "spirit", "beer"]);
    if (delErr) {
      console.error("Beverage delete error:", delErr);
      return { ok: false, error: delErr.message };
    }
    if (rows.length > 0) {
      const { error: insErr } = await supabase.from(TABLES.BEVERAGES).insert(rows);
      if (insErr) {
        console.error("Beverage insert error:", insErr);
        return { ok: false, error: insErr.message };
      }
    }
    return { ok: true };
  };

  const clearAll = () => {
    if (typeof window !== "undefined" && !window.confirm("Clear ALL tables?")) return;
    tableLocalFreshRef.current = new Map();
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
    for (let i = 1; i <= 10; i++) bumpLocalTableFresh(i);
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
      const { error } = await supabase.from(TABLES.SERVICE_ARCHIVE).insert({
        date: toLocalDateISO(),
        label: dateStr,
        state: { ...snap, tables: activeTables, menuCourses: menuCourses },
      });
      if (error) {
        window.alert("Archive failed: " + error.message);
        return;
      }
    }
    tableLocalFreshRef.current = new Map();
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

  const swapSeats = (tid, aId, bId) => {
    bumpLocalTableFresh(tid);
    setTables(p => p.map(t => {
      if (t.id !== tid) return t;
      const sA = t.seats.find(s => s.id === aId);
      const sB = t.seats.find(s => s.id === bId);
      return {
        ...t,
        seats: t.seats.map(s => {
          if (s.id === aId) return { ...sB, id: aId };
          if (s.id === bId) return { ...sA, id: bId };
          return s;
        }),
      };
    }));
  };

  const saveRes = (id, { tableIds, tableId, name, time, menuType, guests, guestType, room, rooms, birthday, cakeNote, restrictions, notes, lang }) => {
    const group = tableIds ?? (tableId ? [tableId] : [id]);
    const sortedGroup = [...group].sort((a, b) => a - b);
    // Find old group to clear tables that are no longer part of it
    const oldGroup = tables.find(t => t.id === id)?.tableGroup || [id];
    // Celebration-category dish keys to sync with the birthday flag
    const celebrationKeys = (activeMenuCourses || [])
      .filter(c => normalizeCourseCategory(c?.course_category, c?.optional_flag) === "celebration")
      .map(c => normalizeOptionalKey(c?.optional_flag))
      .filter(Boolean);
    [...new Set([...oldGroup, ...sortedGroup])].forEach(tid => bumpLocalTableFresh(tid));
    setTables(p => p.map(t => {
      // Clear tables that were in the old group but aren't in the new group
      if (oldGroup.includes(t.id) && !sortedGroup.includes(t.id)) {
        return { ...blankTable(t.id), active: t.active, arrivedAt: t.arrivedAt, kitchenLog: t.kitchenLog };
      }
      if (!sortedGroup.includes(t.id)) return t;
      const newSeats = makeSeats(guests, t.seats);
      const seats = celebrationKeys.length > 0
        ? newSeats.map(s => ({
            ...s,
            extras: {
              ...s.extras,
              ...Object.fromEntries(
                celebrationKeys.map(k => [k, { ordered: !!birthday, pairing: s.extras?.[k]?.pairing || "—" }])
              ),
            },
          }))
        : newSeats;
      const normalizedRooms = Array.isArray(rooms) ? rooms.filter(Boolean) : (room ? [room] : []);
      return { ...t, resName: name, resTime: time, menuType, guestType, room: normalizedRooms[0] || "", rooms: normalizedRooms, guests, seats, birthday, cakeNote: birthday ? (cakeNote || "") : "", restrictions, notes, lang: lang || "en", tableGroup: sortedGroup };
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
    await supabase.from(TABLES.SERVICE_SETTINGS)
      .upsert({ id: "service_date", state: date ? { date } : {}, updated_at: new Date().toISOString() }, { onConflict: "id" });
  };

  // ── Reservations CRUD ─────────────────────────────────────────────────────
  const upsertReservation = async ({ id, date, table_id, data: rData }) => {
    const dbRow = { date, table_id, data: rData };
    if (id) {
      if (supabase) {
        const result = await enqueueMutation({
          job: {
            table: TABLES.RESERVATIONS,
            op: "update",
            payload: dbRow,
            match: { id },
          },
          run: async () => {
            const { error } = await supabase.from(TABLES.RESERVATIONS).update(dbRow).eq("id", id);
            if (error) throw error;
          },
        });
        if (result.ok) setReservations(prev => prev.map(r => r.id === id ? { ...r, ...dbRow } : r));
        return { ok: result.ok, error: result.error };
      }
      setReservations(prev => prev.map(r => r.id === id ? { ...r, ...dbRow } : r));
      return { ok: true };
    }
    if (supabase) {
      let inserted = null;
      const result = await enqueueMutation({
        job: {
          table: TABLES.RESERVATIONS,
          op: "insert",
          payload: dbRow,
        },
        run: async () => {
          const { data, error } = await supabase.from(TABLES.RESERVATIONS).insert(dbRow).select().single();
          if (error) throw error;
          inserted = data;
        },
      });
      if (result.ok && inserted) setReservations(prev => [...prev, inserted]);
      return { ok: result.ok, error: result.error, data: inserted };
    }
    const local = { ...dbRow, id: crypto.randomUUID(), created_at: new Date().toISOString() };
    setReservations(prev => [...prev, local]);
    return { ok: true, data: local };
  };

  const deleteReservation = async (id) => {
    setReservations(prev => prev.filter(r => r.id !== id));
    if (!supabase) return { ok: true };
    const result = await enqueueMutation({
      job: {
        table: TABLES.RESERVATIONS,
        op: "delete",
        match: { id },
      },
      run: async () => {
        const { error } = await supabase.from(TABLES.RESERVATIONS).delete().eq("id", id);
        if (error) throw error;
      },
    });
    return { ok: result.ok };
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
            room:               (Array.isArray(d.rooms) && d.rooms.length ? d.rooms[0] : d.room) || "",
            rooms:              Array.isArray(d.rooms) && d.rooms.length ? d.rooms.filter(Boolean) : (d.room ? [d.room] : []),
            birthday:           !!d.birthday,
            cakeNote:           d.birthday ? (d.cakeNote || "") : "",
            restrictions:       d.restrictions || [],
            notes:              d.notes || "",
            tableGroup:         group,
            courseOverrides:    d.courseOverrides || {},
            kitchenCourseNotes: d.kitchenCourseNotes || {},
            extrasConfirmed:   t.extrasConfirmed || {},
            seats:              makeSeats(d.guests || 2, t.seats),
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
      supabase.from(TABLES.RESERVATIONS).select("*").eq("date", serviceDate)
        .then(({ data }) => { if (data?.length) prePopulateFromReservations(data); });
    }
  };

  const switchMode = () => { changeMode(null); setSel(null); };

  // Escape = back. The hook stacks handlers so the most recently enabled
  // one fires first: detail closes before mode exits.
  useModalEscape(() => changeMode(null), !!mode);
  useModalEscape(() => setSel(null), !!sel);

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
        const result = await enqueueServiceTableUpsert(changedTables);
        if (result?.ok && !result?.queued) { setSyncStatus("live"); return; }
        if (result?.queued) { return; }
        lastError = result?.error || new Error("Unknown service table sync error");
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
    supabase.from(TABLES.SERVICE_SETTINGS).select("state").eq("id", "menu_logo").single()
      .then(({ data }) => { data?.state?.dataUri ? setLogoDataUri(data.state.dataUri) : loadDefault(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveLogo = async (dataUri) => {
    setLogoDataUri(dataUri);
    if (!supabase) return;
    await supabase.from(TABLES.SERVICE_SETTINGS)
      .upsert({ id: "menu_logo", state: { dataUri }, updated_at: new Date().toISOString() }, { onConflict: "id" });
  };

  useEffect(() => {
    try { localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(wineSyncConfig)); } catch {}
  }, [wineSyncConfig]);

  useEffect(() => {
    if (!supabase) return;
    supabase.from(TABLES.SERVICE_SETTINGS).select("state").eq("id", "wine_sync_config").maybeSingle()
      .then(({ data }) => {
        if (data?.state) setWineSyncConfig(normalizeSyncConfig(data.state));
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveWineSyncConfig = async () => {
    const next = normalizeSyncConfig(wineSyncConfig);
    setWineSyncConfig(next);
    if (!supabase) return;
    await supabase.from(TABLES.SERVICE_SETTINGS)
      .upsert({ id: "wine_sync_config", state: next, updated_at: new Date().toISOString() }, { onConflict: "id" });
  };

  useEffect(() => {
    try { localStorage.setItem(MENU_LAYOUT_PROFILES_KEY, JSON.stringify(layoutProfiles)); } catch {}
  }, [layoutProfiles]);

  useEffect(() => {
    try { localStorage.setItem(MENU_ACTIVE_LAYOUT_PROFILE_KEY, activeLayoutProfileId || ""); } catch {}
  }, [activeLayoutProfileId]);

  const persistLayoutProfiles = async (profiles, activeId) => {
    if (!supabase) return;
    await supabase.from(TABLES.SERVICE_SETTINGS)
      .upsert(
        { id: "menu_layout_profiles_v1", state: { profiles, activeId }, updated_at: new Date().toISOString() },
        { onConflict: "id" }
      );
  };

  const selectLayoutProfile = (profileId) => {
    const target = layoutProfiles.find(p => p.id === profileId);
    if (!target) return;
    setActiveLayoutProfileId(target.id);
    setGlobalLayout(target.layoutStyles || {});
    setMenuTemplate(target.menuTemplate || null);
  };

  const createLayoutProfile = () => {
    const nextId = `layout_${Date.now()}`;
    const nextName = `Layout ${layoutProfiles.length + 1}`;
    const profile = { id: nextId, name: nextName, layoutStyles: {}, menuTemplate: null };
    const nextProfiles = [...layoutProfiles, profile];
    setLayoutProfiles(nextProfiles);
    setActiveLayoutProfileId(nextId);
    setGlobalLayout({});
    setMenuTemplate(null);
    persistLayoutProfiles(nextProfiles, nextId);
  };

  const deleteLayoutProfile = (profileId) => {
    if (layoutProfiles.length <= 1) return;
    const nextProfiles = layoutProfiles.filter(p => p.id !== profileId);
    const fallback = nextProfiles[0];
    const nextActiveId = activeLayoutProfileId === profileId ? fallback.id : activeLayoutProfileId;
    setLayoutProfiles(nextProfiles);
    setActiveLayoutProfileId(nextActiveId);
    const active = nextProfiles.find(p => p.id === nextActiveId) || fallback;
    setGlobalLayout(active?.layoutStyles || {});
    setMenuTemplate(active?.menuTemplate || null);
    persistLayoutProfiles(nextProfiles, nextActiveId);
  };

  useEffect(() => {
    if (!supabase) return;
    supabase.from(TABLES.SERVICE_SETTINGS).select("state").eq("id", "menu_layout_profiles_v1").maybeSingle()
      .then(({ data }) => {
        const profiles = Array.isArray(data?.state?.profiles) ? data.state.profiles : null;
        if (profiles?.length) {
          setLayoutProfiles(profiles);
          const activeId = String(data?.state?.activeId || profiles[0]?.id || "");
          setActiveLayoutProfileId(activeId);
          const active = profiles.find(p => p.id === activeId) || profiles[0];
          setGlobalLayout(active?.layoutStyles || {});
          setMenuTemplate(active?.menuTemplate || null);
          return;
        }
        // Compatibility fallback: hydrate from legacy single-layout keys if profile payload
        // has not been created yet.
        Promise.all([
          supabase.from(TABLES.SERVICE_SETTINGS).select("state").eq("id", "menu_layout_global").maybeSingle(),
          supabase.from(TABLES.SERVICE_SETTINGS).select("state").eq("id", "menu_layout_v2").maybeSingle(),
        ]).then(([legacyLayoutRes, legacyTemplateRes]) => {
          const legacyLayout = (legacyLayoutRes?.data?.state && typeof legacyLayoutRes.data.state === "object")
            ? legacyLayoutRes.data.state
            : {};
          const legacyTemplate = (legacyTemplateRes?.data?.state?.version === 2 && Array.isArray(legacyTemplateRes.data.state.rows))
            ? legacyTemplateRes.data.state
            : null;
          if (!legacyTemplate && Object.keys(legacyLayout).length === 0) return;
          const migrated = [{ id: "layout_1", name: "Layout 1", layoutStyles: legacyLayout, menuTemplate: legacyTemplate }];
          setLayoutProfiles(migrated);
          setActiveLayoutProfileId("layout_1");
          setGlobalLayout(legacyLayout);
          setMenuTemplate(legacyTemplate);
          persistLayoutProfiles(migrated, "layout_1");
        }).catch(() => {});
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveGlobalLayout = async () => {
    setLayoutSaving(true); setLayoutSaved(false);
    const toSave = globalLayoutRef.current;
    setLayoutProfiles(prev => {
      const next = prev.map(p => p.id === activeLayoutProfileId ? { ...p, layoutStyles: toSave } : p);
      persistLayoutProfiles(next, activeLayoutProfileId);
      return next;
    });
    setLayoutSaving(false); setLayoutSaved(true);
    setTimeout(() => setLayoutSaved(false), 2500);
  };


  // ── Menu template v2 (row-based canvas editor) ───────────────────────────
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateSaved,  setTemplateSaved]  = useState(false);
  const menuTemplateRef = useRef(menuTemplate);
  menuTemplateRef.current = menuTemplate;
  const saveMenuTemplate = async () => {
    setTemplateSaving(true); setTemplateSaved(false);
    const toSave = menuTemplateRef.current;
    setLayoutProfiles(prev => {
      const next = prev.map(p => p.id === activeLayoutProfileId ? { ...p, menuTemplate: toSave || null } : p);
      persistLayoutProfiles(next, activeLayoutProfileId);
      return next;
    });
    setTemplateSaving(false); setTemplateSaved(true);
    setTimeout(() => setTemplateSaved(false), 2500);
  };

  // ── Menu generation rules (layout behavior) ───────────────────────────────
  useEffect(() => {
    try { localStorage.setItem("milka_menu_rules", JSON.stringify(menuRules)); } catch {}
  }, [menuRules]);

  useEffect(() => {
    if (!supabase) return;
    supabase.from(TABLES.SERVICE_SETTINGS).select("state").eq("id", "menu_gen_rules").maybeSingle()
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
      const { error } = await supabase.from(TABLES.SERVICE_SETTINGS)
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
    supabase.from(TABLES.SERVICE_SETTINGS).select("state").eq("id", "quick_access").maybeSingle()
      .then(({ data }) => {
        if (data?.state?.items?.length) setQuickAccessItems(data.state.items);
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateQuickAccess = (items) => {
    setQuickAccessItems(items);
    if (supabase) {
      supabase.from(TABLES.SERVICE_SETTINGS)
        .upsert({ id: "quick_access", state: { items }, updated_at: new Date().toISOString() }, { onConflict: "id" })
        .then(() => {});
    }
  };

  // ── Aperitif quick-button options (data-driven from Quick Access config) ──
  // aperitifOptions: all enabled items (used in MenuGenerator — full list incl. menuOnly).
  // serviceAperitifOptions: excludes items marked menuOnly (used in service DisplayBoard).
  const aperitifOptions = useMemo(() => {
    const fromQuickAccess = quickAccessItems.filter(i => i.enabled)
      .map(i => ({
        label: i.label,
        searchKey: i.searchKey || i.label,
        linkedKey: i.linkedKey,
        type: i.type || "wine",
      }));
    if (fromQuickAccess.length > 0) return fromQuickAccess;
    // Fallback to aperitif_btn column from courses
    const fromSheet = [...new Set(activeMenuCourses.map(c => c.aperitif_btn).filter(Boolean))].slice(0, 4);
    if (fromSheet.length > 0) return fromSheet.map(l => ({ label: l, searchKey: l, type: "wine" }));
    return DEFAULT_QUICK_ACCESS_ITEMS.filter(i => i.enabled).map(i => ({
      label: i.label,
      searchKey: i.searchKey || i.label,
      linkedKey: i.linkedKey,
      type: i.type || "wine",
    }));
  }, [quickAccessItems, activeMenuCourses]);

  const serviceAperitifOptions = useMemo(() => {
    const fromQuickAccess = quickAccessItems.filter(i => i.enabled && !i.menuOnly)
      .map(i => ({
        label: i.label,
        searchKey: i.searchKey || i.label,
        linkedKey: i.linkedKey,
        type: i.type || "wine",
      }));
    if (fromQuickAccess.length > 0) return fromQuickAccess;
    const fromSheet = [...new Set(activeMenuCourses.map(c => c.aperitif_btn).filter(Boolean))].slice(0, 4);
    if (fromSheet.length > 0) return fromSheet.map(l => ({ label: l, searchKey: l, type: "wine" }));
    return DEFAULT_QUICK_ACCESS_ITEMS.filter(i => i.enabled && !i.menuOnly)
      .map(i => ({
        label: i.label,
        searchKey: i.searchKey || i.label,
        linkedKey: i.linkedKey,
        type: i.type || "wine",
      }));
  }, [quickAccessItems, activeMenuCourses]);

  // ── Load service tables from Supabase + subscribe realtime ────────────────
  useEffect(() => {
    if (!supabase) return;
    let isMounted = true;

    const gateTimeout = setTimeout(() => { if (isMounted) setHydrated(true); }, 1000);

    const loadRemoteTables = async () => {
      const { data, error } = await supabase
        .from(TABLES.SERVICE_TABLES)
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

    // Polling fallback — refreshes every 15 s in case realtime misses an event
    const pollInterval = setInterval(() => { if (isMounted) loadRemoteTables(); }, 15000);

    // Immediately re-fetch when the tab/screen becomes visible (e.g. kitchen display wakes up)
    const onVisibilityChange = () => { if (!document.hidden && isMounted) loadRemoteTables(); };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      isMounted = false;
      clearTimeout(gateTimeout);
      clearInterval(pollInterval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useRealtimeTable({
    supabase,
    channelName: "milka-service-tables-realtime",
    table: TABLES.SERVICE_TABLES,
    onChange: (payload) => {
      if (payload.eventType === "DELETE") {
        const tableId = Number(payload.old?.table_id);
        if (!tableId) return;
        bumpLocalTableFresh(tableId);
        setTables(prev => prev.map(t => t.id === tableId ? blankTable(tableId) : t));
        setSyncStatus("live");
        return;
      }
      if (!payload.new) return;
      applyRemoteTableRow(payload.new);
      const remoteIdx = tablesRef.current.findIndex(t => t.id === Number(payload.new.table_id));
      if (remoteIdx !== -1) {
        const next = [...prevTablesJsonRef.current];
        next[remoteIdx] = JSON.stringify(sanitizeTable({ id: Number(payload.new.table_id), ...(payload.new.data || {}) }));
        prevTablesJsonRef.current = next;
      }
      setSyncStatus("live");
    },
    enabled: Boolean(supabase),
  });

  // ── Beverages: load from Supabase + realtime ─────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    let mounted = true;

    const pickRowsForCategory = (data, cat) => {
      const rows = data.filter(r => r.category === cat);
      const manual = rows.filter(r => r.source === "manual").sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      const chosen = manual.length > 0 ? manual : rows.filter(r => r.source === "sync").sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
      return chosen.map((r, i) => ({ id: r.id, name: r.name, notes: r.notes || "", position: r.position ?? i }));
    };

    const loadBevs = async () => {
      const { data, error } = await supabase
        .from(TABLES.BEVERAGES)
        .select("id, category, name, notes, position, source")
        .order("position", { ascending: true });
      if (!mounted || error || !data) return;
      const c = pickRowsForCategory(data, "cocktail");
      const s = pickRowsForCategory(data, "spirit");
      const b = pickRowsForCategory(data, "beer");
      setCocktails(c);
      setSpirits(s);
      setBeers(b);
      writeLocalBeverages({ cocktails: c, spirits: s, beers: b });
    };

    loadBevs();

    return () => { mounted = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useRealtimeTable({
    supabase,
    channelName: "milka-beverages",
    table: TABLES.BEVERAGES,
    onChange: () => {
      if (supabase) {
        supabase
          .from(TABLES.BEVERAGES)
          .select("id, category, name, notes, position, source")
          .order("position", { ascending: true })
          .then(({ data, error }) => {
            if (error || !data) return;
            const pickRowsForCategory = (rows, cat) => {
              const all = rows.filter(r => r.category === cat);
              const manual = all.filter(r => r.source === "manual").sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
              const chosen = manual.length > 0 ? manual : all.filter(r => r.source === "sync").sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
              return chosen.map((r, i) => ({ id: r.id, name: r.name, notes: r.notes || "", position: r.position ?? i }));
            };
            const c = pickRowsForCategory(data, "cocktail");
            const s = pickRowsForCategory(data, "spirit");
            const b = pickRowsForCategory(data, "beer");
            setCocktails(c);
            setSpirits(s);
            setBeers(b);
            writeLocalBeverages({ cocktails: c, spirits: s, beers: b });
          });
      }
    },
    enabled: Boolean(supabase),
  });

  // ── Wines: load from Supabase wines table + realtime ─────────────────────────
  const loadWines = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase
      .from(TABLES.WINES)
      .select("key, name, wine_name, producer, vintage, region, country, by_glass, source")
      .order("name", { ascending: true });
    if (error || !data) return;
    setWines(data.map(r => ({
      id: r.key, name: r.wine_name || r.name,
      producer: r.producer || "", vintage: r.vintage || "",
      region: r.region || "", country: r.country || "",
      byGlass: r.by_glass ?? false,
      source: r.source || "sync",
    })));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!supabase) return;
    loadWines();
    return undefined;
  }, [loadWines]);

  useRealtimeTable({
    supabase,
    channelName: "milka-wines",
    table: TABLES.WINES,
    onChange: () => { loadWines(); },
    enabled: Boolean(supabase),
  });

  // ── Service date + reservations: load from Supabase + realtime ──────────────
  useEffect(() => {
    if (!supabase) return;
    let mounted = true;

    // Restore service date saved by a previous session
    supabase.from(TABLES.SERVICE_SETTINGS).select("state").eq("id", "service_date").single()
      .then(({ data }) => {
        if (!mounted || !data?.state?.date) return;
        setServiceDate(d => d || data.state.date); // local state wins if already set
        try { localStorage.setItem("milka_service_date", data.state.date); } catch {}
      });

    // Load reservations for -7 days … +30 days so the planner is pre-populated
    const past   = new Date(); past.setDate(past.getDate() - 7);
    const future = new Date(); future.setDate(future.getDate() + 30);
    supabase.from(TABLES.RESERVATIONS).select("*")
      .gte("date", toLocalDateISO(past))
      .lte("date", toLocalDateISO(future))
      .order("date").order("created_at")
      .then(({ data, error }) => {
        if (!mounted || error || !data) return;
        setReservations(data);
      });

    return () => { mounted = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useRealtimeTable({
    supabase,
    channelName: "milka-reservations",
    table: TABLES.RESERVATIONS,
    onChange: (payload) => {
      if (payload.eventType === "DELETE") {
        setReservations(prev => prev.filter(r => r.id !== payload.old?.id));
      } else if (payload.new) {
        setReservations(prev => {
          const without = prev.filter(r => r.id !== payload.new.id);
          return [...without, payload.new];
        });
      }
    },
    enabled: Boolean(supabase),
  });

  // ── Menu courses: load from Supabase (app is the source of truth) ───────────
  useEffect(() => {
    let mounted = true;

    const loadCourses = async () => {
      try {
        const courses = await fetchMenuCourses();
        if (!mounted || !courses) return;
        setMenuCourses(courses);
        // Compatibility/safety: if template is blank but courses exist, synthesize default rows
        // so the editor isn't an empty screen.
        setMenuTemplate((prev) => {
          if (prev?.version === 2 && Array.isArray(prev.rows) && prev.rows.length > 0) return prev;
          if (!courses.length) return prev;
          return buildDefaultTemplate(courses);
        });
      } catch (error) {
        console.warn("Menu courses fetch failed:", error);
      }
    };

    loadMenuCoursesRef.current = loadCourses;
    loadCourses();

    return () => { mounted = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useRealtimeTable({
    supabase,
    channelName: "milka-menu-courses",
    table: TABLES.MENU_COURSES,
    onChange: () => { loadMenuCoursesRef.current?.(); },
    enabled: Boolean(supabase),
  });

  // Only count primary tables in groups (secondaries have same guest count stamped on them)
  const isPrimary = t => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup);
  const active   = tables.filter(t => t.active).filter(isPrimary);
  const seated   = active.reduce((a, t) => a + t.guests, 0);
  const reserved = tables.filter(t => !t.active && (t.resName || t.resTime)).filter(isPrimary).length;

  const syncLabel = syncStatus === "live" ? "SYNC" : syncStatus === "local-only" ? "LOCAL" : syncStatus === "connecting" ? "LINK" : "ERROR";
  const syncLive  = syncStatus === "live";

  const hProps = {
    appName: APP_NAME,
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

  // Preview — visit /#preview to inspect TableCard design without auth
  if (window.location.hash === "#preview") return (
    <div style={{ backgroundColor: tokens.ink.bg, minHeight: "100vh", padding: "48px 40px", fontFamily: tokens.font }}>
      <div style={{ marginBottom: "48px", borderBottom: `1px solid ${tokens.ink[4]}`, paddingBottom: "24px" }}>
        <div style={{ fontSize: "10px", letterSpacing: "0.12em", textTransform: "uppercase", color: tokens.ink[3], marginBottom: "8px" }}>MILKA SERVICE BOARD</div>
        <div style={{ fontSize: "24px", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 500, color: tokens.ink[0] }}>TABLECARD / VISUAL PREVIEW</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "32px" }}>
        {[
          { label: "Active — mid-service, restrictions", props: { tableNumber: 3, covers: 8, seatedAt: "19:42", status: "active", courses: 5, activeCourse: 2, courseName: "Appetizer", courseItem: "Beef Tartare", restrictions: [{ guest: "G_A", flags: ["GLUTEN"] }, { guest: "G_C", flags: ["DAIRY", "NUTS"] }], actions: [{ label: "ADVANCE COURSE", onClick: () => {} }, { label: "FLAG DELAY", onClick: () => {} }] } },
          { label: "Active — first course, no restrictions", props: { tableNumber: 7, covers: 2, seatedAt: "20:15", status: "active", courses: 4, activeCourse: 1, courseName: "Amuse-Bouche", courseItem: "Oyster Mignonette", restrictions: [], actions: [{ label: "ADVANCE COURSE", onClick: () => {} }] } },
          { label: "Warn — delayed table", props: { tableNumber: 12, covers: 4, seatedAt: "19:10", status: "warn", courses: 4, activeCourse: 3, courseName: "Main", courseItem: "Duck Confit", restrictions: [{ guest: "G_B", flags: ["GLUTEN"] }], actions: [{ label: "NOTIFY KITCHEN", onClick: () => {} }] } },
          { label: "Done — table completed", props: { tableNumber: 5, covers: 6, seatedAt: "18:30", status: "done", courses: 4, activeCourse: 4, courseName: "Dessert", courseItem: "Crème Brûlée", restrictions: [], actions: [] } },
          { label: "Active — final course, multi-restriction", props: { tableNumber: 9, covers: 3, seatedAt: "20:00", status: "active", courses: 3, activeCourse: 3, courseName: "Dessert", courseItem: "Chocolate Fondant", restrictions: [{ guest: "G_A", flags: ["NUTS"] }, { guest: "G_B", flags: ["DAIRY", "EGGS"] }, { guest: "G_C", flags: ["GLUTEN", "NUTS"] }], actions: [{ label: "CLOSE TABLE", onClick: () => {} }] } },
        ].map(({ label, props }) => (
          <div key={label}>
            <div style={{ fontSize: "10px", letterSpacing: "0.12em", textTransform: "uppercase", color: tokens.ink[3], marginBottom: "12px" }}>{label}</div>
            <TableCard {...props} />
          </div>
        ))}
      </div>
    </div>
  );

  // Gate 1: password wall
  if (!authed) return <GateScreen onPass={() => setAuthed(true)} />;

  // Gate 2: hydration — wait for Supabase state before rendering
  if (!hydrated) return (
    <div style={{
      minHeight: "100vh", background: tokens.neutral[0], display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center",
      fontFamily: FONT, gap: 24,
    }}>
      <GlobalStyle />
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: 6, color: tokens.text.primary, marginBottom: 6 }}>{APP_NAME}</div>
        <div style={{ fontSize: 9, letterSpacing: 4, color: tokens.text.disabled }}>CONNECTING…</div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {[0,1,2].map(i => (
          <div key={i} style={{
            width: 5, height: 5, borderRadius: 0, background: tokens.neutral[200],
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
            supabase.from(TABLES.RESERVATIONS).select("*").eq("date", date)
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
      menuCourses={activeMenuCourses}
      tables={tables}
      onUpsert={upsertReservation}
      onDelete={deleteReservation}
      onUpdReservation={updTableFromReservation}
      onExit={() => changeMode(null)}
      serviceDate={serviceDate}
      onSetServiceDate={persistServiceDate}
    /></>);

  // Kitchen mode (legacy id "display") — KDS board for firing courses.
  // Mutation handlers `upd` / `updMany` are intentionally passed: kitchen
  // staff need to fire/unfire and edit notes here, so this is NOT read-only.
  if (mode === "display") return (<>
    {serviceDatePickerEl}
    <div style={{ minHeight: "100vh", background: tokens.ink.bg, fontFamily: FONT, overflowX: "hidden", WebkitTextSizeAdjust: "100%" }}>
      <GlobalStyle />
      <Header modeLabel="KITCHEN" showSummary={false} showMenu={false} showArchive={true} showInventory={false} {...hProps} />
      <div style={{ padding: appIsMobile ? "12px 10px" : "20px 24px" }}>
        <KitchenBoard tables={tables} menuCourses={activeMenuCourses} upd={upd} updMany={updMany} />
      </div>
      {archiveOpen && (
        <ArchiveModal
          tables={tables} optionalExtras={dishes}
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
    <div style={{ minHeight: "100vh", background: tokens.ink.bg, fontFamily: FONT, overflowX: "hidden", WebkitTextSizeAdjust: "100%" }}>
      <GlobalStyle />
      <MenuPage
        tables={tables}
        menuCourses={activeMenuCourses}
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
    <div style={{ minHeight: "100vh", background: tokens.neutral[0], fontFamily: FONT, overflowX: "hidden", WebkitTextSizeAdjust: "100%" }}>
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
        wines={wines}
        cocktails={cocktails}
        spirits={spirits}
        beers={beers}
        onUpdateWines={saveWines}
        onSaveBeverages={saveBeverages}
        onSyncWines={syncWines}
        syncStatus={syncStatus}
        supabaseUrl={supabaseUrl}
        hasSupabase={hasSupabaseConfig}
        logoDataUri={logoDataUri}
        onSaveLogo={saveLogo}
        layoutStyles={globalLayout}
        onUpdateLayoutStyles={setGlobalLayout}
        onSaveLayoutStyles={saveGlobalLayout}
        layoutProfiles={layoutProfiles}
        activeLayoutProfileId={activeLayoutProfileId}
        onSelectLayoutProfile={selectLayoutProfile}
        onCreateLayoutProfile={createLayoutProfile}
        onDeleteLayoutProfile={deleteLayoutProfile}
        wineSyncConfig={wineSyncConfig}
        onUpdateWineSyncConfig={setWineSyncConfig}
        onSaveWineSyncConfig={saveWineSyncConfig}
        quickAccessItems={quickAccessItems}
        onUpdateQuickAccess={updateQuickAccess}
        aperitifOptions={aperitifOptions}
        onExit={() => changeMode(null)}
      />
    </div>
  );

  // Service mode only
  return (<>
    {serviceDatePickerEl}
    <div style={{ minHeight: "100vh", background: tokens.ink.bg, fontFamily: FONT, overflowX: "hidden", WebkitTextSizeAdjust: "100%" }}>
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
        <div style={{ padding: appIsMobile ? "0 0 32px" : "0 0 48px", maxWidth: 1100, margin: "0 auto", overflowX: "hidden" }}>
          {/* [SERVICE READOUT] strip — stats + Quick Access toggle */}
          <div style={{
            borderBottom: `1px solid ${tokens.ink[4]}`,
            padding: appIsMobile ? "10px 12px" : "10px 24px",
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 10, flexWrap: "wrap",
            background: tokens.neutral[0],
            marginBottom: appIsMobile ? 14 : 20,
          }}>
            <div style={{ display: "flex", gap: appIsMobile ? 10 : 20, alignItems: "center", flexWrap: "wrap" }}>
              {/* [SERVICE READOUT] label */}
              <span style={{
                fontFamily: FONT, fontSize: "8px", letterSpacing: "0.16em",
                textTransform: "uppercase", color: tokens.ink[3], fontWeight: 400,
              }}>[READOUT]</span>

              {serviceDate && (
                <span
                  title="Click to change service date"
                  onClick={() => { setPendingModeAfterDate(mode); setShowServiceDatePicker(true); }}
                  style={{
                    fontFamily: FONT, fontSize: "9px", letterSpacing: "0.10em",
                    color: tokens.ink[1], cursor: "pointer", textTransform: "uppercase", fontWeight: 500,
                  }}
                >
                  {new Date(serviceDate + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).toUpperCase()}
                </span>
              )}
              {(() => {
                const seatedNow = tables.filter(t => t.active).filter(isPrimary).length;
                const guestsNow = tables.filter(t => t.active).filter(isPrimary).reduce((a, t) => a + (t.guests || 0), 0);
                const resvNow   = tables.filter(t => !t.active && (t.resName || t.resTime)).filter(isPrimary).length;
                return (
                  <div style={{ display: "flex", gap: appIsMobile ? 8 : 16, alignItems: "center" }}>
                    {seatedNow > 0 && (
                      <span style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.10em", color: tokens.green.text, textTransform: "uppercase", fontWeight: 500 }}>
                        ● {seatedNow} ACTIVE · {guestsNow} PAX
                      </span>
                    )}
                    {resvNow > 0 && (
                      <span style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.10em", color: tokens.ink[3], textTransform: "uppercase" }}>
                        {resvNow} RESERVED
                      </span>
                    )}
                  </div>
                );
              })()}
            </div>
            <div role="tablist" aria-label="Service view" style={{ display: "flex", gap: 0, border: `1px solid ${tokens.ink[4]}` }}>
              {[
                { id: "board", label: "[▦] BOARD" },
                { id: "quick", label: "[◈] QUICK" },
                { id: "sheet", label: "[≡] SHEET" },
              ].map((v, i, arr) => {
                const active = quickView === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setQuickView(v.id)}
                    style={{
                      fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      padding: appIsMobile ? "10px 12px" : "7px 12px",
                      border: "none",
                      borderRight: i < arr.length - 1 ? `1px solid ${tokens.ink[4]}` : "none",
                      background: active ? tokens.charcoal.default : tokens.neutral[0],
                      color: active ? tokens.neutral[0] : tokens.ink[2],
                      borderRadius: 0, cursor: "pointer",
                      transition: "all 0.12s",
                      minHeight: appIsMobile ? 40 : undefined,
                      touchAction: "manipulation",
                      fontWeight: active ? 500 : 400,
                    }}
                  >
                    {v.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Service sub-view: BOARD / QUICK / SHEET */}
          {quickView === "sheet" ? (
            <SheetView
              tables={tables}
              menuCourses={activeMenuCourses}
              selectedId={sheetSel}
              onSelect={id => setSheetSel(id)}
              onOpenDetail={id => setSel(id)}
              onFireNext={(tableId, courseKey) => {
                const t = tables.find(x => x.id === tableId);
                const log = { ...(t?.kitchenLog || {}) };
                log[courseKey] = { firedAt: fmt(new Date()) };
                upd(tableId, "kitchenLog", log);
              }}
              onSeat={seatTable}
              onUnseat={unseatTable}
              isMobile={appIsMobile}
            />
          ) : (() => {
            const visibleTables = tables
              .filter(t => t.active || t.resName || t.resTime)
              .filter(t => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup));

            return (
              <DisplayBoard
                tables={visibleTables}
                optionalExtras={dishes}
                optionalPairings={pairings}
                upd={upd}
                quickMode={quickView === "quick"}
                updSeat={updSeat}
                onCardClick={id => setSel(id)}
                onSeat={seatTable}
                onUnseat={unseatTable}
                aperitifOptions={serviceAperitifOptions}
                wines={wines}
                cocktails={cocktails}
                spirits={spirits}
                beers={beers}
              />
            );
          })()}
        </div>
      ) : (
        <Detail
          table={selTable}
          optionalExtras={dishes}
          optionalPairings={pairings}
          wines={wines}
          cocktails={cocktails}
          spirits={spirits}
          beers={beers}
          menuCourses={activeMenuCourses}
          aperitifOptions={serviceAperitifOptions}
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
        <SummaryModal tables={tables} optionalExtras={dishes} onClose={() => setSummaryOpen(false)} />
      )}
      {archiveOpen && (
        <ArchiveModal
          tables={tables} optionalExtras={dishes}
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
