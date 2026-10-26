import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { ActionResult } from "@/lib/action-result";
import type { OwnerContext } from "@/server/owner-context";
import type { NotificationActivityView } from "./types";

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
    SELECT w.id, w.booking_id AS "bookingId", w.kind, w.channel,
      CASE WHEN w.status = 'sending' AND w.claimed_at < ${now}::timestamptz - INTERVAL '30 seconds'
        THEN 'unknown' ELSE w.status END AS status,
      w.recipient,
      CASE WHEN w.status = 'sending' AND w.claimed_at < ${now}::timestamptz - INTERVAL '30 seconds'
        THEN 'dispatch_interrupted' ELSE w.reason END AS reason,
      w.created_at AS "createdAt", w.updated_at AS "updatedAt",
      a.id AS "attemptId", a.budget_day::text AS "budgetDay", a.reserved_at AS "reservedAt",
      a.invoked_at AS "invokedAt",
      CASE WHEN w.status = 'sending' AND w.claimed_at < ${now}::timestamptz - INTERVAL '30 seconds'
        THEN 'unknown' ELSE a.outcome END AS outcome,
      a.capture_id AS "captureId"
    FROM notification_work w
    JOIN bookings b ON b.id = w.booking_id
    JOIN shops s ON s.id = b.shop_id
    LEFT JOIN notification_attempts a ON a.work_id = w.id
    WHERE s.owner_id = ${context.userId}
    ORDER BY w.created_at DESC, w.id
  `);
  const rows = result.rows.map((row) => {
    const item = row as Record<string, unknown>;
    return {
      id: String(item.id),
      bookingId: String(item.bookingId),
      kind: item.kind as "customer_confirmation" | "owner_alert",
      channel: item.channel as "email" | "whatsapp",
      status: item.status as NotificationActivityView["rows"][number]["status"],
      recipient: item.recipient as string | null,
      reason: item.reason as string | null,
      createdAt: new Date(item.createdAt as Date).toISOString(),
      updatedAt: new Date(item.updatedAt as Date).toISOString(),
      attempt: item.attemptId
        ? {
            id: String(item.attemptId),
            budgetDay: String(item.budgetDay),
            reservedAt: new Date(item.reservedAt as Date).toISOString(),
            invokedAt: item.invokedAt
              ? new Date(item.invokedAt as Date).toISOString()
              : null,
            outcome: item.outcome as
              "accepted" | "captured" | "failed" | "unknown" | null,
            captureId: item.captureId as string | null,
          }
        : null,
    };
  });
  return { success: true, data: { rows } };
}
