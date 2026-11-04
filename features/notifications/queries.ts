import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import type { OwnerContext } from "@/server/owner-context";
import type {
  BookingChangeActivityView,
  NotificationActivityView,
} from "./types";

export async function getOwnNotificationActivity(
  context: OwnerContext | null,
  now = new Date(),
): Promise<ActionResult<NotificationActivityView>> {
  if (!context?.userId)
    return {
      success: false,
      error: { code: "UNAUTHORIZED", message: "Sign in to view activity." },
    };

  const result = await db.execute(sql`
    SELECT w.id, w.booking_id AS "bookingId", b.creation_source AS "creationSource", w.kind, w.channel,
      CASE WHEN w.status = 'sending' AND w.claimed_at < ${now}::timestamptz - INTERVAL '30 seconds'
        THEN 'unknown' ELSE w.status END AS status,
      w.recipient,
      CASE WHEN w.status = 'sending' AND w.claimed_at < ${now}::timestamptz - INTERVAL '30 seconds'
        THEN 'dispatch_interrupted' ELSE w.reason END AS reason,
      w.created_at AS "createdAt", w.updated_at AS "updatedAt",
      w.due_at AS "dueAt", w.next_attempt_at AS "nextAttemptAt",
      a.id AS "attemptId", a.attempt_number AS "attemptNumber",
      a.budget_day::text AS "budgetDay", a.reserved_at AS "reservedAt",
      a.invoked_at AS "invokedAt",
      CASE WHEN w.status = 'sending' AND w.claimed_at < ${now}::timestamptz - INTERVAL '30 seconds'
        AND a.attempt_number = (
          SELECT max(current_attempt.attempt_number)
          FROM notification_attempts current_attempt
          WHERE current_attempt.work_id = w.id
        )
        THEN 'unknown' ELSE a.outcome END AS outcome,
      a.capture_id AS "captureId", a.reason AS "attemptReason", a.finished_at AS "finishedAt"
    FROM notification_work w
    JOIN bookings b ON b.id = w.booking_id
    JOIN shops s ON s.id = b.shop_id
    LEFT JOIN notification_attempts a ON a.work_id = w.id
    WHERE s.owner_id = ${context.userId}
    ORDER BY w.created_at DESC, w.id, a.attempt_number
  `);
  const byWork = new Map<string, NotificationActivityView["rows"][number]>();
  for (const row of result.rows) {
    const item = row as Record<string, unknown>;
    let activity = byWork.get(String(item.id));
    if (!activity) {
      activity = {
        id: String(item.id),
        bookingId: String(item.bookingId),
        creationSource: item.creationSource as "public" | "owner",
        kind: item.kind as NotificationActivityView["rows"][number]["kind"],
        channel: item.channel as "email" | "whatsapp",
        status:
          item.status as NotificationActivityView["rows"][number]["status"],
        recipient: item.recipient as string | null,
        reason: item.reason as string | null,
        createdAt: new Date(item.createdAt as Date).toISOString(),
        updatedAt: new Date(item.updatedAt as Date).toISOString(),
        dueAt: item.dueAt ? new Date(item.dueAt as Date).toISOString() : null,
        nextAttemptAt: item.nextAttemptAt
          ? new Date(item.nextAttemptAt as Date).toISOString()
          : null,
        attempt: null,
        attempts: [],
      };
      byWork.set(activity.id, activity);
    }
    if (item.attemptId) {
      const attempt = {
        id: String(item.attemptId),
        attemptNumber: Number(item.attemptNumber),
        budgetDay: String(item.budgetDay),
        reservedAt: new Date(item.reservedAt as Date).toISOString(),
        invokedAt: item.invokedAt
          ? new Date(item.invokedAt as Date).toISOString()
          : null,
        outcome: item.outcome as
          "accepted" | "captured" | "failed" | "unknown" | null,
        captureId: item.captureId as string | null,
        reason: item.attemptReason as string | null,
        finishedAt: item.finishedAt
          ? new Date(item.finishedAt as Date).toISOString()
          : null,
      };
      activity.attempts.push(attempt);
      activity.attempt = attempt;
    }
  }
  const rows = [...byWork.values()];
  return { success: true, data: { rows } };
}

export async function getOwnBookingActivity(
  context: OwnerContext | null,
): Promise<ActionResult<BookingChangeActivityView>> {
  if (!context?.userId)
    return {
      success: false,
      error: { code: "UNAUTHORIZED", message: "Sign in to view activity." },
    };
  const result = await db.execute(sql`
    SELECT c.id, c.booking_id AS "bookingId", c.kind,
      c.actor_type AS "actorType",
      c.applied_revision AS revision, c.committed_at AS "committedAt",
      c.before_snapshot AS before, c.after_snapshot AS after
    FROM booking_changes c
    JOIN shops s ON s.id=c.shop_id
    WHERE s.owner_id=${context.userId}
    ORDER BY c.committed_at DESC, c.applied_revision DESC, c.id DESC
  `);
  return {
    success: true,
    data: {
      rows: result.rows.map((row) => {
        const item = row as Record<string, unknown>;
        return {
          id: String(item.id),
          bookingId: String(item.bookingId),
          kind: item.kind as "move" | "cancel" | "restore" | "attendance",
          actorType: item.actorType as "owner" | "customer",
          revision: Number(item.revision),
          committedAt: new Date(item.committedAt as Date).toISOString(),
          before: item.before as Record<string, unknown>,
          after: item.after as Record<string, unknown>,
        };
      }),
    },
  };
}
