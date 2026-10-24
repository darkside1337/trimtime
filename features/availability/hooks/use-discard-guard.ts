"use client";

import { useCallback, useRef, useState } from "react";

export function useDiscardGuard(isDirty: boolean, onDiscard?: () => void) {
  const pendingAction = useRef<(() => void) | null>(null);
  const [open, setOpen] = useState(false);
  const [hasPendingLoad, setHasPendingLoad] = useState(false);

  const guard = useCallback(
    (
      action: () => void,
      cleanAction: () => void = action,
      pendingLoad = false,
    ) => {
      if (!isDirty) {
        cleanAction();
        return false;
      }
      pendingAction.current = action;
      setHasPendingLoad(pendingLoad);
      setOpen(true);
      return true;
    },
    [isDirty],
  );

  const keepEditing = useCallback(() => {
    pendingAction.current = null;
    setHasPendingLoad(false);
    setOpen(false);
  }, []);

  const discard = useCallback(() => {
    const action = pendingAction.current;
    pendingAction.current = null;
    setHasPendingLoad(false);
    setOpen(false);
    onDiscard?.();
    action?.();
  }, [onDiscard]);

  return {
    open,
    hasPendingLoad,
    guard,
    keepEditing,
    discard,
  };
}
