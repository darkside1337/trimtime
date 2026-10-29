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
    | "owner_cancellation";
  channel: "email" | "whatsapp";
  status: NotificationStatus;
  recipient: string | null;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
  attempt: null | {
    id: string;
    budgetDay: string;
    reservedAt: string;
    invokedAt: string | null;
    outcome: "accepted" | "captured" | "failed" | "unknown" | null;
    captureId: string | null;
  };
};

export type NotificationActivityView = { rows: NotificationActivityRow[] };

export type BookingChangeActivityRow = {
  id: string;
  bookingId: string;
  kind: "move" | "cancel";
  actorType: "owner" | "customer";
  revision: number;
  committedAt: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

export type BookingChangeActivityView = { rows: BookingChangeActivityRow[] };
