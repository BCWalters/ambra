# Ambra 3.1.0 manual release

The owner completed the combined manual review and authorized preparation of
3.1.0. Preparation does not upload, submit, publish, change Public visibility,
cancel another review, or replace the owner's unpacked Dev extension.

## Update notes

```text
- Improves packaged static frames and embedded images while keeping publisher scripting disabled.
- Adds visible SVG narration highlighting and improves standalone SVG fitting and continuous scrolling.
- Adds fixed-layout zoom with Zoom in, Zoom out and Fit to window, keyboard shortcuts, trackpad pinch and panning.
- Repairs clipped content and blank reading stops in mixed-layout books, honoring eligible fixed-page left/right placement.
- Keeps fixed-page turn hints usable when artwork reaches the viewport edge and hides them while zoomed.
```

Includes the merged resources/narration/SVG work in #387, #388, #389, #390
and #391, fixed-layout zoom in #392, and mixed-layout repairs in #393.
The generated 3.1.2 narration review book now uses minimum paragraph heights,
avoiding authored text overlap without changing the reader. Native checks
cover the final text line and following-passage exclusion at three widths.

Zoom is 1-8 times automatic fit and is retained through navigation and resize
within an open book; reopening starts fitted. Touchscreen-specific pinch is
not added. SVG-only books support continuous scrolling; mixed SVG/XHTML
scrolling remains chapter-at-a-time. External SVG resource graphs, HTML base,
legacy xml:base compatibility and controlled HTTPS policy remain separately
scoped under #336. Publisher scripting remains intentionally unsupported.
Permissions, Public distribution and listing screenshots are unchanged.

The [initial conformance report](../docs/epub-conformance.md), its measured
results and the website's 3.0.0 assessment remain frozen. The owner deferred
all further conformance publication until the remaining EPUB issues are
closed. This release's regressions and manual UX review are not a new formal
assessment, a new score or a claim of complete EPUB 3.4 support. Do not deploy
a conformance update with this release.

## Validate the final package

The root package, extension package and source manifest must agree on
`3.1.0`. Internal unpublished engine/shell/test versions remain independent.
Require protected PR validation and merge, then passing validation of the
exact merged-main package. Retain the existing protected browser groups,
including the strengthened narration fixture regressions.

Prefer the exact `beta-release-<merged SHA>` artifact from the successful
merged-main CI run. Verify its `release.json`, `SHA256SUMS` and archive:

```sh
cd /path/to/downloaded/artifact
shasum -a 256 -c SHA256SUMS
unzip -tq ambra-3.1.0.zip
```

For an independent local build, use a clean isolated checkout of the same
merged source, never the live Dev output:

```sh
git status --porcelain
git rev-parse HEAD
node --test .github/scripts/release.test.mjs
VITE_AMBRA_LOCAL_FEATURES=0 node .github/scripts/package-extension.mjs
(cd dist/beta-release/artifacts && shasum -a 256 -c SHA256SUMS)
unzip -tq dist/beta-release/artifacts/ambra-3.1.0.zip
```

Require version `3.1.0`, the actual merged commit, `dirty: false`,
`publication: PUBLIC`, and the matching ZIP checksum in `release.json`.
Verify production branding, unchanged permissions and expected entry points,
required license notices, no development-server code or source maps, and no
local-feature/debug bundle. Smoke-test the exact archive's extracted extension
in a separate profile, including the combined resource/SVG/zoom/mixed-layout
regressions and narration, import, persistence and reading controls.

Preserve the previous release handoffs, combined review books, historical
assessment evidence and live Dev bundle. Use a separate 3.1.0 handoff directory
and record package identity and actual completed validation. Never substitute
a PR merge-ref ZIP for the merged-main release.

## Owner-only submission

1. Check the existing Public item's dashboard version and review state.
   Confirm 3.1.0 exceeds every uploaded version and resolve any pending review
   in the dashboard before another submission.
2. Upload only the verified `ambra-3.1.0.zip` to item
   `mcjkkebkhifgkkbahlcapjlnaihocogj`. Retain existing visibility, permissions
   disclosures, listing settings and screenshot set.
3. Use the update notes above, review the dashboard and submit manually.
4. Record the actual submission outcome separately. Preparing the ZIP does not
   establish submission, approval or publication.
