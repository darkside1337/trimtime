import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const publicRateKeys = pgTable(
  "public_rate_keys",
  {
    scope: text("scope").notNull(),
    keyHash: text("key_hash").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.scope, table.keyHash] }),
    check(
      "public_rate_keys_scope_check",
      sql`${table.scope} IN ('create_email_shop', 'customer_change_link')`,
    ),
  ],
);

export const publicRateEvents = pgTable(
  "public_rate_events",
  {
    id: uuid("id").primaryKey(),
    scope: text("scope").notNull(),
    keyHash: text("key_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    foreignKey({
      name: "public_rate_events_key_fkey",
      columns: [table.scope, table.keyHash],
      foreignColumns: [publicRateKeys.scope, publicRateKeys.keyHash],
    }).onDelete("cascade"),
    index("public_rate_events_scope_key_created_idx").on(
      table.scope,
      table.keyHash,
      table.createdAt,
    ),
  ],
);
