import { EditorState } from "prosemirror-state";
import {
  DirectEditorProps,
  EditorProps,
  MarkViewConstructor,
  NodeViewConstructor,
} from "prosemirror-view";

import { DOMSelection } from "./dom.js";

export type NodeViewSet = {
  [name: string]: NodeViewConstructor | MarkViewConstructor;
};

export interface AbstractEditorView {
  readonly composing: boolean;
  readonly dom: HTMLElement | null;
  readonly editable: boolean;
  readonly nodeViews: NodeViewSet;
  readonly props: DirectEditorProps;
  readonly state: EditorState;
  readonly isDestroyed: boolean;
  setProps(props: Partial<DirectEditorProps>): void;
  update(props: DirectEditorProps): void;
  updateState(state: EditorState): void;
  someProp<PropName extends keyof EditorProps>(
    propName: PropName
  ): EditorProps[PropName] | undefined;
  someProp<PropName extends keyof EditorProps, Result>(
    propName: PropName,
    f: (value: NonNullable<EditorProps[PropName]>) => Result
  ): Result | undefined;
  destroy(): void;
  domSelectionRange(): {
    anchorNode: Node | null;
    anchorOffset: number;
    focusNode: Node | null;
    focusOffset: number;
  };
  domSelection(): DOMSelection | null;
}

/** The node and mark view constructors from the view's props and plugins. */
export function buildNodeViews(view: AbstractEditorView) {
  const result: NodeViewSet = Object.create(null);
  function add(obj: NodeViewSet) {
    for (const prop in obj)
      if (!Object.prototype.hasOwnProperty.call(result, prop))
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        result[prop] = obj[prop]!;
  }
  view.someProp("nodeViews", add);
  view.someProp("markViews", add);
  return result;
}

export function changedNodeViews(a: NodeViewSet, b: NodeViewSet) {
  let nA = 0,
    nB = 0;
  for (const prop in a) {
    if (a[prop] != b[prop]) return true;
    nA++;
  }
  for (const _ in b) nB++;
  return nA != nB;
}

export function getEditable(view: AbstractEditorView) {
  return !view.someProp("editable", (value) => value(view.state) === false);
}
