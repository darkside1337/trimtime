import { sql } from "drizzle-orm";
import {
  check,
  date,
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
    reservedAt: timestamp("reserved_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    invokedAt: timestamp("invoked_at", { withTimezone: true, mode: "date" }),
    outcome: text("outcome"),
    captureId: text("capture_id"),
  },
  (table) => [
    unique("notification_attempts_work_id_key").on(table.workId),
    unique("notification_attempts_id_work_key").on(table.id, table.workId),
    check(
      "notification_attempts_outcome_check",
      sql`${table.outcome} IS NULL OR ${table.outcome} IN ('accepted', 'captured', 'failed', 'unknown')`,
    ),
  ],
);
