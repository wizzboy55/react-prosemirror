import { Node } from "prosemirror-model";
import { Decoration, DecorationSource } from "prosemirror-view";
import React, {
  ElementType,
  HTMLProps,
  createContext,
  forwardRef,
  useContext,
} from "react";

import { useEditorStoreConsumer } from "../hooks/useEditorStoreConsumer.js";

import { DocNodeView } from "./nodes/DocNodeView.js";

export interface DocNodeViewContextValue {
  node: Node;
  getPos: () => number;
  decorations: readonly Decoration[];
  innerDecorations: DecorationSource;
  setMount: (mount: HTMLElement | null) => void;
}

/**
 * A stable holder whose value ProseMirrorInner replaces during render. A
 * context value that changed per transaction would make React walk every
 * node view under it on each keystroke.
 */
export interface DocNodeViewStore {
  current: DocNodeViewContextValue;
}

export const DocNodeViewContext = createContext<DocNodeViewStore>(
  null as unknown as DocNodeViewStore
);

interface Props extends Omit<HTMLProps<HTMLElement>, "as"> {
  as?: ElementType;
}

export const ProseMirrorDoc = forwardRef<HTMLElement, Props>(
  function ProseMirrorDoc({ as, ...props }, ref) {
    const docStore = useContext(DocNodeViewContext);
    const docProps = useEditorStoreConsumer(() => docStore.current, {
      rendersDocument: true,
    });
    return <DocNodeView ref={ref} {...props} {...docProps} as={as} />;
  }
);
