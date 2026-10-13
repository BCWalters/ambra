---
description: Native reader paint and compositor constraints discovered during release validation.
applyTo: "apps/extension/src/reader/**,apps/e2e/tests/**"
---

## Learnings

Do not infer that `backdrop-filter` is visually redundant merely because reader chrome uses opaque gradient stops. Removing toolbar/scrubber filters passed macOS comparisons but changed native Linux half-opacity chrome, publication ink weight and preparation/handoff pixels. Require native chrome and publication parity, including fades, on the protected validation platform before accepting compositor changes; preserve existing exact-pixel and ink-weight assertions.
