# Icon source

`icon.svg` is the master vector source for the extension's toolbar/store icon
— an amber teardrop/gem shape (matching the "Ambra" name) on a dark
warm-brown rounded-square background, faceted with a few subtle internal
lines and a glint highlight for depth.

The three PNGs actually shipped in `../public/icons/` (`icon16.png`,
`icon48.png`, `icon128.png`) are rendered directly from this SVG at each
target resolution — not scaled down from a single larger raster — so
anti-aliasing stays crisp at every size Chrome uses (extension toolbar,
management page, Chrome Web Store listing).

## Regenerating the PNGs after editing `icon.svg`

This repo has no rendering/design tooling as a project dependency (kept
deliberately out of the dependency tree, per this project's "minimize
external dependencies" policy — icon generation is a one-off, not something
the app itself needs at build time). Regenerate using any SVG rasterizer
you have available, rendering **at each target pixel size directly**
(16×16, 48×48, 128×128), for example via a headless Chromium screenshot of
the SVG sized to that exact viewport, or a tool like `rsvg-convert`/
`resvg`/Inkscape's CLI export if installed locally:

```sh
# example using resvg, if installed:
resvg -w 16  -h 16  icon.svg ../public/icons/icon16.png
resvg -w 48  -h 48  icon.svg ../public/icons/icon48.png
resvg -w 128 -h 128 icon.svg ../public/icons/icon128.png
```
