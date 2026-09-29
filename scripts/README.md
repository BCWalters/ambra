# Local EPUB discovery tools

Use these tools to answer questions like **"Which of my EPUBs contains a note,
table, MathML expression, or a particular CSS declaration?"** They run locally,
do not upload anything, do not change your EPUBs, and never extract archive
members onto disk. They are developer tools, not part of the extension bundle.

## Find candidate books

From the repository root, using the normal Node/pnpm setup:

```sh
pnpm install --frozen-lockfile

# Default: page-break-inside: avoid, break-inside: avoid or avoid-page
pnpm scan:epubs ~/Downloads

# Other CSS features; repeat filters to find any of them
pnpm scan:epubs --css display=grid --css display=flex ~/Downloads
pnpm scan:epubs --css writing-mode ~/Downloads

# Actual markup rather than stylesheet declarations
pnpm scan:epubs --tag table --tag math ~/Downloads
pnpm scan:epubs --class note ~/Downloads

# Individual files, multiple folders, or paths containing spaces
pnpm scan:epubs --tag audio "/path/to/My books" /path/to/another.epub

# All matches as JSON; keep reports outside the public repository
pnpm --silent scan:epubs --json ~/Downloads > /tmp/epub-candidates.json

pnpm scan:epubs --help
pnpm test:tools
```

All filter types are **ORed**, not ANDed. `--css` accepts a property alone or
an exact property/value pair (case-insensitive, ignoring comments and outer
whitespace). `--class` matches an exact, case-sensitive class token, not a
substring. With any explicit filter, the default break-avoid search is replaced.

Directories are searched recursively, including uppercase `.EPUB` names.
Symbolic links are not followed and are reported as warnings. Identical archive
bytes are grouped by SHA-256, retaining every filename. Files that have the same
title but different bytes remain separate.

## What the output means

The human-readable report lists book titles, local paths, counts, and the first
five matches per book. JSON includes every match, warnings, errors, archive hashes,
and nonmatching books. `schemaVersion` identifies the report shape.

CSS matches include the archive member, line, selector, property, value,
`!important`, and enclosing at-rules such as `@media print`. Stylesheets, embedded
`<style>` blocks, and `style` attributes are covered. XHTML, legacy HTML, and SVG
documents are scanned; markup is parsed tolerantly without executing scripts or
loading any resources. Element matches identify tags/classes/IDs, not book prose.

**A CSS source match is a test candidate, not proof of active styling.** The tool
does not evaluate the cascade, stylesheet links/import graphs, selector matches,
media queries, visibility, or layout. It scans even unused archive members.
For example, a print-only rule may not apply in Ambra, and a shared stylesheet's
`.note` rule may have no matching elements. Follow up with `--class note` or
`--tag aside`, then inspect the book in Ambra. Already-atomic elements such as
figures and tables may not exercise a new block-pagination feature.

XML namespace prefixes other than the conventional `dc:title` may leave the
title unavailable (reported as a warning); filenames remain usable. The scanner
is not EPUBCheck or a complete XML/CSS conformance checker.

Exit codes:

- **0:** scan completed, including a legitimate zero-match result.
- **1:** at least one archive/member/path failed; results may be partial.
- **2:** invalid command-line arguments.

Errors go to stderr and are also included in JSON. Metadata warnings are visible
but do not by themselves fail the scan. ZIP members are read one at a time, so
large audio books do not need to fit in memory. Selected text members over
16 MiB are rejected explicitly to bound individual reads. Binary images/audio
are not decompressed; SVG is scanned as markup. Unsafe ZIP member paths are
rejected even though the tool never extracts files.

## Extending the tool

The implementation is [scan-epubs.mjs](scan-epubs.mjs), with original synthetic
archive tests in [scan-epubs.test.mjs](scan-epubs.test.mjs). Add reusable filters
there rather than creating one-off scripts tied to a contributor's home folder.
Keep findings structured in JSON and add synthetic tests for each new detector.
`pnpm test` includes these tests before the workspace's unit suites.

Reports contain private filenames, book titles, and authored CSS/identifiers.
Review and redact them before sharing. Do not commit real EPUBs or scan reports,
or post a contributor's library inventory to a public issue.
