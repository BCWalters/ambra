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

Store releases follow the [beta checklist](store-assets/BETA_RELEASE.md).
The MIT repository is public; the initial Chrome Web Store listing is unlisted
and installable by anyone with its URL.
