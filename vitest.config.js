import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/__tests__/setup.js"],
    include: ["src/__tests__/**/*.test.{js,jsx}", "api/__tests__/**/*.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/utils/**", "api/**/*.js"],
      exclude: ["api/__tests__/**"],
    },
  },
  define: {
    "import.meta.env.VITE_MENU_SHEET_ID": JSON.stringify(""),
    "import.meta.env.VITE_MENU_SHEET_TAB": JSON.stringify(""),
  },
});
