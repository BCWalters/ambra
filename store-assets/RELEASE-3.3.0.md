# Ambra 3.3.0 manual release

The owner approved the animation and gesture improvements in the live development
extension, including fixed-layout single/two-page spreads, clicks/flicks, curled
strip coverage, and the opening title spread in *Reflections on the Revolution in
France*. The owner selected 3.3.0 for this feature release.

Preparation does not upload, submit, publish, change Public visibility, or replace
earlier release handoffs. The final production package still requires owner sanity
checking and dashboard review before manual store submission.

## Update notes

```text
- Adds smooth, two-sided curled Page flip animations in single-page and spread views.
- Adds direct click-and-drag control for Page flip, Slide and Film strip.
- Makes mouse flicks more forgiving after holding, wandering or a small release twitch.
- Improves single-page Page flip completion, with a 25% slow-drag threshold.
- Keeps book/chapter titles and page numbers stable while pages turn.
- Preserves sharp page text through fractional-width layout and animation handoffs.
- Improves document-boundary turns, short title pages and book-edge navigation.
- Prepares adjacent pages during idle time for quicker Slide, Film strip and fixed-layout turns.
- Adds local mouse-gesture diagnostics to help troubleshoot missed page turns.
```

Spread Page flip, Slide and Film strip retain the 40% slow-drag threshold. Mouse
flicks require 5% forward travel within 400ms, with a 250ms release allowance and
8px backward-jitter tolerance. Touch retains its 250ms window, 100ms release
allowance and strict reversal handling. Diagnostics remain bounded, in-memory
and local, without publication text or automatic uploads.

## Validation and limits

Require root package, extension package and source manifest versions to agree on
`3.3.0`. Internal unpublished workspace versions remain independent.

Run lint, typecheck, all unit/tooling tests and the protected browser groups.
The dedicated page-turn rendering, input and prefetch groups run without retries
and use one worker for timing-sensitive regressions. Validate the exact production
package, not the development bundle accepted during iteration.

Check curled front/back geometry, furniture ink/folios, visible strip coverage,
single/spread thresholds, recent flicks and button-cleared releases, chapter
boundaries, interruption recovery, prefetch disposal and fixed-layout navigation.
The mixed-document book-start previous margin must create no leaf or position
change. The title spread must retain its canonical publication pixels throughout
preparation, without incoming text leaking through the stationary blank area.

Physical touchscreen input, real OS app switching, complex EPUB paint fidelity
and live assistive-technology behavior remain broader manual-validation limits.
This release does not claim a new official EPUB conformance score or complete
EPUB support. Published conformance results remain frozen; record package-bound
release assessment evidence separately without deploying a new assessment.

Permissions, Public distribution, existing store item and listing screenshots
remain unchanged. Do not use the historical UNLISTED uploader for the Public item.

## Exact merged-main package

Require passing protected PR checks, a normal head-pinned merge and successful
validation of the actual merged commit. Use its `beta-release-<merged SHA>` CI
artifact, not a PR merge-ref package or a different local rebuild.

Verify `release.json`, `SHA256SUMS`, archive CRC/paths, production entry points,
license notices, unchanged permissions and absence of development-server code,
source maps and local/debug feature bundles:

```sh
cd /path/to/downloaded/artifact
shasum -a 256 -c SHA256SUMS
unzip -tq ambra-3.3.0.zip
```

Require the actual merged commit, `version: "3.3.0"`, `dirty: false`,
`publication: "PUBLIC"` and an independently matching archive SHA-256.
Run native release smoke checks against the exact extracted archive.

Dispatch **Assess EPUB 3.4 release candidate** on this merged `main` commit with
`release_run_id` set to the accepted CI run and both automated profiles enabled.
Preserve its package-bound worksheet, observations and scored reports with the
handoff. Verify its archive digest matches the selected store ZIP. Record native
failures and unassessed/manual criteria separately; the known incomplete-release
gate is not ordinary CI success or a full-conformance claim. Do not deploy these
results to the frozen published assessment.

Prepare a separate handoff with the ZIP, exact unpacked extension, receipt,
checksums, update notes and actual acceptance evidence. Preserve all older
handoffs. Do not substitute a different build after owner acceptance.

## Owner-only submission

1. Sanity-check the exact unpacked 3.3.0 candidate and verify the Public item's
   dashboard version/review state allows a new submission.
2. Upload only the verified `ambra-3.3.0.zip` to item
   `mcjkkebkhifgkkbahlcapjlnaihocogj`.
3. Keep current visibility, permissions disclosures, listing settings and
   screenshots. Use the update notes above and submit manually.
4. Record the actual outcome separately; preparation and passing checks do not
   establish submission, approval or publication.
