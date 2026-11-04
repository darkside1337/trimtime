import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { notificationWork } from "@/db/schema/notification-work";
import { getReminderDueAt } from "@/features/notifications/reminder-policy";
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
    .set({
      status: "suppressed",
      reason: "superseded",
      nextAttemptAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(notificationWork.bookingId, bookingId),
        sql`${notificationWork.bookingRevision} < ${revision}`,
        sql`(${notificationWork.status}='not_attempted' OR
          (${notificationWork.status}='failed' AND ${notificationWork.reason}='transient_rejection' AND ${notificationWork.nextAttemptAt} IS NOT NULL))`,
      ),
    );
}

function channelState(emailConfig: EmailConfig, recipient: string | null) {
  return {
    status: !recipient
      ? ("skipped" as const)
      : emailConfig.mode === "mailpit"
        ? ("not_attempted" as const)
        : ("unavailable" as const),
    reason: !recipient
      ? "recipient_missing"
      : emailConfig.mode === "unavailable"
        ? emailConfig.reason
        : null,
  };
}

export async function stageCustomerReminder(
  tx: BookingTransaction,
  params: {
    bookingId: string;
    revision: number;
    changeId: string | null;
    contentIdentity: string;
    startAt: Date;
    now: Date;
    customerEmail: string | null;
    customerPhone: string | null;
    whatsappOptIn: boolean;
    emailConfig: EmailConfig;
  },
) {
  const dueAt = getReminderDueAt({ startAt: params.startAt, now: params.now });
  if (!dueAt) return;

  const email = channelState(params.emailConfig, params.customerEmail);
  const work: (typeof notificationWork.$inferInsert)[] = [
    {
      id: randomUUID(),
      bookingId: params.bookingId,
      bookingRevision: params.revision,
      changeId: params.changeId,
      kind: "customer_reminder",
      channel: "email",
      status: email.status,
      recipient: params.customerEmail,
      contentIdentity: params.contentIdentity,
      reason: email.reason,
      dueAt,
    },
  ];
  if (params.whatsappOptIn && params.customerPhone)
    work.push({
      id: randomUUID(),
      bookingId: params.bookingId,
      bookingRevision: params.revision,
      changeId: params.changeId,
      kind: "customer_reminder",
      channel: "whatsapp",
      status: "unavailable",
      recipient: params.customerPhone,
      contentIdentity: params.contentIdentity,
      reason: "channel_unavailable",
      dueAt,
    });
  await tx.insert(notificationWork).values(work);
}

export async function stageCustomerChangeNotifications(
  tx: BookingTransaction,
  params: {
    bookingId: string;
    revision: number;
    changeId: string;
    kind: "customer_move" | "customer_cancellation" | "customer_restoration";
    contentIdentity: string;
    customerEmail: string | null;
    customerPhone: string | null;
    whatsappOptIn: boolean;
    emailConfig: EmailConfig;
    ownerEmail?: string | null;
  },
) {
  const email = channelState(params.emailConfig, params.customerEmail);
  const work: (typeof notificationWork.$inferInsert)[] = [
    {
      id: randomUUID(),
      bookingId: params.bookingId,
      bookingRevision: params.revision,
      changeId: params.changeId,
      kind: params.kind,
      channel: "email",
      status: email.status,
      recipient: params.customerEmail,
      contentIdentity: params.contentIdentity,
      reason: email.reason,
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
  let ownerEmail = params.ownerEmail;
  if (ownerEmail === undefined) {
    const change = await tx.execute(
      sql`SELECT c.actor_type, u.email FROM booking_changes c JOIN shops s ON s.id=c.shop_id JOIN "user" u ON u.id=s.owner_id WHERE c.id=${params.changeId}`,
    );
    const row = change.rows[0] as
      { actor_type: string; email: string | null } | undefined;
    if (row?.actor_type === "customer") {
      ownerEmail = row.email ?? null;
    }
  }
  if (ownerEmail !== undefined && params.kind !== "customer_restoration") {
    const owner = channelState(params.emailConfig, ownerEmail);
    work.push({
      id: randomUUID(),
      bookingId: params.bookingId,
      bookingRevision: params.revision,
      changeId: params.changeId,
      kind:
        params.kind === "customer_cancellation"
          ? "owner_cancellation"
          : "owner_move",
      channel: "email",
      status: owner.status,
      recipient: ownerEmail,
      contentIdentity: params.contentIdentity,
      reason: owner.reason,
    });
  }
  await tx.insert(notificationWork).values(work);
}
