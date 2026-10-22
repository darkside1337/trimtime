import { sql, type SQL } from "drizzle-orm";

export async function copyShopScheduleToBarber(
  transaction: { execute: (query: SQL) => Promise<unknown> },
  shopId: string,
  barberId: string,
) {
  await transaction.execute(sql`
    INSERT INTO barber_schedules (shop_id, barber_id, week, revision)
    SELECT shop_id, ${barberId}, week, 1 FROM shop_schedules WHERE shop_id = ${shopId}
    ON CONFLICT (shop_id, barber_id) DO NOTHING
  `);
}
