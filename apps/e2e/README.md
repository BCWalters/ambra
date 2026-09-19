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

## Fixtures

`fixtures/long-content.epub` — a small synthetic single-chapter book (30
numbered paragraphs, `packages/engine/test/fixtures/long-content-epub-src`
is its source) used for the exact-content-accounting tests, since its
paragraph numbering makes "was anything skipped or duplicated" a simple,
precise check.

For a broader, slower pass against real-world EPUB formatting quirks
(footnotes, images, varied typography, RTL/vertical text, etc.) beyond
what synthetic fixtures cover, see the session's own notes on downloading
public-domain books from Project Gutenberg / the IDPF EPUB3 samples
collection for occasional manual or scripted spot-checks — those aren't
checked into this repo (licensing and repo-size reasons), so they're not
part of this automated suite yet.

## Adding a new test

Use `harness.ts`'s `launchReader`/`currentPageLabel`/`currentPageText`/
`clickForwardAndWait` helpers rather than re-deriving the "launch a
persistent Chromium context with the extension loaded, import a book,
open it" dance in every spec file.
