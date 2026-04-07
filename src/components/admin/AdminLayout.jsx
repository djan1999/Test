import { useState } from "react";
import { FONT } from "./adminStyles.js";
import MenuLayoutPanel from "./MenuLayoutPanel.jsx";
import CourseEditorPanel from "./CourseEditorPanel.jsx";
import DishesPanel from "./DishesPanel.jsx";
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
  onUpdateDishes,
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
  const [dishesTab, setDishesTab] = useState("courses");

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
          width: 220, flexShrink: 0, borderRight: "1px solid #f0f0f0",
          padding: "20px 0", background: "#fafafa",
          position: "sticky", top: 52, height: "calc(100vh - 52px)",
          overflowY: "auto",
        }}>
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                width: "100%", padding: "12px 20px", border: "none",
                background: activeSection === s.id ? "#fff" : "transparent",
                borderLeft: activeSection === s.id ? "3px solid #4b4b88" : "3px solid transparent",
                cursor: "pointer", transition: "all 0.1s",
                fontFamily: FONT, fontSize: 10, letterSpacing: 1,
                color: activeSection === s.id ? "#1a1a1a" : "#888",
                fontWeight: activeSection === s.id ? 600 : 400,
                textAlign: "left",
              }}
            >
              <span style={{ fontSize: 14, color: activeSection === s.id ? "#4b4b88" : "#ccc", width: 20, textAlign: "center" }}>{s.icon}</span>
              {s.label}
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
              {/* Tab bar */}
              <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #f0f0f0", marginBottom: 24 }}>
                {[["courses", "◈ COURSES"], ["dishes", "◈ DISHES & RESTRICTIONS"]].map(([id, label]) => (
                  <button key={id} onClick={() => setDishesTab(id)} style={{
                    fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 16px",
                    border: "none", borderBottom: `2px solid ${dishesTab === id ? "#4b4b88" : "transparent"}`,
                    borderRadius: 0, cursor: dishesTab === id ? "default" : "pointer",
                    background: "transparent",
                    color: dishesTab === id ? "#4b4b88" : "#aaa",
                    fontWeight: dishesTab === id ? 700 : 400,
                  }}>{label}</button>
                ))}
              </div>
              {dishesTab === "courses" && (
                <CourseEditorPanel
                  menuCourses={menuCourses}
                  onUpdateCourses={onUpdateMenuCourses}
                  onSaveCourses={onSaveMenuCourses}
                />
              )}
              {dishesTab === "dishes" && (
                <DishesPanel
                  dishes={dishes}
                  onUpdateDishes={onUpdateDishes}
                />
              )}
            </div>
          )}

          {activeSection === "drinks" && (
            <DrinksPanel
              dishes={dishes}
              wines={wines}
              cocktails={cocktails}
              spirits={spirits}
              beers={beers}
              onUpdateDishes={onUpdateDishes}
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
