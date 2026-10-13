import { leafSegments } from "./motion.mjs";

export function createGutter() {
  const gutter = document.createElement("div");
  gutter.className = "spine";
  gutter.setAttribute("aria-hidden", "true");
  return gutter;
}

export function createLeaf({ book, base, moving, side, oldPages, newPages, page, content, curl }, rigid = false) {
  const sideName = side === 1 ? "right" : "left";
  const opposite = side === 1 ? "left" : "right";
  base.replaceChildren(page(oldPages[opposite], opposite), page(newPages[sideName], sideName), createGutter());
  const strips = Array.from({ length: rigid ? 1 : 32 }, () => {
    const strip = document.createElement("div");
    strip.className = "strip";
    const front = document.createElement("div");
    const back = document.createElement("div");
    front.className = "face front";
    back.className = "face back";
    front.append(content(oldPages[sideName]));
    back.append(content(newPages[opposite]));
    const shades = [front, back].map(face => {
      const shade = document.createElement("div");
      shade.className = "shade";
      face.append(shade);
      return shade;
    });
    strip.append(front, back);
    moving.append(strip);
    return { strip, front, back, shades };
  });
  return p => {
    const width = book.clientWidth / 2;
    leafSegments(p, width, strips.length, rigid ? 0 : curl()).forEach((segment, i) => {
      const { strip, front, back, shades } = strips[i];
      const left = width + side * segment.x - (side < 0 ? segment.width : 0);
      strip.style.width = `${segment.width + 0.25}px`;
      strip.style.left = `${left}px`;
      strip.style.transformOrigin = `${side > 0 ? "left" : "right"} center`;
      strip.style.transform = `translateZ(${segment.z}px) rotateY(${side * segment.angle}rad)`;
      strip.style.setProperty("--page-width", `${width}px`);
      const frontOffset = side > 0 ? segment.offset : width - segment.offset - segment.width;
      const backOffset = width - frontOffset - segment.width;
      front.firstElementChild.style.left = `${-frontOffset}px`;
      back.firstElementChild.style.left = `${-backOffset}px`;
      const shade = Math.sin(Math.PI * p) * (0.04 + 0.1 * i / strips.length);
      shades.forEach(element => { element.style.opacity = String(shade); });
    });
  };
}

function spread(pages, page) {
  const group = document.createElement("div");
  group.style.cssText = "position:absolute;inset:0";
  group.append(page(pages.left, "left"), page(pages.right, "right"));
  return group;
}

export function createSlide({ book, base, moving, side, oldPages, newPages, page }) {
  const outgoing = spread(oldPages, page);
  const incoming = spread(newPages, page);
  outgoing.append(createGutter());
  incoming.append(createGutter());
  base.replaceChildren(incoming);
  moving.append(outgoing);
  return p => {
    outgoing.style.transform = `translateX(${-side * p * book.clientWidth}px)`;
    outgoing.style.boxShadow = `${side * 14}px 0 30px #181d2238`;
  };
}

export function createFilmStrip({ book, base, moving, side, oldPages, newPages, page }) {
  const outgoing = spread(oldPages, page);
  const incoming = spread(newPages, page);
  outgoing.append(createGutter());
  incoming.append(createGutter());
  base.replaceChildren(incoming);
  moving.append(outgoing);
  return p => {
    outgoing.style.transform = `translateX(${-side * p * book.clientWidth}px)`;
    incoming.style.transform = `translateX(${side * (1 - p) * book.clientWidth}px)`;
  };
}
