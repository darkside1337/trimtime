export type NotificationStatus =
  | "unavailable"
  | "not_attempted"
  | "sending"
  | "accepted"
  | "captured"
  | "failed"
  | "skipped"
  | "suppressed"
  | "unknown";

export type NotificationActivityRow = {
  id: string;
  bookingId: string;
  creationSource: "public" | "owner";
  kind:
    | "customer_confirmation"
    | "owner_alert"
    | "customer_move"
    | "customer_cancellation"
    | "customer_restoration"
    | "customer_reminder"
    | "owner_cancellation"
    | "owner_move";
  channel: "email" | "whatsapp";
  status: NotificationStatus;
  recipient: string | null;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
  dueAt: string | null;
  nextAttemptAt: string | null;
  attempt: null | {
    id: string;
    attemptNumber: number;
    budgetDay: string;
    reservedAt: string;
    invokedAt: string | null;
    outcome: "accepted" | "captured" | "failed" | "unknown" | null;
    captureId: string | null;
    reason: string | null;
    finishedAt: string | null;
  };
  attempts: Array<NonNullable<NotificationActivityRow["attempt"]>>;
};

export type NotificationActivityView = { rows: NotificationActivityRow[] };

export type BookingChangeActivityRow = {
  id: string;
  bookingId: string;
  kind: "move" | "cancel" | "restore" | "attendance";
  actorType: "owner" | "customer";
  revision: number;
  committedAt: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

export type BookingChangeActivityView = { rows: BookingChangeActivityRow[] };
