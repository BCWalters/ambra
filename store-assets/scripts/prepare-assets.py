#!/usr/bin/env python3
"""Generate original demo EPUBs, the padded store icon, and the promo tile.

Uses the existing Pillow installation; never starts a browser or builds Ambra.
"""
from io import BytesIO
import argparse
import json
from pathlib import Path
import textwrap
from xml.etree import ElementTree
from xml.sax.saxutils import escape
import zipfile

from PIL import Image, ImageDraw, ImageFont

ASSETS = Path(__file__).resolve().parents[1]
ROOT = ASSETS.parent
GENERATED = ASSETS / ".generated"
BOOKS = [
    ("quiet-observatory", "The Quiet Observatory", "#163944", "#edb65b",
     "A Window for the Sky",
     "An original Ambra demonstration story about a small observatory, patient observation, and the things we notice together."),
    ("small-wonders", "Small Wonders", "#3f5747", "#ead7a6",
     "The Map in a Leaf",
     "An original Ambra demonstration field journal about paying attention to ordinary places."),
    ("floating-garden", "The Floating Garden", "#533b50", "#eab2a1",
     "A Garden between Shores",
     "An original Ambra demonstration story about a garden built on a raft and the people who care for it."),
]
PARAGRAPHS = [
    "At the edge of the village stood a small observatory with a green door. Nobody remembered who had painted it, but each spring someone left a new pot of paint on the step. The door stayed green, the hinges stayed quiet, and the telescope kept its patient watch over the valley.",
    "Mara arrived before sunset with a notebook and two oranges. She placed the fruit beside the window and opened to a clean page. Tonight she was not looking for a discovery. She wanted to learn the shape of waiting: the way the last light settled on the hills, the way a room grew larger when nobody spoke.",
    "The first visitor was a boy carrying a paper map. He had drawn the river as a blue ribbon and the railway as a ladder. Above the village he had left a wide, empty square. That was where the sky belonged, he explained, but he had not decided how to draw something that changed whenever he looked away.",
    "They took the map outside. A breeze lifted one corner, then let it fall. Mara suggested that an unfinished map might be useful. It could remind its reader to look up. The boy considered this, turned the paper over, and drew a small window on the back.",
    "As darkness arrived, lights appeared along the river. Each reflection made a second village, a little less certain than the first. From the observatory steps, the two villages seemed equally real. One could be walked through; the other could only be watched.",
    "A neighbour brought a kettle, and another brought a chair with one short leg. They folded a scrap of cardboard beneath it. By the time the first star showed itself, the observatory had become a place where everyone had contributed something small enough to carry.",
    "Through the telescope, the moon looked less like a lamp and more like a landscape. Shadows gathered in its hollows. A bright ridge ran across the edge of a crater. The boy asked whether a person standing there would find their village, and Mara said that perhaps the sea would be easier to recognise.",
    "Later, when the visitors had gone, she wrote a single sentence in her notebook: A good window does not tell you what to see. It gives you somewhere to begin. She left the book open beside the oranges and closed the green door without a sound.",
]


def font(size, bold=False):
    candidates = [
        Path("/System/Library/Fonts/Supplemental") / ("Arial Bold.ttf" if bold else "Arial.ttf"),
        Path("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf"),
    ]
    for candidate in candidates:
        try:
            return ImageFont.truetype(str(candidate), size)
        except OSError:
            continue
    raise RuntimeError("An existing Arial or DejaVu Sans font is required; no font is downloaded.")


def png(image):
    data = BytesIO()
    image.save(data, format="PNG", optimize=True)
    return data.getvalue()


def cover(title, background, accent):
    image = Image.new("RGB", (600, 900), background)
    draw = ImageDraw.Draw(image)
    draw.ellipse((335, 82, 487, 234), fill=accent)
    for offset in range(4):
        y = 440 + offset * 47
        draw.arc((-110, y - 300, 730, y + 280), 185, 345, fill=accent, width=3)
    y = 90
    for line in textwrap.wrap(title, width=15):
        draw.text((55, y), line, font=font(48, True), fill="#fff9ed")
        y += 60
    draw.line((55, 690, 545, 690), fill=accent, width=2)
    draw.text((55, 726), "AMBRA SAMPLE STUDIO", font=font(23, True), fill="#fff9ed")
    draw.text((55, 770), "An original demonstration book", font=font(22), fill=accent)
    return png(image)


def make_epub(slug, title, background, accent, chapter, description):
    paragraphs = PARAGRAPHS if slug == "quiet-observatory" else [
        f"{description} This small sample is made for exploring a local reading library, without importing a personal book.",
        "A notebook can hold an observation without deciding what it means. Leave a little space beside each sentence. The next visit may add a detail, a question, or a completely different beginning.",
        "Look closely at something ordinary: a leaf, a window, a bridge after rain. Follow one line from its beginning to its end. Notice where it changes direction and where it meets another line.",
    ]
    css = "body{font-family:serif;line-height:1.55}h1{font-weight:normal;line-height:1.2;margin-bottom:1em}p{margin:0 0 .9em}.eyebrow{font-family:sans-serif;letter-spacing:.12em;font-size:.7em;text-transform:uppercase;color:#68716c}"
    content = (
        '<?xml version="1.0" encoding="utf-8"?>'
        '<html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head>'
        f'<title>{escape(chapter)}</title><link rel="stylesheet" href="styles.css"/>'
        f'</head><body><p class="eyebrow">{escape(title)}</p><h1>{escape(chapter)}</h1>'
        + "".join(f'<p id="passage-{i}">{escape(p)}</p>' for i, p in enumerate(paragraphs, 1))
        + '</body></html>'
    )
    entries = {
        "mimetype": b"application/epub+zip",
        "META-INF/container.xml": b'<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
        "EPUB/package.opf": f'''<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="book-id">urn:ambra:store-demo:{slug}:1</dc:identifier>
<dc:title>{escape(title)}</dc:title><dc:creator>Ambra Sample Studio</dc:creator>
<dc:language>en</dc:language><dc:description>{escape(description)}</dc:description>
<dc:rights>Original Ambra demonstration text and artwork. MIT License.</dc:rights>
<meta property="dcterms:modified">2026-09-24T00:00:00Z</meta>
</metadata><manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
<item id="style" href="styles.css" media-type="text/css"/>
<item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/>
</manifest><spine><itemref idref="chapter"/></spine></package>'''.encode(),
        "EPUB/nav.xhtml": f'<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en"><head><title>Contents</title></head><body><nav epub:type="toc"><h1>Contents</h1><ol><li><a href="chapter.xhtml">{escape(chapter)}</a></li></ol></nav></body></html>'.encode(),
        "EPUB/chapter.xhtml": content.encode(),
        "EPUB/styles.css": css.encode(),
        "EPUB/cover.png": cover(title, background, accent),
    }
    destination = GENERATED / f"{slug}.epub"
    with zipfile.ZipFile(destination, "w") as archive:
        for name, data in entries.items():
            info = zipfile.ZipInfo(name, date_time=(2026, 9, 24, 0, 0, 0))
            info.compress_type = zipfile.ZIP_STORED if name == "mimetype" else zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, data)
    with zipfile.ZipFile(destination) as archive:
        assert archive.testzip() is None
        assert archive.infolist()[0].filename == "mimetype"
        assert archive.infolist()[0].compress_type == zipfile.ZIP_STORED
        for name in archive.namelist():
            if name.endswith((".xml", ".opf", ".xhtml")):
                ElementTree.fromstring(archive.read(name))


def store_icon(original):
    original = original.convert("RGBA")
    assert original.size == (128, 128)
    if original.getchannel("A").getbbox() == (16, 16, 112, 112):
        return original.copy()
    padded = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    padded.alpha_composite(original.resize((96, 96), Image.Resampling.LANCZOS), (16, 16))
    assert padded.getchannel("A").getbbox() == (16, 16, 112, 112)
    return padded


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--update-extension-icon", action="store_true",
                        help="Also synchronize the packaged 128px icon; leave 16px/48px unchanged.")
    args = parser.parse_args()
    GENERATED.mkdir(exist_ok=True)
    original = Image.open(ROOT / "apps/extension/public/icons/icon128.png").convert("RGBA")
    padded = store_icon(original)
    padded.save(ASSETS / "icon-store-128.png", optimize=True)
    if args.update_extension_icon:
        padded.save(ROOT / "apps/extension/public/icons/icon128.png", optimize=True)

    promo = Image.new("RGB", (440, 280), "#173a43")
    draw = ImageDraw.Draw(promo)
    draw.ellipse((280, -150, 590, 160), fill="#244c53")
    draw.arc((-140, 245, 520, 625), 185, 350, fill="#bd934c", width=2)
    artwork = padded.crop((16, 16, 112, 112))
    promo.paste(artwork, (28, 87), artwork)
    draw.text((148, 86), "Ambra", font=font(44, True), fill="#fff6e5")
    draw.text((150, 148), "Read. Annotate.", font=font(22), fill="#efd9ad")
    draw.text((150, 181), "Explore your EPUBs.", font=font(21), fill="#efd9ad")
    promo.save(ASSETS / "promo-tile-440x280.png", optimize=True)

    for book in BOOKS:
        make_epub(*book)
    (GENERATED / "books.json").write_text(json.dumps([
        {"file": f"{book[0]}.epub", "title": book[1]} for book in BOOKS
    ], indent=2) + "\n")
    print("Prepared 3 original demo EPUBs, padded store icon, and 440x280 promo. No browser started.")


if __name__ == "__main__":
    main()
