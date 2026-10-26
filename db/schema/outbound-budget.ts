import { sql } from "drizzle-orm";
import { check, date, integer, pgTable } from "drizzle-orm/pg-core";

export const outboundBudget = pgTable(
  "outbound_budget",
  {
    day: date("day").primaryKey(),
    allocationCount: integer("allocation_count").notNull().default(0),
  },
  (table) => [
    check(
      "outbound_budget_allocation_count_check",
      sql`${table.allocationCount} BETWEEN 0 AND 100`,
    ),
  ],
);
