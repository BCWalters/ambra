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

Roll layout, packaged CSS resource graphs, primary reading order, gapless
fixed-layout spreads, ZIP64/OCF processing, ordered rendition properties,
metadata whitespace, and metadata direction/language are implemented and
protected-CI validated. The remaining Phase 1 work concerns foreign-resource
fallbacks and core media capabilities, URL schemes/remote-resource policy, and
vertical-writing pagination. Regression validation is not a replacement for
a new package-bound official conformance assessment.

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
| C34-19 | Metadata ASCII whitespace normalization           | Strip and collapse ASCII whitespace in canonical Dublin Core/meta values without removing meaningful non-ASCII whitespace; preserve identifier and source-order behavior. | [#354](https://github.com/BCWalters/ambra/issues/354) |

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

#### C34-04 implementation and assessment expectations

Consumer-aware resource fallback selection is prepared for protected remote
validation. Markup images and responsive candidates, video posters, media
sources, linked/inline CSS imports and URLs, font-face sources, and Media
Overlay audio select the first supported manifest candidate in source order.
Image and font candidates are checked with the actual image/FontFace decoder;
audio/video candidates require native MIME acceptance and decoded data without
playback. This includes AVIF, JPEG XL, AAC-LC MP4 and Opus MP4. Capability checks
are bounded, cancellable, session-cached and never request remote URLs.

Stylesheets resolve dependencies relative to the selected fallback stylesheet,
not the original alias. Selected source MIME hints are updated and obsolete
CSS font format hints are removed. Missing fallback targets, cycles, and exhausted
chains produce precise diagnostics and an accessible, localized notice without
aborting unrelated chapter content. Missing direct markup/archive resources
and unexpected failures still propagate. Raw Inspector/archive access and the
existing URL revocation lifecycle remain independent of rendering selection.

Image-backed objects render as images without enabling `object-src` or weakening
the sandbox. Unsupported document/plugin objects retain their fallback children.
This does **not** implement nested XHTML/SVG content-document object rendering,
plugins, bindings, or scripted handlers; those remain explicit policy/compatibility
gaps. Image replacements retain the object's element position and identifying,
presentation and accessibility attributes, but do not expose its fallback text
as rendered text when the image succeeds.

Synthetic packaged-browser fixtures cover reflowable, fixed and roll layouts,
all four font formats, AVIF/JPEG XL, genuine silent AAC-LC and Opus MP4 resources,
video, object images, responsive candidates, CSS alias cycles, missing/exhausted
chains, and fallback Media Overlay playback. All media/font fixtures are generated
from original geometry, silence and solid colors on GitHub. No local browser or
unit tests are used for this work.

Fallback support must not be scored as JPEG XL decoder support. A Chromium build
without a JPEG XL decoder can select an available image fallback, but a standalone
JPEG XL criterion still fails. The original 2.2.0 assessment remains six required
passes/five failures among eleven assessed criteria, with 194 criteria unassessed.
Future release scoring must verify the pinned official foreign-resource and core
media criteria against the actual packaged build. C34-04 remains open until the
remaining native-decoder/object-policy gaps and official evidence are resolved.

#### C34-05 implementation and assessment expectations

Fixed-layout pairs now share the full available width without a reserved gutter
or binding shadow. Their authored coordinate spaces meet directly in LTR and RTL;
shared scaling, unequal intrinsic page sizes, outer centering, and single-page
behavior are preserved. Protected geometry checks require less than one CSS
pixel of separation before and after resizing, not merely a small-looking gap.
The official pre-paginated spread criteria still require release assessment.

#### C34-09 implementation and assessment expectations

Manifest and spine property sets preserve XML token order. Item-level layout,
spread, page-side, and orientation resolution now uses the first recognized value
in that order, ignoring unknown values and preserving publication defaults.
Conflicting effective values emit one diagnostic per group and spine item without
rejecting the publication. Equivalent prefixed/unprefixed page-side aliases do not
conflict; the deprecated portrait-spread value retains its existing `both`
normalization. Publication-wide `roll` continues to ignore item-level layout
overrides. Orientation remains an advisory value surfaced in inspection, not a
browser-window orientation lock. Regression coverage exercises ordered pairs,
aliases, unknown tokens, parsed XML order, and diagnostics. Official criteria
still need release assessment; these synthetic checks do not alter the score.

#### C34-07 implementation and assessment expectations

A shared URL classifier and conservative resource-policy milestone are prepared.
URL preprocessing happens before scheme detection, including embedded tabs/newlines
and leading/trailing C0/space characters. Package references retain URL-aware
percent decoding; fragment-only references remain in-document. HTTP(S), file,
data, protocol-relative and unsupported schemes never alias ZIP filenames.
Remote manifest locations retain their URL identity and may select a usable
packaged manifest fallback without fetching the original.

The product policy remains offline-only for automatic publication subresources.
Controlled HTTPS fetching is **not enabled**: there is no implicit consent,
network retry, or remote-data cache. Existing `remote-resources` declarations
remain diagnostics, not permission grants. HTTPS support remains a recommended
compatibility gap and would require separate consent/privacy/offline design.

Data URLs remain blocked for automatic resources and book-initiated navigation:
the permitted data-type allowlist is empty and the decoded-payload limit is zero
(no payload decoding). Supporting selected embedded data types later must not
enable top-level content-document/data navigation. File URLs are blocked for both
automatic resources and reader-controlled link actions. Only explicitly activated
HTTP(S)/email hyperlinks can leave the publication; protocol-relative hyperlinks
use HTTPS, and new windows retain `noopener,noreferrer`.

Blocked resource attributes/candidates and CSS alternatives are removed with
diagnostics and localized accessible notices; unrelated content remains readable.
Unsupported hyperlink destinations become safe fragment placeholders that retain
keyboard/link affordances and announce the policy instead of opening their
original destination. The raw publication DOM/source and Inspector archive APIs
remain independent. HTML posters, image-backed object/embed elements, unsupported
iframe documents/srcdoc, and SVG image/use/feImage references are covered.

This milestone does not implement nested document rendering, arbitrary external
SVG presentation-attribute graphs, inherited resource `xml:base`, or remote/data
loading. Those surfaces remain explicit compatibility/policy gaps; C34-07 stays
open rather than implying complete URL/resource conformance. Prepared synthetic
XHTML/SVG browser fixtures verify no actual requests for the exercised blocked
resources, safe external-link dispatch, local remote-resource fallbacks and SVG
symbol references. Their regression results do not change the original partial
official score; the pinned file/data/navigation criteria require a separate
package-bound assessment.

#### C34-08 implementation and assessment expectations

Package and metadata-element `dir` and `xml:lang` are retained with each nonempty
Dublin Core/meta value, including source IDs and alternate-script/refinement
targets. Inheritance, explicit language clearing, automatic/unknown direction,
and duplicate values with distinct contexts are preserved. Unknown direction
is diagnosed and uses Unicode P2 processing through `dir="auto"`.

New Library imports persist these contexts. Library cards/generated covers,
Book Details, reader titles/running headers (including temporary animation
overlays), and Inspector summaries apply value-local `dir`, `lang`, and bidi
isolation without changing UI labels or spine page progression. Previously
imported records without contexts use automatic direction/unknown language;
reader and standalone Inspector sessions obtain contexts from the OPF.
Fetched fallback descriptions do not inherit the publication's metadata context.
Content-resource language/direction is not inferred from package metadata or
informational `dc:language`.

Generated Arabic, Hebrew, Persian, mixed-script and unknown-value regressions
passed protected remote validation in #355. They are not official conformance
passes; release assessments must still evaluate the corresponding criteria.

#### C34-19 implementation and assessment expectations

Dublin Core and OPF meta values now share exact ASCII whitespace stripping and
collapse before canonical metadata or derived rendition/accessibility processing.
This includes identifiers, dates, repeated creator/subject/contributor values,
refinements, and legacy meta `content` attributes. Meaningful non-ASCII spaces
are preserved. Unique-identifier selection, main-title/creator source order,
optional empty-value handling, and required-value errors remain unchanged.
Regression coverage passed protected remote validation in #355; official
criterion assessment and the release conformance score remain separate.

#### C34-06 implementation and assessment expectations

C34-06 is implemented and protected-CI validated in #355, including the actual
65,536-entry archive fixture.
ZIP64 v1 EOCD/locator and conditional extended information fields are parsed
without rounding unsigned integers. ZIP32 behavior, Store/Deflate, CRC checking,
and supplied-buffer boundaries remain covered. Native ZIP encryption, unsupported
extraction versions/compression methods, multidisk records, malformed UTF-8
names, inconsistent headers/descriptors, and archive extra data records are
rejected explicitly. EPUB opening validates the first uncompressed `mimetype`
entry, its local/central extra fields, and its exact ASCII contents.

Default limits are 1,000,000 entries, 256 MiB uncompressed per entry, and 8 GiB
declared uncompressed total. `ZipArchive.open` and `EpubContainer.open` accept
explicit limit overrides for trusted inputs. Deflate output is streamed and
stopped if it exceeds the declared, already-limited size. Archive input remains
buffered, so browser allocation limits still apply; ZIP64 support does not imply
unlimited memory. Regression fixtures cover an actual 65,536-entry directory,
ZIP64 partial fields, signed/unsigned descriptors, unsafe integers, corruption,
limits, and malformed mimetype entries. Tests run remotely, not on the developer
device. Synthetic coverage does not change the official conformance score.

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
