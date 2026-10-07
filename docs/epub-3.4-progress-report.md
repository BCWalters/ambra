# Ambra EPUB 3.4 progress and conformance report

**Status: full required inventory and 64-method reassessment completed on merged main.**
No store release has been created. The release-completeness gate remains red:
native JPEG XL fails and 75 required criteria remain unassessed.

## Executive summary

The roadmap has delivered merged improvements in roll layout, packaged CSS and
fonts, primary reading order, metadata, rendition properties, ZIP64/OCF, and
consumer-aware resource fallbacks. The resource milestone
[#356](https://github.com/BCWalters/ambra/pull/356) is now merged after its entire
applicable protected suite passed.

[#357](https://github.com/BCWalters/ambra/pull/357) merged navigation recovery,
Accessibility 1.2 publisher claims, asserted CFI recovery/ranges, SVG-root
resource policy and the hosted official reassessment profile. All applicable
protected gates passed. Early runs caught CFI grammar/emulator ownership, a stale
navigation stub and an incorrect network-attempt counter; each was repaired
without weakening native evidence.

The latest expanded profile passes **63/64 (98.44%)**, with one failure and
**no automated execution blockers**. All 139 required identifiers, representing
140 original publications, now have explicit inventory entries and assessment
procedures. Required verdict coverage is **64/139 (46.04%)**; the other 75 are
pending manual review or further automation, not passed, waived or all inherently
manual. The original 21 results remain unchanged at 20/21. The three measured
standalone-SVG failures are repaired and now pass; direct JPEG XL remains the
historical failure.

The comparable historical official profile improved from **6/11 (54.55%) to
10/11 (90.91%)**, a gain of **36.36 percentage points**. Four embedded-font
criteria improved; none of the eleven regressed. This is not 90.91% of the whole
specification. At that milestone 194 of the pinned inventory's 205 identifiers
remained unassessed. The historical 21-method run reduced that number to 184;
the initial 60-method run reduced it to 145; the current 64-method run reduces
it to 141.

## Latest merged-main assessment: 2026-10-07

[#371](https://github.com/BCWalters/ambra/pull/371) repaired native standalone
SVG body/head assumptions, root anchors and pagination geometry. Its unchanged
head passed the full protected CI rerun before merge. Merged-main
[run 37665451465](https://github.com/BCWalters/ambra/actions/runs/37665451465)
then measured **59 pass, one fail, zero execution blockers** across the same
60 criteria. Independent comparison with the historical 56/60 worksheet found
exactly three changed verdicts: `cnt-svg-support`, `cnt-svg-css` and
`pkg-spine-order-svg`, all fail to pass.

[#375](https://github.com/BCWalters/ambra/pull/375) added four original-publication
image methods. Fresh merged-main
[run 37666174481](https://github.com/BCWalters/ambra/actions/runs/37666174481)
measured **63 pass, one fail, zero execution blockers** across all 64 methods.
The only changes from the preceding 60-method worksheet are four `not-run` to
`pass` verdicts: `ocf-url_link-relative`, `ocf-url_link-path-absolute`,
`ocf-url_link-leaking-relative` and `pub-foreign_image`. All preceding assessed
verdicts are unchanged.

The four methods independently resolve original XHTML/OPF image targets and
manifest fallbacks, then require exact original asset hashes, native decode,
positive dimensions and paired content-frame/shell hit tests. Import alone is
not a pass. The PSD-to-PNG case measures a non-spine manifest fallback, not
native PSD support.

| Field | Latest verified assessment |
| --- | --- |
| Main source commit | `46d28870b19bc96136cdc22aaf376cdb97f32b3f` |
| Archive | `ambra-2.2.0.zip`; clean production checkout |
| Archive SHA-256 | `7d226c5d8b3cc1c1f86490b01a6c3ab596a5139ad87de3750e5716b0eb1da7c4` |
| Suite revision | `54092b4233253e9aac80e93ec4782b380b4b3403` |
| Browser | Chromium `Chrome/153.0.8010.12` |
| OS | Linux `6.17.0-1022-azure` |
| Assessment timestamp | `2026-10-07T18:24:33.130Z` |
| Hosted run | `37666174481`; complete job 3m18s |
| Required verdict coverage | 64/139 (46.04%); 75 pending |
| Overall identifier verdict coverage | 64/205 (31.22%); 141 pending |
| Score among assessed required criteria | 63/64 (98.44%); native JPEG XL fails |
| Manual assessment evidence added by this run | None |
| Complete conformance claim | No |

The archive SHA-256 was independently recomputed. All 64 unique native records
were checked against the same package, run URL, browser and OS, and their
worksheet verdicts. Collection and artifact upload succeeded. The red workflow
conclusion correctly retains the JPEG XL failure and incomplete required
coverage; it is not an execution blocker or a full-conformance claim.

### Current results across every required category

| Category | Required | Pass | Fail | Pending |
| --- | --- | --- | --- | --- |
| Content Documents | 11 | 10 | 0 | 1 |
| Fixed Layout | 4 | 0 | 0 | 4 |
| Pre-paginated Layout | 21 | 0 | 0 | 21 |
| Roll Layout | 4 | 2 | 0 | 2 |
| Media Overlays | 16 | 0 | 0 | 16 |
| Navigation Documents | 7 | 7 | 0 | 0 |
| Open Container Format | 14 | 11 | 0 | 3 |
| Package Documents | 15 | 11 | 0 | 4 |
| Internationalization | 13 | 9 | 0 | 4 |
| Structural Semantics | 1 | 0 | 0 | 1 |
| Core Media Types | 10 | 9 | 1 | 0 |
| Publication Resources | 7 | 0 | 0 | 7 |
| Manifest Fallbacks | 5 | 4 | 0 | 1 |
| Scripting | 11 | 0 | 0 | 11 |
| **Total** | **139** | **63** | **1** | **75** |

[#367](https://github.com/BCWalters/ambra/issues/367) is closed on the measured
SVG fixes. Continuous centered SVG scroll presentation remains the separate
[#373](https://github.com/BCWalters/ambra/issues/373) follow-up; passing SVG
rendering criteria does not claim that UX has been implemented.

Local exploratory runs are retained separately. The four new image methods
passed locally before merge. A full macOS local run recorded 58 passes,
four failures and two blockers: JPEG XL and three stalled native audio clocks
failed, while the raw upstream compression/segmentation archives lacked the
required deliberately invalid properties. These results were not waived or
promoted. The fresh Linux run generated and inspected the correct fixtures and
passed those five criteria. Neither native PCM evidence nor a playback clock
is a physical-speaker listening claim.

The [manual validation plan](epub-3.4-manual-validation.md) prioritizes original
layout and listening checks, with explicit environment and evidence requirements.
Manual campaigns on a different OS/browser remain separate from this hosted
campaign because the current worksheet has one global environment.

## Historical initial 60-method assessment: 2026-10-07

[Run 37641226454](https://github.com/BCWalters/ambra/actions/runs/37641226454)
executed all 60 registered methods against the exact archived production package
on merged main. The native stage took 1m28s; the complete job took 2m33s, excluding
queue time. Collection, full inventory linking and artifact upload succeeded.
Its red conclusion is expected because four criteria fail and coverage remains
incomplete. This is not an assertion that all 139 assessments have been executed.

| Measure                                                 | Historical 21-method run | Initial expanded run |
| ------------------------------------------------------- | ------------------------ | -------------------- |
| Required passes / failures                              | 20 / 1                   | 56 / 4               |
| Automated execution blockers                            | 0                        | 0                    |
| Score among assessed required criteria                  | 95.24% (20/21)           | 93.33% (56/60)       |
| Required verdict coverage                               | 21/139 (15.11%)          | 60/139 (43.17%)      |
| Required criteria unassessed                            | 118                      | 79                   |
| Required identifiers / original publications catalogued | —                        | 139 / 140            |
| Overall identifier verdict coverage                     | 21/205 (10.24%)          | 60/205 (29.27%)      |
| All identifiers unassessed                              | 184                      | 145                  |
| Complete conformance claim                              | No                       | No                   |

**The changed percentage is not a rendering regression comparison.** The original
21 have identical statuses, independently compared with run 37623541718. Of the
39 newly measured criteria, 36 pass and three expose a previously unmeasured
standalone-SVG opening failure. No product rendering change was made to raise
these scores.

### Results across every required category

| Category              | Required | Pass   | Fail  | Pending |
| --------------------- | -------- | ------ | ----- | ------- |
| Content Documents     | 11       | 8      | 2     | 1       |
| Fixed Layout          | 4        | 0      | 0     | 4       |
| Pre-paginated Layout  | 21       | 0      | 0     | 21      |
| Roll Layout           | 4        | 2      | 0     | 2       |
| Media Overlays        | 16       | 0      | 0     | 16      |
| Navigation Documents  | 7        | 7      | 0     | 0       |
| Open Container Format | 14       | 8      | 0     | 6       |
| Package Documents     | 15       | 10     | 1     | 4       |
| Internationalization  | 13       | 9      | 0     | 4       |
| Structural Semantics  | 1        | 0      | 0     | 1       |
| Core Media Types      | 10       | 9      | 1     | 0       |
| Publication Resources | 7        | 0      | 0     | 7       |
| Manifest Fallbacks    | 5        | 3      | 0     | 2       |
| Scripting             | 11       | 0      | 0     | 11      |
| **Total**             | **139**  | **56** | **4** | **79**  |

The package-bound kit includes the per-identifier `required-plan.json` and
`required-procedures.md`, including original directory names, normative
references, authored expected outcomes, applicability subjects and limitations.
`pkg-unique-id` has two originals, explaining the 139/140 difference. No
recommended, optional or deprecated criterion has been promoted to an assessed
result by this expansion.

Pending work includes reusable layout/spread/viewport methods, resource and
origin behavior, identity/bookmark/link checks, structural semantics and
overlay/scripting applicability. Some checks need visual, listening or
assistive-technology evidence; others can be automated. Conditional requirements
must be reviewed individually. `lay-pp-layout-duplication` explicitly targets
EPUBCheck, so validator evidence is required rather than a reader-runtime pass.

### Measured failures and policies

| Criterion             | Actual evidence                                                                                                        | Follow-up                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `cnt-svg-support`     | Original imports; reader surfaces `Cannot read properties of null (reading 'style')` before the expected frame appears | [#367](https://github.com/BCWalters/ambra/issues/367)                               |
| `cnt-svg-css`         | Same surfaced opening error on the original standalone SVG/CSS fixture                                                 | [#367](https://github.com/BCWalters/ambra/issues/367)                               |
| `pkg-spine-order-svg` | Same surfaced opening error before SVG/XHTML order can be traversed                                                    | [#367](https://github.com/BCWalters/ambra/issues/367)                               |
| `pub-cmt-jxl`         | Unchanged native image decode/paint failure                                                                            | [#328](https://github.com/BCWalters/ambra/issues/328); await browser-native support |

MP3, MP4 audio and Opus all pass: each original resource hash matches, the
unmuted native player advances through its approximately 1.32-second clip, and
Chromium's offline decoder yields nonzero PCM from those exact bytes. This is
software decode/playback evidence, not a physical-speaker listening claim.
Real BZIP2 and segmented ZIP rejection also pass with inspected archive fields
and corresponding surfaced errors. The tests do not merely repackage invalid
archives into conforming ones.

Publication scripting remains intentionally disabled. Remote fonts/video still
need the separate consent/privacy/offline design in
[#336](https://github.com/BCWalters/ambra/issues/336). JPEG XL is not given a
bundled decoder. Legacy omissions remain explicit; none of these policies
silently turn unassessed requirements into passes.

### Exact expanded-run provenance

| Field                          | Historical initial expanded assessment                                     |
| ------------------------------ | -------------------------------------------------------------------------- |
| Run                            | [37641226454](https://github.com/BCWalters/ambra/actions/runs/37641226454) |
| Merged commit                  | `a087a86f79656e8255bc03bcb22cf8c872ff6883`                                 |
| Archive / version              | `ambra-2.2.0.zip` / 2.2.0; unreleased candidate                            |
| Independently verified SHA-256 | `59bfa8c8bc1129f6ceb0913cd426f7bf705c4b8a4bc95175eec1a39bdef7e4d6`         |
| Browser                        | Chromium `Chrome/153.0.8010.12`                                            |
| OS                             | Linux `6.17.0-1022-azure`                                                  |
| Last native record             | 2026-10-07T15:01:28.492Z                                                   |
| Pinned suite                   | `54092b4233253e9aac80e93ec4782b380b4b3403`                                 |

All 60 records share the exact package, suite/run evidence and browser/OS
identity. The downloaded ZIP fingerprint was independently recomputed. The kit
retains raw observations, generated reports, full procedures and the exact ZIP.
The root worktree and live extension were not replaced by these assessment runs.

### Retained exploratory outcomes and measurement repairs

- [#364](https://github.com/BCWalters/ambra/pull/364) merged the complete
  inventory, 140-publication generator and 60 methods after protected hosted CI.
- [Run 37636626527](https://github.com/BCWalters/ambra/actions/runs/37636626527)
  recorded 52 pass, two fail and six not-run. BZIP2 was correctly rejected, but
  the measurement incorrectly required the error to contain "compression";
  Ambra surfaced its actual unsupported extraction version 46 instead. Three
  audio probes timed out in a live AudioContext method; three standalone SVG
  openings lost the surfaced error during ordinary iframe setup.
- [#365](https://github.com/BCWalters/ambra/pull/365) added extraction-version
  inspection, original-byte offline PCM decoding plus actual unmuted player
  state, and a native import/open error observer. Its hosted regression checks
  passed. [Run 37639852558](https://github.com/BCWalters/ambra/actions/runs/37639852558)
  recorded 56 pass, the unchanged JPEG XL failure and three SVG not-run outcomes.
  The observer looked for the book-card "Open" label inside import status, whose
  actual completion control is "Read now".
- [#366](https://github.com/BCWalters/ambra/pull/366) corrected that selector
  after protected CI passed. The final run captured the actual reader alerts and
  produced all 60 verdicts. No product-rendering change, native publisher-script
  execution or threshold relaxation was used to conceal those SVG failures.
- The exploratory kits remain retained with their original identities and
  outcomes; they are not overwritten or relabelled as the final run.

## Historical broader measured assessment: 2026-10-07

[Run 37623541718](https://github.com/BCWalters/ambra/actions/runs/37623541718)
measured all 21 criteria against the exact archived production package. The
native runner passed 20 cases in 32.1 seconds; the whole opt-in workflow took
1m21s. Collection and scorecard generation completed. Its red conclusion is
intentional: direct JPEG XL fails and required coverage is incomplete.

| Measure | Previous clean eleven-criterion worksheet | Expanded main assessment |
| --- | --- | --- |
| Required passes / failures | 10 / 1 | 20 / 1 |
| Score among assessed required criteria | 90.91% (10/11) | 95.24% (20/21) |
| Required criterion coverage | 11/139 (7.91%) | 21/139 (15.11%) |
| Required criteria unassessed | 128 | 118 |
| Overall identifier coverage | 11/205 (5.37%) | 21/205 (10.24%) |
| All identifiers unassessed | 194 | 184 |
| Recommended / optional / deprecated criteria assessed | 0 / 0 / 0 | 0 / 0 / 0 |
| Complete conformance claim | No | No |

**This is expanded measurement, not ten fail-to-pass improvements.** The same
eleven media criteria have identical results in both worksheets: ten passes and
the native JPEG XL failure. All ten additions were previously not run. Changing
the denominator means the headline percentages are not a controlled
before/after rendering improvement.

| Newly assessed required criterion | Result |
| --- | --- |
| `pkg-title-order` | Pass |
| `pkg-creator-order` | Pass |
| `pkg-meta-whitespace` | Pass |
| `pkg-dir_creator-rtl` | Pass |
| `pkg-dir_but_not_content` | Pass |
| `pkg-lang_but_not_content` | Pass |
| `nav-access` | Pass |
| `nav-activation` | Pass |
| `lay-roll-embedded-images` | Pass |
| `lay-roll-embedded-images-svg` | Pass |

Expectations come from independently parsed raw pinned sources. Native
measurements cover painted Library metadata, original content identity and
direction/language annotations, actual TOC control activation, and all nine
frames in each authored roll publication. Roll checks retain viewport-width
fit, intrinsic aspect, aligned x, adjacent gaps <=1 CSS px, native image decode,
original asset SHA-256 and corresponding hit-testing in both native documents.
This is not a live assistive-technology or speech-language assessment.

### Broader-run provenance

| Field | Previous clean worksheet | Expanded main assessment |
| --- | --- | --- |
| Run | [37536783463](https://github.com/BCWalters/ambra/actions/runs/37536783463) | [37623541718](https://github.com/BCWalters/ambra/actions/runs/37623541718) |
| Commit | `2700f468e227faf9382bbce4126611f7358b69f9` | `726b624fe0d386445ce647357276d022983e176a` |
| Archive / version | `ambra-2.2.0.zip` / 2.2.0 | Same name/version; unreleased candidate, different fingerprint |
| SHA-256 | `7de400b94a6986671bd5a6fd62b755873f70463d3af3b35604784c335464df9f` | `ea47476e5625c28041f6f89990be59304b5f7af92f85ebe79f4239bab267ed50` |
| Browser | Chromium `Chrome/153.0.8010.12` | Same |
| OS | Linux `6.17.0-1022-azure` | Same |
| Assessed at | 2026-10-06T21:52:41.305Z | 2026-10-07T12:48:40.268Z |
| Pinned suite | `54092b4233253e9aac80e93ec4782b380b4b3403` | Same |

The downloaded production ZIP's SHA-256 was independently checked, along with
all 21 records' release identity, exact run evidence and consistent browser/OS.
Both roll records contain nine painted frames, decoded original assets and
archived raw geometry/paired hit points. The workflow report has no `--previous`
input, so its "new failure"/baseline wording is not a comparison claim; the
same-eleven comparison above confirms JPEG XL is unchanged.

The historical six-to-ten comparison below retains its original provenance.
The clean worksheet in this section is a separate later eleven-criterion run,
not a replacement identity for that historical report.

### Measurement preparation and CI efficiency

- #360 broadened the opt-in profile after protected tooling-only validation
  passed in 2m32s, with no extension build or unrelated runtime browser suite.
- The retained exploratory run 37621179852 recorded 19 passes, the JPEG XL
  failure and an honest SVG-roll not-run: its raw-source TOC parser assumed an
  XHTML body. #361 added strict namespaced SVG-root source handling.
- Run 37622210921 recorded 18 passes and three failures. Both roll failures
  affected only the final paint sample; all asset/decode/layout facts passed.
  #362 corrected intrinsic-to-scaled iframe coordinate mapping and clipping,
  requiring the same visible point in both native documents. Raw geometry and
  paired points are now archived, and hosted scalar tests cover mapping,
  clipping and invalid input. No verdict threshold or product rendering
  changed. The final run supersedes those provisional measurement outcomes;
  they remain retained and are not rewritten as passes.
- Compact Library #359 merged after a fully green protected head. Library
  checks now started at 2m50s instead of 32m42s and completed with localization
  by 6m48s. That workflow-change validation still took 36m30s. Future
  Library-only changes select Library plus explicitly wired reader integration;
  shared harness/runtime, workflow and unknown changes still require full
  coverage. No end-to-end timing is claimed for the future focused profile.

At this historical milestone, the next step was broader CSS/text/SVG measurement rather than treating
these new passes as new rendering fixes. Remote fonts and inline video still
need the separate permission/privacy/offline policy design in #336. Publication
scripting remains intentionally disabled; native JPEG XL waits for browser
support. Those policies do not relabel unmeasured optional/deprecated criteria.

## Historical before/after eleven-criterion assessment

| Measure | Original 2.2.0 baseline | After |
| --- | --- | --- |
| Assessed required criteria | 11 of 139 | 11 of 139 |
| Required passes / failures | 6 / 5 | 10 / 1 |
| Score among assessed required criteria | 54.55% | 90.91% |
| Total assessed identifiers | 11 of 205 | 11 of 205 |
| Recommended criteria | 0 of 38 assessed | Not covered by the eleven-criterion profile |
| Optional criteria | 0 of 1 assessed | Not covered by the eleven-criterion profile |
| Deprecated criteria | 0 of 27 assessed | Not covered by the eleven-criterion profile |
| Complete conformance claim | No | No; partial coverage cannot qualify |

The historical 192/205 import/open sweep is not a criterion score.
No synthetic regression automatically promotes an official result.

### Same eleven-criterion comparison

| Official criterion | Baseline | After |
| --- | --- | --- |
| `cnt-css-fonts_ot` | Fail | Pass |
| `cnt-css-fonts_tt` | Fail | Pass |
| `cnt-css-fonts_woff` | Fail | Pass |
| `cnt-css-fonts_woff2` | Fail | Pass |
| `pub-cmt-avif` | Pass | Pass |
| `pub-cmt-gif` | Pass | Pass |
| `pub-cmt-jpeg` | Pass | Pass |
| `pub-cmt-jxl` | Fail | Fail |
| `pub-cmt-png` | Pass | Pass |
| `pub-cmt-svg` | Pass | Pass |
| `pub-cmt-webp` | Pass | Pass |

The new font measurements are stronger: the expected native face must load,
be used by painted authored content, and render original probe glyphs differently
from generic serif. Images must decode from packaged blobs and pass hit-testing
in both the content frame and reader shell. Browser/OS differences must also
be disclosed; a score change is not an environment-controlled experiment.
The browser version is identical; the baseline used macOS and the new run used
Linux. Font families were Franky Toys, Lobster, Pacifico and Macondo.

### Exact provenance

| Field | Baseline | After |
| --- | --- | --- |
| Commit | `ec69453307e2dd2ffdf22aac37ca7429a9ef5aee` | `3c01b244a126f5fba2df725d488c3b2e0f920ce7` |
| Version | 2.2.0 | Unreleased candidate; version alone is not its identity |
| Archive | `ambra-2.2.0.zip` | `ambra-2.2.0.zip`; different fingerprint, not a new store release |
| SHA-256 | `b1734e13a46a631574c04b879f636ca17a4d8b37c7ede4462f4f157e5547fe56` | `12e9cbab65af0f754eb713841e6d93d5a63092fbe0a2ecfefa8b10ab47711ad2` |
| Browser | Chromium `Chrome/153.0.8010.12` | Chromium `Chrome/153.0.8010.12` |
| OS | Darwin 25.6.0 | Linux 6.17.0-1022-azure |
| Assessed at | 2026-10-06T13:36:56.589Z | 2026-10-06T21:27:30.929Z |
| Pinned suite | `54092b4233253e9aac80e93ec4782b380b4b3403` | Same pinned revision |

The applicable specifications are the July 21, 2026 Candidate Recommendation
snapshots of EPUB 3.4, EPUB Reading Systems 3.4 and EPUB Accessibility 1.2.

[Official run 37533910200](https://github.com/BCWalters/ambra/actions/runs/37533910200)
measured all eleven criteria and archived the worksheet, native observations,
scorecard and exact production package. The downloaded archive's SHA-256 was
independently checked. The workflow is intentionally red for the JPEG XL failure
and incomplete required coverage; collection/report generation completed.

The first artifact also included Playwright's automatically generated failure
context beneath the observation directory. The tooling follow-up moves browser
failure output to ignored `test-results/epub-conformance`, outside the archived
factual observations. It does not alter the eleven measurements or their score.

The workflow's initial report did not receive the historical local baseline,
so it labels itself a baseline. A separate comparison report was generated from
the existing archived observations using the runner's `--previous` option:
four improvements, zero regressions, no added/removed identifiers. This report
does not rerun tests. Its expected exit 2 preserves the incomplete-release gate.

## Implementations and validation

| Milestone | Status / scope |
| --- | --- |
| Roll layout, including fractional-boundary fragments | Merged in #350/#352; publication-wide gapless continuous layout with restoration/resize coverage |
| Packaged CSS graph and embedded fonts | Merged in #353; nested imports, relative resources and de-obfuscated fonts |
| Primary reading order | Merged in #353; supplemental content excluded from sequential order/progress but retained for explicit access |
| Metadata language/direction/ASCII whitespace, ordered rendition properties, ZIP64/OCF | Merged in #355; native 65,536-entry archive fixture and explicit limits |
| Consumer-aware subresource fallbacks/offline policy | Merged in #356 as `48398d82a88292c52e1c053804cdd19f3fdad208`; native capability selection and accessible exhausted-chain diagnostics |
| Legacy navigation and publisher accessibility claims | Merged/protected-CI validated in #357 |
| Asserted CFI recovery and direct ranges | Merged/protected-CI validated in #357; not complete CFI support |
| Universal SVG-root required CSP | Merged in #357; actual Chromium enforcement and pre-dispatch blocking proved |
| Hosted eleven-criterion official reassessment | Merged in #357 and executed; separate opt-in workflow, not ordinary browser discovery |

### Exact green resource milestone

Protected head `36f840edf80ff0b0a36769a7324654f7642b851d` passed
[run 37521264102](https://github.com/BCWalters/ambra/actions/runs/37521264102)
before #356 merged.

| Hosted gate | Result |
| --- | --- |
| Engine units | 941 passed |
| Extension units | 1,843 passed |
| Early native audio preflight/runtime failures | 2 passed |
| Early resource/reader regressions | 44 passed |
| Main packaged extension | 355 passed, 13 skipped |
| Contention-sensitive flows | 21 passed, 1 skipped |
| Recorded narration | 13 passed |
| Image viewer | 2 passed |
| Encoded fragments | 6 passed |
| Table viewer | 9 passed |
| Inspector | 1 focused + 28 broad passed, 1 skipped |
| Library | 82 passed, 1 skipped |
| Localization | 4 passed |
| Review controls | 9 passed |
| Packaging and every applicable protected gate | Passed |

Skips are not passes. These are regression evidence, not official criterion
scores. The stale invalid-audio fixture was corrected to recognize capability
preflight rejection before playback-source assignment, and a separate genuine
native runtime decoder failure was added. No synthetic MediaError was used.

### Follow-up validation

Initial #357 head `1d75e109be649c718704ac910f0d5998bbb3251d` failed
[run 37525991246](https://github.com/BCWalters/ambra/actions/runs/37525991246)
on two engine units, with 970 passing:

- adjacent CFI assertion blocks were incorrectly accepted;
- happy-dom binds Range objects to its window document, so the new isolated
  document fixture collapsed unexpectedly.

`146f3c5` fixes the single-assertion grammar for both steps and offsets, and
uses the emulator's window document for the unit fixture. The independent
document native Chromium range proof is retained. `a156908` also hardens
the collector against empty, malformed, wrong-kind or contradictory native
measurement verdicts.

Replacement head `a15690841bc8227b9ce25deecf8a245833464457` passed all 974
engine units and 1,853 extension units in
[run 37526820234](https://github.com/BCWalters/ambra/actions/runs/37526820234).
One older TOC unit used a partial reflective navigation stub without the new
mandatory auxiliary-list field. `9f39ff9` replaces those stubs with real typed
navigation models, rather than adding a silent production default.
[Run 37527660773](https://github.com/BCWalters/ambra/actions/runs/37527660773)
then passed all 974 engine units, all 1,854 extension units, both native audio
checks, and 50 early native cases, including actual navigation/accessibility and
CFI paint/ranges. Two new CSP probes observed enforcing native violations but
incorrectly equated Playwright logical request-attempt events with network
dispatch. `3e2a01e` now requires the expected original policy, a CDP failure
explicitly blocked by CSP, no safety-net route dispatch, and no response.
Final exact head `3e2a01e795cb5bedd783f49044ed7324c2b764d7` passed
[run 37529036440](https://github.com/BCWalters/ambra/actions/runs/37529036440)
before #357 merged as `3c01b244a126f5fba2df725d488c3b2e0f920ce7`.
All 974 engine units, all 1,854 extension units and 52 early native cases passed.
The main packaged suite again passed 355 cases with 13 skips, and all applicable
later gates passed with the same counts as the resource-milestone table above.
The two root-policy probes proved the expected original policy, actual CDP
`csp` blocking, zero safety-net route dispatch and zero responses.

Local verification was limited to type-checks, lint, JavaScript/YAML syntax,
patch hygiene and development builds. No local unit/browser tests or browsers
were run during these milestones.

## Genuine remaining gaps

| Issue | Missing or incomplete behavior |
| --- | --- |
| #328 | Direct native JPEG XL; nested XHTML/SVG content-document object handling. A fallback image does not establish direct JPEG XL support. |
| #333 | Physical vertical-axis pagination, paint, keyboard/page directions, scrolling, progress, resize and restoration for vertical CJK modes. Native CSS passthrough alone is not enough. |
| #336 | HTML `<base href>` processing and external SVG presentation/reference graphs; remote/data loading remains an explicit offline-policy exclusion. |
| #338 | Required unique publication origins: extension-created same-origin blobs are not one distinct origin per publication. This needs a bridge/layout architecture change. Scripting remains intentionally disabled and is recommended, not mandatory; degraded behavior/fallbacks still need explicit coverage. |
| #337 | Text-only TTS and embedded-media overlay segments, skippability/escapability, timing clamps and complete navigation/pagebreak synchronization. Recorded narration remains supported. |
| #340 | Nested CFI indirections, temporal/spatial/combined offsets, image-alt addressing, package-tree recovery and complete page-break side affinity. The prepared assertion/range milestone does not close these. |
| #341 | Shared CSS/TextPosition/refinement/ordered-selector resolution and lossless richer annotation interoperability. Preserving CFI assertion data during re-anchoring is only one bounded improvement. |
| #343/#344 | Modern recovery, NCX auxiliary lists, guide landmarks and the maintained compatibility inventory are merged and validated. Real-corpus prioritization and full legacy assessment remain separate; tours have not been claimed as assessed against a lawful real corpus. |

Legacy `xml:base` is a separate compatibility omission: EPUB 3.4 discourages
it because HTML/SVG are removing support. It must not be confused with the valid
HTML `<base href>` gap or invented as another required modern criterion failure.

The maintained legacy inventory also records collections, outdated rendition
hints, prefixed CSS, bindings, `epub:switch`/`epub:trigger`, tours, DTBook/OEB/HTML
syntax, proprietary page maps, metadata vocabulary/role interpretation,
obfuscation and DRM/signatures. Supported subsets, partial support and intentional
non-support are distinct; deprecated failures remain visible even when they are
not modern required failures.

## Release process and recommendation

1. Merge only exact fully green protected heads.
2. Run the main-only **Assess EPUB 3.4 release candidate** workflow with the
   pinned suite and the exact archived production package.
3. Preserve worksheet, factual native observations, report, package fingerprint
   and browser/OS provenance. Do not archive third-party books/fonts or private
   browser profiles.
4. Keep required, recommended, optional and deprecated coverage separate.
   All unassessed criteria remain explicit; partial coverage keeps the
   release-completeness gate red.
5. Compare the same criteria with the previous release and disclose changed
   methodology/environment. Link known failures to open issues.
6. Keep this longer assessment opt-in for release candidates, not ordinary CI.

There is no complete EPUB 3.4 conformance claim and no store release from this
work. The owner requested a release hold. The separate
[compact-library alternatives](design-prototype/compact-library-explore.html)
for #351 retain four standalone options. The owner selected **D: Just keep
reading** for the popup and embedded reader library, without Continue Reading
in the embedded panel. This UX work does not change the EPUB assessment above.
