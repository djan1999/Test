import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import App from "../App.jsx";

describe("App root smoke", () => {
  it("mounts in local-only mode without crashing", () => {
    render(<App />);
    expect(document.body.textContent.length).toBeGreaterThan(0);
  });
});
