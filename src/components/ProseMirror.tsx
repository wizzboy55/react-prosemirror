import React, {
  ComponentType,
  ReactNode,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ChildDescriptionsContext,
  ChildDescriptionsContextValue,
} from "../contexts/ChildDescriptionsContext.js";
import { EditorContext } from "../contexts/EditorContext.js";
import { EditorStateStoreContext } from "../contexts/EditorStateStoreContext.js";
import {
  NodeViewContext,
  NodeViewContextValue,
} from "../contexts/NodeViewContext.js";
import { computeDocDeco } from "../decorations/computeDocDeco.js";
import { viewDecorations } from "../decorations/viewDecorations.js";
import { UseEditorOptions, useEditor } from "../hooks/useEditor.js";

import {
  EditorStateSelectorsProvider,
  EditorStateSelectorsRegistrar,
} from "./EditorStateSelectorsProvider.js";
import { LayoutGroup } from "./LayoutGroup.js";
import {
  DocNodeViewContext,
  DocNodeViewContextValue,
  DocNodeViewStore,
} from "./ProseMirrorDoc.js";
import { MarkViewComponentProps } from "./marks/MarkViewComponentProps.js";
import { NodeViewComponentProps } from "./nodes/NodeViewComponentProps.js";

function getPos() {
  return -1;
}

function shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>) {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(b, key) && a[key] === b[key]
  );
}

function useShallowStable<T extends Record<string, unknown>>(value: T): T {
  const ref = useRef(value);
  if (!shallowEqual(ref.current, value)) ref.current = value;
  return ref.current;
}

const rootChildDescriptionsContextValue = {
  parentRef: { current: undefined },
  siblingsRef: {
    current: [],
  },
} satisfies ChildDescriptionsContextValue;

export type Props = UseEditorOptions & {
  children?: ReactNode;
  nodeViewComponents?: {
    [nodeType: string]: ComponentType<NodeViewComponentProps>;
  };
  markViewComponents?: {
    [markType: string]: ComponentType<MarkViewComponentProps>;
  };
};

function ProseMirrorInner({
  children,
  nodeViewComponents,
  markViewComponents,
  ...props
}: Props) {
  const stateStore = useContext(EditorStateStoreContext);

  const { editor, state, setMount } = useEditor(props, stateStore);

  const nodeViewConstructors = editor.view.nodeViews;
  // Callers often pass the component maps inline; keep the context value while
  // their entries are unchanged so it does not change on every render.
  const components = useShallowStable({
    ...nodeViewComponents,
    ...markViewComponents,
  });
  const nodeViewContextValue = useMemo<NodeViewContextValue>(() => {
    return {
      components,
      constructors: nodeViewConstructors,
    };
  }, [components, nodeViewConstructors]);

  const node = state.doc;
  const decorations = computeDocDeco(editor.view);
  const innerDecorations = viewDecorations(editor.view);
  const docNodeViewContextValue = useMemo<DocNodeViewContextValue>(
    () => ({
      setMount,
      node,
      getPos,
      decorations,
      innerDecorations,
    }),
    [setMount, node, decorations, innerDecorations]
  );
  // The provider values above the node views never change per transaction:
  // ProseMirrorDoc and useEditorState read the latest values published here.
  const [docNodeViewStore] = useState<DocNodeViewStore>(() => ({
    current: docNodeViewContextValue,
  }));
  docNodeViewStore.current = docNodeViewContextValue;

  return (
    <EditorContext.Provider value={editor}>
      <EditorStateSelectorsProvider state={state}>
        <NodeViewContext.Provider value={nodeViewContextValue}>
          <ChildDescriptionsContext.Provider
            value={rootChildDescriptionsContextValue}
          >
            <DocNodeViewContext.Provider value={docNodeViewStore}>
              {children}
            </DocNodeViewContext.Provider>
          </ChildDescriptionsContext.Provider>
        </NodeViewContext.Provider>
      </EditorStateSelectorsProvider>
    </EditorContext.Provider>
  );
}

export function ProseMirror(props: Props) {
  return (
    <LayoutGroup>
      <EditorStateSelectorsRegistrar>
        <ProseMirrorInner {...props} />
      </EditorStateSelectorsRegistrar>
    </LayoutGroup>
  );
}
