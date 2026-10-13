---
description: Native reader paint and compositor constraints discovered during release validation.
applyTo: "apps/extension/src/reader/**,apps/e2e/tests/**"
---

## Learnings

Do not infer that `backdrop-filter` is visually redundant merely because reader chrome uses opaque gradient stops. Removing toolbar/scrubber filters passed macOS comparisons but changed native Linux half-opacity chrome, publication ink weight and preparation/handoff pixels. Require native chrome and publication parity, including fades, on the protected validation platform before accepting compositor changes; preserve existing exact-pixel and ink-weight assertions.

For fixed-pose reader pixel comparisons, keep focus in chrome (for example, the Bookmark button) and await its tooltip unless intentionally testing idle hiding or fades. A paused curl can outlive the idle timer, changing its clip and furniture between otherwise identical captures. Compare the composed viewport without loosening pixel tolerances. Persistence-dependent Library fixtures must explicitly flush progress and reopen/reload the Library; a previously mounted background Library is not guaranteed to have refreshed when the reader becomes ready.

In locale/layout fixtures, move focus away from the restored Settings trigger before pointer interactions; its delayed tooltip can otherwise cover nearby controls. Do not use forced clicks to bypass that tooltip.

Nearest-rank p95 equals the maximum below 20 samples, so short animations can receive inconsistent tail classification solely from their frame count. Measure distribution tails over the complete predetermined multi-turn cohort, retaining every interval and strict per-turn throughput/worst-gap guards, rather than repeatedly increasing a sparse per-turn percentile limit. Verify isolated, recurring and sustained slow patterns explicitly; diagnostic profiles are not acceptance replacements.
