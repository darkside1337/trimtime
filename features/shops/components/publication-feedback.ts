import type { ActionError } from "@/lib/action-result";

/**
 * The attempted publication change was rejected, or its outcome is unknown.
 * Only `rejected` may be presented as a definite non-save; `unknown` must say
 * that a refresh is needed to establish the current publication state.
 */
export type PublicationFeedback = {
  message: string;
  refreshRequired: boolean;
  outcome: "rejected" | "unknown";
};

export function publicationFeedbackFromError(
  error: ActionError,
): PublicationFeedback {
  return {
    message: error.message,
    refreshRequired: error.code === "STALE_PUBLICATION",
    outcome: "rejected",
  };
}

export const PUBLICATION_UNKNOWN_FEEDBACK: PublicationFeedback = {
  message:
    "Connection lost. Refresh publication status to check whether the change saved.",
  refreshRequired: true,
  outcome: "unknown",
};
