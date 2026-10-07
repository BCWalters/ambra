# Manual EPUB 3.4 validation plan

The latest [measured report](epub-3.4-progress-report.md) has 63 passes, one
native JPEG XL failure and 75 pending required criteria. Those 75 are not all
inherently manual. This plan prioritizes original-publication evidence without
turning inventory entries or ordinary E2E smoke tests into conformance passes.

## Set up a reproducible campaign

1. Download the assessment kit from
   [run 37666174481](https://github.com/BCWalters/ambra/actions/runs/37666174481).
   It identifies main commit `46d28870b19bc96136cdc22aaf376cdb97f32b3f`.
2. Verify `ambra-2.2.0.zip` against the kit's `release.json`. The measured
   archive SHA-256 is
   `7d226c5d8b3cc1c1f86490b01a6c3ab596a5139ad87de3750e5716b0eb1da7c4`.
3. Unpack that exact archive and load it in an isolated Chrome profile.
   The live Dev extension is useful for smoke checks, but is not this package.
4. Use W3C EPUB tests revision
   `54092b4233253e9aac80e93ec4782b380b4b3403` and each publication's authored
   instructions. The kit's required plan/procedures identify the original
   directories, normative requirements and expected outcomes.
5. Prepare a separate manual worksheet using the
   [runner instructions](epub-3.4-conformance-runner.md#run-the-official-tests).
   Record UTC time, reviewer, full browser/OS versions, package commit/hash,
   profile/configuration, reader mode and viewport dimensions.
6. Keep manual macOS and hosted Linux campaigns separate. The worksheet has
   one global environment; merging rows from different environments would lose
   provenance. A future website dataset must preserve per-campaign or per-result
   environment and package identity.

Do not regenerate deliberately invalid compression/segmentation fixtures as
ordinary ZIPs. If a local tool lacks BZIP2 or splitting support, retain the
blocker and use the proper hosted-generated fixtures.

## Session 1: corroborate the SVG repair, about 15 minutes

Open original `cnt-svg-support`, `cnt-svg-css` and `pkg-spine-order-svg`
publications. Follow their authored rendering and order criteria. Also check
forward/backward turns, narrow/wide windows, mode switching and saved-position
reopening.

These are corroborating checks of already automated identifiers, not three
additional identifiers to add to coverage. A manual pass needs its own evidence
and campaign identity.

Continuous centered stacking of all SVG pages remains
[#373](https://github.com/BCWalters/ambra/issues/373); this UX is not claimed
implemented by the measured rendering repair.

## Session 2: authored fixed-layout cases, about 30-45 minutes

| Original identifier | Main observation; follow the full authored instructions |
| --- | --- |
| `lay-pp-embedded-images` | XHTML-embedded artwork preserves the original page presentation. |
| `lay-pp-embedded-images-svg` | SVG-embedded artwork is visible and correctly presented. |
| `lay-pp-images-mixed` | Mixed embedded and spine-image pages appear without omitted content. |
| `lay-pp-layout-pre-paginated` | One authored page per spine item, without unintended reflow. |
| `lay-pp-layout-pre-paginated-spreads` | Synthetic spread pages meet without an unintended gap. |
| `lay-pp-spread-none` | The original spread-none publication does not synthesize spreads. |
| `lay-pp-svg-icb_multi` | Both different SVG viewports produce their authored clipping outcomes. |
| `lay-pp-xhtml-icb_multi` | Both different XHTML viewport declarations produce their authored clipping outcomes. |

Read the criterion before choosing a verdict. Traverse the relevant original
spine items both ways at a constrained and wide window, recording actual
dimensions. Assess clipping, sizing and spreads rather than import success.
Save evidence per identifier. If a procedure cannot be completed, keep
`not-run` with a specific reason; uncertainty is not a pass.

## Subsequent sessions

- Media overlays: follow original SMIL boundaries and authored prompts.
  Record listening, phrase highlighting and navigation synchronization.
  Advancing clocks and decoded PCM do not establish audible output.
- Structural semantics: use the original `pss-support_ignore-title`
  second-page footnote case, not a generic popup smoke test.
- Remaining layout/resource cases: build deterministic native original geometry,
  clipping, override and containment assertions where practical. Do not assume
  every pending method requires a person.
- `lay-pp-layout-duplication` explicitly targets EPUBCheck. Record validator
  evidence, not an Ambra rendering pass.
- Review scripting/origin applicability per normative requirement.
  Publication scripting stays disabled; this does not waive unconditional
  origin requirements. Network fonts/video still need the separate privacy
  and consent decision. JPEG XL remains a native-browser failure.

## Record and publish honestly

Each tested worksheet row needs `method: manual`, status, a justified reason,
durable non-sensitive HTTPS evidence, and an Ambra issue URL for a failure.
Expected failures remain `fail`, not `not-applicable`.

The evidence should identify the original criterion/publication, exact package,
environment, reviewer, time, actions, expected outcome and observed outcome.
Use a recording or explicit observation log where a screenshot cannot prove
audio, timing or reload behavior. Never upload private browser profiles,
credentials or user books.

Generate the report against the pinned suite, exact release metadata and manual
worksheet. Partial coverage is expected to fail the full release gate; do not
weaken it. Keep automated, manual, local exploratory, pending, policy-dependent
and validator-only evidence distinct.

Any later website publication should expose tested/required coverage, failures,
pending criteria, methodology and evidence by campaign. Do not combine repeated
automated/manual observations into duplicate identifier counts or publish a
misleading single "EPUB compliant" percentage.
