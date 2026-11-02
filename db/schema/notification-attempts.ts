import { sql } from "drizzle-orm";
import {
  check,
  date,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { notificationWork } from "./notification-work";
import { outboundBudget } from "./outbound-budget";

export const notificationAttempts = pgTable(
  "notification_attempts",
  {
    id: uuid("id").primaryKey(),
    workId: uuid("work_id")
      .notNull()
      .references(() => notificationWork.id, { onDelete: "cascade" }),
    budgetDay: date("budget_day")
      .notNull()
      .references(() => outboundBudget.day),
    attemptNumber: integer("attempt_number").notNull().default(1),
    reservedAt: timestamp("reserved_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    invokedAt: timestamp("invoked_at", { withTimezone: true, mode: "date" }),
    outcome: text("outcome"),
    captureId: text("capture_id"),
    reason: text("reason"),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    unique("notification_attempts_work_attempt_number_key").on(
      table.workId,
      table.attemptNumber,
    ),
    unique("notification_attempts_id_work_key").on(table.id, table.workId),
    check(
      "notification_attempts_attempt_number_check",
      sql`${table.attemptNumber} BETWEEN 1 AND 3`,
    ),
    check(
      "notification_attempts_outcome_check",
      sql`${table.outcome} IS NULL OR ${table.outcome} IN ('accepted', 'captured', 'failed', 'unknown')`,
    ),
  ],
);
