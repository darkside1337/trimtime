import type { NotificationStatus } from "./types";

export type CustomerEmailReason =
  | "booking_no_longer_eligible"
  | "capture_result_unknown"
  | "capture_verification_unavailable"
  | "confirmation_unavailable"
  | "daily_limit_reached"
  | "email_unavailable"
  | "message_rejected"
  | "recipient_unavailable";

export type CustomerEmailSummary = {
  status: NotificationStatus;
  reason: CustomerEmailReason | null;
  updatedAt: string | null;
};

const safeReasons: Record<string, CustomerEmailReason> = {
  booking_changed: "booking_no_longer_eligible",
  capability_unavailable: "confirmation_unavailable",
  capture_attempt_mismatch: "capture_verification_unavailable",
  capture_recipient_mismatch: "capture_verification_unavailable",
  capture_verification_unavailable: "capture_verification_unavailable",
  daily_budget_exhausted: "daily_limit_reached",
  disabled: "email_unavailable",
  hosted: "email_unavailable",
  invalid_config: "email_unavailable",
  invocation_evidence_failed: "capture_result_unknown",
  malformed_success_response: "capture_result_unknown",
  message_render_failed: "confirmation_unavailable",
  permanent_rejection: "message_rejected",
  recipient_missing: "recipient_unavailable",
  transient_rejection: "message_rejected",
  transport_interrupted: "capture_result_unknown",
  work_no_longer_eligible: "booking_no_longer_eligible",
};

export function customerEmailSummary(
  input: {
    status: NotificationStatus | null;
    reason: string | null;
    claimedAt: Date | string | null;
    updatedAt: Date | string | null;
  },
  now: Date,
): CustomerEmailSummary {
  let status = input.status ?? "unavailable";
  let reason = input.reason ? (safeReasons[input.reason] ?? null) : null;
  if (
    status === "sending" &&
    input.claimedAt &&
    new Date(input.claimedAt).getTime() < now.getTime() - 30_000
  ) {
    status = "unknown";
    reason = "capture_result_unknown";
  }
  return {
    status,
    reason,
    updatedAt: input.updatedAt ? new Date(input.updatedAt).toISOString() : null,
  };
}

export function customerEmailStatusCopy(summary: CustomerEmailSummary) {
  const { status, reason } = summary;
  if (reason === "daily_limit_reached")
    return "Today's local message allowance is full. Your booking and private link remain usable.";
  if (reason === "message_rejected")
    return "The local capture service rejected the confirmation. Your booking and private link remain usable.";
  if (reason === "recipient_unavailable")
    return "A confirmation recipient is unavailable. Your booking and private link remain usable.";
  if (reason === "booking_no_longer_eligible")
    return "Booking details changed before the confirmation could be captured. Your booking link remains usable.";
  if (reason === "confirmation_unavailable")
    return "The confirmation could not be prepared. Your booking and private link remain usable.";
  if (reason === "capture_result_unknown")
    return "The capture result is unknown. Your booking and private link remain usable.";
  if (reason === "capture_verification_unavailable")
    return "Accepted by the local capture service; capture verification is unavailable. Inbox delivery is not enabled.";
  if (reason === "email_unavailable")
    return "Email confirmations are unavailable in this demo. Your booking and private link are ready.";
  switch (status) {
    case "not_attempted":
    case "sending":
      return "Your confirmation is pending local capture. Your booking and private link are ready.";
    case "accepted":
      return "Accepted by the local capture service. Capture verification is unavailable; inbox delivery is not enabled.";
    case "captured":
      return "Captured locally. Inbox delivery is not enabled.";
    case "failed":
      return "The confirmation could not be captured. Your booking and private link remain usable.";
    case "skipped":
      return "The confirmation was skipped. Your booking and private link remain usable.";
    case "suppressed":
      return "The confirmation was not sent. Your booking and private link remain usable.";
    case "unknown":
      return "The capture result is unknown. Your booking and private link remain usable.";
    case "unavailable":
      return "Email confirmations are unavailable in this demo. Your booking and private link are ready.";
  }
}
