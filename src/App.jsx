import { useState, useRef, useEffect, useMemo, useCallback, lazy, Suspense } from "react";
import {
  RESTRICTION_KEYS, RESTRICTION_COLUMN_MAP, normalizeCourseCategory,
  normalizeOptionalKey, optionalPairingsFromCourses, celebrationKeysFromCourses,
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
  readLocalMenuCourses, writeLocalMenuCourses,
  readLocalWines, writeLocalWines,
  readLocalLogo, writeLocalLogo,
  readLocalReservations, writeLocalReservations,
  readLocalRestrictions, writeLocalRestrictions,
  readLocalCourseNotes, writeLocalCourseNotes,
  readLocalDemoBoard, writeLocalDemoBoard,
  workspaceKey,
} from "./utils/storage.js";
import {
  makeSeats, blankTable, sanitizeTable, initTables, fmt, parseHHMM,
  reservationDescriptiveFields, resolveReservationSession, tableHasServiceContent,
  reservationTableIds, mergeRestrictionPositions, startedTablePatchFromReservation,
  repointReservation, moveTableRows, swapTableRows, massBlankedIndices,
  swapSeatData, moveSeatOnFloor,
} from "./utils/tableHelpers.js";
import { pickBeveragesForCategory } from "./utils/beverages.js";
import { foldTable } from "./utils/foldTable.js";
import { randomUuid } from "./utils/uuid.js";
import { reconcileTables } from "./utils/reconcile.js";
import { isSameServiceLabel, nextArchiveLabel } from "./utils/archiveDedup.js";
import { archiveIdForService } from "./utils/archiveIdentity.js";
import { stampWineSources } from "./utils/wineEdit.js";
import { historyGapsByMenuType } from "./utils/archiveInsights.js";
import {
  currentServiceDay, isStaleServiceDate, isActivePastReview, shouldClearBoardOnDateChange,
  resolveServiceEntry, serviceDayForActivity, isLiveServiceActivity, SERVICE_DATE_CHOSEN_ON_KEY,
} from "./utils/serviceDay.js";
import {
  resolveAperitifFromQuickAccessOption,
  aperitifMatchesQuickAccessOption,
} from "./utils/quickAccessResolve.js";
import {
  FLOOR_MAPS_KEY, FLOOR_STATUS_KEY, sanitizeFloorMaps,
  getActiveDiningMap, getTerraceMap, mapSeatCountForBoardTable,
  terraceOccupancy, applyLayoutSwitchRow, resolveReservationTable,
  sanitizeFloorStatus, setFloorStatus, cycleFloorStatus, pruneFloorStatus,
  clearStripsForBoardGroup,
} from "./utils/floorMaps.js";
import {
  visitStateOf,
  assignTerrace as assignTerraceData, clearTerraceTable as clearTerraceData,
  moveToDining as moveToDiningData, markSeated as markSeatedData,
  closeVisit as closeVisitData,
} from "./utils/terraceFlow.js";
import { getVisibleCoursesForTable, getCourseProgressState, isStaleCourseReady } from "./utils/courseProgress.js";
import { useIsMobile, BP } from "./hooks/useIsMobile.js";
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
import { scopedFrom } from "./lib/scopedDb.js";
import { readStateKey, saveStateKey } from "./lib/stateStore.js";
import { finishServiceStore } from "./lib/serviceLifecycleStore.js";
import { isPowerSyncEnabled } from "./powersync/config.js";
import { setSqlitePrimaryFlag } from "./powersync/primary.js";
import { useRealtimeTable } from "./hooks/useRealtimeTable.js";
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
import QuickAperitifSearch from "./components/service/QuickAperitifSearch.jsx";
import TableCard from "./components/TableCard/TableCard.jsx";
import FloorView from "./components/floor/FloorView.jsx";
import FloorMap from "./components/floor/FloorMap.jsx";

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
const KitchenFloorView = lazy(() => import("./components/kitchen/KitchenFloorView.jsx"));

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
    is_last_bite: !!r.is_last_bite,
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
    is_last_bite: course.is_last_bite === true,
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
function Detail({ table, tables = [], optionalExtras = [], optionalPairings = [], wines = [], cocktails = [], spirits = [], beers = [], menuCourses = MENU_DATA, aperitifOptions = [], mode, onBack, upd, updSeat, setGuests, swapSeats, onApplySeatToAll, onClearBeverages, onClearTable, onMoveTable, reservationOnTable, mapSeatCap = null }) {
  const isMobile = useIsMobile(860);
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
  // Per-seat drink phase: the phase chip decides whether a search pick lands
  // as an aperitif or with the menu (glasses/cocktails/…). Kept per seat —
  // one shared value made toggling P2 silently flip P1's chips too.
  const [drinkPhaseBySeat, setDrinkPhaseBySeat] = useState({});

  // ── Detail design grammar — micro labels + chip buttons shared below ──
  const microLabel = {
    fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em",
    textTransform: "uppercase", color: tokens.ink[3], fontWeight: 400,
  };
  const chipBtn = (on) => ({
    fontFamily: FONT, fontSize: 9, letterSpacing: "0.06em",
    padding: isMobile ? "9px 10px" : "5px 10px",
    border: `1px solid ${on ? tokens.charcoal.default : tokens.ink[4]}`,
    borderRadius: 0, cursor: "pointer",
    background: on ? tokens.tint.parchment : tokens.neutral[0],
    color: on ? tokens.ink[0] : tokens.ink[3],
    fontWeight: on ? 600 : 400,
    transition: "all 0.1s", touchAction: "manipulation",
  });
  // Segmented 3-state (OFF / ALCO / N/A). Green is reserved for "ordered" —
  // an active OFF renders muted, not green, so it can't be misread as a
  // confirmed order (the old view showed OFF in the same green as YES).
  const segBtn = (on, kind = "off") => ({
    fontFamily: FONT, fontSize: 8, letterSpacing: "0.06em", flex: 1,
    padding: isMobile ? "9px 6px" : "4px 6px",
    border: `1px solid ${on
      ? (kind === "alco" ? tokens.charcoal.default : kind === "nonalc" ? tokens.ink[3] : tokens.ink[4])
      : tokens.ink[5]}`,
    borderRadius: 0, cursor: "pointer",
    background: on
      ? (kind === "alco" ? tokens.tint.parchment : kind === "nonalc" ? tokens.neutral[100] : tokens.neutral[50])
      : tokens.neutral[0],
    color: on
      ? (kind === "alco" ? tokens.ink[0] : kind === "nonalc" ? tokens.ink[1] : tokens.ink[2])
      : tokens.ink[4],
    fontWeight: on ? 600 : 400,
    transition: "all 0.1s", touchAction: "manipulation",
  });
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
              <button key={opt} onClick={() => table.seats.forEach(s => updSeat(s.id, "water", allMatch && opt !== "—" ? "—" : opt))} style={{
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

      {/* [SEATS] section — one card per guest, matching the app's card grammar */}
      <div style={{ padding: isMobile ? "14px 12px 0" : "16px 20px 0" }}>
        <div style={{ ...microLabel, marginBottom: 10 }}>[SEATS]</div>
      {table.seats.map(seat => {
        const seatRestrictions = (table.restrictions || []).filter(r => r.pos === seat.id);
        const drinkPhase = drinkPhaseBySeat[seat.id] || "aperitif";
        const seatHasDrinks =
          (seat.aperitifs?.length || 0) > 0 || (seat.glasses?.length || 0) > 0 ||
          (seat.cocktails?.length || 0) > 0 || (seat.spirits?.length || 0) > 0 ||
          (seat.beers?.length || 0) > 0 || (seat.pairing && seat.pairing !== "—");
        // "" and "—" both mean no pairing — MenuGenerator/board write "—",
        // this view used to write "" so the "—" chip never lit up.
        const pairingCur = (seat.pairing && seat.pairing !== "—") ? seat.pairing : "—";
        return (
          <div key={seat.id} style={{
            borderTop:    `1px solid ${tokens.ink[4]}`,
            borderRight:  `1px solid ${tokens.ink[4]}`,
            borderBottom: `1px solid ${tokens.ink[4]}`,
            borderLeft:   `3px solid ${seatRestrictions.length ? tokens.red.border : seatHasDrinks ? tokens.charcoal.default : tokens.ink[4]}`,
            borderRadius: 0, marginBottom: 10,
            background: tokens.neutral[0],
          }}>
            {/* ── Header: P · Water · Pairing · Restrictions · Swap ── */}
            <div style={{
              display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
              padding: isMobile ? "10px 12px" : "10px 14px",
            }}>
              {/* P position label */}
              <div style={{
                width: 28, height: 28, borderRadius: 0,
                border: `1px solid ${seatRestrictions.length ? tokens.red.border : tokens.ink[4]}`,
                background: seatRestrictions.length ? tokens.red.bg : tokens.neutral[0],
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: FONT, fontSize: "9px", fontWeight: 700,
                color: seatRestrictions.length ? tokens.red.text : tokens.ink[1],
                letterSpacing: "0.06em", flexShrink: 0,
              }}>P{seat.id}</div>

              {/* Water */}
              <div style={{ width: 62, flexShrink: 0 }}>
                <WaterPicker value={seat.water} onChange={v => updSeat(seat.id, "water", v)} />
              </div>

              <div style={{ width: 1, height: 20, background: tokens.ink[5], flexShrink: 0 }} />

              {/* Pairing chips */}
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap", flex: 1, minWidth: 160 }}>
                {PAIRINGS.map(p => {
                  const on = pairingCur === p;
                  return (
                    <button key={p} onClick={() => updSeat(seat.id, "pairing", p === "—" ? "" : (on ? "" : p))}
                      style={chipBtn(on)}>{p}</button>
                  );
                })}
                {seatRestrictions.map((r, i) => (
                  <span key={i} style={{
                    fontFamily: FONT, fontSize: 9, letterSpacing: "0.04em",
                    padding: "5px 8px", borderRadius: 0, alignSelf: "center",
                    background: tokens.red.bg, border: `1px solid ${tokens.red.border}`,
                    color: tokens.red.text, whiteSpace: "nowrap",
                  }}>⚠ {restrLabel(r.note)}</span>
                ))}
              </div>

              {/* Swap */}
              {table.seats.length > 1 && (
                <div style={{ marginLeft: "auto", flexShrink: 0 }}>
                  <SwapPicker seatId={seat.id} totalSeats={table.seats.length} onSwap={t => swapSeats(seat.id, t)} />
                </div>
              )}
            </div>

            {/* ── Drinks — one entry point. The phase chip decides whether a
                search pick lands as an aperitif or with the menu. ── */}
            <div style={{
              background: tokens.neutral[50],
              borderTop: `1px solid ${tokens.ink[5]}`,
              padding: isMobile ? "10px 12px" : "10px 14px",
            }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <div style={microLabel}>[DRINKS]</div>
                  <div style={{ display: "flex", gap: 4 }}>
                    {[["aperitif", "APERITIF"], ["menu", "WITH MENU"]].map(([ph, label]) => (
                      <button key={ph}
                        onClick={() => setDrinkPhaseBySeat(prev => ({ ...prev, [seat.id]: ph }))}
                        style={{ ...chipBtn(drinkPhase === ph), fontSize: 8, letterSpacing: "0.10em", textTransform: "uppercase" }}
                      >{label}</button>
                    ))}
                  </div>
                </div>
                {/* Quick-add buttons — aperitif presets, always land as aperitif */}
                {aperitifOptions.length > 0 && (
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                    {aperitifOptions.map(ap => {
                      const found = resolveAperitifFromQuickAccessOption(ap, { wines, cocktails, spirits, beers });
                      return (
                        <button key={ap.label} onClick={() => {
                          const item = found || { name: ap.searchKey || ap.label, notes: "", __cocktail: true };
                          updSeat(seat.id, "aperitifs", [...(seat.aperitifs || []), item]);
                        }} style={{
                          fontFamily: FONT, fontSize: 9, letterSpacing: "0.04em", padding: isMobile ? "10px 9px" : "4px 9px",
                          border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, cursor: "pointer",
                          background: tokens.neutral[0], color: tokens.ink[2], transition: "all 0.1s",
                          touchAction: "manipulation",
                        }}>{ap.label}</button>
                      );
                    })}
                  </div>
                )}
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

            {/* ── Extras + standalone pairings footer ── */}
            {(optionalExtras.length > 0 || optionalPairings.some(opt => !opt.extraKey)) && (
              <div style={{
                borderTop: `1px solid ${tokens.ink[5]}`,
                padding: isMobile ? "10px 12px" : "10px 14px",
                display: "flex", gap: isMobile ? 12 : 18, flexWrap: "wrap", alignItems: "flex-start",
              }}>
                {/* Optional extras (derived from optional_flag) */}
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
                    <div key={dish.key} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 96 }}>
                      <div style={microLabel}>{dish.name}</div>
                      <button onClick={() => {
                        updSeat(seat.id, "extras", {
                          ...seat.extras, [dish.key]: { ...extra, ordered: !extra.ordered }
                        });
                      }} style={{
                        fontFamily: FONT, fontSize: 9, letterSpacing: "0.08em", padding: isMobile ? "10px 8px" : "5px 8px",
                        border: `1px solid ${extra.ordered ? tokens.green.border : tokens.ink[4]}`, borderRadius: 0, cursor: "pointer",
                        background: extra.ordered ? tokens.green.bg : tokens.neutral[0],
                        color: extra.ordered ? tokens.green.text : tokens.ink[3],
                        fontWeight: extra.ordered ? 600 : 400,
                        transition: "all 0.1s", touchAction: "manipulation",
                      }}>{extra.ordered ? "YES" : "NO"}</button>
                      {linkedPairing ? (
                        <div style={{ display: "flex", gap: 3, opacity: extra.ordered ? 1 : 0.35, pointerEvents: extra.ordered ? "auto" : "none" }}>
                          <button onClick={() => updLp({ ordered: false, mode: null })} style={segBtn(!lpActive, "off")}>OFF</button>
                          {linkedPairing.hasAlco && (
                            <button onClick={() => updLp({ ordered: true, mode: "alco" })} style={segBtn(alcoOn, "alco")}>ALCO</button>
                          )}
                          {linkedPairing.hasNonAlco && (
                            <button onClick={() => updLp({ ordered: true, mode: "nonalc" })} style={segBtn(naOn, "nonalc")}>N/A</button>
                          )}
                        </div>
                      ) : (
                        <select value={extra.pairing || dish.pairings[0]} disabled={!extra.ordered}
                          onChange={e => updSeat(seat.id, "extras", { ...seat.extras, [dish.key]: { ...extra, pairing: e.target.value } })}
                          style={{
                            fontFamily: FONT, fontSize: 10, padding: "4px 5px",
                            border: `1px solid ${tokens.ink[5]}`, borderRadius: 0,
                            background: tokens.neutral[0], color: tokens.ink[1], outline: "none",
                            opacity: extra.ordered ? 1 : 0.35, width: "100%",
                          }}>
                          {dish.pairings.map(p => <option key={p}>{p}</option>)}
                        </select>
                      )}
                    </div>
                  );
                })}
                {/* Standalone optional pairings (no linked extra dish) */}
                {optionalPairings.filter(opt => !opt.extraKey).map(opt => {
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
                    <div key={opt.key} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 96 }}>
                      <div style={microLabel}>{opt.label}</div>
                      <div style={{ display: "flex", gap: 3 }}>
                        <button onClick={() => updOpt({ ordered: false })} style={segBtn(!active, "off")}>OFF</button>
                        {opt.hasAlco && (
                          <button onClick={() => updOpt({ ordered: true, mode: "alco" })} style={segBtn(alcoOn, "alco")}>ALCO</button>
                        )}
                        {opt.hasNonAlco && (
                          <button onClick={() => updOpt({ ordered: true, mode: "nonalc" })} style={segBtn(naOn, "nonalc")}>N/A</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      </div>

      {/* [TABLE INFO] section */}
      <div style={{
        borderTop: `1px solid ${tokens.ink[4]}`,
        padding: isMobile ? "14px 12px" : "16px 20px",
        background: tokens.neutral[50],
      }}>
        <div style={{ ...microLabel, marginBottom: 14 }}>[TABLE INFO]</div>

      {/* Table-wide fields */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20 }}>
        <div>
          <div style={{ ...microLabel, marginBottom: 6 }}>[BOTTLES]</div>
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
          <div style={{ ...microLabel, marginBottom: 6 }}>[RESTRICTIONS]</div>
          {table.restrictions?.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {table.restrictions.map((r, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap",
                  padding: "6px 10px", background: r.pos ? tokens.neutral[0] : tokens.red.bg,
                  border: `1px solid ${r.pos ? tokens.ink[5] : tokens.red.border}`, borderRadius: 0,
                }}>
                  <span style={{ fontFamily: FONT, fontSize: 11, color: tokens.red.text, fontWeight: 500, flex: 1, minWidth: 80 }}>
                    {restrLabel(r.note)}
                  </span>
                  <div style={{ display: "flex", gap: 3 }}>
                    {/* Seat positions cap at the assigned table's seat count in
                        the ACTIVE floor map (T9 offers 3 under Layout B, 2
                        under A); a squeezed-in extra guest still gets a chip. */}
                    {Array.from({ length: mapSeatCap != null ? Math.max(mapSeatCap, Number(table.guests) || 0) : (Number(table.guests) || 0) }, (_, idx) => {
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
            <div style={{ fontFamily: FONT, fontSize: 11, color: tokens.ink[4] }}>none</div>
          )}
        </div>
        <div>
          <div style={{ ...microLabel, marginBottom: 6 }}>[BIRTHDAY CAKE]</div>
          {/* Editable — the old view only displayed the flag, so a birthday
              learned mid-service couldn't be recorded from this screen. */}
          <button onClick={() => upd("birthday", !table.birthday)} style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: "0.08em", padding: isMobile ? "10px 14px" : "6px 14px",
            border: `1px solid ${table.birthday ? tokens.green.border : tokens.ink[4]}`, borderRadius: 0,
            cursor: "pointer", background: table.birthday ? tokens.green.bg : tokens.neutral[0],
            color: table.birthday ? tokens.green.text : tokens.ink[3],
            fontWeight: table.birthday ? 600 : 400,
            transition: "all 0.1s", touchAction: "manipulation",
          }}>{table.birthday ? "YES" : "NO"}</button>
        </div>
        <div>
          <div style={{ ...microLabel, marginBottom: 6 }}>[NOTES]</div>
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
export function DisplayBoardCard({ t, quickMode, upd, updSeat, onCardClick, onOpenDetail, onSeat, onUnseat, onMarkSeated, onAssignTerrace, optionalExtras = [], optionalPairings = [], aperitifOptions, wines = [], cocktails = [], spirits = [], beers = [] }) {
    const isSeated = t.active;
    // Terrace-flow decoration (derived in App, never persisted on the row):
    // 'terrace' = party outside on t._visit.terraceLabel; 'arriving' = mid
    // kitchen-visit, walking to this table.
    const visit = t._visit || null;
    const isArriving = !isSeated && visit?.visit === "arriving";
    // The badge survives seating: courses often start while the party is
    // still outside, and the runner needs the terrace table number ON the
    // board card, not from memory.
    const onTerrace = visit?.visit === "terrace";
    const allRestr = (t.restrictions || []).filter(r => r.note);
    const [assigningIdx, setAssigningIdx] = useState(null);
    const [justSent, setJustSent] = useState(false);
    const seats = t.seats || [];

    // Service → kitchen "Send" only carries what's new since this table LAST
    // SENT (kitchenSent advances at send time, not on a kitchen confirmation —
    // the confirm flow isn't part of service reality, so waiting on it made
    // every Send re-transmit the whole night's pairings and orders).
    // hasKitchenUpdate drives the button.
    const kitchenCurrent = kitchenSnapshot(seats, optionalExtras, optionalPairings);
    const hasKitchenUpdate = kitchenDelta(kitchenCurrent, t.kitchenSent || {}).length > 0;

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
        borderTop:    `1px ${isArriving ? "dashed" : "solid"} ${isArriving ? tokens.ink[1] : tokens.ink[4]}`,
        borderBottom: `1px ${isArriving ? "dashed" : "solid"} ${isArriving ? tokens.ink[1] : tokens.ink[4]}`,
        borderLeft:   isArriving ? `3px dashed ${tokens.ink[1]}` : `3px solid ${isSeated ? tokens.green.border : tokens.ink[4]}`,
        borderRight:  `1px ${isArriving ? "dashed" : "solid"} ${isArriving ? tokens.ink[1] : tokens.ink[4]}`,
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
              background: isArriving ? tokens.ink[0] : isSeated ? tokens.green.bg : tokens.neutral[50],
              border: `1px ${isArriving ? "dashed" : "solid"} ${isArriving ? tokens.ink[0] : isSeated ? tokens.green.border : tokens.ink[4]}`,
              color: isArriving ? tokens.neutral[0] : isSeated ? tokens.green.text : tokens.ink[3], fontWeight: 500,
              textTransform: "uppercase",
            }}>{isArriving ? "ARRIVING · KV" : isSeated ? "SEATED" : "RESERVED"}</span>
            {onTerrace && (
              <span style={{
                fontFamily: FONT, fontSize: "8px", letterSpacing: "0.08em",
                padding: "2px 6px", borderRadius: 0,
                border: `1px solid ${tokens.ink[4]}`, color: tokens.ink[2],
                background: tokens.ink[5], fontWeight: 600, textTransform: "uppercase",
              }}>ON TERRACE{visit.terraceLabel ? ` · ${visit.terraceLabel}` : ""}</span>
            )}
            {isArriving && onMarkSeated && (
              <button
                onClick={e => { e.stopPropagation(); onMarkSeated(t.id); }}
                style={{
                  fontFamily: FONT, fontSize: "8px", letterSpacing: "0.12em",
                  padding: "3px 8px", border: `1px solid ${tokens.green.border}`,
                  background: tokens.green.bg, color: tokens.green.text,
                  borderRadius: 0, cursor: "pointer", fontWeight: 700,
                  textTransform: "uppercase", touchAction: "manipulation",
                }}
              >MARK SEATED</button>
            )}
            {/* arrival flow: any party WITHOUT a terrace leg can open the
                terrace mini-map — seating the board table first (to start
                courses) must not lock the party out of a terrace table */}
            {!visit && onAssignTerrace && (
              <button
                onClick={e => { e.stopPropagation(); onAssignTerrace(t.id); }}
                title="Seat this party on the terrace for opening snacks"
                style={{
                  fontFamily: FONT, fontSize: "8px", letterSpacing: "0.1em",
                  padding: "3px 8px", border: `1px solid ${tokens.ink[4]}`,
                  background: tokens.neutral[0], color: tokens.ink[2],
                  borderRadius: 0, cursor: "pointer", textTransform: "uppercase",
                  touchAction: "manipulation",
                }}
              >TERRACE →</button>
            )}
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
              {WATER_QUICK.map(opt => {
                const active = allWaterMatch(opt);
                return wBtn(opt, active, () => seats.forEach(s => updSeat && updSeat(t.id, s.id, "water", active ? "—" : opt)));
              })}
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
              const hasPairing = !!(s.pairing && s.pairing !== "—");
              const hasContent = (s.water && s.water !== "—") || hasPairing || restr.length > 0 || extras.length > 0 || (s.aperitifs || []).length > 0;

              if (quickMode) {
                const cyclePairing = () => {
                  if (!updSeat) return;
                  const cur = s.pairing || "—";
                  const idx = PAIRINGS.indexOf(cur);
                  const nx = PAIRINGS[(idx + 1) % PAIRINGS.length];
                  updSeat(t.id, s.id, "pairing", nx === "—" ? "" : nx);
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
                          {WATER_QUICK.map(opt => {
                            const active = s.water === opt;
                            return wBtn(opt, active, () => updSeat && updSeat(t.id, s.id, "water", active ? "—" : opt));
                          })}
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
                            <span>{curPairing === "—" ? "None" : curPairing}</span>
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

                    {/* APERITIF — quick picks plus the complete live beverage catalog */}
                    {sectionBlock("Aperitif", [
                      ...(aperitifOptions || []).map(opt => {
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
                      }),
                      <QuickAperitifSearch
                        key="all-beverage-search"
                        wines={wines}
                        cocktails={cocktails}
                        spirits={spirits}
                        beers={beers}
                        onAdd={(item) => updSeat && updSeat(t.id, s.id, "aperitifs", [...(s.aperitifs || []), item])}
                      />,
                    ])}

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
                  {hasPairing && pc && (
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
                  // Only the new/changed items since this table's LAST SEND —
                  // and advance the baseline immediately, so the next Send can
                  // never repeat what the kitchen was already shown. (It used
                  // to advance only when the kitchen confirmed the alert; with
                  // the confirm flow unused, every Send re-sent everything.)
                  const deltaSeats = kitchenDelta(kitchenCurrent, t.kitchenSent || {});
                  if (deltaSeats.length === 0) return;
                  upd(t.id, "kitchenAlert", {
                    timestamp: new Date().toISOString(),
                    tableName: t.resName || null,
                    seats: deltaSeats,
                    confirmed: false,
                    snapshot: kitchenCurrent,
                  });
                  upd(t.id, "kitchenSent", kitchenCurrent);
                  // a Send to an archived ticket proves it's still live —
                  // bring it back next to its alert (Archive mis-taps)
                  if (t.kitchenArchived) upd(t.id, "kitchenArchived", false);
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

function DisplayBoard({ tables, optionalExtras = [], optionalPairings = [], upd, quickTableId = null, updSeat, onCardClick, onOpenDetail, onSeat, onUnseat, onMarkSeated, onAssignTerrace, aperitifOptions = [], wines = [], cocktails = [], spirits = [], beers = [] }) {
  const isMobile = useIsMobile(BP.md);

  // Tables that belong to a combined booking are grouped solely by their
  // EXPLICIT tableGroup (set by the reservation form + reconcile). We used to
  // ALSO auto-merge any two tables sharing resName+resTime, but that legacy
  // fallback mis-fired after a move/swap — two tables transiently sharing a
  // name+time got stacked into a phantom "T3-10". Explicit groups now cover
  // every real combined booking, so the heuristic is gone.
  const isPrimary = t => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup);
  const visible = tables.filter(t => t.active || t.resTime || t.resName).filter(isPrimary);
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
                  onMarkSeated={onMarkSeated}
                  onAssignTerrace={onAssignTerrace}
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
  const localBev = readLocalBeverages();
  const loadMenuCoursesRef = useRef(null);
  const appIsMobile = useIsMobile(BP.md);

  // The board starts blank and paints from the source of truth: the local
  // SQLite DB (instant, works offline) or the direct-Supabase fallback load.
  // Demo mode (no Supabase configured) has no store at all — it restores the
  // device-local demo snapshot instead.
  const [tables,    setTables]    = useState(() => {
    if (!hasSupabaseConfig) {
      const demo = readLocalDemoBoard();
      if (demo) return demo.map(t => sanitizeTable(t));
    }
    return initTables;
  });
  // Hydrate the reference lists from the per-workspace device cache so they
  // paint instantly on launch; SQLite/Supabase refresh them right after.
  const [menuCourses, setMenuCourses] = useState(() => readLocalMenuCourses() || []);
  /** True while the admin course editor holds UNSAVED edits. menuCourses is
   *  both the live synced list AND the editor's draft (CourseEditorPanel has
   *  no local copy), so a sync repaint mid-edit — typically the checkpoint
   *  echo of the user's own PREVIOUS save — silently reverted the draft and
   *  made the next save diff to nothing ("edited Peas, pressed save, it
   *  reverted"). While dirty, the watch/loader adoption is suppressed; the
   *  flag clears on save or when leaving admin. */
  const menuCoursesDirtyRef = useRef(false);
  const [wines,     setWines]     = useState(() => readLocalWines() || []);
  const [cocktails, setCocktails] = useState(localBev?.cocktails ?? initCocktails);
  const [spirits,   setSpirits]   = useState(localBev?.spirits   ?? initSpirits);
  const [beers,     setBeers]     = useState(localBev?.beers      ?? initBeers);
  const [mode, setMode] = useState(() => {
    try {
      const storedMode = localStorage.getItem(workspaceKey("milka_mode")) || null;
      const storedDate = localStorage.getItem(workspaceKey("milka_service_date"));
      const chosenOn   = localStorage.getItem(workspaceKey(SERVICE_DATE_CHOSEN_ON_KEY));
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
  // False until the post-login workspace query actually resolves. Gates the
  // ProfilePicker so its "no restaurant linked" empty state can't flash while
  // the list is still loading.
  const [workspacesResolved, setWorkspacesResolved] = useState(false);

  const applyWorkspace = useCallback((id) => {
    setWorkspaceId(id);        // module singleton — used by scopedFrom() everywhere
    setWorkspaceIdState(id);   // React state — drives the data-load effects
    // The store decision is per-workspace: re-gate the fallback loaders until
    // the sqlite-primary probe resolves for THIS workspace, so a first login
    // doesn't fire a redundant direct-Supabase burst that the primary path
    // immediately supersedes.
    setSqlitePrimary(false);
    setSqlitePrimaryFlag(false);
    setPsResolved(!isPowerSyncEnabled(id));
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

  // Once signed in, RLS returns only workspaces where this user has an explicit
  // membership. A restaurant login normally has exactly one; the separate Demo
  // login has only the sandbox. Multiple memberships still use the generic
  // picker, but there is no special account that can see every restaurant.
  useEffect(() => {
    if (!supabase || !session) {
      setMyWorkspaces([]); setWorkspacesResolved(false);
      return;
    }
    let active = true;
    setWorkspacesResolved(false);
    (async () => {
      try {
        const { data: wsRows } = await withRetry(async () => {
          const result = await supabase.from("workspaces").select("id, name, kind, slug")
            .order("kind", { ascending: true }).order("name", { ascending: true });
          if (result.error) throw result.error;
          return result;
        });
        if (!active) return;
        const list = wsRows || [];
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
    // workspace account back to the restaurant picker. The workspace
    // choice must survive token refreshes — only re-resolve on an actual login
    // / user change.
  }, [session?.user?.id, applyWorkspace]); // eslint-disable-line react-hooks/exhaustive-deps

  // Roles are deliberately deferred. For the polishing phase, explicit
  // workspace membership means full restaurant-owner/admin capability.
  const canAdmin = Boolean(workspaceId && myWorkspaces.some((w) => w.id === workspaceId));

  const [sel,          setSel]          = useState(null);
  // Which table (if any) is currently expanded into Quick Access on the board.
  // Clicking a reservation name toggles this; the rest of the board stays compact.
  const [quickTableId, setQuickTableId] = useState(null);
  // Service board presentation: "board" (card grid) or "floor" (the spatial
  // floor map). Persisted so a device keeps its preferred working view across
  // reloads; anything unknown — including "sheet", removed 10.07 — falls back
  // to "board".
  const [serviceView, setServiceView] = useState(() => {
    try {
      const v = localStorage.getItem(workspaceKey("milka_service_view"));
      return v === "floor" ? v : "board";
    } catch { return "board"; }
  });
  const changeServiceView = v => {
    setServiceView(v);
    try { localStorage.setItem(workspaceKey("milka_service_view"), v); } catch {}
  };
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
  // The LAST direct-Supabase failure, kept for the admin SYSTEM panel: a bare
  // "Error" light stalled the 10.07 rollout diagnosis for an hour — the panel
  // must say WHAT failed and WHEN, phone-screenshot-friendly, no DevTools.
  const [lastSyncError, setLastSyncError] = useState(null);
  const noteSyncError = (source, error) => setLastSyncError({
    at: Date.now(), source,
    msg: String(error?.message || error?.code || error || "unknown"),
  });
  const [logoDataUri,  setLogoDataUri]  = useState(() => readLocalLogo() || "");
  const [wineSyncConfig, setWineSyncConfig] = useState(() => {
    try { return normalizeSyncConfig(JSON.parse(localStorage.getItem(workspaceKey(SYNC_CONFIG_KEY)) || "null")); } catch { return DEFAULT_SYNC_CONFIG; }
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
      const raw = JSON.parse(localStorage.getItem(workspaceKey("milka_menu_rules")) || "null");
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
  // Floor maps (terrace + dining layouts, seeded from the house diagrams) and
  // SET markers. Definitions persist via service_settings; terrace
  // occupancy is DERIVED from reservations, never stored on the board.
  const [floorMapsState, setFloorMapsState] = useState(() => sanitizeFloorMaps(null));
  // SET markers for every map — floor_status_v1.
  const [floorStatus, setFloorStatusState] = useState(() => sanitizeFloorStatus(null));
  // Party-first ASSIGN TERRACE: the reservation whose mini-map picker is open.
  const [terraceAssignFor, setTerraceAssignFor] = useState(null);
  // Quick Access items (data-driven, replaces hardcoded APERITIF_OPTIONS)
  const [quickAccessItems, setQuickAccessItems] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(workspaceKey("milka_quick_access")) || "null");
      if (stored) return stored;
    } catch {}
        return DEFAULT_QUICK_ACCESS_ITEMS.map(item => ({ ...item }));
  });
  // Access gate: checked once at init against 12h TTL
  const [authed,       setAuthed]       = useState(() => readAccess());
  // Reservations & service date — hydrate the planner instantly from cache.
  const [reservations, setReservations] = useState(() => readLocalReservations() || []);
  const reservationsRef = useRef(reservations);
  reservationsRef.current = reservations;
  // Gates the board↔reservations reconciliation effect: it must not run (and
  // especially must not clear ghost tables) until both reservations and the
  // remote service-table state have actually loaded.
  const [reservationsLoaded, setReservationsLoaded] = useState(!supabase);
  // True only after the board truth (local SQLite when primary, Supabase on
  // the fallback) has been read and adopted at least once. Non-negotiable:
  // reconciling/saving against the blank boot state once wiped a live service
  // started on another device — every table looked "not started" locally, so
  // reconcile rebuilt them from reservations alone and the autosave pushed
  // the wipe to the server.
  const [remoteBoardLoaded, setRemoteBoardLoaded] = useState(!supabase);
  const [boardSyncTick, setBoardSyncTick] = useState(0);
  // Boot splash: show "CONNECTING…" until the board truth lands, but never
  // longer than a beat — an offline device must still reach the UI (its board
  // fills in when the local DB read completes).
  const [bootGateDone, setBootGateDone] = useState(!supabase);
  useEffect(() => {
    if (bootGateDone) return undefined;
    if (remoteBoardLoaded) { setBootGateDone(true); return undefined; }
    const t = setTimeout(() => setBootGateDone(true), 1500);
    return () => clearTimeout(t);
  }, [remoteBoardLoaded, bootGateDone]);
  const [serviceDate,  setServiceDate]  = useState(() => {
    try {
      const stored = localStorage.getItem(workspaceKey("milka_service_date"));
      if (!stored) return null;
      const chosenOn = localStorage.getItem(workspaceKey(SERVICE_DATE_CHOSEN_ON_KEY));
      if (isStaleServiceDate(stored) && !isActivePastReview(stored, chosenOn)) {
        // Date rolled over since last session — drop the stale value so
        // "Start Service" prompts for today's date instead of silently
        // resuming yesterday's (now empty) service. An abandoned past-date
        // review (chosen on an earlier day) is dropped here too.
        try {
          localStorage.removeItem(workspaceKey("milka_service_date"));
          localStorage.removeItem(workspaceKey(SERVICE_DATE_CHOSEN_ON_KEY));
        } catch {}
        return null;
      }
      return stored;
    } catch { return null; }
  });
  // Service day at the moment the date was chosen — distinguishes a service
  // that rolled over (auto-end) from one deliberately started on a past day.
  const [serviceDateChosenOn, setServiceDateChosenOn] = useState(() => {
    try { return localStorage.getItem(workspaceKey(SERVICE_DATE_CHOSEN_ON_KEY)) || null; } catch { return null; }
  });
  const [showServiceDatePicker,  setShowServiceDatePicker]  = useState(false);
  const [pendingModeAfterDate,   setPendingModeAfterDate]   = useState(null);
  const [activeServiceSession, setActiveServiceSession] = useState(() => {
    try { return localStorage.getItem(workspaceKey("milka_service_session")) || "dinner"; } catch { return "dinner"; }
  });
  // Live refs for the service identity so the persist helpers (and fire-and-forget
  // DB writes) always read the freshest value, not a stale render closure. The
  // session and a per-service `startedAt` instance id are SHARED across devices
  // via the service_date settings row — previously the session was device-local
  // (localStorage only), so a joining device kept its own default and filtered
  // the board to the wrong session (reservations from the live session vanished),
  // and the archive could be filed under the wrong session label.
  const serviceDateRef = useRef(serviceDate);
  serviceDateRef.current = serviceDate;
  const serviceDateChosenOnRef = useRef(serviceDateChosenOn);
  serviceDateChosenOnRef.current = serviceDateChosenOn;
  const activeServiceSessionRef = useRef(activeServiceSession);
  activeServiceSessionRef.current = activeServiceSession;
  // Unique id for THIS service instance (set the moment a service is started).
  // Lets the archive tell a genuine second service on the same day+session apart
  // from a double-file race, instead of silently dropping the second one.
  const serviceStartedAtRef = useRef((() => {
    try { return localStorage.getItem(workspaceKey("milka_service_started_at")) || null; } catch { return null; }
  })());
  const saveTimerRef       = useRef(null);
  /** Sanitized-table JSON of the last state written to (or adopted from) the
   *  store, by index. Diffing against it keeps board writes to just the rows
   *  that actually changed, and tells the watch handler which tables carry
   *  unsaved local edits (those are never clobbered by an incoming repaint —
   *  the pending save wins, row-level last-write-wins). */
  const prevTablesJsonRef  = useRef(initTables.map(t => JSON.stringify(sanitizeTable(t))));
  const tablesRef          = useRef(tables);
  /** table_ids with local changes not yet CONFIRMED persisted — added at queue
   *  time, removed only when a flush write succeeds. A Set of ids, not row
   *  snapshots: the flush derives each row from tablesRef.current at send time,
   *  so a fold that lands between queue and flush can't be overwritten by a
   *  stale queued copy. Ids survive failed flushes (re-added) so the drain
   *  heartbeat below retries them without needing another local edit. */
  const pendingBoardWritesRef = useRef(new Set());
  /** Sanitized-table JSON of the last state CONFIRMED in the store, by index —
   *  advanced only when a write succeeds or a store row is adopted, unlike
   *  prevTablesJsonRef above which advances at queue time. adoptRemoteTables
   *  keys its unsaved-edit detection and fold ancestor off THIS baseline, so a
   *  write that failed (or is still in flight) still reads as "unsaved" and an
   *  incoming stale store row FOLDS instead of clobbering it (the wifi-extender
   *  incident: fired dishes vanished when a refetch adopted the old row after
   *  the save had silently failed). */
  const confirmedTablesJsonRef = useRef(initTables.map(t => JSON.stringify(sanitizeTable(t))));
  /** updated_at (epoch ms) of the last row THIS device wrote per table_id.
   *  adoptRemoteTables uses it to drop stale echoes: on the fallback path a
   *  rapid tap sequence produces write A then write B, and A's realtime echo
   *  lands AFTER B is saved — adopting it flashed the previous option before
   *  B's echo flipped it back (the rapid-tap flicker). */
  const lastBoardWriteRef = useRef(new Map());
  /** One-shot flag set by the legitimate whole-board clears (CLEAR ALL, archive
   *  & clear, rollover auto-end, a real day-switch) so the autosave mass-blank
   *  guard lets THOSE blanks through. Any OTHER mass-blank is refused. */
  const intentionalBoardClearRef = useRef(false);

  // ── SQLite-primary gate ────────────────────────────────────────────────────
  // The on-device PowerSync DB is the app's read/write path once (a) its
  // priority-1 first sync has completed. Workspace access was already proven
  // by the membership-scoped workspace query above, so an empty new restaurant
  // is a valid local-first database—not a reason to enter another data path.
  // `psResolved` flips after sync or a boot deadline so the direct-Supabase
  // outage fallback neither races the primary store nor hangs forever.
  const psEnabled = isPowerSyncEnabled(workspaceId);
  const [sqlitePrimary, setSqlitePrimary] = useState(false);
  const [psResolved, setPsResolved] = useState(!psEnabled);
  const sqlitePrimaryRef = useRef(false);
  sqlitePrimaryRef.current = sqlitePrimary;
  // Mirror the decision into the module flag so the shared stateStore helpers
  // and the admin components outside this tree (inventory, archive, menu
  // texts) pick the same store. Declared before every consumer effect.
  useEffect(() => { setSqlitePrimaryFlag(sqlitePrimary); }, [sqlitePrimary]);

  // ── Store seams ────────────────────────────────────────────────────────────
  // The service_settings blobs (logo, layouts, quick access, service date, …)
  // go through the shared lib/stateStore.js helpers; the board, reservation
  // and archive seams below pick the store the same way.

  // Persist board rows: [{ table_id, data, updated_at }] (update-or-insert).
  const persistBoardRows = useCallback(async (rows) => {
    if (!supabase || !getWorkspaceId() || !rows?.length) return { ok: true };
    // Record what this device is writing (all callers funnel through here —
    // autosave, CLEAR ALL blanks) so adoptRemoteTables can drop older echoes.
    for (const r of rows) {
      const ts = Date.parse(r.updated_at || "");
      if (Number.isFinite(ts)) lastBoardWriteRef.current.set(Number(r.table_id), ts);
    }
    try {
      if (sqlitePrimaryRef.current) {
        const { writeServiceTables } = await import("./powersync/writes.js");
        await writeServiceTables(rows);
      } else {
        const { saveServiceTableWithCas } = await import("./lib/serviceTableCas.js");
        const ws = getWorkspaceId();
        for (const row of rows) {
          const idx = (tablesRef.current || []).findIndex(t => t.id === Number(row.table_id));
          let ancestor = null;
          try {
            ancestor = idx >= 0 && confirmedTablesJsonRef.current[idx]
              ? JSON.parse(confirmedTablesJsonRef.current[idx])
              : null;
          } catch { ancestor = null; }
          await saveServiceTableWithCas({
            client: supabase,
            workspaceId: ws,
            tableId: row.table_id,
            data: row.data,
            ancestor,
          });
        }
      }
      // The store now holds exactly these rows — advance the CONFIRMED
      // baseline so the reconciler stops shielding them as unsaved (mirror of
      // lastBoardWriteRef above: every board writer funnels through here).
      for (const r of rows) {
        const idx = (tablesRef.current || []).findIndex(t => t.id === Number(r.table_id));
        if (idx !== -1) {
          confirmedTablesJsonRef.current[idx] =
            JSON.stringify(sanitizeTable({ id: Number(r.table_id), ...(r.data || {}) }));
        }
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error };
    }
  }, []);

  /** Drain the pending board-write set. Rows are derived from CURRENT state at
   *  send time (never from queue-time snapshots — a fold that landed in
   *  between must win), written with the same 4-attempt cadence the autosave
   *  always used, and on failure the ids are re-added so the drain heartbeat
   *  retries them without needing another local edit (they used to sit until
   *  the next tap — during the wifi-extender lag-out that ate every fired
   *  dish). Single-flight with a trailing re-run: two overlapping flushes
   *  could land out of order and regress the store. */
  const flushingBoardRef = useRef(false);
  const flushAgainRef = useRef(false);
  const flushBoardWrites = useCallback(async () => {
    if (flushingBoardRef.current) { flushAgainRef.current = true; return; }
    flushingBoardRef.current = true;
    try {
      do {
        flushAgainRef.current = false;
        const ids = [...pendingBoardWritesRef.current];
        pendingBoardWritesRef.current = new Set();
        if (ids.length === 0) return;
        const stamp = new Date().toISOString();
        const cur = tablesRef.current || [];
        const rows = [];
        for (const id of ids) {
          const table = cur.find(t => t.id === id);
          if (!table) continue; // table no longer on the board — nothing to write
          const data = sanitizeTable(table);
          const idx = cur.indexOf(table);
          // Already confirmed (an adoption made local == store truth after the
          // id was queued) — nothing left to write for this table.
          if (JSON.stringify(data) === confirmedTablesJsonRef.current[idx]) continue;
          rows.push({ table_id: id, data, updated_at: stamp });
        }
        if (rows.length === 0) continue;
        let lastError;
        let ok = false;
        for (let attempt = 0; attempt < 4; attempt++) {
          if (attempt > 0) await new Promise(r => setTimeout(r, 500 * attempt));
          const result = await persistBoardRows(rows);
          if (result.ok) { ok = true; break; }
          lastError = result.error || new Error("Unknown service table sync error");
        }
        if (ok) {
          setSyncStatus("live");
        } else {
          // Confirmed baseline stays put for these tables, so adoptRemoteTables
          // keeps folding around them; the re-added ids retry on the heartbeat.
          rows.forEach(r => pendingBoardWritesRef.current.add(r.table_id));
          setSyncStatus("sync-error");
          noteSyncError("board save", lastError);
          console.error("Save failed after 4 attempts:", lastError);
        }
      } while (flushAgainRef.current);
    } finally {
      flushingBoardRef.current = false;
    }
  }, [persistBoardRows]);

  // Read the full board from the source of truth (SQLite when primary).
  const fetchBoardRows = useCallback(async () => {
    if (sqlitePrimaryRef.current) {
      const { readServiceTables } = await import("./powersync/reads.js");
      return readServiceTables();
    }
    const { data, error } = await scopedFrom(TABLES.SERVICE_TABLES)
      .select("table_id, data, updated_at");
    if (error) throw error;
    return data || [];
  }, []);

  // Persist one reservation row (update-or-insert by id).
  const persistReservationRow = useCallback(async ({ id, date, table_id, data, created_at }) => {
    if (!supabase || !getWorkspaceId()) return { ok: true };
    try {
      if (sqlitePrimaryRef.current) {
        const { writeReservation } = await import("./powersync/writes.js");
        await writeReservation({ id, date, table_id, data, created_at });
      } else {
        // Never SET a null date: Postgres rejects it (NOT NULL — the 08.07
        // null-date incident) and the write dies silently. Omitting the column
        // keeps the store's existing date, matching the sqlite path's COALESCE.
        const patch = { table_id, data };
        if (date != null) patch.date = date;
        const { error } = await scopedFrom(TABLES.RESERVATIONS)
          .update(patch).eq("id", id);
        if (error) throw error;
      }
      return { ok: true };
    } catch (error) {
      console.warn("Reservation persist failed:", error);
      return { ok: false, error };
    }
  }, []);

  // Multi-row reservation operations (notably SWAP) must commit as one local
  // transaction / one PostgREST statement. Two independent requests can leave
  // both parties assigned to the same table if one succeeds and one fails.
  const persistReservationRows = useCallback(async (rows) => {
    if (!supabase || !getWorkspaceId() || !rows?.length) return { ok: true };
    try {
      if (sqlitePrimaryRef.current) {
        const { writeReservations } = await import("./powersync/writes.js");
        await writeReservations(rows);
      } else {
        const { error } = await scopedFrom(TABLES.RESERVATIONS)
          .upsert(rows, { onConflict: "id" });
        if (error) throw error;
      }
      return { ok: true };
    } catch (error) {
      console.warn("Reservation batch persist failed:", error);
      return { ok: false, error };
    }
  }, []);

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
  // (shared by saveRes, reconcileBoardWithReservations and the group-merge
  // views, which must ignore these seeded extras when judging seat content).
  const celebrationKeys = useMemo(() => celebrationKeysFromCourses(activeMenuCourses), [activeMenuCourses]);

  // Adopt a full set of store rows into React state. The store (local SQLite
  // when primary, Supabase on the fallback) is the source of truth; a table
  // with UNSAVED local edits (its current JSON differs from the last-written
  // baseline) is instead FOLDED with the incoming copy at seat granularity
  // (utils/foldTable.js) — two waiters editing different seats of the same
  // table both keep their work. The folded result still differs from the new
  // baseline, so the pending autosave writes it and every device converges.
  const adoptRemoteTables = rows => {
    const arr = Array.isArray(rows) ? rows : [];
    const rawById = new Map(arr.map(row => [Number(row.table_id), row]));
    const cur = tablesRef.current && tablesRef.current.length ? tablesRef.current : initTables;
    const nextPrev = [...prevTablesJsonRef.current];
    const confirmed = confirmedTablesJsonRef.current;
    let changed = false;
    const nextTables = initTables.map((base, idx) => {
      const mine = cur.find(t => t.id === base.id) || base;
      const row = rawById.get(base.id);
      if (!row) return mine; // no store row for this table — keep local
      // Stale-echo suppression: an incoming copy STRICTLY OLDER than what this
      // device last wrote for the table is a late echo of a superseded state —
      // adopting it flashes the previous option until the newer echo lands
      // (the rapid-tap flicker). Suppress only against writes from the last
      // 60s, so clock skew between devices can't hide a genuinely newer
      // remote edit for more than the contention moment itself.
      const lastWrite = lastBoardWriteRef.current.get(base.id);
      if (lastWrite && Date.now() - lastWrite < 60000) {
        const incoming = Date.parse(row.updated_at || "");
        if (Number.isFinite(incoming) && incoming < lastWrite) return mine;
      }
      const theirs = sanitizeTable({ id: base.id, ...(row.data || {}) });
      const theirsJson = JSON.stringify(theirs);
      const mineJson = JSON.stringify(sanitizeTable(mine));
      // Unsaved-edit detection keys off the CONFIRMED baseline — advanced only
      // when a write actually lands, unlike the queue-time diff baseline. A
      // failed or still-in-flight write therefore still counts as unsaved, so
      // a refetch returning the pre-write store row FOLDS around it instead of
      // erasing it (the wifi-extender incident: the save failed, the diff
      // baseline claimed "saved", and the next refetch wiped the fired dish).
      if (mineJson !== confirmed[idx]) {
        // If the incoming copy just echoes what the store last confirmed (or
        // equals our local state), nothing to fold — keep typing.
        if (theirsJson === confirmed[idx] || theirsJson === mineJson) return mine;
        let ancestor = null;
        try { ancestor = confirmed[idx] ? JSON.parse(confirmed[idx]) : null; } catch { /* keep null */ }
        const folded = sanitizeTable(foldTable(ancestor, sanitizeTable(mine), theirs));
        const foldedJson = JSON.stringify(folded);
        // theirs is the store truth we folded onto — both baselines move to it.
        nextPrev[idx] = theirsJson;
        confirmed[idx] = theirsJson;
        // A fold result the store doesn't hold yet must be (re-)queued here:
        // when it equals local state there is no re-render, so the autosave
        // effect never ticks and only the drain heartbeat re-persists it.
        if (foldedJson !== theirsJson) pendingBoardWritesRef.current.add(base.id);
        if (foldedJson !== mineJson) changed = true;
        return folded;
      }
      nextPrev[idx] = theirsJson;
      confirmed[idx] = theirsJson;
      if (mineJson !== theirsJson) changed = true;
      return theirs;
    });
    prevTablesJsonRef.current = nextPrev;
    if (changed) setTables(() => nextTables); // skip the re-render when nothing moved
  };

  const selTable   = tables.find(t => t.id === sel);

  const upd = (id, f, v) => {
    setTables(p => p.map(t => t.id === id ? { ...t, [f]: typeof v === "function" ? v(t[f]) : v } : t));
  };
  // Batch multiple field updates in one setTables call (one render, one store save)
  const updMany = (id, changes) => {
    setTables(p => p.map(t => t.id === id ? { ...t, ...changes } : t));
  };

  /** Seat field update. Pass a function `v(prevField, seat)` to derive from latest state (fixes rapid-click flicker). */
  const updSeat = (tid, sid, f, v) => {
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
    setTables(p => p.map(t =>
    t.id !== tid ? t : { ...t, guests: n, seats: makeSeats(n, t.seats) }
  ));
  };

  const applySeatTemplateToAll = (tableId, sourceSeatId = 1) => {
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
    setTables(p => p.map(t =>
      !ids.includes(t.id) ? t : { ...t, active: true, arrivedAt: now, seats: makeSeats(t.guests, t.seats) }
    ));
    // Seating by hand completes a mid-terrace visit — SEAT is the universal
    // escape hatch, so no party state may survive it as a dangling badge:
    // - 'arriving' (MOVE tapped, MARK SEATED never was) → seated.
    // - 'terrace' → the party is physically at its dining table now; complete
    //   the move ourselves (single-tap semantics) and free + un-SET the
    //   terrace tile. Without this a terrace party seated by hand stayed
    //   "ON TERRACE" forever, ghost ticket on the kitchen board included.
    for (const tid of ids) {
      const owner = serviceReservations.find(r =>
        ["arriving", "terrace"].includes(visitStateOf(r.data)) &&
        reservationTableIds(r.data, r.table_id).includes(Number(tid)));
      if (!owner) continue;
      if (visitStateOf(owner.data) === "arriving") {
        persistVisitData(owner, markSeatedData(owner.data));
      } else {
        const label = owner.data?.terrace_table || null;
        if (persistVisitData(owner, moveToDiningData(owner.data, new Date().toISOString(), { singleTap: true }))) {
          clearTerraceStrip(label);
        }
      }
    }
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
    // If a reservation is templating this table for the live service, flag it
    // cleared so the board↔reservations reconcile doesn't immediately restore it
    // (the "cleared table comes back when I switch views / on the next poll"
    // bug). The booking row is kept for the planner/archive — just taken off the
    // live board. Editing the reservation later rebuilds its data and re-enables
    // it. The flag lives on the reservation so every device's reconcile honours it.
    if (serviceDate && (mode === "service" || mode === "display")) {
      const owner = reservationOnTable(id);
      if (owner && !owner.data?.clearedFromBoard) {
        // Close the terrace-flow visit too (the plan's dining → done arrow —
        // it was never wired): a cleared table must not leave a dangling
        // visit_state that keeps badges or kitchen tickets alive elsewhere.
        const closed = closeVisitData(owner.data) || owner.data;
        const nextData = { ...closed, clearedFromBoard: true };
        setReservations(prev => prev.map(r => r.id === owner.id ? { ...r, data: nextData } : r));
        persistReservationRow({ id: owner.id, date: owner.date, table_id: owner.table_id, data: nextData });
      }
    }
  };

  // Returns the active reservation (if any) whose primary or grouped table matches `tableId`
  // for the currently active service date + session. Used by table-change UI to surface
  // who currently owns a destination table.
  const reservationOnTable = (tableId) => {
    if (!serviceDate || !tableId) return null;
    return reservations.find(r => {
      if (r.date !== serviceDate) return false;
      if (r.data?.clearedFromBoard) return false; // cleared off the board → not occupying
      const sess = r.data?.service_session;
      const resolved = (sess === "lunch" || sess === "dinner")
        ? sess
        : ((r.data?.resTime || "") && r.data.resTime < "15:00" ? "lunch" : "dinner");
      if (resolved !== activeServiceSession) return false;
      return reservationTableIds(r.data, r.table_id).includes(Number(tableId));
    }) || null;
  };

  // ── Terrace flow — visit-state transitions (utils/terraceFlow, pure) ──────
  // All writes ride reservations.data through persistReservationRow (the
  // PowerSync-safe seam); SET markers ride updateFloorStatus. The
  // dining board is untouched by MOVE (no readiness handshake, no auto-ping).
  const persistVisitData = (resv, nextData) => {
    if (!nextData) return false;
    setReservations(prev => prev.map(r => r.id === resv.id ? { ...r, data: nextData } : r));
    if (supabase) {
      persistReservationRow({ id: resv.id, date: resv.date, table_id: resv.table_id, data: nextData })
        .catch(e => console.warn("Terrace flow persist failed:", e));
    }
    return true;
  };

  const assignTerraceTable = (resv, label) => {
    const terraceMapId = floorMapsState.maps.find(m => m.kind === "terrace")?.id || null;
    if (!persistVisitData(resv, assignTerraceData(resv.data, label, terraceMapId))) return;
    // A SET marker SURVIVES the assign: terrace tables are set FOR the
    // incoming party ("set for bites"), so the kitchen must keep seeing it
    // exactly when the party lands. It clears when the party leaves the
    // table (move-in / clear below) — the table needs re-prepping then.
  };

  // Clear the terrace table's SET strip when its party departs.
  const clearTerraceStrip = (label) => {
    const terraceMapId = getTerraceMap(floorMapsState)?.id || null;
    if (label && terraceMapId) updateFloorStatus(fs => setFloorStatus(fs, terraceMapId, label, null));
  };

  const clearTerracePartyTable = (resv) => {
    const label = resv.data?.terrace_table || null;
    // Where are the guests? A dessert-outside party's dining table is still
    // ACTIVE — the un-armed heal must land on 'dining' (still eating inside),
    // not 'booked' (would re-offer them in the ASSIGN PARTY picker).
    const seatedInside = reservationTableIds(resv.data, resv.table_id)
      .some(id => tablesRef.current?.find(t => t.id === Number(id))?.active);
    if (!persistVisitData(resv, clearTerraceData(resv.data, { seatedInside }))) return;
    clearTerraceStrip(label);
  };

  const moveTerracePartyIn = (resv) => {
    const label = resv.data?.terrace_table || null;
    const next = moveToDiningData(resv.data, new Date().toISOString(), {
      singleTap: !!floorMapsState.config?.moveSingleTap,
    });
    if (!persistVisitData(resv, next)) return;
    // the terrace table frees the moment the write lands (occupancy derives
    // from visit_state) — and its bites-SET clears with the departure
    if (next.visit_state === "dining" || next.visit_state === "arriving") clearTerraceStrip(label);
    if (next.visit_state === "dining") seatTable(Number(resv.table_id)); // MOVE_SINGLE_TAP path
  };

  const markTerracePartySeated = (resv) => {
    if (!persistVisitData(resv, markSeatedData(resv.data))) return;
    seatTable(Number(resv.table_id)); // full quick access lights up with the seat
  };

  // The day's reservations for the active session — the input set for terrace
  // occupancy, the ARRIVING board visuals, and layout re-resolution.
  const serviceReservations = useMemo(() => {
    if (!serviceDate) return [];
    return reservations.filter(r =>
      r.date === serviceDate && resolveReservationSession(r.data) === activeServiceSession);
  }, [reservations, serviceDate, activeServiceSession]);

  // MARK SEATED reached from a dining-table card (the arriving party's table).
  const markSeatedOnTable = (tableId) => {
    const owner = serviceReservations.find(r =>
      visitStateOf(r.data) === "arriving" && reservationTableIds(r.data, r.table_id).includes(Number(tableId)));
    if (owner) markTerracePartySeated(owner);
  };

  // ASSIGN TERRACE reached from a party's card → mini-map picker modal.
  // Booked parties (opening snacks) AND dining parties (dessert back out) —
  // only mid-transition states (terrace/arriving) are excluded.
  const requestTerraceAssign = (tableId) => {
    const owner = serviceReservations.find(r =>
      ["booked", "dining"].includes(visitStateOf(r.data)) && !r.data?.clearedFromBoard &&
      reservationTableIds(r.data, r.table_id).includes(Number(tableId)));
    if (owner) setTerraceAssignFor(owner);
  };

  // Apply a confirmed layout-switch diff: only 'move' rows are written
  // (conflicts and NEEDS TABLE rows stay untouched for the operator to fix).
  // Same seam as every reservation write — persistReservationRow.
  const applyLayoutSwitchRows = (rows) => {
    const moves = new Map((rows || []).filter(r => r.status === "move").map(r => [r.id, r]));
    if (!moves.size) return;
    const current = reservations.filter(r => moves.has(r.id));
    setReservations(prev => prev.map(r => {
      const next = moves.has(r.id) ? applyLayoutSwitchRow(moves.get(r.id), r) : null;
      return next || r;
    }));
    if (supabase) {
      current.forEach(r => {
        const next = applyLayoutSwitchRow(moves.get(r.id), r);
        if (next) {
          persistReservationRow({ id: next.id, date: next.date, table_id: next.table_id, data: next.data })
            .catch(e => console.warn("Layout switch persist failed:", e));
        }
      });
    }
  };

  // Kitchen sees terrace parties' tickets before the dining table is seated:
  // decorate the rows the same way the board is decorated (derived, never
  // persisted) so KitchenBoard can include them.
  const kitchenTables = useMemo(() => {
    const byTable = {};
    serviceReservations.forEach(r => {
      if (visitStateOf(r.data) !== "terrace") return;
      reservationTableIds(r.data, r.table_id).forEach(id => {
        byTable[id] = { visit: "terrace", terraceLabel: r.data?.terrace_table || null };
      });
    });
    return tables.map(t => (byTable[t.id] ? { ...t, _visit: byTable[t.id] } : t));
  }, [tables, serviceReservations]);

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
    setTables(prev => moveTableRows(prev, fromId, toId));
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
    setTables(prev => swapTableRows(prev, aId, bId));
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
    // repointReservation (utils/tableHelpers) remaps each reservation's
    // tableGroup alongside its table_id. Swapping only table_id left
    // data.tableGroup pointing at the OLD table — a table_id ↔ tableGroup
    // desync that made reservationTableIds/reconcile disagree about where the
    // booking sits, duplicating one guest and hiding the other.
    const { data: data1 } = repointReservation(r1, t1, t2);
    const { data: data2 } = repointReservation(r2, t1, t2);
    // Update r1's local state synchronously so the second upsert sees the new
    // table_id and skips the auto-move (avoids a redundant moveTableState call
    // that would fail-noop now that the swap above already happened).
    setReservations(prev => prev.map(r =>
      r.id === r1Id ? { ...r, table_id: t2, data: data1 }
        : r.id === r2Id ? { ...r, table_id: t1, data: data2 }
        : r
    ));
    const result = await persistReservationRows([
      { id: r1Id, date: r1.date, table_id: t2, data: data1 },
      { id: r2Id, date: r2.date, table_id: t1, data: data2 },
    ]);
    if (!result.ok) {
      // The batch did not commit, so restore the optimistic UI and table swap.
      setReservations(prev => prev.map(r =>
        r.id === r1Id ? r1 : r.id === r2Id ? r2 : r
      ));
      if (r1.date === serviceDate && (mode === "service" || mode === "display")) {
        swapTableState(t1, t2);
      }
      return { ok: false, reason: "persist-failed", error: result.error };
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
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (sessionError || !accessToken) {
        return { ok: false, error: "Your login expired. Sign in again and retry." };
      }
      const cfg = normalizeSyncConfig(syncConfigRef.current);
      const r = await fetch("/api/sync-wines", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ workspaceId: getWorkspaceId(), config: cfg }),
        signal: controller.signal,
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) {
        const base = json.error || `HTTP ${r.status}`;
        if (r.status === 401) return { ok: false, error: `${base} Sign in again and retry.` };
        return { ok: false, error: base };
      }
      // Refresh both catalogs the sync writes to. On the fallback path reload
      // them explicitly (no live transport); when the local DB is primary the
      // scrape's rows stream down and the watches repaint both lists.
      if (!sqlitePrimaryRef.current) await Promise.all([loadWines(), loadBeverages()]);
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
    const keptPositions = rows.map(r => r.position);
    const keptSet = new Set(keptPositions);
    // Diff against the STORE's current rows — NEVER against the live
    // menuCourses state. The course editor lifts every keystroke into that
    // state, so the save's input and the old baseline were the SAME array:
    // the diff always came up empty and every course save since the diff
    // refactor (c44819c) was a silent no-op that still reported ok. Reading
    // the store at save time keeps the property the diff exists for (two
    // devices editing DIFFERENT courses don't stomp each other) while making
    // the comparison honest. An unreadable store degrades to writing every
    // row — the pre-refactor behavior, safe via upsert.
    let prevJsonByPos = null;
    try {
      if (sqlitePrimaryRef.current) {
        const { readMenuCourses } = await import("./powersync/reads.js");
        const raw = await readMenuCourses();
        prevJsonByPos = new Map(raw.map(r => {
          const row = courseToSupabaseRow(supabaseRowToCourse(r));
          return [row.position, JSON.stringify(row)];
        }));
      } else {
        const stored = await fetchMenuCourses();
        if (stored) {
          prevJsonByPos = new Map(stored.map(c => {
            const row = courseToSupabaseRow(c);
            return [row.position, JSON.stringify(row)];
          }));
        }
      }
    } catch { /* store unreadable → write everything */ }
    const changedRows = prevJsonByPos
      ? rows.filter(r => prevJsonByPos.get(r.position) !== JSON.stringify(r))
      : rows;
    const removedAny = prevJsonByPos
      ? [...prevJsonByPos.keys()].some(p => !keptSet.has(p))
      : false;
    if (changedRows.length === 0 && !removedAny) {
      setMenuCourses(withKeys);
      menuCoursesDirtyRef.current = false; // draft matches the store again
      return { ok: true };
    }
    if (sqlitePrimaryRef.current) {
      try {
        const { writeMenuCourses } = await import("./powersync/writes.js");
        await writeMenuCourses(changedRows, removedAny ? keptPositions : null);
        setMenuCourses(withKeys);
        menuCoursesDirtyRef.current = false; // saved — watches may adopt again
        return { ok: true };
      } catch (error) {
        console.error("Menu save failed:", error);
        return { ok: false, error };
      }
    }
    // Fallback: go through scopedFrom so the row is workspace-stamped and the
    // upsert targets the composite PK (workspace_id, position). Hitting
    // supabase.from() directly with onConflict:"position" trips Postgres 42P10
    // — there is no unique constraint on position alone.
    let error = null;
    let isActiveSkipped = false;
    if (changedRows.length > 0) {
      ({ error } = await scopedFrom(TABLES.MENU_COURSES).upsert(changedRows));
      // Pre-migration fallback: if the is_active / is_last_bite columns haven't
      // been added yet, retry without them so the rest of the save still goes
      // through. The toggles won't persist until the schema migration is
      // applied, but new courses, edits, and reorders won't be lost.
      if (error && (error.code === "PGRST204" || /is_active|is_last_bite/i.test(String(error.message || "")))) {
        const fallbackRows = changedRows.map(({ is_active, is_last_bite, ...rest }) => rest);
        const retry = await scopedFrom(TABLES.MENU_COURSES).upsert(fallbackRows);
        error = retry.error;
        if (!error) {
          isActiveSkipped = true;
          console.warn("menu_courses.is_active column missing — saved without it. Run the schema migration to enable archiving.");
        }
      }
      if (error) { console.error("Menu save failed:", error); return { ok: false, error }; }
    }
    // Reflect any auto-generated keys back into local state so the UI shows them.
    setMenuCourses(withKeys);
    menuCoursesDirtyRef.current = false; // saved — the loaders may adopt again
    // Remove courses this user deleted
    if (removedAny) {
      let deleteQuery = scopedFrom(TABLES.MENU_COURSES).delete();
      if (keptPositions.length > 0) {
        deleteQuery = deleteQuery.not("position", "in", `(${keptPositions.join(",")})`);
      }
      const { error: deleteError } = await deleteQuery;
      if (deleteError) {
        console.error("Menu delete failed:", deleteError);
        return { ok: false, error: deleteError };
      }
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
    const savedKeys = new Set(rows.map(r => r.key));
    const originalKeys = wines.map(w => (typeof w.id === "string" ? w.id : null)).filter(Boolean);
    const deletedKeys = originalKeys.filter(k => !savedKeys.has(k));
    if (sqlitePrimaryRef.current) {
      try {
        const { writeWines, deleteWines } = await import("./powersync/writes.js");
        await writeWines(rows);
        await deleteWines(deletedKeys);
        return { ok: true };
      } catch (error) {
        console.error("Wine save error:", error);
        return { ok: false, error: error.message };
      }
    }
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await scopedFrom(TABLES.WINES).upsert(rows.slice(i, i + BATCH), { onConflict: "key" });
      if (error) {
        console.error("Wine save error:", error);
        return { ok: false, error: error.message };
      }
    }
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
    // Only categories whose list actually changed are rewritten (the write is
    // a replace-all within its category), so saving a cocktail edit can't
    // race another device's concurrent beer edit.
    const bevRows = (list, category) =>
      list.map((item, i) => ({ category, name: item.name, notes: item.notes || "", position: i, source: "manual" }));
    const sameList = (next, prev) =>
      JSON.stringify(next.map(x => [x.name, x.notes || ""])) === JSON.stringify(prev.map(x => [x.name, x.notes || ""]));
    const changed = [
      ...(sameList(newC, cocktails) ? [] : [{ category: "cocktail", rows: bevRows(newC, "cocktail") }]),
      ...(sameList(newS, spirits)   ? [] : [{ category: "spirit",   rows: bevRows(newS, "spirit") }]),
      ...(sameList(newB, beers)     ? [] : [{ category: "beer",     rows: bevRows(newB, "beer") }]),
    ];
    setCocktails(newC);
    setSpirits(newS);
    setBeers(newB);
    writeLocalBeverages({ cocktails: newC, spirits: newS, beers: newB });
    if (!supabase || changed.length === 0) return { ok: true };
    const categories = changed.map(c => c.category);
    const rows = changed.flatMap(c => c.rows);
    if (sqlitePrimaryRef.current) {
      try {
        const { replaceManualBeverages } = await import("./powersync/writes.js");
        await replaceManualBeverages(rows, categories);
        return { ok: true };
      } catch (error) {
        console.error("Beverage save error:", error);
        return { ok: false, error: error.message };
      }
    }
    const { error: delErr } = await scopedFrom(TABLES.BEVERAGES).delete().eq("source", "manual").in("category", categories);
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
    intentionalBoardClearRef.current = true; // user-confirmed whole-board clear
    setTables(Array.from({ length: 10 }, (_, i) => blankTable(i + 1)));
    setSel(null);
    setArchiveOpen(false);
  };

  // Load every non-deleted archive for a service day that shares the base label
  // (or one of its " · n" variants) — the input set for the dedup decision.
  const fetchSameDayArchives = async (archiveDate, archiveLabel) => {
    let rows;
    if (sqlitePrimaryRef.current) {
      const { readActiveArchivesForDate } = await import("./powersync/reads.js");
      rows = await readActiveArchivesForDate(archiveDate);
    } else {
      const { data } = await scopedFrom(TABLES.SERVICE_ARCHIVE)
        .select("id, label, state, created_at").eq("date", archiveDate).is("deleted_at", null);
      rows = data || [];
    }
    return rows.filter(e => isSameServiceLabel(e.label, archiveLabel));
  };

  // Archive + board clear + shared lifecycle clear are one store operation.
  // SQLite-primary devices commit one local transaction; the fallback calls
  // one Postgres function/transaction. This removes the old half-ended states
  // (archive saved but board/date clear failed, or board cleared before date).
  // `expected` carries the identity of the service being ended; the STORE
  // itself refuses the whole operation (superseded: true, nothing written)
  // when it no longer holds that service — the atomic backstop behind the
  // client-side serviceEndSuperseded pre-check below.
  const persistServiceEnd = useCallback(async ({ archive = null, expected = null }) => {
    try {
      const { rows, superseded } = await finishServiceStore({
        client: supabase,
        workspaceId: getWorkspaceId(),
        sqlitePrimary: sqlitePrimaryRef.current,
        archive,
        expected,
      });
      return { ok: !superseded, superseded, rows };
    } catch (error) {
      return { ok: false, error };
    }
  }, []);

  const applyFinishedServiceLocally = (rows) => {
    const blank = Array.from({ length: 10 }, (_, i) => blankTable(i + 1));
    const json = blank.map((table) => JSON.stringify(sanitizeTable(table)));
    intentionalBoardClearRef.current = true;
    pendingBoardWritesRef.current = new Set();
    prevTablesJsonRef.current = [...json];
    confirmedTablesJsonRef.current = [...json];
    tablesRef.current = blank;
    for (const row of rows || []) {
      const ts = Date.parse(row.updated_at || "");
      if (Number.isFinite(ts)) lastBoardWriteRef.current.set(Number(row.table_id), ts);
    }
    setTables(blank);
    // SET strips are hands-calls for THIS service — they must not greet the
    // next one. Local clear only: adopting devices never write; the ending
    // device persists the empty blob itself (see archive/auto-end paths).
    setFloorStatusState({});
    setServiceDate(null);
    setServiceDateChosenOn(null);
    serviceDateRef.current = null;
    serviceDateChosenOnRef.current = null;
    serviceStartedAtRef.current = null;
    try {
      localStorage.removeItem(workspaceKey("milka_service_date"));
      localStorage.removeItem(workspaceKey(SERVICE_DATE_CHOSEN_ON_KEY));
      localStorage.removeItem(workspaceKey("milka_service_started_at"));
    } catch {}
  };

  // The store-side finish (RPC / finishServiceLocally) blanks the board and
  // service_date UNCONDITIONALLY — it takes no service identity. So a device
  // that slept through "D1 ended, D2 started" and then taps Archive & Clear
  // for what it still shows as D1 would wipe D2's fresh board for everyone.
  // Before ending, confirm the store still holds THE SERVICE WE ARE ENDING;
  // if it moved on, adopt the store's reality instead of clearing it.
  // Read-then-act (not atomic — a true fix needs an identity-checked RPC),
  // but it shrinks the wipe window from hours to one round-trip. Store
  // unreachable → proceed (offline local-first reads its own local truth).
  const serviceEndSuperseded = async (expectedDate, expectedStartedAt) => {
    try {
      const live = await readStateKey("service_date");
      const liveDate = live?.date || null;
      const liveStartedAt = live?.startedAt || null;
      if (!liveDate) return { superseded: true, live: live || {} }; // already ended
      if (expectedDate && liveDate !== expectedDate) return { superseded: true, live };
      if (expectedStartedAt && liveStartedAt && liveStartedAt !== expectedStartedAt) {
        return { superseded: true, live };
      }
      return { superseded: false };
    } catch { return { superseded: false }; }
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
      const superseded = await serviceEndSuperseded(serviceDate, serviceStartedAtRef.current);
      if (superseded.superseded) {
        adoptServiceLifecycleRef.current?.(superseded.live, new Date().toISOString());
        setArchiveOpen(false);
        window.alert("This service was already ended (or a new one started) on another device — nothing was cleared. The board has been updated.");
        return;
      }
      const snap = boardStateRef.current; // stable reference, never stale
      // Stamp the archive with the service's actual date, not whatever today
      // happens to be — otherwise a service ended after midnight (or a stale
      // day) lands under the wrong date.
      const archiveDate = serviceDate || toLocalDateISO();
      const dateStr = new Date(archiveDate + "T00:00:00").toLocaleDateString("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric" });
      const archiveLabel = `${dateStr} – ${activeServiceSession.toUpperCase()}`;
      const activeTables = snap.tables.filter(t => t.active || t.arrivedAt || t.resName || t.resTime);
      let archive = null;
      if (supabase) {
        const startedAt = serviceStartedAtRef.current;
        const label = nextArchiveLabel(await fetchSameDayArchives(archiveDate, archiveLabel), archiveLabel);
        archive = {
          // Very old live services may predate the shared startedAt stamp.
          // Fall back to the service day/session so two tablets still choose
          // the same archive id instead of filing duplicate legacy entries.
          id: await archiveIdForService(
            getWorkspaceId(),
            startedAt || `${archiveDate}|${activeServiceSession}`,
          ),
          date: archiveDate,
          label,
          state: { ...snap, tables: activeTables, menuCourses, serviceSession: activeServiceSession, startedAt },
        };
      }
      const result = await persistServiceEnd({
        archive,
        // Identity of the service we believe we are ending — the store
        // refuses atomically if it has moved on (stale-device backstop).
        expected: { startedAt: serviceStartedAtRef.current || null, date: serviceDate || null },
      });
      if (result.superseded) {
        adoptServiceLifecycleRef.current?.((await readStateKey("service_date").catch(() => null)) || {}, new Date().toISOString());
        setArchiveOpen(false);
        window.alert("This service was already ended (or a new one started) on another device — nothing was cleared. The board has been updated.");
        return;
      }
      if (!result.ok) {
        window.alert("Service was not ended; the live board is unchanged. Please retry: " + (result.error?.message || result.error));
        return;
      }
      applyFinishedServiceLocally(result.rows);
      // Persist the strip wipe so the store's floor_status doesn't carry this
      // service's SET markers into the next one (adopters only clear locally).
      updateFloorStatus({});
      setSel(null);
      setArchiveOpen(false);
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
    let archive = null;
    try {
      // Read the night's state from the source of truth: local React state may
      // not have painted yet on a fresh load (or be blank on this device).
      const rows = await fetchBoardRows();

      // GUARD: never archive+clear a service that is LIVE right now. A board
      // whose SEATED tables (active / arrived / kitchen activity) were touched
      // within the current service day is an in-progress service running under a
      // mislabeled or rolled-over date — not an abandoned one. Auto-ending it
      // wiped a live dinner mid-service (the 04.07 incident). Re-date it forward
      // to today and KEEP the board; the genuine overnight case (last activity on
      // a past service day) still falls through to the archive+clear below.
      const seatedRows = (rows || []).filter(r => {
        const t = sanitizeTable({ id: Number(r.table_id), ...(r.data || {}) });
        return t.active || t.arrivedAt
          || (t.kitchenLog && Object.keys(t.kitchenLog).length > 0)
          || t.kitchenArchived;
      });
      const latestSeatedMs = seatedRows
        .map(r => new Date(r.updated_at).getTime())
        .filter(Number.isFinite)
        .reduce((a, b) => Math.max(a, b), -Infinity);
      if (seatedRows.length > 0 && isLiveServiceActivity(latestSeatedMs)) {
        const healDay = currentServiceDay();
        console.warn(
          `[auto-end] Live service detected under stale date ${staleDate} — re-dating to ${healDay} instead of clearing.`,
        );
        setServiceDate(healDay);
        setServiceDateChosenOn(healDay);
        serviceDateRef.current = healDay;
        serviceDateChosenOnRef.current = healDay;
        try {
          localStorage.setItem(workspaceKey("milka_service_date"), healDay);
          localStorage.setItem(workspaceKey(SERVICE_DATE_CHOSEN_ON_KEY), healDay);
        } catch {}
        await saveStateKey("service_date", {
          date: healDay, chosenOn: healDay,
          session: activeServiceSessionRef.current,
          startedAt: serviceStartedAtRef.current,
        });
        autoEndingRef.current = false;
        return;
      }

      const activeTables = (rows || [])
        .map(r => sanitizeTable({ id: Number(r.table_id), ...(r.data || {}) }))
        .filter(t => t.active || t.arrivedAt || t.resName || t.resTime)
        .sort((a, b) => a.id - b.id);

      if (activeTables.length > 0) {
        const dateStr = new Date(staleDate + "T00:00:00").toLocaleDateString("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric" });
        const label = `${dateStr} – ${(activeServiceSession || "dinner").toUpperCase()}`;
        const startedAt = serviceStartedAtRef.current;
        const label2 = nextArchiveLabel(await fetchSameDayArchives(staleDate, label), label);
        let courses = menuCourses;
        if (!courses || courses.length === 0) { try { courses = await fetchMenuCourses(); } catch { courses = []; } }
        archive = {
          id: await archiveIdForService(
            getWorkspaceId(),
            startedAt || `${staleDate}|${activeServiceSession || "dinner"}`,
          ),
          date: staleDate,
          label: label2,
          state: { tables: activeTables, cocktails, spirits, beers, menuCourses: courses || [], serviceSession: activeServiceSession || "dinner", startedAt, autoEnded: true },
        };
      }
    } catch (e) {
      // Archiving failed — do NOT clear, so the data is never lost. We retry on
      // the next load or interval tick.
      console.error("Auto-end archive failed; leaving service intact:", e);
      autoEndingRef.current = false;
      return;
    }

    // A late auto-end (device asleep through the real end + a fresh start)
    // must not blank the NEW service — the store-side clear is unconditional.
    const superseded = await serviceEndSuperseded(staleDate, serviceStartedAtRef.current);
    if (superseded.superseded) {
      console.warn("[auto-end] Store already ended/replaced this service — adopting instead of clearing.");
      adoptServiceLifecycleRef.current?.(superseded.live, new Date().toISOString());
      autoEndingRef.current = false;
      return;
    }

    const result = await persistServiceEnd({
      archive,
      expected: { startedAt: serviceStartedAtRef.current || null, date: staleDate || null },
    });
    if (result.superseded) {
      console.warn("[auto-end] Store refused the finish (service moved on) — adopting instead.");
      adoptServiceLifecycleRef.current?.((await readStateKey("service_date").catch(() => null)) || {}, new Date().toISOString());
      autoEndingRef.current = false;
      return;
    }
    if (!result.ok) {
      console.error("Auto-end transaction failed; leaving service visible:", result.error);
      autoEndingRef.current = false;
      return;
    }
    applyFinishedServiceLocally(result.rows);
    // The auto-ended service's SET markers must not survive into the next one.
    updateFloorStatus({});
    setSel(null);
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
      const rows = await fetchBoardRows();
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
        localStorage.setItem(workspaceKey("milka_service_date"), day);
        localStorage.setItem(workspaceKey(SERVICE_DATE_CHOSEN_ON_KEY), day);
      } catch {}
      await saveStateKey("service_date", { date: day, chosenOn: day });
    } catch (e) {
      console.warn("Orphaned-service heal skipped; leaving board intact:", e);
      return null;
    }
    return day;
  };

  // Board swaps exchange P-slot payloads. Floor drags instead change only the
  // guest's physical chair for that concrete map/table, keeping P1..P{pax}
  // stable when (for example) P2 moves to terrace chair 6.
  const swapSeats = (tid, aId, bId, floorKey = null) => {
    setTables(p => p.map(t => (t.id === tid
      ? (floorKey ? moveSeatOnFloor(t, aId, bId, floorKey) : swapSeatData(t, aId, bId))
      : t)));
  };

  const saveRes = (id, { tableIds, tableId, name, time, menuType, guests, guestType, room, rooms, birthday, cakeNote, restrictions, notes, lang }) => {
    const group = tableIds ?? (tableId ? [tableId] : [id]);
    const sortedGroup = [...group].sort((a, b) => a - b);
    setTables(p => p.map((t, _i, arr) => {
      // Old group read from p, not the render-scope tables: a regroup that
      // landed remotely after this form rendered must not make us blank the
      // wrong tables.
      const oldGroup = arr.find(x => x.id === id)?.tableGroup || [id];
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
    // Fresh instance id per (re)start so two services on the same day+session are
    // distinguishable in the archive.
    const startedAt = date ? new Date().toISOString() : null;
    if (supabase) {
      const result = await saveStateKey(
        "service_date",
        date ? { date, chosenOn, session: activeServiceSessionRef.current, startedAt } : {},
      );
      if (!result.ok) return result;
    }
    setServiceDate(date);
    setServiceDateChosenOn(chosenOn);
    serviceDateRef.current = date;
    serviceDateChosenOnRef.current = chosenOn;
    serviceStartedAtRef.current = startedAt;
    try {
      if (date) {
        localStorage.setItem(workspaceKey("milka_service_date"), date);
        localStorage.setItem(workspaceKey(SERVICE_DATE_CHOSEN_ON_KEY), chosenOn);
        if (startedAt) localStorage.setItem(workspaceKey("milka_service_started_at"), startedAt);
      } else {
        localStorage.removeItem(workspaceKey("milka_service_date"));
        localStorage.removeItem(workspaceKey(SERVICE_DATE_CHOSEN_ON_KEY));
        localStorage.removeItem(workspaceKey("milka_service_started_at"));
      }
    } catch {}
    // Wipe the board ONLY when switching between two real, different service
    // days. A device JOINING the current service (previousDate null — fresh
    // login, a second device, a re-login) must NOT clear: that blanks the
    // shared live board and the autosave then propagates the wipe to every
    // device. This was the "opened the board on the laptop and it wiped the
    // tablet" bug. A joining device keeps whatever it loaded from the store.
    if (shouldClearBoardOnDateChange(previousDate, date)) {
      intentionalBoardClearRef.current = true; // deliberate switch between two real service days
      setTables(Array.from({ length: 10 }, (_, i) => blankTable(i + 1)));
    }
    return { ok: true };
  };

  // ── Shared service lifecycle ────────────────────────────────────────────────
  // A service STARTED or ENDED on any device applies everywhere, live: the
  // service_date settings row is the shared truth, and every device adopts its
  // transitions from the watch / realtime feed. The adopting device NEVER
  // writes anything (no archive, no clears, no date persist) — the store is
  // already the new truth, which is what makes adoption wipe-proof (the 04.07
  // wipe class came from devices WRITING what they believed, not adopting).
  // Ordering is guarded by the row's updated_at; STALE dates never auto-adopt
  // (the boot/auto-end healing paths own those).
  const serviceLifecycleTsRef = useRef(0);
  const adoptServiceLifecycle = (st, rowUpdatedAt) => {
    const ts = Date.parse(rowUpdatedAt || "");
    if (Number.isFinite(ts)) {
      if (ts <= serviceLifecycleTsRef.current) return; // stale echo / replay
      serviceLifecycleTsRef.current = ts;
    }
    const state = st || {};
    // Session + start stamp travel on every lifecycle change (pre-existing
    // behavior — keeps board filters and archive dedup in step).
    if (state.session === "lunch" || state.session === "dinner") {
      setActiveServiceSession(state.session);
      activeServiceSessionRef.current = state.session;
      try { localStorage.setItem(workspaceKey("milka_service_session"), state.session); } catch {}
    }
    if (state.startedAt) {
      serviceStartedAtRef.current = state.startedAt;
      try { localStorage.setItem(workspaceKey("milka_service_started_at"), state.startedAt); } catch {}
    }
    const remoteDate = state.date || null;
    const localDate = serviceDateRef.current;
    if (remoteDate && remoteDate !== localDate) {
      // STARTED (or re-dated) on another device — adopt the live day.
      if (isStaleServiceDate(remoteDate) && !isActivePastReview(remoteDate, state.chosenOn)) return;
      setServiceDate(remoteDate);
      setServiceDateChosenOn(state.chosenOn || null);
      serviceDateRef.current = remoteDate;
      serviceDateChosenOnRef.current = state.chosenOn || null;
      try {
        localStorage.setItem(workspaceKey("milka_service_date"), remoteDate);
        if (state.chosenOn) localStorage.setItem(workspaceKey(SERVICE_DATE_CHOSEN_ON_KEY), state.chosenOn);
      } catch {}
      setShowServiceDatePicker(false); // a start prompt waiting here is moot now
    } else if (!remoteDate && localDate) {
      // ENDED on another device — end here too. The ending device already
      // archived and cleared the shared board; this device just releases the
      // date and leaves the live views (the 08.07 phone kept showing a dead
      // service all night because this adoption didn't exist).
      applyFinishedServiceLocally([]);
      setMode(prev => {
        if (prev !== "service" && prev !== "display") return prev;
        try { localStorage.removeItem(workspaceKey("milka_mode")); } catch { /* noop */ }
        return null;
      });
    }
  };
  // Ref indirection: the watch/channel handlers are bound once per
  // subscription, so they call through the ref to reach the latest closure.
  const adoptServiceLifecycleRef = useRef(adoptServiceLifecycle);
  adoptServiceLifecycleRef.current = adoptServiceLifecycle;

  const persistServiceSession = (session) => {
    setActiveServiceSession(session);
    activeServiceSessionRef.current = session;
    try { localStorage.setItem(workspaceKey("milka_service_session"), session); } catch {}
    // Share the session with every device on this workspace so their board
    // reconcile filters and archive labels match the live service. (It used to
    // live only in localStorage, so a second device kept its own default and
    // hid the running session's reservations.) Only attach it once a service
    // date is live — a session toggle with no service yet has nothing to share.
    if (!supabase) return;
    const date = serviceDateRef.current;
    if (!date) return;
    saveStateKey("service_date", { date, chosenOn: serviceDateChosenOnRef.current, session, startedAt: serviceStartedAtRef.current })
      .then((r) => { if (!r.ok) console.warn("Service session share failed:", r.error); });
  };

  // ── Reservations CRUD ─────────────────────────────────────────────────────
  // Push reservation edits to tables where service has ALREADY started. The
  // reconcile effect deliberately skips started tables to protect live
  // seats/orders/kitchen progress — but that also froze label-level fields
  // (a seated table switched to the SHORT menu never reached the kitchen) AND
  // the guest count (a booking corrected mid-service kept the old pax on the
  // live board all night). startedTablePatchFromReservation (pure, tested)
  // carries the descriptive fields, resizes guests/seats only when the count
  // actually changed, and keeps server-assigned restriction positions.
  // Grouping and kitchen log stay untouched.
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
      updMany(tid, startedTablePatchFromReservation(t, d));
    });
  };

  const upsertReservation = async ({ id, date, table_id, data: rData, _skipAutoMove = false }) => {
    // A reservation can never render without a date (the planner and the board
    // reconcile both key on it) and Postgres rejects NULL — three writes died
    // silently on 08.07. An EDIT arriving date-less simply omits the column so
    // the store's existing date survives; a NEW reservation is refused loudly.
    if (!id && !date) {
      console.error("[reservations] refusing to create a reservation without a date:", { table_id, data: rData });
      return { ok: false, error: new Error("reservation has no date") };
    }
    const dbRow = date ? { date, table_id, data: rData } : { table_id, data: rData };
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
        if (srcStarted) {
          const moved = moveTableState(prevTableId, nextTableId);
          if (!moved?.ok) {
            // Destination occupied: the live service could NOT follow the
            // reservation. Refusing the whole edit keeps one truth — writing
            // the new table_id anyway left the guest eating on the old table
            // while the reservation (and the started-table sync, which then
            // overwrote the destination guest's details) pointed at the new.
            if (typeof window !== "undefined") {
              window.alert(`Table move refused: T${nextTableId} is occupied. The reservation was not changed — clear or swap T${nextTableId} first.`);
            }
            return { ok: false, error: new Error(moved?.reason || "destination-occupied") };
          }
        }
      }
      const result = await persistReservationRow({ id, ...dbRow });
      if (result.ok) {
        setReservations(prev => prev.map(r => r.id === id ? { ...r, ...dbRow } : r));
        syncStartedTablesFromReservation(date, rData, Number(table_id));
      }
      return { ok: result.ok, error: result.error };
    }
    // New reservation: mint the uuid client-side so the local write, the
    // uploaded row, and the optimistic React state all share one identity.
    const local = { ...dbRow, id: randomUuid(), created_at: new Date().toISOString() };
    if (supabase) {
      let inserted = local;
      if (sqlitePrimaryRef.current) {
        try {
          const { writeReservation } = await import("./powersync/writes.js");
          await writeReservation(local);
        } catch (error) {
          console.warn("Reservation insert failed:", error);
          return { ok: false, error };
        }
      } else {
        const { data, error } = await scopedFrom(TABLES.RESERVATIONS).insert(local).select().single();
        if (error) {
          console.warn("Reservation insert failed:", error);
          return { ok: false, error };
        }
        inserted = data;
      }
      setReservations(prev => [...prev, inserted]);
      syncStartedTablesFromReservation(date, rData, Number(table_id));
      return { ok: true, data: inserted };
    }
    setReservations(prev => [...prev, local]);
    syncStartedTablesFromReservation(date, rData, Number(table_id));
    return { ok: true, data: local };
  };

  const deleteReservation = async (id) => {
    if (!supabase) {
      setReservations(prev => prev.filter(r => r.id !== id));
      return { ok: true };
    }
    try {
      if (sqlitePrimaryRef.current) {
        const { deleteReservationRow } = await import("./powersync/writes.js");
        await deleteReservationRow(id);
      } else {
        const { error } = await scopedFrom(TABLES.RESERVATIONS).delete().eq("id", id);
        if (error) throw error;
      }
      setReservations(prev => prev.filter(r => r.id !== id));
      return { ok: true };
    } catch (error) {
      console.warn("Reservation delete failed:", error);
      return { ok: false, error };
    }
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
    const target = reservationsRef.current.find(r => r.id === resvId);
    if (target && supabase && getWorkspaceId()) {
      const newData = { ...(target.data || {}), [field]: value };
      persistReservationRow({ id: resvId, date: target.date, table_id: target.table_id, data: newData });
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
      if (nextMode) localStorage.setItem(workspaceKey("milka_mode"), nextMode);
      else          localStorage.removeItem(workspaceKey("milka_mode"));
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
        const state = await readStateKey("service_date");
        const entry = resolveServiceEntry(state);
        if (entry.action === "join") {
          // setServiceDate directly (NOT persistServiceDate) so joining never
          // clears the board or rewrites the date — just adopt the live one.
          setServiceDate(entry.date);
          setServiceDateChosenOn(entry.chosenOn);
          serviceStartedAtRef.current = entry.startedAt || serviceStartedAtRef.current;
          // Adopt the LIVE session so this device filters the board to the same
          // session the service is actually running (not its own local default).
          if (entry.session === "lunch" || entry.session === "dinner") {
            setActiveServiceSession(entry.session);
            activeServiceSessionRef.current = entry.session;
          }
          try {
            localStorage.setItem(workspaceKey("milka_service_date"), entry.date);
            if (entry.chosenOn) localStorage.setItem(workspaceKey(SERVICE_DATE_CHOSEN_ON_KEY), entry.chosenOn);
            if (entry.startedAt) localStorage.setItem(workspaceKey("milka_service_started_at"), entry.startedAt);
            if (entry.session === "lunch" || entry.session === "dinner") localStorage.setItem(workspaceKey("milka_service_session"), entry.session);
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
    // hasn't seen the store's state treats every live table as "not started"
    // and rebuilds/blanks it — then the autosave broadcasts the wipe.
    if (!reservationsLoaded || !remoteBoardLoaded) return;
    if ((mode !== "service" && mode !== "display") || !serviceDate) return;
    reconcileBoardWithReservations(reservations.filter(r => {
      if (r.date !== serviceDate) return false;
      // A table cleared off the live board stays cleared — don't re-template it.
      if (r.data?.clearedFromBoard) return false;
      return resolveReservationSession(r.data) === activeServiceSession;
    }));
  }, [reservations, serviceDate, mode, reservationsLoaded, remoteBoardLoaded, boardSyncTick, activeServiceSession]); // eslint-disable-line react-hooks/exhaustive-deps

  const switchMode = () => { changeMode(null); setSel(null); };

  // Escape = back. The hook stacks handlers so the most recently enabled
  // one fires first: detail closes before mode exits.
  useModalEscape(() => changeMode(null), !!mode);
  useModalEscape(() => setSel(null), !!sel);
  useModalEscape(() => setAddResOpen(false), addResOpen);

  // ── Self-heal stale SET banners ──────────────────────────────────────────────
  // courseReady snapshots {key,index,name} at SET time and fire() clears it
  // only on an EXACT key match — a menu edit/renumber mid-service mints new
  // course keys, leaving the kitchen's "SET FOR …" banner and the sheet's
  // SET lock stuck with no kitchen-side dismiss. Null any courseReady whose
  // key is no longer among the table's visible courses; the write rides the
  // normal autosave so every device converges. Gated on a LOADED menu and a
  // non-empty per-table visible list — transient emptiness never judges.
  useEffect(() => {
    if ((mode !== "service" && mode !== "display") || !activeMenuCourses.length) return;
    tables.forEach(t => {
      if (!t.courseReady?.key) return;
      const visible = getVisibleCoursesForTable(t, activeMenuCourses, {
        profiles: profilesState.profiles, assignments: profilesState.assignments,
      });
      if (visible.length && isStaleCourseReady(t, visible)) upd(t.id, "courseReady", null);
    });
  }, [activeMenuCourses, tablesJson, mode, profilesState]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── SET strips follow the course they announced ─────────────────────────────
  // A floor SET marker means "this table is set for the course we sent". The
  // moment that course goes out (fire() resolves courseReady), the strip must
  // drop by itself — it used to persist until someone manually un-tapped it,
  // and even across services. Transition-detected on whichever device observes
  // courseReady resolve (the firing kitchen sees its own write immediately);
  // the cleared blob syncs through FLOOR_STATUS_KEY like every strip write.
  const prevReadyKeysRef = useRef(null);
  // Clears queue until the floor-status blob has hydrated: judging against the
  // boot-empty {} would consume the transition without writing anything, and
  // the strip would survive after all. Local-only mode has nothing to wait for.
  const floorStatusHydratedRef = useRef(!supabase);
  const pendingStripClearsRef = useRef([]);
  useEffect(() => {
    const prev = prevReadyKeysRef.current;
    const cur = {};
    tables.forEach(t => { cur[t.id] = t.courseReady?.key || null; });
    prevReadyKeysRef.current = cur;
    if (prev) {
      tables.forEach(t => {
        if (prev[t.id] && !cur[t.id]) {
          pendingStripClearsRef.current.push(...(t.tableGroup?.length ? t.tableGroup : [t.id]));
        }
      });
    }
    if (!floorStatusHydratedRef.current || !pendingStripClearsRef.current.length) return;
    const ids = pendingStripClearsRef.current;
    pendingStripClearsRef.current = [];
    updateFloorStatus(fs => clearStripsForBoardGroup(fs, floorMapsState, serviceReservations, ids));
  }, [tablesJson, floorStatus, floorMapsState, serviceReservations]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fire-to-clear terrace (course-flagged) ──────────────────────────────────
  // A course flagged is_last_bite ("clears terrace when fired", set per course
  // in Admin → Courses) going out of the kitchen means the terrace party is
  // walking in: the fire auto-runs the same MOVE the terrace sheet button does
  // — visit → arriving, the terrace tile frees for the next seating, and its
  // SET strip clears. Transition-detected (the FIRE event, not the state), so
  // a dessert-outside party whose flagged course fired long ago is never
  // yanked back inside.
  const prevFlaggedFiredRef = useRef(null);
  useEffect(() => {
    const flagged = new Set(
      (activeMenuCourses || [])
        .filter(c => c.is_last_bite && String(c.course_key || "").trim())
        .map(c => c.course_key),
    );
    const cur = {};
    tables.forEach(t => {
      cur[t.id] = Object.keys(t.kitchenLog || {})
        .filter(k => flagged.has(k) && t.kitchenLog[k]?.firedAt)
        .sort().join(",");
    });
    const prev = prevFlaggedFiredRef.current;
    prevFlaggedFiredRef.current = cur;
    if (!prev) return; // first observation — no fires to judge yet
    if (mode !== "service" && mode !== "display") return;
    const newlyFired = tables.filter(t => cur[t.id] && cur[t.id] !== (prev[t.id] ?? ""));
    if (!newlyFired.length) return;
    serviceReservations.forEach(r => {
      if (visitStateOf(r.data) !== "terrace") return;
      const ids = reservationTableIds(r.data, r.table_id).map(Number);
      if (newlyFired.some(t => ids.includes(Number(t.id)))) moveTerracePartyIn(r);
    });
  }, [tablesJson, activeMenuCourses, serviceReservations, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Autosave: write changed board rows to the store ─────────────────────────
  // Diffs the sanitized tables against the last-written baseline and writes
  // ONLY the changed rows — to local SQLite when primary (instant, offline-safe,
  // uploaded by the connector's retry queue), or directly to Supabase on the
  // fallback path. Changed table_ids accumulate in pendingBoardWritesRef across
  // debounce ticks so two edits inside one window can't drop each other; the
  // flush derives each row from current state at send time.
  useEffect(() => {
    // Demo mode: the device-local snapshot IS the persistence.
    if (!supabase) { writeLocalDemoBoard(tables); return; }
    // Never push table rows before the board truth has loaded: the diff would
    // run against the blank boot state and overwrite a live service.
    if (!remoteBoardLoaded) return;

    const prevJson = prevTablesJsonRef.current;
    const nextJson = tables.map(t => JSON.stringify(sanitizeTable(t)));

    // Defense-in-depth mass-blank guard: refuse to persist a blank of 2+ tables
    // that HELD service content unless a legitimate whole-board clear flagged it.
    // Even an unexpected trigger (a stale-board reconcile, a rogue effect) can't
    // push a live-service wipe to the store and other devices — it's restored
    // locally instead. Single-table changes and flagged clears pass through.
    // (Predicate extracted to utils/tableHelpers for unit coverage — the
    // refusal branch is unreachable through honest UI vectors by design.)
    const emptiedIdx = massBlankedIndices(prevJson, tables, nextJson);
    if (emptiedIdx.length >= 2 && !intentionalBoardClearRef.current) {
      console.error(
        "[board-guard] Refused to blank live tables", emptiedIdx.map(i => tables[i].id),
        "— an unexpected mass-blank was prevented from reaching the store; restoring from last good state.",
      );
      setTables(cur => cur.map((t, idx) => {
        if (!emptiedIdx.includes(idx)) return t;
        try { return sanitizeTable(JSON.parse(prevJson[idx])); } catch { return t; }
      }));
      return; // baseline NOT advanced; the restore re-runs this effect cleanly
    }
    intentionalBoardClearRef.current = false; // consumed once per autosave pass

    tables.forEach((table, idx) => {
      if (nextJson[idx] === prevJson[idx]) return; // untouched
      pendingBoardWritesRef.current.add(table.id);
    });
    prevTablesJsonRef.current = nextJson;
    if (pendingBoardWritesRef.current.size === 0) return;

    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(flushBoardWrites, 50);

    return () => clearTimeout(saveTimerRef.current);
  }, [tablesJson, remoteBoardLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drain: retry unconfirmed board writes without needing another edit ──────
  // Failed flushes leave their table_ids in pendingBoardWritesRef; before this
  // they were only retried when the NEXT local edit re-ran the autosave — on a
  // laggy network a fired dish could sit unsaved indefinitely while refetches
  // kept threatening it. A slow heartbeat plus the browser's own network-back
  // signal re-drains the set as soon as writes can land again.
  useEffect(() => {
    if (!supabase || !remoteBoardLoaded) return undefined;
    const drain = () => { if (pendingBoardWritesRef.current.size > 0) flushBoardWrites(); };
    const heartbeat = setInterval(drain, 15000);
    window.addEventListener("online", drain);
    return () => {
      clearInterval(heartbeat);
      window.removeEventListener("online", drain);
    };
  }, [remoteBoardLoaded, flushBoardWrites]);


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
    if (!workspaceId || !psResolved) return () => { cancelled = true; }; // wait for the workspace + store to resolve
    withRetry(() => readStateKey("menu_logo"))
      .then(state => {
        if (cancelled) return;
        const uri = state?.dataUri;
        if (uri) { setLogoDataUri(uri); writeLocalLogo(uri); }
        else loadDefault();
      })
      .catch(() => loadDefault()); // keep the cached logo on failure
    return () => { cancelled = true; };
  }, [workspaceId, psResolved]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveLogo = async (dataUri) => {
    setLogoDataUri(dataUri);
    writeLocalLogo(dataUri); // keep the device cache in step so it paints instantly next launch
    await saveStateKey("menu_logo", { dataUri });
  };

  useEffect(() => {
    try { localStorage.setItem(workspaceKey(SYNC_CONFIG_KEY), JSON.stringify(wineSyncConfig)); } catch {}
  }, [wineSyncConfig]);

  useEffect(() => {
    if (!supabase || !psResolved) return;
    withRetry(() => readStateKey("wine_sync_config"))
      .then(state => { if (state) setWineSyncConfig(normalizeSyncConfig(state)); })
      .catch(() => {}); // localStorage-hydrated config stays in place
  }, [psResolved]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveWineSyncConfig = async () => {
    const next = normalizeSyncConfig(wineSyncConfig);
    setWineSyncConfig(next);
    await saveStateKey("wine_sync_config", next);
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
    await saveStateKey("menu_layout_profiles_v2", payload);
  }, [saveStateKey]);

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
    if (!psResolved) return;
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
        const v2 = await withRetry(() => readStateKey("menu_layout_profiles_v2"));
        if (v2 && Array.isArray(v2.profiles) && v2.profiles.length > 0) {
          if (cancelled) return;
          adoptRemote(sanitizeProfilesPayload(v2));
          profilesLoaded.current = true;
          setProfilesReadStatus("ready");
          return;
        }
        const v1State = await readStateKey("menu_layout_profiles_v1");
        if (v1State?.profiles?.length) {
          if (cancelled) return;
          const migrated = sanitizeProfilesPayload(migrateV1ToV2(v1State));
          adoptRemote(migrated);
          persistProfilesPayload(migrated);
          profilesLoaded.current = true;
          setProfilesReadStatus("ready");
          return;
        }
        const [legacyLayoutState, legacyTemplateState] = await Promise.all([
          readStateKey("menu_layout_global"),
          readStateKey("menu_layout_v2"),
        ]);
        const legacyLayout = (legacyLayoutState && typeof legacyLayoutState === "object") ? legacyLayoutState : {};
        const legacyTemplate = (legacyTemplateState?.version === 2 && Array.isArray(legacyTemplateState.rows)) ? legacyTemplateState : null;
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
  }, [persistProfilesPayload, psResolved]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!supabase || !workspaceId || !psResolved) return;
    let cancelled = false;

    // Instant paint from cache + mirror restrictions into the dietary module so
    // every importer sees the cached values immediately.
    const cachedR = readLocalRestrictions();
    if (cachedR && cachedR.length) { setRestrictionsList(cachedR); setRestrictionsCache(cachedR); }
    const cachedN = readLocalCourseNotes();
    if (cachedN) setCourseQuickNotes(cachedN);

    (async () => {
      try {
        const [rState, nState] = await withRetry(() => Promise.all([
          readStateKey("restrictions"),
          readStateKey("course_quick_notes"),
        ]));
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
  }, [workspaceId, psResolved]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveRestrictions = useCallback(async (next) => {
    const list = Array.isArray(next) ? next : [];
    setRestrictionsList(list);
    setRestrictionsCache(list);
    writeLocalRestrictions(list);
    return saveStateKey("restrictions", { restrictions: list });
  }, [saveStateKey]);

  // ── Kitchen ticket order: the expediter's drag order, shared + persistent ──
  const [kitchenTicketOrder, setKitchenTicketOrder] = useState(null);
  useEffect(() => {
    if (!supabase || !workspaceId || !psResolved) return;
    let cancelled = false;
    readStateKey("kitchen_ticket_order")
      .then((state) => {
        if (cancelled) return;
        const ids = state?.ids;
        if (Array.isArray(ids)) setKitchenTicketOrder(ids.map(Number).filter(Number.isFinite));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [workspaceId, psResolved]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveKitchenTicketOrder = useCallback(async (ids) => {
    const clean = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isFinite);
    setKitchenTicketOrder(clean);
    await saveStateKey("kitchen_ticket_order", { ids: clean });
  }, [saveStateKey]);

  const saveCourseQuickNotes = useCallback(async (next) => {
    const map = next && typeof next === "object" ? next : {};
    setCourseQuickNotes(map);
    writeLocalCourseNotes(map);
    return saveStateKey("course_quick_notes", map);
  }, [saveStateKey]);

  // (Template & layout edits auto-persist through updateProfiles — no manual
  // save button or save-state needed.)

  // ── Menu generation rules (layout behavior) ───────────────────────────────
  useEffect(() => {
    try { localStorage.setItem(workspaceKey("milka_menu_rules"), JSON.stringify(menuRules)); } catch {}
  }, [menuRules]);

  useEffect(() => {
    if (!supabase || !psResolved) return;
    withRetry(() => readStateKey("menu_gen_rules"))
      .then(state => {
        if (state && typeof state === "object") {
          setMenuRules(normalizeMenuRules(state));
          try { localStorage.setItem(workspaceKey("milka_menu_rules"), JSON.stringify(state)); } catch {}
        }
      })
      .catch(() => {}); // localStorage-hydrated rules stay in place
  }, [psResolved]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const { ok } = await saveStateKey("menu_gen_rules", menuRulesRef.current);
      if (!ok) {
        setMenuRulesSaving(false);
        return;
      }
    }
    setMenuRulesSaving(false);
    setMenuRulesSaved(true);
    setTimeout(() => setMenuRulesSaved(false), 2500);
  };


  // ── Floor maps + terrace state persistence ───────────────────────────────
  // Both live in service_settings rows behind the stateStore seam (SQLite
  // when primary, scopedFrom fallback otherwise) — queue-safe offline, same
  // as every other settings blob. Terrace occupancy itself is derived from
  // reservations; only the map definitions and SET markers persist here.
  useEffect(() => {
    // workspaceId is part of the gate (and deps): keyed on psResolved alone
    // this ran before the workspace was applied on a fresh login, read null
    // and never retried — maps and strips silently stayed at defaults.
    if (!supabase || !workspaceId || !psResolved) return;
    withRetry(() => Promise.all([
      readStateKey(FLOOR_MAPS_KEY),
      readStateKey(FLOOR_STATUS_KEY),
    ]))
      .then(([fm, fs]) => {
        const maps = fm ? sanitizeFloorMaps(fm) : floorMapsState;
        if (fm) setFloorMapsState(maps);
        // sanitize drops legacy DIRTY values (feature removed); prune heals
        // strips already orphaned in the store by an old map edit — ADOPT
        // only, never written back at boot (a loading device must not write).
        setFloorStatusState(pruneFloorStatus(fs, maps));
        // The strip-follows-courseReady watcher may hold clears queued from
        // before this blob arrived — it can trust local state from here on.
        floorStatusHydratedRef.current = true;
      })
      .catch(() => {});
  }, [workspaceId, psResolved]); // eslint-disable-line react-hooks/exhaustive-deps

  // Always-current mirrors of the two floor blobs + the time of this device's
  // last local write. Two reasons: (1) writers used to compute the next blob
  // from the RENDER-scope value — two taps in the same render window (or a
  // remote adoption in between) made the second write silently erase the
  // first (whole-blob replace, no fold); every writer now derives from the
  // ref via an updater. (2) The write timestamp lets the live adoption below
  // drop stale echoes of our own writes (same 60s window as the board's
  // lastBoardWriteRef).
  const floorStatusRef = useRef(floorStatus);
  floorStatusRef.current = floorStatus;
  const floorMapsRef = useRef(floorMapsState);
  floorMapsRef.current = floorMapsState;
  const floorStatusWriteTsRef = useRef(0);
  const floorMapsWriteTsRef = useRef(0);

  const updateFloorMaps = (next) => {
    const s = sanitizeFloorMaps(typeof next === "function" ? next(floorMapsRef.current) : next);
    floorMapsRef.current = s;
    floorMapsWriteTsRef.current = Date.now();
    setFloorMapsState(s);
    if (supabase) saveStateKey(FLOOR_MAPS_KEY, s).catch?.(() => {});
    // A map edit (rename/delete/re-add) can orphan SET strips — and addTable
    // re-mints freed labels, so a stale strip would resurrect on the next
    // table with that name and reach the kitchen as a phantom SET. The
    // EDITING device prunes and persists the cleaned strips.
    updateFloorStatus(fs => pruneFloorStatus(fs, s));
    return s;
  };

  // Accepts a value OR an updater(prev). Prefer the updater: it reads the
  // ref (current even mid-render-window), so SET toggles from two surfaces
  // in quick succession compose instead of the later one erasing the earlier.
  // A no-op result skips the persist entirely.
  const updateFloorStatus = (next) => {
    const s = sanitizeFloorStatus(typeof next === "function" ? next(floorStatusRef.current) : next);
    if (JSON.stringify(s) === JSON.stringify(sanitizeFloorStatus(floorStatusRef.current))) return s;
    floorStatusRef.current = s;
    floorStatusWriteTsRef.current = Date.now();
    setFloorStatusState(s);
    if (supabase) saveStateKey(FLOOR_STATUS_KEY, s).catch?.(() => {});
    return s;
  };

  // Live adoption of the floor blobs from other devices (adopt-only — never
  // writes back). Until 11.07 these two keys were read ONCE at boot and never
  // again: a SET marker tapped on one tablet reached the store but no other
  // device until its next full reload — despite comments claiming otherwise.
  // The 60s-window echo guard mirrors adoptRemoteTables' stale-echo rule: an
  // incoming copy older than what this device just wrote is a late echo of a
  // superseded blob, not news.
  const adoptFloorStatus = (state, updatedAt) => {
    if (state == null) return;
    const incoming = Date.parse(updatedAt || "") || 0;
    if (floorStatusWriteTsRef.current && Date.now() - floorStatusWriteTsRef.current < 60000
      && incoming && incoming < floorStatusWriteTsRef.current) return;
    const s = sanitizeFloorStatus(state);
    if (JSON.stringify(s) === JSON.stringify(sanitizeFloorStatus(floorStatusRef.current))) return;
    floorStatusRef.current = s;
    setFloorStatusState(s);
  };
  const adoptFloorMaps = (state, updatedAt) => {
    if (state == null) return;
    const incoming = Date.parse(updatedAt || "") || 0;
    if (floorMapsWriteTsRef.current && Date.now() - floorMapsWriteTsRef.current < 60000
      && incoming && incoming < floorMapsWriteTsRef.current) return;
    const s = sanitizeFloorMaps(state);
    if (JSON.stringify(s) === JSON.stringify(floorMapsRef.current)) return;
    floorMapsRef.current = s;
    setFloorMapsState(s);
  };
  const adoptFloorStatusRef = useRef(null);
  adoptFloorStatusRef.current = adoptFloorStatus;
  const adoptFloorMapsRef = useRef(null);
  adoptFloorMapsRef.current = adoptFloorMaps;

  // ── Quick Access persistence ──────────────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem(workspaceKey("milka_quick_access"), JSON.stringify(quickAccessItems)); } catch {}
  }, [quickAccessItems]);

  useEffect(() => {
    if (!supabase || !psResolved) return;
    withRetry(() => readStateKey("quick_access"))
      .then(state => { if (state?.items?.length) setQuickAccessItems(state.items); })
      .catch(() => {}); // localStorage-hydrated quick access stays in place
  }, [psResolved]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateQuickAccess = (items) => {
    setQuickAccessItems(items);
    saveStateKey("quick_access", { items });
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

  // ── Board truth: direct-Supabase outage/disabled fallback ──────────────────
  // When the local SQLite DB is primary, the watches effect below owns the
  // board (its first fire seeds it and flips the gates). This fallback covers
  // a one-shot load plus a slow poll and a refetch on wake / network return.
  // Live updates come from the Supabase realtime channels below, which refetch
  // through fallbackBoardReloadRef on every service_tables event.
  const fallbackBoardReloadRef = useRef(null);
  // Fallback planner reload (set by the reservations load effect) — the
  // realtime catch-up path re-runs it after every reconnect.
  const reloadReservationsRef = useRef(null);
  useEffect(() => {
    if (!supabase || !workspaceId || !psResolved || sqlitePrimary) return;
    let isMounted = true;

    const loadRemoteTables = async () => {
      const { data, error } = await scopedFrom(TABLES.SERVICE_TABLES)
        .select("table_id, data, updated_at")
        .order("table_id", { ascending: true });

      if (!isMounted) return;

      if (error) {
        // Do NOT mark the board as loaded: without the source of truth,
        // reconcile/saves stay disabled. The poll and the visibilitychange
        // refetch keep retrying and flip the gate on the first success.
        setSyncStatus("sync-error");
        noteSyncError("board load (fallback)", error);
        return;
      }

      if (Array.isArray(data) && data.length > 0) adoptRemoteTables(data);

      setSyncStatus("live");
      // Board truth is in: unlock the reconciliation effect and table saves,
      // and signal the reconcile effect to run against the fresh data.
      setRemoteBoardLoaded(true);
      setBoardSyncTick(t => t + 1);
    };

    loadRemoteTables();
    fallbackBoardReloadRef.current = loadRemoteTables;

    const pollInterval = setInterval(() => { if (isMounted) loadRemoteTables(); }, 60000);
    const refetchOnWake = () => { if (!document.hidden && isMounted) loadRemoteTables(); };
    document.addEventListener("visibilitychange", refetchOnWake);
    window.addEventListener("online", refetchOnWake);

    return () => {
      isMounted = false;
      fallbackBoardReloadRef.current = null;
      clearInterval(pollInterval);
      document.removeEventListener("visibilitychange", refetchOnWake);
      window.removeEventListener("online", refetchOnWake);
    };
  }, [workspaceId, psResolved, sqlitePrimary]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── PowerSync: connect + stream into the on-device SQLite DB ─────────────────
  // Loaded ENTIRELY via dynamic import() so the SDK + wa-sqlite WASM stay out
  // of the initial bundle. onStatus drives the header sync chip and the
  // sqlite-primary probe; the watches below drive every read once primary.
  const [powerSyncStatus, setPowerSyncStatus] = useState(null);
  // Init retry counter: bumping it re-runs the connect effect. A failed init
  // (the SDK chunk not fetching over a dying link at boot — the wifi-extender
  // incident) used to pin the session to the fragile direct-Supabase fallback
  // until a full reload; now it retries with capped backoff and on the
  // browser's network-back signal. The sqlite-primary probe below re-runs on
  // each status change, so a late successful init still flips the device to
  // the offline-safe path mid-session.
  const [psInitAttempt, setPsInitAttempt] = useState(0);
  useEffect(() => {
    if (!psEnabled) { setPowerSyncStatus(null); return undefined; }
    let cleanup;
    let cancelled = false;
    let retryTimer;
    const retryNow = () => setPsInitAttempt(a => a + 1);
    (async () => {
      try {
        const { connect } = await import("./powersync/system.js");
        const disconnect = await connect((snap) => {
          if (cancelled) return;
          setPowerSyncStatus(snap);
        });
        if (cancelled) { await disconnect?.(); return; }
        cleanup = disconnect;
      } catch (e) {
        console.warn(`[PowerSync] init failed (attempt ${psInitAttempt + 1}) — using the direct-Supabase fallback:`, e);
        if (cancelled) return;
        setPsResolved(true); // unblock the fallback loaders
        // 5s → 10s → 20s → 40s → 80s, then only the 'online' signal retries.
        // The retry listeners are registered ONLY on failure, so a healthy
        // connect can never be double-initialised by them.
        if (psInitAttempt < 5) {
          retryTimer = setTimeout(retryNow, 5000 * 2 ** psInitAttempt);
        }
        window.addEventListener("online", retryNow, { once: true });
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      window.removeEventListener("online", retryNow);
      cleanup?.();
    };
  }, [psEnabled, workspaceId, psInitAttempt]);

  // ── sqlite-primary probe ─────────────────────────────────────────────────────
  // Flip to primary once the priority-1 first sync is in. Membership has already
  // been verified, so zero rows is a legitimate empty restaurant. A boot
  // deadline resolves to the fallback when PowerSync stays unusable due to an
  // init failure or a fresh device with no network.
  // Once primary, stays primary for the session: local data doesn't vanish
  // when the stream drops.
  useEffect(() => {
    if (!psEnabled) { setSqlitePrimaryFlag(false); setSqlitePrimary(false); setPsResolved(true); return undefined; }
    if (sqlitePrimary) return undefined;
    const deadline = setTimeout(() => setPsResolved(true), 4000);
    if (powerSyncStatus?.hasSyncedP1) {
      setSqlitePrimaryFlag(true);
      setSqlitePrimary(true);
      setPsResolved(true);
    }
    return () => clearTimeout(deadline);
  }, [psEnabled, workspaceId, sqlitePrimary, powerSyncStatus?.hasSyncedP1, powerSyncStatus?.lastSyncedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Connection-status chip ───────────────────────────────────────────────────
  // Primary path: the PowerSync stream is the transport. Local SQLite keeps
  // serving reads/writes during a drop, so the chip only falls back to
  // "connecting" after the stream has been down for a grace period — a token
  // refresh or an idle-socket blip never flips the UI. On the fallback path the
  // direct loads/saves own the chip ("live" / "sync-error").
  const anyTransportUp = Boolean(powerSyncStatus?.connected);
  useEffect(() => {
    if (!hasSupabaseConfig || !sqlitePrimary) return undefined;
    if (anyTransportUp) {
      // On the LOCAL-FIRST path a connected stream with no upload/download
      // error IS healthy — clear a stale sync-error instead of keeping it
      // sticky. The sticky rule exists for the FALLBACK path (where "live"
      // must be earned by a successful direct op); here it left tablets
      // showing a permanent ERROR/Inactive panel from one failed boot-window
      // fallback probe, masking a perfectly working device (10.07 rollout).
      // A genuinely failing upload keeps the error: streamError stays set.
      setSyncStatus(prev =>
        (prev === "sync-error" && powerSyncStatus?.streamError ? prev : "live"));
      return undefined;
    }
    const t = setTimeout(() => {
      setSyncStatus(prev => (prev === "local-only" || prev === "sync-error") ? prev : "connecting");
    }, 7000);
    return () => clearTimeout(t);
  }, [anyTransportUp, hasSupabaseConfig, sqlitePrimary, powerSyncStatus?.streamError]);

  // ── Primary read path: SQLite watches drive every load + live update ─────────
  // Each watch re-runs its reader whenever the underlying table changes — a
  // local edit or a change streamed from another device — so the first fire
  // seeds the UI (no separate load effects) and every later fire is the live
  // update. The lower-priority reference lists (menu P2, wines/beverages P3)
  // keep the cached paint until their first download lands, hence their
  // non-empty guards.
  useEffect(() => {
    if (!sqlitePrimary) return undefined;
    let dispose;
    let cancelled = false;
    (async () => {
      try {
        const { startWatches } = await import("./powersync/watch.js");
        const lo = new Date(); lo.setDate(lo.getDate() - 7);
        const hi = new Date(); hi.setDate(hi.getDate() + 30);
        const range = { from: toLocalDateISO(lo), to: toLocalDateISO(hi) };
        dispose = startWatches({
          onServiceTables: (rows) => {
            if (cancelled) return;
            adoptRemoteTables(rows);
            // Board truth is in: unlock the reconcile effect and table saves.
            setRemoteBoardLoaded(true);
            setBoardSyncTick(t => t + 1);
          },
          onReservations: (rows) => {
            if (cancelled) return;
            setReservations(rows);
            setReservationsLoaded(true);
          },
          onWines: (rows) => {
            if (cancelled || (!rows.length && !powerSyncStatus?.hasSynced)) return;
            setWines(rows);
            writeLocalWines(rows);
          },
          onBeverages: (data) => {
            if (cancelled || (!data.length && !powerSyncStatus?.hasSynced)) return;
            const c = pickBeveragesForCategory(data, "cocktail");
            const s = pickBeveragesForCategory(data, "spirit");
            const b = pickBeveragesForCategory(data, "beer");
            setCocktails(c);
            setSpirits(s);
            setBeers(b);
            writeLocalBeverages({ cocktails: c, spirits: s, beers: b });
          },
          onMenuCourses: (rows) => {
            if (cancelled || (!rows.length && !powerSyncStatus?.hasSynced)) return;
            const courses = rows.map(supabaseRowToCourse);
            writeLocalMenuCourses(courses);
            // Never clobber an admin draft in progress (see menuCoursesDirtyRef).
            if (menuCoursesDirtyRef.current) return;
            setMenuCourses(courses);
          },
          onLiveSettings: (rows) => {
            if (cancelled) return;
            for (const row of rows) {
              if (row.id === "kitchen_ticket_order") {
                const ids = row.state?.ids;
                if (Array.isArray(ids)) setKitchenTicketOrder(ids.map(Number).filter(Number.isFinite));
              } else if (row.id === "service_date") {
                // Shared service lifecycle: a service started/ended on another
                // device applies here too (adopt-only — never writes back).
                adoptServiceLifecycleRef.current?.(row.state, row.updated_at);
              } else if (row.id === FLOOR_STATUS_KEY) {
                adoptFloorStatusRef.current?.(row.state, row.updated_at);
              } else if (row.id === FLOOR_MAPS_KEY) {
                adoptFloorMapsRef.current?.(row.state, row.updated_at);
              }
            }
          },
        }, range);
        if (cancelled) dispose?.();
      } catch (e) { console.error("[PowerSync] watches failed:", e); }
    })();
    return () => { cancelled = true; dispose?.(); };
  }, [sqlitePrimary, workspaceId, powerSyncStatus?.hasSynced]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Beverages: fallback direct-Supabase loader ───────────────────────────────
  // Used when the local DB isn't primary, and by syncWines() to refresh the
  // lists right after a website scrape. Without the explicit post-sync refresh
  // the synced cocktails only appeared whenever an update happened to land, so
  // a sync could report "N cocktails" yet leave the UI showing the old list.
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
    // Instant paint from this workspace's cache (covers a workspace that
    // resolves asynchronously after mount).
    const cached = readLocalBeverages();
    if (cached) {
      if (Array.isArray(cached.cocktails)) setCocktails(cached.cocktails);
      if (Array.isArray(cached.spirits))   setSpirits(cached.spirits);
      if (Array.isArray(cached.beers))     setBeers(cached.beers);
    }
    if (!psResolved || sqlitePrimary) return; // primary: the watches own the list
    loadBeverages();
  }, [loadBeverages, workspaceId, psResolved, sqlitePrimary]);

  // ── Wines: fallback direct-Supabase loader ───────────────────────────────────
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
    // Instant paint from this workspace's cache (covers a workspace that
    // resolves asynchronously after mount).
    const cachedWines = readLocalWines();
    if (cachedWines && cachedWines.length) setWines(cachedWines);
    if (!psResolved || sqlitePrimary) return; // primary: the watches own the list
    loadWines();
  }, [loadWines, workspaceId, psResolved, sqlitePrimary]);

  // ── Service date + reservations ──────────────────────────────────────────────
  // The cached planner paints instantly; the store refresh (SQLite watch when
  // primary, direct Supabase otherwise) replaces it. The service-date restore +
  // stale-service auto-end below runs once per workspace on either path.
  useEffect(() => {
    if (!supabase || !workspaceId || !psResolved) return;
    let mounted = true;

    // Instant paint of the planner from this workspace's cache.
    const cachedResv = readLocalReservations();
    if (cachedResv && cachedResv.length) setReservations(cachedResv);

    // Restore service date saved by a previous session — but if it has rolled
    // past the service-day cutoff, the service is over: auto-end it (archiving
    // the night's data before clearing) so "Start Service" prompts for a fresh
    // date and pre-populates today's reservations on blank tables.
    readStateKey("service_date")
      .then(async (state) => {
        if (!mounted) return;
        const persisted = state?.date;
        const persistedChosenOn = state?.chosenOn || null;
        const persistedSession = state?.session;
        const persistedStartedAt = state?.startedAt || null;
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
        serviceStartedAtRef.current = persistedStartedAt || serviceStartedAtRef.current;
        // Adopt the live service's shared session so this device's board reconcile
        // shows the right session's reservations (not its own local default).
        if (persistedSession === "lunch" || persistedSession === "dinner") {
          setActiveServiceSession(persistedSession);
          activeServiceSessionRef.current = persistedSession;
        }
        try {
          localStorage.setItem(workspaceKey("milka_service_date"), persisted);
          if (persistedChosenOn) localStorage.setItem(workspaceKey(SERVICE_DATE_CHOSEN_ON_KEY), persistedChosenOn);
          if (persistedStartedAt) localStorage.setItem(workspaceKey("milka_service_started_at"), persistedStartedAt);
          if (persistedSession === "lunch" || persistedSession === "dinner") localStorage.setItem(workspaceKey("milka_service_session"), persistedSession);
        } catch {}
      })
      .catch(() => {}); // keep whatever local service date we already have

    // Fallback planner load (-7…+30 days). When the local DB is primary the
    // reservations watch seeds + refreshes the planner instead. Kept callable
    // via reloadReservationsRef: the realtime channel's post-reconnect
    // catch-up re-runs it as the authoritative read — a FULL REPLACE, so
    // rows deleted while the socket was dead disappear here too (a merge
    // would resurrect them).
    if (!sqlitePrimary) {
      const loadPlanner = () => {
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
      };
      reloadReservationsRef.current = loadPlanner;
      loadPlanner();
    }

    return () => { mounted = false; reloadReservationsRef.current = null; };
  }, [workspaceId, psResolved, sqlitePrimary]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── Menu courses: cached device copy paints instantly; the store refreshes ──
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
        writeLocalMenuCourses(courses); // keep the device cache warm for next launch
        // Never clobber an admin draft in progress (see menuCoursesDirtyRef).
        if (menuCoursesDirtyRef.current) return;
        setMenuCourses(courses);
      } catch (error) {
        // Keep the cached courses on screen rather than blanking the menu/board.
        console.warn("Menu courses fetch failed — keeping cached list:", error);
      }
    };

    loadMenuCoursesRef.current = loadCourses;
    if (psResolved && !sqlitePrimary) loadCourses(); // primary: the watches own the list

    return () => { mounted = false; };
  }, [workspaceId, psResolved, sqlitePrimary]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fallback realtime safety net (Supabase channels) ────────────────────────
  // The direct-Supabase fallback serves a PowerSync outage or a deployment
  // where PowerSync is deliberately disabled. Deleting the
  // legacy realtime layer (PR #42) silently
  // turned that fallback into a static snapshot: reservations/menu/wines/
  // beverages loaded exactly once per boot and the board crawled on a 60s
  // poll, so cross-device edits never appeared and "add reservation" looked
  // like it did nothing (the row landed in Postgres but no other device — and
  // after a reload not even this one — ever re-read it). These channels
  // restore the pre-#42 live path for exactly that fallback population; when
  // the local SQLite DB is primary the PowerSync watches own liveness and the
  // channels stay unsubscribed.
  const fallbackRealtime = Boolean(supabase && workspaceId && psResolved && !sqlitePrimary);
  const wsFilter = workspaceId ? `workspace_id=eq.${workspaceId}` : undefined;

  useRealtimeTable({
    supabase,
    channelName: `milka-service-tables-${workspaceId}`,
    filter: wsFilter,
    table: TABLES.SERVICE_TABLES,
    // Apply the changed row straight from the event payload — adoptRemoteTables
    // folds a PARTIAL set (tables not in it keep local state), so another
    // device's tap paints here at realtime latency with no REST refetch
    // round-trip in between (the refetch made the live feed visibly lag).
    // Mirrors the primary watch handler's gates. Events without a row fall
    // back to the full reload.
    onChange: (payload) => {
      if (payload.new && payload.new.table_id != null) {
        adoptRemoteTables([payload.new]);
        setRemoteBoardLoaded(true);
        setBoardSyncTick(t => t + 1);
      } else {
        fallbackBoardReloadRef.current?.();
      }
    },
    // Reconnect catch-up: taps made on other devices while this socket was
    // dead were never delivered — re-read the whole board (adoptive: folds
    // around any unsaved local edits, so it can't clobber in-flight work).
    onResubscribe: () => { fallbackBoardReloadRef.current?.(); },
    enabled: fallbackRealtime,
  });

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
    // Reconnect catch-up: a full authoritative replace. Critically this also
    // reconciles DELETIONS missed while offline — merging events back in
    // would leave ghost reservations no device can explain.
    onResubscribe: () => { reloadReservationsRef.current?.(); },
    enabled: fallbackRealtime,
  });

  // Settings (kitchen ticket order, shared service lifecycle) — mirrors the
  // onLiveSettings watch handler. The settings table carries many ids
  // (inventory, configs…); only react to the ones owned here.
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
      } else if (id === "service_date") {
        // Shared service lifecycle: a service started/ended on another device
        // applies here too (adopt-only — never writes back).
        adoptServiceLifecycleRef.current?.(payload.new?.state, payload.new?.updated_at);
      } else if (id === FLOOR_STATUS_KEY) {
        adoptFloorStatusRef.current?.(payload.new?.state, payload.new?.updated_at);
      } else if (id === FLOOR_MAPS_KEY) {
        adoptFloorMapsRef.current?.(payload.new?.state, payload.new?.updated_at);
      }
    },
    // Reconnect catch-up: re-read the owned live keys — a service started,
    // ended, or re-dated while this socket was dead must apply on rejoin
    // (the old display waking into an already-ended service, most of all).
    onResubscribe: () => {
      readStateKey("kitchen_ticket_order").then(state => {
        const ids = state?.ids;
        if (Array.isArray(ids)) setKitchenTicketOrder(ids.map(Number).filter(Number.isFinite));
      }).catch(() => {});
      readStateKey("service_date").then(state => {
        if (state) adoptServiceLifecycleRef.current?.(state, new Date().toISOString());
      }).catch(() => {});
      readStateKey(FLOOR_STATUS_KEY).then(state => {
        adoptFloorStatusRef.current?.(state, new Date().toISOString());
      }).catch(() => {});
    },
    enabled: fallbackRealtime,
  });

  useRealtimeTable({
    supabase,
    channelName: `milka-beverages-${workspaceId}`,
    filter: wsFilter,
    table: TABLES.BEVERAGES,
    onChange: () => { loadBeverages(); },
    onResubscribe: () => { loadBeverages(); },
    enabled: fallbackRealtime,
  });

  useRealtimeTable({
    supabase,
    channelName: `milka-wines-${workspaceId}`,
    filter: wsFilter,
    table: TABLES.WINES,
    onChange: () => { loadWines(); },
    onResubscribe: () => { loadWines(); },
    enabled: fallbackRealtime,
  });

  useRealtimeTable({
    supabase,
    channelName: `milka-menu-courses-${workspaceId}`,
    filter: wsFilter,
    table: TABLES.MENU_COURSES,
    onChange: () => { loadMenuCoursesRef.current?.(); },
    onResubscribe: () => { loadMenuCoursesRef.current?.(); },
    enabled: fallbackRealtime,
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
    onSyncAll: canAdmin ? syncWines : undefined,
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
    if (!workspacesResolved) return splash;
    // Wait for the workspace query before deciding picker-vs-board, so the
    // "no restaurant linked" empty state never flashes mid-resolution.
    if (!workspaceId) return (
      <ProfilePicker
        workspaces={myWorkspaces}
        onPick={applyWorkspace}
        onSignOut={signOut}
      />
    );
  } else if (!authed) {
    // Local-only fallback (no Supabase): keep the legacy password gate.
    return <GateScreen onPass={() => setAuthed(true)} />;
  }

  // Gate 2: boot splash — wait briefly for the board truth before rendering
  if (!bootGateDone) return (
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
          try { localStorage.setItem(workspaceKey("milka_mode"), target); } catch {}
          // The reconciliation effect (watches `mode` + `serviceDate` + `activeServiceSession`)
          // fills the board from reservations for the chosen date and session.
        }
      }}
      onCancel={() => { setShowServiceDatePicker(false); setPendingModeAfterDate(null); }}
    />
  ) : null;

  if (!mode) return <>{serviceDatePickerEl}<LoginScreen
      onEnter={m => { if (m !== "admin" || canAdmin) { changeMode(m); setSel(null); } }}
      onSyncAll={canAdmin ? syncWines : undefined}
      canAdmin={canAdmin}
      workspaceName={myWorkspaces.find(w => w.id === workspaceId)?.name || ""}
      canSwitchProfile={Boolean(supabase) && myWorkspaces.length > 1}
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
      resolveTableFlag={(r) => ({
        needsTable: !resolveReservationTable(getActiveDiningMap(floorMapsState), r.table_id).table,
      })}
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
  // The FLOOR sibling view (mode "kitchen_floor") is strictly read-only.
  if (mode === "display" || mode === "kitchen_floor") return (<>
    {serviceDatePickerEl}
    <div style={{ minHeight: "100vh", background: tokens.ink.bg, fontFamily: FONT, overflowX: "hidden", WebkitTextSizeAdjust: "100%" }}>
      <GlobalStyle />
      <Header modeLabel={mode === "kitchen_floor" ? "KITCHEN · FLOOR" : "KITCHEN"} showSummary={false} showMenu={false} showArchive={mode === "display"} showInventory={false} {...hProps} />
      {pastDateWarningEl}
      {!serviceDate ? (
        /* No service running — the kitchen idles here, nothing can pop up.
           The screen goes live on its own the moment FOH starts the service
           (the shared service_date lifecycle is adopted via watch/realtime). */
        <div style={{ minHeight: "70vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
          <div style={{ fontFamily: FONT, fontSize: appIsMobile ? "14px" : "18px", fontWeight: 600, letterSpacing: "0.35em", textTransform: "uppercase", color: tokens.ink[2], paddingLeft: "0.35em", textAlign: "center" }}>
            NO ACTIVE SERVICE
          </div>
          <div style={{ fontFamily: FONT, fontSize: "9px", letterSpacing: "0.18em", textTransform: "uppercase", color: tokens.ink[4], textAlign: "center" }}>
            WAITING FOR SERVICE TO START
          </div>
        </div>
      ) : (<>
      {/* TICKETS / FLOOR toggle — same auth + workspace gate for both views;
          the floor view carries no mutation handlers at all. */}
      <div style={{ display: "flex", gap: 0, padding: appIsMobile ? "10px 10px 0" : "10px 16px 0" }}>
        {[["display", "TICKETS"], ["kitchen_floor", "FLOOR"]].map(([m, label]) => {
          const on = mode === m;
          return (
            <button key={m} onClick={() => enterMode(m)} style={{
              fontFamily: FONT, fontSize: "8px", letterSpacing: "0.14em", textTransform: "uppercase",
              padding: "7px 14px", marginLeft: -1, borderRadius: 0, cursor: "pointer",
              border: `1px solid ${on ? tokens.charcoal.default : tokens.ink[4]}`,
              background: on ? tokens.charcoal.default : tokens.neutral[0],
              color: on ? tokens.neutral[0] : tokens.ink[2], fontWeight: on ? 600 : 400,
              touchAction: "manipulation",
            }}>{label}</button>
          );
        })}
      </div>
      {/* Slim desktop padding: on a 720px-tall kitchen panel every vertical px
          counts toward fitting two full rows of tickets. */}
      <div style={{ padding: appIsMobile ? "12px 10px" : "10px 16px" }}>
        <Suspense fallback={lazyViewFallback}>
          {mode === "kitchen_floor" ? (
            <KitchenFloorView
              floorMaps={floorMapsState}
              floorStatus={floorStatus}
              reservations={serviceReservations}
              tables={tables}
              menuCourses={activeMenuCourses}
              profiles={profilesState.profiles}
              assignments={profilesState.assignments}
              isMobile={appIsMobile}
            />
          ) : (
          <KitchenBoard
            tables={kitchenTables}
            menuCourses={activeMenuCourses}
            upd={upd}
            updMany={updMany}
            profiles={profilesState.profiles}
            assignments={profilesState.assignments}
            historyGapsByMenu={historyGapsByMenu}
            persistedOrder={kitchenTicketOrder}
            onOrderChange={saveKitchenTicketOrder}
          />
          )}
        </Suspense>
      </div>
      </>)}
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
        onUpdateMenuCourses={(next) => { menuCoursesDirtyRef.current = true; setMenuCourses(next); }}
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
        powerSync={powerSyncStatus}
        sqlitePrimary={sqlitePrimary}
        lastSyncError={lastSyncError}
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
        floorMaps={floorMapsState}
        floorReservations={serviceReservations}
        onUpdateFloorMaps={updateFloorMaps}
        onApplyLayoutSwitch={applyLayoutSwitchRows}
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
            {/* [VIEW] toggle — BOARD (card grid) / FLOOR (the spatial floor map) */}
            <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
              {["board", "floor"].map(v => {
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

          {serviceView === "floor" ? (
            /* FLOOR view — the spatial projection of the same board state.
               A dining table is one big SET toggle (tap to flip);
               terrace tables and ARRIVING tables open their action sheet.
               The old TerracePanel's whole terrace leg lives in here. */
            <FloorView
              floorMaps={floorMapsState}
              floorStatus={floorStatus}
              reservations={serviceReservations}
              tables={tables}
              menuCourses={activeMenuCourses}
              profiles={profilesState.profiles}
              assignments={profilesState.assignments}
              onCycleStatus={(mapId, label) => updateFloorStatus(fs => cycleFloorStatus(fs, mapId, label))}
              onUpdateFloorMaps={updateFloorMaps}
              onAssign={assignTerraceTable}
              onClear={clearTerracePartyTable}
              onMove={moveTerracePartyIn}
              onMarkSeated={markTerracePartySeated}
              onSwapSeats={swapSeats}
              onSendSetToKitchen={(boardIds) => {
                // SEND on the floor: every SET table raises the SAME kitchen
                // banner the sheet view's SET NEXT does — courseReady for the
                // table's next unfired course. The alert carries ONLY the set
                // course: previously it re-attached the last unconfirmed order
                // delta, so 'send SET' also re-sent pairings and every earlier
                // change to the kitchen (orders were already sent once — the
                // ticket still shows them; the alert must not repeat them).
                // Board tables whose party is still out on the terrace already
                // have a live kitchen ticket (kitchenTables decoration), so a
                // terrace SET must reach it even though the dining table isn't
                // seated yet.
                const terraceIds = new Set();
                serviceReservations.forEach(r => {
                  if (visitStateOf(r.data) !== "terrace") return;
                  reservationTableIds(r.data, r.table_id).forEach(tid => terraceIds.add(Number(tid)));
                });
                for (const id of boardIds) {
                  const t = tablesRef.current?.find(x => x.id === id);
                  if (!t) continue;
                  if (!t.active && !terraceIds.has(t.id)) continue;
                  const visible = getVisibleCoursesForTable(t, activeMenuCourses, {
                    profiles: profilesState.profiles, assignments: profilesState.assignments,
                  });
                  const { nextFire } = getCourseProgressState(t, visible);
                  if (!nextFire) continue; // menu complete — nothing to announce
                  const ready = { key: nextFire.key, index: nextFire.index, name: nextFire.name, at: fmt(new Date()) };
                  updMany(id, {
                    courseReady: ready,
                    kitchenAlert: {
                      timestamp: new Date().toISOString(),
                      tableName: t.resName || null,
                      seats: [],
                      confirmed: false,
                      course: ready,
                    },
                    // a SET to an archived ticket proves it's still live —
                    // bring it back next to its alert (Archive mis-taps)
                    ...(t.kitchenArchived ? { kitchenArchived: false } : {}),
                  });
                }
              }}
              isMobile={appIsMobile}
            />
          ) : (
            /* Combined Board + per-table Quick Access view */
            (() => {
              // Terrace-flow decoration: mark each board table whose party is
              // still outside (terrace) or mid kitchen-visit (arriving) so the
              // room reads honestly. Derived per render, never persisted.
              const visitByTable = {};
              serviceReservations.forEach(r => {
                const vs = visitStateOf(r.data);
                if (vs !== "terrace" && vs !== "arriving") return;
                reservationTableIds(r.data, r.table_id).forEach(id => {
                  visitByTable[id] = {
                    visit: vs,
                    terraceLabel: r.data?.terrace_table || null,
                  };
                });
              });
              const visibleTables = tables
                .filter(t => t.active || t.resName || t.resTime)
                .filter(t => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup))
                .map(t => visitByTable[t.id] ? { ...t, _visit: visitByTable[t.id] } : t);

              return (
                <DisplayBoard
                  tables={visibleTables}
                  onMarkSeated={markSeatedOnTable}
                  onAssignTerrace={requestTerraceAssign}
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
          onMoveTable={(fromId, toId, mvMode = "auto") => {
            const from = Number(fromId);
            const to = Number(toId);
            const dst = tablesRef.current?.find(t => t.id === to);
            const dstStarted = dst && (dst.active || dst.arrivedAt
              || (dst.kitchenLog && Object.keys(dst.kitchenLog).length > 0)
              || dst.kitchenArchived);
            const dstHasReservation = !!(dst?.resName || dst?.resTime);
            const dstOccupied = !!(dstStarted || dstHasReservation);
            const useSwap = mvMode === "swap" || (mvMode === "auto" && dstOccupied);
            const result = useSwap ? swapTableState(from, to) : moveTableState(from, to);
            if (!result.ok) return result;
            setSel(to);

            // Repoint the owning reservation(s) so they follow the live state we
            // just moved/swapped. CRITICAL: do it in ONE atomic setReservations
            // (and persist directly), not two separate async upserts. The old
            // path moved one reservation, awaited the DB, then moved the other —
            // and in the gap the board↔reservations reconcile saw a table whose
            // reservation had already left but whose replacement hadn't arrived,
            // so it blanked the table. A single-table blank isn't caught by the
            // mass-wipe guard, so the wipe persisted: the "switching tables
            // deletes one of them" bug.
            const ownerOf = (tid) => reservations.find(r =>
              r.date === serviceDate
              && resolveReservationSession(r.data) === activeServiceSession
              && reservationTableIds(r.data, r.table_id).includes(tid));
            // repointReservation (utils/tableHelpers) swaps from↔to on the
            // primary table_id AND inside the tableGroup so a grouped
            // reservation's member list never dangles at the old id.
            const srcResv = ownerOf(from);
            const dstResv = useSwap ? ownerOf(to) : null;
            // The destination's owner only moves on a SWAP; a plain move targets
            // a free table. Guard against the same reservation matching both.
            const repoint = (r) => repointReservation(r, from, to);
            if (srcResv || (dstResv && dstResv.id !== srcResv?.id)) {
              setReservations(prev => prev.map(r => {
                if (srcResv && r.id === srcResv.id) return { ...r, ...repoint(r) };
                if (dstResv && dstResv.id !== srcResv?.id && r.id === dstResv.id) return { ...r, ...repoint(r) };
                return r;
              }));
              if (supabase) {
                // Persist through the store seam (SQLite when primary), NOT a
                // direct Supabase write: on the SQLite-primary path the
                // reservations watch re-reads from the local DB, so a direct
                // Supabase-only write would be reverted by the next watch tick
                // and the switch would bounce back — leaving the guest on both
                // tables (the duplicate) and the other table hidden.
                const writes = [];
                if (srcResv) { const rp = repoint(srcResv); writes.push(persistReservationRow({ id: srcResv.id, date: srcResv.date, table_id: rp.table_id, data: rp.data })); }
                if (dstResv && dstResv.id !== srcResv?.id) { const rp = repoint(dstResv); writes.push(persistReservationRow({ id: dstResv.id, date: dstResv.date, table_id: rp.table_id, data: rp.data })); }
                Promise.all(writes).catch(e => console.warn("Reservation table move persist failed:", e));
              }
            }
            return { ...result, swapped: useSwap };
          }}
          reservationOnTable={reservationOnTable}
          mapSeatCap={mapSeatCountForBoardTable(getActiveDiningMap(floorMapsState), sel)}
        />
      )}

      {summaryOpen && (
        <Suspense fallback={null}>
          <SummaryModal tables={tables} optionalExtras={dishes} optionalPairings={pairings} celebrationKeys={celebrationKeys} onClose={() => setSummaryOpen(false)} />
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

      {/* Party-first ASSIGN TERRACE — the mini floor-map picker. Free tables
          tappable; occupied
          tables render inert + dimmed via the shared renderer's picker mode. */}
      {terraceAssignFor && (
        <CenteredModal
          onClose={() => setTerraceAssignFor(null)}
          label={`[ASSIGN TERRACE · ${(terraceAssignFor.data?.resName || "—").toUpperCase()} ×${terraceAssignFor.data?.guests || "?"}]`}
        >
          {(() => {
            const occ = terraceOccupancy(serviceReservations);
            const terraceMap = getTerraceMap(floorMapsState);
            const tState = {};
            for (const t of (terraceMap?.tables || [])) {
              const r = occ[t.label];
              tState[t.label] = r
                ? { status: "occupied", name: r.data?.resName || "—", pax: r.data?.guests || undefined }
                : { status: "free", selectable: true };
            }
            return (
              <FloorMap
                map={getTerraceMap(floorMapsState)}
                mode="picker"
                tableState={tState}
                height={300}
                onTableTap={(t) => {
                  assignTerraceTable(terraceAssignFor, t.label);
                  setTerraceAssignFor(null);
                }}
              />
            );
          })()}
        </CenteredModal>
      )}

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
