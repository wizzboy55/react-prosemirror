import { EditorView } from "prosemirror-view";
import { useContext } from "react";

import { NodeViewHandlersContext } from "../contexts/NodeViewHandlersContext.js";

import { useEditorEffect } from "./useEditorEffect.js";
import { useEditorEventCallback } from "./useEditorEventCallback.js";

function noop() {
  // empty
}

export function useSelectNode(
  selectNode: (view: EditorView) => void,
  deselectNode: (view: EditorView) => void = noop
) {
  const register = useContext(NodeViewHandlersContext)?.setSelectNode;
  const selectNodeMemo = useEditorEventCallback(selectNode);
  const deselectNodeMemo = useEditorEventCallback(deselectNode);
  return useEditorEffect(() => {
    return register(selectNodeMemo, deselectNodeMemo);
  }, [register, selectNodeMemo, deselectNodeMemo]);
}
