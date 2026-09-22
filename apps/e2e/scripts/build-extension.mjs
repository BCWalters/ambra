#!/usr/bin/env node
// Builds `@ambra/extension` to a directory *isolated from* `apps/extension/dist`
// (this package's own `.extension-build/`, gitignored) so running the e2e
// suite never overwrites the CRXJS *dev-mode* `dist` the maintainer's own
// live-reloaded Chrome window depends on — see the repo's operational notes
// on that hazard. `vite build --outDir` writes a fully self-contained
// production bundle (not the dev-mode loader stubs), which is exactly what
// a real, deterministic Chromium load needs — the dev-mode stubs require the
// Vite dev server to be running at all, which this suite has no business
// depending on.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(here, "..", "..", "extension");
const outDir = process.env.AMBRA_E2E_EXTENSION_PATH
  ? path.resolve(process.env.AMBRA_E2E_EXTENSION_PATH)
  : path.resolve(here, "..", ".extension-build");

console.log(`Building @ambra/extension (production) into ${outDir} ...`);
const result = spawnSync("npx", ["vite", "build", "--outDir", outDir, "--emptyOutDir"], {
  cwd: extensionDir,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.status !== 0) {
  console.error("Extension build failed.");
  process.exit(result.status ?? 1);
}
console.log("Build complete.");
