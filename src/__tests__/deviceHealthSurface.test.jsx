import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Header from "../components/ui/Header.jsx";
import DeviceHealthCard from "../components/ui/DeviceHealthCard.jsx";

const connected = {
  connected: true, connecting: false, hasSynced: true, hasSyncedP1: true,
  lastSyncedAt: Date.now() - 3_000, streamError: null,
};

describe("device health is reachable from the pass", () => {
  it("offers the readout beside the status chip", () => {
    const onOpenHealth = vi.fn();
    render(<Header modeLabel="KITCHEN" syncLabel="SYNC" syncLive onOpenHealth={onOpenHealth} />);
    fireEvent.click(screen.getByRole("button", { name: "Device health" }));
    expect(onOpenHealth).toHaveBeenCalledTimes(1);
  });

  it("leaves the header exactly as it was when no readout is wired", () => {
    render(<Header modeLabel="KITCHEN" syncLabel="SYNC" syncLive />);
    expect(screen.queryByRole("button", { name: "Device health" })).toBeNull();
  });

  it("does not steal the catalogue-sync tap on the chip", () => {
    const onSyncAll = vi.fn(async () => ({ ok: true }));
    render(<Header modeLabel="ADMIN" syncLabel="SYNC" syncLive onSyncAll={onSyncAll} onOpenHealth={vi.fn()} />);
    fireEvent.click(screen.getByText("SYNC"));
    expect(onSyncAll).toHaveBeenCalledTimes(1);
  });
});

describe("the readout itself", () => {
  it("leads with the verdict and the single next action", () => {
    render(<DeviceHealthCard powerSyncStatus={connected} serviceActive buildId="b1" role="kitchen" />);
    expect(screen.getByRole("status")).toHaveTextContent(/this device is healthy/i);
    expect(screen.getByText(/check the floor device/i)).toBeInTheDocument();
  });

  it("tells an offline kitchen not to clear anything", () => {
    render(<DeviceHealthCard online={false} powerSyncStatus={connected} serviceActive />);
    expect(screen.getByRole("status")).toHaveTextContent(/offline/i);
    expect(screen.getByText(/do not reset the local database/i)).toBeInTheDocument();
  });

  it("prints an identifying line that carries no guest data", () => {
    render(<DeviceHealthCard
      powerSyncStatus={connected} serviceActive
      buildId="2026-08-10-a1b2c3" role="kitchen" workspaceSlug="gostilna-test"
    />);
    const line = screen.getByText(/state=healthy/);
    expect(line).toHaveTextContent("build=2026-08-10-a1b2c3");
    expect(line).toHaveTextContent("restaurant=gostilna-test");
  });

  it("shows the six facts so they can be read down a phone", () => {
    render(<DeviceHealthCard powerSyncStatus={connected} serviceActive />);
    for (const label of ["Network", "Sync stream", "First sync", "Last sync", "Service", "Refused operations"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
