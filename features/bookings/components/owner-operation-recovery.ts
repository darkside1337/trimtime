export type OwnerOperationMode = "move" | "cancel" | "restore";

export type OwnerOperationTerminalAction = "reload" | "review" | "refresh";

export type OwnerOperationFailure =
  | {
      kind: "retain";
      code: string | null;
      terminalAction: null;
    }
  | {
      kind: "mismatch";
      code: "RECOVERY_MISMATCH";
      terminalAction: "refresh";
    }
  | {
      kind: "terminal";
      code: string;
      terminalAction: OwnerOperationTerminalAction;
    };

// Move, cancel, and restore look up an identical operation-key replay before
// checking the fresh revision, state, offer, schedule, or occupancy. Only these
// denials happen after that lookup, so only they prove the identical request did
// not commit. Authority, validation, pre-replay, and unknown failures cannot
// establish that.
const PROVEN_POST_REPLAY_DENIAL_CODES = new Set([
  "STALE_BOOKING",
  "INVALID_STATE",
  "STALE_OFFER",
  "UNAVAILABLE_INTERVAL",
  "NO_CHANGE",
]);

export const RECOVERY_MISMATCH_WARNING =
  "This attempt used a different request from the one saved earlier. We cannot confirm whether that earlier attempt completed. Refresh the appointment to review its latest saved state before trying again.";

export const UNCONFIRMED_OPERATION_MESSAGE =
  "The operation may have completed. Retry the same operation to recover its result.";

export function classifyOwnerOperationFailure(
  mode: OwnerOperationMode,
  code: string | undefined,
): OwnerOperationFailure {
  if (code === "RECOVERY_MISMATCH")
    return {
      kind: "mismatch",
      code: "RECOVERY_MISMATCH",
      terminalAction: "refresh",
    };
  if (code !== undefined && PROVEN_POST_REPLAY_DENIAL_CODES.has(code))
    return {
      kind: "terminal",
      code,
      terminalAction:
        mode === "move"
          ? code === "STALE_BOOKING"
            ? "reload"
            : "review"
          : "refresh",
    };
  return { kind: "retain", code: code ?? null, terminalAction: null };
}
