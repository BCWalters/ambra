# Ambra 1.1.1 manual patch release

This release targets the existing Public Chrome Web Store item,
`mcjkkebkhifgkkbahlcapjlnaihocogj`. The owner requested a distinct **1.1.1**
release after the UX follow-up PR passes. Do not patch, relabel, or reuse the
finished 1.1.0 package, even for the live unpacked build.

Preparation does not upload, submit, publish, cancel a review, change
distribution, or dispatch the historical Unlisted workflow. Design-system
implementation and other open issues are deferred until the owner authorizes
work toward 1.2 after this store submission.

## What's changed since 1.1.0

Copy-ready update notes:

```text
- Clarified the library action: Open library in new tab, in all nine interface languages.
- Made reflowable page-turn targets wider in unoccupied space near the outside page edges.
- Extended those targets through the full reading-pane height, including above and below the text.
- Preserved text selection, links, images, controls, and the first-tap behavior for dismissing visible reader controls.
```

The eligible reflowable band is 20% of each physical outer pane, with a 64px
minimum and 160px maximum, never beyond half a pane. Wider existing margins
remain usable. Actual text, interactive content, images, inner edges, and
gutters retain their existing ownership. Fixed-layout edge thresholds and
scrolling behavior are unchanged. No publication CSS, pagination/CFI logic,
permissions, host access, storage schema, or data migrations change.

The release also updates the browser-test harness stub for the scoped
book-button lookup. This is a test-fixture correction, not a reader-runtime
failure or an assertion relaxation.

## Preserve the completed 1.1.0 handoff

Before packaging, copy the entire finished
`dist/beta-release/artifacts/` directory to
`dist/release-history/1.1.0/`, including its ZIP, checksum, metadata, handoff,
and reviewed store assets. Verify every copied file. The 1.1.0 ZIP must retain
SHA-256:

```text
33b0b00deeb569c64942a02ccf0633f670ce4ab877cebfdf5576064d0ab3921e
```

Keep earlier release history, live-build backups, the separate development
loader, and user profiles/libraries intact. The packager clears only its
current artifact output; never run it before preserving the previous handoff.

## Validate and package clean merged source

Root package, extension package, and source manifest must all be **1.1.1**.
Validate the source through required CI and protected merge, then package from
clean current `main`:

```sh
git branch --show-current
git status --porcelain
git rev-parse HEAD
node --test .github/scripts/release.test.mjs
node .github/scripts/package-extension.mjs
(cd dist/beta-release/artifacts && shasum -a 256 -c SHA256SUMS)
unzip -tq dist/beta-release/artifacts/ambra-1.1.1.zip
```

Verify `release.json`: version `1.1.1`, the merged source SHA, `dirty: false`,
and `publication: "PUBLIC"`. Check production entry points, permissions, and
required license/notices, with no dev-server code, profiles, private books,
source maps, or secrets in the archive.

Test the exact packaged directory via
`AMBRA_E2E_EXTENSION_PATH="$PWD/dist/beta-release/extension"` in isolated
profiles. Include full-height/wider-edge LTR/RTL single/spread interactions,
text selection and control ownership, first-tap dismissal, animations and
gutters, fixed layout, library search/discovery and all-locale compact/native
popup sizing, import/storage/resume, annotations, and Save as. A successful
source build is not a substitute for testing the final package.

Record actual test counts, skips, clean source SHA, checksum, and any remaining
limitations in the artifact handoff. Do not claim new VoiceOver/NVDA acceptance
from automated tests.

Back up the live build before refreshing it as 1.1.1. Verify its files against
the final ZIP after packaging, without touching the separate development
loader or user data.

## Listing materials and boundaries

This patch does not require a new marketing description or screenshot set.
Keep the existing approved name, summary, description, icon, promo tile,
category, regions, privacy disclosures, and Public visibility.

The reviewed 1.1.0 screenshots remain representative and are preserved with
their original provenance. If they have not yet been uploaded, the owner can
use that reviewed set from release history. Do not relabel those images as a
new exact-1.1.1 capture. Any newly requested capture must instead follow
[ASSETS.md](ASSETS.md) against the final 1.1.1 ZIP.

The 1.1.0 content-handling limits and open follow-ups remain as documented in
[its checklist](RELEASE-1.1.0.md). Design-system work, the reader-side library,
theme-accent changes, and other open issues are not included in this patch.
The website's immutable documentation pin is a separate deployment decision.

## Owner-only submission

1. Confirm 1.1.1 exceeds every uploaded version in the existing item's
   dashboard. If not, stop and approve a newer source version; do not patch an
   archive or cancel an existing review automatically.
2. Upload only the verified `ambra-1.1.1.zip`. Keep Public distribution and
   the existing listing configuration.
3. Review and submit manually when ready.
4. Record the actual dashboard outcome separately. A package and handoff do
   not establish upload, submission, approval, or publication.

Once a ZIP has been finalized and handed off, do not overwrite it with
different contents under the same version. Further release changes require a
new version following the [release-version policy](../CONTRIBUTING.md).
