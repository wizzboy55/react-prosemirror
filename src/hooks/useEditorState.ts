/* Copyright (c) The New York Times Company */
import type { EditorState } from "prosemirror-state";
import { useContext } from "react";

import { EditorStateStoreContext } from "../contexts/EditorStateStoreContext.js";

import { useEditorStoreConsumer } from "./useEditorStoreConsumer.js";

/**
 * Provides access to the current EditorState value.
 */
export function useEditorState(): EditorState {
  const store = useContext(EditorStateStoreContext);
  return useEditorStoreConsumer(store.getState);
}
