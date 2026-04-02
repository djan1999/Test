/**
 * MenuLayoutPanel — tabbed container for the Menu Layout section.
 *
 * Tab "TEMPLATE"  → row-based A5 canvas template editor (MenuTemplateEditor)
 * Tab "COURSES"   → per-course dish/pairing/restriction editor (CourseEditorPanel)
 */

import { useState } from "react";
import { FONT } from "./adminStyles.js";
import MenuTemplateEditor from "./MenuTemplateEditor.jsx";
import CourseEditorPanel from "./CourseEditorPanel.jsx";

export default function MenuLayoutPanel({
  // Course data
  menuCourses,
  onUpdateCourses,
  onSaveCourses,
  // Template (v2)
  menuTemplate,
  onUpdateTemplate,
  onSaveTemplate,
  templateSaving,
  templateSaved,
  logoDataUri,
}) {
  const [activeTab, setActiveTab] = useState("template");

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
      <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #f0f0f0", marginBottom: 24 }}>
        {tabBtn("template", "▨ LAYOUT BUILDER")}
        {tabBtn("courses",  "◈ COURSES")}
      </div>

      {activeTab === "template" && (
        <MenuTemplateEditor
          menuTemplate={menuTemplate}
          onUpdateTemplate={onUpdateTemplate}
          onSaveTemplate={onSaveTemplate}
          saving={templateSaving}
          saved={templateSaved}
          menuCourses={menuCourses}
          logoDataUri={logoDataUri}
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
