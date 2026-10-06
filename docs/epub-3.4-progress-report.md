# Ambra EPUB 3.4 progress and conformance report

**Status: protected implementation merged; package-bound reassessment completed.**
No store release has been created. The release-completeness gate remains red:
direct JPEG XL fails and 128 required criteria remain unassessed.

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

The comparable official profile improved from **6/11 (54.55%) to
10/11 (90.91%)**, a gain of **36.36 percentage points**. Four embedded-font
criteria improved; none of the eleven regressed. This is not 90.91% of the whole
specification. The pinned inventory contains 205 identifiers, and **194 remain
unassessed**. Required coverage is still 11/139 (7.91%); overall identifier
coverage is 11/205 (5.37%).

## Before/after official assessment

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
for #351 compare a resume-first layout, a list-first layout and a cover shelf.
They are standalone samples only; production implementation awaits the owner's
choice.
