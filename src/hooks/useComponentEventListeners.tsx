/* Copyright (c) The New York Times Company */
import type { DOMEventMap, EditorView } from "prosemirror-view";
import { useCallback, useMemo, useReducer, useRef, useState } from "react";
import { unstable_batchedUpdates as batch } from "react-dom";

import { useClientLayoutEffect } from "./useClientLayoutEffect.js";

export type EventHandler<
  EventType extends keyof DOMEventMap = keyof DOMEventMap
> = (view: EditorView, event: DOMEventMap[EventType]) => boolean | void;

export type HandleDOMEvents = Record<
  keyof DOMEventMap,
  EventHandler | undefined
>;

/**
 * Produces a plugin that can be used with ProseMirror to handle DOM
 * events at the EditorView.dom element.
 *
 * - `reactEventsPlugin` is a ProseMirror plugin for handling DOM events
 * at the EditorView.dom element. It should be passed to `useEditorView`,
 * along with any other plugins.
 *
 * - `registerEventListener` and `unregisterEventListener` should be
 * passed to `EditorContext.Provider`.
 *
 * @privateRemarks
 *
 * The registry of component handlers is mutable and the register functions
 * never change, so registering a handler does not change the editor context.
 * The handleDOMEvents record changes only when an event type is added: the
 * EditorView adds a DOM listener for each of its types. The prop's handlers
 * run after the component handlers, and take effect in the render that
 * passes them, so mounting an editor with them needs no second render.
 */
export function useComponentEventListeners(
  handleDOMEventsProp: HandleDOMEvents | undefined
) {
  const [registry] = useState(
    () => new Map<keyof DOMEventMap, Array<EventHandler>>()
  );
  const [registeredTypes, addRegisteredType] = useReducer(
    (count: number) => count + 1,
    0
  );
  const propRef = useRef(handleDOMEventsProp);
  useClientLayoutEffect(() => {
    propRef.current = handleDOMEventsProp;
  }, [handleDOMEventsProp]);

  const propTypes = handleDOMEventsProp
    ? Object.keys(handleDOMEventsProp)
        .filter((eventType) => handleDOMEventsProp[eventType])
        .join(" ")
    : "";

  const registerEventListener = useCallback(
    (eventType: keyof DOMEventMap, handler: EventHandler) => {
      const handlers = registry.get(eventType) ?? [];
      handlers.unshift(handler);
      if (!registry.has(eventType)) {
        registry.set(eventType, handlers);
        addRegisteredType();
      }
    },
    [registry]
  );

  const unregisterEventListener = useCallback(
    (eventType: keyof DOMEventMap, handler: EventHandler) => {
      const handlers = registry.get(eventType);
      handlers?.splice(handlers.indexOf(handler), 1);
    },
    [registry]
  );

  const handleDOMEvents = useMemo(() => {
    const domEventHandlers: HandleDOMEvents = {};
    const eventTypes = new Set([
      ...registry.keys(),
      ...(propTypes ? propTypes.split(" ") : []),
    ]);

    for (const eventType of eventTypes) {
      function handleEvent(view: EditorView, event: Event) {
        const propHandler = propRef.current?.[eventType];
        const handlers = registry.get(eventType) ?? [];
        for (const handler of propHandler
          ? [...handlers, propHandler]
          : handlers) {
          let handled = false;
          batch(() => {
            handled = !!handler(view, event);
          });
          if (handled || event.defaultPrevented) return true;
        }
        return false;
      }

      domEventHandlers[eventType] = handleEvent;
    }

    return domEventHandlers;
    // registeredTypes counts the registry's event types.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registry, registeredTypes, propTypes]);

  return {
    registerEventListener,
    unregisterEventListener,
    handleDOMEvents,
  };
}
