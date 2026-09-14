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
```

To load the extension in Chrome during development, run the dev/build command above, then
load `apps/extension/dist` (build) as an unpacked extension via `chrome://extensions`.

## Coding conventions

- Favor object-oriented design (classes with clear responsibilities) for the engine's core
  abstractions. Plain functions are fine for small, stateless utilities.
- The core engine (`packages/engine`) is dependency-free by design — do not add runtime
  dependencies there. UI dependencies belong in `packages/shell` and `apps/extension` only.
