# Ambra 2.1.0 manual release

Prepare a new package for the existing Public Chrome Web Store item,
`mcjkkebkhifgkkbahlcapjlnaihocogj`. The owner confirms 2.0.0 is live and
approved 2.1.0 for the Inspector feature and Library progress fix.

Preparation does not upload, submit, publish, cancel a review, change
distribution, or dispatch the historical Unlisted workflow. The owner
performs store submission.

## What's changed since 2.0.0

Copy-ready update notes:

```text
- See where the currently visible pages begin and end in EPUB Inspector, with automatic markers matching the reader's page numbers.
- Inspector now reveals the current page's start when opened.
- Fixed saved Library reading progress after using the reading-position slider, including two-page spreads.
```

The markers are always on for paginated reflowable books, including
cross-chapter spreads. They do not appear in scrolling or fixed-layout views.
While book-wide page numbers are being calculated, labels show start/end
without a number. Generated labels do not alter copied EPUB source.
See the [Inspector guide](../docs/user-guide/epub-inspector.md) for the
DOM-boundary limitations; this is not an editing or conformance tool.

The Library fix calculates progress from the exact saved reading position,
rather than discarding a valid percentage after seeking to the second page
of a spread. Unknown progress while pagination is unavailable remains
legitimate. See the [Library guide](../docs/user-guide/ambra-library.md).

No permissions, host access, storage schema, or data migrations change.
The standalone content-explorer prototype is not part of this release.
`VITE_AMBRA_LOCAL_FEATURES=1` remains for developer review simulation only
and must not be enabled for the store package.

## Preserve the previous handoff

Before packaging, preserve the entire existing
`dist/beta-release/artifacts/` directory under
`dist/release-history/2.0.0/`. Verify every copied file and do not overwrite
an existing history directory unless its contents are proven identical.
The local 2.0.0 ZIP being preserved has SHA-256:

```text
efba5c23146cf2433d5bdd41a5c2ee43d343475bcb02e9b19cd18df88c993fc0
```

Its original metadata reports `dirty: true`; preserve that record unchanged.
It is not evidence of a clean-source release, nor does it independently
establish which ZIP the owner submitted. The new 2.1.0 handoff must instead
record clean merged source.

Keep earlier release history, live-preview backups, the separate development
loader and user libraries intact. The packager clears its current artifact
output; never run it before preserving the previous handoff.

## Validate and package clean merged source

The root package, extension package and source manifest must all be `2.1.0`.
Require protected PR validation and merge, then package from clean current
`main`:

```sh
git branch --show-current
git status --porcelain
git rev-parse HEAD
node --test .github/scripts/release.test.mjs
VITE_AMBRA_LOCAL_FEATURES=0 node .github/scripts/package-extension.mjs
(cd dist/beta-release/artifacts && shasum -a 256 -c SHA256SUMS)
unzip -tq dist/beta-release/artifacts/ambra-2.1.0.zip
```

Verify `release.json`: version `2.1.0`, the merged source SHA, `dirty: false`
and `publication: "PUBLIC"`. Verify the archive's manifest version,
unchanged permissions, production entry points and required license/notices.
Reject development-server code, profiles, private books, source maps and
secrets.

Test the exact packaged directory in isolated profiles:

```sh
AMBRA_E2E_EXTENSION_PATH="$PWD/dist/beta-release/extension" \
AMBRA_E2E_HEADLESS=1 pnpm --filter @ambra/e2e exec playwright test \
  tests/inspector-page-boundaries.spec.ts \
  tests/library-scrubber-progress.spec.ts \
  --workers=1
```

Required PR CI also covers broader reader, pagination, Inspector, Library,
import, annotation and recorded-narration behavior against a production
package. Record actual validation counts/skips, source SHA, ZIP checksum and
remaining limitations in the ignored artifact handoff. Automated checks do
not establish a new VoiceOver/NVDA pass or accessibility certification.

Do not rebuild or relabel a finished handoff under the same version after
giving it to the owner; further release changes require a new approved
version under the [release-version policy](../CONTRIBUTING.md).

## Listing materials and boundaries

Keep the existing approved name, descriptions, icon, promo tile, category,
regions, privacy disclosures, Public visibility and current 2.0.0 screenshots.
No new screenshot set is required for this focused release. Retained images
keep their original provenance; they are not exact-2.1.0 captures.
Any separately requested new capture must follow [ASSETS.md](ASSETS.md)
against the final 2.1.0 ZIP.

The website's immutable documentation source pin is a separate deployment
decision; this release preparation does not change it. Do not overwrite the
live unpacked build or touch user data just to prepare the store ZIP.

## Owner-only submission

1. Confirm 2.1.0 exceeds every uploaded version in the existing dashboard.
   If not, stop and approve a newer source version; do not patch the ZIP or
   cancel an existing review automatically.
2. Upload only the verified `ambra-2.1.0.zip`. Keep Public distribution and
   the existing item and approved listing configuration.
3. Review the update notes and submit manually when ready.
4. Record the actual dashboard outcome separately. Package preparation does
   not establish upload, submission, approval or publication.
