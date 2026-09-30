export interface SrcsetUrlRange {
  readonly start: number;
  readonly end: number;
}

const SPACE = /[\t\n\f\r ]/;
const INTEGER = /^[0-9]+$/;
const FLOAT = /^-?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

function validDescriptors(descriptors: readonly string[]): boolean {
  let width = false;
  let density = false;
  let height = false;
  for (const descriptor of descriptors) {
    const suffix = descriptor.slice(-1);
    const value = descriptor.slice(0, -1);
    if (suffix === "w" && INTEGER.test(value) && Number(value) > 0 && !width && !density) {
      width = true;
    } else if (suffix === "x" && FLOAT.test(value) && Number(value) >= 0 &&
      !density && !width && !height) {
      density = true;
    } else if (suffix === "h" && INTEGER.test(value) && Number(value) > 0 && !height && !density) {
      height = true;
    } else {
      return false;
    }
  }
  return !height || width;
}

/** URL spans for candidates accepted by HTML's srcset parsing algorithm.
 * Keep offsets into the original attribute so rewriting leaves descriptors,
 * whitespace and rejected candidates unchanged for the browser.
 * https://html.spec.whatwg.org/multipage/images.html#parse-a-srcset-attribute */
export function srcsetUrlRanges(input: string): SrcsetUrlRange[] {
  const ranges: SrcsetUrlRange[] = [];
  let position = 0;
  while (position < input.length) {
    while (position < input.length && (SPACE.test(input[position]!) || input[position] === ",")) position++;
    if (position === input.length) break;
    const start = position;
    // Commas inside URLs (notably data URLs) are not candidate separators.
    while (position < input.length && !SPACE.test(input[position]!)) position++;
    let end = position;
    const descriptors: string[] = [];
    if (input[end - 1] === ",") {
      while (input[end - 1] === ",") end--;
    } else {
      let descriptor = "";
      let inParentheses = false;
      while (position < input.length) {
        const character = input[position++]!;
        if (inParentheses) {
          descriptor += character;
          if (character === ")") inParentheses = false;
        } else if (character === ",") {
          break;
        } else if (SPACE.test(character)) {
          if (descriptor) descriptors.push(descriptor);
          descriptor = "";
        } else {
          descriptor += character;
          if (character === "(") inParentheses = true;
        }
      }
      if (descriptor) descriptors.push(descriptor);
    }
    if (validDescriptors(descriptors)) {
      ranges.push({ start, end });
    } else {
      console.warn("Ignoring an invalid EPUB srcset candidate descriptor.");
    }
  }
  return ranges;
}
