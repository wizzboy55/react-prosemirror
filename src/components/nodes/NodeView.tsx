import { Node } from "prosemirror-model";
import {
  Decoration,
  DecorationSource,
  NodeViewConstructor,
} from "prosemirror-view";
import React, {
  ComponentType,
  createContext,
  memo,
  useCallback,
  useContext,
  useLayoutEffect,
  useReducer,
  useRef,
  useSyncExternalStore,
} from "react";

import { EditorStateStoreContext } from "../../contexts/EditorStateStoreContext.js";
import { NodeViewContext } from "../../contexts/NodeViewContext.js";

import { DefaultNodeView } from "./DefaultNodeView.js";
import { NodeViewComponentProps } from "./NodeViewComponentProps.js";
import { NodeViewConstructorView } from "./NodeViewConstructorView.js";
import { ReactNodeView } from "./ReactNodeView.js";

type Props = {
  node: Node;
  getPos: () => number;
  outerDeco: readonly Decoration[];
  innerDeco: DecorationSource;
};

// Node view components and constructors are numbered so that a node view
// keyed by them remounts when either changes.
const viewTypeIds = new WeakMap<object, number>();
let nextViewTypeId = 0;

function viewTypeId(viewType: object) {
  let id = viewTypeIds.get(viewType);
  if (id === undefined) {
    id = nextViewTypeId++;
    viewTypeIds.set(viewType, id);
  }
  return id;
}

export const NodeView = memo(function NodeView(props: Props) {
  // Leaving the frozen state remounts the node view.
  const [remounts, forceRemount] = useReducer((x: number) => x + 1, 0);
  const renderRef = useRef<JSX.Element | null>(null);
  // The store notifies only when the frozen position changes, so a transaction
  // does not run one getPos() per node view.
  const store = useContext(EditorStateStoreContext);
  const { getPos } = props;
  const isFrozen = useCallback(() => {
    const freezeFrom = store.getFreezeFrom();
    return freezeFrom !== null && freezeFrom === getPos();
  }, [store, getPos]);
  const frozen = useSyncExternalStore(
    store.subscribeFreezeFrom,
    isFrozen,
    isFrozen
  );
  const { components, constructors } = useContext(NodeViewContext);

  const committedFrozenRef = useRef(false);

  const component = (components[props.node.type.name] ??
    DefaultNodeView) as ComponentType<NodeViewComponentProps>;
  const constructor = constructors[props.node.type.name] as
    | NodeViewConstructor
    | undefined;

  // Protect content while frozen, and also through the single render where we
  // leave the frozen state: `committedFrozenRef` still reflects the previous
  // commit, so we keep returning the exact same cached element reference.
  const protecting =
    (frozen || committedFrozenRef.current) && renderRef.current != null;

  if (!protecting) {
    // The key remounts the node view when its component or constructor
    // changes: a React node view would otherwise keep its state across a
    // component change, and every custom node view renders the same
    // components.
    const key = `${remounts}:${viewTypeId(constructor ?? component)}`;
    renderRef.current = (
      <GetPosContext.Provider value={props.getPos}>
        {constructor ? (
          <NodeViewConstructorView
            key={key}
            constructor={constructor}
            {...props}
          />
        ) : (
          <ReactNodeView key={key} component={component} {...props} />
        )}
      </GetPosContext.Provider>
    );
  }

  useLayoutEffect(() => {
    const wasFrozen = committedFrozenRef.current;
    committedFrozenRef.current = frozen;

    if (wasFrozen && !frozen) forceRemount();
  }, [frozen]);

  return renderRef.current;
});

export const GetPosContext = createContext<() => number>(
  null as unknown as () => number
);
