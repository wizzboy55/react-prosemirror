/**
 * A persistent map from document positions to node keys, sorted by position.
 *
 * Entries live in blocks whose positions are stored relative to a per-block
 * base, so shifting every entry after an edit only rewrites the bases, and a
 * new version shares every block the edit did not touch.
 */

const BLOCK_SIZE = 64;

interface Block {
  readonly pos: readonly number[];
  readonly keys: readonly string[];
}

export type KeyEntry = readonly [pos: number, key: string];

function blocksOf(entries: readonly KeyEntry[]): Block[] {
  const blocks: Block[] = [];
  for (let i = 0; i < entries.length; i += BLOCK_SIZE) {
    const chunk = entries.slice(i, i + BLOCK_SIZE);
    blocks.push({
      pos: chunk.map(([pos]) => pos),
      keys: chunk.map(([, key]) => key),
    });
  }
  return blocks;
}

export class KeyIndex {
  static readonly empty = new KeyIndex([], [], 0);

  private constructor(
    private readonly blocks: readonly Block[],
    private readonly bases: readonly number[],
    readonly size: number
  ) {}

  /** Builds an index from entries sorted by position, without duplicates. */
  static fromSorted(entries: readonly KeyEntry[]): KeyIndex {
    const blocks = blocksOf(entries);
    return new KeyIndex(
      blocks,
      blocks.map(() => 0),
      entries.length
    );
  }

  private first(block: number): number {
    return (
      (this.bases[block] as number) +
      ((this.blocks[block] as Block).pos[0] as number)
    );
  }

  private last(block: number): number {
    const { pos } = this.blocks[block] as Block;
    return (this.bases[block] as number) + (pos[pos.length - 1] as number);
  }

  /** Index of the last block starting at or before `pos`, or -1. */
  private blockAtOrBefore(pos: number): number {
    let lo = 0;
    let hi = this.blocks.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.first(mid) <= pos) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }

  get(pos: number): string | undefined {
    const b = this.blockAtOrBefore(pos);
    if (b < 0) return undefined;
    const block = this.blocks[b] as Block;
    const target = pos - (this.bases[b] as number);
    let lo = 0;
    let hi = block.pos.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const value = block.pos[mid] as number;
      if (value === target) return block.keys[mid];
      if (value < target) lo = mid + 1;
      else hi = mid - 1;
    }
    return undefined;
  }

  has(pos: number): boolean {
    return this.get(pos) !== undefined;
  }

  forEach(f: (pos: number, key: string) => void) {
    this.blocks.forEach((block, b) => {
      const base = this.bases[b] as number;
      block.pos.forEach((pos, i) => f(base + pos, block.keys[i] as string));
    });
  }

  /** Entries with `from <= pos < to`, sorted by position. */
  range(from: number, to: number): KeyEntry[] {
    const result: KeyEntry[] = [];
    let b = Math.max(this.blockAtOrBefore(from), 0);
    for (; b < this.blocks.length && this.first(b) < to; b++) {
      const block = this.blocks[b] as Block;
      const base = this.bases[b] as number;
      for (let i = 0; i < block.pos.length; i++) {
        const pos = base + (block.pos[i] as number);
        if (pos >= from && pos < to)
          result.push([pos, block.keys[i] as string]);
      }
    }
    return result;
  }

  /**
   * Returns a new index where the entries in `[from, to)` are replaced with
   * `middle` (sorted, all at or after `from`) and every entry at or after `to`
   * moves by `delta`. A `middle` entry that lands on a moved entry is dropped:
   * the moved entry wins, as it comes later in the old document.
   */
  splice(
    from: number,
    to: number,
    delta: number,
    middle: readonly KeyEntry[]
  ): KeyIndex {
    const blocks: Block[] = [];
    const bases: number[] = [];
    let size = 0;
    const push = (block: Block, base: number) => {
      if (!block.pos.length) return;
      blocks.push(block);
      bases.push(base);
      size += block.pos.length;
    };
    const pushEntries = (entries: readonly KeyEntry[]) => {
      for (const block of blocksOf(entries)) push(block, 0);
    };

    let b = 0;
    // Blocks entirely before `from` are shared as they are.
    while (b < this.blocks.length && this.last(b) < from) {
      push(this.blocks[b] as Block, this.bases[b] as number);
      b++;
    }
    // The block straddling `from` keeps its entries before it.
    const head: KeyEntry[] = [];
    const tail: KeyEntry[] = [];
    let firstMoved = Infinity;
    for (; b < this.blocks.length && this.first(b) < to; b++) {
      const block = this.blocks[b] as Block;
      const base = this.bases[b] as number;
      for (let i = 0; i < block.pos.length; i++) {
        const pos = base + (block.pos[i] as number);
        const key = block.keys[i] as string;
        if (pos < from) head.push([pos, key]);
        else if (pos >= to) tail.push([pos + delta, key]);
      }
    }
    if (tail.length) firstMoved = (tail[0] as KeyEntry)[0];
    else if (b < this.blocks.length) firstMoved = this.first(b) + delta;

    pushEntries(head);
    pushEntries(
      firstMoved === Infinity
        ? middle
        : middle.filter(([pos]) => pos < firstMoved)
    );
    pushEntries(tail);
    // Blocks entirely after `to` are shared; only their base moves.
    for (; b < this.blocks.length; b++) {
      push(this.blocks[b] as Block, (this.bases[b] as number) + delta);
    }

    const index = new KeyIndex(blocks, bases, size);
    // Edits leave small blocks behind; repack before they add up.
    return blocks.length > (size / BLOCK_SIZE) * 2 + 16
      ? index.repacked()
      : index;
  }

  /** Adds entries (sorted, at positions without an entry). */
  insert(entries: readonly KeyEntry[]): KeyIndex {
    if (entries.length > 32) {
      const all: KeyEntry[] = [];
      this.forEach((pos, key) => all.push([pos, key]));
      all.push(...entries);
      return KeyIndex.fromSorted(all.sort(([a], [b]) => a - b));
    }
    return entries.reduce<KeyIndex>(
      (index, entry) => index.splice(entry[0], entry[0], 0, [entry]),
      this
    );
  }

  private repacked(): KeyIndex {
    const entries: KeyEntry[] = [];
    this.forEach((pos, key) => entries.push([pos, key]));
    return KeyIndex.fromSorted(entries);
  }
}
