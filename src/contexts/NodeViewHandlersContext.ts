import { NodeView, ViewMutationRecord } from "prosemirror-view";
import { createContext } from "react";

export type SelectNode = () => void;
export type DeselectNode = () => void;
export type StopEvent = (event: Event) => boolean;
export type IgnoreMutation = (
  this: NodeView,
  mutation: ViewMutationRecord
) => boolean;

/**
 * The registration functions of the nearest node view. A mark view passes on
 * its node view's handlers with its own `setIgnoreMutation`.
 */
export interface NodeViewHandlers {
  setSelectNode(
    selectNode: SelectNode,
    deselectNode: DeselectNode
  ): void | (() => void);
  setStopEvent(
    stopEvent: (this: NodeView, event: Event) => boolean
  ): void | (() => void);
  setIgnoreMutation(ignoreMutation: IgnoreMutation): void | (() => void);
}

export const NodeViewHandlersContext = createContext<NodeViewHandlers>(
  null as unknown as NodeViewHandlers
);
