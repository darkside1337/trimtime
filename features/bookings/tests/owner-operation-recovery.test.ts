import { describe, expect, it } from "vitest";
import {
  classifyOwnerOperationFailure,
  RECOVERY_MISMATCH_WARNING,
  UNCONFIRMED_OPERATION_MESSAGE,
  type OwnerOperationMode,
} from "../components/owner-operation-recovery";

describe("owner appointment operation recovery", () => {
  it.each([
    "UNAVAILABLE",
    "UNAUTHENTICATED",
    "VALIDATION_ERROR",
    "SHOP_REQUIRED",
    "NOT_FOUND",
    "UNKNOWN_FUTURE_CODE",
    undefined,
  ])(
    "keeps the identical request recoverable for %s",
    (code: string | undefined) => {
      for (const mode of ["move", "cancel", "restore"] as const) {
        expect(classifyOwnerOperationFailure(mode, code)).toEqual({
          kind: "retain",
          code: code ?? null,
          terminalAction: null,
        });
      }
    },
  );

  it.each([
    "STALE_BOOKING",
    "INVALID_STATE",
    "STALE_OFFER",
    "UNAVAILABLE_INTERVAL",
    "NO_CHANGE",
  ])("treats %s as a proven post-replay denial", (code) => {
    expect(classifyOwnerOperationFailure("cancel", code)).toMatchObject({
      kind: "terminal",
      code,
    });
    expect(classifyOwnerOperationFailure("restore", code)).toMatchObject({
      kind: "terminal",
      code,
    });
  });

  it("chooses the move follow-up from the code, not the message", () => {
    expect(classifyOwnerOperationFailure("move", "STALE_BOOKING")).toEqual({
      kind: "terminal",
      code: "STALE_BOOKING",
      terminalAction: "reload",
    });
    for (const code of [
      "INVALID_STATE",
      "STALE_OFFER",
      "UNAVAILABLE_INTERVAL",
      "NO_CHANGE",
    ]) {
      expect(classifyOwnerOperationFailure("move", code)).toEqual({
        kind: "terminal",
        code,
        terminalAction: "review",
      });
    }
  });

  it.each(["move", "cancel", "restore"] as OwnerOperationMode[])(
    "marks %s mismatch as ambiguous with an authoritative refresh path",
    (mode) => {
      expect(classifyOwnerOperationFailure(mode, "RECOVERY_MISMATCH")).toEqual({
        kind: "mismatch",
        code: "RECOVERY_MISMATCH",
        terminalAction: "refresh",
      });
    },
  );

  it("does not claim the earlier attempt failed or that retry can recover it", () => {
    expect(RECOVERY_MISMATCH_WARNING).toMatch(/cannot confirm/i);
    expect(RECOVERY_MISMATCH_WARNING).toMatch(/refresh/i);
    expect(RECOVERY_MISMATCH_WARNING).not.toMatch(/retry/i);
    expect(RECOVERY_MISMATCH_WARNING).not.toMatch(/did not complete/i);
    expect(UNCONFIRMED_OPERATION_MESSAGE).toMatch(/may have completed/i);
    expect(UNCONFIRMED_OPERATION_MESSAGE).toMatch(/retry/i);
  });
});
