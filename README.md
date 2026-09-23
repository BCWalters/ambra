# Ambra

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
pnpm --filter @ambra/extension dev   # Vite dev server with HMR for the extension
pnpm build                            # build all packages/apps
pnpm test                             # run all package tests
pnpm typecheck                        # typecheck all packages/apps
pnpm lint                             # lint all packages/apps
```

## Manually loading the extension in Chrome

Load the built extension into Chrome to use the Library and reader.

1. Run `pnpm --filter @ambra/extension dev` (recommended — gives you HMR, so most changes
   to `apps/extension`, `packages/shell`, or `packages/engine` show up without a manual
   reload) **or** `pnpm build` for a one-off production bundle. Either way this produces
   `apps/extension/dist`.
2. In Chrome, go to `chrome://extensions`.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked**, and select the `apps/extension/dist` folder.
5. Ambra's icon appears in the toolbar — click it to open the library popup.
6. Select **Import EPUB**, choose a local `.epub`, then open its Library card to read.
   Direct EPUB download links (including Project Gutenberg) can also open the Library
   and import the book automatically.

If you're using the dev server (step 1), leave it running — Chrome will pick up most changes
automatically; for changes to `manifest.json` itself, click the reload icon on the extension
card in `chrome://extensions`.

### If EPUB links do not import

- Chrome loads the generated `apps/extension/dist/manifest.json`, not the source
  manifest. Direct web imports need the website access declared in the source
  `host_permissions`; rebuilding and reloading the extension updates that declaration.
- Check Ambra's **Site access** in Chrome's extension details. Access withheld for the
  download site can prevent the Library from fetching the EPUB.
- A production build replaces the dev-server loaders in `dist`. Merely leaving Vite
  running does not turn that bundle back into a live development build. Stop and restart
  `pnpm --filter @ambra/extension dev`, then reload Ambra in `chrome://extensions`.
- For a standalone bundle instead, run `pnpm --filter @ambra/extension build` and reload
  Ambra. Do not run that build over `dist` while relying on live dev-server updates.

The browser tests build into an isolated directory so they do not replace the unpacked
extension you are using.

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
