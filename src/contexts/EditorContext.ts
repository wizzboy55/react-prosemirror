/* Copyright (c) The New York Times Company */
import type { DOMEventMap } from "prosemirror-view";
import { MutableRefObject, createContext } from "react";

import { AbstractEditorView } from "../AbstractEditorView.js";
import type { EventHandler } from "../hooks/useComponentEventListeners.js";

export interface EditorContextValue {
  /**
   * The current view, read when used: a static stand-in until the document
   * mounts, then the mounted view. The context value itself stays the same
   * when the document mounts, so consumers do not render again for it.
   */
  readonly view: AbstractEditorView;
  flushSyncRef: MutableRefObject<boolean>;
  registerEventListener<EventType extends keyof DOMEventMap>(
    eventType: EventType,
    handler: EventHandler<EventType>
  ): void;
  unregisterEventListener<EventType extends keyof DOMEventMap>(
    eventType: EventType,
    handler: EventHandler<EventType>
  ): void;
  isStatic: boolean;
  /** True until the document of an editable editor mounts its view. */
  isViewPending(): boolean;
  /**
   * Runs `run` in the commit that mounts the view, in call order. Returns a
   * function that cancels the run if it has not happened yet.
   */
  whenViewReady(run: () => void): () => void;
}

/**
 * Provides the EditorView, as well as the current
 * EditorState. Should not be consumed directly; instead
 * see `useEditorState`, `useEditorViewEvent`, and
 * `useEditorViewLayoutEffect`.
 */
export const EditorContext = createContext(
  null as unknown as EditorContextValue
);
