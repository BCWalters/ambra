# Ambra: initial EPUB conformance report

Published report date: **2026-10-08**. Product milestone: **3.0.0**.

Ambra 3.0.0 marks the official start of our EPUB conformance improvement
effort. It does **not** claim complete EPUB 3.4 support, independent
certification, or that all known failures have been repaired. Product version
numbers describe Ambra's milestones, not a certified EPUB specification level.
The intention is to get progressively better through the 3.x series.

The owner has approved releasing this initial milestone without completing
the entire conformance backlog. Known failures and unresolved requirements
are published rather than hidden or converted into passes. Ordinary protected
release validation remains required; the strict full-conformance assessment
continues to report incomplete coverage honestly.

## Scope and assessment identity

This report combines documentation of **two separate campaigns**, not their
scores or environments. Both evaluated the same original production 2.2.0
package. They are historical baseline evidence for the 3.0.0 effort, **not a
new package-bound 3.0.0 conformance run**.

| Field | Assessed baseline |
| --- | --- |
| Product version / archive | 2.2.0 / `ambra-2.2.0.zip` |
| Source commit | `46d28870b19bc96136cdc22aaf376cdb97f32b3f` |
| Archive SHA-256 | `7d226c5d8b3cc1c1f86490b01a6c3ab596a5139ad87de3750e5716b0eb1da7c4` |
| W3C test-suite revision | `54092b4233253e9aac80e93ec4782b380b4b3403` |
| Complete pinned inventory | 205 identifiers / 206 publications |
| Canonical required inventory | 139 identifiers / 140 publications |

Applicable specifications are the July 21, 2026 Candidate Recommendation
snapshots of [EPUB 3.4](https://www.w3.org/TR/2026/CR-epub-34-20260721/),
[EPUB Reading Systems 3.4](https://www.w3.org/TR/2026/CR-epub-rs-34-20260721/)
and [EPUB Accessibility 1.2](https://www.w3.org/TR/2026/CR-epub-a11y-12-20260721/).
The [original suite](https://github.com/w3c/epub-tests/tree/54092b4233253e9aac80e93ec4782b380b4b3403)
provides each publication's instructions and normative references.

One canonical inventory entry, `lay-pp-layout-duplication`, tests EPUBCheck
rather than reading-system behavior. It is **out of scope for Ambra**. We do
not need to run EPUBCheck to finish this reader assessment or prepare the
milestone release, and no validator pass is claimed.

## Campaign A: hosted native-browser automation

The hosted [assessment run 37666174481](https://github.com/BCWalters/ambra/actions/runs/37666174481)
measured **63 passes / 1 failure across 64 required criteria**, with no
automated execution blockers. Its environment was Chromium
`Chrome/153.0.8010.12` on Linux `6.17.0-1022-azure`.

The 98.44% pass rate applies **only to those 64 assessed criteria**, not the
whole specification. That run covered 64 of the canonical 139 required
identifiers (46.04%); 75 were still pending in that campaign. Later manual
observations do not rewrite this hosted worksheet or its environment.

The failure is `pub-cmt-jxl`: native JPEG XL support is unavailable in the
assessed browser. See the [historical measured report](epub-3.4-progress-report.md)
for exact methods, comparisons and archived package/observation provenance.
Import success and synthetic regression tests are not official criterion
passes.

## Campaign B: original-publication manual self-assessment

The owner reviewed the original books in an isolated Chrome profile on macOS
and reported results during the campaign completed on 2026-10-08.
This is **Ambra self-assessment, not independent certification**.
Screenshots and recordings were optional and were not collected.
Full Chrome/macOS versions, viewport/mode details and actual execution
timestamps were not supplied. Report dates are not substituted for execution
times, and missing metadata is not invented.

The kit contained 82 original publications representing 81 identifiers.
`pkg-unique-id` uses two books but one criterion. After excluding the
EPUBCheck-only entry, the reader campaign covers **80 identifiers**:

| Manual reader result | Count |
| --- | ---: |
| Pass | 58 |
| Fail | 9 |
| Specifically not applicable | 2 |
| Blocked or unresolved | 11 |
| Total reader identifiers in the kit | 80 |

The [machine-readable worksheet](../conformance/epub-3.4/manual-self-assessment-2026-10-08.json)
retains the full 205-row inventory: 58 pass, 9 fail, 3 not-applicable and
135 not-run. The third exclusion is the validator-only test, not a reader
feature result. The not-run rows include the 11 unresolved kit cases and
124 identifiers outside this manual kit. They are not 135 newly observed
failures.

The three starter SVG and three packaged-audio passes corroborate already
hosted-assessed identifiers; they must not be counted twice. There is no
blended automated/manual percentage.

### Reported manual failures

| Criterion | Observation / expected behavior | Tracking |
| --- | --- | --- |
| `mol-navigation` | TOC navigation during playback does not automatically move narration to the destination; the explicit reposition button is needed. | [#337](https://github.com/BCWalters/ambra/issues/337) |
| `lay-viewport-meta-prop` | No effective page zoom was found; Command-plus increased toolbar size without visibly magnifying the fixed-layout page. Alternative gestures were not verified. | [#380](https://github.com/BCWalters/ambra/issues/380) |
| `lay-page-layout-both-spread` | Extra blank pages were reported in the mixed-layout sequence. Exact blank positions remain to be reproduced. | [#381](https://github.com/BCWalters/ambra/issues/381) |
| `pkg-spine-progression-default` | Authored default RTL progression test failed. The precise wrong progression was not described. | [#382](https://github.com/BCWalters/ambra/issues/382) |
| `pub-data-urls_browsing-context` | Required embedded JPEG data image did not load; an error popup appeared. | [#336](https://github.com/BCWalters/ambra/issues/336) |
| `pub-data-urls_top-level-content` | Required embedded SVG data image did not load; an error popup appeared. This tests an image inside the page, not a data-URL spine document. | [#336](https://github.com/BCWalters/ambra/issues/336) |
| `scr-not-support_ccscript-modify-host` | Required packaged iframe content did not appear; the original host explicitly makes this a failure. No forbidden script modification was demonstrated. | [#384](https://github.com/BCWalters/ambra/issues/384) |
| `scr-not-support_ccscript-modify-size` | Required packaged iframe content did not appear; the original host explicitly makes this a failure. No forbidden dimension change was demonstrated. | [#384](https://github.com/BCWalters/ambra/issues/384) |
| `scr-support-fallback` | Recorded from the folder-level report of failure/ignored content without scripting. This test expects the non-scripted fallback to display; exact displayed wording still needs targeted confirmation. | [#338](https://github.com/BCWalters/ambra/issues/338) |

These are self-reported observations interpreted against the originals, not
newly automated reproductions or confirmed internal root causes.

### Exclusions and unresolved cases

- `lay-reflow-align-x-center`: not applicable under its explicit authored
  exclusion and Ambra's documented unsupported legacy-hint policy. See
  [legacy compatibility](epub-legacy-compatibility.md).
- `scr-support_scrolled-doc`: its original instructions explicitly permit an
  excluded/null result when scripting is unsupported. This does not waive
  other scrolling requirements.
- `pub-file-urls`: unresolved. Empty local-file iframes are expected; failure
  of the surrounding chapter would be a different problem. The report did
  not establish which occurred. Do not enable local-file access.
- `ocf-url_origin`, `ocf-url_parse-leaking-relative` and
  `ocf-url_parse-path-absolute`: results cannot be observed through the
  originals with publication scripting disabled.
- `scr-support_origin` and `scr-support_origin_unique`: scripted origin
  output/comparison is unavailable. Disabled scripting proves neither origin
  isolation nor an isolation failure.
- `scr-readingsystem-features`, `scr-readingsystem-support`,
  `scr-readingsystem-support_iframe`,
  `scr-readingsystem-support_iframe_svg` and
  `scr-readingsystem-support_svg`: JavaScript API probes cannot execute.
  Static default failure text is not an executed API result. Static iframe
  visibility was not separately reported for these two embedded API cases.

Blocked probes remain not-run pending trusted technical observations or
per-requirement applicability review. Publication scripting remains disabled;
there is no blanket scripting-based conformance waiver.

### Expected errors and separate UX findings

All five XML/unsupported-fallback criteria in manual folder 13 pass:
`pub-foreign_bad-fallback`, `pub-xml-names`,
`pub-xml-non-validating_unclosed`, `pub-xml-external-id` and
`pub-xml-non-validating_comment`. The first three intentionally allow or
require an error; rejection is not automatically a failed test.

The following usability findings do not change the authored pass verdicts:

- Narration continues across a page boundary without revealing the passage:
  [#377](https://github.com/BCWalters/ambra/issues/377).
- SVG narration lacks visible text highlighting:
  [#378](https://github.com/BCWalters/ambra/issues/378).
- Standalone SVG needs better fit within the page/spread slot:
  [#379](https://github.com/BCWalters/ambra/issues/379).
- Full-page errors need an Open library recovery action:
  [#383](https://github.com/BCWalters/ambra/issues/383).
- Continuous centered SVG stacking in scrolling mode remains
  [#373](https://github.com/BCWalters/ambra/issues/373).

## Release boundaries and continuing work

3.0.0 includes the already merged reader/conformance improvements and compact
Library, plus clearer narration-position captions: Restart page audio and
Jump to selection. Changing these captions does not fix narration navigation.

Known failures, native JPEG XL limitations and unresolved origin/script
requirements are accepted limitations of this initial milestone, not hidden
release prerequisites that must all be fixed before shipping. Remote fonts
and video still need a separate privacy/consent decision; scripts stay disabled.

Next assessments should use exact new package fingerprints, preserve these
historical campaigns, retest affected original books after fixes, and report
regressions and unknowns explicitly. A 3.0.0 package validation or successful
protected CI run must not relabel the 2.2.0 baseline as a new conformance run.

See the [implementation plan](epub-3.4-conformance-plan.md),
[assessment runner](epub-3.4-conformance-runner.md) and
[3.0.0 release checklist](../store-assets/RELEASE-3.0.0.md).
