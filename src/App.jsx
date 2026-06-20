import { useState, useRef, useEffect, useMemo, useCallback, lazy, Suspense } from "react";
import {
  RESTRICTION_KEYS, RESTRICTION_COLUMN_MAP, normalizeCourseCategory,
  normalizeOptionalKey, optionalPairingsFromCourses,
} from "./utils/menuUtils.js";
import { DEFAULT_MENU_RULES, normalizeMenuRules } from "./utils/menuGenerator.js";
import { buildDefaultTemplate } from "./utils/menuTemplateSchema.js";
import {
  createDefaultProfiles,
  sanitizeProfilesPayload,
  migrateV1ToV2,
  migrateLegacySingleLayout,
  duplicateProfile,
  renameProfile,
  canDeleteProfile,
  isProfileAssigned,
  makeProfile,
  buildShortMenuTemplateFromCourses,
} from "./utils/menuLayoutProfiles.js";
import {
  readLocalBeverages, writeLocalBeverages,
  readLocalBoardState, writeLocalBoardState,
  readLocalMenuCourses, writeLocalMenuCourses,
  readLocalWines, writeLocalWines,
  readLocalLogo, writeLocalLogo,
  readLocalReservations, writeLocalReservations,
  readLocalRestrictions, writeLocalRestrictions,
  readLocalCourseNotes, writeLocalCourseNotes,
  workspaceKey,
  STORAGE_KEY,
} from "./utils/storage.js";
import {
  makeSeats, blankTable, sanitizeTable, initTables, fmt, parseHHMM,
  reservationDescriptiveFields, resolveReservationSession, tableHasServiceContent,
} from "./utils/tableHelpers.js";
import { pickBeveragesForCategory } from "./utils/beverages.js";
import { planBoardWrites } from "./utils/boardPersist.js";
import { mergeTable } from "./utils/tableMerge.js";
import { reconcileTables } from "./utils/reconcile.js";
import { stampWineSources } from "./utils/wineEdit.js";
import { historyGapsByMenuType } from "./utils/archiveInsights.js";
import {
  currentServiceDay, isStaleServiceDate, isActivePastReview, shouldClearBoardOnDateChange,
  resolveServiceEntry, serviceDayForActivity, SERVICE_DATE_CHOSEN_ON_KEY,
} from "./utils/serviceDay.js";
import {
  resolveAperitifFromQuickAccessOption,
  aperitifMatchesQuickAccessOption,
} from "./utils/quickAccessResolve.js";
import { useIsMobile, BP } from "./hooks/useIsMobile.js";
import { useRealtimeTable } from "./hooks/useRealtimeTable.js";
import { useOfflineQueue } from "./hooks/useOfflineQueue.js";
import { useModalEscape } from "./hooks/useModalEscape.js";
import {
  DIETARY_KEYS,
  RESTRICTIONS,
  DEFAULT_RESTRICTIONS,
  setRestrictionsCache,
  restrLabel,
  restrCompact,
} from "./constants/dietary.js";
import { WATER_OPTS, waterStyle, PAIRINGS, pairingStyle, extraPairingForSeat } from "./constants/pairings.js";
import { kitchenSnapshot, kitchenDelta } from "./utils/kitchenAlerts.js";
import { BEV_TYPES } from "./constants/beverageTypes.js";
import { supabase, hasSupabaseConfig, supabaseUrl, TABLES, getWorkspaceId, setWorkspaceId } from "./lib/supabaseClient.js";
import { scopedFrom, scopeJob } from "./lib/scopedDb.js";
import { tokens } from "./styles/tokens.js";
import { baseInput, fieldLabel as mixinFieldLabel, chip as mixinChip, circleButton as mixinCircleButton } from "./styles/mixins.js";
import WaterPicker from "./components/service/WaterPicker.jsx";
import SwapPicker from "./components/service/SwapPicker.jsx";
import ServiceDatePicker from "./components/reservations/ServiceDatePicker.jsx";
import ResvForm from "./components/reservations/ResvForm.jsx";
import CenteredModal from "./components/ui/CenteredModal.jsx";
import Header from "./components/ui/Header.jsx";
import GlobalStyle from "./components/ui/GlobalStyle.jsx";
import GateScreen from "./components/gate/GateScreen.jsx";
import LoginScreen from "./components/login/LoginScreen.jsx";
import AuthScreen from "./components/auth/AuthScreen.jsx";
import ProfilePicker from "./components/auth/ProfilePicker.jsx";
import WineSearch from "./components/service/WineSearch.jsx";
import BeverageSearch from "./components/service/BeverageSearch.jsx";
import TableCard from "./components/TableCard/TableCard.jsx";

// Heavy mode-level views and modals are lazy-loaded so the service board (the
// critical path) ships in a small initial bundle. The PWA precaches every
// generated chunk, so these still open offline once the app is installed.
const AdminLayout = lazy(() => import("./components/admin/AdminLayout.jsx"));
const KitchenBoard = lazy(() => import("./components/kitchen/KitchenBoard.jsx"));
const ReservationManager = lazy(() => import("./components/reservations/ReservationManager.jsx"));
const MenuPage = lazy(() => import("./components/menu/MenuPage.jsx"));
const SummaryModal = lazy(() => import("./components/modals/SummaryModal.jsx"));
const ArchiveModal = lazy(() => import("./components/modals/ArchiveModal.jsx"));
const InventoryModal = lazy(() => import("./components/modals/InventoryModal.jsx"));
const SheetView = lazy(() => import("./components/service/SheetView.jsx"));

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
// Unified profile payload key. `menu_layout_profiles_v1` and the legacy
// single-layout pair (`menu_layout_global` + `menu_layout_v2`) are migrated
// into v2 on first read. The flat `menu_layouts_v1` payload from a previous
// pass is intentionally ignored — the row-based menuTemplate is the only
// guest layout system.
const MENU_LAYOUT_PROFILES_V2_KEY = "milka_menu_layout_profiles_v2";
const MENU_ACTIVE_LAYOUT_PROFILE_KEY = "milka_active_layout_profile_v1";
// Legacy keys, only read for migration.
const MENU_LAYOUT_PROFILES_V1_KEY = "milka_menu_layout_profiles_v1";
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
  DIETARY_KEYS.forEach(k => {
    const dbKey = RESTRICTION_COLUMN_MAP[k];
    restrictions[k] = dbKey ? (r[dbKey] ?? null) : null;
  });
  const rSi = r.restrictions_si || {};
  Object.entries(rSi).forEach(([k, v]) => {
    if (k.startsWith("__en_")) {
      // Custom restriction EN variant stored during write
      if (v) restrictions[k.slice("__en_".length)] = v;
    } else if (k.endsWith("__note")) {
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
  const customEn = {};
  RESTRICTION_KEYS.forEach(k => {
    if (course.restrictions?.[`${k}_si`]) restrictionColsSi[k] = course.restrictions[`${k}_si`];
    if (course.restrictions?.[`${k}_note`]) restrictionNotes[k] = course.restrictions[`${k}_note`];
    // Custom keys (no DB column) — stash EN variant in restrictions_si under __en_ prefix.
    if (!RESTRICTION_COLUMN_MAP[k] && course.restrictions?.[k] != null) {
      customEn[`__en_${k}`] = course.restrictions[k];
    }
  });
  const restrictions_si = (() => {
    const combined = { ...restrictionColsSi, ...customEn };
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
  // Only write known DB columns; custom keys are stored in restrictions_si above.
  DIETARY_KEYS.forEach(k => {
    const dbKey = RESTRICTION_COLUMN_MAP[k];
    if (dbKey) row[dbKey] = course.restrictions?.[k] ?? null;
  });
  return row;
}

// Retry a promise-returning fn with exponential backoff. Used for the initial
// background data syncs so a transient network hiccup self-heals instead of
// leaving the device on its cached/empty state until a manual refresh. The UI
// keeps showing the local cache the whole time; this only refreshes it.
async function withRetry(fn, { attempts = 4, baseMs = 600 } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      if (i < attempts - 1) await new Promise(r => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw lastErr;
}

async function fetchMenuCourses() {
  if (!supabase || !getWorkspaceId()) return null;
  const { data, error } = await scopedFrom(TABLES.MENU_COURSES)
    .select("*")
    .order("position", { ascending: true });
  if (error) throw error;
  return (data || []).map(supabaseRowToCourse);
}


const FONT = tokens.font;

// Shared fallback while a lazy-loaded view chunk is fetched (instant from the
// PWA precache after first load, so this rarely shows for more than a frame).
const lazyViewFallback = (
  <div style={{ minHeight: "40vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, fontSize: 10, letterSpacing: "0.22em", textTransform: "uppercase", color: "#999" }}>
    Loading…
  </div>
);

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

// ── Move Table Picker ─────────────────────────────────────────────────────────
// Modal that lets a service-mode operator move the current table's live state
// to another table id. Tables that are active/started or hold a reservation are
// shown as occupied — the operator must free them first (via Reservations) before
// they can be used as destinations.
function MoveTablePicker({ currentTable, tables = [], reservationOnTable, onCancel, onPick }) {
  const isMobile = useIsMobile(560);
  const [swapConfirm, setSwapConfirm] = useState(null); // { tid, ownerLabel }
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 200, padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: tokens.neutral[0], border: `1px solid ${tokens.ink[3]}`,
          maxWidth: 460, width: "100%", padding: 20, fontFamily: FONT,
        }}
      >
        <div style={{ fontSize: "9px", letterSpacing: "0.16em", textTransform: "uppercase", color: tokens.ink[3], marginBottom: 6 }}>
          [MOVE TABLE]
        </div>
        <div style={{ fontSize: "13px", color: tokens.ink[0], marginBottom: 12, lineHeight: 1.5 }}>
          Move <strong>T{String(currentTable.id).padStart(2, "0")}</strong>
          {currentTable.resName ? ` (${currentTable.resName})` : ""} to a different table.
          Free tables move; <span style={{ color: tokens.red.text }}>occupied</span> tables swap.
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(5, 1fr)" : "repeat(5, 1fr)", gap: 6, marginBottom: 14 }}>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((tid) => {
            const isSelf = tid === currentTable.id;
            const dst = tables.find(t => t.id === tid);
            const dstStarted = dst && (dst.active || dst.arrivedAt
              || (dst.kitchenLog && Object.keys(dst.kitchenLog).length > 0)
              || dst.kitchenArchived);
            const ownerResv = typeof reservationOnTable === "function" ? reservationOnTable(tid) : null;
            const occupied = !!(dstStarted || dst?.resName || dst?.resTime || ownerResv);
            const subLabel = isSelf
              ? "current"
              : dstStarted
                ? "active"
                : (dst?.resName ? dst.resName.slice(0, 8) : (ownerResv?.data?.resName ? ownerResv.data.resName.slice(0, 8) : ""));
            return (
              <button
                key={tid}
                onClick={() => {
                  if (isSelf) return;
                  if (occupied) {
                    const ownerLabel = dst?.resName || ownerResv?.data?.resName || (dstStarted ? "active service" : "another reservation");
                    setSwapConfirm({ tid, ownerLabel });
                  } else {
                    onPick(tid, "move");
                  }
                }}
                disabled={isSelf}
                style={{
                  fontFamily: FONT, padding: "12px 0",
                  border: `1px solid ${isSelf ? tokens.charcoal.default : occupied ? tokens.red.border : tokens.ink[4]}`,
                  borderRadius: 0,
                  background: isSelf ? tokens.tint.parchment : occupied ? tokens.red.bg : tokens.neutral[0],
                  color: isSelf ? tokens.ink[0] : occupied ? tokens.red.text : tokens.ink[1],
                  cursor: isSelf ? "not-allowed" : "pointer",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                  touchAction: "manipulation",
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 700 }}>T{String(tid).padStart(2, "0")}</span>
                {subLabel && (
                  <span style={{ fontSize: 8, letterSpacing: "0.10em", textTransform: "uppercase", opacity: 0.7 }}>
                    {subLabel}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            onClick={onCancel}
            style={{
              fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase",
              padding: "8px 16px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0,
              cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[3],
            }}
          >CANCEL</button>
        </div>
      </div>
      {swapConfirm && (
        <div
          onClick={() => setSwapConfirm(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
            display: "flex", alignItems: "center", justifyContent: "center",
            zIndex: 250, padding: 16,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: tokens.neutral[0], border: `1px solid ${tokens.ink[3]}`,
              maxWidth: 380, width: "100%", padding: 18, fontFamily: FONT,
            }}
          >
            <div style={{ fontSize: "9px", letterSpacing: "0.16em", textTransform: "uppercase", color: tokens.red.text, marginBottom: 6 }}>
              [TABLE OCCUPIED]
            </div>
            <div style={{ fontSize: "12px", color: tokens.ink[0], marginBottom: 14, lineHeight: 1.5 }}>
              <strong>T{String(swapConfirm.tid).padStart(2, "0")}</strong> is held by <strong>{swapConfirm.ownerLabel}</strong>.
              Swap will move everything on T{String(currentTable.id).padStart(2, "0")} ↔ T{String(swapConfirm.tid).padStart(2, "0")} — orders, kitchen log, arrived time, and reservation tags.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setSwapConfirm(null)}
                style={{
                  fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase",
                  padding: "8px 16px", border: `1px solid ${tokens.ink[4]}`, borderRadius: 0,
                  cursor: "pointer", background: tokens.neutral[0], color: tokens.ink[3],
                }}
              >CANCEL</button>
              <button
                onClick={() => { onPick(swapConfirm.tid, "swap"); setSwapConfirm(null); }}
                style={{
                  fontFamily: FONT, fontSize: "9px", letterSpacing: "0.12em", textTransform: "uppercase",
                  padding: "8px 16px", border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0,
                  cursor: "pointer", background: tokens.charcoal.default, color: tokens.neutral[0], fontWeight: 600,
                }}
              >SWAP</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Detail View ───────────────────────────────────────────────────────────────
function Detail({ table, tables = [], optionalExtras = [], optionalPairings = [], wines = [], cocktails = [], spirits = [], beers = [], menuCourses = MENU_DATA, aperitifOptions = [], mode, onBack, upd, updSeat, setGuests, swapSeats, onApplySeatToAll, onClearBeverages, onClearTable, onMoveTable, reservationOnTable }) {
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
  const [showMoveTable, setShowMoveTable] = useState(false);
  const [copySourceOpen, setCopySourceOpen] = useState(false);
  // One drink search for the whole table view; the phase decides whether a
  // pick lands as an aperitif or with the menu (glasses/cocktails/…).
  const [drinkPhase, setDrinkPhase] = useState("aperitif");
  useModalEscape(() => setShowMoveTable(false), showMoveTable);
  const canMoveTable = mode === "service" && typeof onMoveTable === "function"
    && (table.active || table.arrivedAt || table.resName || table.resTime);
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
          {/* Copy any seat's choices to the whole table — not just P1's
              (the host often orders last). Tap opens the source picker. */}
          {copySourceOpen && canApplySeatToAll ? (
            <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
              <span style={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.10em", color: tokens.ink[3], textTransform: "uppercase" }}>COPY</span>
              {table.seats.map(s => (
                <button key={s.id} onClick={() => {
                  onApplySeatToAll(table.id, s.id);
                  setCopySourceOpen(false);
                }} style={{
                  fontFamily: FONT, fontSize: 9, fontWeight: 700, letterSpacing: "0.06em",
                  padding: isMobile ? "10px 10px" : "6px 9px",
                  border: `1px solid ${tokens.ink[2]}`, borderRadius: 0, cursor: "pointer",
                  background: tokens.neutral[0], color: tokens.ink[1], touchAction: "manipulation",
                }}>P{s.id}</button>
              ))}
              <button onClick={() => setCopySourceOpen(false)} style={{
                fontFamily: FONT, fontSize: 11, padding: isMobile ? "10px 8px" : "6px 8px",
                border: "none", background: "none", color: tokens.ink[3], cursor: "pointer",
              }}>×</button>
            </div>
          ) : (
            <button
              onClick={() => canApplySeatToAll && setCopySourceOpen(true)}
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
            >[Pn→ALL]</button>
          )}
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
          {canMoveTable && (
            <button
              onClick={() => setShowMoveTable(true)}
              style={{
                fontFamily: FONT, fontSize: "9px", letterSpacing: "0.10em",
                padding: isMobile ? "10px 10px" : "6px 10px",
                border: `1px solid ${tokens.charcoal.default}`, borderRadius: 0,
                cursor: "pointer",
                background: tokens.neutral[0], color: tokens.ink[0],
                fontWeight: 600,
                textTransform: "uppercase", touchAction: "manipulation",
              }}
            >CHANGE TABLE</button>
          )}
          {mode === "service" && onClearTable && (table.active || table.arrivedAt || table.resName || table.resTime) && (
            <button
              onClick={() => onClearTable(table.id)}
              style={{
                fontFamily: FONT, fontSize: "9px", letterSpacing: "0.10em",
                padding: isMobile ? "10px 10px" : "6px 10px",
                border: `1px solid ${tokens.red.border}`, borderRadius: 0,
                cursor: "pointer",
                background: tokens.red.text, color: tokens.neutral[0],
                textTransform: "uppercase", touchAction: "manipulation",
              }}
            >CLEAR TABLE</button>
          )}
        </div>
      </div>

      {showMoveTable && (
        <MoveTablePicker
          currentTable={table}
          tables={tables}
          reservationOnTable={reservationOnTable}
          onCancel={() => setShowMoveTable(false)}
          onPick={(toId, mode) => {
            const r = onMoveTable(table.id, toId, mode);
            if (r?.ok) setShowMoveTable(false);
          }}
        />
      )}

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
              {/* ── Drinks — one entry point. Two identical search bars
                  (aperitif / by-the-glass) used to double-enter the same
                  catalogue; now the phase chip decides where a pick lands. */}
              <div style={{
                background: tokens.neutral[50],
                borderTop: `1px solid ${tokens.ink[4]}`,
                borderBottom: `1px solid ${tokens.ink[4]}`,
                padding: isMobile ? "8px 0" : "10px 0",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <div style={{
                    fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em",
                    textTransform: "uppercase", color: tokens.ink[3], fontWeight: 400,
                  }}>[DRINKS]</div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {[["aperitif", "APERITIF"], ["menu", "WITH MENU"]].map(([ph, label]) => {
                      const on = drinkPhase === ph;
                      return (
                        <button key={ph} onClick={() => setDrinkPhase(ph)} style={{
                          fontFamily: FONT, fontSize: 8, letterSpacing: 1, padding: isMobile ? "8px 10px" : "4px 9px",
                          border: `1px solid ${on ? tokens.charcoal.default : tokens.neutral[200]}`, borderRadius: 0,
                          cursor: "pointer", background: on ? tokens.tint.parchment : tokens.neutral[0],
                          color: on ? tokens.ink[1] : tokens.text.secondary, fontWeight: on ? 600 : 400,
                          textTransform: "uppercase", touchAction: "manipulation",
                        }}>{label}</button>
                      );
                    })}
                  </div>
                </div>
                {/* Quick-add buttons — aperitif presets, always land as aperitif */}
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                  {aperitifOptions.map(ap => {
                    const found = resolveAperitifFromQuickAccessOption(ap, { wines, cocktails, spirits, beers });
                    return (
                      <button key={ap.label} onClick={() => {
                        const item = found || { name: ap.searchKey || ap.label, notes: "", __cocktail: true };
                        updSeat(seat.id, "aperitifs", [...(seat.aperitifs || []), item]);
                      }} style={{
                        fontFamily: FONT, fontSize: 9, letterSpacing: 0.5, padding: isMobile ? "10px 9px" : "4px 9px",
                        border: `1px solid ${tokens.neutral[300]}`, borderRadius: 0, cursor: "pointer",
                        background: tokens.neutral[0], color: tokens.neutral[700], transition: "all 0.1s",
                        touchAction: "manipulation",
                      }}>{ap.label}</button>
                    );
                  })}
                </div>
                <BeverageSearch
                  wines={wines} cocktails={cocktails} spirits={spirits} beers={beers}
                  onAdd={({ type, item }) => {
                    if (drinkPhase === "aperitif") {
                      updSeat(seat.id, "aperitifs", [...(seat.aperitifs || []), item]);
                      return;
                    }
                    if (type === "wine" || type === "bottle") updSeat(seat.id, "glasses", [...(seat.glasses || []), item]);
                    if (type === "cocktail") updSeat(seat.id, "cocktails", [...(seat.cocktails || []), item]);
                    if (type === "spirit")   updSeat(seat.id, "spirits",   [...(seat.spirits   || []), item]);
                    if (type === "beer")     updSeat(seat.id, "beers",     [...(seat.beers     || []), item]);
                  }}
                />
                {/* All drink chips — the badge tells aperitif from with-menu */}
                {(() => {
                  const allBevs = [
                    ...(seat.aperitifs || []).map((x, i) => ({ key: `ap${i}`, type: "aperitif", label: x?.name || x?.producer || "?", sub: (x?.producer && x?.name) ? x.producer : (x?.notes || ""), onRemove: () => updSeat(seat.id, "aperitifs", (seat.aperitifs||[]).filter((_,idx)=>idx!==i)) })),
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
                            <span style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 0.5, color: ts.color, opacity: 0.7, textTransform: "uppercase", flexShrink: 0 }}>{ts.label}</span>
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
                        <div style={{ ...fieldLabel, marginBottom: 4 }}>
                          {dish.name}
                        </div>
                        <button onClick={() => {
                          updSeat(seat.id, "extras", {
                            ...seat.extras, [dish.key]: { ...extra, ordered: !extra.ordered }
                          });
                        }} style={{
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
function DisplayBoardCard({ t, quickMode, upd, updSeat, onCardClick, onOpenDetail, onSeat, onUnseat, optionalExtras = [], optionalPairings = [], aperitifOptions, wines = [], cocktails = [], spirits = [], beers = [] }) {
    const isSeated = t.active;
    const allRestr = (t.restrictions || []).filter(r => r.note);
    const [assigningIdx, setAssigningIdx] = useState(null);
    const [justSent, setJustSent] = useState(false);
    const seats = t.seats || [];

    // Service → kitchen "Send" only carries what's new since the kitchen last
    // acknowledged. Diff the live order against the acknowledged baseline (or
    // against a still-pending alert, so a second Send doesn't repeat what's
    // already on the kitchen screen). hasKitchenUpdate drives the button.
    const kitchenCurrent = kitchenSnapshot(seats, optionalExtras, optionalPairings);
    const pendingSnap = (t.kitchenAlert && !t.kitchenAlert.confirmed) ? (t.kitchenAlert.snapshot || null) : null;
    const hasKitchenUpdate = kitchenDelta(kitchenCurrent, pendingSnap || t.kitchenSent || {}).length > 0;

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
              const hasContent = (s.water && s.water !== "—") || s.pairing || restr.length > 0 || extras.length > 0 || (s.aperitifs || []).length > 0;

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
                    {/* Seat label + gender + restrictions + reorder arrows */}
                    {(() => {
                      const seatIdx = seats.findIndex(x => x.id === s.id);
                      const doSwap = (targetIdx) => {
                        if (!upd || targetIdx < 0 || targetIdx >= seats.length) return;
                        const aId = seats[seatIdx].id;
                        const bId = seats[targetIdx].id;
                        upd(t.id, "seats", prev => {
                          const ns = [...prev];
                          const aData = { ...ns[seatIdx] };
                          const bData = { ...ns[targetIdx] };
                          ns[seatIdx] = { ...bData, id: aId };
                          ns[targetIdx] = { ...aData, id: bId };
                          return ns;
                        });
                        upd(t.id, "restrictions", prev => (prev || []).map(r =>
                          r.pos === aId ? { ...r, pos: bId } : r.pos === bId ? { ...r, pos: aId } : r
                        ));
                      };
                      const arrowBtn = (label, disabled, onClick) => (
                        <button onClick={onClick} disabled={disabled} style={{
                          fontFamily: FONT, fontSize: "9px", fontWeight: 700, padding: "1px 5px",
                          border: `1px solid ${disabled ? tokens.ink[5] : tokens.ink[4]}`,
                          borderRadius: 0, cursor: disabled ? "default" : "pointer", lineHeight: 1,
                          background: tokens.neutral[0],
                          color: disabled ? tokens.ink[5] : tokens.ink[3],
                          touchAction: "manipulation",
                        }}>{label}</button>
                      );
                      return (
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
                          {[
                            { g: "Mr", style: tokens.gender.male },
                            { g: "Mrs", style: tokens.gender.female },
                          ].map(({ g, style }) => (
                            <button key={g} onClick={() => updSeat && updSeat(t.id, s.id, "gender", s.gender === g ? null : g)} style={{
                              fontFamily: FONT, fontSize: "9px", fontWeight: 700, letterSpacing: "0.06em",
                              padding: "3px 9px",
                              border: `1px solid ${s.gender === g ? style.border : tokens.ink[4]}`,
                              borderRadius: 0, cursor: "pointer", lineHeight: 1,
                              background: s.gender === g ? style.bg : tokens.neutral[0],
                              color: s.gender === g ? style.text : tokens.ink[3],
                              touchAction: "manipulation",
                            }}>{g}</button>
                          ))}
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
                          <div style={{ marginLeft: "auto", display: "flex", gap: 2 }}>
                            {arrowBtn("▲", seatIdx === 0, () => doSwap(seatIdx - 1))}
                            {arrowBtn("▼", seatIdx === seats.length - 1, () => doSwap(seatIdx + 1))}
                          </div>
                        </div>
                      );
                    })()}

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
                        <div style={{ display: "flex", gap: 2, alignItems: "stretch" }}>
                          <button onClick={cyclePairing} style={{
                            fontFamily: FONT, fontSize: "10px", letterSpacing: "0.06em",
                            padding: "6px 10px", flex: 1,
                            border: `1px solid ${curPairing === "—" ? tokens.ink[4] : pcStyle.border}`,
                            borderRadius: 0, cursor: "pointer", lineHeight: 1, whiteSpace: "nowrap",
                            background: curPairing === "—" ? tokens.neutral[0] : pcStyle.bg,
                            color: curPairing === "—" ? tokens.ink[4] : pcStyle.color,
                            display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600,
                            touchAction: "manipulation",
                          }}>
                            <span>{curPairing}</span>
                            <span style={{ fontSize: "8px", opacity: 0.55, fontWeight: 400 }}>→</span>
                          </button>
                          {(() => {
                            const otherSeats = seats.filter(x => x.id !== s.id);
                            if (otherSeats.length === 0) return null;
                            const curShared = s.pairingSharedWith;
                            const cycleShare = () => {
                              if (!upd) return;
                              const curIdx = otherSeats.findIndex(x => x.id === curShared);
                              const nextIdx = (curIdx + 1) % (otherSeats.length + 1);
                              const nextTarget = nextIdx < otherSeats.length ? otherSeats[nextIdx].id : null;
                              upd(t.id, "seats", prev => prev.map(seat => {
                                if (seat.id === s.id) return { ...seat, pairingSharedWith: nextTarget };
                                if (seat.id === curShared && curShared !== null) return { ...seat, pairingSharedWith: null };
                                if (seat.id === nextTarget && nextTarget !== null) return { ...seat, pairingSharedWith: s.id, pairing: s.pairing };
                                return seat;
                              }));
                            };
                            const shareActive = curShared !== null;
                            return (
                              <button onClick={cycleShare} style={{
                                fontFamily: FONT, fontSize: "10px", fontWeight: 700, padding: "6px 8px",
                                border: `1px solid ${shareActive ? tokens.neutral[500] : tokens.ink[4]}`,
                                borderRadius: 0, cursor: "pointer", lineHeight: 1,
                                background: shareActive ? tokens.tint.parchment : tokens.neutral[0],
                                color: shareActive ? tokens.neutral[700] : tokens.ink[3],
                                touchAction: "manipulation", whiteSpace: "nowrap",
                              }}>
                                {shareActive ? `½P${curShared}` : "½"}
                              </button>
                            );
                          })()}
                        </div>
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

                        // Share-cycle helper: off → on → ½P{x} per other seat → off
                        const otherSeats = seats.filter(x => x.id !== s.id);
                        const curSharedWith = extra.sharedWith ?? null;
                        const extraStates = ["off", "on", ...otherSeats.map(x => x.id)];
                        const extraCurState = !dishOn ? "off" : (curSharedWith !== null ? curSharedWith : "on");
                        const extraCurIdx = extraStates.indexOf(extraCurState);
                        const extraNextState = extraStates[(extraCurIdx + 1) % extraStates.length];
                        const cycleExtraShare = () => {
                          if (!upd) return;
                          const ordered = extraNextState !== "off";
                          const newSharedWith = typeof extraNextState === "number" ? extraNextState : null;
                          // Only mutate the `extras.sharedWith` linkage here. Do NOT
                          // touch the partner seat's optionalPairings — a previous
                          // version cleared it, which silently wiped a pairing the
                          // partner had selected independently (the "beetroot pairing
                          // disappears when I touch share" bug). The generator already
                          // guards the shared case via the seat's own sharedWith flag.
                          upd(t.id, "seats", prev => prev.map(seat => {
                            if (seat.id === s.id) {
                              return { ...seat, extras: { ...seat.extras, [dish.key]: { ...extra, ordered, sharedWith: newSharedWith } } };
                            }
                            if (seat.id === curSharedWith && curSharedWith !== null && curSharedWith !== newSharedWith) {
                              const oldEx = seat.extras?.[dish.key] || {};
                              return { ...seat, extras: { ...seat.extras, [dish.key]: { ...oldEx, ordered: false, sharedWith: null } } };
                            }
                            if (seat.id === newSharedWith && newSharedWith !== null) {
                              const tEx = seat.extras?.[dish.key] || { ordered: false, pairing: extra.pairing };
                              return { ...seat, extras: { ...seat.extras, [dish.key]: { ...tEx, ordered: true, sharedWith: s.id } } };
                            }
                            return seat;
                          }));
                        };
                        const shareLabel = typeof extraCurState === "number" ? `½P${extraCurState}` : extraCurState === "on" ? "on" : "off";

                        if (linked) {
                          const raw = s.optionalPairings?.[linked.key];
                          const pairingOrdered = raw?.ordered !== undefined ? !!raw.ordered : false;
                          const pmode = raw?.mode || null;
                          const pairingStates = ["off", "on"];
                          if (linked.hasAlco) pairingStates.push("alco");
                          if (linked.hasNonAlco) pairingStates.push("nonalc");
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
                            <div key={dish.key || dish.id} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                              <button onClick={() => upd && upd(t.id, "seats", prev => (prev || []).map(seat => {
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
                                const nx = pairingStates[(pairingStates.indexOf(c) + 1) % pairingStates.length];
                                return {
                                  ...seat,
                                  extras: { ...seat.extras, [dish.key]: { ...xtra, ordered: nx !== "off", pairing: dish.pairings?.[0] || "—" } },
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
                              {dishOn && otherSeats.length > 0 && (
                                <button onClick={cycleExtraShare} style={{
                                  fontFamily: FONT, fontSize: 9, fontWeight: 700, padding: "7px 7px",
                                  border: `1px solid ${curSharedWith !== null ? tokens.neutral[500] : tokens.ink[4]}`,
                                  borderRadius: 0, cursor: "pointer", lineHeight: 1,
                                  background: curSharedWith !== null ? tokens.tint.parchment : tokens.neutral[0],
                                  color: curSharedWith !== null ? tokens.neutral[700] : tokens.ink[3],
                                  touchAction: "manipulation", whiteSpace: "nowrap",
                                }}>{curSharedWith !== null ? `½P${curSharedWith}` : "½"}</button>
                              )}
                            </div>
                          );
                        }

                        // Plain extra — cycles off → on → ½P{seat} per other seat → off
                        const plainStyle = {
                          off: { border: tokens.neutral[200], bg: tokens.neutral[0],     color: tokens.text.disabled },
                          on:  { border: tokens.neutral[500], bg: tokens.tint.parchment, color: tokens.neutral[700] },
                        }[typeof extraCurState === "number" || extraCurState === "on" ? (dishOn ? "on" : "off") : extraCurState] || { border: tokens.charcoal.default, bg: tokens.tint.parchment, color: tokens.ink[0] };
                        return (
                          <button key={dish.key || dish.id} onClick={cycleExtraShare} style={{
                            fontFamily: FONT, fontSize: 10, letterSpacing: 0.5, padding: "7px 12px",
                            border: `1px solid ${dishOn ? (curSharedWith !== null ? tokens.charcoal.default : tokens.neutral[500]) : tokens.neutral[200]}`,
                            borderRadius: 0, cursor: "pointer", lineHeight: 1,
                            background: dishOn ? tokens.tint.parchment : tokens.neutral[0],
                            color: dishOn ? tokens.ink[0] : tokens.text.disabled,
                            display: "inline-flex", alignItems: "center", gap: 6, textTransform: "uppercase",
                            touchAction: "manipulation",
                          }}>
                            <span style={{ fontWeight: dishOn ? 700 : 400 }}>{String(dish.name || dish.key || "").slice(0, 8)}</span>
                            <span style={{ fontSize: 9, opacity: 0.7, textTransform: "lowercase" }}>{shareLabel}</span>
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
                  {s.gender && (() => {
                    const gs = s.gender === "Mr" ? tokens.gender.male : tokens.gender.female;
                    return (
                      <span style={{
                        fontFamily: FONT, fontSize: "8px", fontWeight: 700, letterSpacing: "0.06em",
                        padding: "1px 5px", borderRadius: 0,
                        border: `1px solid ${gs.border}`, background: gs.bg, color: gs.text,
                      }}>{s.gender}</span>
                    );
                  })()}
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
                    }}>{s.pairing}{s.pairingSharedWith ? ` ½P${s.pairingSharedWith}` : ""}</span>
                  )}
                  {extras.map(d => {
                    const p = extraPairingForSeat(s, d, optionalPairings);
                    const exSharedWith = (s.extras?.[d.key] || s.extras?.[d.id])?.sharedWith ?? null;
                    return (
                      <span key={d.key} style={{
                        fontFamily: FONT, fontSize: "9px", padding: "2px 6px", borderRadius: 0,
                        border: `1px solid ${tokens.green.border}`, color: tokens.green.text, background: tokens.green.bg,
                      }}>
                        {d.name}{p ? ` · ${p}` : ""}{exSharedWith !== null ? ` ½P${exSharedWith}` : ""}
                      </span>
                    );
                  })}
                  {(s.aperitifs || []).map((ap, i) => {
                    const matchOpt = aperitifOptions?.find(opt => aperitifMatchesQuickAccessOption(ap, opt, { wines, cocktails, spirits, beers }));
                    const label = matchOpt?.label || ap.name;
                    return (
                      <span key={i} style={{
                        fontFamily: FONT, fontSize: "9px", padding: "2px 6px", borderRadius: 0,
                        border: `1px solid ${tokens.ink[4]}`, color: tokens.ink[2], background: tokens.tint.parchment,
                      }}>{label}</span>
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
        {seats.length > 0 && (isSeated || quickMode) && (
          <div style={{ padding: "6px 14px", borderTop: `1px solid ${tokens.neutral[100]}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {onOpenDetail && (
              <button onClick={() => onOpenDetail(t.id)} style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "4px 12px",
                border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, cursor: "pointer",
                background: tokens.neutral[0], color: tokens.ink[2], textTransform: "uppercase",
              }}>Details</button>
            )}
            {quickMode && upd && isSeated ? (() => {
              const idle = !justSent && !hasKitchenUpdate; // kitchen already has everything
              return (
              <button
                disabled={justSent || idle}
                title={idle ? "Kitchen is up to date — nothing new to send" : undefined}
                onClick={() => {
                  // Only the new/changed items since the kitchen's acknowledged
                  // baseline; snapshot rides along so the kitchen can advance the
                  // baseline when it confirms.
                  const deltaSeats = kitchenDelta(kitchenCurrent, t.kitchenSent || {});
                  if (deltaSeats.length === 0) return;
                  upd(t.id, "kitchenAlert", {
                    timestamp: new Date().toISOString(),
                    tableName: t.resName || null,
                    seats: deltaSeats,
                    confirmed: false,
                    snapshot: kitchenCurrent,
                  });
                  setJustSent(true);
                  setTimeout(() => setJustSent(false), 2000);
                }}
                style={{
                  fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 16px",
                  border: `1px solid ${justSent ? tokens.green.border : idle ? tokens.ink[4] : tokens.charcoal.default}`, borderRadius: 0,
                  cursor: (justSent || idle) ? "default" : "pointer",
                  background: justSent ? tokens.green.bg : idle ? tokens.neutral[0] : tokens.surface.card,
                  color: justSent ? tokens.green.text : idle ? tokens.ink[3] : tokens.text.primary,
                  fontWeight: 700, textTransform: "uppercase",
                  transition: "all 0.15s ease",
                }}>{justSent ? "✓ Sent" : idle ? "✓ Up to date" : "Send"}</button>
              );
            })() : null}
            </div>
            {quickMode && !isSeated && onSeat ? (
              <button onClick={() => onSeat(t.id)} style={{
                fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "5px 14px",
                border: `1px solid ${tokens.green.border}`, borderRadius: 0, cursor: "pointer",
                background: tokens.green.bg, color: tokens.green.text, fontWeight: 600, textTransform: "uppercase",
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

function DisplayBoard({ tables, optionalExtras = [], optionalPairings = [], upd, quickTableId = null, updSeat, onCardClick, onOpenDetail, onSeat, onUnseat, aperitifOptions = [], wines = [], cocktails = [], spirits = [], beers = [] }) {
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
  // Include all times that appear on visible tables, not just the predefined
  // SITTING_TIMES — otherwise lunch (or any non-standard) times show nothing.
  const extraTimes = [...new Set(
    visible.map(t => t.resTime).filter(t => t && !SITTING_TIMES.includes(t))
  )].sort();
  const allTimes = [...SITTING_TIMES, ...extraTimes];
  const rowsData = allTimes.map(time => ({
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
                  quickMode={quickTableId === t.id}
                  upd={upd}
                  updSeat={updSeat}
                  onCardClick={onCardClick}
                  onOpenDetail={onOpenDetail}
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

// ── Workspace (tenant) selection ────────────────────────────────────────────
// Which restaurant's data this device is currently working in. Persisted so a
// reload returns to the same workspace, and seeded into the module singleton
// synchronously at load so the first queries + namespaced caches are correct.
const WORKSPACE_KEY = "milka_workspace";
const readPersistedWorkspace = () => {
  try { return localStorage.getItem(WORKSPACE_KEY) || null; } catch { return null; }
};
if (supabase) setWorkspaceId(readPersistedWorkspace());

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const localSnapshot = readLocalBoardState();
  const initialState  = localSnapshot || defaultBoardState();

  const localBev = readLocalBeverages();
  const loadMenuCoursesRef = useRef(null);
  const appIsMobile = useIsMobile(BP.md);

  const [tables,    setTables]    = useState(initialState.tables);
  // Hydrate from the per-workspace device cache so the menu/board paint
  // instantly on launch; the background sync below refreshes them.
  const [menuCourses, setMenuCourses] = useState(() => readLocalMenuCourses() || []);
  const [wines,     setWines]     = useState(() => readLocalWines() || initialState.wines || []);
  const [cocktails, setCocktails] = useState(localBev?.cocktails ?? initialState.cocktails ?? initCocktails);
  const [spirits,   setSpirits]   = useState(localBev?.spirits   ?? initialState.spirits   ?? initSpirits);
  const [beers,     setBeers]     = useState(localBev?.beers      ?? initialState.beers     ?? initBeers);
  const [mode, setMode] = useState(() => {
    try {
      const storedMode = localStorage.getItem("milka_mode") || null;
      const storedDate = localStorage.getItem("milka_service_date");
      const chosenOn   = localStorage.getItem(SERVICE_DATE_CHOSEN_ON_KEY);
      // If the saved service date rolled over to yesterday, don't auto-resume
      // service/display — those modes require a date that matches today.
      // A deliberately-past date (demo / reviewing an earlier day) is exempt.
      if ((storedMode === "service" || storedMode === "display")
          && isStaleServiceDate(storedDate)
          && !isActivePastReview(storedDate, chosenOn)) {
        return null;
      }
      return storedMode;
    } catch { return null; }
  });
  // ── Auth + workspace (multi-tenant) ─────────────────────────────────────────
  // When Supabase is configured the app requires a login, then a workspace
  // (restaurant) selection. Each workspace is a fully isolated data set.
  const [session, setSession]               = useState(null);
  const [sessionChecked, setSessionChecked] = useState(!supabase);
  const [workspaceId, setWorkspaceIdState]  = useState(() => (supabase ? readPersistedWorkspace() : null));
  const [myWorkspaces, setMyWorkspaces]     = useState([]);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  // False until the post-login workspace query actually resolves. Gates the
  // ProfilePicker so its "no restaurant linked" empty state can't flash while
  // the list is still loading.
  const [workspacesResolved, setWorkspacesResolved] = useState(false);

  const applyWorkspace = useCallback((id) => {
    setWorkspaceId(id);        // module singleton — used by scopedFrom() everywhere
    setWorkspaceIdState(id);   // React state — drives data-load effects + realtime
    try {
      if (id) localStorage.setItem(WORKSPACE_KEY, id);
      else localStorage.removeItem(WORKSPACE_KEY);
    } catch {}
  }, []);

  // Switching restaurants clears the saved pick and reloads — the cleanest way
  // to re-bootstrap every data loader and realtime channel for the next
  // workspace with zero risk of stale in-memory data bleeding across profiles.
  // After the reload the picker reappears (or auto-selects for single-restaurant
  // logins) and a fresh selection loads cleanly.
  const openProfilePicker = useCallback(() => {
    try { localStorage.removeItem(WORKSPACE_KEY); } catch {}
    window.location.reload();
  }, []);

  const signOut = useCallback(async () => {
    // scope:'local' signs out ONLY this device. The floor shares one account
    // (restaurant@hotelmilka.si) across every tablet/laptop, and the default
    // global sign-out revokes the session on ALL of them at once.
    try { await supabase?.auth.signOut({ scope: "local" }); } catch {}
    try { localStorage.removeItem(WORKSPACE_KEY); } catch {}
    setWorkspaceId(null);
    window.location.reload();
  }, []);

  // Bootstrap the Supabase auth session and keep it in sync.
  useEffect(() => {
    if (!supabase) { setSessionChecked(true); return; }
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data?.session || null);
      setSessionChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      if (active) setSession(s || null);
    });
    return () => { active = false; sub?.subscription?.unsubscribe?.(); };
  }, []);

  // Once signed in, resolve which workspaces this user can reach (RLS returns
  // just their restaurant, or all restaurants for the master/super-admin) and
  // settle on the active one (restore the saved pick, or auto-pick when there's
  // only one, else fall through to the picker).
  useEffect(() => {
    if (!supabase || !session) {
      setMyWorkspaces([]); setIsPlatformAdmin(false); setWorkspacesResolved(false);
      return;
    }
    let active = true;
    setWorkspacesResolved(false);
    (async () => {
      try {
        const uid = session.user?.id;
        const [{ data: adminRow }, { data: wsRows }] = await withRetry(() => Promise.all([
          supabase.from("platform_admins").select("user_id").eq("user_id", uid).maybeSingle(),
          supabase.from("workspaces").select("id, name, kind, slug")
            .order("kind", { ascending: true }).order("name", { ascending: true }),
        ]));
        if (!active) return;
        const list = wsRows || [];
        setIsPlatformAdmin(!!adminRow);
        setMyWorkspaces(list);
        const persisted = readPersistedWorkspace();
        if (persisted && list.some(w => w.id === persisted)) applyWorkspace(persisted);
        else if (list.length === 1) applyWorkspace(list[0].id);
        else applyWorkspace(null);
      } catch (e) {
        if (active) console.warn("Workspace resolution failed:", e);
      } finally {
        // Always lift the gate so we never hang on the splash — on failure the
        // picker shows (empty), which the user can retry from.
        if (active) setWorkspacesResolved(true);
      }
    })();
    return () => { active = false; };
    // Keyed on the USER id, not the whole session object: Supabase hands us a
    // fresh session object on every token refresh (~hourly, on focus, on
    // reconnect), and re-resolving workspaces each time bounced a multi-
    // workspace (master) account back to the restaurant picker. The workspace
    // choice must survive token refreshes — only re-resolve on an actual login
    // / user change.
  }, [session?.user?.id, applyWorkspace]); // eslint-disable-line react-hooks/exhaustive-deps

  const [sel,          setSel]          = useState(null);
  // Which table (if any) is currently expanded into Quick Access on the board.
  // Clicking a reservation name toggles this; the rest of the board stays compact.
  const [quickTableId, setQuickTableId] = useState(null);
  // Service board presentation: "board" (card grid) or "sheet" (single-table
  // operational sheet with table index + intelligence rails). Persisted so a
  // device keeps its preferred working view across reloads.
  const [serviceView, setServiceView] = useState(() => {
    try { return localStorage.getItem("milka_service_view") === "sheet" ? "sheet" : "board"; } catch { return "board"; }
  });
  const changeServiceView = v => {
    setServiceView(v);
    try { localStorage.setItem("milka_service_view", v); } catch {}
  };
  // Table currently focused in the sheet view (independent of quickTableId).
  const [sheetTableId, setSheetTableId] = useState(null);
  // 60s heartbeat keeps clock-derived readout values (arrival radar) live
  // even when nothing else triggers a render. Service mode only.
  const [, bumpReadoutClock] = useState(0);
  useEffect(() => {
    if (mode !== "service") return;
    const id = setInterval(() => bumpReadoutClock(t => t + 1), 60 * 1000);
    return () => clearInterval(id);
  }, [mode]);
  const [summaryOpen,    setSummaryOpen]    = useState(false);
  const [archiveOpen,    setArchiveOpen]    = useState(false);
  const [inventoryOpen,  setInventoryOpen]  = useState(false);
  const [addResOpen,     setAddResOpen]     = useState(false);
  const [syncStatus,   setSyncStatus]   = useState(hasSupabaseConfig ? "connecting" : "local-only");
  const [logoDataUri,  setLogoDataUri]  = useState(() => readLocalLogo() || "");
  const [wineSyncConfig, setWineSyncConfig] = useState(() => {
    try { return normalizeSyncConfig(JSON.parse(localStorage.getItem(SYNC_CONFIG_KEY) || "null")); } catch { return DEFAULT_SYNC_CONFIG; }
  });
  const syncConfigRef = useRef(wineSyncConfig);
  syncConfigRef.current = wineSyncConfig;
  // ── Unified Menu Layout Profiles (v2) ────────────────────────────────────
  // Single source of truth for all menu layouts. Each profile wraps the
  // existing row-based menuTemplate + layoutStyles with a name and target
  // ("guest_menu" or "kitchen_flow"). Long Menu, Short Menu, Long Kitchen,
  // and Short Kitchen each pick which profile they use via assignments.
  // Persisted in service_settings under id="menu_layout_profiles_v2"; the
  // older menu_layout_profiles_v1 payload and the legacy single-layout pair
  // (menu_layout_global + menu_layout_v2) are migrated on first read.
  const [profilesState, setProfilesState] = useState(() => {
    // Prefer the per-workspace key; fall back to the legacy un-namespaced key
    // so existing single-restaurant installs keep their instant-paint cache.
    const readKey = (base) => {
      try {
        const wsVal = localStorage.getItem(workspaceKey(base));
        return wsVal != null ? wsVal : localStorage.getItem(base);
      } catch { return null; }
    };
    try {
      const v2 = JSON.parse(readKey(MENU_LAYOUT_PROFILES_V2_KEY) || "null");
      if (v2 && Array.isArray(v2.profiles) && v2.profiles.length > 0) {
        return sanitizeProfilesPayload(v2);
      }
    } catch {}
    try {
      const v1Raw = JSON.parse(readKey(MENU_LAYOUT_PROFILES_V1_KEY) || "null");
      if (Array.isArray(v1Raw) && v1Raw.length > 0) {
        const activeId = (() => { try { return readKey(MENU_ACTIVE_LAYOUT_PROFILE_KEY) || ""; } catch { return ""; } })();
        return sanitizeProfilesPayload(migrateV1ToV2({ profiles: v1Raw, activeId }));
      }
    } catch {}
    return { profiles: [], assignments: {}, activeProfileId: null };
  });
  const profilesStateRef = useRef(profilesState);
  profilesStateRef.current = profilesState;
  const profilesLoaded = useRef(false);
  // "loading" until the remote profile read resolves. Only "ready" (a read that
  // definitively succeeded — including the genuinely-empty case) permits the
  // default-seeding effect to run and PERSIST. "error" keeps seeding OFF so a
  // transient read failure can never overwrite the saved layout with defaults.
  const [profilesReadStatus, setProfilesReadStatus] = useState("loading");

  // Active profile + its derived menuTemplate / layoutStyles. The Admin
  // template editor edits the active profile in place; persistence flushes
  // whatever's currently in profilesState back to Supabase.
  const activeProfile = useMemo(
    () => profilesState.profiles.find(p => p.id === profilesState.activeProfileId) || profilesState.profiles[0] || null,
    [profilesState.profiles, profilesState.activeProfileId]
  );
  const menuTemplate       = activeProfile?.menuTemplate       || null;
  const shortMenuTemplate  = activeProfile?.shortMenuTemplate  || null;
  const ticketTemplate     = activeProfile?.ticketTemplate     || null;
  const shortTicketTemplate = activeProfile?.shortTicketTemplate || null;
  const globalLayout       = activeProfile?.layoutStyles       || {};

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
  // Restrictions — admin-editable list, mirrors hardcoded defaults on first
  // boot. Live values are mirrored into the dietary.js cache so existing
  // importers see the same list without prop drilling.
  const [restrictionsList, setRestrictionsList] = useState(() => readLocalRestrictions() || DEFAULT_RESTRICTIONS.map(r => ({ ...r })));
  const [courseQuickNotes, setCourseQuickNotes] = useState(() => readLocalCourseNotes() || {});
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
  // Reservations & service date — hydrate the planner instantly from cache.
  const [reservations, setReservations] = useState(() => readLocalReservations() || []);
  // Gates the board↔reservations reconciliation effect: it must not run (and
  // especially must not clear ghost tables) until both reservations and the
  // remote service-table state have actually loaded.
  const [reservationsLoaded, setReservationsLoaded] = useState(!supabase);
  // True only after the remote service_tables state has been fetched and merged
  // at least once. `hydrated` alone is NOT enough: it goes true from a (possibly
  // stale) localStorage cache or the 1s gate timeout, and reconciling/saving
  // against that stale board once wiped a live service started on another
  // device — every table looked "not started" locally, so reconcile rebuilt
  // them from reservations alone and the autosave pushed the wipe to Supabase.
  const [remoteBoardLoaded, setRemoteBoardLoaded] = useState(!supabase);
  const [boardSyncTick, setBoardSyncTick] = useState(0);
  const [serviceDate,  setServiceDate]  = useState(() => {
    try {
      const stored = localStorage.getItem("milka_service_date");
      if (!stored) return null;
      const chosenOn = localStorage.getItem(SERVICE_DATE_CHOSEN_ON_KEY);
      if (isStaleServiceDate(stored) && !isActivePastReview(stored, chosenOn)) {
        // Date rolled over since last session — drop the stale value so
        // "Start Service" prompts for today's date instead of silently
        // resuming yesterday's (now empty) service. An abandoned past-date
        // review (chosen on an earlier day) is dropped here too.
        try {
          localStorage.removeItem("milka_service_date");
          localStorage.removeItem(SERVICE_DATE_CHOSEN_ON_KEY);
        } catch {}
        return null;
      }
      return stored;
    } catch { return null; }
  });
  // Service day at the moment the date was chosen — distinguishes a service
  // that rolled over (auto-end) from one deliberately started on a past day.
  const [serviceDateChosenOn, setServiceDateChosenOn] = useState(() => {
    try { return localStorage.getItem(SERVICE_DATE_CHOSEN_ON_KEY) || null; } catch { return null; }
  });
  const [showServiceDatePicker,  setShowServiceDatePicker]  = useState(false);
  const [pendingModeAfterDate,   setPendingModeAfterDate]   = useState(null);
  const [activeServiceSession, setActiveServiceSession] = useState(() => {
    try { return localStorage.getItem("milka_service_session") || "dinner"; } catch { return "dinner"; }
  });
  // Hydration: render immediately from localStorage, sync Supabase in background
  const [hydrated,     setHydrated]     = useState(() => {
    if (!hasSupabaseConfig) return true;
    try { return !!localStorage.getItem(STORAGE_KEY); } catch { return false; }
  });

  const saveTimerRef       = useRef(null);
  const prevTablesJsonRef  = useRef((initialState.tables || initTables).map(t => JSON.stringify(sanitizeTable(t))));
  const tablesRef          = useRef(tables);
  /** Per-table last-local-mutation clock (this device's Date.now() at the last
   *  edit). Gates remote adoption: a remote payload OLDER than our most recent
   *  local edit to the same table is a stale (usually self-) echo and must not be
   *  adopted, or the 3-way merge snaps a freshly-typed field back to the older
   *  value before the newest echo restores it — the input "flicker". Genuinely
   *  concurrent edits from other devices carry newer timestamps, so they still
   *  reach the merge. Reset by the explicit clears. */
  const tableLocalFreshRef = useRef(new Map());
  /** Highest remote updated_at (ms) we've adopted per table — lets us ignore
   *  strictly-older out-of-order remote events so a merge can't regress a field. */
  const lastRemoteTsRef = useRef(new Map());
  /** Table ids the user/system explicitly emptied this tick (clear / archive). The
   *  save guard (planBoardWrites) only allows a MASS blank to persist for these;
   *  an unexplained mass blank is refused so a wipe can't reach Supabase. */
  const intentionalEmptyRef = useRef(new Set());
  const markIntentionalEmpty = useCallback((ids) => {
    (Array.isArray(ids) ? ids : [ids]).forEach(id => { if (id != null) intentionalEmptyRef.current.add(Number(id)); });
  }, []);
  const markAllIntentionalEmpty = useCallback(() => {
    for (let i = 1; i <= 10; i++) intentionalEmptyRef.current.add(i);
  }, []);

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
      await offlineQueue.enqueue(scopeJob(job));
      setSyncStatus("local-only");
      return { ok: true, queued: true };
    }

    try {
      const { error } = await scopedFrom(TABLES.SERVICE_TABLES).upsert(payloadRows, { onConflict: "table_id" });
      if (error) throw error;
      return { ok: true, queued: false };
    } catch (error) {
      await offlineQueue.enqueue(scopeJob(job));
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
      await offlineQueue.enqueue(scopeJob(job));
      setSyncStatus("local-only");
      return { ok: true, queued: true };
    }

    try {
      await run();
      return { ok: true, queued: false };
    } catch (error) {
      await offlineQueue.enqueue(scopeJob(job));
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
  // Celebration-category dish keys, synced with the reservation birthday flag
  // (shared by saveRes and reconcileBoardWithReservations).
  const celebrationKeys = useMemo(() => (activeMenuCourses || [])
    .filter(c => normalizeCourseCategory(c?.course_category, c?.optional_flag) === "celebration")
    .map(c => normalizeOptionalKey(c?.optional_flag))
    .filter(Boolean), [activeMenuCourses]);

  // Apply a full set of remote rows by 3-way MERGING each into local state
  // (ancestor = prevTablesJsonRef, the last synced baseline), so a poll/refresh
  // never clobbers this device's unsaved edits — it folds remote changes in
  // around them. Adopts each remote row as the new ancestor; any still-unsaved
  // local change survives in the merged row and stays a diff the autosave pushes.
  const mergeRemoteTables = rows => {
    const arr = Array.isArray(rows) ? rows : [];
    const rawById = new Map(arr.map(row => [Number(row.table_id), row]));
    const cur = tablesRef.current && tablesRef.current.length ? tablesRef.current : initTables;
    const nextPrev = [...prevTablesJsonRef.current];
    let changed = false;
    const nextTables = initTables.map((base, idx) => {
      const mine = cur.find(t => t.id === base.id) || base;
      const row = rawById.get(base.id);
      if (!row) return mine; // no remote row for this table — keep local
      const remoteTs = parseRemoteUpdatedAt(row.updated_at);
      const lastAdopted = lastRemoteTsRef.current.get(base.id) || 0;
      if (remoteTs > 0 && lastAdopted > 0 && remoteTs < lastAdopted) return mine; // out-of-order, ignore
      const localTs = tableLocalFreshRef.current.get(base.id) || 0;
      if (remoteTs > 0 && localTs > 0 && remoteTs < localTs) return mine; // stale vs our last local edit → keep mine (no flicker)
      const theirs = sanitizeTable({ id: base.id, ...(row.data || {}) });
      const ancestorJson = prevTablesJsonRef.current[idx];
      let ancestor; try { ancestor = ancestorJson ? JSON.parse(ancestorJson) : mine; } catch { ancestor = mine; }
      const merged = mergeTable(ancestor, mine, theirs);
      nextPrev[idx] = JSON.stringify(theirs); // adopt remote as the new ancestor
      if (remoteTs > 0) lastRemoteTsRef.current.set(base.id, Math.max(remoteTs, lastAdopted));
      if (JSON.stringify(sanitizeTable(mine)) !== JSON.stringify(merged)) changed = true;
      return merged;
    });
    prevTablesJsonRef.current = nextPrev;
    if (changed) setTables(() => nextTables); // skip the re-render when nothing moved
  };

  const applyRemoteTableRow = row => {
    const tableId = Number(row?.table_id);
    if (!tableId) return;
    const remoteTs = parseRemoteUpdatedAt(row.updated_at);
    const lastAdopted = lastRemoteTsRef.current.get(tableId) || 0;
    if (remoteTs > 0 && lastAdopted > 0 && remoteTs < lastAdopted) return; // out-of-order, ignore
    // Ignore a remote row that predates this device's most recent local edit to
    // the table: it's a stale self-echo (an earlier in-flight save round-tripping
    // back). Adopting it lets the merge take `theirs` for a field the user just
    // typed — because the baseline was eagerly advanced on the keystroke — so the
    // value flickers back before the freshest echo restores it. The freshest echo
    // (newer than our last edit) still lands and re-syncs the ancestor.
    const localTs = tableLocalFreshRef.current.get(tableId) || 0;
    if (remoteTs > 0 && localTs > 0 && remoteTs < localTs) return;
    const idx = (tablesRef.current || initTables).findIndex(t => t.id === tableId);
    if (idx === -1) return;
    const mine = tablesRef.current[idx];
    const theirs = sanitizeTable({ id: tableId, ...(row.data || {}) });
    const ancestorJson = prevTablesJsonRef.current[idx];
    let ancestor; try { ancestor = ancestorJson ? JSON.parse(ancestorJson) : mine; } catch { ancestor = mine; }
    const merged = mergeTable(ancestor, mine, theirs);
    // Adopt remote as this row's new ancestor (side effects out of the updater).
    const nextPrev = [...prevTablesJsonRef.current];
    nextPrev[idx] = JSON.stringify(theirs);
    prevTablesJsonRef.current = nextPrev;
    if (remoteTs > 0) lastRemoteTsRef.current.set(tableId, Math.max(remoteTs, lastAdopted));
    setTables(prev => prev.map(t => t.id === tableId ? merged : t));
  };

  const selTable   = tables.find(t => t.id === sel);

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

  // Returns the active reservation (if any) whose primary or grouped table matches `tableId`
  // for the currently active service date + session. Used by table-change UI to surface
  // who currently owns a destination table.
  const reservationOnTable = (tableId) => {
    if (!serviceDate || !tableId) return null;
    return reservations.find(r => {
      if (r.date !== serviceDate) return false;
      const sess = r.data?.service_session;
      const resolved = (sess === "lunch" || sess === "dinner")
        ? sess
        : ((r.data?.resTime || "") && r.data.resTime < "15:00" ? "lunch" : "dinner");
      if (resolved !== activeServiceSession) return false;
      if (Number(r.table_id) === Number(tableId)) return true;
      const grp = Array.isArray(r.data?.tableGroup) ? r.data.tableGroup.map(Number) : [];
      return grp.includes(Number(tableId));
    }) || null;
  };

  // Move the live service state (active, arrivedAt, seats, kitchenLog, etc.)
  // from one table id to another, leaving the source blank. Used when moving a
  // reservation mid-service so kitchen progress and seat orders follow the guests.
  // Reservation data fields (resName, resTime, guests, …) are also carried over,
  // but the `id` always stays as the destination's id. Returns { ok, reason }.
  const moveTableState = (fromId, toId) => {
    if (!fromId || !toId) return { ok: false, reason: "missing-id" };
    if (Number(fromId) === Number(toId)) return { ok: true };
    const src = tablesRef.current?.find(t => t.id === Number(fromId));
    const dst = tablesRef.current?.find(t => t.id === Number(toId));
    if (!src || !dst) return { ok: false, reason: "not-found" };
    const dstStarted = dst.active || dst.arrivedAt
      || (dst.kitchenLog && Object.keys(dst.kitchenLog).length > 0)
      || dst.kitchenArchived;
    const dstHasReservation = !!(dst.resName || dst.resTime);
    if (dstStarted || dstHasReservation) return { ok: false, reason: "destination-occupied" };
    bumpLocalTableFresh(fromId);
    bumpLocalTableFresh(toId);
    setTables(prev => prev.map(t => {
      if (t.id === Number(fromId)) return blankTable(t.id);
      if (t.id === Number(toId))   return { ...src, id: t.id };
      return t;
    }));
    return { ok: true };
  };

  // Atomically swap the live state between two tables. Same intent as
  // moveTableState but for the case where both sides have content — instead of
  // refusing, exchange them so the operator can flip two reservations in one go.
  const swapTableState = (aId, bId) => {
    if (!aId || !bId) return { ok: false, reason: "missing-id" };
    if (Number(aId) === Number(bId)) return { ok: true };
    const a = tablesRef.current?.find(t => t.id === Number(aId));
    const b = tablesRef.current?.find(t => t.id === Number(bId));
    if (!a || !b) return { ok: false, reason: "not-found" };
    bumpLocalTableFresh(aId);
    bumpLocalTableFresh(bId);
    setTables(prev => prev.map(t => {
      if (t.id === Number(aId)) return { ...b, id: t.id };
      if (t.id === Number(bId)) return { ...a, id: t.id };
      return t;
    }));
    return { ok: true };
  };

  // Swap two reservations' primary table_ids. Also swaps live table state when
  // they overlap with active service so kitchen progress and seat orders follow
  // the guests. Called from ResvForm's "SWAP" button — keeps the data model
  // consistent (reservations + tables) in a single operation.
  const swapReservations = async (r1Id, r2Id) => {
    const r1 = reservations.find(r => r.id === r1Id);
    const r2 = reservations.find(r => r.id === r2Id);
    if (!r1 || !r2) return { ok: false, reason: "not-found" };
    const t1 = Number(r1.table_id);
    const t2 = Number(r2.table_id);
    if (!t1 || !t2 || t1 === t2) return { ok: false, reason: "same-table" };
    if (r1.date === serviceDate && (mode === "service" || mode === "display")) {
      swapTableState(t1, t2);
    }
    // Update r1's local state synchronously so the second upsert sees the new
    // table_id and skips the auto-move (avoids a redundant moveTableState call
    // that would fail-noop now that the swap above already happened).
    setReservations(prev => prev.map(r =>
      r.id === r1Id ? { ...r, table_id: t2 }
        : r.id === r2Id ? { ...r, table_id: t1 }
        : r
    ));
    if (supabase) {
      // Persist both rows; ignore the auto-move guards inside upsertReservation
      // by going straight to the DB.
      await Promise.all([
        scopedFrom(TABLES.RESERVATIONS).update({ table_id: t2 }).eq("id", r1Id),
        scopedFrom(TABLES.RESERVATIONS).update({ table_id: t1 }).eq("id", r2Id),
      ]);
    }
    return { ok: true };
  };

  const syncWines = async () => {
    // Client-side budget. Vercel function caps at 60 s (see sync-wines.js);
    // give it 30 s of slack for headers + DB writes + return trip then hard-abort
    // so the UI doesn't hang. Previously 70 s, which was too close to the 60 s
    // server cap and would fire before the server's own response could land.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 90_000);
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
      // Refresh both catalogs the sync writes to. Wines have always been
      // reloaded here; beverages (cocktails/spirits/beers) previously relied
      // solely on a realtime event landing, so a successful sync could leave
      // the cocktail list stale. Reload them explicitly too.
      await Promise.all([loadWines(), loadBeverages()]);
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
      if (e?.name === "AbortError") return { ok: false, error: "Timed out after 90 s" };
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
    // Go through scopedFrom so the row is workspace-stamped and the upsert targets
    // the composite PK (workspace_id, position). Hitting supabase.from() directly
    // with onConflict:"position" trips Postgres 42P10 — there is no unique
    // constraint on position alone.
    let { error } = await scopedFrom(TABLES.MENU_COURSES).upsert(rows);
    // Pre-migration fallback: if the is_active column hasn't been added yet,
    // retry without it so the rest of the save still goes through. The toggle
    // won't persist until the schema migration is applied, but new courses,
    // edits, and reorders won't be lost.
    let isActiveSkipped = false;
    if (error && (error.code === "PGRST204" || /is_active/i.test(String(error.message || "")))) {
      const fallbackRows = rows.map(({ is_active, ...rest }) => rest);
      const retry = await scopedFrom(TABLES.MENU_COURSES).upsert(fallbackRows);
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
      await scopedFrom(TABLES.MENU_COURSES).delete().not("position", "in", `(${positions.join(",")})`);
    }
    return { ok: true, isActiveSkipped };
  };

  const saveWines = async (updatedWines) => {
    // Copy-on-edit: a human correction to a synced wine flips it to
    // source:'manual' (same key), which the nightly website sync never deletes
    // and never re-inserts over (the sync skips keys that already exist).
    // Without this, any fix to a synced wine was silently undone at 02:00.
    const withSource = stampWineSources(updatedWines, wines);
    setWines(withSource);
    if (!supabase) return { ok: true };
    const BATCH = 200;
    const rows = withSource.map(w => {
      const key = typeof w.id === "string" ? w.id : `manual|legacy_${w.id}`;
      return {
        key,
        source: w.source,
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
      const { error } = await scopedFrom(TABLES.WINES).upsert(rows.slice(i, i + BATCH), { onConflict: "key" });
      if (error) {
        console.error("Wine save error:", error);
        return { ok: false, error: error.message };
      }
    }
    const savedKeys = new Set(rows.map(r => r.key));
    const originalKeys = wines.map(w => (typeof w.id === "string" ? w.id : null)).filter(Boolean);
    const deletedKeys = originalKeys.filter(k => !savedKeys.has(k));
    if (deletedKeys.length > 0) {
      const { error: delErr } = await scopedFrom(TABLES.WINES).delete().in("key", deletedKeys);
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
    const { error: delErr } = await scopedFrom(TABLES.BEVERAGES).delete().eq("source", "manual").in("category", ["cocktail", "spirit", "beer"]);
    if (delErr) {
      console.error("Beverage delete error:", delErr);
      return { ok: false, error: delErr.message };
    }
    if (rows.length > 0) {
      const { error: insErr } = await scopedFrom(TABLES.BEVERAGES).insert(rows);
      if (insErr) {
        console.error("Beverage insert error:", insErr);
        return { ok: false, error: insErr.message };
      }
    }
    return { ok: true };
  };

  const clearAll = () => {
    // CLEAR ALL discards without archiving. If a live service is on the board
    // this is destructive and unrecoverable, so warn explicitly and point at
    // Archive & Clear instead — an accidental tap here can wipe a whole shift.
    const liveTables = tablesRef.current?.filter(tableHasServiceContent) || [];
    const msg = liveTables.length > 0
      ? `Discard ${liveTables.length} live table${liveTables.length === 1 ? "" : "s"} WITHOUT archiving? `
        + `This permanently deletes tonight's seats, drinks and kitchen progress and cannot be undone. `
        + `Use "Archive & Clear" instead if you want to keep the record.`
      : "Clear ALL tables?";
    if (typeof window !== "undefined" && !window.confirm(msg)) return;
    markAllIntentionalEmpty(); // user-confirmed full clear — allowed past the wipe guard
    tableLocalFreshRef.current = new Map();
    setTables(Array.from({ length: 10 }, (_, i) => blankTable(i + 1)));
    setSel(null);
    setArchiveOpen(false);
  };

  // Guards a manual archive in flight so a double-tap (or a second device a few
  // seconds later) can't file the same service twice — the cause of the two
  // identical 23:53 entries in the 10.06 incident.
  const archivingRef = useRef(false);
  const archiveAndClearAll = async () => {
    if (archivingRef.current) return;
    if (typeof window !== "undefined" && !window.confirm("Archive today's service and clear all tables?")) return;
    archivingRef.current = true;
    try {
      const snap = boardStateRef.current; // stable reference, never stale
      // Stamp the archive with the service's actual date, not whatever today
      // happens to be — otherwise a service ended after midnight (or a stale
      // day) lands under the wrong date.
      const archiveDate = serviceDate || toLocalDateISO();
      const dateStr = new Date(archiveDate + "T00:00:00").toLocaleDateString("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric" });
      const archiveLabel = `${dateStr} – ${activeServiceSession.toUpperCase()}`;
      const activeTables = snap.tables.filter(t => t.active || t.arrivedAt || t.resName || t.resTime);
      if (supabase) {
        // Don't double-file: if this service date+label already has a live
        // archive (e.g. another device just archived, or a fast double-tap
        // beat the in-flight ref), skip the insert and just clear locally.
        const { data: existing } = await scopedFrom(TABLES.SERVICE_ARCHIVE)
          .select("id").eq("date", archiveDate).eq("label", archiveLabel).is("deleted_at", null).limit(1);
        if (!existing || existing.length === 0) {
          const { error } = await scopedFrom(TABLES.SERVICE_ARCHIVE).insert({
            date: archiveDate,
            label: archiveLabel,
            state: { ...snap, tables: activeTables, menuCourses, serviceSession: activeServiceSession },
          });
          if (error) {
            window.alert("Archive failed: " + error.message);
            return;
          }
        }
      }
      markAllIntentionalEmpty(); // archived first — the clear is intentional
      tableLocalFreshRef.current = new Map();
      setTables(Array.from({ length: 10 }, (_, i) => blankTable(i + 1)));
      setSel(null);
      setArchiveOpen(false);
      // Release the service date lock so the next service can set a new date
      persistServiceDate(null);
      // Return to mode selection after archiving
      changeMode(null);
    } finally {
      archivingRef.current = false;
    }
  };

  const endService = async () => {
    await archiveAndClearAll();
  };

  // Guards the rollover auto-end so the boot check and the interval tick can't
  // archive the same service twice. Reset when a fresh service starts.
  const autoEndingRef = useRef(false);

  // A service that has rolled past the service-day cutoff (see currentServiceDay)
  // is over. ARCHIVE whatever is still on the board first — preserving the
  // record of what each guest ate and drank — and only THEN clear it. This
  // replaces the old behaviour that silently blanked the tables, destroying the
  // night's drinks/seat input. If archiving fails we leave the service intact
  // rather than risk losing it.
  const autoEndStaleService = async (staleDate) => {
    if (!supabase || !staleDate || autoEndingRef.current) return;
    autoEndingRef.current = true;
    try {
      // Read the night's state from the source of truth: local board state may
      // not have hydrated yet on a fresh load (or be blank on this device).
      const { data: rows, error: readErr } = await scopedFrom(TABLES.SERVICE_TABLES).select("*");
      if (readErr) throw readErr;
      const activeTables = (rows || [])
        .map(r => sanitizeTable({ id: Number(r.table_id), ...(r.data || {}) }))
        .filter(t => t.active || t.arrivedAt || t.resName || t.resTime)
        .sort((a, b) => a.id - b.id);

      if (activeTables.length > 0) {
        const dateStr = new Date(staleDate + "T00:00:00").toLocaleDateString("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric" });
        const label = `${dateStr} – ${(activeServiceSession || "dinner").toUpperCase()}`;
        // Don't double-file if another device already archived this service.
        const { data: existing } = await scopedFrom(TABLES.SERVICE_ARCHIVE)
          .select("id").eq("date", staleDate).eq("label", label).is("deleted_at", null).limit(1);
        if (!existing || existing.length === 0) {
          let courses = menuCourses;
          if (!courses || courses.length === 0) { try { courses = await fetchMenuCourses(); } catch { courses = []; } }
          const { error: insErr } = await scopedFrom(TABLES.SERVICE_ARCHIVE).insert({
            date: staleDate,
            label,
            state: { tables: activeTables, cocktails, spirits, beers, menuCourses: courses || [], serviceSession: activeServiceSession || "dinner", autoEnded: true },
          });
          if (insErr) throw insErr;
        }
      }
    } catch (e) {
      // Archiving failed — do NOT clear, so the data is never lost. We retry on
      // the next load or interval tick.
      console.error("Auto-end archive failed; leaving service intact:", e);
      autoEndingRef.current = false;
      return;
    }

    // Archived (or nothing to archive) — safe to clear local + remote for the new day.
    markAllIntentionalEmpty(); // rollover auto-end archived first — clear is intentional
    tableLocalFreshRef.current = new Map();
    setTables(Array.from({ length: 10 }, (_, i) => blankTable(i + 1)));
    setSel(null);
    setServiceDate(null);
    setServiceDateChosenOn(null);
    try {
      localStorage.removeItem("milka_service_date");
      localStorage.removeItem(SERVICE_DATE_CHOSEN_ON_KEY);
    } catch {}
    await scopedFrom(TABLES.SERVICE_SETTINGS)
      .upsert({ id: "service_date", state: {}, updated_at: new Date().toISOString() }, { onConflict: "id" });
    const blankRows = Array.from({ length: 10 }, (_, i) => ({ table_id: i + 1, data: {} }));
    await scopedFrom(TABLES.SERVICE_TABLES).upsert(blankRows, { onConflict: "table_id" });
    changeMode(null);
  };

  // A board can carry live tables with NO persisted service_date — e.g. the
  // night ran after the date was left blank (the 19.06 incident: the service
  // never auto-archived because the rollover auto-end is keyed entirely on
  // serviceDate, so an orphaned board is invisible to it). Re-attach the
  // service day the board's own activity belongs to, with chosenOn === that day
  // so it counts as a service that ran on its own day — NOT a deliberate
  // past-date review, which is exempt from auto-end. Once the date is back the
  // existing rollover auto-end can file it: a still-current orphan is tracked
  // and ends at the cutoff; a past orphan is already stale and the caller ends
  // it on this same pass. Returns the day it attached, or null if there was
  // nothing live to heal (or the read failed — board left untouched).
  const healOrphanedService = async () => {
    if (!supabase || serviceDate) return null;
    let day = null;
    try {
      const { data: rows, error } = await scopedFrom(TABLES.SERVICE_TABLES)
        .select("table_id, data, updated_at");
      if (error) throw error;
      const active = (rows || []).filter(r => {
        const t = sanitizeTable({ id: Number(r.table_id), ...(r.data || {}) });
        return t.active || t.arrivedAt || t.resName || t.resTime;
      });
      if (active.length === 0) return null;
      const latestMs = active
        .map(r => new Date(r.updated_at).getTime())
        .filter(Number.isFinite)
        .reduce((a, b) => Math.max(a, b), -Infinity);
      day = serviceDayForActivity(latestMs);
      if (!day) return null;
      setServiceDate(day);
      setServiceDateChosenOn(day);
      try {
        localStorage.setItem("milka_service_date", day);
        localStorage.setItem(SERVICE_DATE_CHOSEN_ON_KEY, day);
      } catch {}
      await scopedFrom(TABLES.SERVICE_SETTINGS).upsert(
        { id: "service_date", state: { date: day, chosenOn: day }, updated_at: new Date().toISOString() },
        { onConflict: "id" }
      );
    } catch (e) {
      console.warn("Orphaned-service heal skipped; leaving board intact:", e);
      return null;
    }
    return day;
  };

  const swapSeats = (tid, aId, bId) => {
    bumpLocalTableFresh(tid);
    setTables(p => p.map(t => {
      if (t.id !== tid) return t;
      const sA = t.seats.find(s => s.id === aId);
      const sB = t.seats.find(s => s.id === bId);
      // Spreading an undefined seat would wipe the other seat's data.
      if (!sA || !sB) return t;
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
    [...new Set([...oldGroup, ...sortedGroup])].forEach(tid => bumpLocalTableFresh(tid));
    // Tables dropped from the group are intentionally emptied — exempt them from
    // the mass-blank guard so a regrouping that shrinks a party still persists.
    markIntentionalEmpty(oldGroup.filter(tid => !sortedGroup.includes(tid)));
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
    const previousDate = serviceDate;
    // A fresh service starting clears the auto-end guard so this new service can
    // itself be auto-ended once it later rolls past the cutoff.
    if (date) autoEndingRef.current = false;
    const chosenOn = date ? currentServiceDay() : null;
    setServiceDate(date);
    setServiceDateChosenOn(chosenOn);
    try {
      if (date) {
        localStorage.setItem("milka_service_date", date);
        localStorage.setItem(SERVICE_DATE_CHOSEN_ON_KEY, chosenOn);
      } else {
        localStorage.removeItem("milka_service_date");
        localStorage.removeItem(SERVICE_DATE_CHOSEN_ON_KEY);
      }
    } catch {}
    // Wipe the board ONLY when switching between two real, different service
    // days. A device JOINING the current service (previousDate null — fresh
    // login, a second device, a re-login) must NOT clear: that blanks the
    // shared live board and the autosave then propagates the wipe to every
    // device. This was the "opened the board on the laptop and it wiped the
    // tablet" bug. A joining device keeps whatever it loaded from Supabase; a
    // genuine day-switch that still holds live work is caught by the mass-blank
    // guard (so it can't be silently lost either).
    if (shouldClearBoardOnDateChange(previousDate, date)) {
      tableLocalFreshRef.current = new Map();
      setTables(Array.from({ length: 10 }, (_, i) => blankTable(i + 1)));
    }
    if (!supabase) return;
    await scopedFrom(TABLES.SERVICE_SETTINGS)
      .upsert({ id: "service_date", state: date ? { date, chosenOn } : {}, updated_at: new Date().toISOString() }, { onConflict: "id" });
  };

  const persistServiceSession = (session) => {
    setActiveServiceSession(session);
    try { localStorage.setItem("milka_service_session", session); } catch {}
  };

  // ── Reservations CRUD ─────────────────────────────────────────────────────
  // Push descriptive reservation fields (menu type, name, notes…) to tables
  // where service has ALREADY started. The reconcile effect deliberately skips
  // started tables to protect live seats/orders/kitchen progress — but that
  // also froze label-level fields, so e.g. switching a seated table to the
  // SHORT menu on the reservation sheet never reached the kitchen board (it
  // derives its course list from table.menuType) and the kitchen kept firing
  // the long menu. Seats, guest count, grouping and kitchen log stay untouched.
  const syncStartedTablesFromReservation = (dateStr, rData, tableIdNum) => {
    if (!dateStr || dateStr !== serviceDate) return;
    const d = rData || {};
    if (resolveReservationSession(d) !== activeServiceSession) return;
    const group = (d.tableGroup?.length > 1 ? d.tableGroup : [tableIdNum]).map(Number);
    group.forEach(tid => {
      const t = tablesRef.current?.find(x => x.id === tid);
      const started = t && (t.active || t.arrivedAt
        || (t.kitchenLog && Object.keys(t.kitchenLog).length > 0)
        || t.kitchenArchived);
      if (!started) return; // not-started tables are owned by the reconcile effect
      updMany(tid, reservationDescriptiveFields(d));
    });
  };

  const upsertReservation = async ({ id, date, table_id, data: rData, _skipAutoMove = false }) => {
    const dbRow = { date, table_id, data: rData };
    if (id) {
      // If an existing reservation's primary table_id changes and the previous
      // table has active service, carry the live state over to the new table so
      // kitchen progress / orders / arrived time follow the guests. The
      // reconcile effect would otherwise leave the source as an orphaned ghost
      // and let the destination overwrite its untouched (blank) row only.
      // `_skipAutoMove` is set by callers that already moved/swapped the table
      // state themselves (the Detail CHANGE TABLE / swap flow) — without it,
      // this guard re-runs moveTableState against a stale tablesRef snapshot.
      const prevResv = reservations.find(r => r.id === id);
      const prevTableId = prevResv ? Number(prevResv.table_id) : null;
      const nextTableId = Number(table_id);
      if (!_skipAutoMove && prevTableId && nextTableId && prevTableId !== nextTableId
          && date === serviceDate && (mode === "service" || mode === "display")) {
        const src = tablesRef.current?.find(t => t.id === prevTableId);
        const srcStarted = src && (src.active || src.arrivedAt
          || (src.kitchenLog && Object.keys(src.kitchenLog).length > 0)
          || src.kitchenArchived);
        if (srcStarted) moveTableState(prevTableId, nextTableId);
      }
      if (supabase) {
        const result = await enqueueMutation({
          job: {
            table: TABLES.RESERVATIONS,
            op: "update",
            payload: dbRow,
            match: { id },
          },
          run: async () => {
            const { error } = await scopedFrom(TABLES.RESERVATIONS).update(dbRow).eq("id", id);
            if (error) throw error;
          },
        });
        if (result.ok) {
          setReservations(prev => prev.map(r => r.id === id ? { ...r, ...dbRow } : r));
          syncStartedTablesFromReservation(date, rData, Number(table_id));
        }
        return { ok: result.ok, error: result.error };
      }
      setReservations(prev => prev.map(r => r.id === id ? { ...r, ...dbRow } : r));
      syncStartedTablesFromReservation(date, rData, Number(table_id));
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
          const { data, error } = await scopedFrom(TABLES.RESERVATIONS).insert(dbRow).select().single();
          if (error) throw error;
          inserted = data;
        },
      });
      if (result.ok && inserted) {
        setReservations(prev => [...prev, inserted]);
        syncStartedTablesFromReservation(date, rData, Number(table_id));
      }
      return { ok: result.ok, error: result.error, data: inserted };
    }
    const local = { ...dbRow, id: crypto.randomUUID(), created_at: new Date().toISOString() };
    setReservations(prev => [...prev, local]);
    syncStartedTablesFromReservation(date, rData, Number(table_id));
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
        const { error } = await scopedFrom(TABLES.RESERVATIONS).delete().eq("id", id);
        if (error) throw error;
      },
    });
    return { ok: result.ok };
  };

  // Reconcile the service board with the reservations for the active service
  // date. Unlike a one-way pre-populate, this also *updates* tables whose
  // reservation changed and *clears* tables whose reservation moved away or was
  // deleted — so editing/moving a reservation no longer leaves a ghost table.
  // Tables that service has already started on (seated / arrived / kitchen
  // activity) are never touched.
  // Pure, tested reconcile (utils/reconcile) — never touches a table with live
  // service content; only templates blank/reserved tables and ghost-clears
  // departed reservations.
  const reconcileBoardWithReservations = (rows) => {
    setTables(prev => reconcileTables(prev, rows, celebrationKeys));
  };

  // Update a field in a reservation's data AND sync to service_tables so
  // Display mode picks it up via the existing realtime subscription.
  const updTableFromReservation = (resvId, tableId, field, value) => {
    setReservations(prev => prev.map(r => {
      if (r.id !== resvId) return r;
      return { ...r, data: { ...(r.data || {}), [field]: value } };
    }));
    // Persist outside the state updater: updaters must stay pure (StrictMode
    // runs them twice, which double-fired this write before).
    const target = reservations.find(r => r.id === resvId);
    if (target && supabase && getWorkspaceId()) {
      const newData = { ...(target.data || {}), [field]: value };
      scopedFrom(TABLES.RESERVATIONS).update({ data: newData }).eq("id", resvId)
        .then(({ error }) => { if (error) console.warn("Reservation field sync failed:", error); });
    }
    // Only push to service_tables when that table already carries reservation data
    // (avoids polluting blank table rows before service starts).
    const serviceTable = tablesRef.current?.find(t => t.id === tableId);
    if (serviceTable?.resName || serviceTable?.active) {
      upd(tableId, field, value);
    }
  };

  const enterMode = (nextMode) => {
    setMode(nextMode);
    try {
      if (nextMode) localStorage.setItem("milka_mode", nextMode);
      else          localStorage.removeItem("milka_mode");
    } catch {}
  };

  // Guards against double-taps while the join check is in flight.
  const joiningServiceRef = useRef(false);

  // Enter Service by JOINING a live service if one is running on the server, or
  // prompting to START a new one only when there genuinely isn't. A second
  // device / a re-login should just drop into the live board — never be asked
  // to "start" (which used to clear the shared board). If the live date is
  // already known locally we skip the round-trip and join instantly.
  const enterServiceMode = useCallback(async () => {
    if (serviceDate) { enterMode("service"); return; }
    if (joiningServiceRef.current) return;
    if (supabase && getWorkspaceId()) {
      joiningServiceRef.current = true;
      setSyncStatus("connecting");
      try {
        const { data } = await scopedFrom(TABLES.SERVICE_SETTINGS)
          .select("state").eq("id", "service_date").maybeSingle();
        const entry = resolveServiceEntry(data?.state);
        if (entry.action === "join") {
          // setServiceDate directly (NOT persistServiceDate) so joining never
          // clears the board or rewrites the date — just adopt the live one.
          setServiceDate(entry.date);
          setServiceDateChosenOn(entry.chosenOn);
          try {
            localStorage.setItem("milka_service_date", entry.date);
            if (entry.chosenOn) localStorage.setItem(SERVICE_DATE_CHOSEN_ON_KEY, entry.chosenOn);
          } catch {}
          enterMode("service");
          joiningServiceRef.current = false;
          return;
        }
      } catch { /* fall through to the start prompt */ }
      joiningServiceRef.current = false;
    }
    // No live service to join → prompt to start a new one.
    setPendingModeAfterDate("service");
    setShowServiceDatePicker(true);
  }, [serviceDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeMode = nextMode => {
    // Service mode joins the live service (or prompts to start one); other
    // modes just switch.
    if (nextMode === "service" && !serviceDate) { enterServiceMode(); return; }
    enterMode(nextMode);
    // Entering a live mode triggers the reconciliation effect below (it watches
    // `mode`), so the board is filled from reservations without an extra fetch.
  };

  // ── Keep the service board in sync with reservations ──────────────────────
  // Runs whenever reservations / the service date / the mode change, so a
  // newly-added reservation appears immediately, an edited one updates in
  // place, and a moved/deleted one stops leaving a ghost table behind.
  useEffect(() => {
    // remoteBoardLoaded is non-negotiable: reconciling against a board that
    // hasn't seen the remote state treats every live table as "not started"
    // and rebuilds/blanks it — then the autosave broadcasts the wipe.
    if (!hydrated || !reservationsLoaded || !remoteBoardLoaded) return;
    if ((mode !== "service" && mode !== "display") || !serviceDate) return;
    reconcileBoardWithReservations(reservations.filter(r => {
      if (r.date !== serviceDate) return false;
      return resolveReservationSession(r.data) === activeServiceSession;
    }));
  }, [reservations, serviceDate, mode, hydrated, reservationsLoaded, remoteBoardLoaded, boardSyncTick, activeServiceSession]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchMode = () => { changeMode(null); setSel(null); };

  // Escape = back. The hook stacks handlers so the most recently enabled
  // one fires first: detail closes before mode exits.
  useModalEscape(() => changeMode(null), !!mode);
  useModalEscape(() => setSel(null), !!sel);
  useModalEscape(() => setAddResOpen(false), addResOpen);

  // ── Persist locally + sync changed tables to Supabase ─────────────────────
  useEffect(() => {
    if (!hydrated) return;

    writeLocalBoardState(boardStateRef.current);

    // Never push table rows before the remote board has loaded: the diff would
    // run against a stale cache and overwrite a live service with old data.
    // Edits made in that window are safe — they bump tableLocalFreshRef, so
    // mergeRemoteTables keeps them and they diff against the remote baseline
    // (prevTablesJsonRef is reset by the merge) on the post-load run.
    if (!supabase || !remoteBoardLoaded) return;

    const prevJson = prevTablesJsonRef.current;
    const nextJsonByIndex = tables.map(t => JSON.stringify(sanitizeTable(t)));

    // Guard: never persist a MASS destructive blank (2+ live tables emptied at
    // once) unless it was an explicit clear/archive. This is the structural
    // backstop against the whole-service wipe — even an unknown trigger can't
    // push the blank to Supabase, so it can't propagate to other devices.
    const plan = planBoardWrites({
      prevJson,
      nextTables: tables,
      nextJson: nextJsonByIndex,
      intentionalEmpty: intentionalEmptyRef.current,
    });
    intentionalEmptyRef.current = new Set(); // marks are good for one tick only
    prevTablesJsonRef.current = plan.baseline;

    if (plan.blocked.length > 0) {
      console.error(
        "[board-guard] Refused to wipe live tables", plan.blocked,
        "— restoring from last good state. An unexpected mass-blank was prevented from reaching the server.",
      );
      // Undo the bad blank locally too, so the screen never shows the wipe.
      setTables(cur => cur.map((t, idx) => {
        if (!plan.blocked.includes(t.id)) return t;
        try { return sanitizeTable(JSON.parse(prevJson[idx])); } catch { return t; }
      }));
    }

    const changedTables = plan.writes.map(table => ({
      table_id: table.id, data: sanitizeTable(table), updated_at: new Date().toISOString(),
    }));
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
  }, [tablesJson, hydrated, remoteBoardLoaded]);


  // ── Load logo (cached device copy paints instantly; Supabase refreshes) ─────
  // The real logo is hydrated synchronously from the per-workspace cache above,
  // so we no longer flash the bundled /logo.svg while the network read is in
  // flight. We only fall back to the bundled default when there is genuinely no
  // cached AND no saved logo. Runs per workspace (the logo is workspace-scoped).
  useEffect(() => {
    let cancelled = false;
    const loadDefault = () => {
      if (readLocalLogo()) return; // a cached logo is already showing — don't override
      fetch("/logo.svg").then(r => r.text())
        .then(svg => { if (!cancelled) setLogoDataUri(`data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`); })
        .catch(() => {});
    };
    if (!supabase) { loadDefault(); return () => { cancelled = true; }; }
    if (!workspaceId) return () => { cancelled = true; }; // wait for the workspace to resolve
    withRetry(async () => {
      const { data, error } = await scopedFrom(TABLES.SERVICE_SETTINGS)
        .select("state").eq("id", "menu_logo").maybeSingle();
      if (error) throw error;
      return data;
    })
      .then(data => {
        if (cancelled) return;
        const uri = data?.state?.dataUri;
        if (uri) { setLogoDataUri(uri); writeLocalLogo(uri); }
        else loadDefault();
      })
      .catch(() => loadDefault()); // keep the cached logo on failure
    return () => { cancelled = true; };
  }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveLogo = async (dataUri) => {
    setLogoDataUri(dataUri);
    writeLocalLogo(dataUri); // keep the device cache in step so it paints instantly next launch
    if (!supabase) return;
    await scopedFrom(TABLES.SERVICE_SETTINGS)
      .upsert({ id: "menu_logo", state: { dataUri }, updated_at: new Date().toISOString() }, { onConflict: "id" });
  };

  useEffect(() => {
    try { localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(wineSyncConfig)); } catch {}
  }, [wineSyncConfig]);

  useEffect(() => {
    if (!supabase) return;
    withRetry(async () => {
      const { data, error } = await scopedFrom(TABLES.SERVICE_SETTINGS)
        .select("state").eq("id", "wine_sync_config").maybeSingle();
      if (error) throw error;
      return data;
    })
      .then(data => { if (data?.state) setWineSyncConfig(normalizeSyncConfig(data.state)); })
      .catch(() => {}); // localStorage-hydrated config stays in place
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveWineSyncConfig = async () => {
    const next = normalizeSyncConfig(wineSyncConfig);
    setWineSyncConfig(next);
    if (!supabase) return;
    await scopedFrom(TABLES.SERVICE_SETTINGS)
      .upsert({ id: "wine_sync_config", state: next, updated_at: new Date().toISOString() }, { onConflict: "id" });
  };

  // ── Profile persistence (localStorage + Supabase v2) ─────────────────────
  useEffect(() => {
    try { localStorage.setItem(workspaceKey(MENU_LAYOUT_PROFILES_V2_KEY), JSON.stringify(profilesState)); } catch {}
    try {
      if (profilesState.activeProfileId) {
        localStorage.setItem(workspaceKey(MENU_ACTIVE_LAYOUT_PROFILE_KEY), profilesState.activeProfileId);
      }
    } catch {}
  }, [profilesState]);

  const persistProfilesPayload = useCallback(async (payload) => {
    if (!supabase) return;
    await scopedFrom(TABLES.SERVICE_SETTINGS)
      .upsert({ id: "menu_layout_profiles_v2", state: payload, updated_at: new Date().toISOString() }, { onConflict: "id" });
  }, []);

  // Single mutator: accepts (profilesState) → next profilesState.
  // The result is sanitized so assignments never point at deleted/missing
  // profiles; persistence runs fire-and-forget so callers can stay synchronous.
  const updateProfiles = useCallback((mutator) => {
    setProfilesState(prev => {
      const draft = typeof mutator === "function" ? mutator(prev) : mutator;
      const sanitized = sanitizeProfilesPayload(draft);
      persistProfilesPayload(sanitized);
      return sanitized;
    });
  }, [persistProfilesPayload]);

  // Active profile selector — drives which template the editor shows.
  const selectProfile = useCallback((profileId) => {
    if (!profileId) return;
    updateProfiles(prev => {
      const exists = prev.profiles.some(p => p.id === profileId);
      if (!exists) return prev;
      return { ...prev, activeProfileId: profileId };
    });
  }, [updateProfiles]);

  // Create a new profile for the given target. Optionally seed the template
  // by cloning the currently-active profile so the user has a starting point.
  const createProfile = useCallback(({ name, target = "guest_menu", cloneFromActive = false } = {}) => {
    const fallbackName = "New Menu Layout";
    let createdId = null;
    updateProfiles(prev => {
      const seed = cloneFromActive
        ? prev.profiles.find(p => p.id === prev.activeProfileId)
        : null;
      const created = seed
        ? { ...duplicateProfile(seed, name || fallbackName), target }
        : makeProfile({ name: name || fallbackName, target, menuTemplate: null, layoutStyles: {} });
      createdId = created.id;
      return {
        profiles: [...prev.profiles, created],
        assignments: prev.assignments,
        activeProfileId: created.id,
      };
    });
    return createdId;
  }, [updateProfiles]);

  const renameProfileById = useCallback((profileId, nextName) => {
    updateProfiles(prev => ({ ...prev, profiles: renameProfile(prev.profiles, profileId, nextName) }));
  }, [updateProfiles]);

  const duplicateProfileById = useCallback((profileId, nextName) => {
    let createdId = null;
    updateProfiles(prev => {
      const target = prev.profiles.find(p => p.id === profileId);
      if (!target) return prev;
      const copy = duplicateProfile(target, nextName);
      createdId = copy.id;
      return { ...prev, profiles: [...prev.profiles, copy], activeProfileId: copy.id };
    });
    return createdId;
  }, [updateProfiles]);

  const deleteProfileById = useCallback((profileId) => {
    updateProfiles(prev => {
      if (!canDeleteProfile(profileId, prev.profiles, prev.assignments)) return prev;
      const remaining = prev.profiles.filter(p => p.id !== profileId);
      const nextActive = prev.activeProfileId === profileId
        ? (remaining[0]?.id || null)
        : prev.activeProfileId;
      return { ...prev, profiles: remaining, activeProfileId: nextActive };
    });
  }, [updateProfiles]);

  const setProfileAssignment = useCallback((slot, profileId) => {
    updateProfiles(prev => ({
      ...prev,
      assignments: { ...prev.assignments, [slot]: profileId || null },
    }));
  }, [updateProfiles]);

  // Duplicate a profile AND immediately assign it to a slot in one atomic update.
  // Used by the "Duplicate from Long Menu" button so the short slot is wired up
  // without relying on the async return value of duplicateProfileById.
  const duplicateAndAssignProfile = useCallback((sourceProfileId, newName, slot) => {
    updateProfiles(prev => {
      const source = prev.profiles.find(p => p.id === sourceProfileId);
      if (!source) return prev;
      const copy = duplicateProfile(source, newName);
      return {
        ...prev,
        profiles: [...prev.profiles, copy],
        activeProfileId: copy.id,
        assignments: { ...prev.assignments, [slot]: copy.id },
      };
    });
  }, [updateProfiles]);

  // Per-field setter factory for the active profile. Goes through
  // `updateProfiles` so writes are sanitized AND auto-persisted to Supabase —
  // no manual save button needed, no chance of an editor edit getting stripped
  // by a later admin action's sanitize pass.
  //
  // `fallback` is what the editor sees if the field is missing — kept here
  // (not in the editor) so we don't drift between fields.
  const editProfileField = useCallback((field, fallback) => (next) => {
    updateProfiles(prev => {
      const activeId = prev.activeProfileId;
      if (!activeId) return prev;
      const value = typeof next === "function"
        ? next(prev.profiles.find(p => p.id === activeId)?.[field] ?? fallback)
        : next;
      const normalized = value == null ? (typeof fallback === "object" ? fallback : null) : value;
      return {
        ...prev,
        profiles: prev.profiles.map(p => p.id === activeId ? { ...p, [field]: normalized } : p),
      };
    });
  }, [updateProfiles]);

  const setMenuTemplate       = useMemo(() => editProfileField("menuTemplate",       null), [editProfileField]);
  const setShortMenuTemplate  = useMemo(() => editProfileField("shortMenuTemplate",  null), [editProfileField]);
  const setTicketTemplate     = useMemo(() => editProfileField("ticketTemplate",     null), [editProfileField]);
  const setShortTicketTemplate= useMemo(() => editProfileField("shortTicketTemplate",null), [editProfileField]);
  const setGlobalLayout       = useMemo(() => editProfileField("layoutStyles",       {}),   [editProfileField]);

  // Initial load from Supabase: prefer v2, fall back to v1, then to the
  // legacy single-layout pair. The bad flat menu_layouts_v1 payload is
  // never read here — the row-based menuTemplate is the only system.
  useEffect(() => {
    if (!supabase) { profilesLoaded.current = true; setProfilesReadStatus("ready"); return; }
    let cancelled = false;
    // Snapshot what the localStorage-hydrated state looked like at mount.
    // If the user starts editing before this remote read returns, the JSON
    // will diverge and we leave their edits alone instead of overwriting.
    const mountSnapshot = JSON.stringify(profilesStateRef.current);
    const adoptRemote = (next) => {
      const current = JSON.stringify(profilesStateRef.current);
      if (current !== mountSnapshot) return; // user has edited since mount; don't clobber
      setProfilesState(next);
    };
    (async () => {
      try {
        // Throw on Supabase errors so a transient/permission failure lands in
        // catch and is treated as "error" — NOT as "empty". maybeSingle()
        // returns {data:null,error:null} for a genuinely empty row, so the
        // empty path below only runs when the read truly succeeded. Retried with
        // backoff so a flaky network self-heals instead of needing a manual
        // refresh to pull the saved menu layouts.
        const v2Data = await withRetry(async () => {
          const { data, error } = await scopedFrom(TABLES.SERVICE_SETTINGS)
            .select("state").eq("id", "menu_layout_profiles_v2").maybeSingle();
          if (error) throw error;
          return data;
        });
        const v2 = v2Data?.state;
        if (v2 && Array.isArray(v2.profiles) && v2.profiles.length > 0) {
          if (cancelled) return;
          adoptRemote(sanitizeProfilesPayload(v2));
          profilesLoaded.current = true;
          setProfilesReadStatus("ready");
          return;
        }
        const { data: v1Data, error: v1Err } = await scopedFrom(TABLES.SERVICE_SETTINGS)
          .select("state").eq("id", "menu_layout_profiles_v1").maybeSingle();
        if (v1Err) throw v1Err;
        if (v1Data?.state?.profiles?.length) {
          if (cancelled) return;
          const migrated = sanitizeProfilesPayload(migrateV1ToV2(v1Data.state));
          adoptRemote(migrated);
          persistProfilesPayload(migrated);
          profilesLoaded.current = true;
          setProfilesReadStatus("ready");
          return;
        }
        const [legacyLayoutRes, legacyTemplateRes] = await Promise.all([
          scopedFrom(TABLES.SERVICE_SETTINGS).select("state").eq("id", "menu_layout_global").maybeSingle(),
          scopedFrom(TABLES.SERVICE_SETTINGS).select("state").eq("id", "menu_layout_v2").maybeSingle(),
        ]);
        if (legacyLayoutRes?.error) throw legacyLayoutRes.error;
        if (legacyTemplateRes?.error) throw legacyTemplateRes.error;
        const legacyLayout = (legacyLayoutRes?.data?.state && typeof legacyLayoutRes.data.state === "object") ? legacyLayoutRes.data.state : {};
        const legacyTemplate = (legacyTemplateRes?.data?.state?.version === 2 && Array.isArray(legacyTemplateRes.data.state.rows)) ? legacyTemplateRes.data.state : null;
        if (legacyTemplate || Object.keys(legacyLayout).length > 0) {
          if (cancelled) return;
          const migrated = sanitizeProfilesPayload(migrateLegacySingleLayout(legacyLayout, legacyTemplate));
          adoptRemote(migrated);
          persistProfilesPayload(migrated);
          profilesLoaded.current = true;
          setProfilesReadStatus("ready");
          return;
        }
        // Every read succeeded and returned nothing — genuinely first run.
        // Safe to seed defaults (handled by the effect below).
        if (cancelled) return;
        profilesLoaded.current = true;
        setProfilesReadStatus("ready");
      } catch (e) {
        // Remote read failed. Do NOT unlock seeding — seeding+persisting
        // defaults here is what previously clobbered a saved layout when the
        // read merely hiccupped. Keep any localStorage-hydrated profiles in
        // memory and leave persistence untouched until a later successful read.
        if (cancelled) return;
        setProfilesReadStatus("error");
        // eslint-disable-next-line no-console
        console.error("Profile load failed — skipping default seeding so the saved layout is not overwritten:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [persistProfilesPayload]); // eslint-disable-line react-hooks/exhaustive-deps

  // Seed defaults once menuCourses are loaded and no profiles exist yet.
  // Gated on a *successful* remote read ("ready"): never seeds on "loading" or
  // "error", so a flaky read can't overwrite the saved layout with defaults.
  // The profiles.length guard means a returning user (with profiles) never
  // re-seeds either.
  useEffect(() => {
    if (profilesReadStatus !== "ready") return;
    if (profilesState.profiles.length > 0) return;
    if (!Array.isArray(menuCourses) || menuCourses.length === 0) return;
    updateProfiles(() => createDefaultProfiles(menuCourses));
  }, [menuCourses, profilesState.profiles.length, updateProfiles, profilesReadStatus]);


  // ── Restrictions + per-course quick notes ────────────────────────────────
  // Both ride on the generic service_settings table (id-keyed key/value).
  // setRestrictionsCache mirrors the live list into the dietary.js module so
  // every existing importer (RESTRICTIONS / DIETARY_KEYS / restrLabel) sees
  // the current values without prop drilling.
  useEffect(() => {
    if (!supabase || !workspaceId) return;
    let cancelled = false;

    // Instant paint from cache + mirror restrictions into the dietary module so
    // every importer sees the cached values immediately.
    const cachedR = readLocalRestrictions();
    if (cachedR && cachedR.length) { setRestrictionsList(cachedR); setRestrictionsCache(cachedR); }
    const cachedN = readLocalCourseNotes();
    if (cachedN) setCourseQuickNotes(cachedN);

    (async () => {
      try {
        const [rState, nState] = await withRetry(async () => {
          const [{ data: rData, error: rErr }, { data: nData, error: nErr }] = await Promise.all([
            scopedFrom(TABLES.SERVICE_SETTINGS).select("state").eq("id", "restrictions").maybeSingle(),
            scopedFrom(TABLES.SERVICE_SETTINGS).select("state").eq("id", "course_quick_notes").maybeSingle(),
          ]);
          if (rErr) throw rErr;
          if (nErr) throw nErr;
          return [rData?.state, nData?.state];
        });
        if (cancelled) return;
        const stored = rState?.restrictions;
        if (Array.isArray(stored) && stored.length > 0) {
          setRestrictionsList(stored);
          setRestrictionsCache(stored);
          writeLocalRestrictions(stored);
        }
        if (nState && typeof nState === "object") {
          setCourseQuickNotes(nState);
          writeLocalCourseNotes(nState);
        }
      } catch (e) {
        // Keep the cached restrictions/notes already on screen.
        console.warn("Restrictions/notes load failed — keeping cached values:", e);
      }
    })();
    return () => { cancelled = true; };
  }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveRestrictions = useCallback(async (next) => {
    const list = Array.isArray(next) ? next : [];
    setRestrictionsList(list);
    setRestrictionsCache(list);
    writeLocalRestrictions(list);
    if (!supabase) return { ok: true };
    const { error } = await scopedFrom(TABLES.SERVICE_SETTINGS)
      .upsert({ id: "restrictions", state: { restrictions: list } });
    if (error) { console.error("Restrictions save failed:", error); return { ok: false, error }; }
    return { ok: true };
  }, []);

  // ── Kitchen ticket order: the expediter's drag order, shared + persistent ──
  const [kitchenTicketOrder, setKitchenTicketOrder] = useState(null);
  useEffect(() => {
    if (!supabase || !workspaceId) return;
    let cancelled = false;
    scopedFrom(TABLES.SERVICE_SETTINGS)
      .select("state").eq("id", "kitchen_ticket_order").maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const ids = data?.state?.ids;
        if (Array.isArray(ids)) setKitchenTicketOrder(ids.map(Number).filter(Number.isFinite));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveKitchenTicketOrder = useCallback(async (ids) => {
    const clean = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isFinite);
    setKitchenTicketOrder(clean);
    if (!supabase) return;
    await scopedFrom(TABLES.SERVICE_SETTINGS)
      .upsert({ id: "kitchen_ticket_order", state: { ids: clean }, updated_at: new Date().toISOString() }, { onConflict: "id" });
  }, []);

  const saveCourseQuickNotes = useCallback(async (next) => {
    const map = next && typeof next === "object" ? next : {};
    setCourseQuickNotes(map);
    writeLocalCourseNotes(map);
    if (!supabase) return { ok: true };
    const { error } = await scopedFrom(TABLES.SERVICE_SETTINGS)
      .upsert({ id: "course_quick_notes", state: map });
    if (error) { console.error("Quick notes save failed:", error); return { ok: false, error }; }
    return { ok: true };
  }, []);

  // (Template & layout edits auto-persist through updateProfiles — no manual
  // save button or save-state needed.)

  // ── Menu generation rules (layout behavior) ───────────────────────────────
  useEffect(() => {
    try { localStorage.setItem("milka_menu_rules", JSON.stringify(menuRules)); } catch {}
  }, [menuRules]);

  useEffect(() => {
    if (!supabase) return;
    withRetry(async () => {
      const { data, error } = await scopedFrom(TABLES.SERVICE_SETTINGS)
        .select("state").eq("id", "menu_gen_rules").maybeSingle();
      if (error) throw error;
      return data;
    })
      .then(data => {
        if (data?.state && typeof data.state === "object") {
          setMenuRules(normalizeMenuRules(data.state));
          try { localStorage.setItem("milka_menu_rules", JSON.stringify(data.state)); } catch {}
        }
      })
      .catch(() => {}); // localStorage-hydrated rules stay in place
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
      const { error } = await scopedFrom(TABLES.SERVICE_SETTINGS)
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
    withRetry(async () => {
      const { data, error } = await scopedFrom(TABLES.SERVICE_SETTINGS)
        .select("state").eq("id", "quick_access").maybeSingle();
      if (error) throw error;
      return data;
    })
      .then(data => { if (data?.state?.items?.length) setQuickAccessItems(data.state.items); })
      .catch(() => {}); // localStorage-hydrated quick access stays in place
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateQuickAccess = (items) => {
    setQuickAccessItems(items);
    if (supabase) {
      scopedFrom(TABLES.SERVICE_SETTINGS)
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

  // Realtime filter that scopes every channel to the active workspace, so a
  // restaurant only receives its own changes.
  const wsFilter = workspaceId ? `workspace_id=eq.${workspaceId}` : undefined;

  // ── Load service tables from Supabase + subscribe realtime ────────────────
  useEffect(() => {
    if (!supabase || !workspaceId) return;
    let isMounted = true;

    const gateTimeout = setTimeout(() => { if (isMounted) setHydrated(true); }, 1000);

    const loadRemoteTables = async () => {
      const { data, error } = await scopedFrom(TABLES.SERVICE_TABLES)
        .select("table_id, data, updated_at")
        .order("table_id", { ascending: true });

      if (!isMounted) return;
      clearTimeout(gateTimeout);

      if (error) {
        // Do NOT mark the remote board as loaded: without the source of truth,
        // reconcile/saves stay disabled. The 15s poll and the visibilitychange
        // refetch keep retrying and flip the gate on the first success.
        setSyncStatus("sync-error");
        setHydrated(true);
        return;
      }

      // mergeRemoteTables folds remote into local (3-way) and owns the ancestor
      // bookkeeping + the "did anything change" check, so we always call it and
      // let it no-op when nothing moved.
      if (Array.isArray(data) && data.length > 0) mergeRemoteTables(data);

      setSyncStatus("live");
      setHydrated(true);
      // Remote truth is in: unlock the reconciliation effect and table saves,
      // and signal the reconcile effect to run against the fresh data.
      setRemoteBoardLoaded(true);
      setBoardSyncTick(t => t + 1);
    };

    loadRemoteTables();

    // Polling safety net (realtime is the primary path). Tighter than before so
    // a dropped subscription self-corrects in seconds, not 15s.
    const pollInterval = setInterval(() => { if (isMounted) loadRemoteTables(); }, 8000);

    // Re-fetch the instant the device can sync again — on wake or when the
    // network returns — so a tablet that slept shows the live board immediately.
    const refetchOnWake = () => { if (!document.hidden && isMounted) loadRemoteTables(); };
    document.addEventListener("visibilitychange", refetchOnWake);
    window.addEventListener("online", refetchOnWake);

    return () => {
      isMounted = false;
      clearTimeout(gateTimeout);
      clearInterval(pollInterval);
      document.removeEventListener("visibilitychange", refetchOnWake);
      window.removeEventListener("online", refetchOnWake);
    };
  }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  useRealtimeTable({
    supabase,
    channelName: `milka-service-tables-${workspaceId}`,
    filter: wsFilter,
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
      // applyRemoteTableRow 3-way merges the change into local state and adopts
      // it as the new ancestor — no extra prevTablesJsonRef bookkeeping needed.
      applyRemoteTableRow(payload.new);
      setSyncStatus("live");
    },
    // Drive the header sync chip from the live connection: SUBSCRIBED → live,
    // anything else (dropped, retrying) → connecting, so staff can SEE whether
    // the board is syncing instead of guessing.
    onStatus: (status) => {
      if (status === "SUBSCRIBED") setSyncStatus(prev => prev === "sync-error" ? prev : "live");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        setSyncStatus(prev => prev === "local-only" ? prev : "connecting");
      }
    },
    enabled: Boolean(supabase && workspaceId),
  });

  // ── Beverages: load from Supabase + realtime ─────────────────────────────────
  // Reusable loader so the cocktail/spirit/beer lists can be refreshed on demand
  // (initial mount, realtime change, and immediately after a website sync — see
  // syncWines, which mirrors loadWines). Without the explicit post-sync refresh
  // the synced cocktails only appeared if/when a realtime event happened to land,
  // so a sync could report "N cocktails" yet leave the UI showing the old list.
  const loadBeverages = useCallback(async () => {
    if (!supabase || !getWorkspaceId()) return;
    try {
      const data = await withRetry(async () => {
        const { data, error } = await scopedFrom(TABLES.BEVERAGES)
          .select("id, category, name, notes, position, source")
          .order("position", { ascending: true });
        if (error) throw error;
        return data || [];
      });
      const c = pickBeveragesForCategory(data, "cocktail");
      const s = pickBeveragesForCategory(data, "spirit");
      const b = pickBeveragesForCategory(data, "beer");
      setCocktails(c);
      setSpirits(s);
      setBeers(b);
      writeLocalBeverages({ cocktails: c, spirits: s, beers: b });
    } catch (e) {
      // Keep the cached beverages already on screen rather than blanking them.
      console.warn("Beverages load failed — keeping cached list:", e);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!supabase || !workspaceId) return;
    // Instant paint from this workspace's cache, then refresh in the background.
    const cached = readLocalBeverages();
    if (cached) {
      if (Array.isArray(cached.cocktails)) setCocktails(cached.cocktails);
      if (Array.isArray(cached.spirits))   setSpirits(cached.spirits);
      if (Array.isArray(cached.beers))     setBeers(cached.beers);
    }
    loadBeverages();
  }, [loadBeverages, workspaceId]);

  useRealtimeTable({
    supabase,
    channelName: `milka-beverages-${workspaceId}`,
    filter: wsFilter,
    table: TABLES.BEVERAGES,
    onChange: () => { loadBeverages(); },
    enabled: Boolean(supabase && workspaceId),
  });

  // ── Wines: load from Supabase wines table + realtime ─────────────────────────
  const loadWines = useCallback(async () => {
    if (!supabase || !getWorkspaceId()) return;
    try {
      const data = await withRetry(async () => {
        const { data, error } = await scopedFrom(TABLES.WINES)
          .select("key, name, wine_name, producer, vintage, region, country, by_glass, source")
          .order("name", { ascending: true });
        if (error) throw error;
        return data || [];
      });
      const mapped = data.map(r => ({
        id: r.key, name: r.wine_name || r.name,
        producer: r.producer || "", vintage: r.vintage || "",
        region: r.region || "", country: r.country || "",
        byGlass: r.by_glass ?? false,
        source: r.source || "sync",
      }));
      setWines(mapped);
      writeLocalWines(mapped);
    } catch (e) {
      // Keep the cached wines already on screen rather than blanking them.
      console.warn("Wines load failed — keeping cached list:", e);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!supabase || !workspaceId) return;
    // Instant paint from this workspace's cache, then refresh in the background.
    const cachedWines = readLocalWines();
    if (cachedWines && cachedWines.length) setWines(cachedWines);
    loadWines();
    return undefined;
  }, [loadWines, workspaceId]);

  useRealtimeTable({
    supabase,
    channelName: `milka-wines-${workspaceId}`,
    filter: wsFilter,
    table: TABLES.WINES,
    onChange: () => { loadWines(); },
    enabled: Boolean(supabase && workspaceId),
  });

  // ── Service date + reservations: cache paints instantly; Supabase refreshes ──
  useEffect(() => {
    if (!supabase || !workspaceId) return;
    let mounted = true;

    // Instant paint of the planner from this workspace's cache.
    const cachedResv = readLocalReservations();
    if (cachedResv && cachedResv.length) setReservations(cachedResv);

    // Restore service date saved by a previous session — but if it has rolled
    // past the service-day cutoff, the service is over: auto-end it (archiving
    // the night's data before clearing) so "Start Service" prompts for a fresh
    // date and pre-populates today's reservations on blank tables. maybeSingle()
    // so the common "no service yet" row doesn't throw.
    scopedFrom(TABLES.SERVICE_SETTINGS).select("state").eq("id", "service_date").maybeSingle()
      .then(async ({ data }) => {
        if (!mounted) return;
        const persisted = data?.state?.date;
        const persistedChosenOn = data?.state?.chosenOn || null;
        if (!persisted) {
          // No service_date on record. If the board still holds a live service
          // (orphaned — see healOrphanedService), re-attach its day so it stops
          // being invisible to the auto-end; if that day has already rolled
          // over, end it now so the night is finally filed.
          const healed = await healOrphanedService();
          if (healed && isStaleServiceDate(healed)) await autoEndStaleService(healed);
          return;
        }
        if (isStaleServiceDate(persisted) && !isActivePastReview(persisted, persistedChosenOn)) {
          await autoEndStaleService(persisted);
          return;
        }
        setServiceDate(d => d || persisted); // local state wins if already set
        setServiceDateChosenOn(c => c || persistedChosenOn);
        try {
          localStorage.setItem("milka_service_date", persisted);
          if (persistedChosenOn) localStorage.setItem(SERVICE_DATE_CHOSEN_ON_KEY, persistedChosenOn);
        } catch {}
      })
      .catch(() => {}); // keep whatever local service date we already have

    // Load reservations for -7 days … +30 days so the planner is pre-populated.
    // Retried with backoff; on failure the cached planner stays on screen.
    const past   = new Date(); past.setDate(past.getDate() - 7);
    const future = new Date(); future.setDate(future.getDate() + 30);
    withRetry(async () => {
      const { data, error } = await scopedFrom(TABLES.RESERVATIONS).select("*")
        .gte("date", toLocalDateISO(past))
        .lte("date", toLocalDateISO(future))
        .order("date").order("created_at");
      if (error) throw error;
      return data || [];
    })
      .then(data => { if (mounted) setReservations(data); })
      .catch(e => { console.warn("Reservations load failed — keeping cached list:", e); })
      .finally(() => { if (mounted) setReservationsLoaded(true); });

    return () => { mounted = false; };
  }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the reservations cache in step with live state (initial load, realtime
  // pushes, and local edits) so the planner paints instantly next launch.
  useEffect(() => { writeLocalReservations(reservations); }, [reservations]);

  // While the app is left open (e.g. overnight), automatically end a service
  // once it rolls past the service-day cutoff. The auto-end archives first, so
  // this never loses the night's data — it just files it and clears the board.
  useEffect(() => {
    if (!supabase || !serviceDate) return;
    if (mode !== "service" && mode !== "display") return;
    // A date deliberately chosen in the past (demo / reviewing an earlier day)
    // is exempt only while it is STILL that service day — once the clock rolls
    // past chosenOn the review is abandoned and auto-end resumes, so an old
    // selection can't keep filing live service under a stale date.
    if (isActivePastReview(serviceDate, serviceDateChosenOn)) return;
    const tick = () => { if (isStaleServiceDate(serviceDate)) autoEndStaleService(serviceDate); };
    tick();
    const id = setInterval(tick, 60 * 1000);
    return () => clearInterval(id);
  }, [supabase, serviceDate, serviceDateChosenOn, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  useRealtimeTable({
    supabase,
    channelName: `milka-reservations-${workspaceId}`,
    filter: wsFilter,
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
    enabled: Boolean(supabase && workspaceId),
  });

  // ── Menu courses: cached device copy paints instantly; Supabase refreshes ───
  useEffect(() => {
    let mounted = true;

    // Instant paint from this workspace's cache (covers the case where the
    // workspace resolves asynchronously after mount, so the init-time hydration
    // read the wrong/empty namespace).
    const cached = readLocalMenuCourses();
    if (cached && cached.length) setMenuCourses(cached);

    const loadCourses = async () => {
      try {
        const courses = await withRetry(() => fetchMenuCourses());
        if (!mounted || !courses) return;
        setMenuCourses(courses);
        writeLocalMenuCourses(courses); // keep the device cache warm for next launch
      } catch (error) {
        // Keep the cached courses on screen rather than blanking the menu/board.
        console.warn("Menu courses fetch failed — keeping cached list:", error);
      }
    };

    loadMenuCoursesRef.current = loadCourses;
    loadCourses();

    return () => { mounted = false; };
  }, [workspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  useRealtimeTable({
    supabase,
    channelName: `milka-menu-courses-${workspaceId}`,
    filter: wsFilter,
    table: TABLES.MENU_COURSES,
    onChange: () => { loadMenuCoursesRef.current?.(); },
    enabled: Boolean(supabase && workspaceId),
  });

  // Settings realtime (kitchen ticket order) — other devices' changes land
  // instantly. The settings table carries many ids (inventory, configs…);
  // only react to the ones owned here.
  useRealtimeTable({
    supabase,
    channelName: `milka-settings-live-${workspaceId}`,
    filter: wsFilter,
    table: TABLES.SERVICE_SETTINGS,
    onChange: (payload) => {
      const id = payload.new?.id;
      if (id === "kitchen_ticket_order") {
        const ids = payload.new?.state?.ids;
        if (Array.isArray(ids)) setKitchenTicketOrder(ids.map(Number).filter(Number.isFinite));
      }
    },
    enabled: Boolean(supabase && workspaceId),
  });

  // ── Historical fire cadence (archive-seeded) ───────────────────────────────
  // Loaded once per session when a live mode starts: recent archives yield
  // per-menu-type course rhythms so estimateNextFire() has a "history" basis
  // before tonight's room has produced any gaps of its own.
  const [historyGapsByMenu, setHistoryGapsByMenu] = useState(null);
  useEffect(() => {
    if (!supabase || !workspaceId || historyGapsByMenu) return;
    if (mode !== "service" && mode !== "display" && mode !== "kitchen") return;
    let cancelled = false;
    scopedFrom(TABLES.SERVICE_ARCHIVE)
      .select("state").is("deleted_at", null)
      .order("created_at", { ascending: false }).limit(10)
      .then(({ data, error }) => {
        if (cancelled || error) return;
        setHistoryGapsByMenu(historyGapsByMenuType(data || []));
      });
    return () => { cancelled = true; };
  }, [mode, workspaceId, historyGapsByMenu]); // eslint-disable-line react-hooks/exhaustive-deps

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
    onSummary: () => setSummaryOpen(true),
    onArchive: () => setArchiveOpen(true),
    onInventory: () => setInventoryOpen(true),
    onSyncAll: syncWines,
  };

  // Loud warning when the active service date is in the past — the silent
  // version of this let a stray "view an old day" pick file a whole night of
  // service under 10.06. Tapping it opens the date picker to set today.
  const serviceDateIsPast = Boolean(serviceDate && isStaleServiceDate(serviceDate));
  const pastDateWarningEl = serviceDateIsPast ? (
    <div
      onClick={() => { setPendingModeAfterDate(mode); setShowServiceDatePicker(true); }}
      style={{
        fontFamily: FONT, cursor: "pointer", background: tokens.red.bg,
        borderBottom: `2px solid ${tokens.red.border}`, color: tokens.red.text,
        padding: appIsMobile ? "9px 12px" : "9px 24px", display: "flex",
        alignItems: "center", justifyContent: "center", gap: 8, textAlign: "center",
        fontSize: appIsMobile ? "10px" : "11px", letterSpacing: "0.06em", fontWeight: 600,
      }}
    >
      <span style={{ fontSize: "13px" }}>⚠</span>
      <span>
        SERVICE DATE IS IN THE PAST — {new Date(serviceDate + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).toUpperCase()}.
        {" "}NEW SERVICE WILL BE FILED UNDER THIS DATE. TAP TO SET TODAY.
      </span>
    </div>
  ) : null;

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

  // Gate 0: Supabase login + restaurant (workspace) selection.
  // When Supabase is configured, a real login replaces the legacy shared-password
  // gate. The GateScreen below is only used in local-only mode (no Supabase).
  if (supabase) {
    const splash = (
      <div style={{
        minHeight: "100vh", background: tokens.surface.card, display: "flex",
        flexDirection: "column", alignItems: "center", justifyContent: "center",
        fontFamily: FONT, gap: 16,
      }}>
        <GlobalStyle />
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: 6, color: tokens.text.primary }}>{APP_NAME}</div>
        <div style={{ fontSize: 9, letterSpacing: 4, color: tokens.text.disabled }}>…</div>
      </div>
    );
    if (!sessionChecked) return splash;
    if (!session) return <AuthScreen />;
    // Wait for the workspace query before deciding picker-vs-board, so the
    // "no restaurant linked" empty state never flashes mid-resolution.
    if (!workspaceId) return workspacesResolved ? (
      <ProfilePicker
        workspaces={myWorkspaces}
        isAdmin={isPlatformAdmin}
        onPick={applyWorkspace}
        onSignOut={signOut}
      />
    ) : splash;
  } else if (!authed) {
    // Local-only fallback (no Supabase): keep the legacy password gate.
    return <GateScreen onPass={() => setAuthed(true)} />;
  }

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
      defaultSession={activeServiceSession}
      reservations={reservations}
      onConfirm={async (date, session = "dinner") => {
        persistServiceSession(session);
        await persistServiceDate(date);
        setShowServiceDatePicker(false);
        const target = pendingModeAfterDate;
        setPendingModeAfterDate(null);
        if (target) {
          setMode(target);
          try { localStorage.setItem("milka_mode", target); } catch {}
          // The reconciliation effect (watches `mode` + `serviceDate` + `activeServiceSession`)
          // fills the board from reservations for the chosen date and session.
        }
      }}
      onCancel={() => { setShowServiceDatePicker(false); setPendingModeAfterDate(null); }}
    />
  ) : null;

  if (!mode) return <>{serviceDatePickerEl}<LoginScreen
      onEnter={m => { changeMode(m); setSel(null); }}
      onSyncAll={syncWines}
      workspaceName={myWorkspaces.find(w => w.id === workspaceId)?.name || ""}
      canSwitchProfile={Boolean(supabase) && (isPlatformAdmin || myWorkspaces.length > 1)}
      onSwitchProfile={openProfilePicker}
      onSignOut={supabase ? signOut : undefined}
    /></>;

  // Reservation Manager mode
  if (mode === "reservation") return (<>{serviceDatePickerEl}<Suspense fallback={lazyViewFallback}><ReservationManager
      reservations={reservations}
      menuCourses={activeMenuCourses}
      tables={tables}
      onUpsert={upsertReservation}
      onDelete={deleteReservation}
      onUpdReservation={updTableFromReservation}
      onSwapReservations={swapReservations}
      onExit={() => changeMode(null)}
      serviceDate={serviceDate}
      activeServiceSession={activeServiceSession}
      onSetServiceDate={persistServiceDate}
      onSetServiceSession={persistServiceSession}
      onOpenArchive={() => setArchiveOpen(true)}
      courseQuickNotes={courseQuickNotes}
      profiles={profilesState.profiles}
      assignments={profilesState.assignments}
    />
    {archiveOpen && (
      <ArchiveModal
        tables={tables} optionalExtras={dishes} optionalPairings={pairings}
        onArchiveAndClear={archiveAndClearAll}
        onClearAll={clearAll}
        onClose={() => setArchiveOpen(false)}
        onRestoreTicket={id => upd(id, "kitchenArchived", false)}
        menuCourses={menuCourses}
      />
    )}
    </Suspense></>);

  // Kitchen mode (legacy id "display") — KDS board for firing courses.
  // Mutation handlers `upd` / `updMany` are intentionally passed: kitchen
  // staff need to fire/unfire and edit notes here, so this is NOT read-only.
  if (mode === "display") return (<>
    {serviceDatePickerEl}
    <div style={{ minHeight: "100vh", background: tokens.ink.bg, fontFamily: FONT, overflowX: "hidden", WebkitTextSizeAdjust: "100%" }}>
      <GlobalStyle />
      <Header modeLabel="KITCHEN" showSummary={false} showMenu={false} showArchive={true} showInventory={false} {...hProps} />
      {pastDateWarningEl}
      {/* Slim desktop padding: on a 720px-tall kitchen panel every vertical px
          counts toward fitting two full rows of tickets. */}
      <div style={{ padding: appIsMobile ? "12px 10px" : "10px 16px" }}>
        <Suspense fallback={lazyViewFallback}>
          <KitchenBoard
            tables={tables}
            menuCourses={activeMenuCourses}
            upd={upd}
            updMany={updMany}
            profiles={profilesState.profiles}
            assignments={profilesState.assignments}
            historyGapsByMenu={historyGapsByMenu}
            persistedOrder={kitchenTicketOrder}
            onOrderChange={saveKitchenTicketOrder}
          />
        </Suspense>
      </div>
      {archiveOpen && (
        <Suspense fallback={null}>
          <ArchiveModal
            tables={tables} optionalExtras={dishes}
            onArchiveAndClear={archiveAndClearAll}
            onClearAll={clearAll}
            onClose={() => setArchiveOpen(false)}
            onRestoreTicket={id => upd(id, "kitchenArchived", false)}
            menuCourses={menuCourses}
          />
        </Suspense>
      )}
      {inventoryOpen && <Suspense fallback={null}><InventoryModal wines={wines} onClose={() => setInventoryOpen(false)} /></Suspense>}
    </div>
  </>);

  if (mode === "menu") return (
    <div style={{ minHeight: "100vh", background: tokens.ink.bg, fontFamily: FONT, overflowX: "hidden", WebkitTextSizeAdjust: "100%" }}>
      <GlobalStyle />
      <Suspense fallback={lazyViewFallback}><MenuPage
        tables={tables}
        menuCourses={activeMenuCourses}
        upd={upd}
        logoDataUri={logoDataUri}
        wines={wines}
        cocktails={cocktails}
        spirits={spirits}
        beers={beers}
        aperitifOptions={aperitifOptions}
        menuRules={menuRules}
        profiles={profilesState.profiles}
        assignments={profilesState.assignments}
        onExit={() => changeMode(null)}
      /></Suspense>
    </div>
  );

  // ── Admin mode — pure control panel, no service UI ──
  if (mode === "admin") return (
    <div style={{ minHeight: "100vh", background: tokens.neutral[0], fontFamily: FONT, overflowX: "hidden", WebkitTextSizeAdjust: "100%" }}>
      <GlobalStyle />
      <Suspense fallback={lazyViewFallback}><AdminLayout
        menuCourses={menuCourses}
        onUpdateMenuCourses={setMenuCourses}
        onSaveMenuCourses={saveMenuCourses}
        menuTemplate={menuTemplate}
        onUpdateTemplate={setMenuTemplate}
        ticketTemplate={ticketTemplate}
        onUpdateTicketTemplate={setTicketTemplate}
        shortTicketTemplate={shortTicketTemplate}
        onUpdateShortTicketTemplate={setShortTicketTemplate}
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
        layoutProfiles={profilesState.profiles}
        activeLayoutProfileId={profilesState.activeProfileId}
        onSelectLayoutProfile={selectProfile}
        onCreateLayoutProfile={createProfile}
        onDeleteLayoutProfile={deleteProfileById}
        onRenameLayoutProfile={renameProfileById}
        onDuplicateLayoutProfile={duplicateProfileById}
        onDuplicateAndAssignProfile={duplicateAndAssignProfile}
        layoutAssignments={profilesState.assignments}
        onSetProfileAssignment={setProfileAssignment}
        shortMenuTemplate={shortMenuTemplate}
        onUpdateShortMenuTemplate={setShortMenuTemplate}
        wineSyncConfig={wineSyncConfig}
        onUpdateWineSyncConfig={setWineSyncConfig}
        onSaveWineSyncConfig={saveWineSyncConfig}
        quickAccessItems={quickAccessItems}
        onUpdateQuickAccess={updateQuickAccess}
        aperitifOptions={aperitifOptions}
        restrictionsList={restrictionsList}
        onSaveRestrictions={saveRestrictions}
        courseQuickNotes={courseQuickNotes}
        onSaveCourseQuickNotes={saveCourseQuickNotes}
        onExit={() => changeMode(null)}
      /></Suspense>
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
        showAddRes={Boolean(serviceDate)}
        onAddRes={() => setAddResOpen(true)}
        showMenu={false}
        showArchive={true}
        showInventory={false}
        showSync={true}
        showEndService={true}
        onEndService={endService}
        {...hProps}
      />
      {pastDateWarningEl}

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
                  title="Click to change service date / session"
                  onClick={() => { setPendingModeAfterDate(mode); setShowServiceDatePicker(true); }}
                  style={{
                    fontFamily: FONT, fontSize: "9px", letterSpacing: "0.10em",
                    color: serviceDateIsPast ? tokens.red.text : tokens.ink[1],
                    cursor: "pointer", textTransform: "uppercase", fontWeight: serviceDateIsPast ? 700 : 500,
                  }}
                >
                  {serviceDateIsPast ? "⚠ " : ""}{new Date(serviceDate + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).toUpperCase()}
                </span>
              )}
              <span style={{
                fontFamily: FONT, fontSize: "8px", letterSpacing: "0.12em",
                textTransform: "uppercase", color: tokens.ink[2], fontWeight: 600,
                border: `1px solid ${tokens.ink[4]}`, padding: "2px 7px", borderRadius: 0,
              }}>{activeServiceSession.toUpperCase()}</span>
              {(() => {
                const seatedNow = tables.filter(t => t.active).filter(isPrimary).length;
                const guestsNow = tables.filter(t => t.active).filter(isPrimary).reduce((a, t) => a + (t.guests || 0), 0);
                const resvNow   = tables.filter(t => !t.active && (t.resName || t.resTime)).filter(isPrimary).length;
                // Arrival radar: reservations due within the next 45 min (and
                // up to 10 min late) that haven't been seated yet.
                const nowMin = (() => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); })();
                const arriving = tables
                  .filter(isPrimary)
                  .filter(t => !t.active && !t.arrivedAt && t.resTime)
                  .map(t => { const m = parseHHMM(t.resTime); return m == null ? null : m - nowMin; })
                  .filter(dm => dm != null && dm >= -10 && dm <= 45);
                const nextIn = arriving.length ? Math.max(0, Math.min(...arriving)) : null;
                return (
                  <div style={{ display: "flex", gap: appIsMobile ? 8 : 16, alignItems: "center", flexWrap: "wrap" }}>
                    {seatedNow > 0 && (
                      <span style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.10em", color: tokens.green.text, textTransform: "uppercase", fontWeight: 500 }}>
                        ● {seatedNow} ACTIVE · {guestsNow} PAX
                      </span>
                    )}
                    {arriving.length > 0 && (
                      <span style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.10em", color: tokens.signal.active, textTransform: "uppercase", fontWeight: 600 }}>
                        ◔ {arriving.length} ARRIVING{nextIn != null ? ` · ${nextIn === 0 ? "NOW" : `${nextIn} MIN`}` : ""}
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
            {/* [VIEW] toggle — BOARD (card grid) / SHEET (single-table sheet) */}
            <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
              {["board", "sheet"].map(v => {
                const on = serviceView === v;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => changeServiceView(v)}
                    style={{
                      fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em",
                      textTransform: "uppercase", fontWeight: on ? 600 : 400,
                      padding: appIsMobile ? "8px 12px" : "5px 12px",
                      border: `1px solid ${on ? tokens.charcoal.default : tokens.ink[4]}`,
                      marginLeft: -1,
                      background: on ? tokens.charcoal.default : tokens.neutral[0],
                      color: on ? tokens.neutral[0] : tokens.ink[2],
                      borderRadius: 0, cursor: "pointer", touchAction: "manipulation",
                    }}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </div>

          {serviceView === "sheet" ? (
            /* SHEET view — single-table operational sheet (table index +
               course state + guest matrix + intelligence rails). */
            <Suspense fallback={lazyViewFallback}>
              <SheetView
                tables={tables}
                menuCourses={activeMenuCourses}
                selectedId={sheetTableId}
                onSelect={setSheetTableId}
                onOpenDetail={id => setSel(id)}
                onSetNext={(tableId, course) => {
                  // "Table is set for the next course" — raise the kitchen
                  // alert (merging into a still-pending order delta so that
                  // isn't lost) and stamp courseReady on the table. The
                  // kitchen ticket shows the banner until it fires the course.
                  const t = tablesRef.current?.find(x => x.id === tableId);
                  const ready = { key: course.key, index: course.index, name: course.name, at: fmt(new Date()) };
                  const prevAlert = (t?.kitchenAlert && !t.kitchenAlert.confirmed) ? t.kitchenAlert : null;
                  updMany(tableId, {
                    courseReady: ready,
                    kitchenAlert: {
                      ...(prevAlert || {}),
                      timestamp: new Date().toISOString(),
                      tableName: t?.resName || null,
                      seats: prevAlert?.seats || [],
                      confirmed: false,
                      course: ready,
                    },
                  });
                }}
                onUnset={tableId => {
                  const t = tablesRef.current?.find(x => x.id === tableId);
                  const changes = { courseReady: null };
                  const alert = t?.kitchenAlert;
                  // Retract the course from a still-pending alert; keep the
                  // alert alive only if it still carries an order delta.
                  if (alert && !alert.confirmed && alert.course) {
                    const { course: _drop, ...rest } = alert;
                    changes.kitchenAlert = rest.seats?.length ? rest : null;
                  }
                  updMany(tableId, changes);
                }}
                onUndoFire={(tableId, courseKey) => {
                  const t = tablesRef.current?.find(x => x.id === tableId);
                  const newLog = { ...(t?.kitchenLog || {}) };
                  delete newLog[courseKey];
                  upd(tableId, "kitchenLog", newLog);
                }}
                onSeat={seatTable}
                onUnseat={unseatTable}
                profiles={profilesState.profiles}
                assignments={profilesState.assignments}
                historyGapsByMenu={historyGapsByMenu}
              />
            </Suspense>
          ) : (
            /* Combined Board + per-table Quick Access view */
            (() => {
              const visibleTables = tables
                .filter(t => t.active || t.resName || t.resTime)
                .filter(t => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup));

              return (
                <DisplayBoard
                  tables={visibleTables}
                  optionalExtras={dishes}
                  optionalPairings={pairings}
                  upd={upd}
                  quickTableId={quickTableId}
                  updSeat={updSeat}
                  onCardClick={id => setQuickTableId(prev => (prev === id ? null : id))}
                  onOpenDetail={id => setSel(id)}
                  onSeat={seatTable}
                  onUnseat={unseatTable}
                  aperitifOptions={serviceAperitifOptions}
                  wines={wines}
                  cocktails={cocktails}
                  spirits={spirits}
                  beers={beers}
                />
              );
            })()
          )}
        </div>
      ) : (
        <Detail
          table={selTable}
          tables={tables}
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
          onClearTable={tableId => clear(tableId)}
          onMoveTable={(fromId, toId, mode = "auto") => {
            const dst = tablesRef.current?.find(t => t.id === Number(toId));
            const dstStarted = dst && (dst.active || dst.arrivedAt
              || (dst.kitchenLog && Object.keys(dst.kitchenLog).length > 0)
              || dst.kitchenArchived);
            const dstHasReservation = !!(dst?.resName || dst?.resTime);
            const dstOccupied = !!(dstStarted || dstHasReservation);
            const useSwap = mode === "swap" || (mode === "auto" && dstOccupied);
            const result = useSwap ? swapTableState(fromId, toId) : moveTableState(fromId, toId);
            if (!result.ok) return result;
            setSel(toId);
            const srcResv = reservations.find(r =>
              r.date === serviceDate && Number(r.table_id) === Number(fromId));
            const dstResv = useSwap
              ? reservations.find(r =>
                  r.date === serviceDate && Number(r.table_id) === Number(toId))
              : null;
            // State already moved/swapped above — skip the internal auto-move
            // so it doesn't re-run against a stale tablesRef snapshot.
            if (srcResv) {
              upsertReservation({
                id: srcResv.id, date: srcResv.date,
                table_id: Number(toId), data: srcResv.data, _skipAutoMove: true,
              });
            }
            if (dstResv) {
              upsertReservation({
                id: dstResv.id, date: dstResv.date,
                table_id: Number(fromId), data: dstResv.data, _skipAutoMove: true,
              });
            }
            return { ...result, swapped: useSwap };
          }}
          reservationOnTable={reservationOnTable}
        />
      )}

      {summaryOpen && (
        <Suspense fallback={null}>
          <SummaryModal tables={tables} optionalExtras={dishes} optionalPairings={pairings} onClose={() => setSummaryOpen(false)} />
        </Suspense>
      )}
      {archiveOpen && (
        <Suspense fallback={null}>
          <ArchiveModal
            tables={tables} optionalExtras={dishes} optionalPairings={pairings}
            onArchiveAndClear={archiveAndClearAll}
            onClearAll={clearAll}
            onClose={() => setArchiveOpen(false)}
            onRestoreTicket={id => upd(id, "kitchenArchived", false)}
            menuCourses={menuCourses}
          />
        </Suspense>
      )}
      {inventoryOpen && <Suspense fallback={null}><InventoryModal wines={wines} onClose={() => setInventoryOpen(false)} /></Suspense>}

      {addResOpen && serviceDate && (
        <CenteredModal
          onClose={() => setAddResOpen(false)}
          label={`[NEW RESERVATION · ${new Date(serviceDate + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" }).toUpperCase()}]`}
        >
          <ResvForm
            initial={{ date: serviceDate, table_id: null, data: { service_session: activeServiceSession } }}
            tables={tables}
            reservations={reservations}
            excludeId={null}
            onSave={async (row) => { const r = await upsertReservation(row); if (r?.ok) setAddResOpen(false); }}
            onCancel={() => setAddResOpen(false)}
          />
        </CenteredModal>
      )}
    </div>
  </>);
}
