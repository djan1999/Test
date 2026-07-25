import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.js"],
    // Vitest otherwise uses every reported CPU for file workers. The UI-heavy
    // jsdom files become slower under that contention and can exceed their
    // normal per-test timeout even though they pass quickly in isolation.
    maxWorkers: 4,
    include: [
      "src/__tests__/**/*.test.{js,jsx}",
      "src/domain/reservations/__tests__/**/*.test.js",
      "api/__tests__/**/*.test.js",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.{js,jsx}", "api/**/*.js"],
      exclude: ["src/__tests__/**", "api/__tests__/**", "src/main.jsx"],
    },
  },
  define: {},
});
