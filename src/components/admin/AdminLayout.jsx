import { useState } from "react";
import { tokens } from "../../styles/tokens.js";
import { useIsMobile } from "../../hooks/useIsMobile.js";
import { FONT } from "./adminStyles.js";
import MenuLayoutPanel from "./MenuLayoutPanel.jsx";
import CourseEditorPanel from "./CourseEditorPanel.jsx";
import DrinksPanel from "./DrinksPanel.jsx";
import InventoryPanel from "./InventoryPanel.jsx";
import SystemPanel from "./SystemPanel.jsx";
import ArchivePanel from "./ArchivePanel.jsx";
import QuickAccessPanel from "./QuickAccessPanel.jsx";

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
  // Navigation
  onExit,
}) {
  const [activeSection, setActiveSection] = useState("menu");
  const [dishesCoursesOpen, setDishesCoursesOpen] = useState(true);
  const [navPinned, setNavPinned] = useState(false);
  const [navHover, setNavHover] = useState(false);
  const isMobile = useIsMobile(768);

  const navOpen = navPinned || navHover;
  const NAV_W_OPEN = 220;
  const NAV_W_CLOSED = 56;

  return (
    <div style={{
      minHeight: "100vh", background: tokens.surface.card, fontFamily: FONT,
      display: "flex", flexDirection: "column",
    }}>
      {/* Top header bar */}
      <div style={{
        borderBottom: tokens.border.subtle,
        padding: isMobile ? "10px 12px" : "12px 20px",
        paddingTop: `max(${isMobile ? 10 : 12}px, env(safe-area-inset-top))`,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: tokens.surface.card, position: "sticky", top: 0, zIndex: 50,
        gap: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 10 : 16, minWidth: 0 }}>
          <span style={{ fontSize: isMobile ? 12 : 13, fontWeight: 600, letterSpacing: isMobile ? 3 : 4, color: tokens.text.primary }}>{APP_NAME}</span>
          <span style={{ width: 1, height: 14, background: tokens.neutral[300] }} />
          <span style={{ fontSize: 10, letterSpacing: isMobile ? 2 : 3, color: tokens.text.secondary, textTransform: "uppercase", fontWeight: 700 }}>ADMIN</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 6 : 8, flexShrink: 0 }}>
          <span style={{
            fontFamily: FONT, fontSize: isMobile ? 10 : 9, letterSpacing: isMobile ? 1.5 : 2,
            padding: isMobile ? "8px 10px" : "6px 10px",
            border: `1px solid ${syncStatus === "live" ? tokens.green.border : tokens.neutral[300]}`,
            borderRadius: 0,
            background: syncStatus === "live" ? tokens.green.bg : tokens.neutral[50],
            color: syncStatus === "live" ? tokens.green.text : tokens.text.muted,
            fontWeight: 600, whiteSpace: "nowrap",
            minHeight: isMobile ? 36 : undefined,
            display: "inline-flex", alignItems: "center",
          }}>{syncStatus === "live" ? "SYNC" : syncStatus === "local-only" ? "LOCAL" : syncStatus === "connecting" ? "LINK" : "ERROR"}</span>
          <button onClick={onExit} style={{
            fontFamily: FONT, fontSize: isMobile ? 10 : 9, letterSpacing: isMobile ? 1.5 : 2,
            padding: isMobile ? "8px 12px" : "6px 10px",
            border: tokens.border.default, borderRadius: 0, cursor: "pointer",
            background: tokens.surface.card, color: tokens.text.primary, flexShrink: 0,
            minHeight: isMobile ? 36 : undefined,
          }}>EXIT</button>
        </div>
      </div>

      {/* Mobile: horizontal section tabs (replaces sidebar) */}
      {isMobile && (
        <div style={{
          display: "flex", overflowX: "auto", WebkitOverflowScrolling: "touch",
          borderBottom: tokens.border.subtle,
          background: tokens.neutral[50],
          position: "sticky", top: "calc(env(safe-area-inset-top) + 52px)", zIndex: 49,
        }}>
          {SECTIONS.map(s => {
            const active = activeSection === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setActiveSection(s.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 8,
                  flexShrink: 0, padding: "12px 14px",
                  border: "none",
                  borderBottom: `2px solid ${active ? tokens.charcoal.default : "transparent"}`,
                  background: active ? tokens.surface.card : "transparent",
                  cursor: "pointer",
                  fontFamily: FONT, fontSize: 10, letterSpacing: 1.2,
                  color: active ? tokens.text.primary : tokens.text.muted,
                  fontWeight: active ? 600 : 400,
                  textTransform: "uppercase", whiteSpace: "nowrap",
                  minHeight: 40,
                }}
              >
                <span style={{ fontSize: 13, color: active ? tokens.charcoal.default : tokens.neutral[400] }}>{s.icon}</span>
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
          width: navOpen ? NAV_W_OPEN : NAV_W_CLOSED, flexShrink: 0, borderRight: tokens.border.subtle,
          padding: "20px 0", background: tokens.neutral[50],
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
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: navOpen ? "space-between" : "center",
                gap: 8,
                padding: navOpen ? "8px 10px" : "8px 0",
                border: tokens.border.default,
                borderRadius: 0,
                background: tokens.surface.card,
                cursor: "pointer",
                color: navPinned ? tokens.text.secondary : tokens.text.muted,
                fontFamily: FONT,
                fontSize: 9,
                letterSpacing: 1.5,
                textTransform: "uppercase",
              }}
            >
              <span style={{ fontSize: 14, width: 20, textAlign: "center" }}>{navPinned ? "📌" : "☰"}</span>
              {navOpen && <span style={{ flex: 1, textAlign: "left" }}>{navPinned ? "Pinned" : "Hover to open"}</span>}
              {navOpen && <span style={{ color: tokens.neutral[300] }}>{navPinned ? "ON" : "OFF"}</span>}
            </button>
          </div>
          {SECTIONS.map(s => (
            <button
              key={s.id}
              type="button"
              title={s.label}
              onClick={() => setActiveSection(s.id)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: navOpen ? "12px 20px" : "12px 0", border: "none",
                background: activeSection === s.id ? tokens.surface.card : "transparent",
                borderLeft: activeSection === s.id ? `3px solid ${tokens.charcoal.default}` : "3px solid transparent",
                cursor: "pointer", transition: "all 0.1s",
                fontFamily: FONT, fontSize: 10, letterSpacing: 1,
                color: activeSection === s.id ? tokens.text.primary : tokens.text.muted,
                fontWeight: activeSection === s.id ? 600 : 400,
                textAlign: "left",
                justifyContent: navOpen ? "flex-start" : "center",
              }}
            >
              <span style={{ fontSize: 14, color: activeSection === s.id ? tokens.charcoal.default : tokens.neutral[300], width: 20, textAlign: "center" }}>{s.icon}</span>
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
              <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: tokens.text.muted, textTransform: "uppercase", marginBottom: 20 }}>
                MENU LAYOUT — template editor · single source of truth
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
              />
            </div>
          )}

          {activeSection === "dishes" && (
            <div>
              {/* Combined view: Courses + Dishes/Restrictions */}
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <div style={{ border: tokens.border.subtle, borderRadius: 0, overflow: "hidden", background: tokens.surface.card }}>
                  <button
                    onClick={() => setDishesCoursesOpen(v => !v)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      border: "none",
                      background: tokens.neutral[50],
                      cursor: "pointer",
                      fontFamily: FONT,
                    }}
                    title={dishesCoursesOpen ? "Collapse" : "Expand"}
                  >
                    <span style={{ fontSize: 9, letterSpacing: 2, color: tokens.charcoal.default, textTransform: "uppercase", fontWeight: 700 }}>
                      ◈ Courses
                    </span>
                    <span style={{ fontSize: 12, color: tokens.neutral[400] }}>{dishesCoursesOpen ? "▾" : "▸"}</span>
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
                  fontFamily: FONT, fontSize: 10, color: tokens.text.muted,
                  border: tokens.border.subtle, borderRadius: 0,
                  background: tokens.neutral[50], padding: "12px 14px", lineHeight: 1.5,
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
