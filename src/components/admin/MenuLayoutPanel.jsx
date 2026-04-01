/**
 * MenuLayoutPanel — tabbed container for the Menu Layout section.
 *
 * Tab "BUILDER"  → visual drag-and-drop layout composer (MenuLayoutBuilder)
 * Tab "COURSES"  → per-course dish/pairing/restriction editor (CourseEditorPanel)
 */

import { useState } from "react";
import { FONT } from "./adminStyles.js";
import MenuLayoutBuilder from "./MenuLayoutBuilder.jsx";
import CourseEditorPanel from "./CourseEditorPanel.jsx";

export default function MenuLayoutPanel({
  // Course data
  menuCourses,
  onUpdateCourses,
  onSaveCourses,
  // Visual layout
  visualLayout,
  onUpdateVisualLayout,
  onSaveVisualLayout,
  visualSaving,
  visualSaved,
}) {
  const [activeTab, setActiveTab] = useState("builder");

  const tabBtn = (id, label) => (
    <button
      key={id}
      onClick={() => setActiveTab(id)}
      style={{
        fontFamily: FONT, fontSize: 9, letterSpacing: 1, padding: "6px 16px",
        border: "none", borderBottom: `2px solid ${activeTab === id ? "#4b4b88" : "transparent"}`,
        borderRadius: 0, cursor: activeTab === id ? "default" : "pointer",
        background: "transparent",
        color: activeTab === id ? "#4b4b88" : "#aaa",
        fontWeight: activeTab === id ? 700 : 400,
        transition: "all 0.12s",
      }}
    >{label}</button>
  );

  return (
    <div>
      {/* Tab bar */}
      <div style={{
        display: "flex", gap: 0, borderBottom: "1px solid #f0f0f0",
        marginBottom: 24,
      }}>
        {tabBtn("builder", "▨ LAYOUT BUILDER")}
        {tabBtn("courses", "◈ COURSES")}
      </div>

      {activeTab === "builder" && (
        <MenuLayoutBuilder
          visualLayout={visualLayout}
          menuCourses={menuCourses}
          onUpdateLayout={onUpdateVisualLayout}
          onSaveLayout={onSaveVisualLayout}
          saving={visualSaving}
          saved={visualSaved}
        />
      )}

      {activeTab === "courses" && (
        <CourseEditorPanel
          menuCourses={menuCourses}
          onUpdateCourses={onUpdateCourses}
          onSaveCourses={onSaveCourses}
        />
      )}
    </div>
  );
}
