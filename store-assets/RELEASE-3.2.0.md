# Ambra 3.2.0 manual release

The owner approved the post-3.1.0 manual book review and requested the two final
reader improvements, followed by a 3.2.0 candidate for one more sanity check.
Preparation does not upload, submit, publish, change Public visibility, or
replace the current test installation or the frozen 3.1.0 handoff.

## Update notes

```text
- Adds visible previous/next chapter actions at scroll boundaries, including vertical scrolling.
- Shows recovered Table of Contents notices once per unchanged EPUB, with persistent navigation warnings and source links in EPUB Inspector.
- Adds advanced Inspector actions to reader notices and errors.
- Improves packaged HTML-base/SVG resources, imported annotation recovery and reading-position restoration.
- Improves narration timing, authored playback order, contextual navigation and book-local skipping controls.
- Tracks reading positions and restores passages in native vertical-writing Scroll mode.
```

This release includes post-3.1.0 resources/annotations/CFI/narration improvements
in #395-#410, the bounded native vertical-scroll implementation in #412, and
the final scroll-boundary/recovery-notice improvements in #417 and #418.
#411, #413 and #414 reconcile explicit EPUB support limitations; issue closure
is not complete EPUB support or a new criterion verdict.

The owner already checked the eleven numbered manual books. Final sanity
should focus on book 05's next/previous chapter actions and book 11's recovery
notice, advanced Inspector link and retained Warnings tab after reopening.
Also check ordinary page turns and saved position after resize/reopen.

Reflowable vertical pagination remains unsupported: use Scroll mode for vertical
content. Native CJK glyph metrics depend on authored fonts and browser/platform
fallback. Unique publication origins and complete scripted-primary fallback/
degradation remain implementation gaps; publisher scripting stays disabled.
Native JPEG XL requires browser decoder support. The internal plan and legacy
inventory retain further bounded/unsupported subsets and unassessed coverage.

Permissions, Public distribution and listing screenshots are unchanged.
Published conformance results and the website assessment remain frozen. This
release's regression/manual checks do not establish new official passes,
complete required coverage, or a new EPUB Reading System conformance score.
Do not deploy a conformance update with this release.

## Validate the final package

Root package, extension package and source manifest must agree on `3.2.0`.
Internal unpublished engine/shell/test versions remain independent.
Require successful protected PR checks and normal head-pinned merge, then
successful validation of the exact merged-main package.

Use the `beta-release-<merged SHA>` artifact from the accepted merged-main CI
run, not a PR merge-ref archive. Independently verify `release.json`,
`SHA256SUMS`, CRC, archive paths and production bundle:

```sh
cd /path/to/downloaded/artifact
shasum -a 256 -c SHA256SUMS
unzip -tq ambra-3.2.0.zip
```

Require the actual merged commit, `version: "3.2.0"`, `dirty: false`,
`publication: "PUBLIC"` and matching independently computed archive SHA-256.
Verify unchanged permissions, expected entry points and license notices, and
absence of development-server code, source maps and local/debug features.
Run native chapter actions, notice/reopen/Inspector and reading regressions
against the exact extracted archive before handoff.

For an independent local package, use a clean isolated checkout, never the live
extension output:

```sh
git status --porcelain
git rev-parse HEAD
node --test .github/scripts/release.test.mjs
VITE_AMBRA_LOCAL_FEATURES=0 node .github/scripts/package-extension.mjs
```

Prepare a separate Downloads handoff with the ZIP, exact unpacked extension,
receipt/checksums, update notes and actual acceptance evidence. Preserve the
3.1.0 ZIP and all earlier handoffs. Do not substitute a newer local build after
the owner validates the handed-off bytes.

## Owner-only submission

1. Sanity-check the exact unpacked 3.2.0 candidate and confirm the current Public
   item's dashboard version/review state allows a new submission.
2. Upload only the verified `ambra-3.2.0.zip` to item
   `mcjkkebkhifgkkbahlcapjlnaihocogj`. Keep current visibility, permissions
   disclosures, listing settings and screenshots.
3. Use the update notes above and submit manually.
4. Record the actual outcome separately. Preparation and a passing sanity check
   do not establish submission, approval or publication.
