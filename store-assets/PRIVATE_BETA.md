# Private Chrome Web Store beta

The source repository may be public under MIT while the store listing remains
**Private**. This is a distribution choice, not an extra restriction on the
open-source license. **Unlisted is not private**: anyone with its URL can install.

## Before making the repository public

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
  Native macOS AXPress plus DOM-caret transfer passed during 2026-09-23
  integration, but does not prove the VoiceOver cursor/speech hand-off. That
  manual VoiceOver check remains the next-session gate, planned for 2026-09-24.
  See the [optional native regression command](../README.md#optional-native-macos-accessibility-regression).
- [ ] Use screenshots of the actual candidate, preferably with original synthetic
  books. If using the retained third-party sample screenshots, include
  [their attributions and licenses](ATTRIBUTIONS.md) with the listing. The existing
  generator is not an attribution-free asset pipeline.

## Dashboard and friends rollout

- [x] The corrected [HTML privacy policy](privacy-policy.html) was deployed through
  the personal site's PR #8 (merge `5a0c33f`), with the
  [hosted policy](https://victorious-forest-06eb42803.7.azurestaticapps.net/legal/ambra/privacy-policy.html)
  verified byte-for-byte against source on 2026-09-23. There is no current policy
  deployment blocker. Recheck after future edits: changing this repository alone
  does not deploy the hosted copy.
- [ ] Complete the listing and privacy disclosures using
  [store-listing.md](store-listing.md), including all three permissions and broad
  HTTP/HTTPS host access. Describe automatic imports and metadata requests
  accurately; do not assert that no data leaves the device.
- [ ] In the Chrome Web Store developer dashboard, configure the friends'
  Google Accounts as trusted testers. Inspect existing trusted testers and
  any configured Google Groups: they also determine the installation audience.
  Do not put friends' email addresses into this public repository.
- [ ] Set **Distribution → Visibility → Private**, verify the intended testers
  and regions, and save. Do not select Public or Unlisted. Review this setting
  again before every publication; uploading a ZIP does not select the audience.
- [ ] Submit for review and publish only after dashboard checks and owner approval,
  either in the dashboard or through the explicit trusted-tester opt-in below.
  If creating a separate testing listing alongside production, follow Chrome's
  beta naming/description requirements.
- [ ] Confirm an invited account can install using the listing URL and an
  uninvited account cannot. Share that URL privately only after the access check.
- [ ] Ask friends for the version, OS/Chrome version, settings, reproduction
  steps, and sanitized screenshots. Do not request private books or raw profiles.
  Stop rollout if imports lose data or reading/navigation regressions recur;
  retain the last known-good source and prepare a higher-version corrective
  update rather than attempting a lower-version store downgrade.

Reference: [Chrome's distribution and trusted-tester documentation](https://developer.chrome.com/docs/webstore/cws-dashboard-distribution).
Builds must not change repository visibility. Store review submission requires
the separate explicit owner-approved trusted-tester action described below.

## Packaging and optional store automation

From the repository root with the CI Node/pnpm versions:

```sh
pnpm install --frozen-lockfile
node --test .github/scripts/release.test.mjs
node .github/scripts/package-extension.mjs
```

The production bundle is isolated at `dist/private-release/extension/`; upload
`dist/private-release/artifacts/ambra-<manifest-version>.zip`, not a ZIP of the
repository or of a dev server's output. The artifact directory also contains
`SHA256SUMS` and `release.json` recording version, source commit, and worktree
status. Reject a dirty candidate for release.
The ZIP includes `LICENSE`, `THIRD_PARTY_NOTICES.md`, and generated
`THIRD_PARTY_LICENSES.txt` with the installed production dependencies' license
texts. Version-pinned fallbacks are documented in [licenses/README.md](licenses/README.md);
missing notices fail packaging rather than silently omitting attribution.

CI exercises the isolated production bundle. Its current browser selectors have
19 synthetic-fixture cases and two optional real-book cases; the latter skip on
a clean runner without the ignored external corpus. A successful CI run does not
claim those external-book tests or live assistive-technology testing passed.
After packaging, run the same focused browser gate locally without rebuilding
over the candidate:

```sh
AMBRA_E2E_EXTENSION_PATH="$PWD/dist/private-release/extension" \
  AMBRA_E2E_HEADLESS=1 pnpm --filter @ambra/e2e exec playwright test \
  book-opening.spec.ts navigation-correctness.spec.ts settings-focus.spec.ts \
  reader-viewport-stability.spec.ts --workers=1
```

The [Private Chrome Web Store release workflow](../.github/workflows/private-release.yml)
is manually dispatched.
It becomes available in Actions after it is merged to the default branch.
Both inputs default to **false**:

| `upload_draft` | `publish_trusted_testers` | Effect |
| --- | --- | --- |
| false | false | Validate/package only; no store credentials |
| true | false | Upload the validated artifact to an existing item's draft; no review submission |
| true | true | Upload, then explicitly submit to trusted testers for review while API v1 is supported |
| false | true | Rejected before building |

Credentialed actions run only on `main` after the release PR merges and require
the protected environment approval. Automation does not create a listing.
The [uploader](../.github/scripts/upload-private-draft.mjs) rejects dirty or
mismatched artifacts, non-increasing accepted versions, a public existing item,
and active review/staged submissions. These checks do not replace the dashboard
Private-audience check.

### Time-limited trusted-tester submission

The [trusted-tester submitter](../.github/scripts/publish-trusted-testers.mjs)
uses the [official API v1 publish method](https://developer.chrome.com/docs/webstore/api/v1)
with explicit `publishTarget=trustedTesters`, also sending
`target: "trustedTesters"` and `reviewExemption: false`. It never uses the
default/public target or silently falls back to v2. The workflow performs the
verified draft upload first, then rechecks item status and the deadline before
submission. A failed or ambiguous submission is not automatically retried.

**Disabled from 2026-10-15 00:00 UTC:** the workflow and submitter fail closed
at the [API v1 sunset](https://developer.chrome.com/blog/cws-api-v2).
After that, use the reviewed **Private** dashboard submission flow; draft upload
remains separate. V2 does not provide the same explicit trusted-tester audience
selection, so a default v2 publish call is not a safe replacement.

A successful API response means **submitted**, not approved or available.
API v1 submission can make the item available to testers automatically after
review approval; it is not merely staging a draft. Confirm review status,
Private visibility, and invited/uninvited installation behavior in the dashboard.
`CWS_PUBLISH_TRUSTED_TESTERS` is set by the workflow's explicit input, not an extra
secret or environment setup variable.

Before allowing uploads, an owner must configure the
`chrome-web-store` GitHub environment with restricted deployment
branches limited to `main` and a required owner approval. For the current
sole-maintainer setup, allow the owner to approve their own deployment;
enable prevention of self-review when a second reviewer is available:

- Variables: `CWS_PUBLISHER_ID`, `CWS_EXTENSION_ID`, and
  `CWS_PRIVATE_VISIBILITY_CONFIRMED=true` (set only after checking the dashboard's
  Private audience).
- Environment secrets: `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET`, and
  `CWS_REFRESH_TOKEN`, authorized for the
  `https://www.googleapis.com/auth/chromewebstore` OAuth scope.

Keep credentials out of files, command-line arguments, issues, and logs. These
environment settings require owner action; committing the workflow does not
configure them. An acknowledgment variable is not proof of the dashboard's
actual visibility. Human dashboard review and the invited/uninvited account
check remain required even when uploading through CI.
Create the initial item in the developer dashboard and configure its Private
audience before enabling draft uploads. Follow the
[Chrome Web Store API setup guide](https://developer.chrome.com/docs/webstore/using-api)
for publisher/API authorization; this repository does not provision credentials.
OAuth consent apps left in external **Testing** status commonly receive refresh
tokens that expire after seven days. Check the consent configuration and token
lifetime before a release; replace expired credentials through GitHub environment
secrets, never repository files. This workflow uses OAuth client/refresh-token
credentials, not a service-account configuration.

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
