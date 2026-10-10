# EPUB legacy and deprecated compatibility

This inventory separates modern EPUB 3.4 requirements from compatibility with
older publications. "Supported" describes the stated subset, not complete
EPUB Reading System conformance. The tracked implementation plan is
[#326](https://github.com/BCWalters/ambra/issues/326).

The navigation and Accessibility 1.2 additions below are merged in #357 and
protected-CI validated. Tours remain intentionally unsupported without a claimed
lawful real-corpus assessment. Regression success does not promote official
legacy criteria, which remain unassessed in the eleven-criterion profile.
The owner-approved closure sweep records explicit feature dispositions rather
than leaving an implementation issue open solely for release assessment. Final
pinned deprecated-test measurement remains under #326; it is not replaced by
the regression links in this inventory.

| Feature | Policy / status | Applicability and evidence |
| --- | --- | --- |
| Manifest content-document fallbacks | Supported for supported XHTML/SVG spine documents | Core behavior; [ContentLoader tests](../packages/engine/src/content/ContentLoader.test.ts). Subresource fallbacks are a separate milestone in #356; direct JPEG XL and nested-document limitations are retained in #411's disposition of #328. |
| IDPF font obfuscation | Supported | Retains identifier-based de-obfuscation before native font loading; [font tests](../packages/engine/src/encryption/FontDeobfuscator.test.ts). Not DRM support. |
| Adobe font obfuscation | Supported compatibility subset | [Font tests](../packages/engine/src/encryption/FontDeobfuscator.test.ts); do not infer general Adobe DRM support. |
| Legacy cover metadata | Supported | Legacy cover ID retained alongside current manifest cover-image handling; [package tests](../packages/engine/src/container/PackageDocument.test.ts). |
| OPF2 `meta name` / `content` | Supported generic retention | [Package tests](../packages/engine/src/container/PackageDocument.test.ts). Recognized accessibility keys now also feed structured claims; unknown values remain Inspector metadata rather than being interpreted as instructions. |
| NCX `navMap` / `pageList` | Supported | EPUB 3 Nav remains primary; [navigation tests](../packages/engine/src/navigation/NavigationDocument.test.ts). |
| Malformed or missing declared Nav to valid NCX | Supported | Explicit recovery diagnostic and localized reader notice, not a silent substitute; [navigation tests](../packages/engine/src/navigation/NavigationDocument.test.ts) and [versioned browser fixtures](../apps/e2e/tests/navigation-accessibility-conformance.spec.ts), tracked by #343. Unexpected runtime failures are not swallowed. |
| NCX `navList` / `navTarget` | Supported | Separate labeled disclosures, safe target classification and page-number lookup; same #343 fixtures. Valid modern Nav does not acquire duplicate NCX lists. |
| OPF2 guide | Supported | Fallback landmarks only when modern landmarks are absent; `text` maps to `bodymatter`, duplicate targets merge roles. Same #343 fixtures. |
| OPF2 tours | Intentionally unsupported | Superseded navigation, not a requirement for EPUB 3.4 content. No lawful corpus evidence currently justifies a new tour UI, and no real-corpus assessment is claimed. TOC and sequential reading remain independent. Actual affected-book evidence would justify a new focused compatibility issue; closure of #343 does not imply tours work. |
| Package collections | Intentionally unsupported interpretation | Optional package organization; source remains available in Inspector. No collection-driven reader behavior is promised. |
| `rendition:flow` | Intentionally unsupported author control | Outdated hint; reader-selected paginated/scroll behavior remains authoritative. Do not count ignored deprecated hints as current required-test failures. |
| `rendition:orientation` | Partially supported | Parsed and exposed, but does not lock browser/device orientation; [package tests](../packages/engine/src/container/PackageDocument.test.ts). |
| `rendition:spread`, including obsolete `portrait` | Supported documented subset | Ordered source processing and `portrait` interpreted as `both`; [package tests](../packages/engine/src/container/PackageDocument.test.ts) and spread regressions. |
| `rendition:align-x-center` | Intentionally unsupported interpretation | Outdated alignment hint, not an active modern renderer mode. |
| `rendition:viewport` | Supported fallback | Deprecated package-level intrinsic size fallback when the content document lacks its own viewport; [package tests](../packages/engine/src/container/PackageDocument.test.ts). |
| Legacy `-epub-*` CSS | Intentionally unsupported compatibility translation; native behavior unestablished | CSS resources are preserved/resolved, but no general prefix translation or prefix-specific native browser acceptance is claimed. Preserving a declaration does not establish that Chromium executes it. Explicit current CSS Writing Modes support is tracked separately by #333. |
| `xml:base` | Unsupported legacy resource-base interpretation | EPUB 3.4 discourages it because HTML/SVG are removing support. Separate from first-HTML-base processing under #336 ([native regressions](../apps/e2e/tests/html-base.spec.ts)); not automatically an additional current required-test failure. |
| Bindings and scripted foreign-resource handlers | Intentionally unsupported | No plugin or publisher-script execution. Supported static manifest fallbacks are processed; unsupported resources are reported. See #411's disposition of #328 and the separate non-scripted origin/fallback work in #338. |
| `epub:switch` / `epub:trigger` | Intentionally unsupported semantics | Removed/superseded constructs are not executed. Inert source markup can still render its ordinary children; branch-selection and trigger behavior are not promised. |
| Reserved/custom vocabulary prefixes | Partially supported | Known literal property names are interpreted; unknown metadata is retained. General custom-prefix expansion and vocabulary-driven behaviors are not claimed; [package tests](../packages/engine/src/container/PackageDocument.test.ts). |
| Old metadata-record link relations / `meta-auth` | Intentionally unsupported interpretation | Source is inspectable; no obsolete record authority workflow or external metadata retrieval is introduced. Source retention is not behavioral support. |
| `opf:role` / author-role refinements | Partially supported generic retention only | Generic metadata/refinements remain available ([package tests](../packages/engine/src/container/PackageDocument.test.ts)); first creator is displayed without full role semantics. No inferred authorship/certification or role-specific native acceptance. |
| DTBook | Partially supported manifest fallback only | Not a supported native spine format; a supported manifest fallback can be used. [ContentLoader tests](../packages/engine/src/content/ContentLoader.test.ts). Native DTBook rendering is intentionally unsupported. |
| OEB1 and HTML-syntax spine documents | Intentionally unsupported native formats | Legacy compatibility limitation. HTML-syntax content is **not** a missing EPUB 3.4 XHTML feature. |
| Adobe page-map | Intentionally unsupported | No proprietary page-map processing; standard EPUB page lists remain supported. |
| DRM and digital-signature verification | Intentionally unsupported | Font obfuscation is not encryption/DRM support; no certification or signature-validity claim. |

## Release assessment treatment

- Keep deprecated tests in the pinned worksheet and report them separately.
- An unsupported deprecated feature is not automatically a current required
  failure, but a failed legacy test remains visible as a failure.
- Optional-feature non-support must be explicit; do not convert expected
  required failures into `not-applicable`.
- Every supported subset above must retain its focused regression evidence.
  Prepared implementations are not passing official criteria.
- Revisit this inventory whenever resource, metadata, navigation or scripting
  policy changes. Preserve source inspection even when interpretation is
  intentionally unsupported.

## Closure disposition for navigation and vocabulary

- #343's prioritized modern recovery and useful EPUB2 navigation work is
  implemented: Nav-to-NCX diagnostics, auxiliary lists, guide landmarks, modern
  source priority and safe real target activation. #357's protected run
  `37529036440` supplies the existing package evidence. No new runtime change or
  new official criterion score is claimed by this documentation reconciliation.
- Tours and broader real-corpus legacy interpretation remain intentionally
  unsupported or unestablished as listed above. No copyrighted sample is needed
  or acquired merely to manufacture an assessment. New implementation needs
  lawful affected-book evidence or a clear interoperability requirement.
- #344's maintained policy is this table. Tests linked for supported subsets
  remain required regressions; source retention, partial support and omitted
  semantics cannot be promoted to full feature support.
- All 27 pinned deprecated criteria still require separate release assessment
  under #326. Unknown/not-run results remain unknown/not-run. Legacy failures
  remain visible and are not converted to current required passes or N/A solely
  because the implementation/policy issues are closed.
