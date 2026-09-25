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

**Not on every iteration.** This spins up real Chromium instances (slow,
one worker at a time — see `playwright.config.ts`) and is meant as an
occasional, broader regression gate — after a batch of pagination/
rendering/interaction work, before a release, or when investigating a
reported navigation bug. `@ambra/engine`'s unit tests remain the fast,
every-iteration signal.

## Running it

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

Tests using the shared `launchReader` harness can opt into full Chromium's
headless mode with `AMBRA_E2E_HEADLESS=1`. This keeps validation from opening
windows or interrupting someone testing the live extension. It still loads the
real unpacked extension, not a web-only preview.

For concurrent validation, set `AMBRA_E2E_EXTENSION_PATH` to a dedicated
absolute build directory for both the build and test commands. This keeps
one run's rebuild from replacing files used by another run's browser.
Give each run its own Playwright output directory too, so profiles and reports
cannot overwrite another run's artifacts.
Use only a disposable build directory: the build empties it first.

```sh
export AMBRA_E2E_EXTENSION_PATH="$(mktemp -d /tmp/ambra-e2e-build.XXXXXX)"
pnpm --filter @ambra/e2e run build:extension
pnpm --filter @ambra/e2e exec playwright test tests/about-flyout.spec.ts \
  --output "$(mktemp -d /tmp/ambra-e2e-results.XXXXXX)"
```

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
global setting, not a book override. In **Settings**, the
**Page theme** submenu contains **White**, **Sepia**, and **Dark**
`menuitemradio` rows with colored previews. **Brightness** stays directly
accessible on the top-level menu. The appearance section is ordered
**Reader theme**, **Page theme**, then **Brightness**, before the divider.
Assert selection with `aria-checked`. Theme changes apply across books;
old per-book themes must not override them. Legacy `defaultPageTheme` initializes
the global theme, with white as the fallback.

The book's **Page** menu instead has **Always show one page**, saved per book
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
- `reader-preferences.spec.ts`: compact top-level Settings height, consistent
  flyout ordering, preview colors, full-menu/preview screenshots in the reader and Library, and the
  **Page theme**, **Reading mode**, **Page turn**, and **Reader theme** submenus. The parent rows show the current
  value; Page turn is disabled while scrolling. Animation/theme choices inside
  the submenus remain `menuitemradio` controls with `aria-checked`.
  Computed-font checks preserve the 14px semibold dark title and 14px regular
  Brightness label, choices, and submenu rows.
- `settings-focus.spec.ts`: **Reading mode** choices (**Paginated**
  and **Scroll**) and Page theme choices use menu arrow navigation for focus and
  Enter/Space for selection inside their flyouts. Reading mode shows inline keyboard shortcuts.
  Tab exits the menu; Escape closes one menu level and restores focus. Fixed-layout books hide
  Reading mode; Language remains a submenu and Help keeps its existing dialog.
- `shell-reflow-accessibility.spec.ts`: theme previews, submenus, and the
  one-page switch at 320px and actual 400% browser zoom, with menu screenshots.
  Both reader and Library exercise the single-row Brightness label, slider,
  and reset in all nine locales at 320px, checking geometry and real keyboard input.
  At 1400px, both top-level Settings and Book options popovers open below their
  triggers with matching right edges; narrow viewports retain collision fallback.
  Both titles share the same 14px/600 dark text and 20px line-height.
  Anchor screenshots include the trigger and surrounding reader, not just the menu.
- `shell-accessibility-audit.spec.ts`: Chromium's actual accessibility tree
  exposes named Page theme/Reading mode flyout menus with checked
  menu-row names, selection, and focus. This checks browser semantics, not
  VoiceOver speech or a complete ARIA conformance audit.
  Library toolbar tooltips are hidden while Settings is open so they cannot
  consume the first Escape from Language. Pointer and pre-visible-tooltip
  cases check one-level dismissal, restored focus, and normal tooltip behavior
  after the menu closes.

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
- Navigate Library, Settings, and Help without a pointer; check control names.
- Start/pause recorded narration and check for competing or excessive announcements.

## Fixtures

Library download feedback is covered by `tests/epub-direct-import.spec.ts`.
The book-arrival illustration loops every 4.8 seconds and is
static under reduced motion or after completion. It is decorative and outside
the existing polite live region. The tests cover real download success/failure,
motion preferences, focus retention, the centered 600px notification limit,
small-window wrapping, the right-aligned Read now action, and the top-right close button.
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
outer-margin-only reflowable taps (#182): content whitespace, inner page margins, gutters,
and blank companion interiors never navigate. Coverage includes LTR/RTL,
cross-chapter spreads, all animation styles, and scaled fixed-layout artwork.
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
state, keyboard focus, and mode changes. To regenerate those small fixtures,
run `node apps/e2e/scripts/generate-disclosure-fixture.mjs`.

## Pagination measurement regressions (#197 / #198)

The packaged reader's concentrated-chapter regression checks no-animation document
reuse, exact native reading entry, animated preparation, bounded queued margin
clicks, and unknown global footers. An optional actual Proust pass measures all
four animation modes and checks retained document/JS counts after repeated turns:

While whole-book counts are unavailable, the scrubber shows "Counting pages…"
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
`scrubber-bookmarks.spec.ts` also checks the bookmark flag lane: 18px flags
remain at their exact fractions above (never underneath) the thumb, including
current/adjacent pages, duplicate clusters, long-book last pages and 320px RTL.
The preview and slider value say "Bookmarked" only for an exact measured page
match, not for nearby flags; coarse or invalidated counts cannot claim a match.
Markers remain decorative, with no extra click targets or focus stops. The
suite captures desktop/narrow/forced-color screenshots and checks popup bounds,
reduced motion, bookmark counts and unchanged seek hit testing.
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
Foreground pagination remains synchronous against its live document.
`PaginatedContentHost.open` accepts a fifth `configure(document)` argument,
applied after disclosure state and before font readiness/initial measurement,
and optional sixth incremental-measurement options for isolated background
hosts only. Hosts must not change layout while incremental measurement runs.
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
