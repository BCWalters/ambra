# EPUB 3.4 conformance plan

This document records Ambra's plan for supporting the EPUB 3.4 Candidate
Recommendation Snapshot dated July 21, 2026. It covers EPUB 3.4, EPUB Reading
Systems 3.4, and EPUB Accessibility 1.2.

The plan is based on an implementation audit completed on October 6, 2026.
EPUB 3.4 was still a Candidate Recommendation at that date, so the applicable
W3C snapshots and the official test-suite revision used for each assessment
must be recorded with the results.

Primary specifications:

- [EPUB 3.4](https://www.w3.org/TR/2026/CR-epub-34-20260721/)
- [EPUB Reading Systems 3.4](https://www.w3.org/TR/2026/CR-epub-rs-34-20260721/)
- [EPUB Accessibility 1.2](https://www.w3.org/TR/2026/CR-epub-a11y-12-20260721/)

## Current assessment

Ambra has strong practical EPUB 3 support, but it must not claim full EPUB
Reading System 3.4 conformance yet. Its strongest areas are XHTML and SVG
content, EPUB Navigation Documents, NCX fallback, reflowable and fixed-layout
presentation, RTL spreads, recorded-audio Media Overlays, EPUB CFI locators,
annotations, font de-obfuscation algorithms, and accessible reader controls.

The first two audited blockers, `rendition:layout=roll` and packaged CSS
resource graphs, are implemented and covered by original synthetic browser
fixtures. The remaining main conformance
blockers are:

1. sequential navigation that includes `linear="no"` spine items;
2. no foreign-resource fallback traversal;
3. a visible gutter between paired fixed-layout pages;
4. no ZIP64 v1 support;
5. incomplete URL-scheme handling and core-media capability detection;
6. incomplete package direction and ordered rendition-property processing.

Scripting and remote resources are product-policy decisions as well as
compatibility work. They are not prerequisites for a secure, useful reader,
but unsupported features and their fallback behavior must be handled
explicitly.

## Work plan

Each item has a stable audit ID so release reports can refer to it even if
GitHub issue numbers change.

### Phase 1: current conformance blockers

| ID     | Work item                                         | Acceptance summary                                                                                                                                            | Tracking                                              |
| ------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| C34-01 | Roll layout                                       | Recognize publication-level `roll`, render fixed-width spine items in one continuous vertical sequence, fit them to viewport width, and leave no visible gap. | [#330](https://github.com/BCWalters/ambra/issues/330) |
| C34-02 | CSS resource graph and embedded fonts             | Resolve nested `@import` and packaged `url(...)` references, including de-obfuscated fonts, images, SVG references, and fragments.                            | [#329](https://github.com/BCWalters/ambra/issues/329) |
| C34-03 | Primary reading order                             | Skip `linear="no"` items in next/previous navigation, boundaries, progress, and narration while retaining explicit-link access.                               | [#327](https://github.com/BCWalters/ambra/issues/327) |
| C34-04 | Foreign-resource fallbacks and media capabilities | Select the first supported manifest fallback for images, fonts, audio, video, objects, and new EPUB 3.4 core media types; report exhausted chains.            | [#328](https://github.com/BCWalters/ambra/issues/328) |
| C34-05 | Gapless fixed-layout spreads                      | Remove layout space between paired pages while allowing a non-layout binding overlay.                                                                         | [#331](https://github.com/BCWalters/ambra/issues/331) |
| C34-06 | ZIP64 and OCF processing                          | Support ZIP64 v1 and tighten required OCF/ZIP checks without regressing Store, Deflate, CRC, and multidisk rejection.                                         | [#335](https://github.com/BCWalters/ambra/issues/335) |
| C34-07 | Resource schemes and remote-resource policy       | Classify packaged, fragment, data, HTTPS, file, and unknown schemes before archive resolution; prevent one unsupported resource from aborting a chapter.      | [#336](https://github.com/BCWalters/ambra/issues/336) |
| C34-08 | Package direction and metadata language           | Preserve package- and element-level direction/language and render internationalized metadata correctly.                                                       | [#332](https://github.com/BCWalters/ambra/issues/332) |
| C34-09 | Ordered rendition-property resolution             | Preserve item property order and implement first-applicable-value behavior for conflicting layout, spread, and page-side values.                              | [#334](https://github.com/BCWalters/ambra/issues/334) |
| C34-10 | Vertical-writing pagination                       | Add vertical CJK fixtures and correct paginated `vertical-rl` and `vertical-lr` measurement/navigation.                                                       | [#333](https://github.com/BCWalters/ambra/issues/333) |

C34-01 is implemented. Ambra treats `roll` as a publication-wide layout,
ignores incompatible item-level layout, spread, flow, and orientation
overrides, and renders every spine document as a fixed-width canvas in one
gapless vertical scrollport. The synthetic browser fixture covers mixed
intrinsic heights, width fitting, scrollbar width, cross-spine fragments,
iframe wheel input, resize and position restoration, and RTL content.

C34-02 is implemented. Linked stylesheets, nested imports, inline style blocks,
and style attributes resolve packaged images, fonts and SVG fragments relative
to their own source document. CSS parsing preserves import conditions and
distinguishes resource URLs from strings/comments. Cycles and missing resources
are diagnosed without aborting the chapter; reader-session disposal revokes
root and dependent blob URLs. IDPF and Adobe font de-obfuscation use the existing
content-loader path. External and data references retain the existing CSP policy.
Missing CSS dependencies and declared stylesheets emit diagnostics without
aborting a chapter; missing markup resources retain their explicit load failures,
including responsive-image candidates, rather than silently dropping attributes.

The four official `cnt-css-fonts_ot`, `cnt-css-fonts_tt`, `cnt-css-fonts_woff`,
and `cnt-css-fonts_woff2` tests changed from observed font-loading failures on
the merged-main baseline to loaded faces with this implementation. These tests
are expected to pass future release assessments, but partial browser probes
do not imply a full 205-test conformance result. The Chromium baseline also
observed `pub-cmt-jxl` failing to decode, tracked by C34-04.

Conformance work additionally exposed roll fragment targeting at fractional
item boundaries, tracked in [#352](https://github.com/BCWalters/ambra/issues/352).

#### C34-03 implementation and assessment expectations

Primary-order traversal preserves original package spine indices and skips
`linear="no"` during chapter/page turns, content-boundary navigation, spread
pairing, continuous roll presentation, progress counting/seeking, and narration
progression. Initial reading starts at the first primary item. Explicit TOC,
link, history, and saved-CFI destinations retain supplemental access.

Next/previous from a supplement chooses the nearest primary item in that
direction. Supplements do not acquire a primary page number; coarse progress
stays at their insertion boundary. Roll opens a directly requested supplement
separately from the primary continuous canvas. All-non-linear publications have
no sequential order or seekable progress and report the missing primary order
on initial opening, rather than inventing one.

Official `pkg-spine-nonlinear-activation` and `pkg-spine-order` criteria should improve,
but synthetic regression coverage is not an official conformance score.
Release assessments must still verify their individual criteria.

CSS/primary-order and interacting shell, Inspector-docking, and narration
regressions run once, before the broader protected reader browser suite, so these
failures stop CI early without duplicating coverage or weakening the remaining
checks. Shell restoration checks explicitly reveal auto-hidden toolbar controls;
docking and post-reload playback checks wait for reader layout readiness.

### Phase 2: architecture and recommended reading-system behavior

| ID     | Work item                                         | Acceptance summary                                                                                                                                                             | Tracking                                              |
| ------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| C34-11 | Publication-origin isolation and scripting policy | Give each publication an isolated origin model and record whether scripting remains unsupported or is introduced under explicit capability and security boundaries.            | [#338](https://github.com/BCWalters/ambra/issues/338) |
| C34-12 | Complete Media Overlay behavior                   | Add text-only TTS and embedded-media handling, skippability, escapability, timing clamping, and pagebreak/navigation synchronization.                                          | [#337](https://github.com/BCWalters/ambra/issues/337) |
| C34-13 | Complete EPUB CFI processing                      | Add multiple indirections, temporal/spatial offsets, assertions, side bias, range resolution, and recovery behavior.                                                           | [#340](https://github.com/BCWalters/ambra/issues/340) |
| C34-14 | Complete EPUB Annotation selectors and bodies     | Resolve CSS and text-position selectors and support interoperable selector recovery and richer bodies.                                                                         | [#341](https://github.com/BCWalters/ambra/issues/341) |
| C34-15 | Accessibility 1.2 metadata                        | Model and present `accessModeSufficient`, conformance, certification, evaluation, report, credential, and `a11y:contactEmail` metadata.                                        | [#339](https://github.com/BCWalters/ambra/issues/339) |
| C34-16 | Navigation and legacy EPUB compatibility          | Add malformed-Nav fallback, NCX `navList`, OPF2 guide landmarks, and prioritized older-book compatibility backed by fixtures.                                                  | [#343](https://github.com/BCWalters/ambra/issues/343) |
| C34-17 | Outdated and deprecated vocabulary policy         | Document and test intentional support or non-support for outdated rendition properties, prefixed CSS, `epub:switch`, `epub:trigger`, bindings, tours, and superseded metadata. | [#344](https://github.com/BCWalters/ambra/issues/344) |

### Phase 3: measurable conformance process

Complete the existing-suite timing, redundancy, parallelism, and change-selection
audit in [#345](https://github.com/BCWalters/ambra/issues/345) before adding a
potentially long official conformance workload.

| ID     | Work item                                | Acceptance summary                                                                                                                                                                            | Tracking                                              |
| ------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| C34-18 | Release conformance runner and scorecard | Provide a pinned, repeatable official-test-suite runner and archive a scored report for every release candidate. It may remain opt-in and must not block ordinary CI if runtime is excessive. | [#342](https://github.com/BCWalters/ambra/issues/342) |

The implemented manual-first process, commands, pinned suite revision, report
schema, and release gate are documented in the
[EPUB 3.4 release conformance runner](epub-3.4-conformance-runner.md).

## Release conformance process

The conformance run is a release requirement, not necessarily a per-commit CI
requirement. It may run locally, through a manually dispatched GitHub Actions
workflow, or through another reproducible release job. The chosen mechanism
must provide one documented command or workflow action.

The implementation for C34-18 must:

1. pin the official W3C EPUB test suite to an immutable revision;
2. record the EPUB specification snapshot, suite revision, Ambra commit and
   version, Chrome/Chromium version, operating system, and runner configuration;
3. package or load the same production extension build used for the release
   candidate;
4. distinguish automated results from tests requiring manual inspection;
5. classify every applicable test as `pass`, `fail`, `not-run`, or
   `not-applicable`, with a reason for the latter two;
6. retain per-test evidence sufficient to reproduce failures without committing
   copyrighted publications, private profiles, or sensitive local paths;
7. emit machine-readable JSON and a human-readable Markdown summary;
8. compare the result with the previous released version and highlight
   regressions;
9. archive the report with the release checklist or release artifacts; and
10. fail the release assessment if an applicable required test regresses,
    even when the runner itself is not an ordinary branch-protection check.

### Score definition

The release report must publish separate scores so optional-feature coverage
cannot hide a required-test failure:

- **Required conformance score** =
  required tests passed / required tests run, expressed as a percentage.
- **Recommended behavior score** =
  recommended tests passed / recommended tests run, expressed as a percentage.
- **Optional feature coverage** =
  supported optional feature groups / assessed optional feature groups,
  accompanied by the supported and intentionally unsupported lists.
- **Manual completion** =
  manually assessed tests completed / manually applicable tests.

The headline release score is the **required conformance score**. A release can
claim EPUB Reading System 3.4 conformance only when this score is 100%, no
applicable required tests are `not-run`, and all remaining deviations have been
checked against the pinned specification snapshot. A numeric score is evidence,
not a conformance claim by itself.

`not-applicable` tests are excluded from score denominators but must remain
visible in the report. `not-run` tests are also excluded from the percentage,
but their count must be displayed next to the score so a partial run cannot
look complete. Expected failures remain failures; they may additionally link
to their tracking issue.

### Release gate

Before submitting each Chrome Web Store release:

1. run the release conformance assessment against the final production package;
2. review all failures and changes from the previous release;
3. link each accepted failure to an open issue and record the product decision;
4. place the score summary and full report location in that release's
   checklist; and
5. do not introduce a new failure in an applicable required test without an
   explicit owner decision recorded in the release checklist.

The first implementation may use a documented manual worksheet if the official
suite cannot yet be automated. The stable output schema and scoring rules should
remain the same so historical release results can be compared.

## Supported baseline to preserve

Conformance work must retain existing support for:

- OCF Store and Deflate entries with CRC checks;
- `container.xml`, OPF manifest/spine, and the first rootfile;
- XHTML and SVG spine documents;
- EPUB Navigation Documents, page lists, landmarks, and NCX fallback;
- reflowable, pre-paginated, mixed-layout, synthetic-spread, and RTL reading;
- recorded-audio Media Overlays;
- point CFI bookmarks and string-level range CFIs;
- the current EPUB Annotations subset;
- IDPF and Adobe font de-obfuscation;
- native MathML, SVG, responsive-image, audio, and video rendering where
  Chromium supports the selected resource;
- keyboard, focus, zoom, reduced-motion, forced-colors, and screen-reader
  behavior already covered by Ambra's tests.

## Legacy and deprecated inventory

These features are not all appropriate for modern EPUB 3.4 publications. They
remain in the plan so older-book behavior and intentional omissions are
visible.

Currently supported or partially supported:

- NCX `navMap` and `pageList`;
- content-document fallback chains;
- IDPF and Adobe font obfuscation;
- legacy cover metadata;
- legacy OPF2 metadata retained as generic values;
- outdated `rendition:spread`;
- deprecated `rendition:viewport` as a fixed-layout fallback;
- outdated `rendition:orientation`, parsed but not applied.

Not currently supported:

- OPF2 guide, tours, and NCX `navList`;
- package collections;
- bindings;
- `epub:switch` and `epub:trigger`;
- `rendition:flow` and `rendition:align-x-center`;
- behavioral support for old metadata-record link relations;
- superseded `opf:role`;
- translation of legacy `-epub-*` CSS properties;
- DTBook, OEB1/HTML spine content, Adobe page-map, and DRM systems.

HTML-syntax content documents are not a gap: EPUB 3.4 requires XML/XHTML
content. Digital-signature validation, RDFa/Microdata/ITS processing, form
submission, general TTS, and DRM are optional or outside Ambra's intended core.

## Definition of done for an implementation issue

Each issue should:

1. cite the applicable W3C requirement or explicitly identify an optional or
   backward-compatibility goal;
2. include an original synthetic EPUB fixture or a lawful public test case;
3. add focused unit and browser coverage where the behavior is automatable;
4. record browser-dependent behavior and the tested Chrome version;
5. avoid weakening the content sandbox without a documented security review;
6. update this matrix and the conformance runner's expected results; and
7. preserve unknown metadata and unsupported resources for Inspector use where
   practical.
