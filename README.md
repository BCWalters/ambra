# Ambra

A local-first EPUB3 reader browser extension — built for Chrome first, with
reflowable and fixed-layout books, bookmarks, highlights, and recorded narration.

**Early beta:** expect rough edges and keep your original EPUBs. Live
VoiceOver/NVDA validation is still pending; automated keyboard and accessibility
checks are not a guarantee of assistive-technology behavior.

## License and release status

Ambra's original code and documentation use the standard [MIT license](LICENSE):
you may use, modify, redistribute, and sell copies, including commercially,
provided you retain the copyright and license notice. There is no
non-commercial or friends-only restriction on the source code. Third-party
materials retain their own licenses; see [notices and provenance](THIRD_PARTY_NOTICES.md).

The first Chrome Web Store release is an **unlisted beta**: anyone with the
installation URL can install it, but it does not appear in store search or browsing.
No trusted-tester allowlist is required. Public source visibility, store listing
visibility, and npm's `"private": true` (which prevents accidental package
publication) are independent.
See [contributing](CONTRIBUTING.md), the [privacy policy](store-assets/privacy-policy.md),
and the [beta release checklist](store-assets/BETA_RELEASE.md).

## Structure

This is a pnpm workspace monorepo:

- [`packages/engine`](./packages/engine) — the core EPUB3 engine (container/OPF/Nav
  parsing, layout, pagination, CFI locators). Vanilla TypeScript, **zero runtime
  dependencies** — built entirely on native browser APIs (`DecompressionStream`,
  `DOMParser`). This package must never depend on React or any UI framework.
- [`packages/shell`](./packages/shell) — shared React/Fluent UI theme provider.
- [`apps/extension`](./apps/extension) — the Manifest V3 Chrome extension that wires the
  engine and shell together: background service worker, library popup, and the
  full-tab reader page, including the toolbar, panels, library, and settings UI.

## Getting started

Use Node.js 24.18.0 and pnpm 11.11.0 to match CI. The current Vite toolchain
requires at least Node 20.19 or 22.12, rather than any Node 20 release.
From a fresh clone:

```sh
git clone https://github.com/BCWalters/ambra.git
cd ambra
pnpm install --frozen-lockfile
pnpm --filter @ambra/extension dev   # Vite dev server with HMR for the extension
```

Alternatively, `pnpm build` creates a standalone production bundle. Do not run
it while another process owns the same live `apps/extension/dist`.
`pnpm test`, `pnpm typecheck`, and `pnpm lint` run the workspace checks.
Browser tests run separately; see [contributor setup](CONTRIBUTING.md).

## Manually loading the extension in Chrome

Load the built extension into Chrome to use the Library and reader.

1. Run `pnpm --filter @ambra/extension dev` (for development — gives you HMR, so most changes
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

For everyday reading and performance/memory measurements, use a production bundle.
Development mode loads the unbundled module graph and source maps: in the #199
three-book Library reproduction, its median renderer private footprint was about
346 MiB versus 68 MiB for production with the same original covers. This is not
the same counter as Chrome's tab-hover memory display. See the
[memory measurement procedure](apps/e2e/README.md#library-cover-memory-regression-199).
Coordinate stopping the dev process before rebuilding its output. To retain an
existing unpacked extension's library, reload the same extension from the same
directory; loading a different directory can create a different extension ID and
separate storage. Do not uninstall the existing extension to switch build modes.

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

### Native macOS scrubber regression

Chrome can deliver `lostpointercapture` with no buttons held before `pointerup`
during a fast physical drag. DevTools mouse input does not reproduce that ordering.
The optional macOS path in `scrubber-long-drag.spec.ts` uses CoreGraphics mouse
events, an isolated headed test-browser profile, and an unemulated viewport. It
requires the existing Swift command-line tools and permission to post input; it
does not request or change system permissions. It moves the desktop pointer and
foregrounds only its own test-browser process, so run it when not using the mouse.

```bash
AMBRA_E2E_EXTENSION_PATH="$PWD/dist/native-scrubber-build" pnpm --filter @ambra/e2e run build:extension
AMBRA_E2E_EXTENSION_PATH="$PWD/dist/native-scrubber-build" \
  AMBRA_SCRUBBER_NATIVE_MOUSE=1 AMBRA_E2E_HEADLESS=0 \
  pnpm --filter @ambra/e2e exec playwright test scrubber-long-drag --workers=1
```

Set `AMBRA_SCRUBBER_BOOK` to a local EPUB path to test a particular book instead
of the original fixture. Each layout performs 24 long drags and verifies actual
navigation, exactly one seek per release, and the native capture-loss ordering.
Without the native-input flag, the same test uses ordinary Playwright mouse input.

## Reading preferences

**Settings** owns the global **Page theme** control: a compact native select
next to **Brightness**, using the existing `text.pageStyle` translation key.
`GlobalReadingSettings.pageTheme` applies across books. Legacy
`defaultPageTheme` supplies the initial global theme when present; otherwise
it defaults to white. Saved per-book page themes are no longer used.

`BookReadingSettings` owns typography and `alwaysShowOnePage` (default `false`),
not `pageTheme`. The **Always show one page** checkbox in the book's **Page**
menu forces a single centered page for reflowable paginated content, including
reflowable sections of mixed-layout books. It does not change fixed-layout
pages or scrolling, which already uses a centered, width-limited reading area.

## Keyboard shortcuts and help

See the [user guide](docs/user-guide/README.md) for a feature overview and
[EPUB Inspector](docs/user-guide/epub-inspector.md) for integrated publication
inspection and debugging.

Open **Settings → Help & About** or the **Help & About** footer in **Book details**
while reading, or **Help & About** in the
Library. It includes the user guide, keyboard shortcuts, diagnostics, and feedback
by email or GitHub. No GitHub account is needed to send email.

**Mod** means Command on macOS and Control on Windows/Linux.

| Action | Default shortcut |
| --- | --- |
| Previous / next page or spread | Left / Right (reversed for RTL books) |
| Previous / next page | Page Up / Page Down |
| Next / previous page | Space / Shift+Space |
| Previous / next section | Alt+Page Up / Alt+Page Down |
| Switch to scrolling / paginated mode | Alt+Shift+Page Down / Alt+Shift+Page Up |
| Add / remove bookmark | Mod+B |
| Search this book | Mod+F |
| Keyboard shortcuts | Mod+/ |
| Dismiss a menu or dialog | Escape |

A section is an EPUB spine item, not necessarily a named TOC chapter. In scrolling
mode, Page Up, Page Down, and Space retain native scrolling; Left/Right navigate
sections. Mac laptops may need Fn+Up/Down to produce Page Up/Down.
For continuous reading with a screen reader, consider **scrolling mode**
(Alt+Shift+Page Down). These explicit mode commands apply only to reflowable books
and preserve the reading location; repeating a command does not toggle the mode.

The shortcuts popup is a quick reference for the fixed, platform-specific
bindings, with one option to enable or disable Ambra shortcuts. That preference is
local and shared across open Ambra pages. Browser history and zoom shortcuts remain
available; outside the reader, Mod+F still belongs to Chrome. Commands do not
interfere with text editing, selections, menus, sliders, or modal dialogs. Ambra
does not require an ARIA application mode or bare-letter shortcuts.

**Copy diagnostics** in the Library copies environment information. In the reader
it also includes the current book's diagnostic report, which can contain book
details, reading locations, and recent events. Review it before sharing; copying
does not send anything automatically.

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
cursor: continuous VoiceOver/NVDA reading through the boundary and exact
current-page entry behavior still require live assistive-technology testing.

Resume is best-effort: when Chrome exposes a collapsed text caret or publication
focus, Ambra can save that more precise position, including the companion page of
a spread. Otherwise it saves the visual reading position. A screen reader's
virtual cursor does not always update DOM focus or selection, so Ambra cannot
guarantee resuming at the last spoken word.

### Optional native macOS accessibility regression

`content-boundary-native-focus.spec.ts` invokes the native macOS **AXPress**
action from the source chapter and checks macOS's focused element and selected
text-marker ownership in the destination WebArea, alongside DOM focus/caret.
It also checks a restored nonzero caret offset. This is **not**
proof of VoiceOver speech, virtual-cursor position, or continuous reading.
`native-reader-shortcuts.spec.ts` also delivers native macOS keyboard events to
the owned browser, checking mode switches, section navigation, bookmark/search/
help commands, and reading-focus restoration.

Run only on an **unlocked macOS desktop**, with the existing Swift command-line
tools and accessibility/automation permissions already granted. The test brings
only its own headed test browser to the foreground, which can interrupt desktop
work. It skips a locked desktop; it never attempts to unlock it or grant
permissions. Unset `AMBRA_E2E_HEADLESS` for this test:

```sh
AMBRA_E2E_EXTENSION_PATH="$PWD/dist/native-accessibility-build" \
  pnpm --filter @ambra/e2e run build:extension
env -u AMBRA_E2E_HEADLESS \
  AMBRA_E2E_EXTENSION_PATH="$PWD/dist/native-accessibility-build" \
  AMBRA_NATIVE_ACCESSIBILITY=1 \
  pnpm --filter @ambra/e2e exec playwright test content-boundary-native-focus.spec.ts native-reader-shortcuts.spec.ts \
  --workers=1 --output test-results/native-accessibility
```

The build is isolated from the live unpacked extension. A locked-desktop skip
is not a passing native test. Manual VoiceOver hand-off remains a separate
pre-beta validation gate.

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
