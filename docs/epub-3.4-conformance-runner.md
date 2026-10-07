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
5. optionally assesses the eleven pinned core font/image criteria in actual
   headless Chromium, producing package-bound observations and a scorecard; and
6. archives the package, package metadata, worksheet, runner configuration,
   and this procedure for 30 days.

Download `epub-3.4-assessment-kit-<commit>`. Preserve its
`dist/beta-release/artifacts/` directory, ZIP, and
`dist/conformance/epub-3.4-assessment.json` worksheet together. The worksheet
records the Ambra commit, version, archive name, and SHA-256; the report command
rejects a different or dirty package.

The default `automated_core=true` profile assesses 21 required criteria. It
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
