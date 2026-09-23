# Verified upstream license fallbacks

These exact dependency versions omit a root license file from their installed
npm packages. The files here preserve their upstream MIT copyright and license
notices; they are not licensed as original Ambra material.

Verified on 2026-09-23 against each version's public npm registry metadata
(`gitHead`) and the corresponding immutable upstream commit:

| Package/version | Local license | Exact upstream source |
| --- | --- | --- |
| `@fluentui/react-icons@2.0.341` | [fluentui-react-icons-2.0.341-LICENSE.txt](fluentui-react-icons-2.0.341-LICENSE.txt) | [Microsoft commit `2e4da95009de778ae0f41ec6c17bc67c97f4dc56`](https://raw.githubusercontent.com/microsoft/fluentui-system-icons/2e4da95009de778ae0f41ec6c17bc67c97f4dc56/LICENSE) |
| `embla-carousel@8.6.0` | [embla-carousel-8.6.0-LICENSE.txt](embla-carousel-8.6.0-LICENSE.txt) | [Embla commit `0fe65834136f1aa35e4c1a4a477e5ccb4bb5ee54`](https://raw.githubusercontent.com/davidjerleke/embla-carousel/0fe65834136f1aa35e4c1a4a477e5ccb4bb5ee54/LICENSE) |
| `embla-carousel-autoplay@8.6.0` | Same Embla license | Same commit, independently confirmed from that package version's registry metadata |
| `embla-carousel-fade@8.6.0` | Same Embla license | Same commit, independently confirmed from that package version's registry metadata |

The release packager may use these fallbacks **only for the listed exact
versions**. For upgrades, first check whether the installed package includes its
license/NOTICE files; otherwise verify and add a new version-specific fallback.
Do not silently substitute a repository's latest license for a historical version.
Builds use these checked-in copies, not a live network fetch.

[`overrides.json`](overrides.json) maps each exact `name@version` to its local
license filename for the release packager.
