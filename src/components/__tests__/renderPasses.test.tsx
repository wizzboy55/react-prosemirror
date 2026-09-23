/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { act, render } from "@testing-library/react";
import { Schema } from "prosemirror-model";
import { EditorState, Transaction } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import React, {
  Profiler,
  forwardRef,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";

import { ChildDescriptionsContext } from "../../contexts/ChildDescriptionsContext.js";
import { EditorContext } from "../../contexts/EditorContext.js";
import { EditorStateStoreContext } from "../../contexts/EditorStateStoreContext.js";
import { LayoutGroupContext } from "../../contexts/LayoutGroupContext.js";
import { NodeViewContext } from "../../contexts/NodeViewContext.js";
import { useEditorEffect } from "../../hooks/useEditorEffect.js";
import { useEditorState } from "../../hooks/useEditorState.js";
import { useLayoutGroupEffect } from "../../hooks/useLayoutGroupEffect.js";
import { reactKeys } from "../../plugins/reactKeys.js";
import { LayoutGroup } from "../LayoutGroup.js";
import { ProseMirror } from "../ProseMirror.js";
import { DocNodeViewContext, ProseMirrorDoc } from "../ProseMirrorDoc.js";
import { NodeViewComponentProps } from "../nodes/NodeViewComponentProps.js";

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

describe("stable providers", () => {
  it("keeps every provider value above the node views across transactions", () => {
    let view: EditorView | null = null;
    const seen: unknown[][] = [];

    const Paragraph = forwardRef<HTMLParagraphElement, NodeViewComponentProps>(
      function Paragraph({ nodeProps, children, ...props }, ref) {
        const values = [
          useContext(EditorContext),
          useContext(EditorStateStoreContext),
          useContext(NodeViewContext),
          useContext(DocNodeViewContext),
          useContext(LayoutGroupContext),
          useContext(ChildDescriptionsContext),
        ];
        // Only the first paragraph, which the transaction edits.
        if (nodeProps.getPos() === 0) seen.push(values);
        return (
          <p ref={ref} {...props}>
            {children}
          </p>
        );
      }
    );

    function CaptureView() {
      useEditorEffect((v) => {
        view = v;
      });
      return null;
    }

    function Editor() {
      const [state, setState] = useState(createState);
      return (
        <ProseMirror
          state={state}
          dispatchTransaction={(tr) => setState((s) => s.apply(tr))}
          nodeViewComponents={{ paragraph: Paragraph }}
        >
          <ProseMirrorDoc />
          <CaptureView />
        </ProseMirror>
      );
    }

    render(<Editor />);
    const rendersBefore = seen.length;
    act(() => {
      view!.dispatch(view!.state.tr.insertText("x", 2));
    });
    expect(seen.length).toBeGreaterThan(rendersBefore);
    const names = [
      "EditorContext",
      "EditorStateStoreContext",
      "NodeViewContext",
      "DocNodeViewContext",
      "LayoutGroupContext",
      "ChildDescriptionsContext",
    ];
    const [first] = seen.slice(rendersBefore - 1);
    const changed = seen
      .slice(rendersBefore)
      .flatMap((values) =>
        values.flatMap((value, index) =>
          value === first![index] ? [] : [names[index]]
        )
      );
    expect(changed).toEqual([]);
  });

  it("renders useEditorState consumers in the transaction's commit", () => {
    let view: EditorView | null = null;
    let commits = 0;
    const docs: string[] = [];

    function CaptureView() {
      useEditorEffect((v) => {
        view = v;
      });
      return null;
    }

    function StateReader() {
      docs.push(useEditorState().doc.textContent);
      return null;
    }

    // Stable children: only the dispatch can bring StateReader along.
    const children = (
      <>
        <ProseMirrorDoc />
        <CaptureView />
        <StateReader />
      </>
    );
    render(
      <Profiler id="editor" onRender={() => commits++}>
        <ProseMirror defaultState={createState()}>{children}</ProseMirror>
      </Profiler>
    );

    commits = 0;
    act(() => {
      view!.dispatch(view!.state.tr.insertText("x", 2));
    });
    expect(commits).toBe(1);
    expect(docs[docs.length - 1]).toBe("oxnetwo");
  });

  it("commits a state changed outside of a dispatch once the document renders", () => {
    let view: EditorView | null = null;
    let setOuterState: (state: EditorState) => void = () => undefined;

    function CaptureView() {
      useEditorEffect((v) => {
        view = v;
      });
      return null;
    }

    function Editor() {
      const [state, setState] = useState(createState);
      setOuterState = setState;
      // Memoized children are not re-created when the state changes.
      const children = useMemo(
        () => (
          <>
            <ProseMirrorDoc data-testid="doc" />
            <CaptureView />
          </>
        ),
        []
      );
      return <ProseMirror state={state}>{children}</ProseMirror>;
    }

    const { getByTestId } = render(<Editor />);
    const next = view!.state.apply(view!.state.tr.insertText("changed ", 1));
    act(() => {
      setOuterState(next);
    });
    expect(getByTestId("doc").textContent).toBe("changed onetwo");
    expect(view!.state).toBe(next);
    const docView = (view as unknown as { docView: { node: unknown } }).docView;
    expect(docView.node).toBe(next.doc);
  });
});

describe("dropped transactions", () => {
  it("leave useEditorState consumers without a DOM commit", () => {
    let view: EditorView | null = null;
    let consumerCommits = 0;

    function CaptureView() {
      useEditorEffect((v) => {
        view = v;
      });
      return null;
    }

    function StateView() {
      const state = useEditorState();
      useLayoutEffect(() => {
        consumerCommits++;
      });
      return <span data-testid="state">{state.doc.textContent}</span>;
    }

    function Editor() {
      const [state, setState] = useState(createState);
      // The owner gates transactions: dropped ones never reach its state.
      const dispatchTransaction = (tr: Transaction) => {
        if (!tr.getMeta("drop")) setState((s) => s.apply(tr));
      };
      return (
        <ProseMirror state={state} dispatchTransaction={dispatchTransaction}>
          <ProseMirrorDoc />
          <CaptureView />
          <StateView />
        </ProseMirror>
      );
    }

    const { getByTestId } = render(<Editor />);
    const observer = new MutationObserver(() => undefined);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });

    const before = consumerCommits;
    act(() => {
      view!.dispatch(view!.state.tr.insertText("x", 2).setMeta("drop", true));
    });
    expect(consumerCommits).toBe(before);
    expect(observer.takeRecords()).toEqual([]);
    expect(getByTestId("state").textContent).toBe("onetwo");

    act(() => {
      view!.dispatch(view!.state.tr.insertText("x", 2));
    });
    expect(consumerCommits).toBe(before + 1);
    expect(getByTestId("state").textContent).toBe("oxnetwo");
    observer.disconnect();
  });
});
