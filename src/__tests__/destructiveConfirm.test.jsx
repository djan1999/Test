/**
 * Destructive admin actions must state their consequence before they run.
 *
 * These buttons overwrite or delete saved work and persist immediately — there
 * is no draft step and no undo. A single mis-tap on REBUILD once emptied every
 * dish slot in a live profile, so the contract under test is: nothing is
 * written until the operator confirms, and cancelling changes nothing at all.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import MenuTemplateEditor from "../components/admin/MenuTemplateEditor.jsx";
import SystemPanel from "../components/admin/SystemPanel.jsx";
import { buildDefaultLongMenuTemplate } from "../utils/menuTemplateSchema.js";

// The editor measures its preview pane on mount; jsdom has no ResizeObserver.
if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

const COURSES = [
  { course_key: "tomato", position: 1, is_active: true, menu: { name: "Tomato", sub: "" } },
  { course_key: "trout_belly", position: 2, is_active: true, menu: { name: "Trout Belly", sub: "" } },
];

// A template that already carries placed dishes — the state a rebuild destroys.
const templateWithWork = () => ({
  version: 2,
  rows: [
    {
      id: "row_a",
      gap: 0,
      widthPreset: "55/45",
      left: { type: "course", courseKey: "tomato", showPairing: true },
      right: { type: "drinks", drinkSource: "aperitif" },
    },
    {
      id: "row_b",
      gap: 0,
      widthPreset: "55/45",
      left: { type: "course", courseKey: "trout_belly" },
      right: null,
    },
  ],
});

const renderEditor = (props = {}) => {
  const onUpdateTemplate = vi.fn();
  const utils = render(
    <MenuTemplateEditor
      menuTemplate={templateWithWork()}
      onUpdateTemplate={onUpdateTemplate}
      onUpdateLayoutStyles={vi.fn()}
      menuCourses={COURSES}
      {...props}
    />
  );
  return { ...utils, onUpdateTemplate };
};

const rebuildButton = () => screen.getByText(/RESET LONG TO BLANK LAYOUT/);

describe("menu template rebuild", () => {
  it("does not touch the saved template until the operator confirms", () => {
    const { onUpdateTemplate } = renderEditor();

    fireEvent.click(rebuildButton());

    // The dialog is up and nothing has been written yet.
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(onUpdateTemplate).not.toHaveBeenCalled();
  });

  it("names the dishes at stake so the consequence is legible", () => {
    renderEditor();
    fireEvent.click(rebuildButton());

    const dialog = screen.getByRole("alertdialog");
    // Two placed dishes, and the body must say the layout is NOT filled in
    // from the courses — the exact misreading that caused the data loss.
    expect(within(dialog).getByText(/2 dishes you placed/)).toBeInTheDocument();
    expect(within(dialog).getByText(/does not fill the layout in from your courses/)).toBeInTheDocument();
  });

  it("writes nothing when the operator cancels", () => {
    const { onUpdateTemplate } = renderEditor();

    fireEvent.click(rebuildButton());
    fireEvent.click(screen.getByText("CANCEL"));

    expect(onUpdateTemplate).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("applies the blank default once confirmed", () => {
    const { onUpdateTemplate } = renderEditor();

    fireEvent.click(rebuildButton());
    fireEvent.click(screen.getByText("RESET TO BLANK"));

    expect(onUpdateTemplate).toHaveBeenCalledTimes(1);

    // Row ids are minted from the clock, so compare the shape that matters:
    // the default long layout, with every course slot empty.
    const applied = onUpdateTemplate.mock.calls[0][0];
    const reference = buildDefaultLongMenuTemplate();
    expect(applied.version).toBe(reference.version);
    expect(applied.rows).toHaveLength(reference.rows.length);
    const placedDishes = applied.rows.flatMap(r => [r.left, r.right])
      .filter(b => b?.type === "course" && b.courseKey);
    expect(placedDishes).toEqual([]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("skips the confirm when there is no work to lose", () => {
    // Empty canvas: the prompt would be noise, and the empty-state button is
    // the documented way to get a starting layout.
    const { onUpdateTemplate } = renderEditor({ menuTemplate: { version: 2, rows: [] } });

    fireEvent.click(screen.getByText(/Generate Default Template/));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onUpdateTemplate).toHaveBeenCalledTimes(1);
  });
});

describe("print layout deletion", () => {
  const PROFILES = [
    { id: "layout_1", name: "SPRING 2026 LM", target: "guest_menu" },
    { id: "layout_2", name: "WINTER 2026", target: "guest_menu" },
  ];

  const renderSystemPanel = () => {
    const onDeleteLayoutProfile = vi.fn();
    const utils = render(
      <SystemPanel
        syncStatus="live"
        supabaseUrl="https://example.supabase.co"
        hasSupabase
        onSyncWines={vi.fn(async () => ({ ok: true }))}
        onSaveLogo={vi.fn()}
        layoutProfiles={PROFILES}
        activeLayoutProfileId="layout_1"
        onDeleteLayoutProfile={onDeleteLayoutProfile}
        wineSyncConfig={{ winesEnabled: true, beveragesEnabled: true, wineCountries: [], beveragePages: [] }}
        onUpdateWineSyncConfig={vi.fn()}
        onSaveWineSyncConfig={vi.fn(async () => {})}
      />
    );
    return { ...utils, onDeleteLayoutProfile };
  };

  it("names the layout being deleted and deletes nothing yet", () => {
    const { onDeleteLayoutProfile } = renderSystemPanel();

    fireEvent.click(screen.getByText("DELETE LAYOUT"));

    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/SPRING 2026 LM/)).toBeInTheDocument();
    expect(onDeleteLayoutProfile).not.toHaveBeenCalled();
  });

  it("deletes only the active layout, and only once confirmed", () => {
    const { onDeleteLayoutProfile } = renderSystemPanel();

    fireEvent.click(screen.getByText("DELETE LAYOUT"));
    // The dialog's own confirm button, not the toolbar button behind it.
    fireEvent.click(within(screen.getByRole("alertdialog")).getByText("DELETE LAYOUT"));

    expect(onDeleteLayoutProfile).toHaveBeenCalledExactlyOnceWith("layout_1");
  });

  it("keeps the layout when the operator cancels", () => {
    const { onDeleteLayoutProfile } = renderSystemPanel();

    fireEvent.click(screen.getByText("DELETE LAYOUT"));
    fireEvent.click(screen.getByText("CANCEL"));

    expect(onDeleteLayoutProfile).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
