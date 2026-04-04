import MenuTemplateEditor from "./MenuTemplateEditor.jsx";

export default function MenuLayoutPanel({
  menuCourses,
  menuTemplate,
  onUpdateTemplate,
  onSaveTemplate,
  templateSaving,
  templateSaved,
  logoDataUri,
  layoutStyles = {},
  onUpdateLayoutStyles,
  onSaveLayoutStyles,
  wines = [],
  cocktails = [],
  spirits = [],
  beers = [],
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
      menuCourses={menuCourses}
      logoDataUri={logoDataUri}
      layoutStyles={layoutStyles}
      wines={wines}
      cocktails={cocktails}
      spirits={spirits}
      beers={beers}
    />
  );
}
