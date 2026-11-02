import { describe, expect, it } from "vitest";
import {
  PUBLICATION_UNKNOWN_FEEDBACK,
  publicationFeedbackFromError,
} from "../components/publication-feedback";

describe("publication feedback", () => {
  it("asks for a refresh from the stale-publication code, not its wording", () => {
    const feedback = publicationFeedbackFromError({
      code: "STALE_PUBLICATION",
      message: "Changed somewhere else.",
    });

    expect(feedback).toEqual({
      message: "Changed somewhere else.",
      refreshRequired: true,
      outcome: "rejected",
    });
  });

  it("does not offer a refresh for an ordinary save failure", () => {
    expect(
      publicationFeedbackFromError({
        code: "SAVE_FAILED",
        message: "Unable to update publication. Try again.",
      }),
    ).toEqual({
      message: "Unable to update publication. Try again.",
      refreshRequired: false,
      outcome: "rejected",
    });
  });

  it("does not let stale-copy wording trigger the refresh action", () => {
    expect(
      publicationFeedbackFromError({
        code: "SAVE_FAILED",
        message: "Publication changed in another tab. Refresh to see it.",
      }).refreshRequired,
    ).toBe(false);
  });

  it("models a lost response as unknown rather than a confirmed failure", () => {
    expect(PUBLICATION_UNKNOWN_FEEDBACK).toEqual({
      message:
        "Connection lost. Refresh publication status to check whether the change saved.",
      refreshRequired: true,
      outcome: "unknown",
    });
    expect(PUBLICATION_UNKNOWN_FEEDBACK.message).not.toMatch(
      /did not save|was not saved|failed to save/i,
    );
  });
});
