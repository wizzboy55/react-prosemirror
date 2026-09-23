import { EditorState, Plugin, Transaction } from "prosemirror-state";
import { DirectEditorProps, EditorProps, EditorView } from "prosemirror-view";
import { useCallback, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { AbstractEditorView, changedNodeViews } from "../AbstractEditorView.js";
import { ReactEditorView } from "../ReactEditorView.js";
import { StaticEditorView } from "../StaticEditorView.js";
import { EMPTY_STATE } from "../constants.js";
import { EditorContextValue } from "../contexts/EditorContext.js";
import { EditorStateStore } from "../contexts/EditorStateStoreContext.js";
import { transferDocDecoCache } from "../decorations/computeDocDeco.js";
import { transferViewDecorationsCache } from "../decorations/viewDecorations.js";
import { beforeInputPlugin } from "../plugins/beforeInputPlugin.js";

import { useClientLayoutEffect } from "./useClientLayoutEffect.js";
import { useComponentEventListeners } from "./useComponentEventListeners.js";
import { useForceUpdate } from "./useForceUpdate.js";

export interface UseEditorOptions extends EditorProps {
  defaultState?: EditorState;
  state?: EditorState;
  plugins?: readonly Plugin[];
  dispatchTransaction?(this: EditorView, tr: Transaction): void;
  static?: boolean;
}

let didWarnValueDefaultValue = false;

// The view is updated only when a prop changed, so a render that did not
// change them leaves the view as it is.
function sameProps(a: DirectEditorProps, b: DirectEditorProps) {
  const aKeys = Object.keys(a) as Array<keyof DirectEditorProps>;
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every(
    (key) => Object.prototype.hasOwnProperty.call(b, key) && a[key] === b[key]
  );
}

/**
 * Creates, mounts, and manages a ProseMirror `EditorView`.
 *
 * All state and props updates are executed in a layout effect.
 * To ensure that the EditorState and EditorView are never out of
 * sync, it's important that the EditorView produced by this hook
 * is only accessed through the `useEditorViewEvent` and
 * `useEditorViewLayoutEffect` hooks.
 *
 * The editor renders once on mount: until the document's root element mounts
 * it renders against a provisional static view with the same props, then
 * `setMount` creates the ReactEditorView during that first commit, before any
 * editor effect runs, and node views build their view descriptions in the
 * same commit.
 */
export function useEditor(
  options: UseEditorOptions,
  stateStore?: EditorStateStore
) {
  if (process.env.NODE_ENV !== "production") {
    if (
      options.defaultState !== undefined &&
      options.state !== undefined &&
      !didWarnValueDefaultValue
    ) {
      console.error(
        "A component contains a ProseMirror editor with both state and defaultState props. " +
          "ProseMirror editors must be either controlled or uncontrolled " +
          "(specify either the state prop, or the defaultState prop, but not both). " +
          "Decide between using a controlled or uncontrolled ProseMirror editor " +
          "and remove one of these props. More info: " +
          "https://reactjs.org/link/controlled-components"
      );
      didWarnValueDefaultValue = true;
    }
  }
  const flushSyncRef = useRef(true);
  const forceUpdate = useForceUpdate();

  const defaultState = options.defaultState ?? EMPTY_STATE;
  const [_state, setState] = useState<EditorState>(defaultState);
  const state = options.state ?? _state;

  const { handleDOMEvents, registerEventListener, unregisterEventListener } =
    useComponentEventListeners(options.handleDOMEvents);

  const plugins = useMemo(
    () => [...(options.plugins ?? []), beforeInputPlugin()],
    [options.plugins]
  );

  const dispatchTransaction = useCallback(
    function dispatchTransaction(this: EditorView, tr: Transaction) {
      if (flushSyncRef.current) {
        flushSync(() => {
          if (!options.state) {
            setState((s) => s.apply(tr));
          }
          stateStore?.scheduleConsumers();

          if (options.dispatchTransaction) {
            options.dispatchTransaction.call(this, tr);
          }
        });
      } else {
        if (!options.state) {
          setState((s) => s.apply(tr));
        }
        stateStore?.scheduleConsumers();

        if (options.dispatchTransaction) {
          options.dispatchTransaction.call(this, tr);
        }
      }
    },
    [options.dispatchTransaction, options.state, stateStore]
  );

  const isStatic = options.static ?? false;
  const directEditorProps = {
    ...options,
    state,
    plugins,
    dispatchTransaction,
    handleDOMEvents,
  };

  const viewRef = useRef<AbstractEditorView | null>(null);
  const propsRef = useRef<DirectEditorProps>(directEditorProps);
  if (viewRef.current === null) {
    viewRef.current = new StaticEditorView(directEditorProps, !isStatic);
  } else if (!sameProps(propsRef.current, directEditorProps)) {
    propsRef.current = directEditorProps;
    viewRef.current.update(directEditorProps);
  }
  const isStaticRef = useRef(isStatic);
  isStaticRef.current = isStatic;

  // Work that waits for the view, in the order it was requested.
  const [pending] = useState(() => new Set<() => void>());
  // Bumped when the view changes after the first commit, so that consumers
  // render and run their effects again with the new view.
  const [generation, setGeneration] = useState(0);
  const committedRef = useRef(false);
  const unmountedRef = useRef(false);

  // Called with the document's root element when it mounts, before the node
  // views' deferred descriptions and any editor effect run in that commit.
  const setMount = useCallback(
    (mount: HTMLElement | null) => {
      const current = viewRef.current;
      if (current instanceof ReactEditorView) {
        if (mount && current.dom === mount && !current.isDestroyed) return;
        if (!current.isDestroyed) current.destroy();
      } else if (!mount || isStaticRef.current) {
        return;
      }

      if (!mount || isStaticRef.current) {
        viewRef.current = new StaticEditorView(
          propsRef.current,
          !isStaticRef.current
        );
        if (!unmountedRef.current) setGeneration((g) => g + 1);
        return;
      }

      const view = new ReactEditorView({ mount }, propsRef.current);
      if (current instanceof StaticEditorView) {
        // Keep the values the first render computed, so that the next
        // render hands the node views the same constructors and decorations.
        if (!changedNodeViews(view.nodeViews, current.nodeViews)) {
          view.nodeViews = current.nodeViews;
        }
        transferDocDecoCache(current, view);
        transferViewDecorationsCache(current, view);
      }
      view.dom.addEventListener("compositionend", forceUpdate);
      viewRef.current = view;
      if (committedRef.current) setGeneration((g) => g + 1);

      const runs = [...pending];
      pending.clear();
      runs.forEach((run) => run());
    },
    [forceUpdate, pending]
  );

  // Destroys the view before the node views unmount.
  useClientLayoutEffect(() => {
    committedRef.current = true;
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      const view = viewRef.current;
      if (view instanceof ReactEditorView && !view.isDestroyed) view.destroy();
    };
  }, []);

  useClientLayoutEffect(() => {
    // When the state changed outside of a dispatch and ProseMirrorDoc's
    // element was reused, it has not rendered the new document yet. Commit
    // it to the view in the follow-up render instead of against stale DOM.
    if (stateStore?.syncConsumers()) {
      forceUpdate();
      return;
    }
    // Ensure that the EditorView hasn't been destroyed before
    // running effects. Running effects will reattach selection
    // change listeners if the EditorView has been destroyed.
    const view = viewRef.current;
    if (view instanceof ReactEditorView && !view.isDestroyed) {
      flushSyncRef.current = false;
      view.commitPendingEffects();
      flushSyncRef.current = true;
    }
  });

  const editor = useMemo<EditorContextValue>(
    () => ({
      get view() {
        return viewRef.current as AbstractEditorView;
      },
      flushSyncRef,
      registerEventListener,
      unregisterEventListener,
      isStatic,
      isViewPending() {
        const view = viewRef.current;
        return (
          !isStaticRef.current &&
          !(view instanceof ReactEditorView && !view.isDestroyed)
        );
      },
      whenViewReady(run: () => void) {
        pending.add(run);
        return () => {
          pending.delete(run);
        };
      },
    }),
    // A new value when the view changes after the first commit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isStatic, registerEventListener, unregisterEventListener, generation]
  );

  return { editor, state, setMount };
}
