/* Copyright (c) The New York Times Company */
import React, { useCallback, useInsertionEffect, useRef } from "react";
import type { EffectCallback } from "react";

import { LayoutGroupContext } from "../contexts/LayoutGroupContext.js";
import { useClientLayoutEffect } from "../hooks/useClientLayoutEffect.js";
import { useForceUpdate } from "../hooks/useForceUpdate.js";

export interface LayoutGroupProps {
  children: React.ReactNode;
}

// React 17 has no insertion effects; a layout effect still marks the group
// before its later siblings' layout effects register.
const useCommitEffect = useInsertionEffect ?? useClientLayoutEffect;

/**
 * Rendered as the group's first child: its insertion effect runs at the start
 * of every commit that includes the group's render, before any descendant
 * cleans up or registers a layout group effect.
 */
function CommitSentinel({ onCommit }: { onCommit: () => void }) {
  useCommitEffect(onCommit);
  return null;
}

/**
 * Provides a boundary for grouping layout effects.
 *
 * Descendant components can invoke the `useLayoutGroupEffect` hook to register
 * effects that run after all descendants within the group have processed their
 * regular layout effects.
 */
export function LayoutGroup({ children }: LayoutGroupProps) {
  const createQueue = useRef(new Set<() => void>()).current;
  const destroyQueue = useRef(new Set<() => void>()).current;
  const isMounted = useRef(false);

  const forceUpdate = useForceUpdate();
  const isUpdatePending = useRef(true);

  // This commit runs the group's own layout effect, which flushes both queues,
  // so registrations made during it must not force another render and commit.
  const markUpdatePending = useCallback(() => {
    isUpdatePending.current = true;
  }, []);

  const ensureFlush = useCallback(() => {
    if (!isUpdatePending.current) {
      forceUpdate();
      isUpdatePending.current = true;
    }
  }, [forceUpdate]);

  const register = useCallback<typeof useClientLayoutEffect>(
    (effect: EffectCallback) => {
      let destroy: ReturnType<EffectCallback>;
      const create = () => {
        destroy = effect();
      };

      createQueue.add(create);
      ensureFlush();

      return () => {
        createQueue.delete(create);
        if (destroy) {
          if (isMounted.current) {
            destroyQueue.add(destroy);
            ensureFlush();
          } else {
            destroy();
          }
        }
      };
    },
    [createQueue, destroyQueue, ensureFlush]
  );

  useClientLayoutEffect(() => {
    isUpdatePending.current = false;
    createQueue.forEach((create) => create());
    createQueue.clear();
    return () => {
      destroyQueue.forEach((destroy) => destroy());
      destroyQueue.clear();
    };
  });

  useClientLayoutEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  return (
    <LayoutGroupContext.Provider value={register}>
      <CommitSentinel onCommit={markUpdatePending} />
      {children}
    </LayoutGroupContext.Provider>
  );
}
