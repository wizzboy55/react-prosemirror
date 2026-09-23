import React, { useContext, useRef, useState } from "react";

import { browser } from "../browser.js";
import { ChildDescriptionsContext } from "../contexts/ChildDescriptionsContext.js";
import { EditorContext } from "../contexts/EditorContext.js";
import { useClientLayoutEffect } from "../hooks/useClientLayoutEffect.js";
import { useEffectEvent } from "../hooks/useEffectEvent.js";
import { TrailingHackViewDesc, sortViewDescs } from "../viewdesc.js";

type Props = {
  getPos: () => number;
};

export function SeparatorHackView({ getPos }: Props) {
  const editor = useContext(EditorContext);
  const { siblingsRef, parentRef } = useContext(ChildDescriptionsContext);
  const viewDescRef = useRef<TrailingHackViewDesc | null>(null);
  const ref = useRef<HTMLImageElement | null>(null);
  const [shouldRender, setShouldRender] = useState(false);

  useClientLayoutEffect(() => {
    const siblings = siblingsRef.current;
    return () => {
      if (!viewDescRef.current) return;
      if (siblings.includes(viewDescRef.current)) {
        const index = siblings.indexOf(viewDescRef.current);
        siblings.splice(index, 1);
      }
    };
  }, [siblingsRef]);

  const layout = useEffectEvent(() => {
    const nonHackSiblings = siblingsRef.current.filter(
      (viewdesc) => !(viewdesc instanceof TrailingHackViewDesc)
    );
    const lastSibling = nonHackSiblings[nonHackSiblings.length - 1];
    if (
      (browser.safari || browser.chrome) &&
      (lastSibling?.dom as HTMLElement)?.contentEditable == "false"
    ) {
      setShouldRender(true);
      return;
    }

    if (!ref.current) return;

    if (!viewDescRef.current) {
      viewDescRef.current = new TrailingHackViewDesc(
        parentRef.current,
        [],
        getPos,
        ref.current,
        null
      );
    } else {
      viewDescRef.current.parent = parentRef.current;
      viewDescRef.current.dom = ref.current;
    }
    if (!siblingsRef.current.includes(viewDescRef.current)) {
      siblingsRef.current.push(viewDescRef.current);
    }
    siblingsRef.current.sort(sortViewDescs);
  });

  // There's no risk of an infinite loop here, because
  // we call setShouldRender conditionally
  useClientLayoutEffect(() => {
    // The sibling node views build their descriptions when the document
    // mounts its view: check them then, later in this commit.
    if (editor.isViewPending()) return editor.whenViewReady(layout);
    layout();
    return undefined;
  });

  return shouldRender ? (
    <img ref={ref} className="ProseMirror-separator" alt="" />
  ) : null;
}
