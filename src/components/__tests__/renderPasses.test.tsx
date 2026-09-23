/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { act, render } from "@testing-library/react";
import { Schema } from "prosemirror-model";
import {
  EditorState,
  Plugin,
  TextSelection,
  Transaction,
} from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import React, {
  Profiler,
  forwardRef,
  useContext,
  useEffect,
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
import { useEditorEventListener } from "../../hooks/useEditorEventListener.js";
import { useEditorState } from "../../hooks/useEditorState.js";
import { useLayoutGroupEffect } from "../../hooks/useLayoutGroupEffect.js";
import { reactKeys, reactKeysPluginKey } from "../../plugins/reactKeys.js";
import { useMergedDOMRefs } from "../../refs.js";
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

describe("mount", () => {
  type MountedView = EditorView & {
    docView: { node: unknown; children: { node?: unknown }[] };
  };

  it("mounts in one commit, with the view committed before editor effects", () => {
    let commits = 0;
    const firstRun: {
      docNode?: unknown;
      children?: number;
      pluginView?: boolean;
    }[] = [];
    let pluginViews = 0;
    const plugin = new Plugin({
      view() {
        pluginViews++;
        return {};
      },
    });
    const state = EditorState.create({
      doc: createState().doc,
      plugins: [reactKeys(), plugin],
    });

    function CaptureView() {
      useEditorEffect((v) => {
        const view = v as MountedView;
        firstRun.push({
          docNode: view.docView.node,
          children: view.docView.children.length,
          pluginView: pluginViews === 1,
        });
      }, []);
      return null;
    }

    const { getByTestId } = render(
      <Profiler id="editor" onRender={() => commits++}>
        <ProseMirror defaultState={state}>
          <ProseMirrorDoc data-testid="doc" />
          <CaptureView />
        </ProseMirror>
      </Profiler>
    );

    expect(commits).toBe(1);
    expect(firstRun).toEqual([
      { docNode: state.doc, children: 2, pluginView: true },
    ]);
    const doc = getByTestId("doc");
    expect(doc.getAttribute("contenteditable")).toBe("true");
    expect(
      [...doc.querySelectorAll("p")].map((p) =>
        p.getAttribute("contenteditable")
      )
    ).toEqual([null, null]);
  });

  it("renders each React node view once on mount", () => {
    let commits = 0;
    const renders: number[] = [];
    const Paragraph = forwardRef<HTMLParagraphElement, NodeViewComponentProps>(
      function Paragraph({ nodeProps, children, ...props }, ref) {
        renders.push(nodeProps.getPos());
        return (
          <p {...props} ref={useMergedDOMRefs(ref, nodeProps.contentDOMRef)}>
            {children}
          </p>
        );
      }
    );
    const components = { paragraph: Paragraph };

    const { getByTestId } = render(
      <Profiler id="editor" onRender={() => commits++}>
        <ProseMirror
          defaultState={createState()}
          nodeViewComponents={components}
        >
          <ProseMirrorDoc data-testid="doc" />
        </ProseMirror>
      </Profiler>
    );

    expect(commits).toBe(1);
    expect(renders).toEqual([0, 5]);
    expect(
      [...getByTestId("doc").querySelectorAll("p")].map((p) =>
        p.getAttribute("contenteditable")
      )
    ).toEqual([null, null]);
  });

  it("gives effects the view when the document mounts after the editor", () => {
    const views: EditorView[] = [];

    function CaptureView() {
      useEditorEffect((v) => {
        views.push(v);
      }, []);
      return null;
    }

    function Editor({ showDoc }: { showDoc: boolean }) {
      return (
        <ProseMirror defaultState={createState()}>
          {showDoc && <ProseMirrorDoc data-testid="doc" />}
          <CaptureView />
        </ProseMirror>
      );
    }

    const { rerender, getByTestId } = render(<Editor showDoc={false} />);
    expect(views).toEqual([]);
    rerender(<Editor showDoc />);
    expect(views).toHaveLength(1);
    expect(views[0]!.dom).toBe(getByTestId("doc"));
    const docView = (views[0] as MountedView).docView;
    expect(docView.children).toHaveLength(2);
  });

  it("handles DOM events from the prop and from components on mount", () => {
    let commits = 0;
    const calls: string[] = [];
    const handleDOMEvents = {
      keydown: () => {
        calls.push("prop");
        return false;
      },
    };

    function Listener() {
      useEditorEventListener("keydown", () => {
        calls.push("component");
        return false;
      });
      return null;
    }

    const { getByTestId } = render(
      <Profiler id="editor" onRender={() => commits++}>
        <ProseMirror
          defaultState={createState()}
          handleDOMEvents={handleDOMEvents}
        >
          <ProseMirrorDoc data-testid="doc" />
          <Listener />
        </ProseMirror>
      </Profiler>
    );

    // The component's listener adds an event type, which renders the editor
    // once more: only the editor itself, not its node views.
    expect(commits).toBeLessThanOrEqual(2);
    act(() => {
      getByTestId("doc").dispatchEvent(
        new KeyboardEvent("keydown", { key: "a", bubbles: true })
      );
    });
    expect(calls).toEqual(["component", "prop"]);
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

describe("composition freeze", () => {
  function manyParagraphs(count: number) {
    return EditorState.create({
      doc: schema.node(
        "doc",
        null,
        Array.from({ length: count }, (_, i) =>
          schema.node("paragraph", null, [schema.text(`p${i}`)])
        )
      ),
      plugins: [reactKeys()],
    });
  }

  function renderEditor(state: EditorState) {
    let view: EditorView | null = null;
    let mounts = 0;
    const Paragraph = forwardRef<HTMLParagraphElement, NodeViewComponentProps>(
      function Paragraph({ nodeProps, children, ...props }, ref) {
        useEffect(() => {
          mounts++;
        }, []);
        void nodeProps;
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
    const components = { paragraph: Paragraph };
    const result = render(
      <ProseMirror defaultState={state} nodeViewComponents={components}>
        <ProseMirrorDoc data-testid="doc" />
        <CaptureView />
      </ProseMirror>
    );
    return { ...result, view: () => view!, mounts: () => mounts };
  }

  it("keeps a frozen node's DOM and remounts it when unfrozen", () => {
    const { view, mounts, getByTestId } = renderEditor(manyParagraphs(3));
    const first = () => getByTestId("doc").firstElementChild!;
    const mountsBefore = mounts();

    act(() => {
      view().dispatch(
        view().state.tr.setMeta(reactKeysPluginKey, { freezeFrom: 0 })
      );
    });
    act(() => {
      view().dispatch(
        view().state.tr.insertText("X", 1).setMeta("composition", 1)
      );
    });
    expect(view().state.doc.firstChild!.textContent).toBe("Xp0");
    expect(first().textContent).toBe("p0");

    act(() => {
      view().dispatch(
        view().state.tr.setMeta(reactKeysPluginKey, { freezeFrom: null })
      );
    });
    expect(first().textContent).toBe("Xp0");
    expect(mounts()).toBe(mountsBefore + 1);
  });

  it("reads the freeze state once per transaction, not once per node view", () => {
    const { view } = renderEditor(manyParagraphs(30));
    const getState = jest.spyOn(reactKeysPluginKey, "getState");
    act(() => {
      const { tr } = view().state;
      view().dispatch(tr.setSelection(TextSelection.create(tr.doc, 3)));
    });
    expect(getState.mock.calls.length).toBeLessThan(5);
    getState.mockRestore();
  });
});
