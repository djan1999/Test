import { FONT } from "./adminStyles.js";
import MenuTemplateEditor from "./MenuTemplateEditor.jsx";

export default function MenuLayoutPanel({
  // Course data (passed through to template editor for block resolution)
  menuCourses,
  // Template (v2)
  menuTemplate,
  onUpdateTemplate,
  onSaveTemplate,
  templateSaving,
  templateSaved,
  logoDataUri,
  layoutStyles = {},
  // Catalog data for preview panel
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
