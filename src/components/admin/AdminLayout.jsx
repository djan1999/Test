import { useState } from "react";
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
  onResetMenuLayout,
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

  const navOpen = navPinned || navHover;
  const NAV_W_OPEN = 220;
  const NAV_W_CLOSED = 56;

  return (
    <div style={{
      minHeight: "100vh", background: "#fff", fontFamily: FONT,
      display: "flex", flexDirection: "column",
    }}>
      {/* Top header bar */}
      <div style={{
        borderBottom: "1px solid #f0f0f0", padding: "12px 20px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "#fff", position: "sticky", top: 0, zIndex: 50,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: 4, color: "#1a1a1a" }}>{APP_NAME}</span>
          <span style={{ width: 1, height: 14, background: "#e8e8e8" }} />
          <span style={{ fontSize: 10, letterSpacing: 3, color: "#4b4b88", textTransform: "uppercase", fontWeight: 700 }}>ADMIN</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px",
            border: `1px solid ${syncStatus === "live" ? "#8fc39f" : "#d8d8d8"}`,
            borderRadius: 999,
            background: syncStatus === "live" ? "#eef8f1" : "#f6f6f6",
            color: syncStatus === "live" ? "#2f7a45" : "#555",
            fontWeight: 600, whiteSpace: "nowrap",
          }}>{syncStatus === "live" ? "SYNC" : syncStatus === "local-only" ? "LOCAL" : syncStatus === "connecting" ? "LINK" : "ERROR"}</span>
          <button onClick={onExit} style={{
            fontFamily: FONT, fontSize: 9, letterSpacing: 2, padding: "6px 10px",
            border: "1px solid #e8e8e8", borderRadius: 999, cursor: "pointer",
            background: "#fff", color: "#1a1a1a", flexShrink: 0,
          }}>EXIT</button>
        </div>
      </div>

      {/* Main content: sidebar + panel */}
      <div style={{ display: "flex", flex: 1 }}>
        {/* Sidebar */}
        <nav style={{
          width: navOpen ? NAV_W_OPEN : NAV_W_CLOSED, flexShrink: 0, borderRight: "1px solid #f0f0f0",
          padding: "20px 0", background: "#fafafa",
          position: "sticky", top: 52, height: "calc(100vh - 52px)",
          overflowY: "auto",
          transition: "width 0.16s ease",
          overflowX: "hidden",
        }}>
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
                border: "1px solid #e8e8e8",
                borderRadius: 8,
                background: "#fff",
                cursor: "pointer",
                color: navPinned ? "#4b4b88" : "#999",
                fontFamily: FONT,
                fontSize: 9,
                letterSpacing: 1.5,
                textTransform: "uppercase",
              }}
            >
              <span style={{ fontSize: 14, width: 20, textAlign: "center" }}>{navPinned ? "📌" : "☰"}</span>
              {navOpen && <span style={{ flex: 1, textAlign: "left" }}>{navPinned ? "Pinned" : "Hover to open"}</span>}
              {navOpen && <span style={{ color: "#ccc" }}>{navPinned ? "ON" : "OFF"}</span>}
            </button>
          </div>
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: navOpen ? "12px 20px" : "12px 0", border: "none",
                background: activeSection === s.id ? "#fff" : "transparent",
                borderLeft: activeSection === s.id ? "3px solid #4b4b88" : "3px solid transparent",
                cursor: "pointer", transition: "all 0.1s",
                fontFamily: FONT, fontSize: 10, letterSpacing: 1,
                color: activeSection === s.id ? "#1a1a1a" : "#888",
                fontWeight: activeSection === s.id ? 600 : 400,
                textAlign: "left",
                justifyContent: navOpen ? "flex-start" : "center",
              }}
            >
              <span style={{ fontSize: 14, color: activeSection === s.id ? "#4b4b88" : "#ccc", width: 20, textAlign: "center" }}>{s.icon}</span>
              {navOpen && s.label}
            </button>
          ))}
        </nav>

        {/* Panel content */}
        <main style={{ flex: 1, padding: "24px 24px", maxWidth: activeSection === "menu" ? "none" : 900, overflowY: "auto" }}>
          {activeSection === "menu" && (
            <div>
              <div style={{ fontFamily: FONT, fontSize: 9, letterSpacing: 2, color: "#888", textTransform: "uppercase", marginBottom: 20 }}>
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
                <div style={{ border: "1px solid #f0f0f0", borderRadius: 6, overflow: "hidden", background: "#fff" }}>
                  <button
                    onClick={() => setDishesCoursesOpen(v => !v)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 14px",
                      border: "none",
                      background: "#fafafa",
                      cursor: "pointer",
                      fontFamily: FONT,
                    }}
                    title={dishesCoursesOpen ? "Collapse" : "Expand"}
                  >
                    <span style={{ fontSize: 9, letterSpacing: 2, color: "#4b4b88", textTransform: "uppercase", fontWeight: 700 }}>
                      ◈ Courses
                    </span>
                    <span style={{ fontSize: 12, color: "#bbb" }}>{dishesCoursesOpen ? "▾" : "▸"}</span>
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
                  fontFamily: FONT, fontSize: 10, color: "#999",
                  border: "1px solid #f0f0f0", borderRadius: 6,
                  background: "#fafafa", padding: "12px 14px", lineHeight: 1.5,
                }}>
                  Optional extras are now driven directly from each course’s `optional_flag` in Courses.
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
              onResetMenuLayout={onResetMenuLayout}
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
