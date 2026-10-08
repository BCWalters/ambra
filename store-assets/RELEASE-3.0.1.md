# Ambra 3.0.1 manual release

Reader polish approved by the owner after live Dev review. The owner reported
3.0.0 complete and chose to ship this patch before starting 3.1 work.
Preparation does not upload, submit, publish, alter Public visibility, cancel
another review, or replace the owner's unpacked extension.

## Update notes

```text
- Improves recovery from unreadable books and chapters with persistent friendly errors, usable Contents navigation, a return to the previous page, and an Open library action.
- Softens the two-page reading gutter without changing page layout.
- Uses the publication language when page progression is unspecified, keeping right-to-left pages, page numbers, navigation and the progress bar consistent.
```

Fixes #383, #368 and #382. Explicit LTR/RTL settings, authored text direction
and spine order remain unchanged. Publication scripting remains disabled.
Permissions, Public distribution and listing screenshots are unchanged.

The [initial conformance report](../docs/epub-conformance.md) and website's
3.0.0 assessment remain frozen. The default-RTL and malformed-XML original-book
checks are regression evidence, not a new formal conformance campaign or a
claim of complete EPUB 3.4 support. Browser locale direction data is used;
older runtimes without that capability log a warning and retain the LTR
fallback.

## Validate the final package

The root package, extension package and source manifest must agree on
`3.0.1`. Internal unpublished engine/shell/test versions remain independent.
Require protected PR validation and merge, then passing validation of the
exact merged main package. New recovery, default-progression and existing RTL
browser regressions are included in the protected reader-core-1 group.

Prefer the exact `beta-release-<merged SHA>` artifact from the successful
merged-main CI run. Verify its `release.json`, `SHA256SUMS` and archive:

```sh
cd /path/to/downloaded/artifact
shasum -a 256 -c SHA256SUMS
unzip -tq ambra-3.0.1.zip
```

For an independent local build, use a clean isolated checkout of the same
merged source, never the live Dev output:

```sh
git status --porcelain
git rev-parse HEAD
node --test .github/scripts/release.test.mjs
VITE_AMBRA_LOCAL_FEATURES=0 node .github/scripts/package-extension.mjs
(cd dist/beta-release/artifacts && shasum -a 256 -c SHA256SUMS)
unzip -tq dist/beta-release/artifacts/ambra-3.0.1.zip
```

Require version `3.0.1`, the actual merged commit, `dirty: false`,
`publication: PUBLIC`, and the matching ZIP checksum in `release.json`.
The packaged manifest must use production branding, unchanged permissions
and the expected entry points. Required license notices must be present.
The packager rejects development-server code, source maps and unexpected files.

Preserve the 3.0.0 release handoff, historical assessment evidence and live Dev
bundle. Use a separate 3.0.1 handoff directory. Record final package identity
and completed validation in the handoff; never substitute a PR merge-ref ZIP
for the merged-main release.

## Owner-only submission

1. Check the existing Public item's dashboard version and review state.
   Confirm 3.0.1 exceeds every uploaded version.
2. Upload only the verified `ambra-3.0.1.zip` to item
   `mcjkkebkhifgkkbahlcapjlnaihocogj`. Retain existing visibility, permissions
   disclosures, listing settings and screenshot set.
3. Use the update notes above, review the dashboard and submit manually.
4. Record the actual submission outcome separately. Preparing the ZIP does not
   establish submission, approval or publication.

The owner will authorize the overnight 3.1 batch after 3.0.1 is submitted.
