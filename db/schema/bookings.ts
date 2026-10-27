import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  integer,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { barbers, services } from "./catalog";
import { occupiedIntervals } from "./occupancy";
import { shops } from "./shops";

export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey(),
    shopId: text("shop_id").notNull(),
    serviceId: text("service_id").notNull(),
    barberId: text("barber_id").notNull(),
    occupancyId: uuid("occupancy_id")
      .unique()
      .references(() => occupiedIntervals.id, { onDelete: "set null" }),
    status: text("status").notNull().default("confirmed"),
    startAt: timestamp("start_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true, mode: "date" }).notNull(),
    serviceName: text("service_name").notNull(),
    servicePriceUsd: numeric("service_price_usd").notNull(),
    serviceDurationMinutes: integer("service_duration_minutes").notNull(),
    barberName: text("barber_name").notNull(),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email"),
    customerPhone: text("customer_phone"),
    whatsappOptIn: boolean("whatsapp_opt_in").notNull(),
    creationSource: text("creation_source").notNull().default("public"),
    whatsappConsentAt: timestamp("whatsapp_consent_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    capabilityHash: text("capability_hash").notNull().unique(),
    capabilityCiphertext: text("capability_ciphertext").notNull(),
    capabilityKeyId: text("capability_key_id").notNull(),
    capabilityRevokedAt: timestamp("capability_revoked_at", {
      withTimezone: true,
      mode: "date",
    }),
    recoveryKeyHash: text("recovery_key_hash").notNull(),
    recoveryPayloadDigest: text("recovery_payload_digest").notNull(),
  },
  (table) => [
    unique("bookings_shop_id_id_key").on(table.shopId, table.id),
    foreignKey({
      name: "bookings_shop_fkey",
      columns: [table.shopId],
      foreignColumns: [shops.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "bookings_service_fkey",
      columns: [table.shopId, table.serviceId],
      foreignColumns: [services.shopId, services.id],
    }),
    foreignKey({
      name: "bookings_barber_fkey",
      columns: [table.shopId, table.barberId],
      foreignColumns: [barbers.shopId, barbers.id],
    }),
    unique("bookings_shop_recovery_key_key").on(
      table.shopId,
      table.recoveryKeyHash,
    ),
    check(
      "bookings_status_check",
      sql`${table.status} IN ('confirmed', 'cancelled')`,
    ),
    check(
      "bookings_creation_source_check",
      sql`${table.creationSource} IN ('public', 'owner')`,
    ),
    check("bookings_interval_check", sql`${table.startAt} < ${table.endAt}`),
    check(
      "bookings_whatsapp_consent_check",
      sql`NOT ${table.whatsappOptIn} OR (${table.customerPhone} IS NOT NULL AND ${table.whatsappConsentAt} IS NOT NULL)`,
    ),
    index("bookings_shop_start_idx").on(table.shopId, table.startAt),
  ],
);
