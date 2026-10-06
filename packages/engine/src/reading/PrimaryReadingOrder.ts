import type { SpineItemRef } from "../container/PackageDocument.js";

type Spine = readonly Pick<SpineItemRef, "linear">[];

export function primarySpineIndices(spine: Spine): number[] {
  return spine.flatMap((item, index) => item.linear === false ? [] : [index]);
}

/** Keeps package indices intact, including when leaving an explicitly opened supplement. */
export function adjacentPrimarySpineIndex(
  spine: Spine,
  current: number,
  direction: 1 | -1,
): number | undefined {
  for (let index = current + direction; index >= 0 && index < spine.length; index += direction) {
    if (spine[index]!.linear !== false) return index;
  }
  return undefined;
}
