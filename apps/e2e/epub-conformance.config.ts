import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./assessment",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  outputDir: process.env.AMBRA_ASSESSMENT_OUTPUT
    ? `${process.env.AMBRA_ASSESSMENT_OUTPUT}/playwright`
    : "./conformance-results",
  reporter: [["list"]],
  use: { trace: "off", screenshot: "off" },
});
