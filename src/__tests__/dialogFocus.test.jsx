import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CenteredModal from "../components/ui/CenteredModal.jsx";

describe("shared dialog keyboard navigation", () => {
  it("wraps focus and restores it to the opener", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<CenteredModal label="Example" onClose={vi.fn()}><button>First</button><button>Last</button></CenteredModal>);
    expect(screen.getByRole("dialog", { name: "Example" })).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("First")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByText("Last")).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByText("First")).toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });
});
