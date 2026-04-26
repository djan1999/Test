import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { useIsMobile, BP } from "../../hooks/useIsMobile.js";
import { FONT } from "./adminStyles.js";
import MenuLayoutPanel from "./MenuLayoutPanel.jsx";
import CourseEditorPanel from "./CourseEditorPanel.jsx";
import DrinksPanel from "./DrinksPanel.jsx";
import InventoryPanel from "./InventoryPanel.jsx";
import SystemPanel from "./SystemPanel.jsx";
import ArchivePanel from "./ArchivePanel.jsx";
import QuickAccessPanel from "./QuickAccessPanel.jsx";
import { useModalEscape } from "../../hooks/useModalEscape.js";

const APP_NAME = String(import.meta.env.VITE_APP_NAME || "MILKA").trim() || "MILKA";

const SECTIONS = [
  { id: "menu",        label: "Menu Layout",           icon: "▨" },
  { id: "dishes",      label: "Dishes & Restrictions",  icon: "◈" },
  { id: "drinks",      label: "Drinks & Pairings",      icon: "◎" },
  { id: "quickaccess", label: "Quick Access",            icon: "◇" },
  { id: "inventory",   label: "Inventory / Sync",        icon: "↻" },
  { id: "system",      label: "System",                  icon: "◆" },
  { id: "archive",     label: "Archive",                 icon: "◫" },
];

// ── AdminLayout — modular admin control panel ──
// Pure control panel. No service UI, no reservations, no seating.
export default function AdminLayout({
  // Menu data
  menuCourses,
  onUpdateMenuCourses,
  onSaveMenuCourses,
  // Template v2
  menuTemplate,
  onUpdateTemplate,
  onSaveTemplate,
  templateSaving,
  templateSaved,
  menuRules,
  onUpdateMenuRules,
  onSaveMenuRules,
  menuRulesSaving,
  menuRulesSaved,
  // Dish data
  dishes,
  // Drinks data
  wines,
  cocktails,
  spirits,
  beers,
  onUpdateWines,
  onSaveBeverages,
  // Sync
  onSyncWines,
  // System
  syncStatus,
  supabaseUrl,
  hasSupabase,
  logoDataUri,
  onSaveLogo,
  layoutStyles = {},
  onUpdateLayoutStyles,
  onSaveLayoutStyles,
  layoutProfiles,
  activeLayoutProfileId,
  onSelectLayoutProfile,
  onCreateLayoutProfile,
  onDeleteLayoutProfile,
  wineSyncConfig,
  onUpdateWineSyncConfig,
  onSaveWineSyncConfig,
  // Quick Access
  quickAccessItems,
  onUpdateQuickAccess,
  aperitifOptions = [],
  // Navigation
  onExit,
}) {
  const [activeSection, setActiveSection] = useState("menu");
  const [dishesCoursesOpen, setDishesCoursesOpen] = useState(true);
  // Pin sidebar open by default on coarse-pointer devices (touchscreens) so
  // staff don't have to rely on a hover that touch input can't deliver.
  const [navPinned, setNavPinned] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(hover: none), (pointer: coarse)").matches;
  });
  const [navHover, setNavHover] = useState(false);
  const isMobile = useIsMobile(BP.lg);

  useModalEscape(onExit);

  const navOpen = navPinned || navHover;
  const NAV_W_OPEN = 220;
  const NAV_W_CLOSED = 56;

  return (
    <div style={{
      minHeight: "100vh", background: tokens.ink.bg, fontFamily: FONT,
      display: "flex", flexDirection: "column",
    }}>
      {/* Top header bar */}
      <div style={{
        borderBottom: `1px solid ${tokens.ink[4]}`,
        padding: isMobile ? "10px 12px" : "12px 20px",
        paddingTop: `max(${isMobile ? 10 : 12}px, env(safe-area-inset-top))`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: tokens.neutral[0], position: "sticky", top: 0, zIndex: 50,
        gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 16, minWidth: 0 }}>
          <span style={{ fontSize: isMobile ? 12 : 13, fontWeight: 600, letterSpacing: isMobile ? 3 : 4, color: tokens.ink[0] }}>{APP_NAME}</span>
          <span style={{ width: 1, height: 14, background: tokens.ink[4] }} />
          <span style={{ fontSize: 10, letterSpacing: isMobile ? 2 : 3, color: tokens.ink[2], textTransform: "uppercase", fontWeight: 700 }}>ADMIN</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 6 : 8, flexShrink: 0 }}>
          <span style={{
            fontFamily: FONT, fontSize: isMobile ? 10 : 9, letterSpacing: isMobile ? 1.5 : 2,
            padding: isMobile ? "12px 12px" : "6px 10px",
            border: `1px solid ${syncStatus === "live" ? tokens.green.border : tokens.ink[4]}`,
            borderRadius: 0,
            background: syncStatus === "live" ? tokens.green.bg : tokens.neutral[0],
            color: syncStatus === "live" ? tokens.green.text : tokens.ink[3],
            fontWeight: 600, whiteSpace: "nowrap",
            minHeight: isMobile ? 44 : undefined,
            display: "inline-flex", alignItems: "center",
          }}>{syncStatus === "live" ? "SYNC" : syncStatus === "local-only" ? "LOCAL" : syncStatus === "connecting" ? "LINK" : "ERROR"}</span>
          <button onClick={onExit} style={{
            fontFamily: FONT, fontSize: isMobile ? 10 : 9, letterSpacing: isMobile ? 1.5 : 2,
            padding: isMobile ? "12px 14px" : "6px 10px",
            border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, cursor: "pointer",
            background: tokens.neutral[0], color: tokens.ink[0], flexShrink: 0,
            minHeight: isMobile ? 44 : undefined,
            touchAction: "manipulation",
          }}>EXIT</button>
        </div>
      </div>

      {/* Mobile: horizontal section tabs (replaces sidebar) */}
      {isMobile && (
        <div style={{
          display: "flex", overflowX: "auto", WebkitOverflowScrolling: "touch",
          borderBottom: `1px solid ${tokens.ink[4]}`,
          background: tokens.neutral[0],
          position: "sticky", top: "calc(env(safe-area-inset-top) + 52px)", zIndex: 49,
        }}>
          {SECTIONS.map(s => {
            const active = activeSection === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveSection(s.id)}
                aria-pressed={active}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  flexShrink: 0, padding: "14px 16px",
                  border: "none",
                  borderBottom: `2px solid ${active ? tokens.charcoal.default : "transparent"}`,
                  background: active ? tokens.neutral[0] : "transparent",
                  cursor: "pointer",
                  fontFamily: FONT, fontSize: 10, letterSpacing: 1.2,
                  color: active ? tokens.ink[0] : tokens.ink[3],
                  fontWeight: active ? 600 : 400,
                  textTransform: "uppercase", whiteSpace: "nowrap",
                  minHeight: 44,
                  touchAction: "manipulation",
                }}
              >
                <span style={{ fontSize: 13, color: active ? tokens.charcoal.default : tokens.ink[3] }}>{s.icon}</span>
                {s.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Main content: sidebar + panel (sidebar hidden on mobile) */}
      <div style={{ display: "flex", flex: 1 }}>
        {/* Sidebar — desktop only */}
        {!isMobile && <nav
          onMouseEnter={() => setNavHover(true)}
          onMouseLeave={() => setNavHover(false)}
          onFocus={() => setNavHover(true)}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setNavHover(false);
          }}
          style={{
          width: navOpen ? NAV_W_OPEN : NAV_W_CLOSED, flexShrink: 0, borderRight: `1px solid ${tokens.ink[4]}`,
          padding: "20px 0", background: tokens.neutral[0],
          position: "sticky", top: 52, height: "calc(100vh - 52px)",
          overflowY: "auto",
          transition: "width 0.16s ease",
          overflowX: "hidden",
        }}
        >
          <div style={{ padding: navOpen ? "0 12px 10px" : "0 8px 10px" }}>
            <button
              onClick={() => setNavPinned(v => !v)}
              title={navPinned ? "Unpin sidebar" : "Pin sidebar open"}
              aria-label={navPinned ? "Unpin sidebar" : "Pin sidebar open"}
              aria-pressed={navPinned}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: navOpen ? "space-between" : "center",
                gap: 8,
                padding: navOpen ? "8px 10px" : "8px 0",
                border: `1px solid ${tokens.ink[4]}`,
                borderRadius: 0,
                background: tokens.neutral[0],
                cursor: "pointer",
                color: navPinned ? tokens.ink[2] : tokens.ink[3],
                fontFamily: FONT,
                fontSize: 9,
                letterSpacing: 1.5,
                textTransform: "uppercase",
              }}
            >
              <span aria-hidden="true" style={{ fontSize: 14, width: 20, textAlign: "center" }}>{navPinned ? "📌" : "☰"}</span>
              {navOpen && <span style={{ flex: 1, textAlign: "left" }}>{navPinned ? "Pinned" : "Tap to pin"}</span>}
              {navOpen && <span style={{ color: tokens.ink[4] }}>{navPinned ? "ON" : "OFF"}</span>}
            </button>
          </div>
          {SECTIONS.map(s => (
            <button
              key={s.id}
              type="button"
              title={s.label}
              aria-label={s.label}
              aria-pressed={activeSection === s.id}
              onClick={() => setActiveSection(s.id)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: navOpen ? "14px 20px" : "14px 0", border: "none",
                background: activeSection === s.id ? tokens.neutral[0] : "transparent",
                borderLeft: activeSection === s.id ? `3px solid ${tokens.charcoal.default}` : "3px solid transparent",
                cursor: "pointer", transition: "all 0.1s",
                fontFamily: FONT, fontSize: 10, letterSpacing: 1,
                color: activeSection === s.id ? tokens.ink[0] : tokens.ink[3],
                fontWeight: activeSection === s.id ? 600 : 400,
                textAlign: "left",
                justifyContent: navOpen ? "flex-start" : "center",
                minHeight: 44,
                touchAction: "manipulation",
              }}
            >
              <span style={{ fontSize: 14, color: activeSection === s.id ? tokens.charcoal.default : tokens.ink[4], width: 20, textAlign: "center" }}>{s.icon}</span>
              {navOpen && s.label}
            </button>
          ))}
        </nav>}

        {/* Panel content */}
        <main style={{
          flex: 1,
          padding: isMobile ? "16px 12px" : "24px 24px",
          paddingBottom: isMobile ? "calc(40px + env(safe-area-inset-bottom))" : 24,
          maxWidth: activeSection === "menu" ? "none" : 900,
          overflowY: "auto",
          overflowX: "hidden",
        }}>
          {activeSection === "menu" && (
            <div>
              <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: 2, color: tokens.ink[3], textTransform: "uppercase", marginBottom: 20 }}>
                [MENU LAYOUT]
              </div>
              <MenuLayoutPanel
                menuCourses={menuCourses}
                menuTemplate={menuTemplate}
                onUpdateLayoutStyles={onUpdateLayoutStyles}
                onSaveLayoutStyles={onSaveLayoutStyles}
                onUpdateTemplate={onUpdateTemplate}
                onSaveTemplate={onSaveTemplate}
                templateSaving={templateSaving}
                templateSaved={templateSaved}
                menuRules={menuRules}
                onUpdateMenuRules={onUpdateMenuRules}
                onSaveMenuRules={onSaveMenuRules}
                menuRulesSaving={menuRulesSaving}
                menuRulesSaved={menuRulesSaved}
                logoDataUri={logoDataUri}
                layoutStyles={layoutStyles}
                wines={wines}
                cocktails={cocktails}
                spirits={spirits}
                beers={beers}
                aperitifOptions={aperitifOptions}
              />
            </div>
          )}

          {activeSection === "dishes" && (
            <div>
              {/* Combined view: Courses + Dishes/Restrictions */}
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div style={{ border: `1px solid ${tokens.ink[4]}`, borderRadius: 0, overflow: "hidden", background: tokens.neutral[0] }}>
                  <button
                    onClick={() => setDishesCoursesOpen(v => !v)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      border: "none",
                      background: tokens.ink.bg,
                      cursor: "pointer",
                      fontFamily: FONT,
                    }}
                    title={dishesCoursesOpen ? "Collapse" : "Expand"}
                  >
                    <span style={{ fontSize: 9, letterSpacing: 2, color: tokens.charcoal.default, textTransform: "uppercase", fontWeight: 700 }}>
                      ◈ Courses
                    </span>
                    <span style={{ fontSize: 12, color: tokens.ink[3] }}>{dishesCoursesOpen ? "▾" : "▸"}</span>
                  </button>
                  {dishesCoursesOpen && (
                    <div style={{ padding: "14px 14px 16px" }}>
                      <CourseEditorPanel
                        menuCourses={menuCourses}
                        onUpdateCourses={onUpdateMenuCourses}
                        onSaveCourses={onSaveMenuCourses}
                      />
                    </div>
                  )}
                </div>

                <div style={{
                  fontFamily: FONT, fontSize: 10, color: tokens.ink[3],
                  border: `1px solid ${tokens.ink[4]}`, borderRadius: 0,
                  background: tokens.neutral[0], padding: "12px 14px", lineHeight: 1.5,
                }}>
                  Optional extras are now driven directly from each course's `optional_flag` in Courses.
                  There is no separate Extra Dishes editor anymore.
                </div>
              </div>
            </div>
          )}

          {activeSection === "drinks" && (
            <DrinksPanel
              dishes={dishes}
              wines={wines}
              cocktails={cocktails}
              spirits={spirits}
              beers={beers}
              onUpdateWines={onUpdateWines}
              onSaveBeverages={onSaveBeverages}
            />
          )}

          {activeSection === "quickaccess" && (
            <QuickAccessPanel
              quickAccessItems={quickAccessItems}
              onUpdateQuickAccess={onUpdateQuickAccess}
              wines={wines}
              cocktails={cocktails}
              spirits={spirits}
              beers={beers}
            />
          )}

          {activeSection === "inventory" && (
            <InventoryPanel
              onSyncWines={onSyncWines}
              wines={wines}
            />
          )}

          {activeSection === "system" && (
            <SystemPanel
              syncStatus={syncStatus}
              supabaseUrl={supabaseUrl}
              hasSupabase={hasSupabase}
              onSyncWines={onSyncWines}
              logoDataUri={logoDataUri}
              onSaveLogo={onSaveLogo}
              layoutStyles={layoutStyles}
              onUpdateLayoutStyles={onUpdateLayoutStyles}
              onSaveLayoutStyles={onSaveLayoutStyles}
              layoutProfiles={layoutProfiles}
              activeLayoutProfileId={activeLayoutProfileId}
              onSelectLayoutProfile={onSelectLayoutProfile}
              onCreateLayoutProfile={onCreateLayoutProfile}
              onDeleteLayoutProfile={onDeleteLayoutProfile}
              wineSyncConfig={wineSyncConfig}
              onUpdateWineSyncConfig={onUpdateWineSyncConfig}
              onSaveWineSyncConfig={onSaveWineSyncConfig}
            />
          )}

          {activeSection === "archive" && (
            <ArchivePanel />
          )}
        </main>
      </div>
    </div>
  );
}
