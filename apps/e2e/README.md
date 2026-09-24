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

## Fixtures

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
outer-margin-only taps (#182): content whitespace, inner page margins, gutters,
and blank companion interiors never navigate. Coverage includes LTR/RTL,
cross-chapter spreads, all animation styles, and scaled fixed-layout artwork.
Navigation fixtures use `outerMarginPoint` / `clickReadingPage` to derive targets
from the rendered reading measure, not arbitrary content coordinates.
Width-fitted fixed-layout pages have no lateral margin; keyboard/toolbar navigation
remains available. The #169, #174, and #180 native pointer regressions retain their
selection, single-tap, and zero-opacity intent on valid outer margins.

`resize-lifecycle.spec.ts` and `settings-lifecycle.spec.ts` also bundle the
controller directly into a real Chromium page. Controlled chapter-load gates
exercise overlapping turns, resizes, typography, mode changes, and load failures
without relying on UI debounce timing or adding production test hooks.

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
