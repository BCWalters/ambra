# Ambra 2.2.0 manual release

Prepare a new package for the existing Public Chrome Web Store item,
`mcjkkebkhifgkkbahlcapjlnaihocogj`. The owner approved 2.2.0 for the in-app
full-screen control. Version 2.0.0 was last confirmed live; verify the current
dashboard version and review state before uploading.

Preparation does not upload, submit, publish, cancel a review, change
distribution, or dispatch the historical Unlisted workflow. The owner performs
store submission.

## What's changed

Copy-ready update notes:

```text
- Enter or leave full-screen reading from Ambra settings without adding another reader toolbar button.
- The control follows browser-driven full-screen changes, including leaving with Escape.
```

The full-screen action appears in reader settings and the expanded Library. It
is intentionally omitted from the compact extension popup, where full-screen
mode is not useful. A rejected browser request produces a visible error instead
of failing silently.

Unpacked development builds are named `Ambra EPUB Reader (Dev)` to distinguish
them from the installed store build. Production packages retain the approved
`Ambra EPUB Reader` name.

No permissions, host access, storage schema, data migrations, listing copy, or
store artwork change.

## Preserve the previous handoff

Before packaging, preserve the entire existing
`dist/beta-release/artifacts/` directory under
`dist/release-history/2.1.0/`. Verify every copied file and do not overwrite an
existing history directory unless its contents are proven identical.

The clean 2.1.0 package recovered from the successful protected #322 CI run has
this SHA-256:

```text
99bbf983b5373c4e03c8d7c5cb406dd659b2e456f5cdd7cf183e4ab2deb8cb84
```

Its metadata records the protected pull-request merge SHA
`e3669b367e5dc15264cb2f11848d70a4cf16ca4e`, `dirty: false`, and
`publication: "PUBLIC"`. Preserve that record unchanged. It proves the package
was produced by successful protected validation; it does not establish store
upload, submission, approval, or publication.

Keep earlier release history, live-preview backups, the separate development
loader, and user libraries intact. The packager clears its current artifact
output; never run it before preserving the previous handoff.

## Validate and package clean merged source

The root package, extension package, and source manifest must all be `2.2.0`.
Require protected PR validation and merge, then package from clean current
`main`:

```sh
git branch --show-current
git status --porcelain
git rev-parse HEAD
node --test .github/scripts/release.test.mjs
VITE_AMBRA_LOCAL_FEATURES=0 node .github/scripts/package-extension.mjs
(cd dist/beta-release/artifacts && shasum -a 256 -c SHA256SUMS)
unzip -tq dist/beta-release/artifacts/ambra-2.2.0.zip
```

Verify `release.json`: version `2.2.0`, the merged source SHA, `dirty: false`,
and `publication: "PUBLIC"`. Verify the archive manifest has version `2.2.0`,
the production name `Ambra EPUB Reader`, unchanged permissions, production
entry points, and required license/notices. Reject development-server code,
profiles, private books, source maps, and secrets.

Test the exact packaged directory in an isolated profile:

```sh
AMBRA_E2E_EXTENSION_PATH="$PWD/dist/beta-release/extension" \
AMBRA_E2E_HEADLESS=1 pnpm --filter @ambra/e2e exec playwright test \
  tests/settings-focus.spec.ts \
  tests/settings-ownership.spec.ts \
  tests/shell-reflow-accessibility.spec.ts \
  --workers=1
```

Required PR CI also covers broader reader, pagination, Inspector, Library,
import, annotation, and recorded-narration behavior against a production
package. Record actual validation counts/skips, source SHA, ZIP checksum, and
remaining limitations in the ignored artifact handoff. Automated checks do not
establish a new VoiceOver/NVDA pass or accessibility certification.

Do not rebuild or relabel a finished handoff under the same version after
giving it to the owner; further release changes require a new approved version
under the [release-version policy](../CONTRIBUTING.md).

## Listing materials and boundaries

Keep the existing approved name, descriptions, icon, promo tile, category,
regions, privacy disclosures, Public visibility, and current screenshot set.
No new artwork is required for this focused release. Retained images keep their
original provenance; they are not exact-2.2.0 captures. Any separately requested
new capture must follow [ASSETS.md](ASSETS.md) against the final 2.2.0 ZIP.

The website's immutable documentation source pin is a separate deployment
decision. Do not overwrite the live unpacked build or touch user data just to
prepare the store ZIP.

## Owner-only submission

1. Confirm 2.2.0 exceeds every uploaded version in the existing dashboard. If
   not, stop and approve a newer source version; do not patch the ZIP or cancel
   an existing review automatically.
2. Upload only the verified `ambra-2.2.0.zip`. Keep Public distribution and the
   existing item and approved listing configuration.
3. Review the update notes and submit manually when ready.
4. Record the actual dashboard outcome separately. Package preparation does not
   establish upload, submission, approval, or publication.
