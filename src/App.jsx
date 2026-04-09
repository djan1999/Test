import { useState, useRef, useEffect, useMemo, useCallback } from "react";
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
  parseBilingual, applyCourseRestriction,
  RESTRICTION_PRIORITY_KEYS, RESTRICTION_COLUMN_MAP,
  parseMenuRow, RESTRICTION_KEYS, normalizeCourseCategory,
} from "./utils/menuUtils.js";
import { generateMenuHTML, DEFAULT_MENU_RULES, normalizeMenuRules } from "./utils/menuGenerator.js";
import { buildDefaultTemplate, makeRowId } from "./utils/menuTemplateSchema.js";
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
import { useRealtimeTable } from "./hooks/useRealtimeTable.js";
import { useOfflineQueue } from "./hooks/useOfflineQueue.js";
import { AdminLayout } from "./components/admin/index.js";
import { DIETARY_KEYS, RESTRICTIONS, RESTRICTION_GROUPS, restrLabel, restrCompact } from "./constants/dietary.js";
import { WATER_OPTS, waterStyle, PAIRINGS, pairingStyle } from "./constants/pairings.js";
import { BEV_TYPES } from "./constants/beverageTypes.js";
import { COUNTRY_NAMES } from "./constants/countries.js";
import { supabase, hasSupabaseConfig, supabaseUrl, TABLES } from "./lib/supabaseClient.js";
import { tokens } from "./styles/tokens.js";
import { baseInput, fieldLabel as mixinFieldLabel, chip as mixinChip, circleButton as mixinCircleButton } from "./styles/mixins.js";
import WaterPicker from "./components/service/WaterPicker.jsx";
import SwapPicker from "./components/service/SwapPicker.jsx";
import BlurInput from "./components/ui/BlurInput.jsx";
import FullModal from "./components/ui/FullModal.jsx";
import BevEditRow from "./components/menu/BevEditRow.jsx";
import KitchenBoard, { KitchenTicket } from "./components/kitchen/KitchenBoard.jsx";
import ServiceDatePicker from "./components/reservations/ServiceDatePicker.jsx";
import ReservationManager from "./components/reservations/ReservationManager.jsx";
import ReservationModal from "./components/reservations/ReservationModal.jsx";
import SummaryModal from "./components/modals/SummaryModal.jsx";
import ArchiveModal from "./components/modals/ArchiveModal.jsx";
import InventoryModal from "./components/modals/InventoryModal.jsx";
import Header from "./components/ui/Header.jsx";
import GateScreen from "./components/gate/GateScreen.jsx";
import LoginScreen from "./components/login/LoginScreen.jsx";
import MenuPage from "./components/menu/MenuPage.jsx";
import MenuGenerator from "./components/menu/MenuGenerator.jsx";
import WineSyncTab from "./components/admin/WineSyncTab.jsx";
import DrinkListEditor from "./components/admin/DrinkListEditor.jsx";
import CourseEditor from "./components/admin/CourseEditor.jsx";
import MenuCoursesTab from "./components/admin/MenuCoursesTab.jsx";
import AdminPanel from "./components/admin/AdminPanel.jsx";
import WineSearch from "./components/service/WineSearch.jsx";
import DrinkSearch from "./components/service/DrinkSearch.jsx";
import BeverageSearch from "./components/service/BeverageSearch.jsx";

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
    wineCountries: countries.map(c => String(c || "").trim()).filter(Boolean),
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
    course_category: normalizeCourseCategory(course.course_category, course.optional_flag),
    optional_flag: course.optional_flag,
    optional_pairing_flag: course.optional_pairing_flag || "",
    optional_pairing_label: course.optional_pairing_label || "",
    optional_pairing_enabled: course.optional_pairing_enabled !== false,
    optional_pairing_default_on: course.optional_pairing_default_on !== false,
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
    .from(TABLES.MENU_COURSES)
    .select("*")
    .order("position", { ascending: true });
  if (error) throw error;
  return (data || []).map(supabaseRowToCourse);
}


const FONT = tokens.font;
const MOBILE_SAFE_INPUT_SIZE = tokens.mobileInputSize;

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
  border: `1px solid ${isLive ? "#8fc39f" : "#d8d8d8"}`,
  borderRadius: 999,
  background: isLive ? "#eef8f1" : "#f6f6f6",
  color: isLive ? "#2f7a45" : "#555",
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

const normalizeOptionalKey = (value) =>
  String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

function optionalExtrasFromCourses(menuCourses = []) {
  const byKey = new Map();
  (menuCourses || []).forEach((c) => {
    const category = normalizeCourseCategory(c?.course_category, c?.optional_flag);
    if (category !== "optional" && category !== "celebration") return;
    const key = normalizeOptionalKey(c?.optional_flag);
    if (!key) return;
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

function optionalPairingsFromCourses(menuCourses = []) {
  const byKey = new Map();
  (menuCourses || []).forEach((c) => {
    const key = normalizeOptionalKey(c?.optional_pairing_flag);
    if (!key) return;
    const enabled = c?.optional_pairing_enabled !== false;
    if (!enabled) return;
    const label = String(c?.optional_pairing_label || c?.menu?.name || key).trim() || key;
    const hasAlco = !!(c?.wp?.name || c?.wp?.sub || c?.os?.name || c?.os?.sub || c?.premium?.name || c?.premium?.sub);
    const hasNonAlco = !!(c?.na?.name || c?.na?.sub);
    if (!hasAlco && !hasNonAlco) return;
    byKey.set(key, {
      key,
      label,
      hasAlco,
      hasNonAlco,
      defaultOn: c?.optional_pairing_default_on !== false,
    });
  });
  return [...byKey.values()];
}

const circBtnSm = { ...mixinCircleButton };
// ── Menu Sync Tab ─────────────────────────────────────────────────────────────

// ── Admin Panel ───────────────────────────────────────────────────────────────

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
function Detail({ table, optionalExtras = [], optionalPairings = [], wines = [], cocktails = [], spirits = [], beers = [], menuCourses = MENU_DATA, aperitifOptions = [], mode, onBack, upd, updSeat, setGuests, swapSeats, onApplySeatToAll, onClearBeverages }) {
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

              {/* Optional extras (derived from optional_flag) */}
              {optionalExtras.length > 0 && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  {optionalExtras.map(dish => {
                    const extra = seat.extras?.[dish.key] || seat.extras?.[dish.id] || { ordered: false, pairing: dish.pairings[0] };
                    return (
                      <div key={dish.key} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 88 }}>
                        <div style={{ ...fieldLabel, marginBottom: 4 }}>{dish.name}</div>
                        <button onClick={() => updSeat(seat.id, "extras", {
                          ...seat.extras, [dish.key]: { ...extra, ordered: !extra.ordered }
                        })} style={{
                          fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 8px", border: "1px solid",
                          borderColor: extra.ordered ? "#aaddaa" : "#ebebeb", borderRadius: 2, cursor: "pointer",
                          background: extra.ordered ? "#f0faf0" : "#fff", color: extra.ordered ? "#4a8a4a" : "#555",
                          transition: "all 0.1s",
                        }}>{extra.ordered ? "YES" : "NO"}</button>
                        <select value={extra.pairing || dish.pairings[0]} disabled={!extra.ordered}
                          onChange={e => updSeat(seat.id, "extras", { ...seat.extras, [dish.key]: { ...extra, pairing: e.target.value } })}
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
              {optionalPairings.length > 0 && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
                  {optionalPairings.map(opt => {
                    const cur = seat.optionalPairings?.[opt.key] || { ordered: opt.defaultOn !== false };
                    const active = !!cur.ordered;
                    const seatPairing = String(seat.pairing || "").trim();
                    const wantsNonAlco = seatPairing === "Non-Alc";
                    const hasDataForSeatPairing = seatPairing
                      ? (wantsNonAlco ? opt.hasNonAlco : opt.hasAlco)
                      : true;
                    return (
                      <div key={opt.key} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 88 }}>
                        <div style={{ ...fieldLabel, marginBottom: 4 }}>{opt.label}</div>
                        <button onClick={() => updSeat(seat.id, "optionalPairings", {
                          ...(seat.optionalPairings || {}),
                          [opt.key]: { ...cur, ordered: !cur.ordered },
                        })} style={{
                          fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 8px", border: "1px solid",
                          borderColor: active ? "#e0c8c8" : "#ebebeb", borderRadius: 2, cursor: "pointer",
                          background: active ? "#fff5f5" : "#fff", color: active ? "#9a5050" : "#555",
                        }}>{active ? "ENABLED" : "DISABLED"}</button>
                        <div style={{
                          fontFamily: FONT, fontSize: 9, color: hasDataForSeatPairing ? "#666" : "#b07070",
                          border: "1px solid #ebebeb", borderRadius: 2, padding: "5px 6px",
                          background: hasDataForSeatPairing ? "#fafafa" : "#fff5f5",
                        }}>
                          {seatPairing === "Non-Alc" ? "AUTO: NON-ALCO" : seatPairing ? "AUTO: ALCO" : "AUTO: WAITING FOR PAIRING"}
                          {!hasDataForSeatPairing ? " · NO DATA" : ""}
                        </div>
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
function TableSeatDetail({ table, isMobile, optionalExtras = [] }) {

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
          const seatExtras = optionalExtras.filter(d => seat.extras?.[d.key]?.ordered);
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
                    const ex = seat.extras[d.key];
                    return <span key={d.key} style={{ fontFamily: FONT, fontSize: 11, letterSpacing: 0.3, padding: "4px 9px", borderRadius: 999, background: "#e8f5e8", border: "1px solid #88cc88", color: "#2a6a2a" }}>{d.name}{ex.pairing && ex.pairing !== "—" ? ` · ${ex.pairing}` : ""}</span>;
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
function DisplayBoardCard({ t, quickMode, upd, updSeat, onCardClick, onSeat, onUnseat, optionalExtras = [], optionalPairings = [], aperitifOptions, wines = [], cocktails = [] }) {
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
              const extras  = optionalExtras.filter(d => (s.extras?.[d.key] || s.extras?.[d.id])?.ordered);
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
                      {/* Optional extras quick toggles */}
                      {(optionalExtras || []).slice(0, 3).map((dish) => {
                        const extra = s.extras?.[dish.key] || s.extras?.[dish.id] || { ordered: false, pairing: dish.pairings?.[0] || "—" };
                        const active = !!extra.ordered;
                        return (
                          <button
                            key={dish.key || dish.id}
                            onClick={() => updSeat && updSeat(t.id, s.id, "extras", { ...s.extras, [dish.key]: { ...extra, ordered: !extra.ordered } })}
                            style={{
                              fontFamily: FONT, fontSize: 9, letterSpacing: 0.3, padding: "3px 9px",
                              border: `1px solid ${active ? "#b0b0b0" : "#e8e8e8"}`, borderRadius: 20, cursor: "pointer",
                              background: active ? "#f3f3f3" : "#fff", color: active ? "#444" : "#aaa",
                              transition: "all 0.1s",
                            }}
                          >
                            {String(dish.name || dish.key || "").slice(0, 8)}
                          </button>
                        );
                      })}
                      {/* Optional pairing quick toggles */}
                      {(optionalPairings || []).slice(0, 3).map((opt) => {
                        const active = !!s.optionalPairings?.[opt.key]?.ordered;
                        return (
                          <button
                            key={opt.key}
                            onClick={() => updSeat && updSeat(t.id, s.id, "optionalPairings", {
                              ...(s.optionalPairings || {}),
                              [opt.key]: { ordered: !active },
                            })}
                            style={{
                              fontFamily: FONT, fontSize: 9, letterSpacing: 0.3, padding: "3px 9px",
                              border: `1px solid ${active ? "#a0c8a0" : "#e8e8e8"}`, borderRadius: 20, cursor: "pointer",
                              background: active ? "#eaf4ea" : "#fff", color: active ? "#3a7a3a" : "#aaa",
                              transition: "all 0.1s",
                            }}
                          >
                            {String(opt.label || opt.key || "").slice(0, 8)}
                          </button>
                        );
                      })}
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
                    const ex = s.extras[d.key] || s.extras[d.id];
                    return (
                      <span key={d.key} style={{ fontFamily: FONT, fontSize: 10, padding: "2px 7px", borderRadius: 3, border: "1px solid #88cc88", color: "#2a6a2a", background: "#e8f5e8" }}>
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

function DisplayBoard({ tables, optionalExtras = [], optionalPairings = [], upd, quickMode = false, updSeat, onCardClick, onSeat, onUnseat, aperitifOptions = [], wines = [], cocktails = [] }) {
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
                  optionalExtras={optionalExtras}
                  optionalPairings={optionalPairings}
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

function ServiceQuickCard({ table, updSeat, onDetails, optionalExtras = [] }) {
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
                {(table.restrictions || []).filter(r => r.pos === seat.id).map((r, i) => (
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
                <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
                  {optionalExtras.slice(0, 3).map((dish) => {
                    const extra = seat.extras?.[dish.key] || seat.extras?.[dish.id] || { ordered: false, pairing: dish.pairings?.[0] || "—" };
                    const active = !!extra.ordered;
                    return (
                      <div key={dish.key} style={{ display: "flex", gap: 3, alignItems: "center" }}>
                        {extraBtn(dish.name.slice(0, 4), active, "#7a7a7a", () => toggleExtra(seat, dish.key))}
                        {active && (dish.pairings || ["—"]).slice(0, 3).map((p) => {
                          const sel = (extra.pairing || "—") === p;
                          return (
                            <button key={p} onClick={() => updSeat(table.id, seat.id, "extras", { ...seat.extras, [dish.key]: { ...extra, pairing: p } })} style={{
                              fontFamily: FONT, fontSize: 8, letterSpacing: 0.5,
                              padding: "4px 6px", border: "1px solid",
                              borderColor: sel ? "#7a7a7a" : "#e0e0e0",
                              borderRadius: 2, cursor: "pointer", lineHeight: 1,
                              background: sel ? "#f3f3f3" : "#fff",
                              color: sel ? "#444" : "#aaa",
                            }}>{p === "Champagne" ? "Champ" : p}</button>
                          );
                        })}
                      </div>
                    );
                  })}
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

function ServiceQuickView({ tables, updSeat, setSel, optionalExtras = [] }) {
  const activeTables = tables.filter(t => t.active || t.resName || t.resTime);
  if (activeTables.length === 0) return (
    <div style={{ fontFamily: FONT, fontSize: 11, color: "#bbb", textAlign: "center", paddingTop: 80 }}>
      No active tables
    </div>
  );
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
      {activeTables.map(t => (
        <ServiceQuickCard key={t.id} table={t} updSeat={updSeat} optionalExtras={optionalExtras} onDetails={() => setSel(t.id)} />
      ))}
    </div>
  );
}

// ── Kitchen Board (KDS) ────────────────────────────────────────────────────────
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

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const localSnapshot = readLocalBoardState();
  const initialState  = localSnapshot || defaultBoardState();

  const localBev = readLocalBeverages();
  const loadMenuCoursesRef = useRef(null);

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

  const applyingRemoteRef  = useRef(false);
  const saveTimerRef       = useRef(null);
  const prevTablesJsonRef  = useRef((initialState.tables || initTables).map(t => JSON.stringify(sanitizeTable(t))));
  const tablesRef          = useRef(tables);

  const offlineQueue = useOfflineQueue({ supabase });
  const enqueueServiceTableUpsert = useCallback(async (rows) => {
    const payloadRows = Array.isArray(rows) ? rows : [];
    if (payloadRows.length === 0) return { ok: true };

    const op = async () => {
      const { error } = await supabase.from(TABLES.SERVICE_TABLES).upsert(payloadRows, { onConflict: "table_id" });
      if (error) throw error;
    };

    if (!supabase) return { ok: false, queued: false };

    if (!navigator.onLine) {
      await offlineQueue.enqueue({
        kind: "service_tables_upsert",
        payload: { rows: payloadRows },
        run: op,
      });
      setSyncStatus("local-only");
      return { ok: true, queued: true };
    }

    try {
      await op();
      return { ok: true, queued: false };
    } catch (error) {
      await offlineQueue.enqueue({
        kind: "service_tables_upsert",
        payload: { rows: payloadRows },
        run: op,
      });
      setSyncStatus("sync-error");
      return { ok: false, queued: true, error };
    }
  }, [offlineQueue]);

  const enqueueReservationMutation = useCallback(async ({ kind, run }) => {
    if (!supabase) return { ok: false, queued: false };

    if (!navigator.onLine) {
      await offlineQueue.enqueue({ kind, payload: {}, run });
      setSyncStatus("local-only");
      return { ok: true, queued: true };
    }

    try {
      await run();
      return { ok: true, queued: false };
    } catch (error) {
      await offlineQueue.enqueue({ kind, payload: {}, run });
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

  const dishes   = useMemo(() => optionalExtrasFromCourses(menuCourses),  [menuCourses]);
  const pairings = useMemo(() => optionalPairingsFromCourses(menuCourses), [menuCourses]);

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
      const cfg = normalizeSyncConfig(syncConfigRef.current);
      const payload = encodeURIComponent(JSON.stringify(cfg));
      const base = secret ? `/api/sync-wines?secret=${encodeURIComponent(secret)}` : "/api/sync-wines";
      const url = `${base}${base.includes("?") ? "&" : "?"}config=${payload}`;
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
      .from(TABLES.MENU_COURSES)
      .upsert(rows, { onConflict: "position" });
    if (error) { console.error("Menu save failed:", error); return; }
    // Remove courses that no longer exist
    const positions = courses.map(c => c.position);
    if (positions.length > 0) {
      await supabase.from(TABLES.MENU_COURSES).delete().not("position", "in", `(${positions.join(",")})`);
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
    await supabase.from(TABLES.BEVERAGES).delete().in("category", ["cocktail", "spirit", "beer"]);
    if (rows.length > 0) await supabase.from(TABLES.BEVERAGES).insert(rows);
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
    // Celebration-category dish keys to sync with the birthday flag
    const celebrationKeys = (menuCourses || [])
      .filter(c => normalizeCourseCategory(c?.course_category, c?.optional_flag) === "celebration")
      .map(c => normalizeOptionalKey(c?.optional_flag))
      .filter(Boolean);
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
      return { ...t, resName: name, resTime: time, menuType, guestType, room, guests, seats, birthday, cakeNote: birthday ? (cakeNote || "") : "", restrictions, notes, lang: lang || "en", tableGroup: sortedGroup };
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
        const result = await enqueueReservationMutation({
          kind: "reservation_update",
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
      const result = await enqueueReservationMutation({
        kind: "reservation_insert",
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
    const result = await enqueueReservationMutation({
      kind: "reservation_delete",
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
            room:               d.room || "",
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

    // Polling fallback — refreshes every 5 s in case realtime misses an event
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
        applyingRemoteRef.current = true;
        setTables(prev => prev.map(t => t.id === tableId ? blankTable(tableId) : t));
        setTimeout(() => { applyingRemoteRef.current = false; }, 0);
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

    const loadBevs = async () => {
      const { data, error } = await supabase
        .from(TABLES.BEVERAGES)
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
          .select("id, category, name, notes, position")
          .order("position", { ascending: true })
          .then(({ data, error }) => {
            if (error || !data) return;
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
        wines={wines}
        cocktails={cocktails}
        spirits={spirits}
        beers={beers}
        onUpdateWines={setWines}
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
                optionalExtras={dishes}
                optionalPairings={pairings}
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
          optionalExtras={dishes}
          optionalPairings={pairings}
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
