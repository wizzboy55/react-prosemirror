import { Node } from "prosemirror-model";
import { EditorState, Plugin, PluginKey, Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

import { ReactWidgetType, widget } from "../decorations/ReactWidgetType.js";

import { KeyEntry, KeyIndex } from "./keyIndex.js";

let generateNodeKey = () =>
  Math.floor(Math.random() * 0xffffffffffff).toString(16);

export function createNodeKey() {
  return generateNodeKey();
}

/** Test hook: replaces the key generator; returns a function restoring it. */
export function setNodeKeyGenerator(generator: () => string) {
  const previous = generateNodeKey;
  generateNodeKey = generator;
  return () => {
    generateNodeKey = previous;
  };
}

export interface ReactKeysPluginState {
  posToKey: Map<number, string>;
  keyToPos: Map<string, number>;
  /** The key at `pos`, looked up without building `posToKey`. */
  keyAt(pos: number): string | undefined;
  cursorWrapper: Decoration | null;
  freezeFrom: number | null;
}

interface KeyMaps {
  posToKey?: Map<number, string>;
  keyToPos?: Map<string, number>;
}

class ReactKeysState implements ReactKeysPluginState {
  constructor(
    readonly index: KeyIndex,
    readonly cursorWrapper: Decoration | null,
    readonly freezeFrom: number | null,
    // Shared by states with the same index, built only when read.
    private readonly maps: KeyMaps = {}
  ) {}

  withMeta(cursorWrapper: Decoration | null, freezeFrom: number | null) {
    return new ReactKeysState(this.index, cursorWrapper, freezeFrom, this.maps);
  }

  keyAt(pos: number) {
    return this.index.get(pos);
  }

  get posToKey() {
    if (!this.maps.posToKey) {
      const map = new Map<number, string>();
      this.index.forEach((pos, key) => map.set(pos, key));
      this.maps.posToKey = map;
    }
    return this.maps.posToKey;
  }

  get keyToPos() {
    if (!this.maps.keyToPos) {
      const map = new Map<string, number>();
      this.index.forEach((pos, key) => map.set(key, pos));
      this.maps.keyToPos = map;
    }
    return this.maps.keyToPos;
  }
}

export const reactKeysPluginKey = new PluginKey<ReactKeysPluginState>(
  "@handlewithcare/react-prosemirror/reactKeys"
);

export type ReactKeysPluginMeta =
  | {
      overrides?: Record<number, number>;
      cursorWrapper?: Decoration | null;
      freezeFrom?: number | null;
    }
  | undefined;

export interface ReactKeysOptions {
  /**
   * A state whose keys carry over to the state this plugin first initializes
   * in, so replacing the whole state does not remount unchanged nodes.
   */
  keysFrom?: EditorState;
}

function keyEveryNode(doc: Node): KeyIndex {
  const entries: KeyEntry[] = [];
  doc.descendants((_, pos) => {
    entries.push([pos, createNodeKey()]);
    return true;
  });
  return KeyIndex.fromSorted(entries);
}

type Range = [from: number, to: number];

/**
 * Maps the keys through the transaction exactly as mapping every position did,
 * but only touches the entries inside the changed range: every position before
 * it maps to itself and every position after it moves by the size change.
 * Then keys the node starts that only the changed regions can have introduced.
 */
function mapIndex(
  index: KeyIndex,
  tr: Transaction,
  overrides: Record<number, number> | undefined
): KeyIndex {
  let from = Infinity;
  let to = -Infinity;
  let delta = 0;
  // Changed regions in the new document, for keying new node starts.
  const walks: Range[] = [];
  tr.mapping.maps.forEach((map, i) => {
    let mapped = false;
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      mapped = true;
      from = Math.min(from, oldStart);
      // `delta` holds the earlier steps' size change here.
      to = Math.max(to, oldEnd - delta);
      walks.push(forward(tr, i + 1, newStart, newEnd));
    });
    map.forEach((oldStart, oldEnd, newStart, newEnd) => {
      delta += newEnd - newStart - (oldEnd - oldStart);
    });
    if (mapped) return;
    // A step that moves no position can still split or join text nodes
    // (marks); one that names no range is walked in full.
    const step = tr.steps[i] as unknown as Record<string, unknown>;
    if (typeof step.from === "number" && typeof step.to === "number") {
      walks.push(forward(tr, i + 1, step.from, step.to));
    } else if (typeof step.pos !== "number") {
      walks.push([0, tr.doc.content.size]);
    }
  });
  for (const key in overrides) {
    const pos = Number(key);
    from = Math.min(from, pos);
    to = Math.max(to, pos + 1);
  }

  let next = index;
  const moved = new Map<number, string>();
  if (from !== Infinity) {
    for (const [pos, key] of index.range(from, to)) {
      const override = overrides?.[pos];
      const { pos: newPos, deleted } =
        override === undefined
          ? tr.mapping.mapResult(pos)
          : { pos: override, deleted: false };
      if (deleted) continue;
      // A later old position wins a collision, as in a full remap.
      moved.set(newPos, key);
    }
  }
  const end = to + delta;
  const hasKey = (pos: number) =>
    from === Infinity || pos < from
      ? index.has(pos)
      : moved.has(pos) || (pos >= end && index.has(pos - delta));

  const unkeyed = new Set<number>();
  const size = tr.doc.content.size;
  for (const [start, end] of walks) {
    // Include a node starting right at the end: a split text node does.
    const a = Math.max(0, Math.min(start, size));
    const b = Math.min(size, Math.max(end + 1, a + 1));
    tr.doc.nodesBetween(a, b, (_, pos) => {
      if (pos >= a && !hasKey(pos)) unkeyed.add(pos);
      return true;
    });
  }
  // Keys are created in document order, as a full walk would.
  const added = new Map<number, string>();
  for (const pos of [...unkeyed].sort((a, b) => a - b)) {
    added.set(pos, createNodeKey());
  }

  const inRange = (pos: number) =>
    from !== Infinity && pos >= from && pos <= end;
  if (from !== Infinity) {
    const middle = [...moved];
    for (const entry of added) {
      if (inRange(entry[0])) middle.push(entry);
    }
    next = next.splice(
      from,
      to,
      delta,
      middle.sort(([a], [b]) => a - b)
    );
  }
  // New keys outside the remapped range, from steps that moved nothing.
  const outside = [...added].filter(([pos]) => !inRange(pos));
  return outside.length ? next.insert(outside.sort(([a], [b]) => a - b)) : next;
}

/** Maps a range from step `step`'s output to the transaction's final document. */
function forward(tr: Transaction, step: number, start: number, end: number) {
  if (step >= tr.mapping.maps.length) return [start, end] as Range;
  const rest = tr.mapping.slice(step);
  return [rest.map(start, -1), rest.map(end, 1)] as Range;
}

/**
 * Carries keys from `prevDoc` to `doc` for a state replacement: nodes pair up
 * along matching paths, an unchanged subtree keeps every key inside it, and a
 * changed node of the same type keeps its own key.
 */
function transferIndex(prevDoc: Node, prev: KeyIndex, doc: Node): KeyIndex {
  const entries = new Map<number, string>();

  function pair(prevNode: Node, prevPos: number, node: Node, pos: number) {
    const key = prev.get(prevPos);
    if (key !== undefined) entries.set(pos, key);
    if (node.isLeaf) return;
    if (prevNode === node || prevNode.eq(node)) {
      const end = prevPos + prevNode.nodeSize;
      for (const [p, k] of prev.range(prevPos + 1, end)) {
        entries.set(p - prevPos + pos, k);
      }
      return;
    }
    pairChildren(prevNode, prevPos + 1, node, pos + 1);
  }

  function pairChildren(
    prevParent: Node,
    prevStart: number,
    parent: Node,
    start: number
  ) {
    const prevPositions: number[] = [];
    prevParent.forEach((_, offset) => prevPositions.push(prevStart + offset));
    const positions: number[] = [];
    parent.forEach((_, offset) => positions.push(start + offset));
    const same = (i: number, j: number) => {
      const a = prevParent.child(i);
      const b = parent.child(j);
      return a === b || a.eq(b);
    };
    const pairAt = (i: number, j: number) =>
      pair(
        prevParent.child(i),
        prevPositions[i] as number,
        parent.child(j),
        positions[j] as number
      );

    let i = 0;
    let j = 0;
    let iEnd = prevParent.childCount;
    let jEnd = parent.childCount;
    while (i < iEnd && j < jEnd && same(i, j)) pairAt(i++, j++);
    while (iEnd > i && jEnd > j && same(iEnd - 1, jEnd - 1)) {
      pairAt(--iEnd, --jEnd);
    }
    // In between, skip a few inserted or removed children to reach an
    // unchanged one; otherwise pair changed children of the same type.
    const LOOKAHEAD = 8;
    while (i < iEnd && j < jEnd) {
      if (same(i, j)) {
        pairAt(i++, j++);
        continue;
      }
      let skip = 0;
      for (let k = 1; k <= LOOKAHEAD && !skip; k++) {
        if (j + k < jEnd && same(i, j + k)) skip = k;
        else if (i + k < iEnd && same(i + k, j)) skip = -k;
      }
      if (skip > 0) {
        j += skip;
      } else if (skip < 0) {
        i -= skip;
      } else {
        if (prevParent.child(i).type === parent.child(j).type) pairAt(i, j);
        i++;
        j++;
      }
    }
  }

  pairChildren(prevDoc, 0, doc, 0);
  doc.descendants((_, pos) => {
    if (!entries.has(pos)) entries.set(pos, createNodeKey());
    return true;
  });
  return KeyIndex.fromSorted([...entries].sort(([a], [b]) => a - b));
}

/**
 * Tracks a unique key for each (non-text) node in the
 * document, identified by its current position. Keys are
 * (mostly) stable across transaction applications. The
 * key for a given node can be accessed by that node's
 * current position in the document, and vice versa.
 */
export function reactKeys(options: ReactKeysOptions = {}) {
  let keysFrom = options.keysFrom;
  return new Plugin({
    key: reactKeysPluginKey,
    state: {
      init(_, state) {
        const prev = keysFrom && reactKeysPluginKey.getState(keysFrom);
        const index =
          keysFrom && prev instanceof ReactKeysState
            ? transferIndex(keysFrom.doc, prev.index, state.doc)
            : keyEveryNode(state.doc);
        // Only the first state this plugin initializes in inherits keys.
        keysFrom = undefined;
        return new ReactKeysState(index, null, null);
      },
      /**
       * Keeps node keys stable across transactions.
       *
       * To accomplish this, we map each node position forwards
       * through the transaction to identify its current position,
       * and assign its key to that new position, dropping it if the
       * node was deleted.
       */
      apply(tr, value, oldState, newState) {
        const meta = tr.getMeta(reactKeysPluginKey) as ReactKeysPluginMeta;

        const overrides = meta && "overrides" in meta ? meta.overrides : {};

        const cursorWrapper =
          meta && "cursorWrapper" in meta ? meta.cursorWrapper : undefined;

        const freezeFrom =
          meta && "freezeFrom" in meta ? meta.freezeFrom : undefined;

        let nextCursorWrapper =
          cursorWrapper === undefined
            ? value.cursorWrapper
              ? widget(
                  tr.mapping.map(value.cursorWrapper.from, -1),
                  (
                    value.cursorWrapper as Decoration & {
                      type: ReactWidgetType;
                    }
                  ).type.Component,
                  value.cursorWrapper.spec
                )
              : null
            : cursorWrapper;
        let nextFreezeFrom =
          freezeFrom === undefined
            ? value.freezeFrom !== null
              ? tr.mapping.map(value.freezeFrom, -1)
              : null
            : freezeFrom;

        if (
          value.freezeFrom !== null &&
          nextFreezeFrom !== null &&
          tr.getMeta("composition") == null
        ) {
          const oldBlock = oldState.doc.nodeAt(value.freezeFrom);
          const newBlock = newState.doc.nodeAt(nextFreezeFrom);
          if (newBlock && !oldBlock?.eq(newBlock)) {
            nextFreezeFrom = null;
            nextCursorWrapper = null;
          }
        }

        const prev =
          value instanceof ReactKeysState
            ? value
            : new ReactKeysState(keyEveryNode(oldState.doc), null, null);
        if (!tr.docChanged) {
          return prev.withMeta(
            nextCursorWrapper ?? null,
            nextFreezeFrom ?? null
          );
        }
        return new ReactKeysState(
          mapIndex(prev.index, tr, overrides),
          nextCursorWrapper ?? null,
          nextFreezeFrom ?? null
        );
      },
    },
    props: {
      decorations(state) {
        const deco = reactKeysPluginKey.getState(state)?.cursorWrapper;

        if (!deco) return DecorationSet.empty;

        return DecorationSet.create(state.doc, [deco]);
      },
    },
  });
}
