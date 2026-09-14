import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    environmentOptions: {
      happyDOM: {
        settings: {
          // We only use happy-dom for namespace-aware XML/XHTML parsing
          // (DOMParser), never for full page rendering — disable its
          // automatic background fetching of <link>/<script> resources so
          // tests don't attempt real network requests (and don't log
          // spurious connection-refused noise for the fixture stylesheet
          // hrefs our content-loader tests reference).
          disableJavaScriptFileLoading: true,
          disableCSSFileLoading: true,
          disableIframePageLoading: true,
          // Note: with loading disabled, happy-dom still logs a harmless
          // "NotSupportedError: CSS file loading is disabled" for
          // documents containing <link rel="stylesheet">, from an
          // internal promise it doesn't fully suppress. It doesn't affect
          // test results (just console noise) — a happy-dom quirk, not
          // something to work around further here.
        },
      },
    },
  },
});
