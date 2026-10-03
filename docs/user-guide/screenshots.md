# Screenshot sources and capture status

The guide's screenshots show the 2.0.0 interface in a fresh, offline Playwright
Chromium profile. They contain only a checksum-pinned classic demonstration
copy and an original synthetic narration fixture, never a personal library.
All images are 1280 × 800 pixels and are actual browser captures, not mockups.

## Current status

These are **packaged-runtime captures** of the final verified 2.0.0 package from
clean, merged source
[`90d329c910711995fa526647dc57d96a3edf9241`](https://github.com/BCWalters/ambra/commit/90d329c910711995fa526647dc57d96a3edf9241)
(release-preparation PR #316). Every file in the captured runtime matched the
checksum-verified `ambra-2.0.0.zip`; both remained unchanged during capture.
This does not establish that 2.0.0 is published in the Chrome Web Store.

[Capture provenance](images/provenance.json) records the exact runtime source
commit, candidate tree SHA-256, fixture checksums, image checksums, viewport,
and browser-visible assertions. A documentation commit is not a runtime source
attestation. Website publication and its immutable guide revision are managed
separately.

## Content credits

- *Alice's Adventures in Wonderland*: Lewis Carroll, [Project Gutenberg ebook
  11](https://www.gutenberg.org/ebooks/11).
- “Alice meets the Caterpillar”: John Tenniel (1820–1914), illustration 15 from
  [Project Gutenberg ebook 114](https://www.gutenberg.org/ebooks/114),
  [source GIF](https://www.gutenberg.org/files/114/114-h/images/alice15a.gif).
  The demonstration copy combines PG11 text with this PG114 image at the
  beginning of chapter V; it is not an unmodified publisher edition.
- The Alice cover and saved note are original Ambra material (MIT).
- *Synthetic narration narrated* is the original Ambra
  [Media Overlay fixture](../../apps/e2e/scripts/generate-media-overlay-fixtures.mjs)
  (MIT), with generated audio rather than a person's recording.

The Gutenberg sources declare **Public domain in the USA**, not worldwide.
Its [permissions policy](https://www.gutenberg.org/policy/permission.html#quotes-and-extracts-from-project-gutenberg-items)
permits quotations and extracts, including commercial use; its
[trademark rules](https://www.gutenberg.org/policy/license.html#using-the-project-gutenberg-trademark)
still apply. Source credits do not imply endorsement. The incorporated text
and illustration are not relicensed as MIT. Source notices remain intact in
the local demonstration EPUB; no full third-party book is distributed with
the guide or extension.

Retain these credits when reusing the images. See the
[full classic-source attributions](../../store-assets/ATTRIBUTIONS.md) and
[pinned preparation sources](../../store-assets/classic-sources.json).

## Reproduce and validate

Use [capture-user-guide.mjs](../../scripts/capture-user-guide.mjs) with an
already-built, isolated production candidate and the existing classic fixture
preparation. Do not build over a live extension directory or use a real browser
profile. After arranging a browser slot:

```sh
AMBRA_DOCS_ALLOW_BROWSER=1 \
AMBRA_DOCS_EXTENSION_PATH=/absolute/path/to/isolated-candidate \
AMBRA_DOCS_SOURCE_SHA=FULL_RUNTIME_SOURCE_COMMIT \
AMBRA_DOCS_BOOKS_PATH=/absolute/path/to/prepared-classics \
AMBRA_DOCS_WORKSPACE=/absolute/path/to/session/files \
node scripts/capture-user-guide.mjs

node --test scripts/user-guide.test.mjs
```

The prepared-classics directory must contain `books.json` and its matching
Alice EPUB from `store-assets/scripts/prepare-assets.py --classics`. The
capture reuses that tool's checksum and content credits.
`AMBRA_DOCS_PLAYWRIGHT_PACKAGE` can point to an existing e2e `package.json`
when dependencies are installed in another workspace; it is read-only.
For final packaged-runtime captures, also set `AMBRA_DOCS_ARCHIVE_PATH` to
the verified release ZIP: every candidate file is compared with the archive
before capture, and its SHA-256 is recorded. Without it, output is explicitly
labeled `premerge-preview`. Capture does not package, publish, or modify the
runtime.

[Back to the Ambra guide](README.md)
