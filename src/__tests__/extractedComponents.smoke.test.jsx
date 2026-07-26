import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SystemPanel from "../components/admin/SystemPanel.jsx";

describe("extracted component smoke tests", () => {
  // SystemPanel hosts the app's single manual sync trigger (the legacy
  // AdminPanel/WineSyncTab duplicate was removed as dead code).
  it("renders SystemPanel without crashing", () => {
    render(
      <SystemPanel
        syncStatus="live"
        supabaseUrl="https://example.supabase.co"
        hasSupabase={true}
        onSyncWines={vi.fn(async () => ({ ok: true }))}
        logoDataUri=""
        onSaveLogo={vi.fn()}
        wineSyncConfig={{ winesEnabled: true, beveragesEnabled: true, wineCountries: [], beveragePages: [] }}
        onUpdateWineSyncConfig={vi.fn()}
        onSaveWineSyncConfig={vi.fn(async () => {})}
      />
    );

    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  // ReservationModal was the seat-a-table dialog of the pre-v2 reservation
  // surface. ResvForm inside ReservationWorkspace does that job now, and is
  // covered by reservationsUi.test.jsx, so the component and its smoke test
  // went together rather than leaving a file for someone to edit by mistake.
});
