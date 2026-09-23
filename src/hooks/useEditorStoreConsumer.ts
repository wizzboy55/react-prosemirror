import { useContext, useReducer, useRef } from "react";

import { EditorStateStoreContext } from "../contexts/EditorStateStoreContext.js";

import { useClientLayoutEffect } from "./useClientLayoutEffect.js";

/**
 * Reads a value that ProseMirrorInner publishes during its render. The
 * component renders in the same pass as the editor when a transaction is
 * dispatched, and in a follow-up pass when the value changed without one.
 */
export function useEditorStoreConsumer<T>(
  read: () => T,
  { rendersDocument = false }: { rendersDocument?: boolean } = {}
): T {
  const store = useContext(EditorStateStoreContext);
  const readRef = useRef(read);
  readRef.current = read;

  // Every dispatch schedules this reducer. It runs during the render, after
  // ProseMirrorInner published the new value, so when the owner dropped the
  // transaction it returns the value already rendered and React bails out
  // without rendering the component's children or committing a DOM change.
  const [, sync] = useReducer(
    () => readRef.current(),
    undefined,
    () => read()
  );

  const value = read();
  const committedRef = useRef(value);
  useClientLayoutEffect(() => {
    committedRef.current = value;
  }, [value]);

  useClientLayoutEffect(
    () =>
      store.addConsumer({
        rerender: sync,
        isStale: () => committedRef.current !== readRef.current(),
        rendersDocument,
      }),
    [store, rendersDocument]
  );

  return value;
}
