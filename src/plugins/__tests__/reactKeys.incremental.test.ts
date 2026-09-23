/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Fragment, Node, Schema, Slice } from "prosemirror-model";
import {
  EditorState,
  Plugin,
  PluginKey,
  TextSelection,
  Transaction,
} from "prosemirror-state";
import { findWrapping, liftTarget } from "prosemirror-transform";

import { reorderSiblingsOnTransaction } from "../../commands/reorderSiblings.js";
import {
  ReactKeysPluginMeta,
  reactKeys,
  reactKeysPluginKey,
  setNodeKeyGenerator,
} from "../reactKeys.js";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "inline*" },
    quote: { group: "block", content: "block+" },
    list: { group: "block", content: "item+" },
    item: { content: "paragraph+" },
    image: { group: "inline", inline: true },
    text: { group: "inline" },
  },
  marks: { strong: {}, em: {} },
});

// The reactKeys state mapping as released in v3.2.5, kept as the reference.
const referenceKey = new PluginKey<{
  posToKey: Map<number, string>;
  keyToPos: Map<string, number>;
}>("reference-react-keys");

function referenceKeys(createKey: () => string) {
  return new Plugin({
    key: referenceKey,
    state: {
      init(_, state) {
        const next = {
          posToKey: new Map<number, string>(),
          keyToPos: new Map<string, number>(),
        };
        state.doc.descendants((_, pos) => {
          const key = createKey();
          next.posToKey.set(pos, key);
          next.keyToPos.set(key, pos);
          return true;
        });
        return next;
      },
      apply(tr, value, _, newState) {
        const meta = tr.getMeta(reactKeysPluginKey) as ReactKeysPluginMeta;
        const overrides = meta && "overrides" in meta ? meta.overrides : {};
        if (!tr.docChanged) return value;
        const next = {
          posToKey: new Map<number, string>(),
          keyToPos: new Map<string, number>(),
        };
        const entries = Array.from(value.posToKey.entries()).sort(
          ([a], [b]) => a - b
        );
        for (const [pos, key] of entries) {
          const override = overrides?.[pos];
          const { pos: newPos, deleted } =
            override === undefined
              ? tr.mapping.mapResult(pos)
              : { pos: override, deleted: false };
          if (deleted) continue;
          next.posToKey.set(newPos, key);
          next.keyToPos.set(key, newPos);
        }
        newState.doc.descendants((_, pos) => {
          if (next.posToKey.has(pos)) return true;
          const key = createKey();
          next.posToKey.set(pos, key);
          next.keyToPos.set(key, pos);
          return true;
        });
        return next;
      },
    },
  });
}

function counter(prefix: string) {
  let n = 0;
  return () => `${prefix}${n++}`;
}

function sortedEntries(map: Map<number, string>) {
  return Array.from(map.entries()).sort(([a], [b]) => a - b);
}

function randomText(random: () => number) {
  const words = ["a", "bb", "abc", "x y", "zz"];
  return words[Math.floor(random() * words.length)]!;
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function initialDoc() {
  const p = (text: string) =>
    schema.node("paragraph", null, [schema.text(text)]);
  return schema.node("doc", null, [
    p("one two"),
    schema.node("quote", null, [p("quoted"), p("text")]),
    schema.node("list", null, [
      schema.node("item", null, [p("first")]),
      schema.node("item", null, [p("second"), p("more")]),
    ]),
    schema.node("paragraph", null, [
      schema.text("mixed "),
      schema.node("image"),
      schema.text("inline", [schema.marks.strong.create()]),
    ]),
    p("last"),
  ]);
}

// Builds a random transaction; returns null when the edit does not apply.
function randomEdit(
  state: EditorState,
  random: () => number
): Transaction | null {
  const tr = state.tr;
  const steps = 1 + Math.floor(random() * 3);
  for (let s = 0; s < steps; s++) {
    const size = tr.doc.content.size;
    const pos = Math.floor(random() * (size + 1));
    const $pos = tr.doc.resolve(pos);
    try {
      switch (Math.floor(random() * 10)) {
        case 0:
        case 1:
          if ($pos.parent.inlineContent) tr.insertText(randomText(random), pos);
          break;
        case 2: {
          const end = Math.min(size, pos + Math.floor(random() * 6));
          tr.delete(pos, end);
          break;
        }
        case 3:
          if ($pos.parent.inlineContent && $pos.depth > 0) tr.split(pos);
          break;
        case 4:
          if (
            pos > 0 &&
            pos < size &&
            tr.doc.resolve(pos).nodeBefore &&
            tr.doc.resolve(pos).nodeAfter
          ) {
            tr.join(pos);
          }
          break;
        case 5: {
          const end = Math.min(size, pos + 1 + Math.floor(random() * 8));
          tr.addMark(pos, end, schema.marks.em.create());
          break;
        }
        case 6: {
          const end = Math.min(size, pos + 1 + Math.floor(random() * 8));
          tr.removeMark(pos, end, schema.marks.strong);
          break;
        }
        case 7: {
          const range = $pos.blockRange();
          if (!range) break;
          const target = liftTarget(range);
          if (target != null) tr.lift(range, target);
          else {
            const wrapping = findWrapping(range, schema.nodes.quote);
            if (wrapping) tr.wrap(range, wrapping);
          }
          break;
        }
        case 8: {
          const end = Math.min(size, pos + Math.floor(random() * 10));
          tr.replace(
            pos,
            end,
            new Slice(
              Fragment.from(
                schema.node("paragraph", null, [schema.text("new")])
              ),
              0,
              0
            )
          );
          break;
        }
        default:
          if ($pos.parent.inlineContent) {
            tr.replaceWith(pos, pos, schema.node("image"));
          }
      }
    } catch {
      // Not every random edit fits the schema; try the next one.
    }
  }
  return tr.docChanged ? tr : null;
}

function stateWith(plugin: Plugin, doc: Node) {
  return EditorState.create({ doc, plugins: [plugin] });
}

function replay(tr: Transaction, state: EditorState) {
  const copy = state.tr;
  tr.steps.forEach((step) => copy.step(step));
  const meta = tr.getMeta(reactKeysPluginKey);
  if (meta) copy.setMeta(reactKeysPluginKey, meta);
  return state.apply(copy);
}

describe("reactKeys incremental mapping", () => {
  it("matches the full remap for random edits", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const random = mulberry32(seed);
      const restore = setNodeKeyGenerator(counter("k"));
      let actual = stateWith(reactKeys(), initialDoc());
      let expected = stateWith(referenceKeys(counter("k")), initialDoc());
      try {
        for (let round = 0; round < 60; round++) {
          const tr = randomEdit(actual, random);
          if (!tr) continue;
          actual = actual.apply(tr);
          expected = replay(tr, expected);
          expect(actual.doc.eq(expected.doc)).toBe(true);
          const a = sortedEntries(
            reactKeysPluginKey.getState(actual)!.posToKey
          );
          const e = sortedEntries(referenceKey.getState(expected)!.posToKey);
          if (
            process.env.DEBUG_KEYS &&
            JSON.stringify(a) !== JSON.stringify(e)
          ) {
            // eslint-disable-next-line no-console
            console.log({
              seed,
              round,
              steps: tr.steps.map((st) => st.toJSON()),
            });
          }
          expect(a).toEqual(e);
        }
      } finally {
        restore();
      }
    }
  });

  it("matches the full remap for reordered siblings", () => {
    const restore = setNodeKeyGenerator(counter("k"));
    try {
      let actual = stateWith(reactKeys(), initialDoc());
      let expected = stateWith(referenceKeys(counter("k")), initialDoc());
      reorderSiblingsOnTransaction(
        0,
        [4, 3, 2, 1, 0],
        actual.tr,
        actual,
        (tr) => {
          actual = actual.apply(tr);
          expected = replay(tr, expected);
        }
      );
      expect(
        sortedEntries(reactKeysPluginKey.getState(actual)!.posToKey)
      ).toEqual(sortedEntries(referenceKey.getState(expected)!.posToKey));
    } finally {
      restore();
    }
  });

  it("reads only the entries around a typed character", () => {
    const paragraphs = Array.from({ length: 400 }, (_, i) =>
      schema.node("paragraph", null, [schema.text(`paragraph ${i}`)])
    );
    let state = stateWith(reactKeys(), schema.node("doc", null, paragraphs));
    const pos = state.doc.content.size - 20;
    const nodesBetween = jest.spyOn(Node.prototype, "nodesBetween");
    const descendants = jest.spyOn(Node.prototype, "descendants");
    const tr = state.tr.insertText("x", pos);
    state = state.apply(tr.setSelection(TextSelection.create(tr.doc, pos + 1)));
    expect(descendants).not.toHaveBeenCalled();
    const visited = nodesBetween.mock.calls.length;
    nodesBetween.mockRestore();
    descendants.mockRestore();
    expect(visited).toBeLessThan(5);
  });
});

describe("reactKeys keysFrom", () => {
  function keys(state: EditorState) {
    return reactKeysPluginKey.getState(state)!.posToKey;
  }

  function replaced(prev: EditorState, doc: Node) {
    return EditorState.create({
      doc,
      plugins: [reactKeys({ keysFrom: prev })],
    });
  }

  it("keeps every key when the replacement document is equal", () => {
    const prev = stateWith(reactKeys(), initialDoc());
    const next = replaced(prev, Node.fromJSON(schema, prev.doc.toJSON()));
    expect(sortedEntries(keys(next))).toEqual(sortedEntries(keys(prev)));
  });

  it("keeps the keys of unchanged nodes around a changed paragraph", () => {
    const prev = stateWith(reactKeys(), initialDoc());
    const json = prev.doc.toJSON();
    json.content[1].content[0].content[0].text = "changed quote";
    const next = replaced(prev, Node.fromJSON(schema, json));
    const before = keys(prev);
    const after = keys(next);
    const start = prev.doc.content.findDiffStart(next.doc.content)!;
    const end = prev.doc.content.findDiffEnd(next.doc.content)!;
    const delta = end.b - end.a;
    // Every node outside the changed text keeps its key, including the
    // quote, the changed paragraph and its text, which start before it.
    const outside = [...before].filter(([pos]) => pos < start || pos >= end.a);
    expect(
      outside.map(([pos]) => after.get(pos < start ? pos : pos + delta))
    ).toEqual(outside.map(([, key]) => key));
    expect(after.size).toBe(before.size);
  });

  it("keeps keys across an inserted block and gives it a new key", () => {
    const prev = stateWith(reactKeys(), initialDoc());
    const inserted = schema.node("paragraph", null, [schema.text("inserted")]);
    const doc = prev.doc.copy(prev.doc.content.addToStart(inserted));
    const next = replaced(prev, doc);
    const before = keys(prev);
    const after = keys(next);
    for (const [pos, key] of before) {
      expect(after.get(pos + inserted.nodeSize)).toBe(key);
    }
    expect([...before.values()]).not.toContain(after.get(0));
  });
});
