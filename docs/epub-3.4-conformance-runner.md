# EPUB 3.4 release conformance runner

Ambra's EPUB 3.4 release assessment is a manual-first, scored process built
around the official [W3C EPUB test suite](https://github.com/w3c/epub-tests).
It is required for final release candidates but is intentionally not part of
ordinary pull-request CI.

The runner pins suite revision
`54092b4233253e9aac80e93ec4782b380b4b3403`. Do not substitute the suite's
moving `main` branch or the live OPDS catalog. The pinned source contains 205
test cases across 206 publications:

- 139 required (`must`) tests;
- 38 recommended (`should`) tests;
- 1 optional (`may`) test; and
- 27 deprecated tests retained for the complete compatibility picture.

The checked-in OPDS catalog at this revision contains only 199 publications, so
the runner inventories the pinned package documents instead. The configuration
also records two upstream identifier details:

- `pkg-unique-id` intentionally comprises two publications with the same EPUB
  identifier; and
- the `lay-pp-svg-icb_multi` publication incorrectly repeats the
  `lay-fxl-svg-icb_multi` identifier and title, so Ambra applies a visible,
  source-directory-specific reporting override.

## Prepare the exact assessment kit

For a final release candidate, merge all release changes to `main`, then run
the **Assess EPUB 3.4 release candidate** workflow manually. It:

1. rejects non-`main` source refs;
2. builds and validates the production extension package;
3. verifies the immutable W3C suite revision;
4. creates a worksheet containing every pinned test;
5. inventories all 139 required identifiers, attaches explicit procedures, and
   optionally runs the registered native methods in actual headless Chromium; and
6. archives the package, package metadata, worksheet, runner configuration,
   and this procedure for 30 days.

Download `epub-3.4-assessment-kit-<commit>`. Preserve its
`dist/beta-release/artifacts/` directory, ZIP, and
`dist/conformance/epub-3.4-assessment.json` worksheet together. The worksheet
records the Ambra commit, version, archive name, and SHA-256; the report command
rejects a different or dirty package.

With `required_assessment=false`, the `automated_core=true` profile assesses
the original 21 required criteria. It
retains the same eleven media criteria
as the initial baseline: OpenType, TrueType, WOFF, WOFF2, AVIF, GIF, JPEG, JPEG XL,
PNG, SVG and WebP. Font checks now require the expected native face to be loaded
and used in painted authored content, with an original glyph probe differing
from generic serif. Image checks require decoding from packaged blobs and
native hit-testing in both frame and shell. These are stronger measurements
than the initial decode/loading-only baseline; record that methodology and any
browser/OS difference when comparing scores.

The separate `foundations-profile.json` adds ten named checks:

- Package: `pkg-title-order`, `pkg-creator-order`, `pkg-meta-whitespace`,
  `pkg-dir_creator-rtl`, `pkg-dir_but_not_content`, `pkg-lang_but_not_content`.
  Expectations come from inert parsing of the pinned raw OPF, independently
  of Ambra's parser. Visible, hit-tested Library metadata must use the first
  title/creator, normalized ASCII whitespace and the creator's declared RTL
  direction. Displaying only the first creator is allowed by the criterion.
  Unannotated content must not inherit package direction/language. The
  language check records authored-paragraph ancestor and DOM/frame annotations,
  its computed direction, paint and original text SHA-256, and the actual English browser
  locale; it does **not** claim live screen-reader or speech-language testing.
- Navigation: `nav-access`, `nav-activation`. The authored TOC must be available
  through painted native controls. Activation uses real control clicks and
  verifies the independently derived archive path, spine index, document title
  and painted target in the live document, not just successful import.
- Roll: `lay-roll-embedded-images`, `lay-roll-embedded-images-svg`. All authored
  spine frames must fit the viewport width, preserve their source intrinsic
  aspect ratios and meet adjacent frames within **one CSS pixel**. Every
  embedded image must decode natively, paint after scrolling into view and
  match its original source SHA-256. No external image URLs are fetched by
  these probes. The SVG test's description says "pre-paginated", but its actual
  package declares `rendition:layout=roll`; the check follows that declaration.
  Raw-source TOC targets use the standalone SVG root for SVG documents without
  a fragment, rather than requiring an XHTML body. Missing fragments and
  unsupported document roots still block source expectation generation.
  Paint hit-testing maps one point between the iframe's intrinsic coordinates
  and its scaled outer rectangle, clipped to the actual roll scroller and
  browser viewport. Both native documents must hit that same visible point.
  Raw geometry and mapped points are archived alongside the unchanged byte
  hashes, decode results, and layout thresholds.

The ten additions increase possible required coverage from 11/139 (7.91%) to
21/139 (15.11%); these are profile sizes, **not measured pass results**. Report
the original eleven separately when comparing, and distinguish newly assessed
criteria from actual fail-to-pass improvements. Execution blockers remain
unassessed. The collector's `--foundations` flag requires all 21 records;
without it, existing eleven-record media-only collection remains supported.

[Merged-main run 37623541718](https://github.com/BCWalters/ambra/actions/runs/37623541718)
measured the historical 21-method profile: 20 passes and the native JPEG XL failure.
All ten additions pass; the original eleven remain 10/11. See the
[progress report](epub-3.4-progress-report.md) for coverage, exact package
fingerprint, environment and the distinct historical comparison. The red
release-completeness gate remains intentional.

### Full required inventory and expanded methods

`required_assessment=true` is the default for new dispatches. The kit includes
`dist/conformance/required/required-plan.json` and `required-procedures.md`,
covering **139 identifiers / 140 publications**, including both originals for
`pkg-unique-id`. Every row retains its source directories, authored expectation,
normative references, method, subject and explicit procedure. Inventory coverage
is not executed-verdict coverage.

The expanded registry currently has **64 automated methods**: the unchanged 21
plus 43 additions. This is a method count, **not a measured score**. The latest
published merged-main result below remains the historical 60-method run until
the new methods are assessed against a fresh exact production package:

- Source-derived original document text and complete spine order, including
  unknown collection/manifest/meta/spine properties, backward package version,
  arbitrary/first rootfile selection, ancillary META-INF files, package-relative
  locations, three foreign-document fallback cases, ordinary XHTML, XHTML/SVG
  reading order and repeated spine occurrences. Each actual chapter must have
  the expected path/index, original text hash and scaled paired paint point.
- Presentation MathML with native namespace, painted equation and a superscript
  positioned above and smaller than its base.
- Three OCF image-reference cases (relative, archive-root absolute, and excess
  parent segments) plus the non-spine PSD-to-PNG manifest fallback. Expectations
  use the original raw XHTML/OPF and browser-standard URL resolution independently
  of Ambra's resolver. Every selected image must match the original expected
  target's SHA-256, decode natively and paint at the same child/shell hit point.
  Import alone is insufficient; surfaced import/reader errors remain failures.
- Standalone/included SVG and its CSS pattern cases, requiring original path
  geometry hashes, native fill/pattern resolution and paired shape hit points.
  Standalone opening uses an explicit native import/open observer: a surfaced
  rejection of the original content is a failure, not a generic iframe timeout.
- MP3, MP4 audio and Opus: original resource hash, decoded media state,
  advancing native clock after a native playback-control click, and nonzero PCM
  from Chromium's offline decoder of those exact bytes. This avoids a live
  AudioContext/autoplay gate, does not reroute the player's output, and establishes
  software decode/playback rather than a physical-speaker or listening-session claim.
- The remaining five navigation cases, including hidden authored items and
  publisher list numbering, plus six element/root/auto title-direction cases.
  Bidi checks use the exact title and independently resolved computed direction;
  they do not claim a separate visual glyph-order or assistive-technology audit.
- Real BZIP2 and segmented ZIP rejection. The generator preserves uncompressed
  first `mimetype`, arbitrary root directories and original source bytes.
  Compression and disk fields are inspected before import; a corresponding
  surfaced error is required. Rejecting BZIP2's inspected version-needed value
  46 also satisfies the authored in-error outcome; its error need not literally
  contain the word "compression". Other version errors do not qualify.
  Ordinary ZIP regeneration must not turn these
  intentionally invalid fixtures into valid ones.

[Merged-main run 37641226454](https://github.com/BCWalters/ambra/actions/runs/37641226454)
now executes all 60 methods: **56 pass, four fail, zero execution blockers**.
All original 21 statuses are unchanged. Three newly measured standalone-SVG
cases surface `Cannot read properties of null (reading 'style')` in the actual
reader ([#367](https://github.com/BCWalters/ambra/issues/367)); JPEG XL is the
unchanged fourth failure. Native audio and both deliberately invalid archive
cases pass. Required verdict coverage is 60/139 (43.17%), not 139/139.
See the [progress report](epub-3.4-progress-report.md) for the complete category
table, exact archive fingerprint and retained exploratory outcomes.

In that published run, **79 rows remain unassessed**, not passed and not
silently waived. Four now have newly registered image URL/fallback methods;
their verdicts still require fresh package-bound execution. The remaining
**75 rows have procedures but no criterion-specific automated method**.
Those procedures cover authored visual/layout comparisons,
SMIL/audio synchronization and listening, duplicate-publication/bookmark/link
behavior, physical progression, resource restrictions, structural semantics and
per-reference scripting/origin applicability. A pending automated method is not
presented as an unavoidable browser limitation. `lay-pp-layout-duplication`
explicitly targets EPUBCheck; its validator evidence cannot establish an Ambra
reading-system verdict. Conditional MUST assertions must be reviewed individually;
disabling publication scripting does not waive unconditional origin requirements.

The `--required --plan <required-plan.json>` collector demands every registered
native record and the complete exact-package-bound inventory. It rejects missing
procedures, duplicate source directories, renamed kinds and incomplete records.
Manual rows receive explicit pending reasons and retain any already evidenced
manual result; registering a procedure never promotes it to a pass.

Developers may explicitly set `AMBRA_ASSESSMENT_LOCAL=1` when running focused
native probes against an isolated, fingerprinted package. Those records carry
`execution: local-exploratory` and a local `file:` evidence URI; no hosted run is
invented. Local mode is forbidden inside GitHub Actions, and the release
collector rejects local evidence rather than promoting it into a published
release score. Keep exploratory output separate from the official kit.

All 140 publications are generated outside the immutable source checkout, so the
upstream segmented volume is preserved. `AMBRA_ASSESSMENT_PUBLICATIONS_PATH`
selects this separate archive directory while `AMBRA_EPUB_TESTS_PATH` continues
to supply independent raw expectations. With `automated_core=false`, the full
inventory/procedures are still produced, but no native verdict is claimed.

Every observation is tied to the exact package fingerprint and workflow run.
Missing/duplicate observations, mixed package/browser/OS provenance, missing
failure issues and invented `not-applicable` verdicts are rejected. The collector
validates the typed native measurements and rejects verdicts inconsistent with
loaded/used/painted font glyphs or decoded/painted packaged images. Empty evidence
cannot promote a pass. Foundation measurements also reject malformed source
expectations, wrong kinds, invalid geometry/hashes and inconsistent verdicts.
Execution
errors remain explicit `not-run` blockers, never criterion passes. Other tests
remain untouched; importing/opening a publication still does not score it.

The automated run is expected to fail the **release** gate while required
criteria remain unassessed, or when a native criterion fails. Its worksheet,
observations and scorecard are still archived. This is not a failed ordinary
pull-request CI run and is not a complete conformance claim. Set
`automated_core=false` to prepare the manual kit and unassessed scorecard
without launching Chromium. Its incomplete-release gate remains red until
the required manual evidence is supplied. The profile is separate from
ordinary browser test discovery; its
changes retain lint/type/unit-tool validation without unnecessary product
browser runs when no product code changed.

The artifact does not include third-party publications, fonts, screenshots,
browser profiles or browser traces. Source revision and factual native
observations are sufficient to reproduce the named checks.
Playwright's automatic failure context stays in the ignored test-results
directory, outside the archived factual-observation directory.

The same kit can be prepared locally from a clean release checkout:

```sh
VITE_AMBRA_LOCAL_FEATURES=0 node .github/scripts/package-extension.mjs

git clone https://github.com/w3c/epub-tests.git /path/to/epub-tests
git -C /path/to/epub-tests checkout --detach \
  54092b4233253e9aac80e93ec4782b380b4b3403

node scripts/epub-conformance.mjs prepare \
  --suite /path/to/epub-tests \
  --release dist/beta-release/artifacts/release.json \
  --output dist/conformance/epub-3.4-assessment.json
```

## Run the official tests

Generate the pinned test publications:

```sh
(cd /path/to/epub-tests/tests && sh generateEpubs.sh)
```

Unzip the kit's exact production archive and load that unpacked extension in
the recorded Chrome version and operating system. Open each generated
publication, follow its displayed pass criteria, and edit the worksheet:

- `pass`: the stated criterion is satisfied;
- `fail`: the stated criterion is not satisfied;
- `not-run`: the test was not performed; provide a reason;
- `not-applicable`: the test does not apply to Ambra; provide a reason.

Keep `method` as `manual` unless a named automated check produced the result.
Use `evidence` for a durable, non-sensitive URL and `trackingIssue` for the open
Ambra issue covering a failure. Expected failures remain `fail`; never convert
them to `not-applicable`. Do not attach copyrighted publications, private
profiles, local absolute paths, credentials, or user data.

Complete the worksheet's environment block with:

- assessment time and tester;
- Chrome/Chromium name and full version;
- operating system name and version; and
- runner mode plus enough configuration detail to reproduce the assessment.

Classify the three optional feature groups as `supported`,
`intentionallyUnsupported`, or leave them unassessed. A group declared
supported cannot contain a failed or unrun test.

## Generate and gate the report

Run one report command against the completed worksheet and the exact package:

```sh
node scripts/epub-conformance.mjs report \
  --suite /path/to/epub-tests \
  --release /path/to/assessment-kit/dist/beta-release/artifacts/release.json \
  --assessment /path/to/assessment-kit/dist/conformance/epub-3.4-assessment.json \
  --output /path/to/assessment-kit/report \
  --previous /path/to/previous/epub-3.4-conformance-2.1.0.json
```

Omit `--previous` only for the first baseline. The command always validates the
suite revision, complete test inventory, environment metadata, and package
digest. It emits:

- `epub-3.4-conformance-<version>.json`, the machine-readable record; and
- `epub-3.4-conformance-<version>.md`, the human-readable scorecard and
  per-test results.

The command writes both reports and exits with status 2 when the release
assessment fails. It fails the gate for:

- any applicable required test left `not-run`;
- a new required failure;
- a required regression from the previous report;
- any failure without a tracking issue; or
- failed or unrun coverage in a feature group declared supported.

The JSON and Markdown reports separately show required conformance,
recommended behavior, optional feature coverage, and manual completion.
`not-run` and `not-applicable` never inflate a percentage denominator. A
conformance claim is eligible only with 100% required conformance, no applicable
required tests unrun, no required failures, and a passing release assessment.

Archive both reports with the release handoff and link them from the release
checklist. Record any owner decision to ship with a new required failure in the
checklist; the runner deliberately does not turn that decision into a passing
result.
