import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  integer,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { bookings } from "./bookings";
import { shops } from "./shops";

export const bookingChanges = pgTable(
  "booking_changes",
  {
    id: uuid("id").primaryKey(),
    shopId: text("shop_id").notNull(),
    bookingId: uuid("booking_id").notNull(),
    actorId: text("actor_id").references(() => user.id, {
      onDelete: "cascade",
    }),
    actorType: text("actor_type").notNull().default("owner"),
    kind: text("kind").notNull(),
    appliedRevision: integer("applied_revision").notNull(),
    committedAt: timestamp("committed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    operationKeyHash: text("operation_key_hash").notNull(),
    payloadDigest: text("payload_digest").notNull(),
    beforeSnapshot: jsonb("before_snapshot").notNull(),
    afterSnapshot: jsonb("after_snapshot").notNull(),
  },
  (table) => [
    foreignKey({
      name: "booking_changes_shop_fkey",
      columns: [table.shopId],
      foreignColumns: [shops.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "booking_changes_shop_booking_fkey",
      columns: [table.shopId, table.bookingId],
      foreignColumns: [bookings.shopId, bookings.id],
    }).onDelete("cascade"),
    unique("booking_changes_shop_operation_key_key").on(
      table.shopId,
      table.operationKeyHash,
    ),
    unique("booking_changes_booking_revision_key").on(
      table.bookingId,
      table.appliedRevision,
    ),
    unique("booking_changes_id_booking_key").on(table.id, table.bookingId),
    check(
      "booking_changes_kind_check",
      sql`${table.kind} IN ('move', 'cancel')`,
    ),
    check(
      "booking_changes_actor_type_check",
      sql`${table.actorType} IN ('owner', 'customer')`,
    ),
    check(
      "booking_changes_actor_check",
      sql`(${table.actorType} = 'owner' AND ${table.actorId} IS NOT NULL) OR (${table.actorType} = 'customer' AND ${table.actorId} IS NULL AND ${table.kind} IN ('cancel', 'move'))`,
    ),
    check("booking_changes_revision_check", sql`${table.appliedRevision} > 0`),
  ],
);
