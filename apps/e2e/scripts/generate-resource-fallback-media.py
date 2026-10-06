"""Generate original geometric fonts and silent/solid-color codec fixtures for CI."""
import pathlib
import subprocess
import sys

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.t2CharStringPen import T2CharStringPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

target = pathlib.Path(sys.argv[1])
target.mkdir(parents=True, exist_ok=True)


def ffmpeg(*args):
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", *args],
        check=True,
        timeout=30,
    )


ffmpeg("-f", "lavfi", "-i", "color=c=green:s=32x24", "-frames:v", "1",
       "-threads", "1", str(target / "image.png"))
ffmpeg("-i", str(target / "image.png"), "-frames:v", "1", "-c:v", "libaom-av1",
       "-cpu-used", "8", "-still-picture", "1", str(target / "image.avif"))
subprocess.run(["cjxl", str(target / "image.png"), str(target / "image.jxl")],
               check=True, timeout=30)
ffmpeg("-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "2",
       "-c:a", "aac", str(target / "aac.mp4"))
ffmpeg("-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", "2",
       "-c:a", "libopus", str(target / "opus.mp4"))
ffmpeg("-f", "lavfi", "-i", "color=c=green:s=32x24:r=10:d=2", "-c:v", "libx264",
       "-pix_fmt", "yuv420p", str(target / "video.mp4"))


def rectangle(pen):
    pen.moveTo((100, 100))
    pen.lineTo((100, 900))
    pen.lineTo((900, 900))
    pen.lineTo((900, 100))
    pen.closePath()


for ttf in [True, False]:
    builder = FontBuilder(1000, isTTF=ttf)
    builder.setupGlyphOrder([".notdef", "A"])
    builder.setupCharacterMap({65: "A"})
    if ttf:
        glyphs = {}
        for name in [".notdef", "A"]:
            pen = TTGlyphPen(None)
            if name == "A":
                rectangle(pen)
            glyphs[name] = pen.glyph()
        builder.setupGlyf(glyphs)
    else:
        glyphs = {}
        for name in [".notdef", "A"]:
            pen = T2CharStringPen(1000, None)
            if name == "A":
                rectangle(pen)
            glyphs[name] = pen.getCharString()
        builder.setupCFF("AmbraSyntheticFallback", {}, glyphs, {})
    builder.setupHorizontalMetrics({".notdef": (1000, 0), "A": (1000, 0)})
    builder.setupHorizontalHeader(ascent=1000, descent=0)
    builder.setupNameTable({
        "familyName": "AmbraSyntheticFallback",
        "styleName": "Regular",
        "uniqueFontIdentifier": "ambra-synthetic-fallback-v1",
        "fullName": "AmbraSyntheticFallback",
        "psName": "AmbraSyntheticFallback",
    })
    builder.setupOS2(sTypoAscender=1000, sTypoDescender=0, usWinAscent=1000, usWinDescent=0)
    builder.setupPost()
    builder.save(target / ("font.ttf" if ttf else "font.otf"))
    if ttf:
        for flavor in ["woff", "woff2"]:
            builder.font.flavor = flavor
            builder.save(target / f"font.{flavor}")
