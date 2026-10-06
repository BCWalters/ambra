import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./assessment",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  outputDir: "./test-results/epub-conformance",
  reporter: [["list"]],
  use: { trace: "off", screenshot: "off" },
});
