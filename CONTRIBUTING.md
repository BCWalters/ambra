# Contributing

Ambra is an early-stage Chrome EPUB reader. Small, focused pull requests and
reproducible bug reports are welcome. Contributions to original project material
are under the [MIT license](LICENSE); retain third-party notices and only submit
content you have the right to distribute.

## Local setup

Use Node.js 24.18.0 and pnpm 11.11.0 to match CI. Run commands from the repository
root:

```sh
pnpm install --frozen-lockfile
pnpm --filter @ambra/extension dev
```

Load `apps/extension/dist` in `chrome://extensions` with Developer mode enabled.
The dev server must remain running. Use a separate Chrome profile for test books
and extension experiments; there is no cloud backup. See the [README](README.md)
for standalone builds, imports, and runtime troubleshooting.

Do not run a production build over another process's live `apps/extension/dist`.
Coordinate before restarting shared development processes. Browser tests use an
isolated output directory; see the [browser-test guide](apps/e2e/README.md).

## Finding real-book test candidates

Before writing a one-off archive search, check the [EPUB discovery tools](scripts/README.md).
`pnpm scan:epubs ~/Downloads` finds CSS break-avoid declarations;
`--css`, `--tag`, and `--class` find other content features. Scanning is local and
read-only, including inline styles, with full JSON results available for analysis.
Treat results as candidates, not proof of rendered behavior. Do not commit or
publish private EPUBs or unredacted library reports. Add new reusable detectors
and original synthetic tests to the tool so future contributors can find them.

## Checks and pull requests

1. Create a topic branch; do not push directly to `main`.
2. Keep changes and tests scoped to one concern. Add synthetic regression inputs
   where possible rather than uploading someone's book.
3. Run focused checks first, then the required CI checks:

   ```sh
   pnpm test
   pnpm typecheck
   pnpm lint
   pnpm --filter @ambra/e2e exec playwright install chromium
   pnpm --filter @ambra/e2e run test:e2e
   ```

   `pnpm test` covers unit tests, not Playwright. Real-book/live-network tests
   may need separate opt-in inputs; skipped tests are not passing evidence.

4. Open a pull request describing the problem, approach, and actual validation.
   Changes to `main` must go through a PR and the configured branch checks.
   Documentation stating this policy is not a substitute for GitHub enforcement.

The engine is dependency-free and UI-framework-independent. Put React/UI
dependencies in the shell or extension. Prefer clear responsibilities and small
changes over unrelated refactors.

## UX and design system

Use the [approved design system](docs/design-system.md) and
[standalone review prototype](docs/design-prototype/README.md) for extension UI
work. They describe the target UX, not features already shipped. The
[phased roadmap](https://github.com/BCWalters/ambra/issues/289) tracks migration;
preserve existing capabilities and document intentional behavior changes.
Prototype omissions are not permission to remove production functionality.

Documentation-only edits do not require local extension builds or release
packages. The prototype has an optional isolated verifier for changes to its
interactions. Existing required PR checks still apply; do not bypass branch
protection or release validation to publish design references.

## Reporting issues safely

Include Chrome/OS versions, Ambra version, layout/settings, expected versus actual
behavior, and concise reproduction steps. Redact local paths, account details,
download tokens, book notes, and other personal information. Do not attach
copyrighted EPUBs, real browser profiles, cookies, traces, or logs without review.
Link to a lawful public sample or create a synthetic reproduction instead.

Use the repository's private security-reporting channel if enabled for sensitive
reports; do not publish secrets or exploit details in a public issue.

## Accessibility and releases

Keyboard and Chromium accessibility-tree tests do not establish exact VoiceOver
or NVDA virtual-cursor behavior. Live assistive-technology testing remains
pending; report the exact browser/OS/AT combination tested.

Store updates follow the [2.2.0 checklist](store-assets/RELEASE-2.2.0.md).
The MIT repository and Chrome Web Store listing are Public, as confirmed by the
owner. Preserve the listing's visibility and existing item. Check the dashboard's
current version and review status before uploading a new package.

Run the release assessment described in the
[EPUB 3.4 conformance plan](docs/epub-3.4-conformance-plan.md) against the final
production package for each release candidate. The assessment may be opt-in or
manually dispatched rather than part of ordinary branch CI, but its scored
report and any accepted failures belong in the release checklist. Use the
[release conformance runner](docs/epub-3.4-conformance-runner.md) to prepare the
package-bound worksheet and generate the JSON and Markdown reports.

### Release versioning

Choose the version for the complete release, not for each individual PR:

- A release with at least one new feature increments the minor version and
  resets the patch version, for example `1.0.4` to `1.1.0`.
- A release containing only bug fixes or improved content handling increments
  the patch version, for example `1.1.0` to `1.1.1`.
- An explicitly owner-approved major milestone may increment the major version.
  The approved UX overhaul and feature rollout shipped as `2.0.0`.

Keep the source version, extension manifest, release notes, and archive name
consistent when preparing the validated release candidate.
