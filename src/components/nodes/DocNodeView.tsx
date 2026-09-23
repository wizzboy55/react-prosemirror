import { Node } from "prosemirror-model";
import { Decoration, DecorationSource } from "prosemirror-view";
import React, {
  ElementType,
  HTMLProps,
  createElement,
  forwardRef,
  memo,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react";

import { ChildDescriptionsContext } from "../../contexts/ChildDescriptionsContext.js";
import { useNodeViewDescription } from "../../hooks/useNodeViewDescription.js";
import { ChildNodeViews, wrapInDeco } from "../ChildNodeViews.js";

export interface DocNodeViewProps extends Omit<HTMLProps<HTMLElement>, "as"> {
  as?: ElementType;
  node: Node;
  getPos: () => number;
  decorations: readonly Decoration[];
  innerDecorations: DecorationSource;
  setMount: (mount: HTMLElement | null) => void;
}

export const DocNodeView = memo(
  forwardRef<HTMLElement, DocNodeViewProps>(function DocNodeView(
    {
      as,
      node,
      getPos,
      decorations,
      innerDecorations,
      setMount,
      ...elementProps
    },
    ref
  ) {
    const innerRef = useRef<HTMLElement>(null);
    // The root element only changes with `as`. Without deps, every render
    // would call setMount(null) and then setMount(el), which queues an extra
    // render and commit of ProseMirrorInner on every transaction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useImperativeHandle(ref, () => innerRef.current as HTMLElement, [as]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useImperativeHandle(setMount, () => innerRef.current as HTMLElement, [as]);

    const nodeProps = useMemo(
      () => ({
        node,
        getPos,
        decorations,
        innerDecorations,
        contentDOMRef: innerRef,
      }),
      [node, getPos, decorations, innerDecorations]
    );

    const { childContextValue } = useNodeViewDescription(
      () => innerRef.current,
      () => innerRef.current,
      () => {
        const dom = innerRef.current as HTMLElement;
        return {
          dom,
          contentDOM: dom,
          update() {
            return true;
          },
        };
      },
      nodeProps
    );

    const children = (
      <ChildDescriptionsContext.Provider value={childContextValue}>
        <ChildNodeViews
          getPos={getPos}
          node={node}
          innerDecorations={innerDecorations}
        />
      </ChildDescriptionsContext.Provider>
    );

    const props = {
      ...elementProps,
      suppressContentEditableWarning: true,
      ref: innerRef,
    } satisfies HTMLProps<HTMLElement>;

    const element = as
      ? createElement(as, props, children)
      : createElement("div", props, children);

    return nodeProps.decorations.reduce(wrapInDeco, element);
  })
);
