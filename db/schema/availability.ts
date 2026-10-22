import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  jsonb,
  integer,
  pgTable,
  primaryKey,
  text,
} from "drizzle-orm/pg-core";
import type { WeeklySchedule } from "@/features/availability/types";
import { barbers } from "./catalog";
import { shops } from "./shops";

export const shopSchedules = pgTable(
  "shop_schedules",
  {
    shopId: text("shop_id")
      .primaryKey()
      .references(() => shops.id, { onDelete: "cascade" }),
    week: jsonb("week").$type<WeeklySchedule>().notNull(),
    revision: integer("revision").notNull(),
  },
  (table) => [
    check(
      "shop_schedules_week_check",
      sql`jsonb_typeof(${table.week}) = 'array' AND jsonb_array_length(${table.week}) = 7`,
    ),
    check("shop_schedules_revision_check", sql`${table.revision} > 0`),
  ],
);

export const barberSchedules = pgTable(
  "barber_schedules",
  {
    shopId: text("shop_id").notNull(),
    barberId: text("barber_id").notNull(),
    week: jsonb("week").$type<WeeklySchedule>().notNull(),
    revision: integer("revision").notNull(),
  },
  (table) => [
    primaryKey({
      name: "barber_schedules_pkey",
      columns: [table.shopId, table.barberId],
    }),
    foreignKey({
      name: "barber_schedules_barber_fkey",
      columns: [table.shopId, table.barberId],
      foreignColumns: [barbers.shopId, barbers.id],
    }).onDelete("cascade"),
    check(
      "barber_schedules_week_check",
      sql`jsonb_typeof(${table.week}) = 'array' AND jsonb_array_length(${table.week}) = 7`,
    ),
    check("barber_schedules_revision_check", sql`${table.revision} > 0`),
  ],
);
