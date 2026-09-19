import { defineConfig } from "@playwright/test";

// A slower, occasional correctness suite against the *real* built
// extension in real headless Chromium — deliberately not run on every
// iteration (see README.md's "when to run this" section). Single worker:
// each test launches its own persistent Chromium profile with the
// extension loaded, which is both slow to spin up and not meaningfully
// parallelizable against a single machine's Chrome install here.
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
