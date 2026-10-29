# Ambra 3.3.3 manual release

## Update notes

```text
- Page flip is now the default page-turn effect.
- Previously saved page-turn choices are preserved, and reduced-motion preferences are still respected.
- Page flip supports standalone SVG pages without interrupting navigation.
```

This patch changes the built-in page-turn default from Slide to Page flip
(stored as `rotate`). It does not migrate or overwrite existing preferences.
The reader and Library share the same default. Scrolling mode and the available
page-turn effects remain unchanged. Page-flip snapshots accept native SVG roots
as well as HTML roots, preserving standalone SVG navigation with the new default.

## Validation and packaging

Require root package, extension package and manifest version **3.3.3**.
Verify fresh reader and Library settings select Page flip, saved choices survive
reload, and all four persisted effects remain unchanged. Retain the existing
animation and reduced-motion regressions.
Cover fixed-layout and reflowable SVG paging, native focus, resize and resume.

Merge through normal exact-head protected checks, then require successful
actual-main CI. Use only its exact `beta-release-<merged SHA>` Public archive,
not a local or PR merge-ref package. Verify the producer, validation receipt,
archive checksum, version, clean merged commit, ZIP integrity, entry points,
notices and unchanged permissions. Smoke-test that exact extracted package.
Preserve previous release drops and prepare a fresh versioned owner handoff.
Do not overwrite a live unpacked extension or its configuration.

## Owner-only submission and limits

Preparation is not a store upload, submission or publication. The owner submits
manually to the existing **Public** item `mcjkkebkhifgkkbahlcapjlnaihocogj`.
Preserve listing settings and permissions disclosures. Do not use the historical
Unlisted uploader.

This default-setting patch makes no new full EPUB conformance or live
assistive-technology claim. Physical touch, live speech and OS switching remain
manual.
