import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.json" with { type: "json" };

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        // The reader page is opened dynamically at runtime (chrome.tabs.create
        // from the background service worker) rather than statically
        // referenced in manifest.json, so it must be registered explicitly
        // as a build entry point.
        reader: fileURLToPath(new URL("./src/reader/index.html", import.meta.url)),
      },
    },
  },
});
