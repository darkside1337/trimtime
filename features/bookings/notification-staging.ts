import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { notificationWork } from "@/db/schema/notification-work";
import type { EmailConfig } from "@/features/notifications/config";
import type { BookingTransaction } from "./creation-primitives";

export async function suppressSupersededNotificationWork(
  tx: BookingTransaction,
  bookingId: string,
  revision: number,
  now: Date,
) {
  await tx
    .update(notificationWork)
    .set({ status: "suppressed", reason: "superseded", updatedAt: now })
    .where(
      and(
        eq(notificationWork.bookingId, bookingId),
        sql`${notificationWork.bookingRevision} < ${revision}`,
        eq(notificationWork.status, "not_attempted"),
      ),
    );
}

export async function stageCustomerChangeNotifications(
  tx: BookingTransaction,
  params: {
    bookingId: string;
    revision: number;
    changeId: string;
    kind: "customer_move" | "customer_cancellation";
    contentIdentity: string;
    customerEmail: string | null;
    customerPhone: string | null;
    whatsappOptIn: boolean;
    emailConfig: EmailConfig;
  },
) {
  const emailStatus = !params.customerEmail
    ? "skipped"
    : params.emailConfig.mode === "mailpit"
      ? "not_attempted"
      : "unavailable";
  const emailReason = !params.customerEmail
    ? "recipient_missing"
    : params.emailConfig.mode === "unavailable"
      ? params.emailConfig.reason
      : null;
  const work: (typeof notificationWork.$inferInsert)[] = [
    {
      id: randomUUID(),
      bookingId: params.bookingId,
      bookingRevision: params.revision,
      changeId: params.changeId,
      kind: params.kind,
      channel: "email",
      status: emailStatus,
      recipient: params.customerEmail,
      contentIdentity: params.contentIdentity,
      reason: emailReason,
    },
  ];
  if (params.whatsappOptIn && params.customerPhone)
    work.push({
      id: randomUUID(),
      bookingId: params.bookingId,
      bookingRevision: params.revision,
      changeId: params.changeId,
      kind: params.kind,
      channel: "whatsapp",
      status: "unavailable",
      recipient: params.customerPhone,
      contentIdentity: params.contentIdentity,
      reason: "channel_unavailable",
    });
  await tx.insert(notificationWork).values(work);
}
