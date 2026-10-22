import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  primaryKey,
  text,
  unique,
} from "drizzle-orm/pg-core";
import { shops } from "./shops";

export const services = pgTable(
  "services",
  {
    id: text("id").primaryKey(),
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    priceUsd: numeric("price_usd").notNull(),
    durationMinutes: numeric("duration_minutes").notNull(),
    offered: boolean("offered").notNull().default(true),
    archived: boolean("archived").notNull().default(false),
  },
  (table) => [
    unique("services_shop_id_id_key").on(table.shopId, table.id),
    check(
      "services_price_usd_check",
      sql`${table.priceUsd} >= 0 AND ${table.priceUsd} < 'Infinity'::numeric AND scale(${table.priceUsd}) <= 2`,
    ),
    check(
      "services_duration_minutes_check",
      sql`${table.durationMinutes} >= 30 AND ${table.durationMinutes} < 'Infinity'::numeric AND ${table.durationMinutes} = trunc(${table.durationMinutes})`,
    ),
  ],
);

export const barbers = pgTable(
  "barbers",
  {
    id: text("id").primaryKey(),
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    archived: boolean("archived").notNull().default(false),
  },
  (table) => [unique("barbers_shop_id_id_key").on(table.shopId, table.id)],
);

export const barberServices = pgTable(
  "barber_services",
  {
    shopId: text("shop_id").notNull(),
    barberId: text("barber_id").notNull(),
    serviceId: text("service_id").notNull(),
  },
  (table) => [
    primaryKey({
      name: "barber_services_pkey",
      columns: [table.shopId, table.barberId, table.serviceId],
    }),
    foreignKey({
      name: "barber_services_barber_fkey",
      columns: [table.shopId, table.barberId],
      foreignColumns: [barbers.shopId, barbers.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "barber_services_service_fkey",
      columns: [table.shopId, table.serviceId],
      foreignColumns: [services.shopId, services.id],
    }).onDelete("cascade"),
    index("barber_services_service_idx").on(table.shopId, table.serviceId),
  ],
);
