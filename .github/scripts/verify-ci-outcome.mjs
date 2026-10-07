import path from "node:path";
import { fileURLToPath } from "node:url";

export function verifyCiOutcome(prepare, runBrowser, browser, matrix) {
  if (prepare !== "success") {
    throw new Error("Lint, types, units or package preparation did not succeed.");
  }
  if (!matrix || !Array.isArray(matrix.include)) {
    throw new Error("Browser selection matrix is missing or invalid.");
  }
  if (runBrowser === "true") {
    if (!matrix.include.length || browser !== "success") {
      throw new Error("At least one required browser group failed, was cancelled, or did not run.");
    }
  } else if (runBrowser !== "false" || matrix.include.length || browser !== "skipped") {
    throw new Error("Unexpected browser selection or execution state.");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.PREPARE_RESULT !== "success") {
    throw new Error("Lint, types, units or package preparation did not succeed.");
  }
  verifyCiOutcome(process.env.PREPARE_RESULT, process.env.RUN_BROWSER,
    process.env.BROWSER_RESULT, JSON.parse(process.env.BROWSER_MATRIX));
}
