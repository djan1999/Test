import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import SystemPanel from "../components/admin/SystemPanel.jsx";
import ReservationModal from "../components/reservations/ReservationModal.jsx";

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

  it("renders ReservationModal and basic controls", () => {
    render(
      <ReservationModal
        table={{ id: 1, guests: 2, tableGroup: [1], restrictions: [] }}
        tables={Array.from({ length: 10 }, (_, i) => ({ id: i + 1, active: false }))}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect(screen.getByText("TABLE · RESERVATION")).toBeInTheDocument();
    expect(screen.getByText("SAVE")).toBeInTheDocument();
    expect(screen.getByText("CANCEL")).toBeInTheDocument();
  });
});
