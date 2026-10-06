import { defineConfig } from "@playwright/test";

// A slower, occasional correctness suite against the *real* built
// extension in real headless Chromium — deliberately not run on every
// iteration (see README.md's "when to run this" section). Local runs default
// to one worker to avoid surprising resource use. CI explicitly uses two;
// each test owns an isolated persistent Chromium profile and output directory.
export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
