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
automatically; for changes to `manifest.json` itself, restart the chosen build/dev process
and then click the reload icon on the extension card in `chrome://extensions`.

### If EPUB links do not import

- Chrome loads the generated `apps/extension/dist/manifest.json`, not the source
  manifest. Direct web imports need the website access declared in the source
  `host_permissions`; rebuilding and reloading the extension updates that declaration.
- Check Ambra's **Site access** in Chrome's extension details. Access withheld for the
  download site leaves the normal Chrome download running instead of opening an automatic
  import. Use **Import EPUB** to open the downloaded file; no new permission is required.
- During automatic import, the native download continues until Ambra confirms the book
  is saved. If it finishes first, the copy in Downloads is intentionally retained.
  Failed imports, closed Library tabs, and worker restarts do not pause or discard it.
  Authenticated, single-use, or non-HTTP links may require downloading and importing manually.
- Only one process should own `apps/extension/dist`. In particular, an older
  `vite build --watch` can keep rewriting a stale manifest even when a newer dev server
  is running. Its CRXJS manifest is captured when the build starts; fresh output timestamps
  do not prove that permission declarations are current. Identify the competing process
  and stop it deliberately before restarting your chosen dev/build process. Never stop
  another session's processes or replace its live output without coordinating.
- A production build replaces the dev-server loaders in `dist`. Merely leaving Vite
  running does not turn that bundle back into a live development build. Stop and restart
  `pnpm --filter @ambra/extension dev`, then reload Ambra in `chrome://extensions`.
- For a standalone bundle instead, run `pnpm --filter @ambra/extension build` and reload
  Ambra. Do not run that build over `dist` while relying on live dev-server updates.
- After a coordinated restart/reload, inspect `chrome.runtime.getManifest().host_permissions`
  and `await chrome.permissions.getAll()` in the actual extension's DevTools, not a
  localhost web preview. The generated manifest and Chrome's effective site access must
  both be checked; an ordinary localhost page does not acquire extension host permissions.

The browser tests build into an isolated directory so they do not replace the unpacked
extension you are using.

## Reading boundaries with a keyboard or screen reader

Each content document ends with native **Continue reading** navigation inside the
book iframe. It is visually hidden until focused. Reflowable books offer **Next
chapter: …** when the TOC names the destination document, otherwise **Next section**.
Fixed-layout books offer **Next page**, visiting both pages of a spread in logical
reading order (including RTL) before moving to another spread. The final document
instead says **End of book**; there is no inactive Next button or automatic advance.
Like existing chapter navigation, these controls follow the spine, including
non-linear items. Activating them moves reading focus to the destination and
suspends narration following without starting or stopping audio.

The reader appends an empty, registered reader-owned host at the document end.
Its shadow DOM isolates native navigation text and styles from publication text,
search, and CFIs; layout and CFI traversal explicitly exclude the host. A manual
nonmodal popover keeps the navigation in the iframe's top layer, outside the
paginated body's transform/clipping, without autofocus or light-dismiss. No
publication nodes are wrapped, moved, or split, and controls add no pages.
While a boundary is focused, paginated hosts temporarily give the iframe the full
reading-pane height and transfer its page clip to the publication body. This keeps
even a one-line final page's control visible without exposing adjacent page text;
blur restores the normal surface without repagination.

`content-boundary-navigation.spec.ts` checks Chromium accessibility-tree order,
native Tab/Space/Enter behavior, destination focus, spread order, and text/CFI/page
count invariance. These checks do not emulate an assistive technology's virtual
cursor: continuous VoiceOver/NVDA reading through the new boundary still requires
live testing, separately from the confirmed current-page entry behavior.

## Recorded narration

Narrated books show a nonmodal discovery notice until you choose **Listen now**
or **Not now**. That choice is remembered per book. Opening the notice never
starts audio or moves keyboard focus. Playback uses a compact control strip with
a themed speed menu; the X at the far right pauses and closes it.

Books with EPUB Media Overlays offer **Listen** in the reader toolbar. The playback
strip supports pause/resume, previous/next authored passage, and playback speed.
Narration highlights its current passage and follows it across pages and chapters,
without moving keyboard focus.

Manual page, contents, scrubber, or scroll navigation keeps audio playing but stops
automatic following. **Return to narration** reveals the current audio passage without
seeking; **Listen from this page** starts at the displayed passage, changing to
**Listen from selection** when book text is selected.
Closing the strip pauses playback. Unnarrated front matter advances to the next
narrated linear section; the reader does not silently substitute text-to-speech.

The first version supports recorded audio in reflowable and fixed-layout books,
including authored highlighting classes. Semantic skipping/escaping and overlays
that rely on embedded media or synthesized speech are not implemented yet.

For real-content testing, the [W3C/IDPF Moby-Dick media-overlay sample](https://idpf.github.io/epub3-samples/30/samples.html#moby-dick-mo)
contains the full novel with narration for the first two chapters. Its sample package
is CC BY-SA, not an entirely public-domain artifact. Keep third-party EPUBs outside
source control; set `AMBRA_MEDIA_OVERLAY_BOOK` to its local path to run
`apps/e2e/tests/media-overlay-real-book.spec.ts`. Synthetic audio fixtures can be
regenerated with `node apps/e2e/scripts/generate-media-overlay-fixtures.mjs`.

[ReadBeyond's A Horseman in the Sky](https://www.readbeyond.it/ebooks/1a62c8e6.html)
is a complete, roughly 15-minute narrated story with synchronized text. Its EPUB
package is CC BY-NC-SA 4.0, not entirely public domain. Set `AMBRA_READBEYOND_BOOK`
to a local copy to exercise its playback, highlighting, and browse/return behavior
in the same real-book test. Library discovery links to ReadBeyond's wider collection.
Set `AMBRA_VERIFY_READBEYOND_DOWNLOAD=1` when running `epub-direct-import.spec.ts`
to verify its live download-to-library handoff; this opt-in test contacts ReadBeyond.

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
