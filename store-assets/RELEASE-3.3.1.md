# Ambra 3.3.1 manual release

The owner authorized this patch release after the protected merges of
[#421](https://github.com/BCWalters/ambra/issues/421) and
[#422](https://github.com/BCWalters/ambra/issues/422). It preserves the accepted
3.3.0 page-turn appearance and gesture behavior.

Preparation does not upload, submit, approve or publish to the Chrome Web Store.
Preserve the Public listing and all earlier handoffs. Build only in an isolated
checkout, without replacing the owner's live development extension.

## Update notes

```text
- Makes copied error diagnostics match the specific notification, including available error details and the original reading context.
- Keeps new highlights and notes within the visible page in paginated reading, including two-page spreads and reordered publication content.
- Preserves existing annotations and continuous-scroll selection behavior.
```

Notification reports capture bounded, local information when the error appears;
they do not automatically upload it. Review copied details before sharing.
Annotation previews and creation use the same constrained range for the selected
text and both CFI endpoints. Each spread document/page is handled independently.
Empty or disjoint selections that cannot be represented by one annotation do not
silently include hidden text. Saved and imported annotations are not truncated.

## Validation and package acceptance

Require root package, extension package and source manifest versions to agree on
`3.3.1`. Internal unpublished workspace versions remain independent. Run release
tooling tests, types, lint, production packaging and the full protected browser
matrix. Merge normally with the validated head pinned; do not bypass protection.
Accept only a successful CI run on the actual merged commit.

Use its `beta-release-<merged SHA>` artifact, not a PR merge-ref package or a
different local rebuild. Require `release.json` to record the actual merged
commit, `version: "3.3.1"`, `dirty: false` and `publication: "PUBLIC"`.
Independently verify the archive digest, CRC, safe/unique paths, production entry
points, required notices and unchanged permissions. Reject source maps,
development-server code and local/debug feature bundles.

```sh
cd /path/to/downloaded/artifact
shasum -a 256 -c SHA256SUMS
unzip -tq ambra-3.3.1.zip
```

Run native smoke against the exact extracted archive: notification-specific copy,
error recovery, visible-page annotations, keyboard and margin completion,
independent spread ownership, reordered content, existing annotation exchange,
Library persistence and page-turn rendering/input.

Held-pointer movement across transformed iframes stalls Chromium automation.
Margin regressions use native press/release with the overextended browser Range
seeded between those events; they do not establish a full automated held-pointer
drag. Real selection feel remains a manual check.

The current four-turn curl gate retains every actual paint-entry interval.
Each turn requires more than five samples, mean below 35 ms, nearest-rank p90
below 40 ms and worst gap below 100 ms. Pooled nearest-rank p95 across all four
predetermined turns must be below 40 ms. Preparation/onset/total-turn limits
remain 250/750/1500 ms. No retries, filtering, forced GC or browser/GPU overrides
substitute for acceptance. Native geometry, ink and exact-pixel checks remain.
See [E2E measurement guidance](../apps/e2e/README.md#pagination-measurement-regressions-197--198)
for the sparse-sample rationale and fixture prerequisites.
Frozen paint copying uses indexed native collection traversal to reduce
temporary iterator allocations while preserving property/child order and
authored variables. This is not a change to accepted visuals or timing limits.
Disposed curls also release only their owned copied DOM/caches after restoring
original-page opacity; queued callbacks retaining a leaf cannot retain its
copied document graph. Native coverage checks this ownership and idempotency.
Owned ink clips are also bounded before preparation waits for fonts/images,
avoiding temporary page-height ink surfaces in its first composited frame.
Resource readiness, geometry, visuals and all timing limits remain required.
Frozen CSS serialization also avoids temporary Map entry iterators while
preserving every declaration and its order.
Line measurement reuses an already-measured final correction glyph when it is
the exact final positive point probe. Other native geometry paths, whitespace
fallbacks and existing cooperative checkpoints are preserved. Additional
checkpoints before prefix retries and uncached corrections retain prompt
cancellation.

## Package-bound conformance and manual accessibility

After packaging, dispatch **Assess EPUB 3.4 release candidate** on the merged
`main` commit with `release_run_id` set to the accepted CI run and both automated
profiles enabled. Verify its restored ZIP hash matches the selected store ZIP.
Retain the complete required-criterion inventory, worksheet, procedures,
observations and scored reports in the versioned handoff.

Do not reuse a previous version's package-bound results as 3.3.1 evidence.
Automated results, failures and unassessed criteria remain distinct. A failed
incomplete-conformance gate is not ordinary engineering CI success or a claim
of full conformance. Do not promote these results to the frozen public score.
Follow the original W3C criterion procedures for the remaining campaign; not
every unassessed criterion necessarily needs a person.

Use the [3.3.1 manual accessibility walkthrough](../docs/screen-reader-walkthrough-3.3.1.md)
for roughly 30-minute owner sessions. Historical VoiceOver observations remain
historical; keyboard/AX-tree tests do not establish new live speech, virtual
cursor, touch or audible narration acceptance. Record unexecuted checks honestly.

## Owner-only submission

1. Sanity-check the exact unpacked candidate and confirm the current Public
   item's dashboard version/review state permits 3.3.1.
2. Upload only the verified `ambra-3.3.1.zip` to item
   `mcjkkebkhifgkkbahlcapjlnaihocogj`.
3. Preserve visibility, permissions disclosures, listing settings and screenshots.
   Use the update notes above and submit manually.
4. Record the actual dashboard outcome separately. Do not dispatch the historical
   Unlisted uploader or infer submission/publication from packaging.
