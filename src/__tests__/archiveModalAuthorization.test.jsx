import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../lib/supabaseClient.js", () => ({ supabase: null }));
vi.mock("../lib/archiveStore.js", () => ({
  fetchArchive: vi.fn(async () => ({ active: [], deleted: [] })),
  archiveSetDeleted: vi.fn(), archiveSetAllDeleted: vi.fn(), archivePurgeTrash: vi.fn(),
}));

import ArchiveModal from "../components/modals/ArchiveModal.jsx";

const props = {
  tables: [], menuCourses: [], onArchiveAndClear: vi.fn(), onClearAll: vi.fn(), onClose: vi.fn(),
};

describe("ArchiveModal destructive authorization", () => {
  it("hides CLEAR ALL without admin authorization", () => {
    render(<ArchiveModal {...props} canClearAll={false} />);
    expect(screen.queryByText("CLEAR ALL")).toBeNull();
  });

  it("renders CLEAR ALL at the modal boundary for admins", () => {
    render(<ArchiveModal {...props} canClearAll />);
    expect(screen.getByText("CLEAR ALL")).toBeInTheDocument();
  });
});
