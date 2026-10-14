# Ambra 3.3.2 manual release

## Update notes

```text
- Fixes backward Page flip animation in single-page reading: the previous page now comes back over the current page, reversing the forward turn.
- Applies the correct mirrored motion in right-to-left books, including fixed-layout pages and chapter boundaries.
```

This patch addresses [#433](https://github.com/BCWalters/ambra/issues/433).
Forward turns, two-page spreads, Slide and Film strip remain unchanged.
The previous page supplies both curled faces on a backward single-page turn;
the current page stays underneath. Logical gesture progress stays unchanged,
while the physical curl follows the inverse path, including return/cancellation.
Snapshots stay script-disabled and restore capture state before painting.
Fixed-layout returning leaves retain the previous page's dimensions when
adjacent pages have different aspect ratios. The current-page underlay keeps
its own bounds and is hidden when the backward turn completes.

## Validation and acceptance

Require root package, extension package and manifest version **3.3.2**.
Run orchestration units and native regressions for reflowable/fixed-layout
single-page LTR/RTL. Matching forward/backward poses must have identical
previous-page ink and all 20 strip transforms, with correct underlay ownership.
Include mixed portrait/landscape fixed pages, current-page underlay bounds,
and completed/returned underlay visibility.
Verify chapter boundaries, gesture return/commit/interruption, reduced motion,
spread geometry/ink/seams, prefetch ownership and the existing eight-cohort
curl reliability group. Do not change 3.3.1's calibrated timing policy.

Merge through normal exact-head protected checks, then require successful
actual-main CI. Select only its exact `beta-release-<merged SHA>` Public archive,
not a local or PR merge-ref package. Verify producer/receipt/checksum/ZIP digest,
version, commit, clean identity, CRC, paths, entry points, notices and unchanged
permissions. Native-smoke that exact extracted package.

Prepare a fresh versioned owner drop without modifying 3.3.0/3.3.1 packages.
The owner explicitly authorized updating the live extension for this release:
preserve its existing live-loader configuration and extension identity, back up
the old output, and use the validated source/product output rather than building
from the unrelated dirty checkout. Verify version and bundle provenance after
the update. Chrome may need Reload on the unpacked extension.

## Owner-only submission and remaining limits

Preparation is not a store upload, submission or publication. The owner submits
manually to the existing **Public** item `mcjkkebkhifgkkbahlcapjlnaihocogj`.
Preserve listing settings, permissions disclosures and previous drops.
Do not use the historical Unlisted uploader.

No full EPUB conformance or live assistive-technology claim is made by this
animation patch. The 3.3.1 assessment is earlier-candidate evidence, not a
3.3.2 verdict. Physical touch, live speech and OS switching remain manual.
