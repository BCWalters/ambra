# Unlisted Chrome Web Store beta

The source repository is public under MIT. The initial store listing is
**Unlisted**: anyone with its URL can install, without an invitation or tester
allowlist, but it does not appear in store search or browsing. Share that URL
with friends, then change dashboard visibility to **Public** when ready for a
listed launch. Unlisted is not an access-control boundary; links can be forwarded.

## Repository prerequisites

- [ ] Include and review [screenshot attributions](ATTRIBUTIONS.md) and
  [third-party notices](../THIRD_PARTY_NOTICES.md) with the published repository.
  Official sample licenses support retaining these images with attribution and
  ShareAlike compliance; history rewriting is not presumed necessary. Check the
  Gutenberg jurisdiction caveat for the intended use. Any history rewrite still
  requires explicit owner approval.
- [ ] Review all reachable Git history, tracked archives/images, issues, PRs,
  releases, Actions artifacts/logs, and repository settings for sensitive content.
  The local history scan is not a review of GitHub-hosted artifacts or a guarantee
  that every possible secret was detected. Confirm intended author/contact
  metadata is suitable for publication; rotate any credentials found before
  cleaning history.
- [ ] Confirm GitHub enforces PR-only changes to `main`: required checks, blocked
  force pushes/deletion, and no unintended bypass actors. Decide the reviewer
  policy explicitly; a sole maintainer cannot approve their own PR.
  The CI job is named **Validate and package** (workflow **CI**); verify the
  emitted check context after its first run when configuring required checks.
- [ ] Verify the license, README links, and privacy policy on the public default
  branch after the approved PR merges. Repository visibility is changed by the
  owner separately, not by a build or release command.

## Before uploading a candidate

- [ ] Keep source version, manifest version, release notes, and archive name
  consistent. Chrome Web Store updates require an increasing manifest version.
- [ ] Use a clean reviewed checkout with a frozen lockfile. Build in an isolated
  directory, never over the maintainer's live `apps/extension/dist`.
- [ ] Run unit/type/lint and relevant real-browser regression checks. Record
  which tests were actually run, which were skipped, and the tested commit.
- [ ] Check the archive has a production manifest at its root, no development
  server references, no private EPUBs/profiles/logs/source maps, and the required
  original and third-party license/NOTICE texts.
- [ ] Smoke-test the exact candidate in a separate Chrome profile: file import,
  automatic download import and denied-site-access fallback, library persistence,
  reading/resume, settings, navigation, annotations, and recorded narration.
  Keep original books/exports; a store installation and an unpacked installation
  may have different extension IDs and do not automatically share a library.
- [ ] Test keyboard navigation and perform live VoiceOver/NVDA checks on stated
  OS/browser versions. Until then, mark AT behavior pending rather than claiming
  exact current-page entry or uninterrupted virtual-cursor reading.
  Native macOS AXPress plus DOM-caret transfer passed during integration, but
  does not prove the VoiceOver cursor/speech hand-off. That manual check remains
  a release gate.
  See the [optional native regression command](../README.md#optional-native-macos-accessibility-regression).
- [ ] Use screenshots of the actual candidate, preferably with original synthetic
  books. If using the retained third-party sample screenshots, include
  [their attributions and licenses](ATTRIBUTIONS.md) with the listing. The existing
  generator is not an attribution-free asset pipeline.

## Dashboard and friends rollout

- [ ] Set the privacy policy URL to the [canonical GitHub policy](https://github.com/BCWalters/ambra/blob/main/store-assets/privacy-policy.md).
  Confirm it is readable without signing in. This Markdown file is the single
  source of truth; changes become live after an Ambra PR merges to `main`, with
  no separate website deployment. Keep the repository public and the path stable.
- [ ] Complete the listing and privacy disclosures using
  [store-listing.md](store-listing.md), including all three permissions and broad
  HTTP/HTTPS host access. Describe automatic imports and metadata requests
  accurately; do not assert that no data leaves the device.
- [ ] Set **Distribution → Visibility → Unlisted**, verify the intended regions,
  and save. Do not select Private (which requires a tester audience) or Public
  (which makes the listing discoverable). Review this setting before every
  submission; uploading a ZIP does not select visibility.
- [ ] Publish the initial Unlisted release manually in the dashboard. Google
  requires a manual publication after a visibility change before API publication
  can use that visibility. Use the workflow for packaging/draft uploads during
  setup, then enable API submission for subsequent updates.
- [ ] Submit for review and publish only after dashboard checks and owner approval,
  either in the dashboard or through the explicit unlisted-submission opt-in below.
  If creating a separate testing listing alongside production, follow Chrome's
  beta naming/description requirements.
- [ ] Confirm a fresh Chrome profile/account not on any tester list can install
  using the listing URL, and that the item is not publicly listed in search.
  Share the installation URL with friends after this check.
- [ ] Ask friends for the version, OS/Chrome version, settings, reproduction
  steps, and sanitized screenshots. Do not request private books or raw profiles.
  Stop rollout if imports lose data or reading/navigation regressions recur;
  retain the last known-good source and prepare a higher-version corrective
  update rather than attempting a lower-version store downgrade.

Reference: [Chrome's distribution and trusted-tester documentation](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution).
Builds must not change repository visibility. Store review submission requires
the separate explicit owner-approved submission action described below.

## Packaging and optional store automation

From the repository root with the CI Node/pnpm versions:

```sh
pnpm install --frozen-lockfile
node --test .github/scripts/release.test.mjs
node .github/scripts/package-extension.mjs
```

The production bundle is isolated at `dist/beta-release/extension/`; upload
`dist/beta-release/artifacts/ambra-<manifest-version>.zip`, not a ZIP of the
repository or of a dev server's output. The artifact directory also contains
`SHA256SUMS` and `release.json` recording version, source commit, and worktree
status. Reject a dirty candidate for release.
The ZIP includes `LICENSE`, `THIRD_PARTY_NOTICES.md`, and generated
`THIRD_PARTY_LICENSES.txt` with the installed production dependencies' license
texts. Version-pinned fallbacks are documented in [licenses/README.md](licenses/README.md);
missing notices fail packaging rather than silently omitting attribution.

CI exercises the isolated production bundle, including navigation, settings,
reading boundaries, native-position resume, and shell accessibility. Optional
real-book cases skip on a clean runner without the ignored external corpus.
A successful CI run does not
claim those external-book tests or live assistive-technology testing passed.
After packaging, run the same focused browser gate locally without rebuilding
over the candidate:

```sh
AMBRA_E2E_EXTENSION_PATH="$PWD/dist/beta-release/extension" \
  AMBRA_E2E_HEADLESS=1 pnpm --filter @ambra/e2e exec playwright test \
  book-opening.spec.ts navigation-correctness.spec.ts settings-focus.spec.ts \
  reader-viewport-stability.spec.ts content-boundary-navigation.spec.ts \
  native-reading-resume.spec.ts shell-accessibility-audit.spec.ts --workers=1
```

The [Unlisted Chrome Web Store beta release workflow](../.github/workflows/beta-release.yml)
is manually dispatched.
It becomes available in Actions after it is merged to the default branch.
Both inputs default to **false**:

| `upload_draft` | `publish_unlisted` | Effect |
| --- | --- | --- |
| false | false | Validate/package only; no store credentials |
| true | false | Upload the validated artifact to an existing item's draft; no review submission |
| true | true | Upload, then submit for review using the saved dashboard visibility |
| false | true | Rejected before building |

Credentialed actions run only on `main` after the release PR merges and require
the protected environment approval. Automation does not create a listing.
The [uploader](../.github/scripts/upload-draft.mjs) rejects dirty or mismatched
artifacts, non-increasing accepted versions, and active review/staged submissions.
These checks do not replace the dashboard Unlisted-visibility check.

### Unlisted submission and visibility limits

The [submitter](../.github/scripts/publish-unlisted.mjs) uses Chrome Web Store
API v2 and the visibility saved in the developer dashboard. It does not change
visibility or use the legacy trusted-testers API. There is no v1 sunset dependency.
The workflow uploads the validated draft first and rechecks item status before
submission. A failed or ambiguous submission is not automatically retried.

**The API cannot independently enforce Unlisted visibility.** Its published
state does not distinguish an unlisted item from a publicly listed item, and
draft visibility is not exposed. The explicit acknowledgment variable below
and required owner approval record a human dashboard check; they are not
programmatic proof of visibility. Check the saved **Unlisted** setting before
approving every credentialed run. If unsure, use package-only or draft-only mode
and submit manually after checking the dashboard.

The submitter requests review and blocks on warnings; it reports whether the
response is pending review, staged, or published. A successful request alone
does not prove that the item is installable or Unlisted. The item may become
installable automatically after approval. Confirm review status, Unlisted
visibility, and installation from the direct URL before sharing.
The workflow's publish opt-in is separate from its upload opt-in.

Google's [API guide](https://developer.chrome.com/docs/webstore/using-api#publish_an_item)
requires one manual publication after any dashboard visibility change. Merely
saving Unlisted and setting the acknowledgment variable is not sufficient to
establish new visibility for API publication.

Before allowing uploads, an owner must configure the
`chrome-web-store` GitHub environment with restricted deployment
branches limited to `main` and a required owner approval. For the current
sole-maintainer setup, allow the owner to approve their own deployment;
enable prevention of self-review when a second reviewer is available:

- Variables: `CWS_PUBLISHER_ID`, `CWS_EXTENSION_ID`, and
  `CWS_UNLISTED_VISIBILITY_CONFIRMED=true` (set only after checking the dashboard's
  saved Unlisted visibility).
- Environment secrets: `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, and
  `CWS_REFRESH_TOKEN`, authorized for the
  `https://www.googleapis.com/auth/chromewebstore` OAuth scope.

Keep credentials out of files, command-line arguments, issues, and logs. These
environment settings require owner action; committing the workflow does not
configure them. An acknowledgment variable is not proof of the dashboard's
actual visibility. Human dashboard review and the fresh-profile installation
check remain required even when uploading through CI.
Create the initial item in the developer dashboard and save Unlisted visibility
before enabling draft uploads. Follow the
[Chrome Web Store API setup guide](https://developer.chrome.com/docs/webstore/using-api)
for publisher/API authorization; this repository does not provision credentials.
OAuth consent apps left in external **Testing** status commonly receive refresh
tokens that expire after seven days. Check the consent configuration and token
lifetime before a release; replace expired credentials through GitHub environment
secrets, never repository files. This workflow uses OAuth client/refresh-token
credentials, not a service-account configuration.

## Later listed launch

When ready to appear in store search, disable the Unlisted acknowledgment variable,
switch dashboard visibility to **Public**, and publish that change manually.
Review the release workflow's policy and naming in a PR before automating listed
updates; do not leave an Unlisted acknowledgment on an intentionally Public item.

## Local audit baseline (2026-09-23)

Before these release-preparation changes, a local scan examined 282 reachable
commits, 1,740 historical file blobs, and 49 EPUB versions across 32 paths,
including archive contents and commit messages. It found no likely credentials,
private keys, tracked real-book downloads, or browser profiles. A credential-URL
match was synthetic test data. Subsequent primary-source review established the
screenshots' official sample licenses and Gutenberg source; the required
attributions and remaining jurisdiction caveat are recorded in
[ATTRIBUTIONS.md](ATTRIBUTIONS.md), superseding the initial unresolved assessment.

This was pattern-based local inspection plus fixture/asset review, not proof that
the repository is secret-free. It excludes inaccessible/deleted remote refs,
GitHub issues/PR attachments, Actions logs/artifacts, and account settings. Repeat
the relevant review for later changes and check those hosted surfaces before
changing visibility.
