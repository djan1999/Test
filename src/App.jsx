import { useState, useRef, useEffect, useMemo, useCallback, lazy, Suspense } from "react";
import {
  normalizeCourseCategory, normalizeOptionalKey,
  optionalPairingsFromCourses, celebrationKeysFromCourses,
} from "./utils/menuUtils.js";
import { courseToSupabaseRow, supabaseRowToCourse } from "./utils/menuCourseMapper.js";
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
  applyLayoutSwitchToTables, renameFloorPositionsKey, floorPositionKey,
  swapSeatData, moveSeatOnFloor, materializeFloorPositions,
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
  FLOOR_MAPS_KEY, FLOOR_STATUS_KEY, sanitizeFloorMaps,
  getActiveDiningMap, getTerraceMap, mapSeatCountForBoardTable,
  terraceOccupancy, applyLayoutSwitchRow, resolveReservationTable,
  sanitizeFloorStatus, setFloorStatus, cycleFloorStatus, pruneFloorStatus,
  renameFloorStatusLabel,
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
  DEFAULT_RESTRICTIONS,
  setRestrictionsCache,
} from "./constants/dietary.js";
import { supabase, hasSupabaseConfig, supabaseUrl, TABLES, getWorkspaceId } from "./lib/supabaseClient.js";
import { scopedFrom } from "./lib/scopedDb.js";
import { readStateKey, saveStateKey, dropPendingStateKey } from "./lib/stateStore.js";
import { createWriteQueue } from "./lib/writeQueue.js";
import { recordClientDiagnostic } from "./lib/clientDiagnostics.js";
import { finishServiceStore } from "./lib/serviceLifecycleStore.js";
import { isPowerSyncEnabled } from "./powersync/config.js";
import { setSqlitePrimaryFlag } from "./powersync/primary.js";
import { setSandbox, isSandbox } from "./lib/sandbox.js";
import { useRealtimeTable } from "./hooks/useRealtimeTable.js";
import { useWorkspaceAccess } from "./hooks/useWorkspaceAccess.js";
import {
  WORKSPACE_ROLES,
  canAccessMode,
  canAdminister,
  normalizeWorkspaceRole,
} from "./auth/roles.js";
import {
  RESTAURANT_CONFIG_KEY,
  configuredTableIds,
  makeDefaultRestaurantConfig,
  reconcileConfiguredTables,
  removedLiveTableIds,
  sanitizeRestaurantConfig,
} from "./config/restaurantConfig.js";
import { DEFAULT_SYNC_CONFIG, normalizeSyncConfig } from "./config/syncConfig.js";
import { tokens } from "./styles/tokens.js";
import ServiceDatePicker from "./components/reservations/ServiceDatePicker.jsx";
import ResvForm from "./components/reservations/ResvForm.jsx";
import CenteredModal from "./components/ui/CenteredModal.jsx";
import Header from "./components/ui/Header.jsx";
import GlobalStyle from "./components/ui/GlobalStyle.jsx";
import GateScreen from "./components/gate/GateScreen.jsx";
import LoginScreen from "./components/login/LoginScreen.jsx";
import AuthScreen from "./components/auth/AuthScreen.jsx";
import PasswordRecoveryScreen from "./components/auth/PasswordRecoveryScreen.jsx";
import ProfilePicker from "./components/auth/ProfilePicker.jsx";
import Detail from "./components/service/Detail.jsx";
import { DisplayBoard } from "./components/service/DisplayBoard.jsx";
export { DisplayBoardCard } from "./components/service/DisplayBoard.jsx";
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
const DEFAULT_RESTAURANT_CONFIG = makeDefaultRestaurantConfig({ name: APP_NAME, subtitle: APP_SUBTITLE });

// Board sync history follows a table's stable id, never its screen position.
// An array baseline can silently assign T2's history to T12 when an admin
// changes the configured table list; this Map survives those layout changes.
const makeTableJsonMap = (tables = []) => new Map(
  tables.map((table) => [Number(table.id), JSON.stringify(sanitizeTable(table))]),
);

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
// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const localBev = readLocalBeverages();
  const loadMenuCoursesRef = useRef(null);
  const appIsMobile = useIsMobile(BP.md);
  const [restaurantConfig, setRestaurantConfig] = useState(DEFAULT_RESTAURANT_CONFIG);
  const restaurantConfigRef = useRef(restaurantConfig);
  restaurantConfigRef.current = restaurantConfig;

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
  const {
    session,
    sessionChecked,
    passwordRecovery,
    completePasswordSetup,
    workspaceId,
    workspaces: myWorkspaces,
    workspacesResolved,
    currentWorkspace,
    applyWorkspace,
    openProfilePicker,
    signOut,
  } = useWorkspaceAccess({
    onWorkspaceApply: (id) => {
      setSqlitePrimary(false);
      setSqlitePrimaryFlag(false);
      setPsResolved(!isPowerSyncEnabled(id));
    },
  });
  // Local-only development remains fully usable. In a connected restaurant,
  // the explicit membership role controls which operating surfaces render.
  const currentRole = normalizeWorkspaceRole(
    currentWorkspace?.role,
    supabase ? null : WORKSPACE_ROLES.ADMIN,
  );
  const canAdmin = canAdminister(currentRole);
  const effectiveAppName = restaurantConfig.name || currentWorkspace?.name || APP_NAME;

  // Restaurant identity and table definitions are workspace data, not build
  // constants. A missing setting deliberately falls back to Milka's current
  // ten-table arrangement, so deploying this migration changes no live floor.
  useEffect(() => {
    const fallback = makeDefaultRestaurantConfig({
      name: currentWorkspace?.name || APP_NAME,
      subtitle: APP_SUBTITLE,
    });
    if (!supabase) {
      setRestaurantConfig(fallback);
      setTables((previous) => {
        const next = reconcileConfiguredTables(previous, fallback);
        prevTablesJsonRef.current = makeTableJsonMap(next);
        confirmedTablesJsonRef.current = makeTableJsonMap(next);
        return next;
      });
      return;
    }
    if (!workspaceId) return;
    let cancelled = false;
    readStateKey(RESTAURANT_CONFIG_KEY)
      .then((stored) => {
        if (cancelled) return;
        const next = sanitizeRestaurantConfig(stored, fallback);
        setRestaurantConfig(next);
        setTables((previous) => {
          const configured = reconcileConfiguredTables(previous, next);
          prevTablesJsonRef.current = makeTableJsonMap(configured);
          confirmedTablesJsonRef.current = makeTableJsonMap(configured);
          return configured;
        });
      })
      .catch(() => {
        if (cancelled) return;
        setRestaurantConfig(fallback);
        setTables((previous) => {
          const next = reconcileConfiguredTables(previous, fallback);
          prevTablesJsonRef.current = makeTableJsonMap(next);
          confirmedTablesJsonRef.current = makeTableJsonMap(next);
          return next;
        });
      });
    return () => { cancelled = true; };
  }, [workspaceId, currentWorkspace?.name]); // eslint-disable-line react-hooks/exhaustive-deps

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
      // 11.07 flattening (per Djan): BOARD / TERRACE / DINING ROOM in ONE
      // row — the old "floor" view with its inner map tabs was an extra
      // button press for nothing. A persisted "floor" heals to "dining".
      if (v === "terrace" || v === "dining") return v;
      return v === "floor" ? "dining" : "board";
    } catch { return "board"; }
  });
  const changeServiceView = v => {
    setServiceView(v);
    try { localStorage.setItem(workspaceKey("milka_service_view"), v); } catch {}
  };
  // Which map the kitchen's flattened header switch shows when it's not on
  // TICKETS (11.07: TICKETS / TERRACE / DINING ROOM live IN the header —
  // a separate toggle row cost a row of tickets on the 720px panel).
  const [kitchenFloorMap, setKitchenFloorMap] = useState(() => {
    try { return localStorage.getItem(workspaceKey("milka_kitchen_floor_map")) === "dining" ? "dining" : "terrace"; }
    catch { return "terrace"; }
  });
  const changeKitchenView = (key) => {
    if (key === "tickets") { enterMode("display"); return; }
    setKitchenFloorMap(key);
    try { localStorage.setItem(workspaceKey("milka_kitchen_floor_map"), key); } catch {}
    if (mode !== "kitchen_floor") enterMode("kitchen_floor");
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
  const [watchRecoveryPending, setWatchRecoveryPending] = useState(false);
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
  const prevTablesJsonRef  = useRef(makeTableJsonMap(tables));
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
  const confirmedTablesJsonRef = useRef(makeTableJsonMap(tables));
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
  /** Table ids deliberately transitioned from seated -> reserved by Unseat,
   *  mapped to the two pre-click fields needed by the fallback CAS ancestor.
   *  A seatless combined booking can make 2+ rows lose their only live-service
   *  markers (active/arrivedAt) in one render. Without this narrow one-shot
   *  allowance, the mass-blank safety guard mistakes that legitimate grouped
   *  action for an accidental board wipe and restores the party as seated.
   *  Entries live until the changed rows are confirmed in the active store. */
  const intentionalBoardUnseatRef = useRef(new Map());
  /** Row-scoped allowance for explicit CLEAR TABLE actions. It deliberately
   * does not grant a whole-board bypass and survives until those rows land. */
  const intentionalBoardBlankRef = useRef(new Set());

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

  // ── Test service (sandbox) ──────────────────────────────────────────────────
  // A fully-functional service that persists NOTHING: every write seam no-ops
  // and every inbound adoption is suspended while it runs, so real service data
  // is never touched, shared, or archived. `sandboxRef` is the render-safe
  // mirror the seams/adoptions read; the module flag (setSandbox) covers the
  // out-of-tree helpers. See lib/sandbox.js.
  const [sandboxActive, setSandboxActive] = useState(false);
  const sandboxRef = useRef(false);
  sandboxRef.current = sandboxActive;

  // Adopt restaurant identity/table changes made on another admin device.
  // Removed live tables remain visible until their service is cleared; empty
  // retired tables disappear, and newly configured tables appear immediately.
  const adoptRestaurantConfiguration = useCallback((state) => {
    if (!state || sandboxRef.current) return;
    const next = sanitizeRestaurantConfig(state, restaurantConfigRef.current);
    restaurantConfigRef.current = next;
    setRestaurantConfig(next);
    setTables((previous) => reconcileConfiguredTables(previous, next));
  }, []);

  // ── Store seams ────────────────────────────────────────────────────────────
  // The service_settings blobs (logo, layouts, quick access, service date, …)
  // go through the shared lib/stateStore.js helpers; the board, reservation
  // and archive seams below pick the store the same way.

  // Persist board rows: [{ table_id, data, updated_at }] (update-or-insert).
  const persistBoardRows = useCallback(async (rows) => {
    if (!supabase || !getWorkspaceId() || !rows?.length) return { ok: true };
    // Test service: keep the board entirely in memory — write nothing.
    if (sandboxRef.current) return { ok: true };
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
          const tableId = Number(row.table_id);
          let ancestor = null;
          try {
            ancestor = confirmedTablesJsonRef.current.has(tableId)
              ? JSON.parse(confirmedTablesJsonRef.current.get(tableId))
              : null;
          } catch { ancestor = null; }
          // Unseat is an explicit top-level transition. A configuration load
          // can refresh the generic confirmed baseline while the live board is
          // painting, so pin these two ancestor fields to what the user
          // actually clicked away from. Other fields still use the normal
          // ancestor and retain seat-level concurrent-edit protection.
          const unseatAncestor = intentionalBoardUnseatRef.current.get(tableId);
          if (unseatAncestor && ancestor) {
            ancestor = {
              ...ancestor,
              active: unseatAncestor.active,
              arrivedAt: unseatAncestor.arrivedAt,
            };
          }
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
        const tableId = Number(r.table_id);
        if ((tablesRef.current || []).some((table) => table.id === tableId)) {
          confirmedTablesJsonRef.current.set(
            tableId,
            JSON.stringify(sanitizeTable({ id: tableId, ...(r.data || {}) })),
          );
        }
        intentionalBoardUnseatRef.current.delete(tableId);
        intentionalBoardBlankRef.current.delete(tableId);
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
  const boardFlushPromiseRef = useRef(null);
  // TRUE while a service end is executing against the store. A board flush
  // that lands AFTER the store-side clear resurrects the archived board in
  // the store (last-write-wins upsert) — the straggler-autosave race the
  // end-identity harness kept catching. persistServiceEnd raises this and
  // waits out any in-flight flush; it drops on the local apply (success) or
  // immediately (refused/failed end).
  const endingServiceRef = useRef(false);
  const flushBoardWrites = useCallback(async () => {
    if (endingServiceRef.current) return { ok: false }; // the end clears pending itself
    // Test service: leave the pending set alone. Draining it here would
    // consume the ids while persistBoardRows no-ops — REAL edits queued just
    // before the sandbox started were silently dropped that way. They stay
    // queued and the drain heartbeat flushes them after exit (the flush
    // derives rows from post-exit state, so sandbox ids diff to nothing).
    if (sandboxRef.current) return { ok: true };
    if (flushingBoardRef.current) {
      flushAgainRef.current = true;
      return boardFlushPromiseRef.current;
    }
    flushingBoardRef.current = true;
    boardFlushPromiseRef.current = (async () => {
      let allOk = true;
      try {
      do {
        flushAgainRef.current = false;
        const ids = [...pendingBoardWritesRef.current];
        pendingBoardWritesRef.current = new Set();
        if (ids.length === 0) continue;
        const stamp = new Date().toISOString();
        const cur = tablesRef.current || [];
        const rows = [];
        for (const id of ids) {
          const table = cur.find(t => t.id === id);
          if (!table) continue; // table no longer on the board — nothing to write
          const data = sanitizeTable(table);
          // Already confirmed (an adoption made local == store truth after the
          // id was queued) — nothing left to write for this table.
          if (JSON.stringify(data) === confirmedTablesJsonRef.current.get(id)) continue;
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
          allOk = false;
          // Confirmed baseline stays put for these tables, so adoptRemoteTables
          // keeps folding around them; the re-added ids retry on the heartbeat.
          rows.forEach(r => pendingBoardWritesRef.current.add(r.table_id));
          setSyncStatus("sync-error");
          noteSyncError("board save", lastError);
          console.error("Save failed after 4 attempts:", lastError);
        }
        } while (flushAgainRef.current);
        return { ok: allOk };
      } finally {
        flushingBoardRef.current = false;
        boardFlushPromiseRef.current = null;
      }
    })();
    return boardFlushPromiseRef.current;
  }, [persistBoardRows]);

  const saveRestaurantConfiguration = useCallback(async (draft) => {
    if (!canAdmin) return { ok: false, error: "Admin access is required." };
    const nextConfig = sanitizeRestaurantConfig(draft, restaurantConfigRef.current);
    const currentTables = tablesRef.current || [];
    // Configuration changes can add/remove rows. First protect every service
    // edit that differs from the store-confirmed ancestor; otherwise replacing
    // the table list can make an unsaved course/drink edit disappear.
    const dirtyIds = currentTables
      .filter((table) => JSON.stringify(sanitizeTable(table)) !== confirmedTablesJsonRef.current.get(Number(table.id)))
      .map((table) => Number(table.id));
    dirtyIds.forEach((id) => pendingBoardWritesRef.current.add(id));
    if (dirtyIds.length > 0) {
      clearTimeout(saveTimerRef.current);
      const flushResult = await flushBoardWrites();
      const unsavedIds = currentTables
        .filter((table) => JSON.stringify(sanitizeTable(table)) !== confirmedTablesJsonRef.current.get(Number(table.id)))
        .map((table) => Number(table.id));
      if (!flushResult?.ok || unsavedIds.length > 0) {
        return {
          ok: false,
          error: `Restaurant setup was not changed because service edit${unsavedIds.length === 1 ? "" : "s"} on ${unsavedIds.map((id) => `T${id}`).join(", ") || "the board"} could not be saved. Reconnect and try again.`,
          unsavedTableIds: unsavedIds,
        };
      }
    }
    const blocked = removedLiveTableIds(currentTables, nextConfig);
    if (blocked.length > 0) {
      return {
        ok: false,
        error: `Cannot remove live table${blocked.length > 1 ? "s" : ""} ${blocked.map((id) => `T${id}`).join(", ")}. Clear or end that service first.`,
        blockedTableIds: blocked,
      };
    }

    const existingIds = new Set(currentTables.map((table) => Number(table.id)));
    const nextTables = reconcileConfiguredTables(currentTables, nextConfig);
    const addedRows = nextTables
      .filter((table) => !existingIds.has(Number(table.id)))
      .map((table) => ({
        table_id: Number(table.id),
        data: sanitizeTable(table),
        updated_at: new Date().toISOString(),
      }));

    if (addedRows.length > 0) {
      const boardResult = await persistBoardRows(addedRows);
      if (!boardResult.ok) {
        return { ok: false, error: boardResult.error?.message || "Could not create the new table rows." };
      }
    }

    const settingResult = await saveStateKey(RESTAURANT_CONFIG_KEY, nextConfig);
    if (!settingResult.ok) {
      return { ok: false, error: settingResult.error?.message || "Could not save the restaurant setup." };
    }

    prevTablesJsonRef.current = makeTableJsonMap(nextTables);
    // Preserve confirmed ancestors for existing rows. Only rows created by this
    // save are newly confirmed here; current React state is not store proof.
    const nextIds = new Set(nextTables.map((table) => Number(table.id)));
    for (const id of [...confirmedTablesJsonRef.current.keys()]) {
      if (!nextIds.has(id)) confirmedTablesJsonRef.current.delete(id);
    }
    for (const row of addedRows) {
      confirmedTablesJsonRef.current.set(Number(row.table_id), JSON.stringify(row.data));
    }
    setRestaurantConfig(nextConfig);
    setTables(nextTables);
    return { ok: true, config: nextConfig };
  }, [canAdmin, flushBoardWrites, persistBoardRows]);

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

  // Fallback-path reservation writes ride a per-id serialized latest-wins
  // retry queue (lib/writeQueue): two rapid visit transitions (assign terrace
  // → CLEAR TABLE) used to race as independent PATCHes — the older one
  // landing last resurrected the assign in the store — and a failed write
  // was console.warn'd and lost forever. The sqlite-primary path needs none
  // of this: its local transactions + the PowerSync upload queue are ordered.
  const reservationQueueRef = useRef(null);
  if (!reservationQueueRef.current) {
    reservationQueueRef.current = createWriteQueue(async (_id, row) => {
      // Never SET a null date: Postgres rejects it (NOT NULL — the 08.07
      // null-date incident) and the write dies silently. Omitting the column
      // keeps the store's existing date, matching the sqlite path's COALESCE.
      const patch = { table_id: row.table_id, data: row.data };
      if (row.date != null) patch.date = row.date;
      const { error } = await scopedFrom(TABLES.RESERVATIONS)
        .update(patch).eq("id", row.id);
      if (error) throw error;
    });
  }

  // Persist one reservation row (update-or-insert by id).
  const persistReservationRow = useCallback(async ({ id, date, table_id, data, created_at }) => {
    if (!supabase || !getWorkspaceId()) return { ok: true };
    if (sandboxRef.current) return { ok: true }; // test service: memory only

    try {
      if (sqlitePrimaryRef.current) {
        const { writeReservation } = await import("./powersync/writes.js");
        await writeReservation({ id, date, table_id, data, created_at });
        return { ok: true };
      }
      const result = await reservationQueueRef.current.save(id, { id, date, table_id, data });
      if (!result.ok) console.warn("Reservation persist failed (retained for retry):", result.error);
      return result;
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
    if (sandboxRef.current) return { ok: true }; // test service: memory only

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
  // (shared by reconcileBoardWithReservations and the group-merge
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
    if (sandboxRef.current) return; // test service: ignore the real board
    const arr = Array.isArray(rows) ? rows : [];
    const rawById = new Map(arr.map(row => [Number(row.table_id), row]));
    const cur = tablesRef.current && tablesRef.current.length ? tablesRef.current : initTables;
    const configuredIds = configuredTableIds(restaurantConfigRef.current);
    const configuredSet = new Set(configuredIds);
    // A removed table with live content remains protected even when this is
    // the first device to see it. Empty retired store rows stay hidden.
    const protectedIds = [
      ...cur.filter((table) => !configuredSet.has(Number(table.id)) && tableHasServiceContent(table)).map((table) => Number(table.id)),
      ...arr.filter((row) => {
        if (configuredSet.has(Number(row.table_id))) return false;
        return tableHasServiceContent(sanitizeTable({ id: Number(row.table_id), ...(row.data || {}) }));
      }).map((row) => Number(row.table_id)),
    ];
    const boardIds = [...new Set([...configuredIds, ...protectedIds])].sort((a, b) => a - b);
    const boardBases = boardIds.map((id) => blankTable(id));
    const nextPrev = new Map(prevTablesJsonRef.current);
    const confirmed = confirmedTablesJsonRef.current;
    let changed = false;
    const nextTables = boardBases.map((base) => {
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
      const confirmedJson = confirmed.get(base.id);
      if (mineJson !== confirmedJson) {
        // If the incoming copy just echoes what the store last confirmed (or
        // equals our local state), nothing to fold — keep typing.
        if (theirsJson === confirmedJson || theirsJson === mineJson) return mine;
        let ancestor = null;
        try { ancestor = confirmedJson ? JSON.parse(confirmedJson) : null; } catch { /* keep null */ }
        const folded = sanitizeTable(foldTable(ancestor, sanitizeTable(mine), theirs));
        const foldedJson = JSON.stringify(folded);
        // theirs is the store truth we folded onto — both baselines move to it.
        nextPrev.set(base.id, theirsJson);
        confirmed.set(base.id, theirsJson);
        // A fold result the store doesn't hold yet must be (re-)queued here:
        // when it equals local state there is no re-render, so the autosave
        // effect never ticks and only the drain heartbeat re-persists it.
        if (foldedJson !== theirsJson) pendingBoardWritesRef.current.add(base.id);
        if (foldedJson !== mineJson) changed = true;
        return folded;
      }
      nextPrev.set(base.id, theirsJson);
      confirmed.set(base.id, theirsJson);
      if (mineJson !== theirsJson) changed = true;
      return theirs;
    });
    prevTablesJsonRef.current = nextPrev;
    if (changed) setTables(() => nextTables); // skip the re-render when nothing moved
  };

  // Display labels are configuration, not live board data. Decorate render
  // copies only so renaming "T10" to "CHEF" never creates a fake service edit
  // or pollutes the per-table sync payload.
  const configuredLabelById = useMemo(() => new Map(
    (restaurantConfig.tables || []).map((table) => [Number(table.id), String(table.label || "").trim()]),
  ), [restaurantConfig]);
  const displayTables = useMemo(() => tables.map((table) => {
    const displayLabel = configuredLabelById.get(Number(table.id)) || `T${String(table.id).padStart(2, "0")}`;
    const displayGroupLabel = table.tableGroup?.length > 1
      ? table.tableGroup.map((id) => configuredLabelById.get(Number(id)) || `T${String(id).padStart(2, "0")}`).join("-")
      : displayLabel;
    return { ...table, displayLabel, displayGroupLabel };
  }), [tables, configuredLabelById]);
  const selTable = displayTables.find((table) => table.id === sel);

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
        // Second terrace leg (back outside for the last course — moved_at
        // from the first move-in marks it): re-seating the DINING table is a
        // board correction (Unseat → Seat), not the party coming inside —
        // their terrace leg ends only by explicit gestures.
        if (owner.data?.moved_at) continue;
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
    ids.forEach(tid => {
      const current = tables.find(t => Number(t.id) === Number(tid));
      intentionalBoardUnseatRef.current.set(Number(tid), {
        active: current?.active ?? true,
        arrivedAt: current?.arrivedAt ?? null,
      });
    });
    setTables(p => p.map(t =>
      !ids.includes(t.id) ? t : { ...t, active: false, arrivedAt: null }
    ));
  };

  const clear = async id => {
    if (typeof window !== "undefined" && !window.confirm("Clear this table and reset its details?")) return;
    const boardRow = tablesRef.current?.find(t => Number(t.id) === Number(id));
    const owner = serviceDate && (mode === "service" || mode === "display")
      ? reservationOnTable(id)
      : null;
    const ids = [...new Set([
      Number(id),
      ...((boardRow?.tableGroup?.length > 1 ? boardRow.tableGroup : []).map(Number)),
      ...((owner?.data?.tableGroup?.length > 1 ? owner.data.tableGroup : []).map(Number)),
    ].filter(Number.isFinite))];
    // If a reservation is templating this table for the live service, flag it
    // cleared so the board↔reservations reconcile doesn't immediately restore it
    // (the "cleared table comes back when I switch views / on the next poll"
    // bug). The booking row is kept for the planner/archive — just taken off the
    // live board. Editing the reservation later rebuilds its data and re-enables
    // it. The flag lives on the reservation so every device's reconcile honours it.
    if (owner && !owner.data?.clearedFromBoard) {
        // Close the terrace-flow visit too (the plan's dining → done arrow —
        // it was never wired): a cleared table must not leave a dangling
        // visit_state that keeps badges or kitchen tickets alive elsewhere.
        const closed = closeVisitData(owner.data) || owner.data;
        const nextData = { ...closed, clearedFromBoard: true };
        const result = await persistReservationRow({ id: owner.id, date: owner.date, table_id: owner.table_id, data: nextData });
        if (!result.ok) {
          // Fallback writes retain failed values for retry. This action aborted,
          // so the retained clear must not land later and hide an uncleared board.
          if (!sqlitePrimaryRef.current) reservationQueueRef.current?.drop(owner.id);
          const error = result.error || new Error("The reservation could not be cleared.");
          setSyncStatus("sync-error");
          noteSyncError("clear table reservation", error);
          recordClientDiagnostic("clear table reservation", error);
          if (typeof window !== "undefined") window.alert("CLEAR TABLE failed. Nothing was cleared; reconnect and try again.");
          return { ok: false, error };
        }
        setReservations(prev => prev.map(r => r.id === owner.id ? { ...r, data: nextData } : r));
      }
    ids.forEach((tableId) => intentionalBoardBlankRef.current.add(tableId));
    setTables(p => p.map(t => ids.includes(Number(t.id)) ? blankTable(t.id) : t));
    setSel(null);
    return { ok: true };
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
    // A move-in whose dining table is ALREADY seated (the second terrace
    // leg — dessert outside, courses running inside) must go straight to
    // 'dining': 'arriving' dead-ends there, because every MARK SEATED
    // surface gates on the table not being active. And it must not re-seat —
    // seatTable would stomp arrivedAt with the dessert hour.
    const ids = reservationTableIds(resv.data, resv.table_id).map(Number);
    const alreadySeated = ids.some(tid => tablesRef.current?.find(t => t.id === tid)?.active);
    const next = moveToDiningData(resv.data, new Date().toISOString(), {
      singleTap: alreadySeated || !!floorMapsState.config?.moveSingleTap,
    });
    if (!persistVisitData(resv, next)) return;
    // the terrace table frees the moment the write lands (occupancy derives
    // from visit_state) — and its bites-SET clears with the departure
    if (next.visit_state === "dining" || next.visit_state === "arriving") clearTerraceStrip(label);
    if (next.visit_state === "dining" && !alreadySeated) seatTable(Number(resv.table_id)); // MOVE_SINGLE_TAP path
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
  // Same seam as every reservation write — persistReservationRow. The LIVE
  // board state moves WITH the reservations (one atomic mapping — see
  // applyLayoutSwitchToTables): repointing only the reservation stranded a
  // seated party's service on the old slot while the new map's tile read
  // free (15.07 audit). A row whose destination slot holds non-moving live
  // content (a walk-in the plan can't see) is blocked entirely — neither
  // its board state nor its reservation move, so the two never disagree.
  const applyLayoutSwitchRows = async (rows) => {
    if ((rows || []).some(r => r.status === "conflict" || r.status === "needs_table")) {
      return { ok: false, error: new Error("Resolve every conflict and NEEDS TABLE row before switching layouts.") };
    }
    const moveRows = (rows || []).filter(r => r.status === "move");
    if (!moveRows.length) return { ok: true };
    const { blocked } = applyLayoutSwitchToTables(tablesRef.current || [], moveRows);
    const blockedIds = new Set(blocked.map(b => b.id));
    blocked.forEach(b => console.warn(
      "[layout-switch] Row blocked — destination slot holds live content that is not moving:", b.name, "→", b.label,
    ));
    const moves = new Map(moveRows.filter(r => !blockedIds.has(r.id)).map(r => [r.id, r]));
    if (!moves.size) return { ok: false, error: new Error("The layout switch is blocked by live destination tables.") };
    // A group move vacates 2+ contentful source rows in one pass — without
    // this flag the autosave mass-blank guard reads that as an accidental
    // wipe, restores the sources AND keeps the filled destinations: the
    // party duplicates. This is an admin-confirmed whole-board transition —
    // exactly what the flag exists for.
    intentionalBoardClearRef.current = true;
    const originalTables = tablesRef.current || [];
    const originalReservations = reservations;
    setTables(prev => applyLayoutSwitchToTables(prev, [...moves.values()]).tables);
    const current = reservations.filter(r => moves.has(r.id));
    setReservations(prev => prev.map(r => {
      const next = moves.has(r.id) ? applyLayoutSwitchRow(moves.get(r.id), r) : null;
      return next || r;
    }));
    const reservationRows = current.map(r => applyLayoutSwitchRow(moves.get(r.id), r)).filter(Boolean);
    const result = await persistReservationRows(reservationRows);
    if (!result.ok) {
      setTables(originalTables);
      setReservations(originalReservations);
      const error = result.error || new Error("Layout switch persistence failed.");
      setSyncStatus("sync-error");
      noteSyncError("layout switch", error);
      recordClientDiagnostic("layout switch", error);
      if (typeof window !== "undefined") window.alert("Layout switch failed. The current layout and assignments were retained.");
      return { ok: false, error };
    }
    return { ok: true };
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
    return displayTables.map(t => (byTable[t.id] ? { ...t, _visit: byTable[t.id] } : t));
  }, [displayTables, serviceReservations]);

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
    if (sandboxRef.current) return { ok: false, error: new Error("Sync is disabled during a test service") };
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
    if (sandboxRef.current) return { ok: true }; // test service: catalog not persisted
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
    if (sandboxRef.current) return { ok: true }; // test service: catalog not persisted
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
    if (sandboxRef.current) return { ok: true }; // test service: catalog not persisted
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
    if (!canAdmin) {
      if (typeof window !== "undefined") window.alert("Admin access is required to clear all tables.");
      return { ok: false, error: new Error("admin-required") };
    }
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
    setTables(configuredTableIds(restaurantConfigRef.current).map(blankTable));
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
    // Straggler-autosave guard: block NEW board flushes for the duration of
    // the end and wait out any IN-FLIGHT one (including its retry backoff —
    // bounded to seconds) before touching the store. Without this, a flush
    // that derived rows from the pre-end board can land after the store-side
    // clear and resurrect the archived service in the store. The flag stays
    // up through the local apply on success (applyFinishedServiceLocally
    // drops it once the blank baselines are in place) and drops here on a
    // refused or failed end.
    endingServiceRef.current = true;
    while (flushingBoardRef.current) await new Promise((r) => setTimeout(r, 50));
    try {
      const { rows, superseded } = await finishServiceStore({
        client: supabase,
        workspaceId: getWorkspaceId(),
        sqlitePrimary: sqlitePrimaryRef.current,
        archive,
        expected,
        tableIds: [...new Set([
          ...configuredTableIds(restaurantConfigRef.current),
          ...(tablesRef.current || []).map((table) => Number(table.id)),
        ])],
      });
      if (superseded) endingServiceRef.current = false;
      return { ok: !superseded, superseded, rows };
    } catch (error) {
      endingServiceRef.current = false;
      return { ok: false, error };
    }
  }, []);

  const applyFinishedServiceLocally = (rows) => {
    const ids = Array.isArray(rows) && rows.length
      ? rows.map((row) => Number(row.table_id))
      : configuredTableIds(restaurantConfigRef.current);
    const blank = [...new Set(ids)].sort((a, b) => a - b).map(blankTable);
    intentionalBoardClearRef.current = true;
    pendingBoardWritesRef.current = new Set();
    prevTablesJsonRef.current = makeTableJsonMap(blank);
    confirmedTablesJsonRef.current = makeTableJsonMap(blank);
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
    // The blank baselines are in place — board flushes are safe again.
    endingServiceRef.current = false;
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
    if (sandboxRef.current) { endTestService(); return; }
    await archiveAndClearAll();
  };

  // ── Test service (sandbox) start / end ──────────────────────────────────────
  // A fully-functional service that never persists. On start we snapshot the
  // real in-memory state, flip the kill-switch ON (every seam no-ops, every
  // adoption suspends — see lib/sandbox.js and the guards above), and seed a
  // blank in-memory board for today. On end we put the real state back exactly
  // and flip the switch OFF; a background re-read then catches up on anything
  // the real service changed while we were isolated. NOTHING here writes to the
  // store or localStorage, so real data is untouched throughout.
  const sandboxSnapshotRef = useRef(null);

  const startTestService = () => {
    if (sandboxRef.current) return;
    // Snapshot everything the sandbox is about to overwrite (verbatim restore).
    sandboxSnapshotRef.current = {
      tables: tablesRef.current,
      prevJson: new Map(prevTablesJsonRef.current),
      confirmedJson: new Map(confirmedTablesJsonRef.current),
      // Real edits still waiting to reach the store must survive the sandbox
      // — clearing them without this snapshot silently lost them (and a
      // reload mid-sandbox lost them for good).
      pendingWrites: new Set(pendingBoardWritesRef.current),
      // The unseat allowances ride along too: a real unseat still in flight
      // must keep its mass-blank exemption for the post-exit flush, while a
      // SANDBOX unseat must not leave exemptions behind on real table ids.
      unseatAllowances: new Map(intentionalBoardUnseatRef.current),
      reservations: reservationsRef.current,
      serviceDate: serviceDateRef.current,
      serviceDateChosenOn: serviceDateChosenOnRef.current,
      activeServiceSession: activeServiceSessionRef.current,
      serviceStartedAt: serviceStartedAtRef.current,
      floorStatus: floorStatusRef.current,
      mode,
      sel,
    };
    // Kill-switch ON before any state changes, so the seeding below can never
    // reach the store even for a tick.
    setSandbox(true);
    sandboxRef.current = true;
    setSandboxActive(true);

    const today = currentServiceDay();
    const blank = configuredTableIds(restaurantConfigRef.current).map(blankTable);
    // Blanking a live board would trip the mass-blank guard — flag it as an
    // intentional whole-board clear so the (no-op) autosave lets it through.
    intentionalBoardClearRef.current = true;
    prevTablesJsonRef.current = makeTableJsonMap(blank);
    confirmedTablesJsonRef.current = makeTableJsonMap(blank);
    pendingBoardWritesRef.current = new Set();
    intentionalBoardUnseatRef.current = new Map();
    tablesRef.current = blank;
    setTables(blank);
    setReservations([]);            // blank slate — add test bookings live
    setFloorStatusState(sanitizeFloorStatus({}));
    floorStatusRef.current = sanitizeFloorStatus({});
    setSel(null);
    setArchiveOpen(false);

    serviceDateRef.current = today;
    serviceDateChosenOnRef.current = today;
    serviceStartedAtRef.current = new Date().toISOString();
    setServiceDate(today);
    setServiceDateChosenOn(today);

    // Enter service WITHOUT persisting the mode/date (a reload must resume the
    // real state, never a stranded non-sandbox "service" on today's date).
    setMode("service");
    try { localStorage.removeItem(workspaceKey("milka_mode")); } catch { /* noop */ }
  };

  const endTestService = () => {
    const snap = sandboxSnapshotRef.current;
    if (snap) {
      const restored = snap.tables || configuredTableIds(restaurantConfigRef.current).map(blankTable);
      // Restore the baselines FIRST so the autosave sees the restored board as
      // unchanged (no diff → no write) once the switch flips off.
      prevTablesJsonRef.current = new Map(snap.prevJson);
      confirmedTablesJsonRef.current = new Map(snap.confirmedJson);
      // Real pre-sandbox pending edits come back; the drain heartbeat (or
      // the next local edit) flushes them now that writes work again.
      pendingBoardWritesRef.current = new Set(snap.pendingWrites || []);
      intentionalBoardUnseatRef.current = new Map(snap.unseatAllowances || []);
      tablesRef.current = restored;
      setTables(restored);
      setReservations(snap.reservations || []);
      setFloorStatusState(snap.floorStatus || sanitizeFloorStatus({}));
      floorStatusRef.current = snap.floorStatus || sanitizeFloorStatus({});
      serviceDateRef.current = snap.serviceDate || null;
      serviceDateChosenOnRef.current = snap.serviceDateChosenOn || null;
      serviceStartedAtRef.current = snap.serviceStartedAt || null;
      setServiceDate(snap.serviceDate || null);
      setServiceDateChosenOn(snap.serviceDateChosenOn || null);
      setActiveServiceSession(snap.activeServiceSession || activeServiceSessionRef.current);
      activeServiceSessionRef.current = snap.activeServiceSession || activeServiceSessionRef.current;
      setSel(snap.sel ?? null);
    }
    sandboxSnapshotRef.current = null;
    // Switch OFF — real writes and adoptions resume from here.
    setSandbox(false);
    sandboxRef.current = false;
    setSandboxActive(false);
    setArchiveOpen(false);

    // The sandbox's local strip taps stamped the floor write refs — left in
    // place they make adoptFloorStatus/adoptFloorMaps reject REAL incoming
    // blobs for 60s after exit. Nothing the sandbox "wrote" ever reached the
    // store (every seam no-ops), so there is no echo to guard against.
    floorStatusWriteTsRef.current = 0;
    floorMapsWriteTsRef.current = 0;

    // Re-read the real state in the background: a real service may have moved on
    // while we were isolated (adoptions were suspended). Best-effort, adopt-only.
    // Floor blobs included — they were restored from the snapshot, but another
    // device may have SET/un-SET strips or edited maps during the test.
    if (supabase && getWorkspaceId()) {
      fetchBoardRows().then(rows => { if (Array.isArray(rows)) adoptRemoteTables(rows); }).catch(() => {});
      readStateKey("service_date").then(st => adoptServiceLifecycleRef.current?.(st, new Date().toISOString())).catch(() => {});
      readStateKey(FLOOR_STATUS_KEY).then(st => adoptFloorStatusRef.current?.(st, new Date().toISOString())).catch(() => {});
      readStateKey(FLOOR_MAPS_KEY).then(st => adoptFloorMapsRef.current?.(st, new Date().toISOString())).catch(() => {});
      reloadReservationsRef.current?.();
    }

    // Back to where the test was launched from (Admin).
    const backMode = snap?.mode ?? null;
    setMode(backMode);
    try {
      if (backMode) localStorage.setItem(workspaceKey("milka_mode"), backMode);
      else localStorage.removeItem(workspaceKey("milka_mode"));
    } catch { /* noop */ }
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
        // The re-dated state must keep a FULL identity: writing this device's
        // empty stamp would strip startedAt from the shared state, and an
        // identity-less live state deadlocks every other device's guarded end
        // (nothing to adopt back). Mint one if we don't hold one — a device
        // holding an older stamp is refused once, adopts, and retries fine.
        const healStartedAt = serviceStartedAtRef.current || new Date().toISOString();
        serviceStartedAtRef.current = healStartedAt;
        try {
          localStorage.setItem(workspaceKey("milka_service_date"), healDay);
          localStorage.setItem(workspaceKey(SERVICE_DATE_CHOSEN_ON_KEY), healDay);
          localStorage.setItem(workspaceKey("milka_service_started_at"), healStartedAt);
        } catch {}
        await saveStateKey("service_date", {
          date: healDay, chosenOn: healDay,
          session: activeServiceSessionRef.current,
          startedAt: healStartedAt,
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
      // The re-attached service gets a FULL identity: session + a fresh
      // startedAt, adopted locally too. This heal used to write a bare
      // {date, chosenOn} blob — an identity-less state the guarded end
      // (store-side since 11.07) compared its startedAt against forever,
      // so END SERVICE was refused all night while the board kept showing
      // the whole service (the 11.07 "can't end service" incident). A fresh
      // stamp is deliberate: the original start's stamp is unknowable here,
      // and any device still holding an older one is refused once, adopts
      // this identity, and its retry succeeds.
      const startedAt = new Date().toISOString();
      const session = activeServiceSessionRef.current;
      setServiceDate(day);
      setServiceDateChosenOn(day);
      serviceDateRef.current = day;
      serviceDateChosenOnRef.current = day;
      serviceStartedAtRef.current = startedAt;
      try {
        localStorage.setItem(workspaceKey("milka_service_date"), day);
        localStorage.setItem(workspaceKey(SERVICE_DATE_CHOSEN_ON_KEY), day);
        localStorage.setItem(workspaceKey("milka_service_started_at"), startedAt);
      } catch {}
      await saveStateKey("service_date", { date: day, chosenOn: day, session, startedAt });
    } catch (e) {
      console.warn("Orphaned-service heal skipped; leaving board intact:", e);
      return null;
    }
    return day;
  };

  // Board swaps exchange P-slot payloads. TERRACE drags change only the
  // guest's physical chair for that concrete map/table, keeping P1..P{pax}
  // stable when (for example) P2 moves to terrace chair 6 — the aperitif
  // chair must not rewrite the party's dining plate positions. DINING-map
  // drags ({ identity: true }) are REAL seat changes: the kitchen plates by
  // chair, so P-numbers and restriction positions renumber with the move and
  // every kitchen surface (ticket "→ P4", floor map, print) reads the new
  // chair (per Djan — dragging a restriction on the map must move it in the
  // kitchen too).
  const swapSeats = (tid, aId, bId, floorKey = null, opts = {}) => {
    setTables(p => p.map(t => {
      if (t.id !== tid) return t;
      if (!floorKey) return swapSeatData(t, aId, bId);
      if (opts.identity) return swapSeatData(materializeFloorPositions(t, floorKey), aId, bId);
      return moveSeatOnFloor(t, aId, bId, floorKey);
    }));
  };

  // SEND SET → KITCHEN: every SET table raises the same kitchen banner the
  // sheet's SET NEXT does — courseReady for the table's next unfired course.
  // The alert carries ONLY the set course: previously it re-attached the last
  // unconfirmed order delta, so 'send SET' also re-sent pairings and every
  // earlier change to the kitchen (orders were already sent once — the ticket
  // still shows them; the alert must not repeat them). Board tables whose party
  // is still out on the terrace already have a live kitchen ticket, so a
  // terrace SET must reach it even though the dining table isn't seated yet.
  // Shared by the FOH floor and the (now interactive) kitchen terrace.
  const sendSetToKitchen = (boardIds) => {
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
        // a SET to an archived ticket proves it's still live — bring it back
        // next to its alert (Archive mis-taps)
        ...(t.kitchenArchived ? { kitchenArchived: false } : {}),
      });
    }
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
      setTables(configuredTableIds(restaurantConfigRef.current).map(blankTable));
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
    // Test service: never adopt the real service's start/end/date — the
    // sandbox owns its own lifecycle and must not be ended or re-dated by it.
    if (sandboxRef.current) return;
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
    } else if (state.date) {
      // A live service with NO identity (a legacy/degraded writer). Presenting
      // a stamp kept from an EARLIER service is worse than none: the guarded
      // end refuses it forever (nothing to adopt back), and the deterministic
      // archive id would collide with that earlier night's entry — silently
      // dropping the new archive ("on conflict do nothing").
      serviceStartedAtRef.current = null;
      try { localStorage.removeItem(workspaceKey("milka_service_started_at")); } catch {}
    }
    const remoteDate = state.date || null;
    const localDate = serviceDateRef.current;
    if (remoteDate && remoteDate !== localDate) {
      // STARTED (or re-dated) on another device — adopt the live day.
      if (isStaleServiceDate(remoteDate) && !isActivePastReview(remoteDate, state.chosenOn)) return;
      // Any floor-strip blob this device retained for retry belongs to the
      // PREVIOUS service — replaying it (retry backoff / the 'online' flush,
      // possibly an hour later) would overwrite the new service's strips.
      dropPendingStateKey?.(FLOOR_STATUS_KEY);
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
      // Drop any retained floor-strip retry first: a strip write that failed
      // on a flaky link before the end would otherwise replay on the next
      // 'online' signal and overwrite the ending device's {} wipe with the
      // dead service's SET markers.
      dropPendingStateKey?.(FLOOR_STATUS_KEY);
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
    // Merge into the STORE's live blob, not this device's refs: a device
    // that slept through a service re-start still holds the OLD startedAt —
    // writing the whole blob from refs would clobber the live identity, and
    // every other device's guarded END would then be refused (the 11.07
    // "can't end service" symptom through a side door). Store unreachable →
    // fall back to local refs, exactly the old behavior.
    (async () => {
      let live = null;
      try { live = await readStateKey("service_date"); } catch { /* offline — refs below */ }
      const base = live?.date
        ? live
        : { date, chosenOn: serviceDateChosenOnRef.current, startedAt: serviceStartedAtRef.current };
      const r = await saveStateKey("service_date", { ...base, session });
      if (!r.ok) console.warn("Service session share failed:", r.error);
    })();
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
      let originalTablesBeforeMove = null;
      if (!_skipAutoMove && prevTableId && nextTableId && prevTableId !== nextTableId
          && date === serviceDate && (mode === "service" || mode === "display")) {
        const src = tablesRef.current?.find(t => t.id === prevTableId);
        const srcStarted = src && (src.active || src.arrivedAt
          || (src.kitchenLog && Object.keys(src.kitchenLog).length > 0)
          || src.kitchenArchived);
        if (srcStarted) {
          originalTablesBeforeMove = tablesRef.current || [];
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
      } else if (originalTablesBeforeMove) {
        if (!sqlitePrimaryRef.current) reservationQueueRef.current?.drop(id);
        setTables(originalTablesBeforeMove);
        const error = result.error || new Error("Reservation edit persistence failed.");
        setSyncStatus("sync-error");
        noteSyncError("reservation table move", error);
        recordClientDiagnostic("reservation table move", error);
        if (typeof window !== "undefined") window.alert("Reservation save failed. The live table move was reversed.");
      }
      return { ok: result.ok, error: result.error };
    }
    // New reservation: mint the uuid client-side so the local write, the
    // uploaded row, and the optimistic React state all share one identity.
    const local = { ...dbRow, id: randomUuid(), created_at: new Date().toISOString() };
    if (supabase && !sandboxRef.current) {
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
    if (!supabase || sandboxRef.current) {
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
          // Adopt the live identity EXACTLY — including "none". Falling back
          // to the stamp this device kept from an earlier service made it
          // present an identity the store never held: the guarded end refused
          // every attempt (nothing to adopt back), and the deterministic
          // archive id collided with that earlier night's archive.
          serviceStartedAtRef.current = entry.startedAt || null;
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
            else localStorage.removeItem(workspaceKey("milka_service_started_at"));
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
    // UI authorization is checked again here, not only on the mode picker.
    // This closes saved-mode/deep-link paths where a device previously used by
    // an Admin is later signed into a more limited Kitchen or Service account.
    if (nextMode && !canAccessMode(currentRole, nextMode)) return;
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

  useEffect(() => {
    if (!mode || !currentRole || canAccessMode(currentRole, mode)) return;
    enterMode(null);
    setSel(null);
  }, [mode, currentRole]); // eslint-disable-line react-hooks/exhaustive-deps

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
  // Content snapshot alongside the courseReady keys: a courseReady that
  // vanished because the whole BOARD blanked (END SERVICE adopted from
  // another device) is not a served course. Without this, the adopting
  // device judged every resolve at once and PERSISTED a partial old-service
  // strip blob AFTER the ending device's {} wipe — resurrecting dead SET
  // strips into the next service (and its fresh write stamp then made it
  // reject the real wipe for 60s).
  const prevBoardContentRef = useRef(null);
  useEffect(() => {
    const prev = prevReadyKeysRef.current;
    const cur = {};
    tables.forEach(t => { cur[t.id] = t.courseReady?.key || null; });
    prevReadyKeysRef.current = cur;
    const content = {};
    tables.forEach(t => { content[t.id] = !!(t.active || t.resName); });
    const prevContent = prevBoardContentRef.current;
    prevBoardContentRef.current = content;
    const massBlank = prevContent
      ? tables.filter(t => prevContent[t.id] && !content[t.id]).length >= 2
      : false;
    if (massBlank) { pendingStripClearsRef.current = []; return; }
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
      // A party back OUTSIDE for the last course (second terrace leg — the
      // moved_at stamp from their first move-in marks it) must never be
      // auto-moved: the fire would free the terrace table they are
      // physically sitting at and hand it to the ASSIGN PARTY picker. The
      // second leg ends only by explicit gestures (MOVE / CLEAR TABLE).
      if (r.data?.moved_at) return;
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

    const prevJson = tables.map((table) => prevTablesJsonRef.current.get(Number(table.id)));
    const nextJson = tables.map(t => JSON.stringify(sanitizeTable(t)));

    // Defense-in-depth mass-blank guard: refuse to persist a blank of 2+ tables
    // that HELD service content unless a legitimate whole-board clear flagged it.
    // Even an unexpected trigger (a stale-board reconcile, a rogue effect) can't
    // push a live-service wipe to the store and other devices — it's restored
    // locally instead. Single-table changes and flagged clears pass through.
    // (Predicate extracted to utils/tableHelpers for unit coverage — the
    // refusal branch is unreachable through honest UI vectors by design.)
    const emptiedIdx = massBlankedIndices(prevJson, tables, nextJson);
    const intentionalUnseats = intentionalBoardUnseatRef.current;
    const unexpectedEmptiedIdx = emptiedIdx.filter(
      idx => !intentionalUnseats.has(Number(tables[idx]?.id))
        && !intentionalBoardBlankRef.current.has(Number(tables[idx]?.id)),
    );
    if (unexpectedEmptiedIdx.length >= 2 && !intentionalBoardClearRef.current) {
      console.error(
        "[board-guard] Refused to blank live tables", unexpectedEmptiedIdx.map(i => tables[i].id),
        "— an unexpected mass-blank was prevented from reaching the store; restoring from last good state.",
      );
      setTables(cur => cur.map((t, idx) => {
        if (!unexpectedEmptiedIdx.includes(idx)) return t;
        try { return sanitizeTable(JSON.parse(prevJson[idx])); } catch { return t; }
      }));
      return; // baseline NOT advanced; the restore re-runs this effect cleanly
    }
    intentionalBoardClearRef.current = false; // consumed once per autosave pass

    tables.forEach((table, idx) => {
      if (nextJson[idx] === prevJson[idx]) return; // untouched
      pendingBoardWritesRef.current.add(table.id);
    });
    prevTablesJsonRef.current = makeTableJsonMap(tables);
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

  const updateFloorMaps = (next, meta = null) => {
    const s = sanitizeFloorMaps(typeof next === "function" ? next(floorMapsRef.current) : next);
    floorMapsRef.current = s;
    floorMapsWriteTsRef.current = Date.now();
    setFloorMapsState(s);
    if (supabase) saveStateKey(FLOOR_MAPS_KEY, s).catch?.(() => {});
    // A RENAME carries its keyed data along before the prune: the SET strip
    // and every guest's per-map chair assignment key on "mapId:label" — they
    // used to orphan silently (strip pruned away, chairs reverting to seat
    // defaults) the moment the label changed mid-service.
    const rename = meta?.renamedTable;
    if (rename && rename.from !== rename.to) {
      updateFloorStatus(fs => pruneFloorStatus(
        renameFloorStatusLabel(fs, rename.mapId, rename.from, rename.to), s));
      setTables(prev => renameFloorPositionsKey(
        prev,
        floorPositionKey(rename.mapId, rename.from),
        floorPositionKey(rename.mapId, rename.to),
      ));
      return s;
    }
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
    if (sandboxRef.current || state == null) return; // test service: ignore real SET markers
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
      if (watchRecoveryPending) {
        setSyncStatus("sync-error");
        return undefined;
      }
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
  }, [anyTransportUp, hasSupabaseConfig, sqlitePrimary, powerSyncStatus?.streamError, watchRecoveryPending]);

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
    let retryTimer;
    let watchAttempt = 0;
    const reportWatchFailure = ({ source, phase, error }) => {
      if (cancelled) return;
      const label = `PowerSync ${source} ${phase}`;
      const failure = error || new Error(`${label} failed`);
      console.error(`[${label}]`, failure);
      setWatchRecoveryPending(true);
      setSyncStatus("sync-error");
      noteSyncError(label, failure);
      recordClientDiagnostic(label, failure);
      dispose?.();
      dispose = undefined;
      if (!retryTimer) {
        const delay = Math.min(30000, 1000 * 2 ** Math.min(watchAttempt, 5));
        watchAttempt += 1;
        retryTimer = setTimeout(() => { retryTimer = undefined; void start(); }, delay);
      }
    };
    const start = async () => {
      try {
        const { startWatches } = await import("./powersync/watch.js");
        if (cancelled) return;
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
            if (sandboxRef.current) { setReservationsLoaded(true); return; } // test service: keep the in-memory planner
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
              } else if (row.id === RESTAURANT_CONFIG_KEY) {
                adoptRestaurantConfiguration(row.state);
              }
            }
          },
        }, range, {
          onError: reportWatchFailure,
          onReady: () => {
            if (cancelled) return;
            watchAttempt = 0;
            setWatchRecoveryPending(false);
            setLastSyncError(null);
            setSyncStatus("live");
          },
        });
        if (cancelled) dispose?.();
      } catch (error) {
        reportWatchFailure({ source: "module", phase: "start", error });
      }
    };
    void start();
    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      dispose?.();
    };
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
        // Adopt the persisted identity as-is. If the LIVE service carries no
        // startedAt, a stamp left over from an earlier service must not stand
        // in for it — the guarded end refuses a stamp the store never held,
        // and the deterministic archive id would collide with that earlier
        // night's entry. Keep the local stamp only while a locally-started
        // service on a DIFFERENT day still owns it.
        if (persistedStartedAt) {
          serviceStartedAtRef.current = persistedStartedAt;
        } else if (!serviceDateRef.current || serviceDateRef.current === persisted) {
          serviceStartedAtRef.current = null;
          try { localStorage.removeItem(workspaceKey("milka_service_started_at")); } catch {}
        }
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
          .then(data => { if (mounted && !sandboxRef.current) setReservations(data); })
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
  // The device-local planner cache must not capture the test service's
  // in-memory bookings (it would paint them on the next real boot until the
  // store refresh lands). Sandbox leaves the real cache untouched.
  useEffect(() => { if (!sandboxRef.current) writeLocalReservations(reservations); }, [reservations]);

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
      if (sandboxRef.current) return; // test service: keep the in-memory planner
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
      } else if (id === RESTAURANT_CONFIG_KEY) {
        adoptRestaurantConfiguration(payload.new?.state);
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
      readStateKey(FLOOR_MAPS_KEY).then(state => {
        adoptFloorMapsRef.current?.(state, new Date().toISOString());
      }).catch(() => {});
      readStateKey(RESTAURANT_CONFIG_KEY).then(state => {
        adoptRestaurantConfiguration(state);
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
    appName: effectiveAppName,
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
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: 6, color: tokens.text.primary }}>{effectiveAppName}</div>
        <div style={{ fontSize: 9, letterSpacing: 4, color: tokens.text.disabled }}>…</div>
      </div>
    );
    if (!sessionChecked) return splash;
    if (!session) return <AuthScreen />;
    if (passwordRecovery) return (
      <PasswordRecoveryScreen
        appName={effectiveAppName}
        onComplete={completePasswordSetup}
      />
    );
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
        <div style={{ fontSize: 13, fontWeight: 600, letterSpacing: 6, color: tokens.text.primary, marginBottom: 6 }}>{effectiveAppName}</div>
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
      appName={effectiveAppName}
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

  // Persistent, mode-independent test-service banner. Fixed to the bottom so it
  // rides above every surface (service, kitchen, floor, admin) and END TEST is
  // always one tap away, whatever the operator navigated into.
  const sandboxBannerEl = sandboxActive ? (
    <div style={{
      position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 300,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 14,
      padding: "9px 14px", flexWrap: "wrap",
      paddingBottom: "max(9px, env(safe-area-inset-bottom))",
      background: tokens.signal.warn, borderTop: `2px solid ${tokens.ink[0]}`,
      fontFamily: FONT,
    }}>
      <span style={{ fontSize: "10px", letterSpacing: "0.14em", textTransform: "uppercase", fontWeight: 700, color: tokens.ink[0] }}>
        ● TEST SERVICE — nothing is saved
      </span>
      <button
        onClick={endTestService}
        style={{
          fontFamily: FONT, fontSize: "10px", letterSpacing: "0.12em", textTransform: "uppercase",
          fontWeight: 700, padding: "8px 16px", border: `1px solid ${tokens.ink[0]}`,
          borderRadius: 0, cursor: "pointer", background: tokens.ink[0], color: tokens.neutral[0],
          touchAction: "manipulation", minHeight: 40,
        }}
      >END TEST</button>
    </div>
  ) : null;

  const renderMode = mode && canAccessMode(currentRole, mode) ? mode : null;

  if (!renderMode) return <>{serviceDatePickerEl}{sandboxBannerEl}<LoginScreen
      onEnter={m => { if (canAccessMode(currentRole, m)) { changeMode(m); setSel(null); } }}
      onSyncAll={canAdmin ? syncWines : undefined}
      role={currentRole}
      canAdmin={canAdmin}
      appName={effectiveAppName}
      workspaceName={currentWorkspace?.name || ""}
      canSwitchProfile={Boolean(supabase) && myWorkspaces.length > 1}
      onSwitchProfile={openProfilePicker}
      onSignOut={supabase ? signOut : undefined}
    /></>;

  // Reservation Manager mode
  if (renderMode === "reservation") return (<>{serviceDatePickerEl}{sandboxBannerEl}<Suspense fallback={lazyViewFallback}><ReservationManager
      reservations={reservations}
      menuCourses={activeMenuCourses}
      tables={displayTables}
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
        tables={displayTables} optionalExtras={dishes} optionalPairings={pairings}
        onArchiveAndClear={archiveAndClearAll}
        onClearAll={clearAll}
        canClearAll={canAdmin}
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
  if (renderMode === "display" || renderMode === "kitchen_floor") return (<>
    {serviceDatePickerEl}{sandboxBannerEl}
    <div style={{ minHeight: "100vh", background: tokens.ink.bg, fontFamily: FONT, overflowX: "hidden", WebkitTextSizeAdjust: "100%" }}>
      <GlobalStyle />
      <Header
        modeLabel="KITCHEN"
        showSummary={false} showMenu={false} showArchive={renderMode === "display" && canAdmin} showInventory={false}
        // The view switch lives IN the header next to the logo — a separate
        // toggle row cost a full row of tickets on the 720px panel.
        viewSwitch={serviceDate ? {
          options: [["tickets", "tickets"], ["terrace", "terrace"], ["dining", "dining room"]],
          active: mode === "display" ? "tickets" : kitchenFloorMap,
          onChange: changeKitchenView,
        } : null}
        {...hProps}
      />
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
      {/* Slim desktop padding: on a 720px-tall kitchen panel every vertical px
          counts toward fitting two full rows of tickets. The TICKETS/TERRACE/
          DINING ROOM switch lives in the Header (viewSwitch) — no toggle row. */}
      <div style={{ padding: appIsMobile ? "12px 10px" : "10px 16px" }}>
        <Suspense fallback={lazyViewFallback}>
          {mode === "kitchen_floor" ? (
            <KitchenFloorView
              mapKind={kitchenFloorMap}
              floorMaps={floorMapsState}
              floorStatus={floorStatus}
              reservations={serviceReservations}
              tables={displayTables}
              menuCourses={activeMenuCourses}
              profiles={profilesState.profiles}
              assignments={profilesState.assignments}
              isMobile={appIsMobile}
              // The kitchen can seat/assign a walked-in party to a terrace
              // table, change its table, set it to the pass, and swap seats /
              // move restrictions — the same service-mode handlers, so its
              // local-first writes work even with the Wi-Fi down (per Djan).
              onAssign={assignTerraceTable}
              onSwapSeats={swapSeats}
              onCycleStatus={(mapId, label) => updateFloorStatus(fs => cycleFloorStatus(fs, mapId, label))}
              onSendSetToKitchen={sendSetToKitchen}
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
            // Feeds the persistent minimap in the board's spare bottom-right
            // space (terrace + active dining layout), so the pass sees WHERE a
            // ticket's food goes without leaving the board.
            floorMaps={floorMapsState}
            // Tap an upcoming banner → seat-only sheet. The kitchen display
            // must be able to seat a walked-in party itself: its local-first
            // writes work with the wifi down, when no other device's seat
            // would reach it (11.07, per Djan).
            onSeat={seatTable}
          />
          )}
        </Suspense>
      </div>
      </>)}
      {archiveOpen && (
        <Suspense fallback={null}>
          <ArchiveModal
            tables={displayTables} optionalExtras={dishes}
            onArchiveAndClear={archiveAndClearAll}
            onClearAll={clearAll}
            canClearAll={canAdmin}
            onClose={() => setArchiveOpen(false)}
            onRestoreTicket={id => upd(id, "kitchenArchived", false)}
            menuCourses={menuCourses}
          />
        </Suspense>
      )}
      {inventoryOpen && <Suspense fallback={null}><InventoryModal wines={wines} onClose={() => setInventoryOpen(false)} /></Suspense>}
    </div>
  </>);

  if (renderMode === "menu") return (
    <div style={{ minHeight: "100vh", background: tokens.ink.bg, fontFamily: FONT, overflowX: "hidden", WebkitTextSizeAdjust: "100%" }}>
      <GlobalStyle />
      {sandboxBannerEl}
      <Suspense fallback={lazyViewFallback}><MenuPage
        tables={displayTables}
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
  if (renderMode === "admin") return (
    <div style={{ minHeight: "100vh", background: tokens.neutral[0], fontFamily: FONT, overflowX: "hidden", WebkitTextSizeAdjust: "100%" }}>
      <GlobalStyle />
      {sandboxBannerEl}
      <Suspense fallback={lazyViewFallback}><AdminLayout
        appName={effectiveAppName}
        restaurantConfig={restaurantConfig}
        onSaveRestaurantConfig={saveRestaurantConfiguration}
        accessToken={session?.access_token || null}
        workspaceId={workspaceId}
        currentUserId={session?.user?.id || null}
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
        boardTables={displayTables}
        onUpdateFloorMaps={updateFloorMaps}
        onApplyLayoutSwitch={applyLayoutSwitchRows}
        restrictionsList={restrictionsList}
        onSaveRestrictions={saveRestrictions}
        courseQuickNotes={courseQuickNotes}
        onSaveCourseQuickNotes={saveCourseQuickNotes}
        onStartTestService={startTestService}
        onExit={() => changeMode(null)}
      /></Suspense>
    </div>
  );

  // Service mode only
  return (<>
    {serviceDatePickerEl}{sandboxBannerEl}
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
            {/* [VIEW] toggle — BOARD / TERRACE / DINING ROOM, one flat row
                (the old two-step floor → map-tab navigation, flattened). */}
            <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
              {[["board", "board"], ["terrace", "terrace"], ["dining", "dining room"]].map(([v, label]) => {
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
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {serviceView === "terrace" || serviceView === "dining" ? (
            /* FLOOR view — the spatial projection of the same board state.
               A dining table is one big SET toggle (tap to flip);
               terrace tables and ARRIVING tables open their action sheet.
               The old TerracePanel's whole terrace leg lives in here. */
            <FloorView
              mapKind={serviceView}
              floorMaps={floorMapsState}
              floorStatus={floorStatus}
              reservations={serviceReservations}
              tables={displayTables}
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
              onSendSetToKitchen={sendSetToKitchen}
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
              const visibleTables = displayTables
                .filter(t => t.active || t.resName || t.resTime)
                .filter(t => !t.tableGroup?.length || t.id === Math.min(...t.tableGroup))
                .map(t => visitByTable[t.id] ? { ...t, _visit: visitByTable[t.id] } : t);

              return (
                <DisplayBoard
                  tables={visibleTables}
                  sittingTimes={SITTING_TIMES}
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
          tables={displayTables}
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
          onMoveTable={async (fromId, toId, mvMode = "auto") => {
            const from = Number(fromId);
            const to = Number(toId);
            const originalTables = tablesRef.current || [];
            const originalReservations = reservations;
            const dst = tablesRef.current?.find(t => t.id === to);
            const dstStarted = dst && (dst.active || dst.arrivedAt
              || (dst.kitchenLog && Object.keys(dst.kitchenLog).length > 0)
              || dst.kitchenArchived);
            const dstHasReservation = !!(dst?.resName || dst?.resTime);
            const dstOccupied = !!(dstStarted || dstHasReservation);
            const useSwap = mvMode === "swap" || (mvMode === "auto" && dstOccupied);
            const result = useSwap ? swapTableState(from, to) : moveTableState(from, to);
            if (!result.ok) return result;

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
                if (srcResv) { const rp = repoint(srcResv); writes.push({ id: srcResv.id, date: srcResv.date, table_id: rp.table_id, data: rp.data }); }
                if (dstResv && dstResv.id !== srcResv?.id) { const rp = repoint(dstResv); writes.push({ id: dstResv.id, date: dstResv.date, table_id: rp.table_id, data: rp.data }); }
                const persisted = await persistReservationRows(writes);
                if (!persisted.ok) {
                  setTables(originalTables);
                  setReservations(originalReservations);
                  const error = persisted.error || new Error("Reservation table move persistence failed.");
                  setSyncStatus("sync-error");
                  noteSyncError("detail table move", error);
                  recordClientDiagnostic("detail table move", error);
                  if (typeof window !== "undefined") window.alert("Table move failed. The original assignments were restored.");
                  return { ok: false, reason: "persist-failed", error };
                }
              }
            }
            setSel(to);
            return { ...result, swapped: useSwap };
          }}
          reservationOnTable={reservationOnTable}
          mapSeatCap={mapSeatCountForBoardTable(getActiveDiningMap(floorMapsState), sel)}
        />
      )}

      {summaryOpen && (
        <Suspense fallback={null}>
          <SummaryModal tables={displayTables} optionalExtras={dishes} optionalPairings={pairings} celebrationKeys={celebrationKeys} onClose={() => setSummaryOpen(false)} />
        </Suspense>
      )}
      {archiveOpen && (
        <Suspense fallback={null}>
          <ArchiveModal
            tables={displayTables} optionalExtras={dishes} optionalPairings={pairings}
            onArchiveAndClear={archiveAndClearAll}
            onClearAll={clearAll}
            canClearAll={canAdmin}
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
            tables={displayTables}
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
