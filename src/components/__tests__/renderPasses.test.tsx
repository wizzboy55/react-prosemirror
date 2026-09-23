/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { act, render } from "@testing-library/react";
import { Schema } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import React, { Profiler, useLayoutEffect, useState } from "react";

import { useEditorEffect } from "../../hooks/useEditorEffect.js";
import { useLayoutGroupEffect } from "../../hooks/useLayoutGroupEffect.js";
import { reactKeys } from "../../plugins/reactKeys.js";
import { LayoutGroup } from "../LayoutGroup.js";
import { ProseMirror } from "../ProseMirror.js";
import { ProseMirrorDoc } from "../ProseMirrorDoc.js";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      group: "block",
      content: "text*",
      toDOM: () => ["p", 0],
    },
    text: {},
  },
});

function createState() {
  return EditorState.create({
    doc: schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("one")]),
      schema.node("paragraph", null, [schema.text("two")]),
    ]),
    plugins: [reactKeys()],
  });
}

describe("render passes", () => {
  it("commits a controlled editor once per dispatched transaction", () => {
    let view: EditorView | null = null;
    let commits = 0;

    // Mirrors a caller whose editor effect has no dependency list, so it
    // registers again on every commit.
    function CaptureView() {
      useEditorEffect((v) => {
        view = v;
      });
      return null;
    }

    function Editor() {
      const [state, setState] = useState(createState);
      return (
        <Profiler id="editor" onRender={() => commits++}>
          <ProseMirror
            state={state}
            dispatchTransaction={(tr) => setState((s) => s.apply(tr))}
          >
            <ProseMirrorDoc />
            <CaptureView />
          </ProseMirror>
        </Profiler>
      );
    }

    render(<Editor />);
    expect(view).not.toBeNull();

    for (const text of ["a", "b", "c"]) {
      commits = 0;
      act(() => {
        view!.dispatch(view!.state.tr.insertText(text, 2));
      });
      expect(commits).toBe(1);
    }
    expect(view!.state.doc.firstChild!.textContent).toBe("ocbane");
  });

  it("commits an uncontrolled editor once per dispatched transaction", () => {
    let view: EditorView | null = null;
    let commits = 0;

    function CaptureView() {
      useEditorEffect((v) => {
        view = v;
      });
      return null;
    }

    const state = createState();
    render(
      <Profiler id="editor" onRender={() => commits++}>
        <ProseMirror defaultState={state}>
          <ProseMirrorDoc />
          <CaptureView />
        </ProseMirror>
      </Profiler>
    );

    commits = 0;
    act(() => {
      view!.dispatch(view!.state.tr.insertText("x", 2));
    });
    expect(commits).toBe(1);
    expect(view!.state.doc.firstChild!.textContent).toBe("oxne");
  });
});

describe("LayoutGroup", () => {
  it("does not re-render for effects registered in its own commit", () => {
    let groupCommits = 0;
    let runs = 0;

    function Child({ value }: { value: number }) {
      useLayoutGroupEffect(() => {
        runs++;
      });
      return <span>{value}</span>;
    }

    function Parent({ value }: { value: number }) {
      return (
        <Profiler id="group" onRender={() => groupCommits++}>
          <LayoutGroup>
            <Child value={value} />
          </LayoutGroup>
        </Profiler>
      );
    }

    const { rerender } = render(<Parent value={1} />);
    expect(runs).toBe(1);

    groupCommits = 0;
    rerender(<Parent value={2} />);
    expect(runs).toBe(2);
    expect(groupCommits).toBe(1);
  });

  it("flushes effects registered in a commit that does not render it", () => {
    const seen: number[] = [];
    let bump: () => void = () => undefined;

    function Child() {
      const [value, setValue] = useState(0);
      bump = () => setValue((v) => v + 1);
      useLayoutGroupEffect(() => {
        seen.push(value);
      }, [value]);
      return <span>{value}</span>;
    }

    // Stable children: a state change inside Child does not render the group.
    const child = <Child />;
    function Parent() {
      return <LayoutGroup>{child}</LayoutGroup>;
    }

    render(<Parent />);
    act(() => bump());
    act(() => bump());
    expect(seen).toEqual([0, 1, 2]);
  });

  it("runs effects after every descendant layout effect", () => {
    const order: string[] = [];

    function Child({ name }: { name: string }) {
      useLayoutGroupEffect(() => {
        order.push(`group:${name}`);
      });
      useLayoutEffect(() => {
        order.push(`layout:${name}`);
      });
      return null;
    }

    const { rerender } = render(
      <LayoutGroup>
        <Child name="a" />
        <Child name="b" />
      </LayoutGroup>
    );
    expect(order).toEqual(["layout:a", "layout:b", "group:a", "group:b"]);

    order.length = 0;
    rerender(
      <LayoutGroup>
        <Child name="a" />
        <Child name="b" />
      </LayoutGroup>
    );
    expect(order).toEqual(["layout:a", "layout:b", "group:a", "group:b"]);
  });
});
