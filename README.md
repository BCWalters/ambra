# Pagina

A polished, accessible EPUB3 reader browser extension — built for Chrome first.

See the project plan for goals, architecture decisions, and phasing.

## Structure

This is a pnpm workspace monorepo:

- [`packages/engine`](./packages/engine) — the core EPUB3 engine (container/OPF/Nav
  parsing, layout, pagination, CFI locators). Vanilla TypeScript, **zero runtime
  dependencies** — built entirely on native browser APIs (`DecompressionStream`,
  `DOMParser`). This package must never depend on React or any UI framework.
- [`packages/shell`](./packages/shell) — the reader's shell UI components (toolbar, TOC
  panel, library, settings), built with React and Fluent UI v9.
- [`apps/extension`](./apps/extension) — the Manifest V3 Chrome extension that wires the
  engine and shell together: background service worker, library popup, and the
  full-tab reader page.

## Getting started

```sh
pnpm install
pnpm --filter @pagina/extension dev   # Vite dev server with HMR for the extension
pnpm build                            # build all packages/apps
pnpm test                             # run all package tests
pnpm typecheck                        # typecheck all packages/apps
pnpm lint                             # lint all packages/apps
```

## Manually loading the extension in Chrome

This is how you'll actually _see_ the extension as it's built out — even now, while it's
just an empty shell.

1. Run `pnpm --filter @pagina/extension dev` (recommended — gives you HMR, so most changes
   to `apps/extension`, `packages/shell`, or `packages/engine` show up without a manual
   reload) **or** `pnpm build` for a one-off production bundle. Either way this produces
   `apps/extension/dist`.
2. In Chrome, go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked**, and select the `apps/extension/dist` folder.
5. Pagina's icon appears in the toolbar — click it to open the library popup.
6. To see the reader page, open the browser console on the popup (or background service
   worker, via "Inspect views: service worker" on the extension card) and run:
   ```js
   chrome.tabs.create({ url: chrome.runtime.getURL("src/reader/index.html?bookId=test") });
   ```
   (Once library-storage and reader-shell-ui land, opening a book from the library will do
   this for you.)

If you're using the dev server (step 1), leave it running — Chrome will pick up most changes
automatically; for changes to `manifest.json` itself, click the reload icon on the extension
card in `chrome://extensions`.

## Coding conventions

- Favor object-oriented design (classes with clear responsibilities) for the engine's core
  abstractions. Plain functions are fine for small, stateless utilities.
- The core engine (`packages/engine`) is dependency-free by design — do not add runtime
  dependencies there. UI dependencies belong in `packages/shell` and `apps/extension` only.

## Engine test fixtures

`packages/engine/test/fixtures/` contains small hand-built EPUB files used by the engine's
test suite, e.g. `minimal.epub` (a valid, minimal EPUB3 book) and deliberately malformed
variants (`no-container.epub`, `malformed-container.epub`) for testing error paths. They're
built from the human-readable sources in `*-src/` directories by
`packages/engine/scripts/build-fixtures.sh`, which shells out to the system `zip` tool (a
dev-time-only fixture generator, not a runtime dependency) so our from-scratch `ZipArchive`
reader is validated against real, independently-produced zip output. Re-run it after editing
any `*-src/` fixture source:

```sh
packages/engine/scripts/build-fixtures.sh
```
