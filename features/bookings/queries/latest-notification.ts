import "server-only";
import { and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookings } from "@/db/schema/bookings";
import { notificationWork } from "@/db/schema/notification-work";

export function latestEmailNotification() {
  const applicableRevision = sql<number>`COALESCE(
    (
      SELECT MAX(c.applied_revision)
      FROM booking_changes c
      WHERE c.booking_id = ${bookings.id}
        AND c.kind IN ('move', 'cancel', 'restore')
    ),
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM booking_changes c
        WHERE c.booking_id = ${bookings.id}
          AND c.kind = 'attendance'
      ) THEN 0
      WHEN ${bookings.revision} = 0 THEN 0
      ELSE NULL
    END
  )`;
  return db
    .select({
      status: notificationWork.status,
      reason: notificationWork.reason,
      claimedAt: notificationWork.claimedAt,
      updatedAt: notificationWork.updatedAt,
    })
    .from(notificationWork)
    .where(
      and(
        eq(notificationWork.bookingId, bookings.id),
        eq(notificationWork.channel, "email"),
        eq(notificationWork.bookingRevision, applicableRevision),
        or(
          and(
            eq(notificationWork.bookingRevision, 0),
            eq(notificationWork.kind, "customer_confirmation"),
          ),
          and(
            gt(notificationWork.bookingRevision, 0),
            inArray(notificationWork.kind, [
              "customer_move",
              "customer_cancellation",
              "customer_restoration",
            ]),
          ),
        ),
      ),
    )
    .orderBy(desc(notificationWork.createdAt))
    .limit(1)
    .as("latest_email_notification");
}
