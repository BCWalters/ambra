import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/** Unit tests for extraction targets pulled out of `ReaderController`
 * (see the architecture review's "decompose the god object" finding) and
 * other extension-side logic that doesn't need a real Chromium instance
 * — the heavier full-reader-experience regressions stay in
 * `apps/e2e` (real Playwright + a real built extension), same division
 * of labor as `@ambra/engine`'s own unit tests vs. `apps/e2e`. */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
