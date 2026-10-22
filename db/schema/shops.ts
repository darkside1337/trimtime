import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const shops = pgTable(
  "shops",
  {
    id: text("id").primaryKey(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    subdomain: text("subdomain").notNull(),
    timeZone: text("time_zone").notNull(),
    publicContact: text("public_contact").notNull(),
    address: text("address").notNull(),
    published: boolean("published").notNull().default(false),
    timeZoneLockedAt: timestamp("time_zone_locked_at"),
  },
  (table) => [
    unique("shops_owner_id_key").on(table.ownerId),
    unique("shops_subdomain_key").on(table.subdomain),
    check(
      "shops_subdomain_check",
      sql`${table.subdomain} ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$' AND ${table.subdomain} NOT IN ('app', 'www', 'api', 'admin')`,
    ),
  ],
);
