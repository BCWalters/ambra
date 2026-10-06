export interface ReflowablePagePosition {
  spineIndex: number;
  pageIndex: number;
}

export interface ReflowableSpread {
  first: ReflowablePagePosition;
  second?: ReflowablePagePosition;
}

/**
 * Canonical pairs in the linear page sequence. Counts are requested lazily:
 * opening the beginning measures only its visible chapters; a distant seek
 * needs the preceding counts to determine parity, not the rest of the book.
 */
export class ReflowableSpreadPlanner {
  public constructor(
    private readonly count: (spineIndex: number) => Promise<number>,
    private readonly eligible: (spineIndex: number) => boolean,
    private readonly adjacentSpine: (index: number, direction: 1 | -1) => number | undefined =
      (index, direction) => index + direction,
  ) {}

  public async adjacent(
    position: ReflowablePagePosition,
    direction: 1 | -1,
  ): Promise<ReflowablePagePosition | undefined> {
    const pageIndex = position.pageIndex + direction;
    if (pageIndex >= 0 && pageIndex < (await this.count(position.spineIndex))) {
      return { spineIndex: position.spineIndex, pageIndex };
    }
    const spineIndex = this.adjacentSpine(position.spineIndex, direction);
    if (spineIndex === undefined || !this.eligible(spineIndex)) return undefined;
    return { spineIndex, pageIndex: direction === 1 ? 0 : (await this.count(spineIndex)) - 1 };
  }

  public async startingAt(first: ReflowablePagePosition): Promise<ReflowableSpread> {
    const second = await this.adjacent(first, 1);
    return { first, second: !this.eligible(first.spineIndex) && second?.spineIndex !== first.spineIndex
      ? undefined : second };
  }

  public async containing(position: ReflowablePagePosition): Promise<ReflowableSpread> {
    let offset = position.pageIndex;
    if (this.eligible(position.spineIndex)) {
      for (let i = this.adjacentSpine(position.spineIndex, -1);
        i !== undefined && this.eligible(i); i = this.adjacentSpine(i, -1)) {
        offset += await this.count(i);
      }
    }
    const first = offset % 2 === 0 ? position : ((await this.adjacent(position, -1)) ?? position);
    return this.startingAt(first);
  }

  public async turn(
    spread: ReflowableSpread,
    direction: 1 | -1,
  ): Promise<ReflowableSpread | undefined> {
    if (direction === 1) {
      const first = await this.adjacent(spread.second ?? spread.first, 1);
      return first ? this.startingAt(first) : undefined;
    }
    const second = await this.adjacent(spread.first, -1);
    if (!second) return undefined;
    const first = await this.adjacent(second, -1);
    return first ? { first, second } : { first: second };
  }
}
