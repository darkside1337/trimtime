import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { barbers } from "./catalog";
import { foreignKey } from "drizzle-orm/pg-core";

export const occupiedIntervals = pgTable(
  "occupied_intervals",
  {
    id: uuid("id").primaryKey(),
    shopId: text("shop_id").notNull(),
    barberId: text("barber_id").notNull(),
    startAt: timestamp("start_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (table) => [
    foreignKey({
      name: "occupied_intervals_barber_fkey",
      columns: [table.shopId, table.barberId],
      foreignColumns: [barbers.shopId, barbers.id],
    }).onDelete("cascade"),
    index("occupied_intervals_shop_barber_start_idx").on(
      table.shopId,
      table.barberId,
      table.startAt,
    ),
  ],
);

export const timeBlocks = pgTable("time_blocks", {
  id: uuid("id")
    .primaryKey()
    .references(() => occupiedIntervals.id, { onDelete: "cascade" }),
  note: text("note").notNull().default(""),
});
