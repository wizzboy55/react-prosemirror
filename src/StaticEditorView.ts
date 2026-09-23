import { EditorState } from "prosemirror-state";
import { DirectEditorProps, EditorProps } from "prosemirror-view";

import {
  AbstractEditorView,
  NodeViewSet,
  buildNodeViews,
  changedNodeViews,
  getEditable,
} from "./AbstractEditorView.js";

/**
 * Stands in for the view of a static editor, and for an editable editor's view
 * until its document mounts. A provisional stand-in resolves node views and
 * `editable` like a ReactEditorView does, so that the first render already
 * produces the document the mounted view keeps.
 */
export class StaticEditorView implements AbstractEditorView {
  nodeViews: NodeViewSet = {};

  editable = false;

  constructor(
    public props: DirectEditorProps,
    private readonly provisional = false
  ) {
    if (provisional) {
      this.nodeViews = buildNodeViews(this);
      this.editable = getEditable(this);
    }
  }

  get composing() {
    return false;
  }

  get dom() {
    return null;
  }

  get state() {
    return this.props.state;
  }

  get isDestroyed() {
    return false;
  }

  setProps(props: Partial<DirectEditorProps>) {
    return this.update({ ...this.props, ...props });
  }

  update(props: DirectEditorProps) {
    const prevProps = this.props;
    this.props = props;
    if (!this.provisional) return;

    if (
      prevProps.state.plugins !== props.state.plugins ||
      prevProps.plugins !== props.plugins ||
      prevProps.nodeViews !== props.nodeViews
    ) {
      const nodeViews = buildNodeViews(this);
      if (changedNodeViews(this.nodeViews, nodeViews)) {
        this.nodeViews = nodeViews;
      }
    }
    this.editable = getEditable(this);
  }

  updateState(state: EditorState) {
    this.setProps({ state });
  }

  someProp<PropName extends keyof EditorProps, Result>(
    propName: PropName,
    f: (value: NonNullable<EditorProps[PropName]>) => Result
  ): Result | undefined;
  someProp<PropName extends keyof EditorProps>(
    propName: PropName
  ): NonNullable<EditorProps[PropName]> | undefined;
  someProp<PropName extends keyof EditorProps, Result>(
    propName: PropName,
    f?: (value: NonNullable<EditorProps[PropName]>) => Result
  ) {
    const prop = this.props[propName];
    if (prop != null) {
      const result = f ? f(prop) : prop;
      if (result) {
        return result;
      }
    }

    for (const plugin of this.props.plugins ?? []) {
      const prop = plugin.props[propName];
      if (prop != null) {
        const result = f ? f(prop as NonNullable<EditorProps[PropName]>) : prop;
        if (result) {
          return result;
        }
      }
    }

    for (const plugin of this.state.plugins) {
      const prop = plugin.props[propName];
      if (prop != null) {
        const result = f ? f(prop as NonNullable<EditorProps[PropName]>) : prop;
        if (result) {
          return result;
        }
      }
    }

    return undefined;
  }

  destroy() {
    // pass
  }

  domSelectionRange() {
    return {
      anchorNode: null,
      anchorOffset: 0,
      focusNode: null,
      focusOffset: 0,
    };
  }

  domSelection() {
    return null;
  }
}
