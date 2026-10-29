import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { bookings } from "./bookings";
import { bookingChanges } from "./booking-changes";

export const notificationWork = pgTable(
  "notification_work",
  {
    id: uuid("id").primaryKey(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    bookingRevision: integer("booking_revision").notNull().default(0),
    changeId: uuid("change_id"),
    kind: text("kind").notNull(),
    channel: text("channel").notNull(),
    status: text("status").notNull(),
    recipient: text("recipient"),
    contentIdentity: text("content_identity"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true, mode: "date" }),
    claimId: uuid("claim_id"),
  },
  (table) => [
    unique("notification_work_booking_kind_channel_key").on(
      table.bookingId,
      table.bookingRevision,
      table.kind,
      table.channel,
    ),
    foreignKey({
      name: "notification_work_change_booking_fkey",
      columns: [table.changeId, table.bookingId],
      foreignColumns: [bookingChanges.id, bookingChanges.bookingId],
    }).onDelete("cascade"),
    check(
      "notification_work_change_kind_check",
      sql`(${table.kind} IN ('customer_move', 'customer_cancellation') AND ${table.changeId} IS NOT NULL AND ${table.bookingRevision} > 0) OR (${table.kind} = 'owner_cancellation' AND ${table.changeId} IS NOT NULL AND ${table.bookingRevision} > 0 AND ${table.channel} = 'email') OR (${table.kind} IN ('customer_confirmation', 'owner_alert') AND ${table.changeId} IS NULL AND ${table.bookingRevision} = 0)`,
    ),
    check(
      "notification_work_kind_check",
      sql`${table.kind} IN ('customer_confirmation', 'owner_alert', 'customer_move', 'customer_cancellation', 'owner_cancellation')`,
    ),
    check(
      "notification_work_channel_check",
      sql`${table.channel} IN ('email', 'whatsapp')`,
    ),
    check(
      "notification_work_status_check",
      sql`${table.status} IN ('unavailable', 'not_attempted', 'sending', 'accepted', 'captured', 'failed', 'skipped', 'suppressed', 'unknown')`,
    ),
    index("notification_work_booking_created_idx").on(
      table.bookingId,
      table.createdAt,
    ),
    uniqueIndex("notification_work_claim_id_key")
      .on(table.claimId)
      .where(sql`${table.claimId} IS NOT NULL`),
  ],
);
