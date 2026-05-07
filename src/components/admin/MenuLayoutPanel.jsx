import MenuTemplateEditor from "./MenuTemplateEditor.jsx";
import MenuLayoutsEditor from "./MenuLayoutsEditor.jsx";

export default function MenuLayoutPanel({
  menuCourses,
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
  logoDataUri,
  layoutStyles = {},
  onUpdateLayoutStyles,
  onSaveLayoutStyles,
  wines = [],
  cocktails = [],
  spirits = [],
  beers = [],
  aperitifOptions = [],
  // Named Menu Layouts
  menuLayouts = [],
  layoutAssignments = {},
  onUpdateMenuLayouts,
}) {
  return (
    <div>
      <MenuLayoutsEditor
        menuLayouts={menuLayouts}
        layoutAssignments={layoutAssignments}
        onUpdateMenuLayouts={onUpdateMenuLayouts}
        menuCourses={menuCourses}
        menuTemplate={menuTemplate}
        layoutStyles={layoutStyles}
        menuRules={menuRules}
        logoDataUri={logoDataUri}
      />
      <MenuTemplateEditor
        menuTemplate={menuTemplate}
        onUpdateTemplate={onUpdateTemplate}
        onSaveTemplate={onSaveTemplate}
        onUpdateLayoutStyles={onUpdateLayoutStyles}
        onSaveLayoutStyles={onSaveLayoutStyles}
        saving={templateSaving}
        saved={templateSaved}
        menuRules={menuRules}
        onUpdateMenuRules={onUpdateMenuRules}
        onSaveMenuRules={onSaveMenuRules}
        menuRulesSaving={menuRulesSaving}
        menuRulesSaved={menuRulesSaved}
        menuCourses={menuCourses}
        logoDataUri={logoDataUri}
        layoutStyles={layoutStyles}
        wines={wines}
        cocktails={cocktails}
        spirits={spirits}
        beers={beers}
        aperitifOptions={aperitifOptions}
      />
    </div>
  );
}
