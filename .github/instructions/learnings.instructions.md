---
description: Native reader paint and compositor constraints discovered during release validation.
applyTo: "apps/extension/src/reader/**,apps/e2e/tests/**"
---

## Learnings

Do not infer that `backdrop-filter` is visually redundant merely because reader chrome uses opaque gradient stops. Removing toolbar/scrubber filters passed macOS comparisons but changed native Linux half-opacity chrome, publication ink weight and preparation/handoff pixels. Require native chrome and publication parity, including fades, on the protected validation platform before accepting compositor changes; preserve existing exact-pixel and ink-weight assertions.

For fixed-pose reader pixel comparisons, keep focus in chrome (for example, the Bookmark button) and await its tooltip unless intentionally testing idle hiding or fades. A paused curl can outlive the idle timer, changing its clip and furniture between otherwise identical captures. Compare the composed viewport without loosening pixel tolerances. Persistence-dependent Library fixtures must explicitly flush progress and reopen/reload the Library; a previously mounted background Library is not guaranteed to have refreshed when the reader becomes ready.
