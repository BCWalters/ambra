# `@ambra/e2e` — real-Chromium reading-experience correctness suite

A slower, occasional test suite that drives the **actual built extension**
in **real headless-capable Chromium** via Playwright — deliberately
separate from `@ambra/engine`'s fast unit tests (which run in Node/happy-dom
and can't observe real layout, paint, or interaction timing at all).

## Why this exists

Several real, user-reported bugs in this codebase's history were things no
unit test could have caught, because they were about actual browser
rendering/interaction behavior, not engine logic:

- A page whose real content ended well short of a full page's height left
  the rest of that page's on-screen *area* completely unresponsive to
  clicks (issue #82) — the pagination math was correct, the click-turn
  *hit-testing* wasn't.
- A confirmed Chromium rendering defect where any `clip-path`d iframe loses
  proper opaque compositing against another overlapping iframe once *any*
  sibling in the same 3D `perspective` context is mid-rotation (issue #81)
  — invisible from reading the code, only visible in an actual rendered
  frame.

This suite's job is to catch the *next* bug in that same family before a
user does — mechanically checking things like "every paragraph of a
chapter is shown exactly once, in order, across however many pages it
takes" and "no click during normal page-turning ever gets silently
swallowed," directly against real rendered output.

## When to run this

**Not on every iteration.** This spins up real Chromium instances (slow;
local runs default to one worker, while CI runs most files on two isolated
workers) and is meant as an occasional, broader regression gate — after a batch
of pagination/rendering/interaction work, before a release, or when
investigating a reported navigation bug. Tests that enforce wall-clock budgets
or deliberately hold rendering work in flight, plus coverage that repeatedly
switches the runtime locale, run serially in CI to avoid measuring contention
from an unrelated Chromium instance. `@ambra/engine`'s unit tests remain the
fast, every-iteration signal.

Protected CI selects the smallest safe browser surface from the pull request or
push diff:

- Markdown/documentation-only changes skip browser tests.
- Changes confined to `apps/extension/src/i18n` run focused Library and shared
  shell localization coverage.
- Changes confined to `apps/extension/src/library` and Library-specific browser
  tests run the Library suite.
- Changes confined to the EPUB release-conformance runner and browser-suite
  selector run lint, type-check, and unit/tool tests without building the
  extension or launching Chromium.
- Shared UI, reader, engine, dependency, manifest, workflow, release, and
  unclassified changes run the complete protected browser suite.

Native audio-resource failure checks run in an isolated early gate, before the
optional codec-tool preparation and broad packaged-browser stage. They
distinguish undecodable resources rejected by capability preflight (no playback
source assigned) from genuine native
failures after valid playback has started. Both must retain explicit compact
error controls and no unhandled exceptions. The later narration gate excludes
those tagged cases, avoiding duplicate execution while preserving isolated
timing/playback coverage.

`navigation-accessibility-conformance.spec.ts` uses original EPUB2,
hybrid Nav/NCX, and modern Nav fixtures. It checks actual auxiliary-list target
activation, explicit navigation recovery, publisher-claim presentation in both
Reader and Library, and local refresh of older cached metadata. Publisher
report/contact strings stay inert: the fixtures assert that no requests or
active metadata links are introduced. These regressions run early in protected
CI; they are not substitutes for the pinned official release assessment.

`cfi-recovery-conformance.spec.ts` checks an actual painted landing after ID
correction, direct native DOM ranges in both loaded and provided documents,
cross-element/whitespace text assertion recovery, and exact adjacent-text
before/after affinity. It uses original content and runs in the early CI gate.
It does not claim support for nested documents or media/spatial CFI offsets.

`resource-policy.spec.ts` additionally exercises Chromium's frame-level required
CSP on XHTML and headless SVG roots. After verifying a packaged image actually
decodes, it introduces an unrewritten remote image URL through the trusted test
driver. It requires a native enforcing violation from the expected CSP and a
CDP loading failure explicitly blocked by CSP, with no network dispatch/response.
Playwright can report a logical request attempt even when CSP prevents dispatch;
the safety-net route must never handle that attempt. This is not a sanitized
attribute or simulated event. This covers the common rendering
host; external SVG graph rewriting remains a separate compatibility gap.

The opt-in release profile in `assessment/core-media.spec.ts` uses
`epub-conformance.config.ts`, not ordinary test discovery. The main-only release
assessment workflow runs it against the exact archived production package and
pinned W3C publications. It records eleven native font/image criteria, leaves
all other criteria unassessed, and archives factual evidence without including
third-party publications or browser profiles. See the
[release assessment procedure](../../docs/epub-3.4-conformance-runner.md).

The selector fails closed: mixed or empty/unknown diffs run everything.
Manually dispatched and called workflows also run everything, so final release
candidates never use a reduced browser suite.

## Running it

`resource-fallbacks.spec.ts` generates original geometric fonts, solid-color
AVIF/JPEG XL/video, and silent AAC-LC/Opus MP4 fixtures. Its GitHub CI prerequisite
step checks for FFmpeg, `cjxl`, FontTools and Brotli and installs only missing
tooling on the disposable runner. CI uses `/usr/bin/python3`; other environments
can set `AMBRA_E2E_MEDIA_PYTHON` to a Python interpreter with FontTools/Brotli.
The suite verifies consumer-aware fallback selection and reports actual native
image capabilities separately; selecting an SVG fallback is not a JPEG XL
conformance pass. For this conformance work, execute browser/unit tests on GitHub,
not on the developer's Mac.

### Approved features and local simulation controls

Build an isolated extension with `VITE_AMBRA_LOCAL_FEATURES=1 pnpm --filter
@ambra/extension build --outDir /absolute/path/to/local-prototype`, then set
`VITE_AMBRA_LOCAL_FEATURES=1`, `AMBRA_E2E_HEADLESS=1`, and
`AMBRA_E2E_EXTENSION_PATH=/absolute/path/to/local-prototype` when running
the simulation cases in `review-invitation.spec.ts` and
`library-review-keyboard.spec.ts`. The environment variable now controls only
developer simulation tools, not user-facing features.

`review-invitation.spec.ts` checks actual saved-position eligibility, modal
focus and localization, permanent yes/no responses, durable three-day reminders,
cross-tab claims, save failures, and simulation without altering books, progress,
or preferences. Run it against a normal build without
the feature environment variable as well to verify real eligibility and
cooldown behavior while confirming simulation controls are absent. Drag-and-drop,
the first-reading guide, review invitations, and the dedicated importer are
enabled in every build; their browser regressions run against ordinary packages.

`native-library-import.spec.ts` attaches to Chrome's actual action-popup target
and uses a trusted mouse click to verify handoff to a dedicated, persistent
import window. It confirms the action popup is destroyed and the importer
survives focus loss before choosing files, then checks chooser cancellation/retry,
multi-file import, persistence after reload, and return to the original normal
browser window. Embedded Library imports still choose files directly. The test
intercepts the chooser for automation; it does not certify the operating
system's file-dialog behavior. Local-feature builds also check native popup
file dropping; `library-file-drop.spec.ts` covers the compact in-reader Library
and ensures its drop highlight stays inside the panel.

Creating a focused browser window does not reliably dismiss the action popup.
Close the old popup explicitly only after successful window creation, and use
`chrome.tabs.getCurrent()` to distinguish a tab from the tabless action popup
before closing it. Assert the original CDP target is gone rather than assuming
that creating another window proves the ephemeral document was destroyed.

The [pre-2.0.0 accessibility review](../../docs/accessibility-review-2026-10-02.md)
records engineering coverage and manual limits. The
[screen-reader walkthrough](../../docs/screen-reader-walkthrough-2.0.0.md)
is the owner's native-speech test script. `footnote-noteref.spec.ts` verifies
reference focus return and keyboard-scrollable viewport-bounded long notes;
`note-save-lifecycle.spec.ts` verifies contextual note exits return to the
reading origin or surviving marker, with reading fallback after deletion.

`library-import-announcements.spec.ts` checks small-file completion, duplicate
feedback, localized speech text and unchanged chooser focus. Import feedback
uses a pre-mounted atomic text-only live region, separate from controls and
byte progress. Web-import completion follows the background worker's fallback
download settlement; `epub-direct-import.spec.ts` checks that ordering against
real Chrome downloads. These checks verify DOM state, not actual VoiceOver
speech. VoiceOver may require Stop interacting to leave a toolbar group;
the compact keyboard regression verifies Tab and that Ambra does not consume
Control-Option-Right, not native VoiceOver cursor movement.

For manual review, open the full Library and expand **Local prototype controls**
below the collection. **Simulate eligible reader** opens the modal.
**Yes, I love it!** leads to the store-review link; **Not really** leads to email
feedback. Either response stops future prompts without requiring the link.
**Not sure yet**, Escape, or closing postpones for three days; after dismissal,
**Simulate 3 days later** tests that reminder without changing the system clock.
It does not undo a yes/no response. **Reset simulated invitation** starts over;
**Simulate new reader** tests ineligibility. **Use real eligibility** restores the
actual rules. Reload also clears simulation. None of these controls reset real
reading history or saved invitation preferences.

`library-search.spec.ts` covers local title/author filtering in compact and full
libraries, retained sorting and book identity, clear/Escape focus, live French
labels, import/removal updates, and the distinction between no matches and an
empty library. It also verifies that search does not request remote book sites.
The Library CI step runs this suite against the packaged extension.

`library-lifecycle.spec.ts` also saves real reader positions and returns to the
same full Library document twice, checking card percentages, Continue reading,
and resumption. Mounted Libraries refresh on visible tab/window activation
(visibility changes or window focus), not on every reader navigation. The
refresh uses the existing session's latest-read ownership and cached cover URLs;
failed reads retain the displayed collection and surface a retryable error.
Embedded Libraries use the same activation lifecycle without replacing local
import activity.

For activation regressions, disable Playwright's CDP focus emulation on both
pages (`Emulation.setFocusEmulationEnabled`, `enabled: false`) before switching
native Chrome tabs. Otherwise every document appears focused in headless mode
and activation events never fire. Assert trusted focus events as well as the
rendered result; reloading or manually dispatching focus would mask this bug.

`library-compact.spec.ts` checks three-column cover geometry at 320/360px with
native scrollbars, a single-row header in all nine languages, persistent
full-library access, first-run discovery focus, and unchanged full-tab cover
sizes. Compact mode scrolls its main region rather than hiding its controls
behind the document scroll.

The compact suite also opens the **actual Chrome action popup**, not just a
Library tab resized to look like one. Chrome starts that surface at 25x25 while
calculating its preferred size: viewport-relative minimum dimensions can leave
it stuck there, and unconstrained root width can feed back into auto-sizing.
The native popup retains explicit root/body width and minimum-height hints;
ordinary tabs remove those hints and stay responsive. Inspect the real popup
through `chrome.extension.getViews({ type: "popup" })`: it is not emitted as a
normal Playwright page. Keep native sizing/scroll/footer checks in addition to
the 320/360px viewport tests.

`reader-save-as.spec.ts` installs its deterministic description response through
`launchReader`'s `beforeBookImport` hook: enrichment starts during reader opening,
so routing after `launchReader` returns is too late. It waits for the supplied
description before measuring Save-as traffic. Keep the strict zero-network
assertion for the save operation; do not ignore late Wikipedia requests or
depend on real lookup services completing first.

After reloading a reader, an exposed controller and visible toolbar do not prove
that its content host has mounted. The single-page preference test waits for an
owned host, nonempty document views, and idle layout/navigation before asserting
column geometry; it does not weaken the one-column or exact-width checks.

```sh
# from the repo root
pnpm --filter @ambra/e2e run test:e2e          # headless
pnpm --filter @ambra/e2e run test:e2e:headed   # watch it happen
```

Deliberately *not* named plain `test` — every other workspace package's
`test` script is fast and safe to run on every iteration (via the root
`pnpm run test`, which recurses into every package's own `test` script);
this one is neither, so it's excluded from that by construction rather
than by a special-case exclusion rule.

Both first build the extension as a **fully self-contained production
bundle** into this package's own `.extension-build/` (gitignored) — never
into `apps/extension/dist`, which is reserved for the CRXJS *dev-mode*
loader stubs the maintainer's own live-reloaded Chrome window depends on.
Running this suite never disturbs that.

Reader tests default to an experienced profile: `launchReader` seeds only
`readingWelcomeVersion: 1` in the real IndexedDB preferences store before
importing. Pass `{ firstReadingWelcome: true }` to exercise the unmodified
production first-reading welcome. `beforeBookImport` can seed other preferences
or verify Library/error states in that same profile. The CI-wired
`first-reading-welcome.spec.ts` covers acknowledgement, Escape, reload, Help
reopening, multiple books, RTL fixed layout, scrolling, touch-width reflow,
modal focus, reduced motion and forced colors. There is no headless-only
production behavior.

`launchReader` subscribes to the new-page event before clicking **Open**, then
waits for the reader URL, a visible content iframe inside the main landmark,
and the loading progressbar to disappear. Explicit first-welcome cases also
wait for the welcome dialog using a locale-independent selector; a German-locale
startup regression covers this path. These readiness signals replace fixed startup
sleeps and work without a paginated page label. Individual tests must still
wait for their own feature-specific completion (for example TOC page estimates
or image decoding).

Tests using the shared `launchReader` harness can opt into full Chromium's
headless mode with `AMBRA_E2E_HEADLESS=1`. This keeps validation from opening
windows or interrupting someone testing the live extension. It still loads the
real unpacked extension, not a web-only preview.

`responsive-images.spec.ts` covers packaged `img` and `picture/source` candidates
at 1x/2x display density, density/width descriptors, narrow/wide viewports, and
paginated/scrolling/fixed-layout hosts. It checks image selection and decoding
before pagination, complete image coverage, resolver caching/revocation, explicit
missing-resource errors, and the actual extension import path. CI runs the
synthetic cases without downloading books. Set `AMBRA_RESPONSIVE_IMAGE_EPUB` to a
local compatible Standard Ebooks EPUB to additionally verify its title artwork;
that opt-in run disables traces and screenshots to keep publication content local.

For concurrent validation, set `AMBRA_E2E_EXTENSION_PATH` to a dedicated
absolute build directory for both the build and test commands. This keeps
one run's rebuild from replacing files used by another run's browser.
Give each run its own Playwright output directory too, so reports cannot
overwrite another run's artifacts. Each `launchReader` context owns a unique
profile under the ignored `apps/e2e/.reader-profiles/`, outside Playwright's
output-cleanup tree. Closing a context removes only its profile; setup failures
also close the context and remove that profile. Concurrent output cleanup
therefore cannot delete another active reader's profile.
Use only a disposable build directory: the build empties it first.

```sh
RUN="$PWD/apps/e2e/real-books/isolated-run-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$RUN/runtime"
export TMPDIR="$RUN/runtime"
export AMBRA_E2E_EXTENSION_PATH="$RUN/extension"
pnpm --filter @ambra/e2e run build:extension
AMBRA_E2E_HEADLESS=1 pnpm --filter @ambra/e2e exec playwright test \
  tests/about-flyout.spec.ts --output "$RUN/results"
```

## Go to modal focus lifecycle

`tests/reader-go-to-shortcuts.spec.ts` checks exact reading-caret placement and
one-time focus restoration after both same-chapter and cross-chapter seeks.
The frame-before-unmount variants hold React's posted commit until the exit
animation's first requested frame has run. Fluent reports motion completion
before scheduling its surface removal, so an animation frame alone is not an
unmount barrier. These cases verify that the frame actually precedes the commit,
then retain the same destination, accessibility, and single-restoration assertions
as the normal ordering. Late exits must still defer to a newer modal or menu.
A separate Ambra settings regression defers the Go to focus-return frame until
the settings dialog owns keyboard focus, then verifies that releasing the frame
neither closes the dialog nor prevents opening Help & About. Diagnostic close events describe
requested state, not completion of exit motion.

## Image viewer transparency (#226)

`tests/image-viewer.spec.ts` checks that transparent SVG and PNG illustrations
have an opaque white backing inside the image viewer in White, Sepia and Dark
page themes, including after zooming and fitting. The surrounding overlay stays
translucent, and the original inline image keeps its transparency. Synthetic
illustrations and per-theme screenshots keep this regression independent of
external books. CI runs these cases against the packaged production build.

The localized native-wheel regression selects Deutsch in the **Language** native
select inside **Ambra settings**, closes that dialog, and verifies it is hidden
before sending wheel input to the image center. An open settings dialog can intercept that native
input; closing it is a test precondition, not evidence of broken image zoom or
a reason to weaken the wheel assertions.

## Fragment-based tables of contents (#202)

`tests/toc-fragments.spec.ts` generates original synthetic content with several
sections in one spine document, including nested/same-page sections, empty
anchors, wrapper targets and image-page DOM boundaries. It checks target-specific page numbers, current
section highlighting, keyboard navigation, ordinary page turns, resume and
scrolling in single-page and spread layouts.
Legacy and newly saved image-boundary bookmark markers are also checked against
their navigated pages, after reopening the reader and changing typography.

An optional real-book replay uses Gutenberg's EPUB3 for *Le Chat du Neptune*:
set `AMBRA_GUTENBERG_10289_BOOK` to a local download of
`https://www.gutenberg.org/ebooks/10289.epub3.images`. The publication stays
outside git. With an existing immutable build, run:

```sh
AMBRA_E2E_HEADLESS=1 AMBRA_E2E_EXTENSION_PATH=/absolute/path/to/build \
  pnpm --filter @ambra/e2e exec playwright test tests/toc-fragments.spec.ts \
  --output=test-results/toc-fragments
```

## Reading preference ownership (#203)

When checking `settings-ownership.spec.ts`, `reader-preferences.spec.ts`,
`settings-focus.spec.ts`, and `page-theme.spec.ts`, treat **Page theme** as a
global setting, not a book override. **Ambra settings** is a shared, named dialog
in the Library, popup, and reader. Its Fluent `Select` controls expose native
`combobox`/`option` semantics: assert the select's value, not `aria-checked` on
retired menu rows. **Page theme** contains **White**, **Sepia**, and **Dark**.
Theme changes apply across books; old per-book themes must not override them.
Legacy `defaultPageTheme` initializes
the global theme, with white as the fallback.

In the reader, **Reading preferences** starts expanded and comes first:
**Page theme**, **Brightness**, **Reading mode**, **Page turn**, and
**Progress landmarks**, followed by **Interface theme** and **Language**.
The Library puts Interface theme and Language first and initially collapses
Reading preferences. Interface theme retains Ambra, Silver, Green, Blue, and
Purple; browser appearance supplies light/dark independently of Page theme.
Page turn is disabled while scrolling, and fixed-layout books hide Reading mode.

**Book options** remains a separate per-book menu, opened by the button whose
accessible name is **Text and page options**. Its **Text** and **Page** cascades
retain menu keyboard behavior, font-choice `menuitemradio` rows, sliders, and
the one-page switch. **Page** has **Always show one page**, saved per book
and off by default, alongside the **Page width** slider. Check that enabling it centers a single reflowable page
even at spread-width viewports, including in reflowable sections of mixed-layout
books. Fixed-layout pages and scrolling must remain unchanged. Scrolling
already has a centered, width-limited reading area. Ownership/reset checks
should keep this book preference separate from the global page theme.

Focused browser coverage:

- `single-page-setting.spec.ts`: exact centered page width at a 2400px viewport,
  navigation, reopening, and unchanged scrolling.
- `page-theme.spec.ts`: live global theme synchronization across books and the
  Library, including ignoring legacy v7 per-book theme overrides.
- `mixed-rendition-spreads.spec.ts`: unchanged fixed-layout spreads with the
  one-page option enabled, for both LTR and RTL books.
- `settings-lifecycle.spec.ts`: an external global theme change during a held
  spread load, plus a queued one-page option change.
- `reader-preferences.spec.ts`: shared settings task order, native option labels
  and values, viewport bounds, reader/Library screenshots, persistence, and
  disabled animation while scrolling. Separate Book options checks retain
  cascade navigation, checked font choices, slider resets, and the one-page switch.
- `settings-focus.spec.ts`: native keyboard choices commit without dismissing
  Ambra settings; Tab moves between controls, and Escape dismisses the dialog
  and restores its trigger. Per-book slider cases also retain control identity,
  focus, and the reading position during reflow.
- `shell-reflow-accessibility.spec.ts`: native settings, Book options cascades,
  and the one-page switch at 320px and actual 400% browser zoom.
  Both reader and Library exercise the Brightness label above its slider
  and reset in all nine locales at 320px, including focus after reset.
  At 1400px, both Ambra settings and Book options popovers open below their
  triggers with matching right edges; narrow viewports retain collision fallback.
  Headings use semantic foreground colors: Ambra settings is 16px/700 and
  Book options is 14px/600, both with 20px line-height.
  Anchor screenshots include the trigger and surrounding reader, not just the menu.
- `shell-accessibility-audit.spec.ts`: Chromium's actual accessibility tree
  exposes the named Ambra settings dialog and Page theme/Reading mode
  comboboxes with their selected values and focus. It also covers the
  Annotations **Show** native select and keyboard-reachable empty states.
  This checks browser semantics, not VoiceOver speech or a complete ARIA
  conformance audit.
  Library toolbar tooltips are hidden while Ambra settings is open so they cannot
  consume the first Escape from Language. Pointer and pre-visible-tooltip
  cases check dismissal, restored focus, and normal tooltip behavior
  after the dialog closes.

With an existing frozen build, run without rebuilding or sharing another run's
output directory:

```sh
AMBRA_E2E_EXTENSION_PATH=/absolute/path/to/frozen-build AMBRA_E2E_HEADLESS=1 \
  pnpm --filter @ambra/e2e exec playwright test \
  settings-ownership.spec.ts reader-preferences.spec.ts settings-focus.spec.ts \
  page-theme.spec.ts shell-accessibility-audit.spec.ts shell-reflow-accessibility.spec.ts \
  --workers=1 --max-failures=5 --output=/absolute/path/to/unique-settings-results
```

### Modal trigger locators and native keyboard input

A modal focus trap can mark its background trigger `aria-hidden` while leaving
it visually present. Playwright role locators re-evaluate on each use: a nested
scope based on the Library button can stop resolving as soon as Ambra settings
opens. For geometry or focus-return references, use `includeHidden: true` on
both the scope's role locator and the trigger. Still explicitly assert visibility
before activation; this option is not permission to activate hidden controls.

```ts
const toolbar = page.getByRole("button", {
  name: "Library", exact: true, includeHidden: true,
}).locator("..");
const trigger = toolbar.getByRole("button", {
  name: "Ambra settings", exact: true, includeHidden: true,
});
await expect(trigger).toBeVisible();
await trigger.focus();
await trigger.press("Enter");
const dialog = page.getByRole("dialog", { name: "Ambra settings", exact: true });
await expect(dialog).toBeVisible();
// The trigger still resolves for boundingBox() while the dialog traps focus.
await page.keyboard.press("Escape");
await expect(dialog).toBeHidden();
await expect(trigger).toBeFocused();
```

Do not relax popup alignment thresholds or remove toolbar motion to compensate
for a locator disappearing mid-poll: the last sampled offset may simply be an
in-animation value. Retain the visibility, viewport, and settled-geometry checks.

Before sending another shortcut guarded by modal ownership, wait for the exiting
surface to unmount: use `includeHidden: true` and `toHaveCount(0)`. A normal role
locator with `toBeHidden()` can pass as soon as `aria-hidden` changes, while the
dialog is still present and correctly blocks the next removal key.

On macOS headless Chromium, arrow keys may not drive the operating system's
native select popup, even in plain HTML. Native type-ahead (for example `s` for
Sepia or `e` for English) exercises real keyboard selection without replacing it
with `selectOption`. Assert the resulting value and retained focus. When testing
successive prefixes, Tab away and return to reset the native type-ahead buffer.

## Reader Library and automatic read-along

`reader-library.spec.ts` covers the lazy left **Library** overlay at narrow and
desktop widths, retained panel state after closing, current-book return without
navigation, and shared reference-panel ownership when opening Contents. Selecting
another book replaces the same reader tab only after a successful position
checkpoint. An injected checkpoint failure must remain visible and leave the
current book and Library panel intact; successful activation also preserves
browser Back navigation. Do not substitute the retired toolbar behavior of
navigating directly to the full-tab Library.

The retained filename `narration-discovery.spec.ts` now covers **Read along**
appearing automatically, expanded and initially paused, for narrated books.
There is no separate **Listen** toolbar entry or discovery notice. Collapse is
ephemeral to that reader opening and retains playback, compact pause/resume, and
focus; reopening starts expanded without autoplay. The suite also checks
**Listen from this page** / **Listen from selection**, localized narrow controls,
and absence of narration UI for plain books. `media-overlay-playback.spec.ts`
retains real-audio, clip-boundary, speed, browsing/return, fixed-layout, loading,
and explicit error coverage.

```sh
AMBRA_E2E_EXTENSION_PATH=/absolute/path/to/frozen-build AMBRA_E2E_HEADLESS=1 \
  pnpm --filter @ambra/e2e exec playwright test \
  reader-library.spec.ts narration-discovery.spec.ts media-overlay-playback.spec.ts \
  --workers=1 --max-failures=5 --output=/absolute/path/to/unique-library-read-along-results
```

## Reflowable animation handoff (#208)

`reflowable-animation-handoff.spec.ts` generates a long original-text EPUB and
opens its middle in a wide spread. It holds the real animation's final frame
before host adoption, then compares both pages' global text/iframe rectangles
and visible text pixels against the settled layout. Forward Page flip covers
one page with its back face, so that page's pixels are checked on the backward
turn instead; both pages' layout rectangles are always checked.

The matrix covers Slide, Page flip, Film strip and Off, LTR/RTL progression,
forward/backward margin clicks, odd and fractional pane widths, and resizing
back to an even width. Off checks unchanged frame geometry and a pixel-identical
round trip. Failures attach final/settled screenshots and horizontal ink-shift
measurements. Run it with:

```sh
AMBRA_E2E_HEADLESS=1 pnpm --filter @ambra/e2e run test:e2e reflowable-animation-handoff.spec.ts
```

## Simple contents-table pagination (#241)

The measurement suite checks row-level pagination, viewer suppression, safe
fallbacks, and footer clipping in single pages and spreads:

```sh
pnpm --filter @ambra/e2e exec playwright test pagination-measurement.spec.ts
```

To also verify the reported Project Gutenberg Frankenstein contents table:

```sh
AMBRA_SIMPLE_TABLE_EPUB="$HOME/Downloads/pg84-images-3.epub" \
  pnpm --filter @ambra/e2e exec playwright test pagination-measurement.spec.ts \
  --grep 'local contents table'
```

The local book remains outside the repository. That opt-in run disables traces
and screenshots and checks all 28 links at multiple widths and font sizes.

## Inline image / line-break pagination (#249)

The measurement suite checks that a zero-width `<br>` box following an inline
image cannot repeat the image's bottom edge on the next page. It verifies
complete, nonduplicated image coverage, visible back links, footer bounds,
single pages and spreads, larger fonts, preserved blank-line spacing and
anchors, synchronous/incremental parity, and unchanged scroll geometry.
Ordinary inline text, icons, SVG, MathML and ruby retain their measurements.
Geometry-read counts are bounded and page planning performs no layout queries.

```sh
pnpm --filter @ambra/e2e exec playwright test pagination-measurement.spec.ts --grep '#249'
AMBRA_IMAGE_BREAK_EPUB="$HOME/Downloads/pg1260-images-3.epub" \
  pnpm --filter @ambra/e2e exec playwright test pagination-measurement.spec.ts --grep '#249'
```

The optional local-book check covers all 14 final image wrappers in the reported
Jane Eyre EPUB. The file stays outside the repository; traces and screenshots
are disabled for this run.

## Linked illustration measurement (#258)

The measurement suite checks image-only inline links and nested wrappers in
LTR/RTL, including formatting whitespace, SVG, `display:contents`, block images,
saved anchors and synchronous/incremental parity. Paginated bounds include
painted images rather than only the link's line box. Scrolling geometry and
publisher clipping remain unchanged; preformatted runs and whitespace-separated
galleries retain their existing fragmentation. Geometry reads are bounded and
the planner makes no new layout queries. Packaged-reader checks cover single
pages and spreads without painting illustrations into the footer.

```sh
AMBRA_E2E_HEADLESS=1 pnpm --filter @ambra/e2e exec playwright test pagination-measurement.spec.ts --grep '#258'
AMBRA_E2E_HEADLESS=1 AMBRA_LINKED_IMAGE_EPUB="$HOME/Downloads/pg1260-images-3.epub" \
  pnpm --filter @ambra/e2e exec playwright test pagination-measurement.spec.ts --grep '#258'
```

The optional local check also accepts a ReadBeyond EPUB. It checks image-only
links outside tables/figures at two width/font profiles; private publication
content is not copied into the repository and traces/screenshots are disabled.

## Oversized simple figures (#257)

The measurement suite verifies that a single image and its caption can cross a
page boundary when their normal-flow group exceeds the page budget. Fitting
figures remain atomic. Long captions, caption-first groups, nested image links,
picture/SVG content, padding, LTR/RTL, saved anchors and incremental parity are
covered. Scrolling, source DOM, image sizing and footer clipping are unchanged.
The packaged-reader cases cover single pages and spreads.

```sh
AMBRA_E2E_HEADLESS=1 pnpm --filter @ambra/e2e exec playwright test pagination-measurement.spec.ts --grep '#257'
```

Negative controls preserve complex figures: galleries, nested figures, floats,
transforms, grid/flex layouts, generated content and
author clipping. Those layouts are not made freely fragmentable by this fix.
Measurement work is bounded; page planning performs no new layout queries.

## CSS-reordered figure captions (#264)

Oversized, single-image figures with non-overlapping image/caption regions can
paginate in visual order, including `display:table` figures whose bottom caption
precedes the image in the DOM. Fitting figures and scrolling retain their prior
behavior. Publisher DOM, CSS, image sizing and accessibility order are unchanged.
The original atomic figure itself must exceed the page budget; its outer page
boundaries are preserved while new caption pages are inserted within them.
Surrounding content therefore keeps its original page windows rather than being
shifted onto different breaks by the extra caption content.
Normal-flow caption lines include emphasis and small raised/lowered scripts;
multicolumn captions, overlapping regions, authored clipping, generated content,
galleries, nested figures and grid/flex layouts remain outside this policy.

```sh
AMBRA_E2E_HEADLESS=1 pnpm --filter @ambra/e2e exec playwright test pagination-measurement.spec.ts --grep '#264'
```

Tests require exact-once character and image coverage, original DOM membership,
end-exclusive boundaries, forced anchors, LTR/RTL, top/bottom captions, cooperative
cancellation, fresh-document snapshot reuse, background CFI/fragment page numbers,
font/viewport reflow, and packaged single/spread forward/back navigation, bookmark
matching and reload/resume. Figure membership is transferred as explicit scoped
DOM ranges, not inferred from a reversed start/end interval. Book-wide indexing
retains only portable figure boundaries, never hidden measurement documents.

Animated single-page replacements also preserve an explicitly forced pagination
anchor. They remeasure with the mapped anchor rather than applying an anchored
page index to a fresh natural layout; this is one measurement, not an additional
layout pass. Canonical snapshots still decline export after anchor repagination.
Transfer covers both descendant positions and document-root (bare-spine) CFIs;
detached or otherwise unmappable anchors are rejected.
Explicit soft-hyphen and automatic-hyphenation cases cover LTR/RTL caption
membership: a generated hyphen on the previous line must not move the next
line's first letter or its saved anchor backward.

## Wrapping inline prose (#256)

Chromium can report a wrapping span's line boxes and then report the same text
bands again. Paginated measurement removes repeated bands only for baseline,
normal-flow inline text when the first occurrences already form ordered,
disjoint lines. It does not sort arbitrary geometry or change scrolling.
Ruby, math, images, positioned content and ambiguous mixed-size bands retain
their existing measurement path.

```sh
AMBRA_E2E_HEADLESS=1 pnpm --filter @ambra/e2e exec playwright test pagination-measurement.spec.ts --grep '#256'
```

Coverage includes exact original-character painting, nested emphasis/links,
LTR/RTL and bidi, saved anchors, incremental parity/cancellation, and a paired
span-heavy benchmark with no added range queries. Packaged single-page/spread
checks traverse forward and backward at two font sizes and verify that every
non-whitespace character appears exactly once.

## Library cover memory regression (#199)

Library cards use persistent thumbnails bounded to 420 × 600 pixels (3× the
140 × 200 CSS-pixel card), keeping aspect ratio. JPEG, still PNG, and static SVG covers,
including Standard Ebooks' embedded JPEG artwork, are resized; SVG thumbnails
use PNG to preserve transparency. APNG (detected from its `acTL` chunk), animated
SVG, GIF/WebP and unknown image formats retain their original rendering. Original covers remain
unchanged for Book Details and the reader.

Existing books are backfilled one at a time when the Library next loads.
Derived covers live in the existing cover row, disappear atomically with book
deletion, and need no database version upgrade. Successful results are reused
across visits; conversion failures warn and show the accessible title fallback,
then retry on a later visit. Optional cache-write failures warn and use the
generated thumbnail only in memory, without claiming it was saved; a later
visit retries persistence. Reads still use the existing Library error path,
and a post-rollback reread prevents a concurrent deletion from being revived.
All session-owned object URLs are revoked on removal/disposal. This
reduces steady-state card decoding, not the initial import/decode high-water
mark or memory held by a reader sharing the extension's renderer.

Run `tests/library-covers.spec.ts` alongside `library-lifecycle.spec.ts` and
`library-transactions.spec.ts` for real image decoding, persistence, SVG
rendering, fallback, deletion races, and transaction-abort coverage.

For a paired memory replay, build the before/after extension into **different**
directories outside the Playwright output directory, then run from the root:

```sh
AMBRA_MEMORY_OUTPUT="$PWD/node_modules/.cache/ambra-library-memory/results" \
  node apps/e2e/scripts/measure-library-memory.mjs \
  path/to/baseline-build path/to/optimized-build \
  path/to/book-one.epub path/to/book-two.epub path/to/book-three.epub
```

The macOS replay imports the same supplied books into two isolated profiles,
closes those browsers, then alternates three fresh-process samples per build
at 1400 × 900 with no readers open. It records post-GC JS heap, renderer RSS
(`ps`, KiB), and Chromium memory-infra private footprint (hex bytes) in
`results.json`; only its own profiles are removed afterward.

On 2026-09-25, Standard Ebooks' *The Autobiography of a Super-Tramp* and
*Ulysses*, plus Gutenberg's `pg84-images-3.epub`, produced:

| Metric | Original covers | Bounded card covers |
| --- | ---: | ---: |
| Private footprint, three fresh runs (MiB) | 68.36 / 71.47 / 73.74 | 63.88 / 59.24 / 59.11 |
| Median private footprint | 71.47 MiB | 59.24 MiB |
| Renderer RSS, three fresh runs (KiB) | 230784 / 218976 / 184592 | 208160 / 204128 / 202736 |
| Median post-GC JS heap (bytes) | 6155872 | 6141904 |

Median private footprint fell **12.23 MiB (17.1%)**; JS heap was essentially
unchanged. RSS was noisy (one original-cover sample was lower than the
optimized samples), so these are controls, not a guaranteed memory budget.
The original Gutenberg raster was 1824 × 2726; displayed thumbnails were
401 × 600 and two 400 × 600 images. The original SVGs reported small intrinsic
viewports despite embedding 1400 × 2100 raster artwork.

These metrics are not Chrome's tab-hover figure. The exact user configuration
and 453 MB fresh-Library / 1.9 GB earlier report remain unreproduced, and this
optimization does **not** explain the full footprint or establish a leak.

### Development mode is a substantial confounder

A read-only inspection of the live checkout's `apps/extension/dist` confirmed
`CRXJS DEV MODE` HTML and a service-worker loader importing Vite/CRXJS modules
from `http://localhost:5173`, rather than a production bundle. No live profile
was opened and no live server/build was changed.

A separate copied source tree, Vite server on port 5187, isolated dependency
cache/build, and disposable browser profiles reproduced a much larger
fresh-Library footprint. **Both variants below used original covers**, the
same three books and replay protocol; this measures development overhead,
not the thumbnail optimization:

| Metric | Isolated CRXJS development | Isolated production |
| --- | ---: | ---: |
| Private footprint, three fresh runs (MiB) | 349.10 / 350.85 / 351.60 | 67.69 / 79.86 / 71.35 |
| Renderer RSS, three fresh runs (KiB) | 437168 / 422880 / 346288 | 229472 / 178704 / 187408 |
| Median post-GC JS heap (bytes) | 98971240 | 6144888 |
| Median backing storage (bytes, reported separately by CDP) | 64560770 | 1105593 |

An additional network probe of the isolated development Library observed
130 script responses totaling **64,538,069 bytes**, with inline source maps
in 129 responses. The largest dependency script alone was 43,655,640 bytes.
There were no separate `.map` requests: the maps were embedded in script
responses, even without DevTools open. These observations support the dev
module/dependency graph, inline maps, and development runtime as substantial
contributors; they do not isolate each one's individual memory cost.

The development control is much closer to the user's reported scale, but
RSS/private footprint still must not be equated with Chrome's hover metric.
The user's exact 453 MB measurement and earlier 1.9 GB remain unverified.
Use a separately built production extension in a separate profile when
comparing user-facing memory; do not overwrite a running development build.
The isolated server and profiles used for this check were stopped/removed.

### Follow-up with the user's three titles

The user subsequently identified the actual set: Standard Ebooks'
[*In Search of Lost Time*](https://standardebooks.org/ebooks/marcel-proust/in-search-of-lost-time/c-k-scott-moncrieff),
Gutenberg's *The Yillian Way* (`pg21782-images-3.epub`), and Davies.
The current public Proust advanced EPUB was downloaded from the publisher on
2026-09-25; the other two files were the user's supplied local downloads.
This reproduces the specified title/edition set, but the newly downloaded
Proust archive has not been compared with the user's original archive bytes.
No ebook contents were added to the repository or uploaded.

The same three-fresh-process protocol was repeated with this set:

| Comparison | First variant | Second variant |
| --- | ---: | ---: |
| Original-cover dev vs production: private footprint, MiB | 345.60 / 346.61 / 346.03 | 70.46 / 68.21 / 68.28 |
| Original-cover dev vs production: RSS, KiB | 705744 / 709280 / 709648 | 235888 / 224192 / 223808 |
| Original-cover dev vs production: median JS heap, bytes | 98961976 | 6144308 |
| Production original vs thumbnails: private footprint, MiB | 63.67 / 68.56 / 68.41 | 62.08 / 59.72 / 60.60 |
| Production original vs thumbnails: RSS, KiB | 234736 / 225872 / 224848 | 191216 / 203568 / 203344 |
| Production original vs thumbnails: median JS heap, bytes | 6151844 | 6151684 |

For this set, thumbnails reduced median private footprint **68.41 → 60.60 MiB**
(**7.81 MiB, 11.4%**) and median RSS **225872 → 203344 KiB**. All three
displayed covers are now 400 × 600. The Yillian cover is a still PNG with
IHDR/IDAT/IEND chunks, not an APNG; this finding motivated the tested still-PNG
path while preserving animation and transparency. Original-cover development
mode remained far heavier: median private footprint **346.03 vs 68.28 MiB**
in production. RSS varied greatly between this and the earlier control set,
reinforcing that none of these values can be substituted for the user's
453 MB hover measurement. The earlier 1.9 GB remains unreproduced.

Replay input SHA-256 values:

```text
Proust: 6eb93a25fef1420e7a5eaef6cff62a49351c26483f9a044a2e9d483d158a4216
Yillian: 194b155014d9b3b64178f22c6af4d071b80a28c029cd4c3516afe114b1983682
Davies: 3749c1e689b783879d3011a84b76c0712676ab4c42243126595e60dcd9bc8e97
```

## Accessibility validation

The accessibility suites cover browser semantics, keyboard ownership, focus
return, native reading offsets, chapter boundaries, and responsive shell layout.
`shell-reflow-accessibility.spec.ts` includes actual 400% Chrome tab zoom as well
as a 320 CSS-pixel viewport, forced colors, and reduced-motion emulation.

On an unlocked Mac with existing Accessibility and event-posting permission,
the opt-in native checks exercise macOS AX text markers and application-scoped
keyboard events (not just Playwright keyboard dispatch):

```sh
AMBRA_NATIVE_ACCESSIBILITY=1 pnpm --filter @ambra/e2e exec playwright test \
  content-boundary-native-focus.spec.ts native-reader-shortcuts.spec.ts
```

Build first; omit `AMBRA_E2E_HEADLESS=1`. These tests activate only their own
temporary browser profile, target its PID, and close it afterward. They do not
enable VoiceOver, change permissions, or unlock the desktop. Missing prerequisites
are reported as skips, not passes.

Native AX focus is not proof of VoiceOver speech or its private reading cursor.
Human acceptance still needs:

- Open/resume a book mid-paragraph and start reading at the expected passage.
- Activate the end-of-chapter control when the next chapter is already visible
  in the same spread; confirm speech continues in that chapter without repetition.
- Repeat chapter/page handoffs in scrolling and fixed-layout reading.
- Use TOC, Search, Go To, and Inspector's Show in book; verify spoken destination
  and return-to-reading behavior, including Escape without navigation.
- Create, edit, and revisit a note; check draft/error announcements and focus.
- Navigate Library, Ambra settings, Book options, and Help without a pointer; check control names.
- Start/pause recorded narration and check for competing or excessive announcements.

## Fixtures

Library download feedback is covered by `tests/epub-direct-import.spec.ts`.
The book-arrival illustration loops every 4.8 seconds and is
static under reduced motion or after completion. It is decorative and outside
the existing polite live region. The tests cover real download success/failure,
motion preferences, focus retention, the centered 600px notification limit,
small-window wrapping, the right-aligned Read now action, and the top-right close button.
Import book and Find books remain available during downloads; the empty-state
message returns after cancellation, with focus on Import book. Cross-tab removal
checks use Book details and its confirmation rather than a hover-only card action.
Completed rows keep their check, wrapped title, and action on the same grid row,
including long book titles at 600px and narrow 360px browser widths.
Progress counts bytes in the Library's own response stream, independently of the
browser's fallback download. A valid uncompressed Content-Length enables percentage
progress; unknown or compressed sizes show only bytes received. Updates are
coalesced to four per second (plus the initial/first/final updates) and are not
re-announced on each tick. Importing and saving remain distinct stages.
Automatic imports journal their native-download ownership before pausing Chrome,
then cancel only after successful persistence. Failure, tab closure/reload, and
browser/extension restart restore the fallback. Library activity renews a five-minute
lease every 30 seconds; a one-minute alarm recovers abandoned imports. The durable
journal survives ordinary service-worker suspension without resuming a healthy
active import. Resume/cancel API failures retain recovery state for later retry.

`fixtures/long-content.epub` — a small synthetic single-chapter book (30
numbered paragraphs, `packages/engine/test/fixtures/long-content-epub-src`
is its source) used by `tests/navigation-correctness.spec.ts`'s exact
content-accounting checks, since its paragraph numbering makes "was
anything skipped or duplicated" a simple, precise check.

The #129 spread regression additionally compares every painted character in
`chained-single-page-chapters.epub` against the original XHTML, traverses the
entire book in both directions, and repeats turns after seeking to the start.
Optional Alice and Frankenstein checks cover fitted cover images and nondefault
fonts (`real-books/frankenstein.epub`: Gutenberg ebook 84).
Navigation checks wait for the scrubber's committed position before sampling
painted characters, not a fixed animation delay. The paired/unpaired chapter
regressions generate original reflowable SVG fixtures under the test output
directory: each 600px atomic page makes the required page-count parity independent
of the operating system's default serif font. The short-chapter #103 regression
runs with this local fixture even when the optional Accessible EPUB 3 corpus
check is skipped. Keyboard/click equivalence traverses the measured page count,
not a font-dependent fixed number of turns.
`tests/reflowable-rtl.spec.ts` derives local RTL fixtures and verifies keyboard,
chapter shortcuts, logical Space, taps, swipes, scrubber direction, page numbers,
and cross-chapter note placement in both single-page and spread layouts.

`outer-margin-navigation.spec.ts` and `spread-gutter-navigation.spec.ts` enforce
outer-margin reflowable taps (#182). A bounded hybrid edge band (#268) also
accepts blank line-end/interline space: 20% of the physical outer pane, at least
64px and at most 160px (never beyond half a pane). These same bands extend
through clipped top/bottom space to the full height of the content pane,
including the top reveal strip and empty chrome padding, without claiming
toolbar controls or pinned panels. Native-pointer checks exercise both sides
from the first to the last viewport pixel in single-page and spread LTR/RTL.
Visible chrome consumes the first tap; a repeated tap in the same blank band
then turns rather than re-revealing chrome. Existing wider real margins
remain usable, with no change to publication layout or pagination. Text line
rectangles, interactive content, images, native list markers, and generated
labels retain ownership. Content outside the band, inner page margins, gutters,
and blank companion interiors remain inert. Coverage includes LTR/RTL,
cross-chapter spreads, all animation styles, and scaled fixed-layout artwork.
Animation-phase checks (#279) pause the actual CSS transitions and hold their
safety deadline while a native pointer stays stationary. They verify both
request counts and the final spread: gutters stay inert as the paper moves,
while genuine outer-margin taps retain the bounded queued turn. Slowing
`Element.animate()` does not control these CSS transitions.
Navigation fixtures use `outerMarginPoint` / `clickReadingPage` to derive targets
from the rendered reading measure, not arbitrary content coordinates.
Fixed-layout artwork also accepts outer-edge taps (#206): 8% of each rendered
outer page, capped at 64 CSS pixels, without activating inner edges or gutters.
`fixed-layout-edge-navigation.spec.ts` covers width-fitted artwork, native controls,
selection, chrome dismissal, reading focus, and RTL. The #169, #174, and #180 native pointer regressions retain their
selection, single-tap, and zero-opacity intent on valid outer margins.

`svg-spine.spec.ts` uses original synthetic SVG pages to check startup, intrinsic
viewport sizing, native reading focus, resume, and the no-scripting sandbox (#205).
For optional local reproductions, set `AMBRA_SVG_SAMPLE` to the downloaded
`svg-in-spine.epub` and `AMBRA_WIDE_FXL_SAMPLE` to `recollections-of-wartime.epub`
when running the SVG/edge specs. Keep downloaded public books outside the repository;
the default regressions generate their own content in test output directories.

`resize-lifecycle.spec.ts` and `settings-lifecycle.spec.ts` also bundle the
controller directly into a real Chromium page. Controlled chapter-load gates
exercise overlapping turns, resizes, typography, mode changes, and load failures
without relying on UI debounce timing or adding production test hooks.
Held second-column scenarios cross the single-page/spread threshold first:
an ordinary same-mode spread resize intentionally does not load new documents.

## Synthetic scale checks

Generate the optional scale fixtures locally (about 113 MB for the illustrated
EPUB, plus extracted sources) before running the focused sweep:

```sh
node apps/e2e/scripts/generate-scale-fixtures.mjs
pnpm --filter @ambra/e2e run build:extension
pnpm --filter @ambra/e2e exec playwright test scale-validation.spec.ts \
  --output real-books/scale-validation/results --trace off
```

The binaries stay in the ignored `real-books/scale-validation/` directory.
The tests exercise 96 decoded images, a 120-chapter/199k-word book, and seven
XHTML content categories. Recorded timings and generous hang-detection bounds
are not hardware-independent performance guarantees or exhaustive content tests.

The small native-disclosure fixtures are committed, so their regression tests
run without a generation prerequisite:

```sh
pnpm --filter @ambra/e2e exec playwright test disclosure-pagination.spec.ts disclosure-interaction.spec.ts
```

These check exact rendered-line accounting in both directions, expanded/collapsed
state, keyboard focus, and mode changes. The held-load/queued-resize check samples
visible frames inside the reader's main landmark and polls their complete width
array atomically. Deterministic controls exclude background-estimator and
transparent staging frames without relaxing the two-page spread assertion (#261).
Use `--repeat-each=5` on `disclosure-interaction.spec.ts` to exercise the race checks
repeatedly. To regenerate those small fixtures,
run `node apps/e2e/scripts/generate-disclosure-fixture.mjs`.

## Bookmark cards (#213)

`bookmark-panel.spec.ts` checks the real packaged reader at 1400px and 320px:
two-line word-wrapped chapter titles (including unbroken text), full-title hover,
separate always-visible page badges, current-layout bookwide pages across chapters
and font/pinned-panel reflow, unchanged legacy labels/CFIs, keyboard deletion focus, and
publisher bookmarks' read-only navigation. It captures settled Ambra, Silver and
Purple screenshots at both widths. Scrolling shows "Page unavailable" rather
than reusing a stale paginated number. Unit tests cover pending measurements and
invalid positions without inventing page numbers.

Bookmarks live in the right **Annotations** panel, not a separate toolbar panel.
Its **Show** native select offers **All annotations**, **Highlights**, **Notes**,
and **Bookmarks**, with counts. Use `getByRole("combobox", { name: "Show" })`
and assert its value (`all`, `highlights`, `notes`, or `bookmarks`), not retired
filter tabs or chips. The panel shares single-reference-panel ownership with
Contents, Search, and Library.

The CI reader matrix includes this spec plus annotation mutation, import/export
and embedded-annotation regression suites. Its `bookmark-panel-review-<sha>`
artifact retains the six review screenshots. For a targeted run, point
`AMBRA_E2E_EXTENSION_PATH` at an isolated packaged build and run:

```sh
AMBRA_E2E_HEADLESS=1 pnpm --filter @ambra/e2e exec playwright test \
  bookmark-panel.spec.ts annotation-mutation-lifecycle.spec.ts \
  annotation-export-import.spec.ts embedded-annotations.spec.ts --workers=1
```

## Pagination measurement regressions (#197 / #198)

The packaged reader's concentrated-chapter regression checks no-animation document
reuse, exact native reading entry, animated preparation, bounded queued margin
clicks, and unknown global footers. An optional actual Proust pass measures all
four animation modes and checks retained document/JS counts after repeated turns:

While whole-book counts are unavailable, the scrubber shows "Mapping your book…"
instead of a page total, including in its accessible value, only after its first
hide/reveal cycle. It is suppressed on the initial book-opening appearance. Book startup uses
"Getting your book ready…" and subsequent loading uses "Turning to your page…";
these messages do not change focus or delay navigation.

`fixed-layout-scrubber.spec.ts` checks immediate fixed-layout page totals,
LTR/RTL keyboard and pointer seeking, exact companion-page destinations,
bookmarks, resize and resume. Each fixed-layout spine item contributes one
page without loading a measurement document. Mixed books still measure their
reflowable chapters; a saved scrolling preference does not hide the FXL scrubber.
Native moves into an already-visible companion update the scrubber immediately.
`scrubber-bookmarks.spec.ts` also checks the separate interactive bookmark lane
above the wide position slider, including current/adjacent pages, duplicate
clusters, long-book last pages and 320px RTL. Single markers navigate directly;
nearby markers group into a keyboard-accessible chooser that retains distinct
saved positions, including multiple positions on one page. Dense groups offer
**Show all bookmarks**, opening Annotations with **Show: Bookmarks** and handing
focus to that filter.
The preview and slider value say "Bookmarked" only for an exact measured page
match, not for nearby flags; coarse or invalidated counts cannot claim a match.
The suite captures desktop/narrow/forced-color screenshots and checks chooser
focus return, popup bounds, reduced motion, bookmark counts, and separate
marker/slider hit testing. The lane does not intercept persistent read-along
controls at 320px or 400% browser zoom.
Panel clearance follows the shared 72px scrubber height. Bookmark status text
uses the neutral foreground for text contrast; its icon uses the selected
interface theme's semantic bookmark color.
Mixed-book seeks into scrolling chapters restore the measured page's CFI rather
than dropping the destination and opening the chapter's beginning.
Typography changes retain that exact scrolling position before mutating styles.

```sh
pnpm --filter @ambra/e2e run build:extension
AMBRA_E2E_HEADLESS=1 pnpm --filter @ambra/e2e exec playwright test reader-scale-navigation.spec.ts
AMBRA_E2E_HEADLESS=1 AMBRA_PROUST_EPUB=/path/to/proust_advanced.epub \
  pnpm --filter @ambra/e2e exec playwright test reader-scale-navigation.spec.ts
```

Without the local EPUB the actual-book case is skipped, not counted as passing.
The synthetic case has one concentrated chapter of more than 600 pages, unlike
the many-short-chapter scale fixture. Same-document turns avoid new hosts when
animation is off or reduced motion is enabled; animated turns keep their existing
visual effects and can transfer guarded DOM-free page boundaries to fresh hosts.
Snapshot mismatches fall back to measurement. At most one extra turn is retained
while busy; a newer direction replaces the queued one. Explicit navigation,
layout changes, failures and disposal discard stale queued input.

In the local production-build replay of the actual Proust advanced EPUB (1,400 x
900 viewport), the largest chapter measured 474 pages and the book 4,274 pages.
Settled turns took 11.6 ms without animation, 815.5 ms for slide, 920.4 ms for
rotate, and 789.2 ms for scroll animation. After twelve additional alternating
animated turns and forced GC, document count stayed at four and retained JS
increased by approximately 0.28 MiB. These are local timings and retained-JS
checks, not total-renderer memory measurements or hardware-independent guarantees.

This focused Chromium suite bundles the engine in memory; it does **not**
require or overwrite an extension build:

```sh
pnpm --filter @ambra/e2e exec playwright test pagination-measurement.spec.ts
# Optional local real-book verification (the EPUB is never copied into the repo):
AMBRA_VISUAL_CLIPPING_EPUB=/path/to/w-h-davies_the-autobiography-of-a-super-tramp_advanced.epub \
  pnpm --filter @ambra/e2e exec playwright test pagination-measurement.spec.ts
# Optional real large-chapter snapshot validation (largest spine item selected):
AMBRA_PAGINATION_SCALE_EPUB=/path/to/proust-advanced.epub \
  pnpm --filter @ambra/e2e exec playwright test pagination-measurement.spec.ts -g 'local real large'
```

It checks complete title/logo image bounds and Chromium accessibility-tree
exposure of offscreen semantic headings, visible absolute content, LTR/RTL,
disclosures, exact synchronous/incremental page-boundary parity, heartbeat
responsiveness inside a single long paragraph, and immediate disposal of stale
background hosts. JSON attachments record image bounds and timing evidence.
Synthetic prose is generated locally; no third-party book text is committed.
An additional comparison checks every measured chunk against prefix-range
bisection across whitespace, bidi, ligatures, ruby, and MathML. Plain-text leaves
use single-character probes (falling back for zero-width/collapsed characters);
complex inline content keeps prefix probes, with repeated line-top lookups cached.

Background estimates use cooperative measurement checkpoints, including line
bisections, with an 8ms target work budget. Browser layout queries themselves
cannot be interrupted, so this is not a hard main-thread latency guarantee.
The heartbeat regression starts at incremental measurement, after the browser's
non-cooperative iframe parsing/initial layout; whole-run elapsed time is recorded
separately. It does not claim an upper bound on document-startup latency.
Foreground chapter opening, incoming-page preparation and spread probes now
measure cooperatively in hidden, operation-owned hosts (#260). Completed
background counts/CFIs are preserved while pending background measurement is
paused, then resumed after foreground work settles. Foreground yields use
short-lived message channels: nested timers add substantial clamping overhead,
while boosted scheduler continuations can starve ordinary timers despite
producing no long-task entries. Test real pointer input, heartbeat gaps, and
long tasks together, not merely the duration of individual work slices.
`PaginatedContentHost.open` accepts a fifth `configure(document)` argument,
applied after disclosure state and before font readiness/initial measurement,
and optional sixth `PaginatedOpenOptions`. Foreground callers supply the owning
operation's cancellation signal and opt into retaining canonical snapshots.
An optional position resolver establishes fragment/CFI boundaries in the first
measurement, avoiding a second synchronous pass after revealing the host.
Dimensions and typography must stay fixed while a candidate measures; staged
frames retain their explicit width even if a flex parent resizes. Native
disclosure mutations invalidate the pass and are remeasured before publication;
CSS/SMIL animation and font readiness are checked on every attempt, with
unstable documents retaining atomic measurement.
Existing in-place resize/typography reflow and narration jumps remain synchronous:
this change does not yield while measuring a visible, mutable document.
The #260 regressions verify exact canonical/forced boundaries, snapshot reuse,
disclosure invalidation, latest-request-wins cancellation, background resumption,
and input responsiveness while a large original chapter opens.
`BookPaginationEstimator.cancelPendingMeasurement()` immediately retires pending
work while preserving completed counts and CFIs; a later `run()` resumes by
skipping those completed chapters. Cheap in-place turns need not cancel it.
For independently loaded animated candidates, `host.paginationSnapshot()` returns
DOM-free paths and bounds only while the source still matches its measured
configuration. Pass that value as the seventh `open()` argument. Exact assembled
source, configured markup/CSSOM, geometry, font and disclosure state must match;
otherwise the host measures normally. Reader-owned overlays are excluded, but
authored attributes remain part of the identity. Snapshot paths resolve solely
against the new document, and no old document or Range is retained. Forced-anchor
repagination invalidates snapshot export.
SMIL and potentially dynamic media conservatively disable transfer, including
images and SVG references behind opaque resource URLs whose intrinsic-size or
animation stability cannot be established synchronously. Static inline SVG is
eligible; media chapters simply use normal pagination rather than unsafe reuse.

## Real-book smoke suite

Synthetic fixtures are precise but narrow — real EPUB3 files routinely
have formatting quirks no fixture's own author would think to construct.
`tests/real-books.spec.ts` opens a small, diverse set of real books
(a full Project Gutenberg novel; IDPF's own official EPUB3 samples
covering span-heading nav/TOC-in-spine, accessibility-focused authoring,
RTL/BIDI Hebrew content, and internal-link navigation) and checks each
one actually renders content, never dead-ends on a click, and produces no
unexpected console errors.

These book files are **not committed to this repo** (third-party
content, plus repo-size reasons) — download them first:

```sh
node scripts/download-real-books.mjs
```

`real-books.spec.ts` skips (not fails) any book whose file isn't present,
so a fresh clone's first `test:e2e` run doesn't spuriously fail before
anyone's run the download script. To add another real book to the suite,
add an entry to both `BOOKS` arrays (the download script and the spec
file) with a direct download URL and a one-line description of what makes
it worth including.

## Adding a new test

Use `harness.ts`'s `launchReader`/`currentPageLabel`/`currentPageText`/
`clickForwardAndWait` helpers rather than re-deriving the "launch a
persistent Chromium context with the extension loaded, import a book,
open it" dance in every spec file.

## Bounded synthetic content variation / stress

`tests/content-stress.spec.ts` generates ten deterministic, original-content
EPUB3 combinations using `content-stress-fixtures.ts`. No external books or
generated binaries are required in git:

| Combination | Stress dimensions |
| --- | --- |
| `toc-1000-nested-notes` | 1,000 fragment entries, depth 12, nested footnotes |
| `toc-1000-unicode-spread` | 1,000 literal-Unicode anchors, mixed scripts, spread |
| `120-short-chapters-notes` | 120 tiny spine documents, nested notes |
| `80-short-chapters-rtl` | 80 tiny chapters, RTL progression, Unicode, spread |
| `deep-unicode-notes` | TOC depth 16, Unicode, nested footnotes |
| `transparent-extreme-media` | Transparent/inline SVG, 50:1 and 1:50 images |
| `media-rtl-spread` | The same media combined with RTL spreads |
| `wide-table-pre-narrow` | 12-column table, 1,300-character token, long code, 600px |
| `overflow-unicode-scroll` | Overflow specimens, Unicode, scrolling |
| `mixed-writing-notes-scroll` | RTL/mixed scripts, vertical specimen, notes, scrolling |

The assertions cover complete TOC enumeration, ordered/in-range page mappings,
real destination visibility at first/deep/middle/final entries, ordinary
margin-turn round trips, notes without navigation, image decoding, code-block
keyboard scrolling, persisted final position after reload, and destinations
after typography changes. Facing-spread labels may belong to the other visible
chapter: tests check the requested target's geometry and mapped displayed page,
not an incorrect assumption that the primary chapter must always own the target.
Arrows inside overflowing `pre` blocks intentionally scroll code; outer margins
are used for page turns. This is not a claim of full vertical-writing support
or that every oversized table cell fits. Confirmed paginated table content loss
is covered separately by the opt-in #229 reproduction below. The table viewer
regressions verify access without reflowing or resizing the original table.

From the repository root, keep the extension, runtime, profiles and output
isolated from other runs and the live extension:

```sh
RUN="$PWD/apps/e2e/real-books/content-stress-$(date +%Y%m%d-%H%M%S)-$$"
mkdir -p "$RUN/runtime"
export TMPDIR="$RUN/runtime"
export AMBRA_E2E_EXTENSION_PATH="$RUN/extension"
pnpm --filter @ambra/e2e run build:extension
AMBRA_E2E_HEADLESS=1 pnpm --filter @ambra/e2e exec playwright test \
  tests/content-stress.spec.ts --output "$RUN/results"
```

Every case retains its EPUB, expanded source, `scenario.json`, screenshots
(including the end of the TOC), and measurements under its result directory.
Import the EPUB directly for manual review, or add `--grep 'case-id$'` to replay
one case. The normal run is **16 passing cases and 4 skipped opt-in repros**:
ten content combinations, six fragment-navigation regressions, and four table
comparisons that remain opt-in.

### Encoded-fragment regression (#228)

[Issue #228](https://github.com/BCWalters/ambra/issues/228) reduces an encoded
Unicode fragment failure to one chapter and two links: `#arrivée` succeeds;
`#arriv%C3%A9e` previously lost its TOC page number and did not navigate.
Fragments are now decoded exactly once when a raw EPUB href is parsed, before
TOC page mapping, navigation, internal links, footnotes, or narration use the
element ID. Literal percent escapes are not decoded a second time. Malformed
publisher escapes retain their literal value with a diagnostic warning.
The standalone generator writes both EPUBs and their complete original sources:

```sh
node apps/e2e/scripts/generate-encoded-fragment-repro.mjs "$RUN/minimal"
AMBRA_E2E_HEADLESS=1 \
  pnpm --filter @ambra/e2e exec playwright test tests/content-stress.spec.ts \
  --grep '#228' --repeat-each 2 \
  --output "$RUN/repro-results"
```

Both variants now pass in single-page, spread and scrolling modes, including
TOC page mapping in paginated modes and resume after reload. These six tests run
normally and in CI against the packaged production build; no opt-in flag is
required. Unit coverage also checks EPUB3 navigation lists, legacy NCX, SMIL,
encoded delimiters, literal percent IDs, internal links, and footnotes.
Historical review screenshots retain the original pre-fix comparison.

### Confirmed paginated table content loss (#229), explicit opt-in

[Issue #229](https://github.com/BCWalters/ambra/issues/229) confirms that the
rightmost columns of `wide-table-pre-narrow` cannot be reached by native
horizontal scrolling or any page of the chapter in paginated mode. A one-page,
three-column reduction reproduces this without code blocks or other overflow.
The issue contains the complete original source and measured geometry.

In `overflow-unicode-scroll`, columns **are reachable**: hover the table and
horizontally scroll toward later columns with a trackpad/wheel. A native
`deltaX` of approximately 3,089 pixels brings Column 12 fully into the 900px
viewport. The whole chapter pans horizontally, not just the table. The minimal
EPUB also passes this Scroll-mode control at 600px. This working interaction
does not make paginated data loss merely a design choice.

```sh
node apps/e2e/scripts/generate-wide-table-repro.mjs "$RUN/minimal-table"
AMBRA_E2E_HEADLESS=1 AMBRA_E2E_TABLE_REPRO=1 \
  pnpm --filter @ambra/e2e exec playwright test tests/content-stress.spec.ts \
  --grep 'wide table native reachability' --repeat-each 2 \
  --output "$RUN/table-results"
```

This inline-only reproduction intentionally produces **four paginated failures and four
Scroll-control passes**: both original fixtures and the table-only reduction
are exercised twice in fresh profiles. Results include native-wheel screenshots,
EPUB/source, every ancestor's overflow/scroll metrics, and page traversal. It
does not open the viewer and is not the viewer fix's acceptance test.

### Table viewer regression (#229)

`tests/table-viewer.spec.ts` exercises the original three-column reduction in
single-page, facing-spread, scroll and RTL configurations, an inherited-style
24-row table with a nested table and local image, and the twelve-column stress
fixture down to a 320px viewport. It uses native wheel input and checks that the
complete far cell is visible, not merely present in the DOM. The suite also
checks theme colors, keyboard focus across the frame boundary, Escape and
focus restoration, zoom limits/reset, source-layout preservation, and modal
navigation ownership. CI runs it against the packaged production extension.
The paginated, scroll, RTL and styled-table checks keep native scrollbars visible
(`showScrollbars: true`); Chromium's default headless scrollbar hiding would
otherwise mask width loss from classic scrollbars. The styled-table test also
changes the scrollbar width and verifies zero horizontal overflow and exact
table centering after the viewport updates.

```sh
AMBRA_E2E_HEADLESS=1 pnpm --filter @ambra/e2e exec playwright test \
  tests/table-viewer.spec.ts --output "$RUN/table-viewer-results"
```

Each case retains original synthetic EPUB/source and screenshots for visual
review. The original table is intentionally not reflowed: use **Expand table**
to inspect clipped cells in the isolated viewer. See the
[table viewer guide](../../docs/user-guide/table-viewer.md) for supported
controls and publisher-style limitations.

### One-click visual gallery

After running the matrix and opt-in repro above, generate a self-contained local
HTML review with screenshots, downloadable EPUBs, source and measurement links,
and copyable per-case commands against the immutable build:

```sh
node apps/e2e/scripts/render-content-stress-review.mjs \
  "$RUN/results" "$RUN/repro-results" "$RUN/review" "$RUN/extension" \
  "$RUN/table-results"
open "$RUN/review/index.html" # macOS; otherwise open it in a browser
```

Clicking a screenshot opens it full-size. Copy buttons only copy a command;
they do not auto-open an extension reader. The gallery explicitly separates
confirmed bug evidence from visual-policy review (wide tables, mixed writing,
and extreme-aspect media). No image-viewer background change is implied.
