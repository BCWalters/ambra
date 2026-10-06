# Ambra UX design prototype

Standalone, interactive HTML/CSS/JavaScript reviewed with the owner on
2026-10-01. The [design system](../design-system.md) records approved decisions
and qualifications; [#286](https://github.com/BCWalters/ambra/issues/286) contains
the discussion and [#289](https://github.com/BCWalters/ambra/issues/289) the roadmap.

## Open it

Clone/download the repository and open [index.html](index.html) in a current
Chromium browser. Keep [assets/](assets/) beside it. No dependency install,
extension build, server, account, or network fetch is needed for the prototype.
GitHub's file viewer displays source rather than running the HTML; no public
preview hosting is configured by this publication.

The study includes full library, reader, and compact-popup views; five interface
themes that follow browser light/dark; independent book-page appearance; empty,
small, and populated libraries; settings/help/discovery; note editing; search,
bookmarks, grouping, and a chapter-aware scrubber; simulated read-along controls.
Use the controls outside the app frames to change sample data and density.

## Boundaries

- Original sample prose/notes and generated covers; three credited real covers.
  See [credits and provenance](credits.html) and the retained
  [Fluent icon license](assets/fluent-icons-LICENSE.txt).
- In-memory state only. No real library, EPUB parsing, user files, or settings.
  Reset sample is not a proposed app recovery/undo feature.
- Page positions and four excerpts illustrate a 157-page book, not a pagination
  engine. Narration changes control states only: no audio or speech synthesis.
- The standalone compact frame is not a native Chrome action popup. Native
  sizing, all nine locales, live AT, real books, and runtime state/error handling
  still need implementation validation.
- Controls described as disconnected are intentionally disconnected. Missing
  prototype functionality is not authorization to remove production features.
- Reference panels start pinned for review only. Chrome auto-hide is not
  simulated. Some exact styling and persistence decisions remain open in the
  specification.

This directory is a review reference outside extension build inputs, not a
second production UI or an engine to copy into the extension.

## Experimental EPUB content explorer

Open [inspector-explore.html](inspector-explore.html) directly in a browser.
This separate, unapproved concept explores whole-book search and browsing by
content type within a single-book reading experience. It does not change the
approved prototype or the shipped Inspector.

Try browsing images or tables, finding `alt=""` in source, filtering by chapter,
and moving between matching elements. Selecting a result previews it without
moving the reader; **Show in book** explicitly moves to its sample location.
**Expand inspector** gives the exploration more room.

The sample uses original fictional prose, inline illustrations, and a small
hand-authored content index. It does not parse EPUBs, perform accessibility
checks, or implement comprehensive publication search. Text/source search
boundaries and proposed content-type definitions are explained in the UI.
No build, server, network access, or dependency install is needed to open it.

With existing repository dependencies and Playwright Chromium available,
verify this separate study with:

```sh
node docs/design-prototype/scripts/verify-inspector-explore.mjs
```

This checks sample search/filtering, reading-position isolation, source and
preview switching, result navigation and keyboard focus, sample links, and
responsive layouts. It does not validate EPUB parsing or live screen readers.

## Compact-library alternatives

Open [compact-library-explore.html](compact-library-explore.html) directly.
This separate, unapproved #351 study compares three compact-library-only options:

- **A: Return to reading (recommended)** - one clear resume action, then quiet
  book rows and reading lists.
- **B: List-first notebook** - list navigation first, with the books using
  the rest of the space.
- **C: Small bookshelf** - covers first and a single list chooser.

All use the existing five palettes, browser-following light/dark appearance,
approved local covers/provenance and original generated samples. Try 320/360px,
empty/small/full libraries, filtering/sorting, switching lists, opening a sample
and adding a generated sample. Search/sort are secondary disclosures, with a
visible clear action when a closed disclosure still has an active query.

Settings/help/discovery and import remain available without becoming the focal
point. The full-library links open the reviewed prototype with its own separate
sample. Sample reading uses original prose, not the selected real work's text.
No network fetch, file access, storage, server or extension build is needed.

This is not production compact UI and does not change the approved snapshot.
The owner must choose before implementation. Only static syntax/lint/markup/asset
checks are claimed; no local browser was launched. Native popup geometry, visual
behavior, all nine locales and live assistive technology remain unvalidated.

## Optional prototype verification

The reviewed snapshot passed 150 responsive cases, 1,327 interaction/layout/asset
checks, 130 contrast pairs, and no browser errors before publication. Publication
does not rerun extension builds or the runtime browser suite.

For future prototype changes, after the normal repository dependencies and
Playwright Chromium are available, run from the repository root:

```sh
node docs/design-prototype/scripts/verify.mjs
```

This optional runner uses existing development dependencies, an isolated
headless browser, and the local HTML. It checks interactions/layout/contrast and
compares the included Fluent glyphs with the installed dependency. It does not
build or load the extension, read a real library, or contact the cover sources.
Generated PNGs and `verification.json` stay untracked in this directory.
Its results do not substitute for runtime or manual assistive-technology tests.

The optional verifier is a standalone review tool, not a package script or CI
entry point. Changes here do not constitute a Chrome Web Store release.
