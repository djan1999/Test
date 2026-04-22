import MenuTemplateEditor from "./MenuTemplateEditor.jsx";

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
}) {
  return (
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
  );
}
