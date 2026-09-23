import { EditorState } from "prosemirror-state";
import { createContext } from "react";

import { reactKeysPluginKey } from "../plugins/reactKeys.js";

/**
 * A component that renders from the store rather than from a context value,
 * so that no provider above the node views changes on every transaction.
 */
export interface EditorStoreConsumer {
  /** Schedules a render of the consuming component. */
  rerender(): void;
  /** Whether its last committed render read an outdated value. */
  isStale(): boolean;
  /** Renders the document, so the view must not commit while it is stale. */
  rendersDocument?: boolean;
}

export interface EditorStateStore {
  getState: () => EditorState;
  subscribe: (listener: () => void) => () => void;
  setState: (state: EditorState) => void;
  notifyListeners: () => void;
  /** Position of the node frozen during a composition, if any. */
  getFreezeFrom: () => number | null;
  /** Notified only when getFreezeFrom() changes, not on every state. */
  subscribeFreezeFrom: (listener: () => void) => () => void;
  addConsumer: (consumer: EditorStoreConsumer) => () => void;
  /**
   * Called while a transaction is dispatched, in the same batch as the state
   * update, so consumers render in the same pass as the editor.
   */
  scheduleConsumers: () => void;
  /**
   * Called after the editor commits: re-renders the consumers that a change
   * made outside of a dispatch left behind. Returns whether one of them
   * renders the document.
   */
  syncConsumers: () => boolean;
}

export function createEditorStateStore(): EditorStateStore {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let state: EditorState = null as any;
  let pendingNotify = false;
  const listeners = new Set<() => void>();
  const consumers = new Set<EditorStoreConsumer>();
  let freezeFrom: number | null = null;
  let pendingFreezeNotify = false;
  const freezeListeners = new Set<() => void>();

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setState: (newState) => {
      if (state !== newState) {
        state = newState;
        pendingNotify = true;
        const nextFreezeFrom =
          reactKeysPluginKey.getState(newState)?.freezeFrom ?? null;
        if (nextFreezeFrom !== freezeFrom) {
          freezeFrom = nextFreezeFrom;
          pendingFreezeNotify = true;
        }
      }
    },
    notifyListeners: () => {
      if (pendingNotify) {
        pendingNotify = false;
        listeners.forEach((l) => l());
      }
      if (pendingFreezeNotify) {
        pendingFreezeNotify = false;
        freezeListeners.forEach((l) => l());
      }
    },
    getFreezeFrom: () => freezeFrom,
    subscribeFreezeFrom: (listener) => {
      freezeListeners.add(listener);
      return () => freezeListeners.delete(listener);
    },
    addConsumer: (consumer) => {
      consumers.add(consumer);
      return () => {
        consumers.delete(consumer);
      };
    },
    scheduleConsumers: () => {
      consumers.forEach((consumer) => consumer.rerender());
    },
    syncConsumers: () => {
      let documentStale = false;
      consumers.forEach((consumer) => {
        if (!consumer.isStale()) return;
        consumer.rerender();
        if (consumer.rendersDocument) documentStale = true;
      });
      return documentStale;
    },
  };
}

export const EditorStateStoreContext = createContext<EditorStateStore>(
  null as unknown as EditorStateStore
);
